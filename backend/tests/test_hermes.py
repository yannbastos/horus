import json
import threading
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from horus_backend.api import create_app
from horus_backend.config import Settings, discover_hermes
from horus_backend.hermes import HermesConnector, MAX_RESPONSE, read_connection

TOKEN = "test-only-horus-session-0123456789"
HERMES_TOKEN = "test-only-hermes-secret-0123456789"


@pytest.fixture
def gateway():
    requests = []
    behavior = {"mode": "ok"}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            requests.append((self.command, self.path, self.headers.get("Authorization")))
            if behavior["mode"] == "unauthorized":
                self.send_response(401)
                self.end_headers()
                return
            if behavior["mode"] == "redirect":
                self.send_response(302)
                self.send_header("Location", "/secret-target")
                self.end_headers()
                return
            if behavior["mode"] == "oversized":
                payload = b" " * (MAX_RESPONSE + 1)
            elif self.path == "/health":
                payload = json.dumps({"status": "ok", "platform": "hermes-agent" if behavior["mode"] != "foreign" else "other",
                                      "version": "0.23.1"}).encode()
            else:
                payload = json.dumps({"object": "hermes.api_server.capabilities", "platform": "hermes-agent",
                                      "auth": {"type": "bearer", "required": behavior["mode"] != "no_auth"},
                                      "features": {"run_submission": True, "responses_api": True,
                                                   "chat_completions": False, "other": "untrusted"}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(payload)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests, behavior
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def settings_for(tmp_path, base_url=None):
    settings = Settings(token=TOKEN, data_dir=tmp_path / "data", factory_root=None, hermes_executable=None,
                        hermes_config=tmp_path / "private-hermes.json")
    if base_url:
        settings.hermes_config.write_text(json.dumps({"base_url": base_url, "token": HERMES_TOKEN}))
    return settings


def test_authenticated_probe_only_reads_public_metadata(tmp_path, gateway, monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:1")
    url, requests, _ = gateway
    settings = settings_for(tmp_path, url)
    with TestClient(create_app(settings), base_url="http://127.0.0.1", headers={"Authorization": f"Bearer {TOKEN}"}) as client:
        assert client.get("/v1/hermes").json()["state"] == "not_checked"
        assert requests == []
        response = client.post("/v1/hermes/probe")
        report = response.json()
        assert report["connected"] is True
        assert report["version"] == "0.23.1"
        assert report["features"] == ["run_submission", "responses_api"]
        assert report["checked_at"]
        assert client.get("/health").json()["hermes_connected"] is True
        client.post("/v1/hermes/probe")  # Double click does not repeat the probe immediately.
        assert [(method, path) for method, path, _ in requests] == [("GET", "/health"), ("GET", "/v1/capabilities")]
        assert all(auth == f"Bearer {HERMES_TOKEN}" for _, _, auth in requests)
        for secret in (TOKEN, HERMES_TOKEN, url, str(settings.hermes_config)):
            assert secret not in response.text
        assert client.post("/v1/hermes/probe", headers={"Authorization": "wrong"}).status_code == 401


@pytest.mark.parametrize("mode,state", [("unauthorized", "unauthorized"), ("redirect", "incompatible"),
                                       ("oversized", "incompatible"), ("foreign", "incompatible"), ("no_auth", "incompatible")])
def test_untrusted_services_are_not_reported_connected(tmp_path, gateway, mode, state):
    url, requests, behavior = gateway
    behavior["mode"] = mode
    connector = HermesConnector(settings_for(tmp_path, url))
    report = connector._probe()
    assert report["state"] == state
    assert report["connected"] is False
    assert not any(path == "/secret-target" for _, path, _ in requests)


@pytest.mark.parametrize("url", ["https://example.com:443", "http://127.0.0.1.example.org:8642", "http://localhost:8642",
                                "http://127.0.0.1:8642/path", "http://user:password@127.0.0.1:8642",
                                "http://127.0.0.1:8642?token=secret", "http://127.0.0.1:8642/#fragment",
                                "http://127.0.0.1", "http://127.0.0.1:99999"])
def test_connection_is_confined_to_explicit_loopback_origins(tmp_path, url):
    with pytest.raises(ValueError):
        read_connection(settings_for(tmp_path, url))


def test_missing_or_invalid_configuration_has_actionable_status(tmp_path):
    settings = settings_for(tmp_path)
    assert HermesConnector(settings)._probe()["state"] == "not_configured"
    settings.hermes_config.write_text("{broken json")
    assert HermesConnector(settings)._probe()["state"] == "invalid_config"
    settings.hermes_config.write_text("x" * (16 * 1024 + 1))
    assert HermesConnector(settings)._probe()["state"] == "invalid_config"


def test_expired_success_is_not_live_connection(tmp_path):
    connector = HermesConnector(settings_for(tmp_path))
    connector.last_report = connector.report("connected", "verified")
    connector.last_check = time.monotonic() - 91
    assert connector.status()["state"] == "stale"
    assert connector.status()["connected"] is False


@pytest.mark.skipif(sys.platform != "win32", reason="Descoberta do instalador Windows")
def test_windows_install_is_discovered_even_before_shell_path_refresh(tmp_path, monkeypatch):
    from horus_backend import config
    executable = tmp_path / "hermes/bin/hermes.exe"
    executable.parent.mkdir(parents=True)
    executable.touch()
    monkeypatch.delenv("HORUS_HERMES_EXECUTABLE", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setattr(config.shutil, "which", lambda name: None)
    monkeypatch.setattr(config.os, "name", "nt")
    assert discover_hermes() == executable
