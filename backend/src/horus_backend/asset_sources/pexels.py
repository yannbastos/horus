"""Adaptador Pexels: converte respostas JSON já obtidas (formato público da API v1) em candidatos.

Termos consultados em 2026-11-13 (https://www.pexels.com/license/): uso gratuito e edição permitidos; atribuição
opcional; proibido vender cópias sem alteração, redistribuir em outras plataformas de stock, usar como marca/nome
comercial ou sugerir endosso de pessoas/marcas; pessoas identificáveis não podem aparecer de modo ofensivo.
Os termos não permitem afirmar `allowed` para um arquivo específico (pessoas, marcas): `commercial_use="unknown"`.
"""
from __future__ import annotations

from typing import Any, Mapping

from .base import AssetCandidate, AssetSourceError, SourceRequest, check_url
from .stock import StockSource, integer, item_id, text

HOST = "pexels.com"
API_BASE = "https://api.pexels.com"  # documentação: nunca acessado aqui
TERMS_URL = "https://www.pexels.com/license/"
TERMS_CONSULTED_ON = "2026-11-13"
RESTRICTIONS = (
    "Não vender cópias sem alteração nem redistribuí-las em outras plataformas de stock.",
    "Não sugerir endosso de pessoas ou marcas; pessoas identificáveis não podem aparecer de modo ofensivo.",
    "Não usar como marca, nome comercial ou marca de serviço.",
    "Atribuição opcional (apreciada); uso comercial por asset depende de pessoas/marcas visíveis: revisão humana.",
)


class PexelsSource(StockSource):
    origin = "stock_pexels"

    def _request(self, query: str, kind: str) -> SourceRequest:
        path = "/v1/search" if kind == "image" else "/videos/search"
        return SourceRequest("pexels", API_BASE + path, {"query": query, "per_page": 15})

    def _items(self, payload: Mapping[str, Any], kind: str) -> list:
        items = payload.get("photos" if kind == "image" else "videos")
        if not isinstance(items, list):
            raise AssetSourceError("invalid_response", "lista de resultados ausente.")
        return items

    def _candidate(self, item: Mapping[str, Any], kind: str, queried_at: str) -> AssetCandidate:
        identifier = item_id(item)
        source_url = check_url(item.get("url"), HOST, "url da página")
        duration = None
        if kind == "image":
            author, author_url = text(item, "photographer", "author"), item.get("photographer_url")
            src = item.get("src")
            download = check_url(src.get("original") if isinstance(src, Mapping) else None, HOST, "src.original")
        else:
            user = item.get("user")
            if not isinstance(user, Mapping):
                raise AssetSourceError("missing_author", "campo 'user' ausente.")
            author, author_url = text(user, "name", "author"), user.get("url")
            files = [f for f in (item.get("video_files") or []) if isinstance(f, Mapping)]
            best = max(files, key=lambda f: integer(f, "width") or 0, default=None)
            download = check_url(best.get("link") if best else None, HOST, "video_files.link")
            if isinstance(item.get("duration"), (int, float)) and item["duration"] > 0:
                duration = float(item["duration"])
        return AssetCandidate(
            origin=self.origin, kind=kind, source_id=identifier, source_url=source_url, author=author,
            author_url=check_url(author_url, HOST, "url do autor") if author_url else None,
            license_id="pexels-license", license_name="Pexels License", license_url=TERMS_URL,
            commercial_use="unknown", attribution_required=None, queried_at=queried_at,
            terms_restrictions=RESTRICTIONS, width=integer(item, "width"), height=integer(item, "height"),
            duration_seconds=duration, download_url=download)
