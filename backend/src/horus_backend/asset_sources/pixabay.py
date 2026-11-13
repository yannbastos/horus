"""Adaptador Pixabay: converte respostas JSON já obtidas (formato público da API) em candidatos.

Termos consultados em 2026-11-13 (https://pixabay.com/service/license-summary/): uso gratuito, sem atribuição
obrigatória, edição permitida; proibido vender/distribuir o conteúdo sem alteração (standalone), usá-lo como marca,
uso enganoso e uso comercial de conteúdo com marcas/logotipos; pessoas reconhecíveis não podem ser usadas de forma
ilegal ou imoral; consentimento de terceiros é responsabilidade de quem usa. Só a Licença de Conteúdo completa tem
valor jurídico. Content ID e limites de API não constam do resumo: `commercial_use="unknown"`.
"""
from __future__ import annotations

from typing import Any, Mapping

from .base import AssetCandidate, AssetSourceError, SourceRequest, check_url
from .stock import StockSource, integer, item_id, text

HOST = "pixabay.com"
API_BASE = "https://pixabay.com/api"  # documentação: nunca acessado aqui; a chave seria injetada pelo gateway
TERMS_URL = "https://pixabay.com/service/license-summary/"
TERMS_CONSULTED_ON = "2026-11-13"
RESTRICTIONS = (
    "Não vender nem distribuir o conteúdo sem alteração (standalone).",
    "Conteúdo com marcas, logotipos ou marcas registradas não pode ser usado comercialmente.",
    "Pessoas reconhecíveis: uso imoral/ilegal proibido; consentimento de terceiros é responsabilidade do usuário.",
    "Proibido uso enganoso ou como marca/nome comercial; só a licença completa tem valor jurídico.",
)


class PixabaySource(StockSource):
    origin = "stock_pixabay"

    def _request(self, query: str, kind: str) -> SourceRequest:
        url = API_BASE + ("/" if kind == "image" else "/videos/")
        return SourceRequest("pixabay", url, {"q": query, "per_page": 20})

    def _items(self, payload: Mapping[str, Any], kind: str) -> list:
        items = payload.get("hits")
        if not isinstance(items, list):
            raise AssetSourceError("invalid_response", "lista 'hits' ausente.")
        return items

    def _candidate(self, item: Mapping[str, Any], kind: str, queried_at: str) -> AssetCandidate:
        identifier = item_id(item)
        source_url = check_url(item.get("pageURL"), HOST, "pageURL")
        author = text(item, "user", "author")
        user_id = item.get("user_id")
        author_url = None
        if isinstance(user_id, int) and not isinstance(user_id, bool) and user_id > 0:
            slug = "".join(ch for ch in author if ch.isascii() and (ch.isalnum() or ch in "-_")) or "user"
            author_url = check_url(f"https://pixabay.com/users/{slug}-{user_id}/", HOST, "url do autor")
        duration = None
        if kind == "image":
            download = check_url(item.get("largeImageURL"), HOST, "largeImageURL")
            width, height = integer(item, "imageWidth"), integer(item, "imageHeight")
        else:
            videos = item.get("videos")
            sizes = [v for v in (videos.values() if isinstance(videos, Mapping) else []) if isinstance(v, Mapping)]
            best = max(sizes, key=lambda v: integer(v, "width") or 0, default=None)
            download = check_url(best.get("url") if best else None, HOST, "videos.*.url")
            width, height = integer(best, "width"), integer(best, "height")
            if isinstance(item.get("duration"), (int, float)) and item["duration"] > 0:
                duration = float(item["duration"])
        return AssetCandidate(
            origin=self.origin, kind=kind, source_id=identifier, source_url=source_url, author=author,
            author_url=author_url, license_id="pixabay-content-license", license_name="Pixabay Content License",
            license_url=TERMS_URL, commercial_use="unknown", attribution_required=None, queried_at=queried_at,
            terms_restrictions=RESTRICTIONS, width=width, height=height, duration_seconds=duration,
            download_url=download)
