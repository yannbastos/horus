import json
import sys
import time

import pytest
from fastapi.testclient import TestClient

from horus_backend.api import create_app
from horus_backend.config import Settings
from horus_backend.transcriber import is_youtube_url

TOKEN = "test-only-connection-token-0123456789"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


@pytest.fixture
def client(tmp_path):
    # Simula o subprocesso real: mesmo protocolo NDJSON, sem Whisper nem rede.
    worker = tmp_path / "fake_worker.py"
    worker.write_text('''
import json, pathlib, sys, time
args = sys.argv[1:]
value = lambda name: args[args.index(name) + 1]
say = lambda kind, message: print(json.dumps({"type": kind, "message": message}), flush=True)
if args[0] == "transcribe":
    name = pathlib.Path(value("--path")).name
    say("status", "Transcrevendo...")
    say("segment", "Primeira frase.")
    say("progress", "50")
    if "slow" in name:
        time.sleep(30)
    if "fail" in name:
        print("RuntimeError: modelo indisponível", file=sys.stderr, flush=True)
        sys.exit(1)
    say("segment", "Segunda frase.")
    say("progress", "100")
else:
    target = pathlib.Path(value("--directory")) / "video [dQw4w9WgXcQ].mp4"
    print("[download]  50.0% of 1.00MiB", flush=True)
    if "missing" not in str(target.parent):
        target.write_bytes(b"video")
    print("HORUS_FILE:" + str(target), flush=True)
''', encoding="utf-8")
    settings = Settings(token=TOKEN, data_dir=tmp_path / "data", factory_root=None, hermes_executable=None,
                        hermes_config=tmp_path / "hermes.json", worker_command=(sys.executable, str(worker)))
    with TestClient(create_app(settings), base_url="http://127.0.0.1", headers=HEADERS) as client:
        yield client


def wait_job(client, job_id, statuses=("succeeded", "failed", "blocked", "cancelled", "interrupted")):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        job = client.get(f"/v1/jobs/{job_id}").json()
        if job["status"] in statuses:
            return job
        time.sleep(.02)
    pytest.fail(f"Tarefa não encerrou: {job}")


def transcribe(client, path, **extra):
    response = client.post("/v1/jobs", json={"operation": "transcription.run", "path": str(path), **extra})
    assert response.status_code == 202, response.text
    return response.json()


def test_transcription_streams_segments_and_returns_text(client, tmp_path):
    media = tmp_path / "entrevista.mp3"
    media.write_bytes(b"audio")
    job = wait_job(client, transcribe(client, media, model="tiny", language="pt")["id"])
    assert job["status"] == "succeeded", job
    assert job["result"] == {"text": "Primeira frase.\nSegunda frase.\n"}
    events = [json.loads(line) for line in client.get(f"/v1/jobs/{job['id']}/events").text.splitlines()]
    kinds = [event["kind"] for event in events]
    assert {"status", "segment", "progress"} <= set(kinds)
    assert "stdout" not in kinds


def test_cancel_preserves_partial_text(client, tmp_path):
    media = tmp_path / "slow.mp4"
    media.write_bytes(b"video")
    job = transcribe(client, media)
    deadline = time.monotonic() + 5
    while not any(e["kind"] == "segment" for e in client.app.state.store.events(job["id"], 0)):
        assert time.monotonic() < deadline, "O segmento parcial não chegou."
        time.sleep(.02)
    client.post(f"/v1/jobs/{job['id']}/cancel")
    cancelled = wait_job(client, job["id"])
    assert cancelled["status"] == "cancelled"
    assert cancelled["result"] == {"text": "Primeira frase.\n", "partial": True}


def test_failure_reports_worker_reason(client, tmp_path):
    media = tmp_path / "fail.wav"
    media.write_bytes(b"audio")
    job = wait_job(client, transcribe(client, media)["id"])
    assert job["status"] == "failed"
    assert "modelo indisponível" in job["error"]
    assert job["result"]["partial"] is True


def test_missing_media_is_blocked(client, tmp_path):
    job = wait_job(client, transcribe(client, tmp_path / "removido.mp4")["id"])
    assert job["status"] == "blocked"


@pytest.mark.parametrize("payload", [
    {"operation": "transcription.run", "path": "a.mp4", "model": "huge"},
    {"operation": "transcription.run", "path": "a.mp4", "language": "fr"},
    {"operation": "transcription.run", "path": "a.mp4", "command": "x"},
    {"operation": "youtube.download", "url": "https://example.org/watch?v=dQw4w9WgXcQ", "directory": "."},
])
def test_invalid_requests_are_rejected(client, payload):
    assert client.post("/v1/jobs", json=payload).status_code == 422


def test_download_returns_file_path(client, tmp_path):
    response = client.post("/v1/jobs", json={"operation": "youtube.download", "url": VIDEO, "directory": str(tmp_path)})
    job = wait_job(client, response.json()["id"])
    assert job["status"] == "succeeded", job
    assert job["result"]["path"].endswith("video [dQw4w9WgXcQ].mp4")


def test_download_without_file_fails(client, tmp_path):
    directory = tmp_path / "missing"
    directory.mkdir()
    response = client.post("/v1/jobs", json={"operation": "youtube.download", "url": VIDEO, "directory": str(directory)})
    job = wait_job(client, response.json()["id"])
    assert job["status"] == "failed"
    assert "arquivo de vídeo válido" in job["error"]


def test_save_writes_only_txt(client, tmp_path):
    target = tmp_path / "transcrição.txt"
    response = client.post("/v1/transcriptions/save", json={"path": str(target), "text": "linha 1\nlinha 2\n"})
    assert response.status_code == 200, response.text
    assert target.read_text(encoding="utf-8") == "linha 1\nlinha 2\n"
    assert client.post("/v1/transcriptions/save", json={"path": str(tmp_path / "x.py"), "text": "x"}).status_code == 400
    assert client.post("/v1/transcriptions/save", json={"path": str(tmp_path / "no" / "x.txt"), "text": "x"}).status_code == 400
    assert not list(tmp_path.glob(".horus-*"))


def test_status_reports_presence(client):
    status = client.get("/v1/transcription").json()
    assert set(status) == {"engine", "downloader", "ffmpeg"}


@pytest.mark.parametrize("url,valid", [
    (VIDEO, True),
    ("https://youtu.be/dQw4w9WgXcQ", True),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", True),
    ("http://www.youtube.com/watch?v=dQw4w9WgXcQ", False),
    ("https://user@www.youtube.com/watch?v=dQw4w9WgXcQ", False),
    ("https://www.youtube.com/playlist?list=PL123", False),
    ("https://www.youtube.com/watch?v=short", False),
    ("https://evil.com/watch?v=dQw4w9WgXcQ", False),
])
def test_youtube_url_rule(url, valid):
    assert is_youtube_url(url) is valid
