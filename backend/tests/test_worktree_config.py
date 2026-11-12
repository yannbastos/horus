import pytest
from fastapi.testclient import TestClient
from horus_backend.api import create_app
from horus_backend.config import Settings, frontend_origins


@pytest.mark.parametrize('origin', [
    '', '*', 'https://example.com', 'http://127.0.0.1:0',
    'http://127.0.0.1:65536', 'http://127.0.0.1:1432/',
    'http://localhost:1432/path', 'http://localhost:1432@evil.com',
    'http://127.0.0.2:1432', 'https://localhost:1432',
])
def test_refuses_non_loopback_origin(monkeypatch, origin):
    monkeypatch.setenv('HORUS_FRONTEND_ORIGIN', origin)
    with pytest.raises(ValueError, match='HORUS_FRONTEND_ORIGIN'):
        frontend_origins()


def test_defaults_preserve_tauri(monkeypatch):
    monkeypatch.delenv('HORUS_FRONTEND_ORIGIN', raising=False)
    assert frontend_origins() == (
        'http://localhost:1420', 'http://127.0.0.1:1420',
        'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost',
    )


def test_two_apps_keep_cors_and_data_separate(monkeypatch, tmp_path):
    for port in (1432, 1434):
        monkeypatch.setenv('HORUS_FRONTEND_ORIGIN', f'http://127.0.0.1:{port}')
        settings = Settings(token='test-token-isolated-123456789', data_dir=tmp_path / str(port))
        with TestClient(create_app(settings), base_url="http://127.0.0.1") as client:
            headers = {'Origin': f'http://127.0.0.1:{port}', 'Access-Control-Request-Method': 'GET'}
            response = client.options('/v1/health', headers=headers)
            assert response.headers['access-control-allow-origin'] == headers['Origin']
            headers['Origin'] = f'http://127.0.0.1:{1434 if port == 1432 else 1432}'
            assert client.options('/v1/health', headers=headers).status_code == 403
    assert (tmp_path / '1432/horus.sqlite3').is_file()
    assert (tmp_path / '1434/horus.sqlite3').is_file()


def test_two_backend_processes_and_occupied_port(tmp_path):
    import json
    import os
    import subprocess
    import sys
    import time
    import urllib.request

    token = "isolated-test-token-1234567890"
    processes = []
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        identities = []
        for port in (8772, 8774):
            data = tmp_path / str(port)
            env = dict(os.environ, HORUS_API_TOKEN=token, HORUS_DATA_DIR=str(data),
                       HORUS_FRONTEND_ORIGIN=f"http://127.0.0.1:{1432 if port == 8772 else 1434}",
                       HORUS_WORKFLOW_EXECUTOR="simulated", HORUS_RADAR_EXECUTOR="hermes_simulated",
                       HORUS_MANAGED="0", HORUS_HERMES_CONFIG=str(data / "no-connection.json"),
                       HORUS_HERMES_PROFILE=str(data / "no-profile"), HORUS_HERMES_EXECUTABLE=str(data / "no-executable"))
            command = [sys.executable, "-m", "horus_backend", "--port", str(port)]
            process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            processes.append(process)
            deadline = time.monotonic() + 15
            request = urllib.request.Request(f"http://127.0.0.1:{port}/health",
                                             headers={"Authorization": f"Bearer {token}"})
            while True:
                assert process.poll() is None, process.communicate()
                try:
                    with opener.open(request, timeout=1) as response:
                        identities.append(json.load(response)["database_id"])
                    break
                except (OSError, ValueError):
                    if time.monotonic() >= deadline:
                        raise AssertionError("Backend não iniciou em 15 segundos")
                    time.sleep(0.05)
            collision = subprocess.run(command, env=env, capture_output=True, timeout=15)
            assert collision.returncode != 0
            assert b"bind" in collision.stderr
        assert identities[0] != identities[1]
        assert all(process.poll() is None for process in processes)
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
            process.communicate(timeout=15)
