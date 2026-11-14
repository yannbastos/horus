"""HOR-127: nenhuma rota do backend fica acessível sem a autenticação local; só loopback é aceito.

Percorre `app.routes`: uma rota nova sem autenticação faz o teste falhar. Somente bancos temporários.
"""
import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from horus_backend import api as api_module
from horus_backend.api import create_app
from horus_backend.config import Settings, frontend_origins

TOKEN = "endpoint-auth-tests-token-0123456789"
GOOD = {"Authorization": f"Bearer {TOKEN}"}

# Rotas sem Bearer. Justificativa: o elemento <video> não envia cabeçalhos; o acesso é autorizado por um
# ticket HMAC assinado com o token local, atrelado ao id da mídia e com expiração (ver testes de mídia).
PUBLIC_WITHOUT_BEARER = {("GET", "/v1/media/{media_id}/stream")}


@pytest.fixture
def settings(tmp_path):
    return Settings(token=TOKEN, data_dir=tmp_path / "data", factory_root=None, hermes_executable=None,
                    hermes_config=tmp_path / "hermes.json")


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False) as client:
        yield client


def flatten(routes, prefix=""):
    for route in routes:
        if hasattr(route, "original_router"):  # APIRouter incluído (FastAPI recente)
            yield from flatten(route.original_router.routes, prefix + route.include_context.prefix)
        else:
            yield prefix, route


