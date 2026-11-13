"""Produção técnica M4 no JobManager existente; aprovação final permanece humana."""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .production_contract import ProductionPlan, build_production_plan
from .script_contract import ScriptDocument
from .scripts import ScriptService
from .storage import now
from .workflows import WorkflowConflict, digest, encode
from .processes import OwnedProcess


class NarrationSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = Field(min_length=1, max_length=80)
    voice_id: str = Field(min_length=1, max_length=1000)


class ProductionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    narration: NarrationSelection | None = None
    expected_version: int = Field(ge=1, strict=True)
    mode: Literal["simulated", "local_demo", "local_pilot"]
    render_quality: Literal["draft", "final"] = "draft"

    @model_validator(mode="after")
    def quality_mode(self):
        if self.render_quality == "final" and self.mode != "local_pilot":
            raise ValueError("render final requer local_pilot")
        if self.narration is not None and self.mode != "local_pilot":
            raise ValueError("narração requer local_pilot")
        return self


class ProductionReviewNote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    at_seconds: float = Field(ge=0, allow_inf_nan=False, strict=True)
    text: str = Field(min_length=1, max_length=2000, strict=True)


class ProductionReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "reject"]
    artifact_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    notes: list[ProductionReviewNote] = Field(default_factory=list, max_length=200)
    acknowledge_quality_errors: bool = Field(default=False, strict=True)


def confined(root: Path, relative: str) -> Path:
    path = Path(relative)
    if not relative or path.is_absolute() or "\\" in relative or ":" in relative or any(p in {".", ".."} for p in relative.split("/")):
        raise WorkflowConflict("Caminho de artefato inválido.")
    target = root / path
    for part in [root, *target.parents, target]:
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise WorkflowConflict("Links não são permitidos em artefatos.")
    if not target.resolve().is_relative_to(root.resolve()) or not target.is_file():
        raise WorkflowConflict("Artefato ausente ou fora da produção.")
    return target


def inspect_artifact(root, relative, kind):
    path = confined(root, relative)
    suffixes = {"plan": {".json"}, "scene": {".png"}, "audio": {".wav"}, "subtitles": {".srt"},
                "video": {".mp4"}, "manifest": {".json"}, "font": {".ttf", ".otf"}}
    if kind not in suffixes or path.suffix not in suffixes[kind] or path.stat().st_size == 0:
        raise WorkflowConflict("Tipo ou conteúdo de artefato inválido.")
    with path.open("rb") as stream:
        data = stream.read(16)
        stream.seek(0)
        content_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    if kind in {"plan", "manifest"}:
        json.loads(path.read_bytes())
    elif kind == "scene" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise WorkflowConflict("Imagem inválida.")
    elif kind == "audio" and not (data.startswith(b"RIFF") and data[8:12] == b"WAVE"):
        raise WorkflowConflict("Áudio inválido.")
    elif kind == "subtitles" and " --> " not in path.read_text(encoding="utf-8"):
        raise WorkflowConflict("Legenda inválida.")
    elif kind == "video" and data[4:8] != b"ftyp":
        raise WorkflowConflict("Vídeo inválido.")
    return {"id": hashlib.sha256(f"{kind}:{relative}".encode()).hexdigest()[:32], "kind": kind,
            "relative_path": relative, "size_bytes": path.stat().st_size, "sha256": content_hash}


