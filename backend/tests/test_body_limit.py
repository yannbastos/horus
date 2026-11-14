"""HOR-127: teto de corpo (413) por Content-Length E por contagem real de bytes, inclusive chunked."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from horus_backend.api import create_app
from horus_backend.body_limit import BodyLimitMiddleware, DEFAULT_LIMIT, MIB, limit_for
from horus_backend.config import Settings

TOKEN = "body-limit-tests-token-0123456789"
GOOD = {"Authorization": f"Bearer {TOKEN}"}
JSON = {"Content-Type": "application/json"}


@pytest.fixture
def client(tmp_path):
    settings = Settings(token=TOKEN, data_dir=tmp_path / "data", factory_root=None, hermes_executable=None,
                        hermes_config=tmp_path / "hermes.json")
    with TestClient(create_app(settings), base_url="http://127.0.0.1", headers=GOOD, raise_server_exceptions=False) as client:
        yield client


def workflows(client):
    with client.app.state.store.connect() as db:
        return db.execute("SELECT COUNT(*) FROM workflows").fetchone()[0]


def big_json(size):
    return json.dumps({"objective": "x" * size}).encode()


def test_limit_lookup_defaults_and_documented_overrides():
    assert DEFAULT_LIMIT == 2 * MIB
    assert limit_for("/v1/workflows") == DEFAULT_LIMIT and limit_for("/v1/jobs/abc") == DEFAULT_LIMIT
    assert limit_for("/v1/transcriptions/save") == 64 * MIB
    assert limit_for("/v1/transcriptions/save/extra") == DEFAULT_LIMIT  # exato, sem prefixo implícito
    assert limit_for("/v1/narration/preview") == 4 * MIB and limit_for("/v1/narrationx") == DEFAULT_LIMIT


def test_body_below_ceiling_is_processed_normally(client):
    response = client.post("/v1/workflows", content=big_json(1000), headers={**JSON, "Idempotency-Key": "ok"})
    assert response.status_code != 413


def test_content_length_above_ceiling_is_413_in_portuguese_and_handler_never_runs(client):
    before = workflows(client)
    response = client.post("/v1/workflows", content=big_json(3 * MIB), headers={**JSON, "Idempotency-Key": "grande"})
    assert response.status_code == 413
    assert response.json() == {"detail": "Corpo da requisição acima do limite de 2 MB para esta rota."}
    assert workflows(client) == before


def test_chunked_body_without_content_length_is_counted_and_stops_early(client):
    sent = {"chunks": 0}
    total_chunks = 200  # 200 x 64 KiB = 12,5 MiB

    def stream():
        yield b'{"objective": "'
        for _ in range(total_chunks):
            sent["chunks"] += 1
            yield b"a" * 65536
        yield b'"}'
    before = workflows(client)
    response = client.post("/v1/workflows", content=stream(), headers={**JSON, "Idempotency-Key": "chunked"})
    assert response.status_code == 413 and "limite de 2 MB" in response.json()["detail"]
    assert workflows(client) == before


def asgi_call(app, path, chunks, headers):
    """Chama o ASGI direto, com cabeçalhos escolhidos (permite Content-Length mentiroso)."""
    messages = []
    queue = [{"type": "http.request", "body": chunk, "more_body": index < len(chunks) - 1} for index, chunk in enumerate(chunks)]

    async def receive():
        return queue.pop(0) if queue else {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    scope = {"type": "http", "method": "POST", "path": path, "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
             "query_string": b"", "http_version": "1.1", "scheme": "http", "server": ("127.0.0.1", 8765), "client": ("127.0.0.1", 1)}
    asyncio.run(app(scope, receive, send))
    return messages


def test_lying_content_length_does_not_bypass_the_ceiling():
    reached = {"body": 0}

    async def inner(scope, receive, send):
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break
            reached["body"] += len(message["body"])
            if not message["more_body"]:
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})
    app = BodyLimitMiddleware(inner, default=1000)
    chunks = [b"a" * 600, b"b" * 600, b"c" * 600]
    messages = asgi_call(app, "/x", chunks, {"content-length": "10"})  # declara 10, envia 1800
    assert messages[0]["status"] == 413 and len([m for m in messages if m["type"] == "http.response.start"]) == 1
    assert reached["body"] <= 600  # nada além do teto chegou ao aplicativo
    assert asgi_call(app, "/x", [b"a" * 1000], {"content-length": "1000"})[0]["status"] == 200  # honesto, no teto
    reached["body"] = 0
    assert asgi_call(app, "/x", [b"a" * 10], {"content-length": "5000"})[0]["status"] == 413 and reached["body"] == 0
    assert asgi_call(app, "/x", [b"a"], {"content-length": "abc"})[0]["status"] == 200  # inválido: vale a contagem real


def test_route_with_larger_ceiling_accepts_up_to_its_limit(client, tmp_path):
    destination = tmp_path / "saida.txt"
    body = json.dumps({"path": str(destination), "text": "a" * (5 * MIB)}).encode()  # acima dos 2 MiB padrão
    response = client.post("/v1/transcriptions/save", content=body, headers=JSON)
    assert response.status_code == 200, response.text
    assert destination.stat().st_size == 5 * MIB

    def stream():
        yield b'{"path": "x.txt", "text": "'
        for _ in range(66):  # acima de 64 MiB
            yield b"a" * MIB
        yield b'"}'
    assert client.post("/v1/transcriptions/save", content=stream(), headers=JSON).status_code == 413


def test_narration_routes_have_their_own_ceiling(client):
    ok = client.post("/v1/narration/preview", content=b'{"x":"' + b"a" * (3 * MIB) + b'"}', headers=JSON)
    assert ok.status_code != 413  # 3 MiB cabe no teto de 4 MiB (a rota responde por outras regras)
    too_big = client.post("/v1/narration/preview", content=b'{"x":"' + b"a" * (5 * MIB) + b'"}', headers=JSON)
    assert too_big.status_code == 413 and "limite de 4 MB" in too_big.json()["detail"]


def test_unauthenticated_oversized_body_is_still_401_and_not_read(client):
    response = client.post("/v1/workflows", content=big_json(3 * MIB),
                           headers={"Content-Type": "application/json", "Authorization": "Bearer errado"})
    assert response.status_code == 401


def test_get_unaffected_and_app_stays_healthy_after_a_rejection(client):
    assert client.get("/health").status_code == 200
    response = client.post("/v1/workflows", content=big_json(3 * MIB), headers={**JSON, "Idempotency-Key": "k"})
    assert response.status_code == 413
    assert client.get("/health").status_code == 200
