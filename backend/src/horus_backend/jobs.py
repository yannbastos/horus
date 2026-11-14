from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import datetime, timezone
import os
import time
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

from .config import Settings
from .radar_youtube.state import RadarState
from .retention import run_retention
from .processes import OwnedProcess, failure_detail, sanitized_tail
from .storage import Store
from .transcriber import FILE_MARKER, LANGUAGES, MODELS, is_youtube_url
from .worker_lock import WorkerLock
from .workflows import WorkflowService
from .production import ProductionService

TERMINAL = {"succeeded", "failed", "cancelled", "interrupted", "blocked"}
RETENTION_INTERVAL_SECONDS = 6 * 3600
log = logging.getLogger(__name__)


class FactoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["factory.profile", "factory.render.preview"]
    channel_id: str = Field(default="canal01", pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    video_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")

    @model_validator(mode="after")
    def validate_video(self):
        if self.operation == "factory.render.preview" and not self.video_id:
            raise ValueError("Informe o identificador do vídeo para renderizar.")
        return self


class TranscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["transcription.run"]
    path: str = Field(min_length=1, max_length=4096)
    model: Literal[MODELS] = "small"  # type: ignore[valid-type]
    language: Literal[LANGUAGES] = "auto"  # type: ignore[valid-type]


class DownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["youtube.download"]
    url: str = Field(max_length=2048)
    directory: str = Field(min_length=1, max_length=4096)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str):
        if not is_youtube_url(value):
            raise ValueError("Informe um link válido de vídeo do YouTube.")
        return value


JobRequest = Annotated[FactoryRequest | TranscriptionRequest | DownloadRequest, Field(discriminator="operation")]
_parse_request = TypeAdapter(JobRequest).validate_python
# Sem limite fixo para tarefas longas de mídia; o operador pode cancelar.
TIMEOUTS = {"factory.profile": 30, "factory.render.preview": 3600}


# Ambiente mínimo por operação (S-2): nenhuma credencial do operador chega aos subprocessos.
# Base do SO; HOME/USERPROFILE/LOCALAPPDATA/APPDATA são necessários para caches de usuário
# (Hugging Face, yt-dlp, npm/Remotion) e não carregam segredos por si.
_BASE_ENV = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT",
             "USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA",
             # Variáveis de SO sem segredo que Node/Remotion/Chrome e ctranslate2 usam no Windows
             # (localizar Program Files/ProgramData, detectar CPU/SO e dimensionar threads).
             "SYSTEMDRIVE", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "PROGRAMDATA",
             "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS"}
