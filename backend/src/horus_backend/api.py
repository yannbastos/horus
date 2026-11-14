from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .narration.service import NarrationService, narration_router
from .config import Settings
from .diagnostics import diagnose
from .dependencies import transcription_capabilities
from .hermes import HermesConnector
from .license_reviews import LicenseReviewRequest, LicenseReviewService
from .jobs import RETENTION_INTERVAL_SECONDS, JobManager, JobRequest, TERMINAL
from .radar_youtube.state import RadarState
from .radar_workflow import RadarWorkflowRequest, adapt, demo, eligibility, summary
from .security import SecurityGate, require_secure, security_status
from .production import ProductionRequest, ProductionReviewRequest
from .scripts import ManualScriptRequest, ScriptRequest, ScriptReviewRequest, ScriptService, ScriptVersionRequest
from .storage import Store
from .workflows import AuthorizationRequest, ReviewRequest, RevisionRequest, WorkflowConflict, WorkflowRequest

STREAM_KEEPALIVE_SECONDS = 10


class MediaRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1, max_length=4096)


class TranscriptSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1, max_length=4096)
    text: str = Field(max_length=20_000_000)


LOOPBACK_HOST = re.compile(r"(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?")


def create_app(settings: Settings, shutdown=None, ready=None):
    if len(settings.token) < 24:
        raise ValueError("A API exige um token local aleatório de pelo menos 24 caracteres.")
    store = Store(settings.data_dir / "horus.sqlite3")
    if settings.radar_executor not in {"hermes_simulated", "hermes"}:
        raise ValueError("HORUS_RADAR_EXECUTOR inválido. Use hermes_simulated ou hermes.")
    radar_state = RadarState(settings.data_dir / "radar" / "radar-youtube.sqlite3")
    manager = JobManager(store, settings)
    hermes = HermesConnector(settings)
    scripts = ScriptService(store)
    license_reviews = LicenseReviewService(store, settings.data_dir)
    narration = NarrationService(settings, store)

    @asynccontextmanager
    async def lifespan(app):
        await manager.start()
        if ready:
            ready()
        try:
            yield
        finally:
            narration.close()
            await manager.close()

    app = FastAPI(title="Hórus local", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(narration_router(narration))
    app.state.narration = narration
    app.state.radar = radar_state
    app.state.store, app.state.manager = store, manager
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins), allow_methods=["GET", "POST", "PUT", "DELETE"],
                       allow_headers=["Authorization", "Content-Type", "Idempotency-Key"])

    @app.exception_handler(RequestValidationError)
    async def invalid_payload(request: Request, error: RequestValidationError):
        # Pydantic inclui input_value: roteiro/feedback privados não devem voltar no erro.
        if request.url.path.startswith(("/v1/scripts/", "/v1/productions/", "/v1/narration/")) or request.url.path.endswith("/scripts"):
            return JSONResponse({"detail": "Pedido de roteiro inválido."}, status_code=422)
        return await request_validation_exception_handler(request, error)

    @app.middleware("http")
    async def authorize(request: Request, call_next):
        host = request.headers.get("host")
        if (not LOOPBACK_HOST.fullmatch(host) if host is not None else request.url.hostname not in {"127.0.0.1", "localhost"}):
            return JSONResponse({"detail": "Host não permitido."}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin not in settings.origins:
            return JSONResponse({"detail": "Origem não permitida."}, status_code=403)
        if request.method == "OPTIONS":
            return await call_next(request)
        is_stream = request.url.path.startswith("/v1/media/") and request.url.path.endswith("/stream")
        if not is_stream and not secrets.compare_digest(request.headers.get("authorization", "").encode("utf-8", "replace"),
                                                         f"Bearer {settings.token}".encode()):
            return JSONResponse({"detail": "Autenticação local necessária."}, status_code=401)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health")
    async def health():
        return {"status": "ready", "database_id": store.database_id, "factory_available": settings.command() is not None,
                "hermes_connected": hermes.status()["connected"], "version": "0.1.0"}

    @app.get("/v1/security/status")
    async def inspect_security():
        report = security_status(settings, store)
        # A limpeza automática roda no JobManager (início + a cada 6 h); o estado vem do último ciclo real.
        report["radar"]["automatic_cleanup"] = {"available": True, "interval_hours": RETENTION_INTERVAL_SECONDS // 3600,
                                                **manager.retention_status}
        return report

    @app.get("/v1/hermes")
    async def hermes_status():
        return hermes.status()

    @app.post("/v1/hermes/probe")
    async def probe_hermes():
        return await hermes.probe()

    @app.get("/v1/jobs")
    async def jobs():
        return store.list_jobs()

    @app.get("/v1/transcription/jobs")
    async def transcription_jobs(offset: int = Query(default=0, ge=0)):
        return store.list_jobs(media_only=True, offset=offset)

    @app.post("/v1/workflows", status_code=202)
    async def create_workflow(request: WorkflowRequest, idempotency_key: str = Header(min_length=1, max_length=128)):
        try:
            return await manager.workflows.create(request, idempotency_key)
        except WorkflowConflict as error:
            raise HTTPException(409, str(error)) from error

    def script_call(action):
        try:
            return action()
        except KeyError as error:
            raise HTTPException(404, "Roteiro ou workflow não encontrado.") from error
        except WorkflowConflict as error:
            raise HTTPException(409, str(error)) from error
        except ValueError as error:
            raise HTTPException(422, "Estrutura do roteiro inválida.") from error

    @app.post("/v1/workflows/{workflow_id}/scripts", status_code=201)
    def generate_script(workflow_id: str, request: ScriptRequest | ManualScriptRequest,
                        idempotency_key: str = Header(min_length=1, max_length=128)):
        record, created = script_call(lambda: scripts.create(workflow_id, request, idempotency_key))
        return JSONResponse(record, status_code=201 if created else 200)

    @app.get("/v1/workflows/{workflow_id}/scripts")
    def list_scripts(workflow_id: str):
        return script_call(lambda: scripts.list(workflow_id))

    @app.get("/v1/scripts/{script_id}")
    def inspect_script(script_id: str):
        return script_call(lambda: scripts.get(script_id))

    @app.post("/v1/scripts/{script_id}/versions", status_code=201)
    def write_script_version(script_id: str, request: ScriptVersionRequest,
                             idempotency_key: str = Header(min_length=1, max_length=128)):
        record, created = script_call(lambda: scripts.new_version(script_id, request, idempotency_key))
        return JSONResponse(record, status_code=201 if created else 200)

    @app.post("/v1/scripts/{script_id}/review")
    def review_script(script_id: str, request: ScriptReviewRequest,
                      idempotency_key: str = Header(min_length=1, max_length=128)):
        return script_call(lambda: scripts.review(script_id, request, idempotency_key))

    @app.post("/v1/scripts/{script_id}/productions")
    async def start_production(script_id: str, request: ProductionRequest,
                               idempotency_key: str = Header(min_length=1, max_length=128)):
        try:
            record, created = await manager.productions.create(script_id, request, idempotency_key)
            return JSONResponse(record, status_code=201 if created else 200)
        except KeyError:
            raise HTTPException(404, "Roteiro não encontrado.") from None
        except WorkflowConflict as error:
            raise HTTPException(409, str(error)) from None
        except ValueError:
            raise HTTPException(409, "Roteiro aprovado com estrutura inválida.") from None

    @app.get("/v1/scripts/{script_id}/productions")
    def list_productions(script_id: str):
        return script_call(lambda: manager.productions.list(script_id))

    @app.get("/v1/productions/{production_id}")
    def inspect_production(production_id: str):
        return script_call(lambda: manager.productions.get(production_id))

    @app.get("/v1/productions/{production_id}/artifacts/{artifact_id}")
    def production_artifact(production_id: str, artifact_id: str):
        path = script_call(lambda: manager.productions.artifact(production_id, artifact_id))
        return FileResponse(path, filename=path.name)

    @app.post("/v1/productions/{production_id}/review")
    def review_production(production_id: str, request: ProductionReviewRequest,
                          idempotency_key: str = Header(min_length=1, max_length=128)):
        return script_call(lambda: manager.productions.review(production_id, request, idempotency_key))

    @app.get("/v1/productions/{production_id}/license-reviews")
    def list_license_reviews(production_id: str):
        return script_call(lambda: license_reviews.list(production_id))

    @app.post("/v1/productions/{production_id}/license-reviews")
    def create_license_review(production_id: str, request: LicenseReviewRequest,
                              idempotency_key: str = Header(min_length=1, max_length=128)):
        record, created = script_call(lambda: license_reviews.create(production_id, request, idempotency_key))
        return JSONResponse(record, status_code=201 if created else 200)

    @app.get("/v1/workflows")
    async def list_workflows():
        return manager.workflows.list()

    def require_workflow(workflow_id):
        try:
            return manager.workflows.get(workflow_id)
        except KeyError as error:
            raise HTTPException(404, "Workflow não encontrado.") from error

    @app.get("/v1/radar/datasets")
    async def radar_datasets():
        return [summary(dataset) for dataset in radar_state.list_datasets()]

    def require_dataset(snapshot_id, revision):
        try:
            return radar_state.load(snapshot_id, revision)
        except KeyError as error:
            raise HTTPException(404, "Dataset ausente ou expirado.") from error

    @app.get("/v1/radar/datasets/{snapshot_id}/{revision}")
    async def radar_dataset(snapshot_id: str, revision: int):
        dataset = require_dataset(snapshot_id, revision)
        return {"dataset": dataset.model_dump(mode="json"), "eligibility": eligibility(dataset)}

    @app.post("/v1/radar/datasets/demo", status_code=201)
    async def radar_demo(idempotency_key: str = Header(min_length=1, max_length=128)):
        # Identidade estável da operação; usa a PK existente, sem outra tabela de idempotência.
        identifier = "rad_" + hashlib.sha256(idempotency_key.encode()).hexdigest()[:24]
        try:
            dataset = radar_state.load(identifier, 1)
        except KeyError:
            dataset = demo(identifier, radar_state.clock())
            try:
                radar_state.save(dataset)
            except sqlite3.IntegrityError:
                dataset = radar_state.load(identifier, 1)
        return summary(dataset)

    @app.post("/v1/workflows/radar", status_code=202)
    async def radar_workflow(request: RadarWorkflowRequest, idempotency_key: str = Header(min_length=1, max_length=128)):
        dataset = require_dataset(request.snapshot_id, request.revision)
        try:
            mapped, profile, radar = adapt(dataset, request)
            # O corpo original participa da idempotência, inclusive a escolha explícita de fontes.
            return await manager.workflows.create(WorkflowRequest(objective=request.objective, dataset=mapped, channel_profile=profile),
                "radar:" + idempotency_key, executor=settings.radar_executor, radar=radar, radar_request=request.model_dump(mode="json"))
        except (ValueError, WorkflowConflict) as error:
            raise HTTPException(409, str(error)) from error

    @app.get("/v1/workflows/{workflow_id}")
    async def inspect_workflow(workflow_id: str):
        return require_workflow(workflow_id)

    @app.get("/v1/workflows/{workflow_id}/events")
    async def workflow_events(workflow_id: str, after: int = Query(default=0, ge=0)):
        require_workflow(workflow_id)
        return manager.workflows.events(workflow_id, after)

    @app.post("/v1/workflows/{workflow_id}/review")
    async def review_workflow(workflow_id: str, request: ReviewRequest,
                              idempotency_key: str = Header(min_length=1, max_length=128)):
        require_workflow(workflow_id)
        try:
            return await manager.workflows.review(workflow_id, request, idempotency_key)
        except WorkflowConflict as error:
            raise HTTPException(409, str(error)) from error

    @app.post("/v1/workflows/{workflow_id}/cancel")
    async def cancel_workflow(workflow_id: str):
        require_workflow(workflow_id)
        return await manager.workflows.cancel(workflow_id)

    @app.post("/v1/workflows/{workflow_id}/retry")
    async def retry_workflow(workflow_id: str, request: RevisionRequest):
        require_workflow(workflow_id)
        try:
            return await manager.workflows.retry(workflow_id, request.expected_revision)
        except WorkflowConflict as error:
            raise HTTPException(409, str(error)) from error

    @app.post("/v1/workflows/{workflow_id}/authorize")
    async def authorize_workflow(workflow_id: str, request: AuthorizationRequest,
                                 idempotency_key: str = Header(min_length=1, max_length=128)):
        # Operador local autoriza UMA execução cognitiva; o payload não escolhe autoria, executor ou limites.
        workflow = require_workflow(workflow_id)
        if workflow["executor"] == "hermes":
            try:
                require_secure(settings, store)
            except SecurityGate as error:
                raise HTTPException(409, {"code": "security_gate", "message": str(error)}) from None
        try:
            return await manager.workflows.authorize(workflow_id, request, idempotency_key)
        except WorkflowConflict as error:
            raise HTTPException(409, str(error)) from error

    @app.post("/v1/workflows/{workflow_id}/reconcile")
    async def reconcile_workflow(workflow_id: str, request: RevisionRequest):
        require_workflow(workflow_id)
        try:
            return await manager.workflows.reconcile(workflow_id, request.expected_revision)
        except WorkflowConflict as error:
            raise HTTPException(409, str(error)) from error

    @app.get("/v1/diagnostics")
    async def diagnostics():
        return await asyncio.to_thread(diagnose, settings)

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
            keepalive_at = time.monotonic() + STREAM_KEEPALIVE_SECONDS
            while not await request.is_disconnected():
                idle = False
                async with manager.changed:
                    entries = store.events(job_id, cursor)
                    terminal = require_job(job_id)["status"] in TERMINAL
                    if not entries and not terminal:
                        try:
                            await asyncio.wait_for(manager.changed.wait(), timeout=max(.01, keepalive_at - time.monotonic()))
                        except TimeoutError:
                            pass
                        idle = True
                if idle:
                    if time.monotonic() >= keepalive_at:
                        # Transporte apenas: sem sequence, gravação no banco ou mudança de estado.
                        yield json.dumps({"kind": "keepalive"}) + "\n"
                        keepalive_at = time.monotonic() + STREAM_KEEPALIVE_SECONDS
                    continue
                for entry in entries:
                    cursor = entry["sequence"]
                    yield json.dumps(entry, ensure_ascii=False) + "\n"
                if entries:
                    keepalive_at = time.monotonic() + STREAM_KEEPALIVE_SECONDS
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
        if expires < time.time() or not secrets.compare_digest(ticket.encode("utf-8", "replace"), expected.encode()):
            raise HTTPException(401, "Acesso à mídia expirado. Selecione-a novamente.")
        item = store.media(media_id)
        if not item:
            raise HTTPException(404, "Mídia não encontrada.")
        path = Path(item["path"])
        if path.is_symlink():  # o registro resolve links; um link posterior é troca do arquivo
            raise HTTPException(409, "O arquivo mudou. Selecione-o novamente antes de reproduzir.")
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
        return transcription_capabilities()

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
