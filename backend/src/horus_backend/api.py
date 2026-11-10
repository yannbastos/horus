from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import importlib.util
import json
import os
import secrets
import shutil
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .config import Settings
from .diagnostics import diagnose
from .hermes import HermesConnector
from .jobs import JobManager, JobRequest, TERMINAL
from .storage import Store


class MediaRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1, max_length=4096)


class TranscriptSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1, max_length=4096)
    text: str = Field(max_length=20_000_000)


def create_app(settings: Settings, shutdown=None, ready=None):
    if len(settings.token) < 24:
        raise ValueError("A API exige um token local aleatório de pelo menos 24 caracteres.")
    store = Store(settings.data_dir / "horus.sqlite3")
    manager = JobManager(store, settings)
    hermes = HermesConnector(settings)

    @asynccontextmanager
    async def lifespan(app):
        await manager.start()
        if ready:
            ready()
        try:
            yield
        finally:
            await manager.close()

    app = FastAPI(title="Hórus local", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store, app.state.manager = store, manager
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins), allow_methods=["GET", "POST"],
                       allow_headers=["Authorization", "Content-Type", "Idempotency-Key"])

    @app.middleware("http")
    async def authorize(request: Request, call_next):
        if request.url.hostname not in {"127.0.0.1", "localhost"}:
            return JSONResponse({"detail": "Host não permitido."}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin not in settings.origins:
            return JSONResponse({"detail": "Origem não permitida."}, status_code=403)
        if request.method == "OPTIONS":
            return await call_next(request)
        is_stream = request.url.path.startswith("/v1/media/") and request.url.path.endswith("/stream")
        if not is_stream and not secrets.compare_digest(request.headers.get("authorization", ""), f"Bearer {settings.token}"):
            return JSONResponse({"detail": "Autenticação local necessária."}, status_code=401)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health")
    async def health():
        return {"status": "ready", "factory_available": settings.command() is not None,
                "hermes_connected": hermes.status()["connected"], "version": "0.1.0"}

    @app.get("/v1/hermes")
    async def hermes_status():
        return hermes.status()

    @app.post("/v1/hermes/probe")
    async def probe_hermes():
        return await hermes.probe()

    @app.get("/v1/jobs")
    async def jobs():
        return store.list_jobs()

    @app.get("/v1/diagnostics")
    async def diagnostics():
        return diagnose(settings)

    @app.post("/v1/jobs", status_code=202)
    async def submit(request: JobRequest, idempotency_key: str | None = Header(default=None, max_length=128)):
        try:
            return await manager.submit(request, idempotency_key or secrets.token_hex(16))
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    def require_job(job_id):
        job = store.get_job(job_id)
        if not job:
            raise HTTPException(404, "Tarefa não encontrada.")
        return job

    @app.get("/v1/jobs/{job_id}")
    async def inspect(job_id: str):
        return require_job(job_id)

    @app.post("/v1/jobs/{job_id}/cancel")
    async def cancel(job_id: str):
        require_job(job_id)
        return await manager.cancel(job_id)

    @app.post("/v1/jobs/{job_id}/retry")
    async def retry(job_id: str):
        require_job(job_id)
        try:
            return await manager.retry(job_id)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    @app.get("/v1/jobs/{job_id}/events")
    async def events(job_id: str, request: Request, after: int = 0):
        require_job(job_id)

        async def stream():
            cursor = max(0, after)
            while not await request.is_disconnected():
                async with manager.changed:
                    entries = store.events(job_id, cursor)
                    terminal = require_job(job_id)["status"] in TERMINAL
                    if not entries and not terminal:
                        try:
                            await asyncio.wait_for(manager.changed.wait(), timeout=15)
                        except TimeoutError:
                            pass
                        continue
                for entry in entries:
                    cursor = entry["sequence"]
                    yield json.dumps(entry, ensure_ascii=False) + "\n"
                if terminal and not store.events(job_id, cursor):
                    yield json.dumps({"kind": "complete", "job": require_job(job_id)}, ensure_ascii=False) + "\n"
                    return
        return StreamingResponse(stream(), media_type="application/x-ndjson")

    def media_view(item):
        expires = int(time.time()) + 3600
        signature = hmac.new(settings.token.encode(), f"{item['id']}:{expires}".encode(), hashlib.sha256).hexdigest()
        return {"id": item["id"], "name": item["name"], "size": item["size"],
                "stream_path": f"/v1/media/{item['id']}/stream?expires={expires}&ticket={signature}"}

    @app.get("/v1/media")
    async def list_media():
        return [media_view(item) for item in store.list_media()]

    @app.post("/v1/media")
    async def register(request: MediaRequest):
        try:
            path = Path(request.path).expanduser().resolve(strict=True)
            if not path.is_file() or path.suffix.lower() not in {".mp4", ".webm", ".m4v", ".mov", ".mkv", ".wav", ".mp3", ".ogg"}:
                raise ValueError("Selecione um arquivo audiovisual compatível.")
            return media_view(store.register_media(path))
        except (ValueError, OSError) as error:
            raise HTTPException(400, str(error)) from error

    @app.post("/v1/media/folder")
    async def register_folder(request: MediaRequest):
        try:
            directory = Path(request.path).expanduser().resolve(strict=True)
            if not directory.is_dir():
                raise ValueError("Selecione uma pasta existente.")
            items = []
            # Sem varredura recursiva ou leitura da biblioteca inteira.
            for candidate in directory.iterdir():
                if candidate.is_symlink() or candidate.suffix.lower() not in {".mp4", ".webm", ".m4v", ".mov", ".mkv", ".wav", ".mp3", ".ogg"}:
                    continue
                if candidate.is_file():
                    items.append(media_view(store.register_media(candidate.resolve(strict=True))))
                if len(items) == 100:
                    break
            return items
        except (ValueError, OSError) as error:
            raise HTTPException(400, str(error)) from error

    @app.get("/v1/media/{media_id}/stream")
    async def media_stream(media_id: str, expires: int = 0, ticket: str = ""):
        expected = hmac.new(settings.token.encode(), f"{media_id}:{expires}".encode(), hashlib.sha256).hexdigest()
        if expires < time.time() or not secrets.compare_digest(ticket, expected):
            raise HTTPException(401, "Acesso à mídia expirado. Selecione-a novamente.")
        item = store.media(media_id)
        if not item:
            raise HTTPException(404, "Mídia não encontrada.")
        path = Path(item["path"])
        try:
            stat = path.stat()
        except OSError as error:
            raise HTTPException(404, "Arquivo indisponível. Verifique o armazenamento.") from error
        if stat.st_size != item["size"] or stat.st_mtime_ns != item["modified_ns"]:
            raise HTTPException(409, "O arquivo mudou. Selecione-o novamente antes de reproduzir.")
        return FileResponse(path)

    @app.get("/v1/transcription")
    async def transcription_status():
        # Presença apenas; Whisper e yt-dlp não são importados no processo da API.
        return {"engine": importlib.util.find_spec("faster_whisper") is not None,
                "downloader": importlib.util.find_spec("yt_dlp") is not None or shutil.which("yt-dlp") is not None,
                "ffmpeg": shutil.which("ffmpeg") is not None}

    @app.post("/v1/transcriptions/save")
    async def save_transcript(request: TranscriptSave):
        # O caminho vem do diálogo nativo de salvar; somente .txt em pasta existente.
        path = Path(request.path).expanduser()
        if path.suffix.lower() != ".txt":
            raise HTTPException(400, "Salve a transcrição como arquivo .txt.")
        if not path.parent.is_dir() or path.is_dir():
            raise HTTPException(400, "Pasta de destino inválida.")
        temporary = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=path.parent,
                                             prefix=".horus-", suffix=".tmp", delete=False) as handle:
                temporary = handle.name
                handle.write(request.text)
            os.replace(temporary, path)
        except OSError as error:
            if temporary:
                with contextlib.suppress(OSError):
                    os.remove(temporary)
            raise HTTPException(400, f"Não foi possível salvar: {error.strerror or error}") from error
        return {"path": str(path.resolve())}

    @app.post("/v1/shutdown")
    async def stop():
        if not shutdown:
            raise HTTPException(409, "Encerramento gerenciado não disponível nesta execução.")
        asyncio.get_running_loop().call_later(0.1, shutdown)
        return {"status": "stopping"}

    return app
