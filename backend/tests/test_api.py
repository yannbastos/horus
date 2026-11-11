import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from horus_backend.api import create_app
from horus_backend.config import Settings
from horus_backend.storage import Store

TOKEN = "test-only-connection-token-0123456789"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def settings(tmp_path):
    script = tmp_path / "fake_factory.py"
    script.write_text('''
import json, os, subprocess, sys, time
channel = sys.argv[sys.argv.index('--canal') + 1]
if channel == 'failure':
    print('Falha técnica de teste', file=sys.stderr, flush=True)
    sys.exit(3)
if channel == 'factoryerror':
    print('ERRO: caminho fora da pasta do vídeo', flush=True)
    sys.exit(1)
if channel == 'broken':
    print('não é JSON', flush=True)
elif channel == 'slow':
    print('processando', flush=True)
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
    print('child:' + str(child.pid), flush=True)
    time.sleep(30)
else:
    print('aviso de perfil incompleto', file=sys.stderr, flush=True)
    print(json.dumps({'id': channel, 'has_api_token': 'HORUS_API_TOKEN' in os.environ}), flush=True)
''', encoding="utf-8")
    return Settings(token=TOKEN, data_dir=tmp_path / "data", factory_root=tmp_path,
                    factory_command=(sys.executable, str(script)), hermes_executable=None,
                    hermes_config=tmp_path / "hermes.json")


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings), base_url="http://127.0.0.1", headers=HEADERS) as client:
        yield client


def submit(client, channel="canal01", key=None):
    headers = {"Idempotency-Key": key} if key else {}
    response = client.post("/v1/jobs", json={"operation": "factory.profile", "channel_id": channel}, headers=headers)
    assert response.status_code == 202, response.text
    return response.json()


def wait_job(client, job_id, statuses=None):
    statuses = statuses or {"succeeded", "failed", "blocked", "cancelled", "interrupted"}
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        job = client.get(f"/v1/jobs/{job_id}").json()
        if job["status"] in statuses:
            return job
        time.sleep(.02)
    pytest.fail(f"Tarefa não encerrou: {job}")