def registered(app):
    """(método, caminho) de todas as rotas; tipos desconhecidos (Mount, WebSocket) falham de propósito."""
    found = []
    for prefix, route in flatten(app.routes):
        if getattr(route, "path", "") in {"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}:
            continue
        assert isinstance(route, APIRoute), f"Rota não-HTTP precisa de revisão de autenticação: {route!r}"
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            found.append((method, prefix + route.path))
    return found


def concrete(path):
    return re.sub(r"\{[^}]+\}", "x", path)


# --- 1. todas as rotas exigem autenticação ---------------------------------------------------------------

def test_route_inventory_is_not_empty_and_public_allowlist_is_exact(app):
    routes = registered(app)
    assert len(routes) > 50
    assert PUBLIC_WITHOUT_BEARER <= set(routes)  # a allowlist não pode apontar para rota inexistente


@pytest.mark.parametrize("headers", [
    {}, {"Authorization": ""}, {"Authorization": "Bearer wrong-token-0123456789abcdef"},
    {"Authorization": TOKEN}, {"Authorization": f"bearer {TOKEN}"}, {"Authorization": f"Bearer {TOKEN} "},
    {"Authorization": f"Basic {TOKEN}"}, {"Authorization": f"Bearer {TOKEN[:-1]}"}, {"Authorization": f"Bearer {TOKEN}x"},
], ids=["no-header", "empty", "wrong", "no-scheme", "lowercase-scheme", "trailing-space", "basic", "prefix", "suffix"])
def test_every_route_rejects_missing_or_wrong_token(client, app, headers):
    failures = []
    for method, path in registered(app):
        response = client.request(method, concrete(path), headers=headers, json={} if method != "GET" else None)
        if response.status_code not in {401, 403}:
            failures.append((method, path, response.status_code))
    assert not failures, f"Rotas acessíveis sem autenticação válida: {failures}"


def test_unknown_paths_and_methods_also_require_authentication(client):
    for method, path in (("GET", "/"), ("GET", "/v1/nao-existe"), ("DELETE", "/health"), ("POST", "/health"),
                         ("GET", "/openapi.json"), ("GET", "/docs"), ("GET", "/redoc"), ("GET", "/v1/../health")):
        assert client.request(method, path).status_code == 401, (method, path)
    # Com token válido a documentação interativa não existe (sem esquema exposto).
    for path in ("/openapi.json", "/docs", "/redoc"):
        assert client.get(path, headers=GOOD).status_code == 404


def test_public_allowlist_routes_still_refuse_without_valid_ticket(client):
    for params in ("", "?expires=9999999999", "?expires=9999999999&ticket=forged", "?ticket=forged"):
        assert client.get(f"/v1/media/abc/stream{params}").status_code in {401, 422}


def test_authenticated_health_and_options_do_not_leak(client):
    assert client.get("/health", headers=GOOD).status_code == 200
    response = client.options("/v1/workflows")  # sem Origin: não executa a rota nem devolve dados
    assert response.status_code in {200, 400, 405} and response.content in {b"", b"Method Not Allowed", b"Disallowed CORS origin"} or response.status_code == 405
    assert "access-control-allow-origin" not in response.headers


def test_responses_are_not_cached(client):
    assert client.get("/health", headers=GOOD).headers["cache-control"] == "no-store"


# --- 2a. comparação do token em tempo constante e entrada hostil -----------------------------------------

def test_token_and_ticket_use_constant_time_comparison(client, monkeypatch):
    calls = []
    real = api_module.secrets.compare_digest

    def spy(left, right):
        calls.append(type(left))
        return real(left, right)
    monkeypatch.setattr(api_module.secrets, "compare_digest", spy)
    assert client.get("/health", headers={"Authorization": "Bearer errado"}).status_code == 401
    assert client.get("/v1/media/x/stream?expires=9999999999&ticket=errado").status_code == 401
    assert len(calls) >= 2
    source = Path(api_module.__file__).read_text(encoding="utf-8")
    assert "== f\"Bearer" not in source and "token ==" not in source


def test_token_shorter_than_24_chars_refuses_to_start(tmp_path):
    with pytest.raises(ValueError):
        create_app(Settings(token="curto", data_dir=tmp_path / "d", factory_root=None, hermes_executable=None,
                            hermes_config=tmp_path / "h.json"))


@pytest.mark.parametrize("raw", ["Bearer caf\xe9".encode("latin-1"), b"Bearer \xff\xfe", b"\x80"])
def test_non_ascii_authorization_is_401_not_a_crash(client, raw):
    response = client.get("/health", headers=[(b"authorization", raw)])
    assert response.status_code == 401


def test_non_ascii_ticket_is_401_not_a_crash(client):
    assert client.get("/v1/media/x/stream?expires=9999999999&ticket=caf%C3%A9").status_code == 401


# --- 2b. Host (DNS rebinding) e Origin/CORS -------------------------------------------------------------------

@pytest.mark.parametrize("host", ["evil.example", "127.0.0.1.evil.example", "localhost.evil.example", "0.0.0.0",
                                  "192.168.0.10", "[::1]", "example.com:8765", "127.0.0.1@evil.example"])
def test_foreign_host_header_is_refused_even_with_valid_token(client, host):
    response = client.get("/health", headers={**GOOD, "Host": host})
    assert response.status_code == 403, (host, response.status_code)
    assert "database_id" not in response.text


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.1:8765", "localhost", "localhost:1420"])
def test_loopback_host_header_is_accepted(client, host):
    assert client.get("/health", headers={**GOOD, "Host": host}).status_code == 200


@pytest.mark.parametrize("origin", ["https://evil.example", "http://127.0.0.1.evil.example:1420", "null",
                                    "http://localhost:9999", "http://127.0.0.1", "file://", "http://tauri.localhost.evil.example"])
def test_foreign_origin_is_refused_with_valid_token_and_in_preflight(client, origin):
    assert client.get("/health", headers={**GOOD, "Origin": origin}).status_code == 403
    preflight = client.options("/v1/workflows", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                                          "Access-Control-Request-Headers": "authorization"})
    assert preflight.status_code == 403
    assert "access-control-allow-origin" not in preflight.headers


@pytest.mark.parametrize("origin", ["http://localhost:1420", "http://127.0.0.1:1420", "http://tauri.localhost", "tauri://localhost"])
def test_allowed_origin_is_echoed_exactly_never_wildcard(client, origin):
    response = client.get("/health", headers={**GOOD, "Origin": origin})
    assert response.status_code == 200 and response.headers["access-control-allow-origin"] == origin
    preflight = client.options("/v1/workflows", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                                          "Access-Control-Request-Headers": "authorization,idempotency-key"})
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin
    assert "*" not in preflight.headers.get("access-control-allow-headers", "")
    assert "PATCH" not in preflight.headers.get("access-control-allow-methods", "")


