"""Base comum das fontes de stock (Pexels, Pixabay): só convertem respostas já obtidas, sem rede."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Mapping

from .base import (AssetCandidate, AssetSource, AssetSourceError, ParsedResponse, SourceRequest, SourceTransport,
                   iso_utc)


class StockSource(AssetSource):
    """Subclasses definem `origin`, `_request`, `_items` e `_candidate`. O transporte é injetado e opcional."""

    def __init__(self, transport: SourceTransport | None = None):
        self._transport = transport

    def _request(self, query: str, kind: str) -> SourceRequest:
        raise NotImplementedError

    def _items(self, payload: Mapping[str, Any], kind: str) -> list:
        raise NotImplementedError

    def _candidate(self, item: Mapping[str, Any], kind: str, queried_at: str) -> AssetCandidate:
        raise NotImplementedError

    def search(self, query: str, *, kind: str, queried_at: datetime) -> ParsedResponse:
        if self._transport is None:
            raise AssetSourceError("no_transport", "nenhum transporte configurado; não há implementação de rede neste incremento.")
        if not isinstance(query, str) or not query.strip() or len(query) > 200:
            raise AssetSourceError("invalid_query", "consulta vazia ou longa demais.")
        if kind not in ("image", "video"):
            raise AssetSourceError("unsupported_kind", "a fonte oferece apenas image e video.")
        payload = self._transport.fetch(self._request(query.strip(), kind))
        return self.parse_response(payload, kind=kind, queried_at=queried_at)

    def parse_response(self, payload: Mapping[str, Any], *, kind: str, queried_at: datetime) -> ParsedResponse:
        if kind not in ("image", "video"):
            raise AssetSourceError("unsupported_kind", "a fonte oferece apenas image e video.")
        stamp = iso_utc(queried_at)
        if not isinstance(payload, Mapping):
            raise AssetSourceError("invalid_response", "a resposta deve ser um objeto JSON.")
        candidates: list[AssetCandidate] = []
        rejected: list[dict] = []
        for index, item in enumerate(self._items(payload, kind)):
            try:
                if not isinstance(item, Mapping):
                    raise AssetSourceError("invalid_item", "item não é objeto.")
                candidates.append(self._candidate(item, kind, stamp))
            except AssetSourceError as error:
                rejected.append({"index": index, "code": error.code, "message": str(error)})
        return ParsedResponse(tuple(candidates), tuple(rejected))

    def obtain(self, candidate: AssetCandidate, *args: Any, **kwargs: Any) -> AssetCandidate:
        raise AssetSourceError("download_not_enabled",
                               "download de fontes externas não está habilitado: exige autorização do usuário, chave e gateway de saída.")


def text(item: Mapping[str, Any], key: str, what: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise AssetSourceError("missing_" + what, f"campo '{key}' ausente ou vazio.")
    return value.strip()[:300]


def integer(item: Mapping[str, Any] | None, key: str) -> int | None:
    value = item.get(key) if item else None
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def item_id(item: Mapping[str, Any]) -> str:
    value = item.get("id")
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise AssetSourceError("missing_id", "campo 'id' ausente ou inválido.")
    return str(value)