class ProductionService:
    def __init__(self, manager):
        self.manager, self.store, self.settings = manager, manager.store, manager.settings

    def root(self, production_id):
        if not re.fullmatch(r"[a-f0-9]{32}", production_id):
            raise KeyError(production_id)
        return self.settings.data_dir / "productions" / production_id

    @staticmethod
    def require(db, production_id):
        row = db.execute("SELECT * FROM productions WHERE id=?", (production_id,)).fetchone()
        if row is None:
            raise KeyError(production_id)
        return row

    def record(self, db, row):
        job = self.store.job(db.execute("SELECT * FROM jobs WHERE id=?", (row["job_id"],)).fetchone())
        result = job["result"] or {}
        from .local_pilot import confirmed_media
        media = confirmed_media(self.root(row['id']),json.loads(row['artifacts']),row['id'])
        quality = media['quality_report']
        acknowledgement_required = row['mode']=='local_pilot' and (
            quality is None or quality['status']=='not_run' or bool(quality['blocking_errors']))
        return {key: row[key] for key in ("id", "script_id", "script_version", "script_content_hash", "job_id", "mode", "created_at")} | {
            "updated_at": max(job["updated_at"], (json.loads(row["review"]) or {}).get("reviewed_at", "")) if row["review"] else job["updated_at"], "stage": result.get("stage", "prepare"), "status": job["status"],
            "artifacts": json.loads(row["artifacts"]), "review": json.loads(row["review"]) if row["review"] else None,
            "error": job["error"], "demo_only": True, "real_voice": False, **media,
            "quality_acknowledgement_required":acknowledgement_required,
            "publishable": False, "narration_kind": result.get("narration_kind"),
            "narration_disclosure": result.get("narration_disclosure"), "alignment_method": result.get("alignment_method")}

    def get(self, production_id):
        with self.store.connect() as db:
            return self.record(db, self.require(db, production_id))

    def list(self, script_id):
        with self.store.connect() as db:
            ScriptService._require(db, script_id)
            return {"items": [self.record(db, row) for row in db.execute(
                "SELECT * FROM productions WHERE script_id=? ORDER BY created_at DESC", (script_id,))]}

    @staticmethod
    def approved(db, script_id, version):
        script = ScriptService._require(db, script_id)
        latest = db.execute("SELECT MAX(version) FROM scripts WHERE workflow_id=?", (script["workflow_id"],)).fetchone()[0]
        review = json.loads(script["review"]) if script["review"] else {}
        if script["status"] != "approved" or script["version"] != version or version != latest or review.get("decision") != "approve":
            raise WorkflowConflict("Roteiro mais recente e aprovação humana persistida são necessários.")
        document = json.loads(script["document"])
        # O recibo M3 contém o documento exato devolvido na aprovação. Assim uma
        # edição posterior no banco não recebe uma aprovação antiga por acidente.
        approvals = db.execute("SELECT response FROM script_receipts WHERE scope=?", (f"review:{script_id}",)).fetchall()
        matched = False
        for receipt in approvals:
            approved = json.loads(receipt["response"])
            if (approved.get("id") == script_id and approved.get("version") == version
                    and approved.get("status") == "approved" and approved.get("review") == review
                    and digest(approved.get("document")) == digest(document)):
                matched = True
                break
        if not matched:
            raise WorkflowConflict("Documento não corresponde ao snapshot da aprovação M3 persistida.")
        ScriptDocument.model_validate(document)
        return script, document

    async def create(self, script_id, request, key):
        body = request.model_dump()
        selection = None
        default_selection = False
        if request.mode == 'local_pilot':
            if request.narration:
                selection = request.narration.model_dump()
            else:
                preference = self.settings.data_dir / 'narration-preference.json'
                if preference.exists():
                    try:
                        selection = NarrationSelection.model_validate_json(preference.read_text(encoding='utf-8')).model_dump()
                    except (OSError, ValueError):
                        raise WorkflowConflict('Preferência de narração inválida; revise Ajustes.') from None
                else:
                    default_selection = True
                    from .narration.providers import WindowsSapi, NarrationError
                    try:
                        voices = await asyncio.to_thread(WindowsSapi().voices)
                    except NarrationError:
                        voices = []
                    voice = next((v['id'] for v in voices if v['language'].lower() == 'pt-br'), 'default_pt_BR')
                    selection = {'provider': 'windows_sapi', 'voice_id': voice}
            body['narration'] = selection
        else:
            body.pop('narration')
        if request.render_quality == "draft":
            body.pop("render_quality")  # preserva recibos anteriores ao preset explicito
        scope, encoded = f"create:{script_id}", encode(body)
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            receipt = db.execute("SELECT * FROM production_receipts WHERE scope=? AND idempotency_key=?", (scope, key)).fetchone()
            if receipt:
                previous = json.loads(receipt['request'])
                compared = body
                # Recibos anteriores à seleção continuam recuperáveis pelo pedido padrão.
                if default_selection and 'narration' not in previous:
                    compared = {k:v for k,v in body.items() if k != 'narration'}
                if receipt["request"] != encode(compared):
                    raise WorkflowConflict("Chave de idempotência usada com outro pedido.")
                return self.record(db, self.require(db, receipt["production_id"])), False
            script, document = self.approved(db, script_id, request.expected_version)
            content_hash = digest(document)
            plan = build_production_plan(ScriptDocument.model_validate(document), script_id=script_id,
                script_version=script["version"], script_content_hash=content_hash, mode=request.mode, render_quality=request.render_quality, narration=selection)
            production_id, job_id, timestamp = uuid.uuid4().hex, uuid.uuid4().hex, now()
            payload = encode({"operation": "production.run", "production_id": production_id})
            db.execute("INSERT INTO jobs(id,idempotency_key,payload,status,created_at,updated_at) VALUES(?,?,?,'queued',?,?)",
                       (job_id, f"production:{production_id}", payload, timestamp, timestamp))
            db.execute("""INSERT INTO productions(id,script_id,script_version,script_content_hash,script_review,job_id,mode,plan,created_at)
                VALUES(?,?,?,?,?,?,?,?,?)""", (production_id, script_id, script["version"], content_hash, script["review"],
                                               job_id, request.mode, encode(plan.model_dump(mode="json")), timestamp))
            db.execute("INSERT INTO production_receipts VALUES(?,?,?,?)", (scope, key, encoded, production_id))
            record = self.record(db, self.require(db, production_id))
        self.manager.queue.put_nowait(job_id)
        await self.manager.emit(job_id, "state", "queued")
        return record, True

    def artifact(self, production_id, artifact_id):
        record = self.get(production_id)
        artifact = next((a for a in record["artifacts"] if a["id"] == artifact_id), None)
        if not artifact:
            raise KeyError(artifact_id)
        actual = inspect_artifact(self.root(production_id), artifact["relative_path"], artifact["kind"])
        if actual != artifact:
            raise WorkflowConflict("Integridade do artefato alterada; revisão necessária.")
        return confined(self.root(production_id), artifact["relative_path"])

    def review(self, production_id, request, key):
        body = request.model_dump()
        if not request.notes:
            body.pop("notes")  # Preserva recibos anteriores ao campo opcional.
        if not request.acknowledge_quality_errors:
            body.pop('acknowledge_quality_errors')
        encoded, scope = encode(body), f"review:{production_id}"
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self.require(db, production_id)
            receipt = db.execute("SELECT * FROM production_receipts WHERE scope=? AND idempotency_key=?", (scope, key)).fetchone()
            if receipt:
                if receipt["request"] != encoded:
                    raise WorkflowConflict("Chave de revisão usada com outra decisão.")
                return self.record(db, row)
            record = self.record(db, row)
            if (request.decision=='approve' and record['quality_acknowledgement_required']
                    and not request.acknowledge_quality_errors):
                raise WorkflowConflict('QC reprovado ou indisponível exige confirmação explícita dos problemas de qualidade.')
            if record["status"] != "succeeded" or row["mode"] not in {"local_demo", "local_pilot"} or row["review"]:
                raise WorkflowConflict("Revisão exige vídeo real concluído e ainda não revisado.")
            video = next((a for a in record["artifacts"] if a["kind"] == "video" and a["sha256"] == request.artifact_sha256), None)
            if video is None:
                raise WorkflowConflict("Hash não corresponde ao vídeo registrado.")
            actual = inspect_artifact(self.root(production_id), video["relative_path"], "video")
            if actual != video:
                raise WorkflowConflict("Vídeo alterado após render.")
            review = request.model_dump() | {"reviewed_at": now()}
            db.execute("UPDATE productions SET review=? WHERE id=?", (encode(review), production_id))
            db.execute("INSERT INTO production_receipts VALUES(?,?,?,?)", (scope, key, encoded, production_id))
            return self.record(db, self.require(db, production_id))

    async def run(self, job):
        manager, job_id = self.manager, job["id"]
        manager.active_id = job_id
        try:
            production_id = job["payload"]["production_id"]
            with self.store.connect() as db:
                row = self.require(db, production_id)
                script, document = self.approved(db, row["script_id"], row["script_version"])
                if digest(document) != row["script_content_hash"] or script["review"] != row["script_review"]:
                    raise WorkflowConflict("Roteiro/aprovação mudou após submissão.")
                plan = row["plan"]
                saved = json.loads(plan)
                expected_plan = build_production_plan(ScriptDocument.model_validate(document), script_id=row["script_id"],
                    script_version=row["script_version"], script_content_hash=row["script_content_hash"], mode=row["mode"],
                    render_quality=saved.get("render_quality", "draft"),
                    narration={k:saved['audio'][k] for k in ('provider','voice_id') if saved['audio'].get(k) is not None})
                if digest(ProductionPlan.model_validate_json(plan).model_dump(mode="json")) != digest(expected_plan.model_dump(mode="json")):
                    raise WorkflowConflict("Plano não corresponde ao roteiro aprovado.")
            if getattr(sys, "frozen", False):
                raise WorkflowConflict("Worker de produção requer backend Python preparado; empacotamento ainda não homologado.")
            root = self.root(production_id)
            # Nenhum retry escreve sobre arquivos de tentativa anterior.
            if root.exists():
                raise WorkflowConflict("Saída de tentativa anterior presente. Concilie os artefatos e crie nova produção explícita.")
            root.mkdir(parents=True)
            if root.resolve() != root.absolute() or any(p.is_symlink() or p.is_junction() for p in [root, *root.parents]):
                raise WorkflowConflict("Diretório de produção não pode conter links.")
            (root / "plan.json").write_text(plan, encoding="utf-8")
            self.store.update(job_id, "running", new_attempt=True, result={"stage": "prepare"})
            await manager.emit(job_id, "state", "running")
            command = [sys.executable, str(Path(__file__).with_name("production_worker.py")), str(root)]
            if row["mode"] in {"local_demo", "local_pilot"} and self.settings.factory_root:
                command += ["--factory-source", str(self.settings.factory_root)]
            # Ambiente mínimo: nenhum token, .env, perfil ou credencial de operador.
            env = {k: v for k, v in os.environ.items() if k.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT"}}
            env.update(PYTHONUTF8="1", PYTHONUNBUFFERED="1")
            if row["mode"] == "local_pilot" and self.settings.alignment_model:
                env["HORUS_ALIGNMENT_MODEL"] = str(self.settings.alignment_model.resolve())
            if row["mode"] == "local_pilot" and self.settings.ffmpeg:
                env["HORUS_FFMPEG"] = str(self.settings.ffmpeg.resolve())
            if row["mode"] == "local_pilot" and self.settings.subtitle_font:
                env["HORUS_SUBTITLE_FONT"] = str(self.settings.subtitle_font.resolve())
            if row["mode"] == "local_pilot":
                for name, value in (("HORUS_PIPER_EXECUTABLE", self.settings.piper_executable),
                                    ("HORUS_PIPER_MODELS", self.settings.piper_models),
                                    ("HORUS_KOKORO_PYTHON", self.settings.kokoro_python),
                                    ("HORUS_KOKORO_MODEL_DIR", self.settings.kokoro_model_dir)):
                    if value: env[name] = str(value.resolve())
            manager.active_process = await OwnedProcess.start(command, env=env, cwd=root)
            process = manager.active_process.process
            if self.store.get_job(job_id)["status"] == "cancel_requested":
                await manager.active_process.stop()
            async def consume(reader):
                while raw := await reader.readline():
                    try:
                        event = json.loads(raw)
                        stage = event.get("stage")
                        if stage in {"prepare", "narration", "scenes", "align", "subtitles", "render", "quality", "review"}:
                            current = self.store.get_job(job_id)
                            self.store.update(job_id, current["status"], result={"stage": stage})
                            await manager.emit(job_id, "stage", stage)
                    except (ValueError, AttributeError):
                        pass  # Não persistir logs brutos de ferramentas externas.
            readers = asyncio.gather(consume(process.stdout), consume(process.stderr))
            try:
                await asyncio.wait_for(process.wait(), timeout=3600)
                await readers
            finally:
                await manager.active_process.stop()
                readers.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await readers
            if self.store.get_job(job_id)["status"] == "cancel_requested":
                self.store.update(job_id, "cancelled", result=self.store.get_job(job_id)["result"])
                return
            if not (root / "result.json").is_file():
                raise RuntimeError("Worker encerrou sem resultado validável.")
            result = json.loads(confined(root, "result.json").read_text(encoding="utf-8"))
            artifacts = [inspect_artifact(root, a["relative_path"], a["kind"]) for a in result.get("artifacts", [])]
            with self.store.connect() as db:
                db.execute("UPDATE productions SET artifacts=? WHERE id=?", (encode(artifacts), production_id))
            if process.returncode != 0 or result.get("blocked"):
                self.store.update(job_id, "blocked" if result.get("blocked") else "failed",
                    result=self.store.get_job(job_id)["result"], error=result.get("error", "Falha técnica no render offline."))
                return
            if row["mode"] == "simulated" and any(a["kind"] == "video" for a in artifacts):
                raise WorkflowConflict("Simulação não pode registrar vídeo.")
            if row["mode"] in {"local_demo", "local_pilot"} and not any(a["kind"] == "video" for a in artifacts):
                raise WorkflowConflict("Render sem vídeo real verificável.")
            if row["mode"] == "local_pilot":
                from .local_pilot import confirmed_metadata
                metadata = confirmed_metadata(root, artifacts)
            else:
                metadata = {"narration_kind": "fixture_tone", "narration_disclosure": "Tom sintético local; sem narração."}
            with self.store.connect() as db:
                db.execute("UPDATE productions SET artifacts=? WHERE id=?", (encode(artifacts), production_id))
            self.store.update(job_id, "succeeded", result={"stage": "review", "demo_only": True,
                **metadata})
        except asyncio.CancelledError:
            if manager.active_process:
                await manager.active_process.stop()
            self.store.update(job_id, "interrupted", result=self.store.get_job(job_id)["result"], error="Execução interrompida; concilie antes de repetir.")
            raise
        except WorkflowConflict as error:
            self.store.update(job_id, "blocked", result=self.store.get_job(job_id)["result"], error=str(error))
        except Exception:
            self.store.update(job_id, "failed", result=self.store.get_job(job_id)["result"], error="Falha na produção offline; revise dependências e artefatos locais.")
        finally:
            if manager.active_process:
                manager.active_process.close()
            manager.active_process, manager.active_id = None, None
            await manager.emit(job_id, "state", self.store.get_job(job_id)["status"])