def test_extra_frontend_origin_must_be_loopback(monkeypatch):
    for value in ("http://evil.example:1420", "https://127.0.0.1:1420", "http://127.0.0.1", "http://0.0.0.0:1420",
                  "http://127.0.0.1:99999", "http://127.0.0.1:1420/path", "*"):
        monkeypatch.setenv("HORUS_FRONTEND_ORIGIN", value)
        with pytest.raises(ValueError):
            frontend_origins()
    monkeypatch.setenv("HORUS_FRONTEND_ORIGIN", "http://localhost:5173")
    assert "http://localhost:5173" in frontend_origins()
    assert all(re.search(r"(127\.0\.0\.1|localhost|tauri)", origin) for origin in frontend_origins())


# --- 2c. bind somente em loopback ----------------------------------------------------------------------------

def test_server_binds_only_loopback_statically():
    source = (Path(api_module.__file__).parent / "__main__.py").read_text(encoding="utf-8")
    assert 'listener.bind(("127.0.0.1"' in source and 'host="127.0.0.1"' in source
    assert "0.0.0.0" not in source and "::" not in source


def test_server_process_listens_on_loopback_only(tmp_path):
    env = {**os.environ, "HORUS_API_TOKEN": TOKEN, "HORUS_DATA_DIR": str(tmp_path / "data"),
           "PYTHONPATH": str(Path(api_module.__file__).parents[1]) + os.pathsep + os.environ.get("PYTHONPATH", "")}
    process = subprocess.Popen([sys.executable, "-m", "horus_backend", "--port", "0"], env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, text=True)
    try:
        line = process.stdout.readline()
        port = json.loads(line)["port"]
        with socket.create_connection(("127.0.0.1", port), timeout=3):
            pass
        local = {info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)} - {"127.0.0.1"}
        for address in local:  # endereços de LAN/VPN deste computador não podem aceitar conexão
            with pytest.raises(OSError):
                socket.create_connection((address, port), timeout=2).close()
    finally:
        process.kill()
        process.wait(5)


# --- 2d. tamanho do corpo -----------------------------------------------------------------------------------

def test_unauthenticated_large_body_is_rejected_before_processing(client):
    response = client.post("/v1/workflows", content=b"{" + b"a" * (8 * 1024 * 1024), headers={"Content-Type": "application/json"})
    assert response.status_code == 401


def test_oversized_json_body_is_rejected_with_valid_token(client):
    big = json.dumps({"objective": "x" * (40 * 1024 * 1024)})
    response = client.post("/v1/workflows", content=big, headers={**GOOD, "Content-Type": "application/json",
                                                                    "Idempotency-Key": "grande"})
    assert response.status_code in {413, 422}, response.status_code


# --- 3. mídia e arquivos servidos -----------------------------------------------------------------------------

def ticket(settings, media_id, expires):
    import hashlib
    import hmac
    return hmac.new(settings.token.encode(), f"{media_id}:{expires}".encode(), hashlib.sha256).hexdigest()


def register_media(client, path):
    response = client.post("/v1/media", headers=GOOD, json={"path": str(path)})
    assert response.status_code == 200, response.text
    return response.json()


def test_media_stream_ticket_is_bound_to_id_and_expiry(client, settings, tmp_path):
    media = tmp_path / "clip.mp4"
    media.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"0" * 100)
    item = register_media(client, media)
    assert client.get(item["stream_path"]).status_code == 200  # sem Bearer, com ticket válido
    other = tmp_path / "other.mp4"
    other.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"1" * 100)
    item2 = register_media(client, other)
    mine = re.search(r"ticket=([0-9a-f]+)", item["stream_path"])[1]
    assert client.get(f"/v1/media/{item2['id']}/stream?expires=9999999999&ticket={mine}").status_code == 401
    expired = int(time.time()) - 10
    assert client.get(f"/v1/media/{item['id']}/stream?expires={expired}&ticket={ticket(settings, item['id'], expired)}").status_code == 401
    assert client.get(f"/v1/media/{item['id']}/stream?expires=9999999999&ticket={mine}").status_code == 401  # expires alterado


@pytest.mark.parametrize("media_id", ["..", "..%2f..%2fetc%2fpasswd", "%2e%2e%2f", "....//", "C:%5CWindows%5Cwin.ini", "a%00b"])
def test_media_id_traversal_never_reads_a_file(client, settings, media_id):
    expires = int(time.time()) + 600
    response = client.get(f"/v1/media/{media_id}/stream?expires={expires}&ticket={ticket(settings, media_id, expires)}")
    assert response.status_code in {401, 404, 422} and b"root:" not in response.content and b"[fonts]" not in response.content


