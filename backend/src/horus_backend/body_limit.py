"""Teto de tamanho de corpo (ASGI puro): recusa com 413 sem ler o corpo inteiro.

Conta bytes reais em streaming (inclusive `Transfer-Encoding: chunked`) e também confere o `Content-Length`;
um cabeçalho mentiroso não ajuda. Ao estourar, o corpo restante é descartado (o aplicativo vê uma desconexão) e a
resposta do aplicativo é substituída por 413, de modo que nenhum manipulador age sobre um corpo incompleto.
"""
from __future__ import annotations

import json

MIB = 1024 * 1024
DEFAULT_LIMIT = 2 * MIB
# Tetos maiores, só onde o modelo de dados já admite texto grande:
#  - salvar transcrição: `TranscriptSave.text` aceita até 20.000.000 caracteres (até ~3 bytes UTF-8 cada) -> 64 MiB;
#  - narração: `text` aceita até 1.000.000 caracteres -> 4 MiB.
ROUTE_LIMITS = (("/v1/transcriptions/save", 64 * MIB), ("/v1/narration/", 4 * MIB))


def limit_for(path: str, default: int = DEFAULT_LIMIT, overrides=ROUTE_LIMITS) -> int:
    for prefix, limit in overrides:
        if path == prefix or (prefix.endswith("/") and path.startswith(prefix)):
            return limit
    return default


def _message(limit: int) -> bytes:
    shown = f"{limit // MIB} MB" if limit >= MIB else f"{limit} bytes"
    return json.dumps({"detail": f"Corpo da requisição acima do limite de {shown} para esta rota."}, ensure_ascii=False).encode()


class BodyLimitMiddleware:
    def __init__(self, app, default: int = DEFAULT_LIMIT, overrides=ROUTE_LIMITS):
        self.app, self.default, self.overrides = app, default, overrides

    async def _reject(self, send, limit):
        body = _message(limit)
        await send({"type": "http.response.start", "status": 413, "headers": [
            (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"connection", b"close")]})
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = limit_for(scope.get("path", ""), self.default, self.overrides)
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > limit:
                    return await self._reject(send, limit)
            except ValueError:
                pass  # cabeçalho inválido: o servidor HTTP o recusa; a contagem real continua valendo
        state = {"seen": 0, "exceeded": False, "answered": False}

        async def counted_receive():
            if state["exceeded"]:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                state["seen"] += len(message.get("body", b""))
                if state["seen"] > limit:
                    state["exceeded"] = True
                    return {"type": "http.disconnect"}  # nada além do teto chega ao aplicativo
            return message

        async def guarded_send(message):
            if state["exceeded"]:
                if not state["answered"]:
                    state["answered"] = True
                    await self._reject(send, limit)
                return  # descarta a resposta do aplicativo (ex.: 422 de corpo truncado)
            await send(message)

        await self.app(scope, counted_receive, guarded_send)
        if state["exceeded"] and not state["answered"]:
            await self._reject(send, limit)
