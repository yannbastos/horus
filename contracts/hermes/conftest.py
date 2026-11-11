import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))  # servidor simulado
# Contrato oficial vive no backend (empacotado com ele); os testes daqui o exercitam.
sys.path.insert(0, str(ROOT.parent.parent / 'backend' / 'src'))

from fake_server import FakeHermes  # noqa: E402
from horus_backend.hermes_contract.models import RunEnvelope  # noqa: E402

FIXTURES = ROOT / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def envelope() -> RunEnvelope:
    return RunEnvelope.model_validate(load("envelope-ficticio.json"))


@pytest.fixture
def valid_result() -> dict:
    return load("resultado-valido.json")


@pytest.fixture
def hermes():
    with FakeHermes() as server:
        yield server


class Http:
    """Cliente mínimo (urllib) para os testes; nunca sai de 127.0.0.1."""

    def __init__(self, server: FakeHermes, token: str | None = None):
        self.base, self.token = server.base_url, token if token is not None else server.token

    def call(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                raw = response.read().decode()
                content = json.loads(raw) if response.headers.get_content_type() == "application/json" else raw
                return response.status, dict(response.headers), content
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), json.loads(error.read().decode())


@pytest.fixture
def http(hermes):
    return Http(hermes)