def test_media_registration_refuses_non_media_and_symlinks_to_it(client, tmp_path):
    secret = tmp_path / "segredo.txt"
    secret.write_text("conteudo privado", encoding="utf-8")
    assert client.post("/v1/media", headers=GOOD, json={"path": str(secret)}).status_code == 400
    link = tmp_path / "video.mp4"
    try:
        link.symlink_to(secret)
    except OSError:
        pytest.skip("symlink indisponível neste ambiente")
    response = client.post("/v1/media", headers=GOOD, json={"path": str(link)})
    assert response.status_code == 400  # o destino resolvido (.txt) é recusado
    assert client.post("/v1/media", headers=GOOD, json={"path": str(tmp_path / "ausente.mp4")}).status_code == 400
    assert client.post("/v1/media", headers=GOOD, json={"path": str(tmp_path)}).status_code == 400


def test_media_folder_skips_symlinks_and_subfolders(client, tmp_path):
    folder = tmp_path / "pasta"
    folder.mkdir()
    real = folder / "ok.mp4"
    real.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    outside = tmp_path / "fora.mp4"
    outside.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    (folder / "sub").mkdir()
    (folder / "sub" / "nested.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")
    try:
        (folder / "link.mp4").symlink_to(outside)
    except OSError:
        pytest.skip("symlink indisponível neste ambiente")
    names = {item["name"] for item in client.post("/v1/media/folder", headers=GOOD, json={"path": str(folder)}).json()}
    assert names == {"ok.mp4"}


def test_media_stream_refuses_file_swapped_for_symlink(client, tmp_path):
    media = tmp_path / "clip.mp4"
    media.write_bytes(b"\x00\x00\x00\x18ftypmp42" + b"0" * 64)
    secret = tmp_path / "segredo.bin"
    secret.write_bytes(media.read_bytes())  # mesmo tamanho: a verificação de tamanho/mtime sozinha não basta
    os.utime(secret, ns=(media.stat().st_atime_ns, media.stat().st_mtime_ns))
    item = register_media(client, media)
    media.unlink()
    try:
        media.symlink_to(secret)
    except OSError:
        pytest.skip("symlink indisponível neste ambiente")
    assert client.get(item["stream_path"]).status_code in {404, 409}


@pytest.mark.parametrize("relative", ["../fora.json", "a/../../fora.json", "/abs.json", "C:/x.json", "a\\b.json", "./a.json", "", "a/./b.json"])
def test_production_artifact_paths_are_confined(tmp_path, relative):
    from horus_backend.production import confined
    from horus_backend.workflows import WorkflowConflict
    root = tmp_path / "producao"
    root.mkdir()
    (tmp_path / "fora.json").write_text("{}", encoding="utf-8")
    with pytest.raises(WorkflowConflict):
        confined(root, relative)


def test_production_artifact_symlink_and_link_directory_are_refused(tmp_path):
    from horus_backend.production import confined
    from horus_backend.workflows import WorkflowConflict
    root = tmp_path / "producao"
    (root / "dir").mkdir(parents=True)
    outside = tmp_path / "fora"
    outside.mkdir()
    (outside / "segredo.json").write_text("{}", encoding="utf-8")
    try:
        (root / "link.json").symlink_to(outside / "segredo.json")
        (root / "linkdir").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlink indisponível neste ambiente")
    for relative in ("link.json", "linkdir/segredo.json"):
        with pytest.raises(WorkflowConflict):
            confined(root, relative)
    (root / "dir" / "ok.json").write_text("{}", encoding="utf-8")
    assert confined(root, "dir/ok.json").name == "ok.json"


def test_narration_preview_is_authenticated_and_unknown_id_is_404(client):
    assert client.get("/v1/narration/previews/abc").status_code == 401
    assert client.get("/v1/narration/previews/..%2f..%2fx", headers=GOOD).status_code == 404


def test_media_stream_refuses_symlink_even_when_symlinks_cannot_be_created(client, tmp_path, monkeypatch):
    media = tmp_path / "clip.mp4"
    media.write_bytes(b"\x00\x00\x00ftypmp42" + b"0" * 64)
    item = register_media(client, media)
    assert client.get(item["stream_path"]).status_code == 200
    real = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda self: True if self.name == "clip.mp4" else real(self))
    assert client.get(item["stream_path"]).status_code == 409