# GPU na transcrição: o ctranslate2 localiza as DLLs do CUDA por CUDA_PATH e CUDA_PATH_V*.
_CUDA_PREFIX = "CUDA_PATH"
# Ferramentas e opções lidas por dependencies.find_tool e transcriber.py.
_TOOL_ENV = {"HORUS_FFMPEG", "HORUS_FFPROBE", "HORUS_TOOLS_DIR"}
_OPERATION_ENV = {
    "transcription.run": _TOOL_ENV | {"HORUS_WHISPER_DEVICE"},
    # Proxy de rede do operador: necessário para o download funcionar atrás de proxy.
    "youtube.download": _TOOL_ENV | {"HORUS_YTDLP", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"},
    "factory.profile": {"HORUS_NODE"},
    "factory.render.preview": _TOOL_ENV | {"HORUS_NODE"},
}


def job_environment(request, settings: Settings) -> dict[str, str]:
    allowed = _BASE_ENV | _OPERATION_ENV[request.operation]
    cuda = request.operation == "transcription.run"
    env = {k: v for k, v in os.environ.items()
           if k.upper() in allowed or (cuda and k.upper().startswith(_CUDA_PREFIX))}
    env.update(PYTHONUNBUFFERED="1", PYTHONUTF8="1")
    if isinstance(request, FactoryRequest) and settings.factory_root:
        env["FABRICA_HOME"] = str(settings.factory_root)
        env["PYTHONPATH"] = str(settings.factory_root / "scripts")
    return env


def transcript(segments: list[str]) -> str:
    return "".join(f"{text}\n" for text in segments)


class JobManager:
    def __init__(self, store: Store, settings: Settings):
        self.store, self.settings = store, settings
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.changed = asyncio.Condition()
        self.worker: asyncio.Task | None = None
        self.retention_task: asyncio.Task | None = None
        # Último ciclo de retenção (somente contagens, sem conteúdo), exposto em /v1/security/status.
        self.retention_status: dict = {"last_run_at": None, "last_status": None, "redacted_workflows": None}
        # Checkpoint do WAL que não concluiu (leitor ativo): o próximo ciclo repete mesmo sem novas redações.
        self.checkpoint_pending = False
        self.active_id: str | None = None
        self.active_process: OwnedProcess | None = None
        self.worker_lock = WorkerLock(store.path)
        self.workflows = WorkflowService(store, self.queue, self.notify, settings)
        self.productions = ProductionService(self)

    async def start(self):
        if self.worker is not None:
            raise RuntimeError("Executor já iniciado.")
        self.worker_lock.acquire()
        try:
            self.store.recover()
            with self.store.connect() as db:
                interrupted = [row['id'] for row in db.execute(
                    "SELECT id,payload FROM jobs WHERE status='interrupted'")
                    if json.loads(row['payload']).get('operation') == 'production.run']
            for job_id in interrupted:
                result = self.store.get_job(job_id)['result'] or {}
                if result.get('failure'):
                    continue
                self.store.update(job_id, 'interrupted', result={**result, 'failure':failure_detail(
                    'production_interrupted', result.get('stage','prepare'))},
                    error='Backend encerrado durante a produção; revise os artefatos e crie nova produção explicitamente. Nenhuma etapa foi repetida.')
            self.workflows.recover()
            await self.run_retention()
            for job_id in self.store.queued_ids():
                self.queue.put_nowait(job_id)
            self.worker = asyncio.create_task(self._work())
            self.retention_task = asyncio.create_task(self._retention_loop())
        except BaseException:
            self.worker_lock.close()
            raise

    def _retention_cycle(self):
        # Sem rede. O arquivo do Radar fica ao lado do banco operacional (mesmo diretório de dados).
        report = run_retention(self.store, retry_checkpoint=self.checkpoint_pending)
        self.checkpoint_pending = report.checkpoint_pending
        RadarState(self.store.path.parent / "radar" / "radar-youtube.sqlite3").purge()
        return report

    async def run_retention(self):
        """Falhas de limpeza nunca impedem a inicialização nem o executor; ficam no log e na próxima janela."""
        started = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        try:
            report = await asyncio.to_thread(self._retention_cycle)
        except Exception as error:
            self.retention_status = {"last_run_at": started, "last_status": "failed", "redacted_workflows": None,
                                     "checkpoint": None}
            log.warning("Ciclo de retenção do Radar falhou: %s", type(error).__name__)
            return None
        self.retention_status = {"last_run_at": started, "last_status": "partial" if report.failed else "ok",
                                 "redacted_workflows": report.redacted, "checkpoint": report.checkpoint}
        return report

    async def _retention_loop(self):
        while True:
            await asyncio.sleep(RETENTION_INTERVAL_SECONDS)
            await self.run_retention()

    async def notify(self):
        async with self.changed:
            self.changed.notify_all()

    async def emit(self, job_id: str, kind: str, message: str):
        self.store.event(job_id, kind, message)
        await self.notify()

    async def submit(self, request: JobRequest, key: str):
        job, created = self.store.create_job(request.model_dump(), key)
        if created:
            await self.emit(job["id"], "state", "queued")
            self.queue.put_nowait(job["id"])
        return job

    async def cancel(self, job_id: str):
        job = self.store.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        if job["status"] in TERMINAL:
            return job
        if job.get("workflow_id"):
            await self.workflows.cancel(job["workflow_id"])
            return self.store.get_job(job_id)
        if job["status"] == "queued":
            self.store.update(job_id, "cancelled")
            await self.emit(job_id, "state", "cancelled")
        else:
            self.store.update(job_id, "cancel_requested", result=job["result"])
            await self.emit(job_id, "state", "cancel_requested")
            if self.active_id == job_id and self.active_process:
                await self.active_process.stop()
        return self.store.get_job(job_id)

    async def retry(self, job_id: str):
        job = self.store.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        if job["payload"].get("operation") == "production.run":
            raise ValueError("Produção com efeitos possíveis exige conciliação; crie nova produção explicitamente.")
        if job.get("workflow_id"):
            raise ValueError("Retome o workflow pela operação editorial, não uma etapa isolada.")
        if job["payload"].get("operation") == "transcription.run":
            raise ValueError("Retry direto de transcrição indisponível: preserve o resultado e inicie outra transcrição explicitamente pela tela.")
        if job["status"] not in {"failed", "interrupted", "blocked", "cancelled"}:
            raise ValueError("Somente tarefas encerradas sem sucesso podem ser tentadas novamente.")
        self.store.update(job_id, "queued")
        await self.emit(job_id, "state", "queued")
        self.queue.put_nowait(job_id)
        return self.store.get_job(job_id)

    def command(self, request: JobRequest):
        if isinstance(request, TranscriptionRequest):
            path = Path(request.path).expanduser()
            if not path.is_file():
                raise ValueError("Arquivo de mídia não encontrado. Verifique se ele foi movido ou removido.")
            return [*self.settings.worker(), "transcribe", "--path", str(path.resolve()), "--model", request.model,
                    "--language", request.language, "--models-dir", str(self.settings.data_dir / "models")]
        if isinstance(request, DownloadRequest):
            directory = Path(request.directory).expanduser()
            if not directory.is_dir():
                raise ValueError("Pasta de destino não encontrada.")
            return [*self.settings.worker(), "download", "--url", request.url, "--directory", str(directory.resolve())]
        command = self.settings.command()
        if not command:
            raise ValueError("CLI fabrica indisponível. Prepare a fábrica e configure FABRICA_HOME.")
        root = self.settings.factory_root
        if root:
            channel = (root / "canais" / request.channel_id).resolve()
            if not channel.is_relative_to((root / "canais").resolve()):
                raise ValueError("Canal fora da raiz autorizada.")
            if request.video_id:
                video = (channel / "videos" / request.video_id).resolve()
                if not video.is_relative_to(channel):
                    raise ValueError("Vídeo fora da raiz autorizada.")
        if request.operation == "factory.profile":
            return [*command, "perfil", "mostrar", "--canal", request.channel_id, "--formato", "json"]
        return [*command, "render", "--canal", request.channel_id, "--video", request.video_id,
                "--composicao", "short", "--rascunho"]

    async def _line(self, job_id: str, kind: str, line: str, notes: dict | None, failures: list[str] | None = None):
        if notes is None:
            line = sanitized_tail(line)
        # O CLI da fábrica escreve recusas `ERRO:` em stdout; stderr também é diagnóstico.
        # Manter somente um resumo limitado, além do histórico completo de eventos.
        if failures is not None and (kind == 'stderr' or line.lstrip().startswith('ERRO:')):
            failures[:] = [*failures[-2:], line.strip()[:1000]]
        # Subprocessos do Hórus enviam NDJSON; demais linhas seguem como log bruto.
        if notes is not None:
            if kind == "stdout" and line.startswith("{"):
                with contextlib.suppress(ValueError):
                    item = json.loads(line)
                    if isinstance(item, dict) and item.get("type") in {"status", "progress", "segment"}:
                        kind, line = item["type"], str(item.get("message", ""))
                        if kind == "segment":
                            notes["segments"].append(line)
            elif kind == "stdout" and line.startswith(FILE_MARKER):
                notes["file"] = line[len(FILE_MARKER):].strip()
        await self.emit(job_id, kind, line)

    async def _read(self, reader, job_id: str, kind: str, captured: list[str], notes: dict | None = None,
                    failures: list[str] | None = None):
        # Leitura incremental também aceita ferramentas que atualizam o console com CR.
        import codecs
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        pending, total = "", 0
        while chunk := await reader.read(4096):
            text = decoder.decode(chunk)
            if kind == "stdout" and total < 1_048_576:
                captured.append(text[:1_048_576 - total])
                total += len(text)
            pending += text.replace("\r", "\n")
            lines = pending.split("\n")
            pending = lines.pop()
            for line in lines:
                if line.strip():
                    await self._line(job_id, kind, line, notes, failures)
            if len(pending) > 4000:
                await self.emit(job_id, kind, sanitized_tail(pending, limit=2000) if notes is None else pending[:2000])
                pending = ""
        pending += decoder.decode(b"", final=True)
        if pending.strip():
            await self._line(job_id, kind, pending, notes, failures)

    async def _work(self):
        while True:
            job_id = await self.queue.get()
            try:
                job = self.store.get_job(job_id)
                if job and job["status"] == "queued":
                    if job["payload"].get("operation") == "production.run":
                        await self.productions.run(job)
                    elif job.get("workflow_id"):
                        self.active_id = job_id
                        try:
                            await self.workflows.run_step(job)
                        finally:
                            self.active_id = None
                    else:
                        await self._run(job)
            finally:
                self.queue.task_done()

    async def _run(self, job):
        job_id = job["id"]
        self.active_id = job_id
        started = time.monotonic()
        try:
            request = _parse_request(job["payload"])
            command = self.command(request)
            self.store.update(job_id, "running", new_attempt=True)
            await self.emit(job_id, "state", "running")
            env = job_environment(request, self.settings)
            factory = isinstance(request, FactoryRequest)
            self.active_process = await OwnedProcess.start(command, env=env, cwd=self.settings.factory_root if factory else None)
            if self.store.get_job(job_id)["status"] == "cancel_requested":
                await self.active_process.stop()
            output: list[str] = []
            failures: list[str] = []
            notes = None if factory else {"segments": [], "file": None}
            process = self.active_process.process
            readers = asyncio.gather(self._read(process.stdout, job_id, "stdout", output, notes, failures),
                                     self._read(process.stderr, job_id, "stderr", [], notes, failures))
            try:
                await asyncio.wait_for(process.wait(), timeout=TIMEOUTS.get(request.operation))
                await readers
            except BaseException:
                await self.active_process.stop()
                readers.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await readers
                raise
            current = self.store.get_job(job_id)
            # Texto parcial preservado em cancelamento ou falha, como no desktop Avalonia.
            partial = {"text": transcript(notes["segments"]), "partial": True} if notes and notes["segments"] else None
            if current["status"] == "cancel_requested":
                self.store.update(job_id, "cancelled", result=partial)
            elif process.returncode != 0:
                detail = " ".join(failures) if failures else "Consulte os logs."
                diagnostic = {'failure':failure_detail('factory_command_failed', 'render' if request.operation == 'factory.render.preview' else 'prepare',
                    started=started, exit_code=process.returncode, stderr='\n'.join(failures))} if factory else partial
                self.store.update(job_id, "failed", result=diagnostic,
                                  error=f"O comando encerrou com código {process.returncode}. {detail}")
            else:
                self.store.update(job_id, "succeeded", result=self._result(request, output, notes))
        except asyncio.CancelledError:
            if self.active_process:
                await self.active_process.stop()
            self.store.update(job_id, "interrupted", result=self.store.get_job(job_id)["result"],
                              error="Aplicativo encerrado durante a execução. Revise antes de repetir.")
            raise
        except ValueError as error:
            self.store.update(job_id, "blocked" if not self.active_process else "failed",
                              result=self.store.get_job(job_id)["result"], error=str(error))
        except TimeoutError:
            self.store.update(job_id, "failed", result=self.store.get_job(job_id)["result"],
                              error="Tempo limite da operação excedido.")
        except Exception as error:
            factory_job = job['payload'].get('operation', '').startswith('factory.')
            self.store.update(job_id, "failed", result=self.store.get_job(job_id)["result"],
                              error=(f'Falha na execução da fábrica ({type(error).__name__}); confira as dependências locais antes de tentar novamente.'
                                     if factory_job else f"Falha na execução: {type(error).__name__}: {error}"))
        finally:
            current = self.store.get_job(job_id)
            if job['payload'].get('operation', '').startswith('factory.') and current['status'] in {'failed','blocked','interrupted'}:
                result = current['result'] or {}
                if 'failure' not in result:
                    self.store.update(job_id, current['status'], error=current['error'], result={**result,
                        'failure':failure_detail('factory_'+current['status'],
                            'render' if job['payload']['operation'] == 'factory.render.preview' else 'prepare',
                            started=started, exit_code=self.active_process.process.returncode if self.active_process else None)})
            if self.active_process:
                self.active_process.close()
            self.active_process = None
            self.active_id = None
            await self.emit(job_id, "state", self.store.get_job(job_id)["status"])

    @staticmethod
    def _result(request, output: list[str], notes: dict | None):
        if request.operation == "factory.profile":
            return json.loads("".join(output))
        if request.operation == "factory.render.preview":
            return {"message": "Render de rascunho concluído."}
        if request.operation == "transcription.run":
            return {"text": transcript(notes["segments"])}
        file = Path(notes["file"]) if notes["file"] else None
        if not file or not file.is_file():
            raise ValueError("yt-dlp não retornou um arquivo de vídeo válido.")
        return {"path": str(file.resolve())}

    async def close(self):
        try:
            if self.retention_task:
                self.retention_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self.retention_task
            if self.worker:
                self.worker.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await self.worker
        finally:
            self.retention_task = None
            self.worker = None
            self.worker_lock.close()