def test_authentication_is_required(client):
    response = client.get("/health", headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401


def test_diagnostics_reports_presence_without_running_tools(client, monkeypatch):
    import subprocess
    from horus_backend import dependencies

    def unexpected_process(*args, **kwargs):
        pytest.fail("O diagnóstico não deve executar ferramentas.")

    monkeypatch.setattr(subprocess, "Popen", unexpected_process)
    monkeypatch.setattr(dependencies.shutil, "which", lambda name: "/private/bin/node" if name == "node" else None)
    response = client.get("/v1/diagnostics")
    assert response.status_code == 200
    report = response.json()
    checks = {check["id"]: check for check in report["checks"]}
    assert checks["factory"]["available"] is True
    assert checks["node"]["available"] is True
    assert checks["ffmpeg"]["available"] is False
    assert checks["hermes"]["available"] is False
    assert report["hermes_connected"] is False
    assert "/private" not in response.text
    assert TOKEN not in response.text
    assert client.get("/v1/diagnostics", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_foreign_origin_is_rejected_even_with_token(client):
    assert client.get("/health", headers={"Origin": "https://example.org"}).status_code == 403


def test_foreign_host_is_rejected(client):
    assert client.get("/health", headers={"Host": "example.org"}).status_code == 403


def test_cors_preflight(client):
    response = client.options("/v1/jobs", headers={"Origin": "http://127.0.0.1:1420", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:1420"


@pytest.mark.parametrize("channel", ["../outside", "a/b", "C:\\temp", "_template", "a;echo"])
def test_unsafe_identifiers_are_rejected(client, channel):
    assert client.post("/v1/jobs", json={"operation": "factory.profile", "channel_id": channel}).status_code == 422


@pytest.mark.parametrize("payload", [
    {"operation": "voice.generate"},
    {"operation": "factory.profile", "command": "arbitrary"},
    {"operation": "factory.render.preview"},
])
def test_only_explicit_operations_are_allowed(client, payload):
    assert client.post("/v1/jobs", json=payload).status_code == 422


def test_profile_captures_json_and_stderr_separately(client, monkeypatch):
    monkeypatch.setenv("HORUS_API_TOKEN", "secret-not-to-forward")
    job = wait_job(client, submit(client)["id"])
    assert job["status"] == "succeeded", job
    assert job["result"] == {"id": "canal01", "has_api_token": False}
    response = client.get(f"/v1/jobs/{job['id']}/events")
    events = [json.loads(line) for line in response.text.splitlines()]
    assert any(event.get("kind") == "stderr" for event in events)
    assert events[-1]["kind"] == "complete"
    assert events[-1]["job"]["status"] == "succeeded"
    assert len({event["sequence"] for event in events if "sequence" in event}) == len(events) - 1


def test_idempotency_prevents_duplicate_execution(client):
    first = submit(client, key="same-input")
    second = submit(client, key="same-input")
    assert first["id"] == second["id"]
    assert wait_job(client, first["id"])["attempt"] == 1
    assert len(client.get("/v1/jobs").json()) == 1
    assert client.post("/v1/jobs", json={"operation": "factory.profile", "channel_id": "other"}, headers={"Idempotency-Key": "same-input"}).status_code == 409


@pytest.mark.parametrize("channel", ["broken", "failure"])
def test_command_errors_are_not_success(client, channel):
    assert wait_job(client, submit(client, channel)["id"])["status"] == "failed"


@pytest.mark.parametrize(('channel', 'reason'), [
    ('failure', 'Falha técnica de teste'),
    ('factoryerror', 'ERRO: caminho fora da pasta do vídeo'),
])
def test_factory_failure_reason_is_visible_without_opening_logs(client, channel, reason):
    job = wait_job(client, submit(client, channel)['id'])
    assert job['status'] == 'failed'
    assert reason in job['error']
    events = client.app.state.store.events(job['id'], 0)
    assert any(reason in event['message'] for event in events)


def test_cancel_stops_owned_process_and_queued_work(client):
    first = submit(client, "slow")
    wait_job(client, first["id"], {"running"})
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if any(event['message'].startswith('child:') for event in client.app.state.store.events(first['id'], 0)):
            break
        time.sleep(.02)
    else:
        pytest.fail('O CLI de teste não iniciou o processo filho.')
    second = submit(client)
    assert client.post(f"/v1/jobs/{second['id']}/cancel").json()["status"] == "cancelled"
    client.post(f"/v1/jobs/{first['id']}/cancel")
    assert wait_job(client, first["id"])["status"] == "cancelled"
    assert wait_job(client, second["id"])["attempt"] == 0


def test_retry_requires_explicit_terminal_failure(client):
    job = wait_job(client, submit(client, "failure")["id"])
    assert client.post(f"/v1/jobs/{job['id']}/retry").status_code == 200
    assert wait_job(client, job["id"])["attempt"] == 2
    success = wait_job(client, submit(client)["id"])
    assert client.post(f"/v1/jobs/{success['id']}/retry").status_code == 409


def test_unknown_job(client):
    assert client.get("/v1/jobs/missing").status_code == 404
    assert client.post("/v1/jobs/missing/cancel").status_code == 404


def test_history_survives_restart(settings):
    with TestClient(create_app(settings), base_url="http://127.0.0.1", headers=HEADERS) as first:
        job = wait_job(first, submit(first)["id"])
    with TestClient(create_app(settings), base_url="http://127.0.0.1", headers=HEADERS) as second:
        restored = second.get(f"/v1/jobs/{job['id']}").json()
        assert restored["status"] == "succeeded"
        assert restored["attempt"] == 1


def test_interrupted_tasks_are_not_reexecuted(settings):
    store = Store(settings.data_dir / "horus.sqlite3")
    job, _ = store.create_job({"operation": "factory.profile", "channel_id": "canal01", "video_id": None}, "interrupted")
    store.update(job["id"], "running", new_attempt=True)
    with TestClient(create_app(settings), base_url="http://127.0.0.1", headers=HEADERS) as client:
        restored = client.get(f"/v1/jobs/{job['id']}").json()
        assert restored["status"] == "interrupted"
        assert restored["attempt"] == 1


def test_old_queued_job_is_recovered_beyond_recent_history(settings):
    store = Store(settings.data_dir / 'horus.sqlite3')
    payload = {'operation': 'factory.profile', 'channel_id': 'canal01', 'video_id': None}
    pending, _ = store.create_job(payload, 'older-pending')
    for index in range(101):
        historical, _ = store.create_job(payload, f'historical-{index}')
        store.update(historical['id'], 'succeeded')
    with TestClient(create_app(settings), base_url='http://127.0.0.1', headers=HEADERS) as client:
        assert wait_job(client, pending['id'])['status'] == 'succeeded'


def test_media_is_scoped_and_supports_range(client, tmp_path):
    video = tmp_path / "vídeo local.mp4"
    video.write_bytes(bytes(range(200)))
    item = client.post("/v1/media", json={"path": str(video)}).json()
    assert "path" not in item
    assert client.get(f"/v1/media/{item['id']}/stream").status_code == 401
    response = client.get(item["stream_path"], headers={"Range": "bytes=20-29"})
    assert response.status_code == 206
    assert response.content == bytes(range(20, 30))
    video.write_bytes(b"changed")
    assert client.get(item["stream_path"]).status_code == 409


def test_missing_or_non_media_file_is_rejected(client, tmp_path):
    secret = tmp_path / ".env"
    secret.write_text("not-media")
    assert client.post("/v1/media", json={"path": str(secret)}).status_code == 400
    assert client.post("/v1/media", json={"path": str(tmp_path / 'missing.mp4')}).status_code == 400


def test_media_folder_is_shallow(client, tmp_path):
    (tmp_path / "one.mp4").write_bytes(b"one")
    (tmp_path / "secret.txt").write_text("secret")
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "two.mp4").write_bytes(b"two")
    response = client.post("/v1/media/folder", json={"path": str(tmp_path)})
    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["one.mp4"]


def test_unavailable_factory_is_blocked(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", "")
    settings = Settings(token=TOKEN, data_dir=tmp_path, factory_root=None)
    with TestClient(create_app(settings), base_url="http://127.0.0.1", headers=HEADERS) as client:
        assert client.get("/health").json()["factory_available"] is False
        assert wait_job(client, submit(client)["id"])["status"] == "blocked"
