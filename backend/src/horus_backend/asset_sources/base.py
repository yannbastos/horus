"""Tipos e interfaces das fontes de assets (HOR-055). Nada aqui abre rede, lê chave ou baixa arquivo."""
from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping, Protocol
from urllib.parse import parse_qsl, urlsplit

# Controles ASCII e C1, separadores de linha Unicode e marcas de direção bidirecional.
_CONTROL = re.compile("[\x00-\x1f\x7f-\x9f  ‪-‮⁦-⁩]")
# Parâmetros que carregam credencial; nunca aceitos em URL de candidato (ex.: Pixabay usa `?key=`).
_SECRET_PARAMS = {"key", "api_key", "apikey", "token", "access_token", "auth", "authorization", "secret", "password"}


class AssetSourceError(ValueError):
    """Falha de validação/obtenção; `code` é estável para testes e relatórios."""

    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


def check_url(url: Any, host: str, what: str) -> str:
    """https, sem credenciais (userinfo ou parâmetro), sem espaço/controle, host oficial ou subdomínio dele."""
    if not isinstance(url, str) or not url or len(url) > 2000:
        raise AssetSourceError("invalid_url", f"{what}: URL ausente ou longa demais.")
    if _CONTROL.search(url) or any(ch.isspace() for ch in url):
        raise AssetSourceError("invalid_url", f"{what}: URL com espaço ou controle.")
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
        query = parse_qsl(parts.query, keep_blank_values=True)
    except ValueError as error:
        raise AssetSourceError("invalid_url", f"{what}: URL inválida.") from error
    if parts.scheme != "https":
        raise AssetSourceError("insecure_url", f"{what}: a URL deve ser https.")
    if parts.username or parts.password:
        raise AssetSourceError("credential_in_url", f"{what}: credencial na URL.")
    if any(name.lower() in _SECRET_PARAMS for name, _ in query):
        raise AssetSourceError("credential_in_url", f"{what}: parâmetro de credencial na URL.")
    if not hostname or (hostname != host and not hostname.endswith("." + host)):
        raise AssetSourceError("host_not_official", f"{what}: a URL deve pertencer a {host}.")
    return url


def check_url_https(url: Any, what: str) -> str:
    """URL https sem credenciais, em qualquer host (licença/origem declaradas pelo usuário)."""
    host = urlsplit(url).hostname if isinstance(url, str) else None
    return check_url(url, host or "invalid.invalid", what)


def iso_utc(moment: datetime) -> str:
    """Data ISO 8601 em UTC com 'Z'; exige datetime com fuso (sem relógio implícito)."""
    if not isinstance(moment, datetime) or moment.tzinfo is None:
        raise AssetSourceError("invalid_date", "data da consulta deve ser datetime com fuso.")
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class AssetCandidate:
    """Candidato a asset com a proveniência declarada pela fonte. Nunca é `verified`: só a revisão humana decide."""
    origin: str                      # stock_pexels | stock_pixabay | licensed_manual
    kind: str                        # image | video | audio | music | voice | font
    source_id: str                   # id na fonte (ou derivado do hash, no local)
    source_url: str                  # página do item
    author: str
    author_url: str | None
    license_id: str
    license_name: str
    license_url: str
    commercial_use: str              # allowed | restricted | unknown (declarado pela fonte, não verificado)
    attribution_required: bool | None
    queried_at: str                  # ISO 8601 UTC
    terms_restrictions: tuple[str, ...] = ()
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None
    download_url: str | None = None  # só informativo: este incremento não baixa nada
    relative_path: str | None = None  # preenchido quando o arquivo existe
    sha256: str | None = None         # preenchido quando o arquivo existe
    size_bytes: int | None = None
    status: str = field(default="unverified", init=False)


@dataclass(frozen=True)
class ParsedResponse:
    candidates: tuple[AssetCandidate, ...]
    rejected: tuple[dict, ...]  # {"index", "code", "message"} por item recusado


@dataclass(frozen=True)
class SourceRequest:
    """Pedido descrito, sem credencial: o gateway de saída (futuro) é quem autentica e envia."""
    source: str
    url: str
    params: Mapping[str, Any]


class SourceTransport(Protocol):
    """Transporte injetado. Este incremento só tem `FixtureTransport`; não existe implementação de rede."""

    def fetch(self, request: SourceRequest) -> Mapping[str, Any]: ...


class FixtureTransport:
    """Devolve respostas JSON pré-gravadas (testes). Nunca acessa rede."""

    def __init__(self, responses: Mapping[str, Mapping[str, Any]]):
        self._responses = dict(responses)
        self.requests: list[SourceRequest] = []

    def fetch(self, request: SourceRequest) -> Mapping[str, Any]:
        self.requests.append(request)
        try:
            return self._responses[request.url]
        except KeyError as error:
            raise AssetSourceError("no_fixture", f"sem fixture para {request.url}.") from error


class AssetSource(ABC):
    """Fonte de assets: busca, metadados e obtenção. A obtenção de arquivo só existe nas fontes locais."""
    origin: str

    @abstractmethod
    def search(self, query: str, *, kind: str, queried_at: datetime) -> ParsedResponse: ...

    @abstractmethod
    def parse_response(self, payload: Mapping[str, Any], *, kind: str, queried_at: datetime) -> ParsedResponse: ...

    @abstractmethod
    def obtain(self, candidate: AssetCandidate, *args: Any, **kwargs: Any) -> AssetCandidate: ...
