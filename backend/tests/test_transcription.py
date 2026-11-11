import json
import sys
import time

import pytest
from fastapi.testclient import TestClient

from horus_backend.api import create_app
from horus_backend.config import Settings
from horus_backend.transcriber import is_youtube_url
from horus_backend.storage import Store

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
    if "silent-long" in name:
        time.sleep(35)
    if "empty-audio" in name:
        say("progress", "100")
        sys.exit(0)
    say("status", "Transcrevendo...")
    say("segment", "Primeira frase.")
    say("progress", "50")
    if "cancel-normal" in name:
        while not pathlib.Path(value("--path") + ".finish").exists():
            time.sleep(.01)
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


def test_empty_transcription_succeeds_and_empty_text_can_be_saved(client, tmp_path):
    media = tmp_path / 'empty-audio.wav'
    media.write_bytes(b'simulated-silence')
    job = wait_job(client, transcribe(client, media)['id'])
    assert job['status'] == 'succeeded'
    assert job['result'] == {'text': ''}
    target = tmp_path / 'silence.txt'
    assert client.post('/v1/transcriptions/save', json={'path': str(target), 'text': ''}).status_code == 200
    assert target.read_bytes() == b''


def test_cancel_wins_even_when_worker_returns_success(client, tmp_path, monkeypatch):
    from horus_backend.processes import OwnedProcess
    async def let_worker_finish(self):
        pass
    media = tmp_path / 'cancel-normal.wav'
    media.write_bytes(b'audio')
    original = transcribe(client, media)
    deadline = time.monotonic() + 5
    while not (client.get(f"/v1/jobs/{original['id']}").json()['result'] or {}).get('text'):
        assert time.monotonic() < deadline
        time.sleep(.01)
    process = client.app.state.manager.active_process.process
    with monkeypatch.context() as patch:
        patch.setattr(OwnedProcess, 'stop', let_worker_finish)
        client.post(f"/v1/jobs/{original['id']}/cancel")
        (tmp_path / 'cancel-normal.wav.finish').write_text('finish', encoding='utf-8')
        cancelled = wait_job(client, original['id'])
    assert process.returncode == 0
    assert cancelled['status'] == 'cancelled'
    assert cancelled['result']['partial'] is True
    assert cancelled['result']['text'].startswith('Primeira frase.\n')


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


def test_partial_checkpoint_survives_log_retention_and_recovery(tmp_path):
    store = Store(tmp_path / 'temporary.sqlite3')
    job, _ = store.create_job({'operation': 'transcription.run', 'path': 'local.wav'}, 'checkpoint')
    store.update(job['id'], 'running', new_attempt=True)
    # Mais segmentos do que a retenção de logs, incluindo uma linha maior que o log permitido.
    texts = ['trecho ' + str(i) for i in range(2002)] + ['x' * 2500]
    for text in texts:
        store.event(job['id'], 'segment', text)
    checkpoint = store.get_job(job['id'])['result']
    assert checkpoint['text'] == ''.join(text + '\n' for text in texts)
    assert checkpoint['sequence'] > 2000
    store.recover()
    reopened = Store(store.path).get_job(job['id'])
    assert reopened['status'] == 'interrupted'
    assert reopened['attempt'] == 1
    assert reopened['result'] == checkpoint
    store.recover()
    assert store.get_job(job['id']) == reopened


def test_shutdown_preserves_partial_and_restart_does_not_resubmit(client, tmp_path):
    media = tmp_path / 'slow-restart.wav'
    media.write_bytes(b'audio')
    payload = {'operation': 'transcription.run', 'path': str(media)}
    headers = {'Idempotency-Key': 'lost-response-original-key'}
    original = client.post('/v1/jobs', json=payload, headers=headers).json()
    deadline = time.monotonic() + 5
    while not (client.get(f"/v1/jobs/{original['id']}").json()['result'] or {}).get('text'):
        assert time.monotonic() < deadline
        time.sleep(.02)
    # Fechamento do worker durante a transcrição; mesmo caminho do lifespan do backend.
    client.portal.call(client.app.state.manager.close)
    interrupted = client.get(f"/v1/jobs/{original['id']}").json()
    assert interrupted['status'] == 'interrupted'
    assert interrupted['result']['text'] == 'Primeira frase.\n'
    client.portal.call(client.app.state.manager.start)
    repeated = client.post('/v1/jobs', json=payload, headers=headers).json()
    assert repeated['id'] == original['id']
    assert repeated['status'] == 'interrupted'
    assert repeated['attempt'] == 1
    assert repeated['result'] == interrupted['result']
    assert client.get('/v1/transcription/jobs').json()[0]['id'] == original['id']


