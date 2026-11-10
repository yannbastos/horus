from __future__ import annotations

import asyncio
import contextlib
import json
import os
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .config import Settings
from .processes import OwnedProcess
from .storage import Store

TERMINAL = {"succeeded", "failed", "cancelled", "interrupted", "blocked"}


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["factory.profile", "factory.render.preview"]
    channel_id: str = Field(default="canal01", pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    video_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")

    @model_validator(mode="after")
    def validate_video(self):
        if self.operation == "factory.render.preview" and not self.video_id:
            raise ValueError("Informe o identificador do vídeo para renderizar.")
        return self


class JobManager:
    def __init__(self, store: Store, settings: Settings):
        self.store, self.settings = store, settings
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.changed = asyncio.Condition()
        self.worker: asyncio.Task | None = None
        self.active_id: str | None = None
        self.active_process: OwnedProcess | None = None

    async def start(self):
        self.store.recover()
        for job_id in self.store.queued_ids():
            self.queue.put_nowait(job_id)
        self.worker = asyncio.create_task(self._work())

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
        if job["status"] == "queued":
            self.store.update(job_id, "cancelled")
            await self.emit(job_id, "state", "cancelled")
        else:
            self.store.update(job_id, "cancel_requested")
            await self.emit(job_id, "state", "cancel_requested")
            if self.active_id == job_id and self.active_process:
                await self.active_process.stop()
        return self.store.get_job(job_id)

    async def retry(self, job_id: str):
        job = self.store.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        if job["status"] not in {"failed", "interrupted", "blocked", "cancelled"}:
            raise ValueError("Somente tarefas encerradas sem sucesso podem ser tentadas novamente.")
        self.store.update(job_id, "queued")
        await self.emit(job_id, "state", "queued")
        self.queue.put_nowait(job_id)
        return self.store.get_job(job_id)

    def command(self, request: JobRequest):
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

    async def _read(self, reader, job_id: str, kind: str, captured: list[str]):
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
                    await self.emit(job_id, kind, line)
            if len(pending) > 4000:
                await self.emit(job_id, kind, pending[:2000])
                pending = ""
        pending += decoder.decode(b"", final=True)
        if pending.strip():
            await self.emit(job_id, kind, pending)

    async def _work(self):
        while True:
            job_id = await self.queue.get()
            try:
                job = self.store.get_job(job_id)
                if job and job["status"] == "queued":
                    await self._run(job)
            finally:
                self.queue.task_done()

    async def _run(self, job):
        job_id = job["id"]
        self.active_id = job_id
        try:
            request = JobRequest.model_validate(job["payload"])
            command = self.command(request)
            self.store.update(job_id, "running", new_attempt=True)
            await self.emit(job_id, "state", "running")
            env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONUTF8": "1"}
            env.pop("HORUS_API_TOKEN", None)
            env.pop("HORUS_MANAGED", None)
            if self.settings.factory_root:
                env["FABRICA_HOME"] = str(self.settings.factory_root)
                env["PYTHONPATH"] = str(self.settings.factory_root / "scripts")
            self.active_process = await OwnedProcess.start(command, env=env, cwd=self.settings.factory_root)
            if self.store.get_job(job_id)["status"] == "cancel_requested":
                await self.active_process.stop()
            output: list[str] = []
            process = self.active_process.process
            readers = asyncio.gather(self._read(process.stdout, job_id, "stdout", output),
                                     self._read(process.stderr, job_id, "stderr", []))
            try:
                await asyncio.wait_for(process.wait(), timeout=30 if request.operation == "factory.profile" else 3600)
                await readers
            except BaseException:
                await self.active_process.stop()
                readers.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await readers
                raise
            current = self.store.get_job(job_id)
            if current["status"] == "cancel_requested":
                self.store.update(job_id, "cancelled")
            elif process.returncode != 0:
                self.store.update(job_id, "failed", error=f"O comando encerrou com código {process.returncode}. Consulte os logs.")
            else:
                result = json.loads("".join(output)) if request.operation == "factory.profile" else {"message": "Render de rascunho concluído."}
                self.store.update(job_id, "succeeded", result=result)
        except asyncio.CancelledError:
            if self.active_process:
                await self.active_process.stop()
            self.store.update(job_id, "interrupted", error="Aplicativo encerrado durante a execução. Revise antes de repetir.")
            raise
        except ValueError as error:
            self.store.update(job_id, "blocked" if not self.active_process else "failed", error=str(error))
        except TimeoutError:
            self.store.update(job_id, "failed", error="Tempo limite da operação excedido.")
        except Exception as error:
            self.store.update(job_id, "failed", error=f"Falha na execução: {type(error).__name__}: {error}")
        finally:
            if self.active_process:
                self.active_process.close()
            self.active_process = None
            self.active_id = None
            await self.emit(job_id, "state", self.store.get_job(job_id)["status"])

    async def close(self):
        if self.worker:
            self.worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.worker
