"""S-2: subprocessos de jobs recebem ambiente mínimo, sem credenciais do operador."""
import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from horus_backend.api import create_app
from horus_backend.config import Settings
from horus_backend.jobs import (DownloadRequest, FactoryRequest, TranscriptionRequest, job_environment)

TOKEN = "test-only-connection-token-0123456789"
SECRETS = {"YOUTUBE_API_KEY": "s1", "HF_TOKEN": "s2", "OPENAI_API_KEY": "s3", "GITHUB_TOKEN": "s4",
           "HORUS_API_TOKEN": "s5", "HORUS_MANAGED": "1", "HORUS_ELEVENLABS_API_KEY": "s6",
           "ELEVENLABS_API_KEY": "s7", "HORUS_HERMES_CONFIG": "x", "AWS_SECRET_ACCESS_KEY": "s8"}
ALLOWED = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "USERPROFILE", "HOME",
           "LOCALAPPDATA", "APPDATA", "PYTHONUNBUFFERED", "PYTHONUTF8"}


@pytest.fixture
def planted(monkeypatch):
    for name, value in SECRETS.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("HORUS_FFMPEG", "ffmpeg-path")
    monkeypatch.setenv("HORUS_YTDLP", "ytdlp-path")
    monkeypatch.setenv("HORUS_WHISPER_DEVICE", "cpu")
    monkeypatch.setenv("HORUS_NODE", "node-path")
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.local:8080")


def settings(tmp_path, factory_root=None, **extra):
    return Settings(token=TOKEN, data_dir=tmp_path / "data", factory_root=factory_root, hermes_executable=None,
                    hermes_config=tmp_path / "hermes.json", **extra)


REQUESTS = {
    "transcription.run": TranscriptionRequest(operation="transcription.run", path="a.mp4"),
    "youtube.download": DownloadRequest(operation="youtube.download", url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                                        directory="x"),
    "factory.profile": FactoryRequest(operation="factory.profile"),
    "factory.render.preview": FactoryRequest(operation="factory.render.preview", video_id="v1"),
}
EXTRA = {
    "transcription.run": {"HORUS_FFMPEG", "HORUS_WHISPER_DEVICE"},
    "youtube.download": {"HORUS_FFMPEG", "HORUS_YTDLP", "HTTPS_PROXY"},
    "factory.profile": {"HORUS_NODE"},
    "factory.render.preview": {"HORUS_FFMPEG", "HORUS_NODE"},
}


@pytest.mark.parametrize("operation", REQUESTS)
def test_each_operation_gets_only_its_allowlist(operation, planted, tmp_path):
    env = job_environment(REQUESTS[operation], settings(tmp_path))
    names = {k.upper() for k in env}
    assert not set(SECRETS) & names
    assert names <= ALLOWED | EXTRA[operation] | {"FABRICA_HOME", "PYTHONPATH"}
    assert env["PYTHONUTF8"] == "1" and env["PYTHONUNBUFFERED"] == "1"
    assert "PATH" in {n.upper() for n in env}
    for needed in EXTRA[operation]:
        assert needed in env


def test_factory_receives_factory_home_and_pythonpath(planted, tmp_path):
    root = tmp_path / "fabrica"
    env = job_environment(REQUESTS["factory.profile"], settings(tmp_path, factory_root=root))
    assert env["FABRICA_HOME"] == str(root) and env["PYTHONPATH"] == str(root / "scripts")
    other = job_environment(REQUESTS["transcription.run"], settings(tmp_path, factory_root=root))
    assert "FABRICA_HOME" not in other and "PYTHONPATH" not in other


def test_unrelated_tool_variables_do_not_leak(planted, tmp_path):
    names = {k.upper() for k in job_environment(REQUESTS["transcription.run"], settings(tmp_path))}
    assert not {"HORUS_YTDLP", "HORUS_NODE", "HTTPS_PROXY"} & names


def test_subprocess_really_receives_minimal_environment(planted, tmp_path):
    out = tmp_path / "env.json"
    worker = tmp_path / "fake_worker.py"
    worker.write_text(f'''
import json, os, pathlib, sys
pathlib.Path({str(out)!r}).write_text(json.dumps(sorted(os.environ)))
args = sys.argv[1:]
if args[0] == "download":
    target = pathlib.Path(args[args.index("--directory") + 1]) / "v.mp4"
    target.write_bytes(b"v")
    print("HORUS_FILE:" + str(target), flush=True)
''', encoding="utf-8")
    media = tmp_path / "a.mp4"
    media.write_bytes(b"x")
    config = settings(tmp_path, worker_command=(sys.executable, str(worker)))
    with TestClient(create_app(config), base_url="http://127.0.0.1",
                    headers={"Authorization": f"Bearer {TOKEN}"}) as client:
        job = client.post("/v1/jobs", json={"operation": "transcription.run", "path": str(media)}).json()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and client.get(f"/v1/jobs/{job['id']}").json()["status"] not in {
                "succeeded", "failed", "blocked"}:
            time.sleep(.05)
    seen = {n.upper() for n in json.loads(Path(out).read_text())}
    assert not set(SECRETS) & seen
    assert "HORUS_FFMPEG" in seen and "HORUS_WHISPER_DEVICE" in seen