def test_media_history_is_filtered_before_pagination_and_does_not_run_jobs(client):
    store = client.app.state.store
    old, _ = store.create_job({'operation': 'transcription.run', 'path': 'old.wav'}, 'old-transcription')
    for i in range(105):
        store.create_job({'operation': 'editorial.simulated', 'stage': 'planning'}, f'editorial-{i}')
    history = client.get('/v1/transcription/jobs').json()
    assert [item['id'] for item in history] == [old['id']]
    for i in range(101):
        store.create_job({'operation': 'youtube.download', 'url': VIDEO, 'directory': '.'}, f'download-{i}')
    assert len(client.get('/v1/transcription/jobs').json()) == 100
    assert len(client.get('/v1/transcription/jobs?offset=100').json()) == 2
    assert client.get('/v1/transcription/jobs?offset=-1').status_code == 422
    assert store.get_job(old['id'])['attempt'] == 0
    assert client.get('/v1/transcription/jobs', headers={'Authorization': 'wrong'}).status_code == 401


def test_checkpoint_and_event_are_rolled_back_together(client, tmp_path):
    store = client.app.state.store
    job, _ = store.create_job({'operation': 'transcription.run', 'path': 'test.wav'}, 'rollback')
    with store.connect() as db:
        db.execute("""CREATE TRIGGER reject_checkpoint BEFORE UPDATE OF result ON jobs
                      BEGIN SELECT RAISE(ABORT, 'checkpoint failure'); END""")
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        store.event(job['id'], 'segment', 'not committed')
    assert store.events(job['id'], 0) == []
    assert store.get_job(job['id'])['result'] is None


def test_new_attempt_checkpoint_skips_old_segment_events(tmp_path):
    store = Store(tmp_path / 'attempts.sqlite3')
    job, _ = store.create_job({'operation': 'transcription.run', 'path': 'local.wav'}, 'attempts')
    store.update(job['id'], 'running', new_attempt=True)
    store.event(job['id'], 'segment', 'old attempt')
    store.update(job['id'], 'interrupted', result=store.get_job(job['id'])['result'])
    store.update(job['id'], 'running', new_attempt=True)
    checkpoint = store.get_job(job['id'])['result']
    assert checkpoint['text'] == ''
    assert store.events(job['id'], checkpoint['sequence']) == []
    store.event(job['id'], 'segment', 'new attempt')
    assert store.get_job(job['id'])['result']['text'] == 'new attempt\n'


def test_long_silent_task_has_transport_keepalive_without_persistent_events(client, tmp_path):
    media = tmp_path / 'silent-long.wav'
    media.write_bytes(b'audio')
    started = time.monotonic()
    original = transcribe(client, media)
    response = client.get(f"/v1/jobs/{original['id']}/events")
    frames = [json.loads(line) for line in response.text.splitlines()]
    assert time.monotonic() - started > 30
    keepalives = [item for item in frames if item['kind'] == 'keepalive']
    assert len(keepalives) >= 3
    assert all(item == {'kind': 'keepalive'} for item in keepalives)
    assert frames[-1]['kind'] == 'complete'
    assert frames[-1]['job']['attempt'] == 1
    assert frames[-1]['job']['status'] == 'succeeded'
    assert all(item['kind'] != 'keepalive' for item in client.app.state.store.events(original['id'], 0))
    sequence = [item['sequence'] for item in frames if 'sequence' in item]
    assert sequence == sorted(set(sequence))
    replay = client.get(f"/v1/jobs/{original['id']}/events?after={sequence[-1]}")
    assert [json.loads(line)['kind'] for line in replay.text.splitlines()] == ['complete']
    assert len(client.get('/v1/transcription/jobs').json()) == 1


@pytest.mark.parametrize('status', ['failed', 'interrupted', 'cancelled', 'blocked'])
def test_direct_transcription_retry_preserves_checkpoint(client, status):
    store = client.app.state.store
    job, _ = store.create_job({'operation': 'transcription.run', 'path': 'original.wav'}, 'no-retry')
    partial = {'text': 'Preservar este texto.\n', 'partial': True, 'sequence': 42}
    store.update(job['id'], status, result=partial)
    before = store.get_job(job['id'])
    assert client.post(f"/v1/jobs/{job['id']}/retry").status_code == 409
    assert store.get_job(job['id']) == before


def test_transcription_timeout_preserves_checkpoint(client, tmp_path, monkeypatch):
    from horus_backend.jobs import TIMEOUTS
    # Força TimeoutError depois de um segmento, sem depender da velocidade de spawn.
    manager = client.app.state.manager
    original = manager._line

    async def emit_then_timeout(*args, **kwargs):
        await original(*args, **kwargs)
        if args[1] == 'stdout' and '"segment"' in args[2]:
            raise TimeoutError('timeout simulado depois do checkpoint')

    monkeypatch.setattr(manager, '_line', emit_then_timeout)
    monkeypatch.setitem(TIMEOUTS, 'transcription.run', .5)
    media = tmp_path / 'slow-timeout.wav'
    media.write_bytes(b'audio')
    job = wait_job(client, transcribe(client, media)['id'])
    assert job['status'] == 'failed'
    assert job['result']['text'] == 'Primeira frase.\n'
    assert job['result']['partial'] is True


def test_database_identity_is_stable_and_distinguishes_instances(tmp_path):
    first = Store(tmp_path / 'first.sqlite3')
    identity = first.database_id
    first.create_job({'operation': 'transcription.run', 'path': 'a.wav'}, 'one')
    assert Store(first.path).database_id == identity
    assert Store(tmp_path / 'other.sqlite3').database_id != identity
