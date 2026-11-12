"""Fluxo editorial fixo e simulado. Executado exclusivamente pelo JobManager."""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .hermes_contract.models import ChannelProfile, Dataset
from .storage import Store, now
from .workflow_hermes import CognitiveFailure, CognitiveUnknown, HermesStageOutput, HermesStages

STAGES = ("planning", "research", "analysis", "proposal")
EXECUTORS = {"simulated": "editorial.simulated", "hermes": "editorial.hermes"}
# Etapas que podem gerar custo: exigem autorização humana explícita por execução.
AUTHORIZED_STAGES = {"hermes": {"analysis"}}
Stage = Literal["planning", "research", "analysis", "proposal"]


class WorkflowConflict(ValueError):
    pass


RADAR_REDACTED = "Dataset Radar expirado e removido pela política de retenção; colete uma nova revisão do Radar."


def radar_redacted(payload) -> bool:
    """True quando as cópias de dados do YouTube já foram redigidas (ver retention.py)."""
    radar = payload.get("radar") if isinstance(payload, dict) else None
    return bool(radar and radar.get("redacted_at"))


class WorkflowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    objective: str = Field(min_length=1, max_length=4000)
    references: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(default_factory=list, max_length=5)
    # Exigidos pelo executor Hermes; o executor é escolhido pelo servidor, nunca pelo payload.
    dataset: Dataset | None = None
    channel_profile: ChannelProfile | None = None


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1, strict=True)


class AuthorizationRequest(RevisionRequest):
    job_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class ReviewRequest(RevisionRequest):
    artifact_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    decision: Literal["approve", "reject", "request_changes"]
    feedback: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def require_feedback(self):
        if self.decision == "request_changes" and not self.feedback.strip():
            raise ValueError("Descreva as alterações solicitadas.")
        return self


class SimulatedOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    simulated: Literal[True]
    stage: Stage
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=8000)
    source_artifact_ids: list[str] = Field(max_length=1)


def encode(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(encode(value).encode("utf-8")).hexdigest()


async def simulate(context):
    """Sem rede, subprocessos, modelos, métricas inventadas ou execução de instruções."""
    await asyncio.sleep(0)
    descriptions = {
        "planning": "Plano fixo: organizar referências fornecidas, analisar e propor conteúdo para revisão humana.",
        "research": "Pesquisa simulada. As referências foram apenas registradas; nenhuma fonte externa foi consultada.",
        "analysis": "Análise simulada da solicitação. Não representa verificação factual ou análise real de vídeo.",
        "proposal": "Proposta editorial simulada. Requer revisão humana e não autoriza produção ou publicação.",
    }
    return {"schema_version": 1, "simulated": True, "stage": context["stage"],
            "title": f"{context['stage']} — simulação editorial",
            "text": f"{descriptions[context['stage']]} Objetivo: {context['objective']}\nAjustes: {context['feedback']}",
            "source_artifact_ids": [item["id"] for item in context["sources"]]}


class WorkflowService:
    def __init__(self, store: Store, queue: asyncio.Queue, notify, settings=None):
        self.store, self.queue, self.notify = store, queue, notify
        # Substituição somente em testes; nunca aceitar um executor informado pela API.
        self.executor = simulate
        self.executor_kind = getattr(settings, "workflow_executor", "simulated")
        if self.executor_kind not in EXECUTORS:
            raise ValueError("HORUS_WORKFLOW_EXECUTOR inválido. Use simulated ou hermes.")
        from .hermes_simulator import HermesSimulator
        simulator = HermesSimulator()
        self.hermes_simulated = HermesStages(store, settings, client_factory=lambda: simulator)
        self.hermes = HermesStages(store, settings) if settings is not None else None
        self.active_task: asyncio.Task | None = None
        self.active_job_id: str | None = None
        self.stop_requested: str | None = None

    @staticmethod
    def _require(db, workflow_id):
        row = db.execute("SELECT * FROM workflows WHERE id=?", (workflow_id,)).fetchone()
        if not row:
            raise KeyError(workflow_id)
        return row

    @staticmethod
    def _event(db, workflow_id, revision, kind, data):
        db.execute("INSERT INTO workflow_events(workflow_id,revision,kind,data,created_at) VALUES(?,?,?,?,?)",
                   (workflow_id, revision, kind, encode(data), now()))

    @staticmethod
    def _job_event(db, job_id, status):
        db.execute("INSERT INTO events(job_id,kind,message,created_at) VALUES(?,'state',?,?)", (job_id, status, now()))

    @classmethod
    def _job_status(cls, db, job_id, status, *, result=None, error=None):
        db.execute("UPDATE jobs SET status=?,updated_at=?,result=?,error=? WHERE id=?",
                   (status, now(), encode(result) if result is not None else None, error, job_id))
        cls._job_event(db, job_id, status)

    @classmethod
    def _create_steps(cls, db, workflow_id, revision, executor="simulated"):
        previous = None
        first = None
        for index, stage in enumerate(STAGES):
            job_id = uuid.uuid4().hex
            status = "waiting" if previous else "queued"
            payload = {"operation": EXECUTORS[executor], "stage": stage}
            timestamp = now()
            db.execute("""INSERT INTO jobs(id,idempotency_key,payload,status,created_at,updated_at,
                workflow_id,workflow_revision,step_key,step_index,depends_on) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                       (job_id, f"workflow:{workflow_id}:{revision}:{stage}", encode(payload), status,
                        timestamp, timestamp, workflow_id, revision, stage, index, previous))
            cls._job_event(db, job_id, status)
            first = first or job_id
            previous = job_id
        return first

    def get(self, workflow_id):
        with self.store.connect() as db:
            db.execute("BEGIN")  # Um snapshot consistente para workflow, etapas e revisões.
            item = dict(self._require(db, workflow_id))
            item.pop("idempotency_key")
            item["request"] = json.loads(item.pop("payload"))
            if item.pop("cognitive_client") == "simulated":
                item["executor"] = "hermes_simulated"
            item["request"].pop("_radar_request", None)
            item["simulated"] = item["executor"] in {"simulated", "hermes_simulated"}
            if "radar" in item["request"]:
                item["radar"] = item["request"]["radar"]
            item["steps"] = [self.store.job(row) for row in db.execute(
                "SELECT * FROM jobs WHERE workflow_id=? ORDER BY workflow_revision,step_index", (workflow_id,))]
            attempts = [dict(row) for row in db.execute("""SELECT a.* FROM job_attempts a JOIN jobs j ON j.id=a.job_id
                WHERE j.workflow_id=? ORDER BY j.workflow_revision,j.step_index,a.number""", (workflow_id,))]
            for attempt in attempts:
                attempt["input_artifacts"] = json.loads(attempt["input_artifacts"])
                attempt["result"] = json.loads(attempt["result"]) if attempt["result"] else None
            item["attempts"] = attempts
            artifacts = [dict(row) for row in db.execute(
                "SELECT * FROM artifacts WHERE workflow_id=? ORDER BY revision,created_at", (workflow_id,))]
            for artifact in artifacts:
                artifact["content"] = json.loads(artifact["content"])
            item["artifacts"] = artifacts
            item["approvals"] = [self._approval(row) for row in db.execute(
                "SELECT * FROM approvals WHERE workflow_id=? ORDER BY created_at", (workflow_id,))]
            # Corpo do pedido fica fora da resposta; chave, referência externa e consumo são rastreáveis.
            item["cognitive_runs"] = [{**dict(row), "usage": json.loads(row["usage"]) if row["usage"] else None}
                for row in db.execute("""SELECT r.id,r.job_id,r.attempt_id,r.provider,r.idempotency_key,r.external_ref,
                    r.status,r.remote_status,r.usage,r.error,r.created_at,r.updated_at FROM cognitive_runs r
                    JOIN jobs j ON j.id=r.job_id WHERE j.workflow_id=? ORDER BY r.created_at""", (workflow_id,))]
            item["authorizations"] = [{key: value for key, value in dict(row).items() if key not in {"request", "idempotency_key"}}
                for row in db.execute("SELECT * FROM authorizations WHERE workflow_id=? ORDER BY created_at", (workflow_id,))]
            pending = next((step for step in item["steps"] if step["status"] == "awaiting_authorization"
                            and step["workflow_revision"] == item["revision"]), None)
            item["pending_authorization"] = {"job_id": pending["id"], "stage": pending["step_key"]} if pending else None
            return item

    def list(self):
        with self.store.connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT id,status,revision,created_at,updated_at FROM workflows ORDER BY created_at DESC LIMIT 100")]

    @staticmethod
    def _approval(row):
        item = dict(row)
        item.pop("idempotency_key")
        item.pop("request")
        return item

    def events(self, workflow_id, after=0):
        with self.store.connect() as db:
            self._require(db, workflow_id)
            items = [dict(row) for row in db.execute(
                "SELECT * FROM workflow_events WHERE workflow_id=? AND sequence>? ORDER BY sequence LIMIT 200",
                (workflow_id, after))]
            for item in items:
                item["data"] = json.loads(item["data"])
            return items

    async def create(self, request: WorkflowRequest, key: str, *, executor=None, radar=None, radar_request=None):
        data = request.model_dump(mode="json", exclude_none=True)
        if radar is not None:
            data["radar"] = radar
            data["_radar_request"] = radar_request
        payload = encode(data)
        executor = executor or self.executor_kind
        cognitive_client = "simulated" if executor == "hermes_simulated" else "live"
        executor = "hermes" if executor == "hermes_simulated" else executor
        if executor in AUTHORIZED_STAGES and (request.dataset is None or request.channel_profile is None):
            raise WorkflowConflict("O executor Hermes exige dataset e channel_profile no pedido.")
        first = None
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM workflows WHERE idempotency_key=?", (key,)).fetchone()
            if existing:
                if existing["payload"] != payload:
                    raise WorkflowConflict("A chave de idempotência já identifica outro pedido editorial.")
                workflow_id = existing["id"]
            else:
                workflow_id, timestamp = uuid.uuid4().hex, now()
                db.execute("""INSERT INTO workflows(id,idempotency_key,payload,revision,status,created_at,updated_at,executor,cognitive_client)
                    VALUES(?,?,?,1,'queued',?,?,?,?)""", (workflow_id, key, payload, timestamp, timestamp, executor, cognitive_client))
                first = self._create_steps(db, workflow_id, 1, executor)
                self._event(db, workflow_id, 1, "workflow.created", {"simulated": executor == "simulated" or cognitive_client == "simulated",
                    "executor": "hermes_simulated" if cognitive_client == "simulated" else executor})
        if first:
            self.queue.put_nowait(first)
            await self.notify()
        return self.get(workflow_id)

    def _claim(self, job_id):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            job = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            workflow = self._require(db, job["workflow_id"])
            if job["status"] != "queued" or workflow["status"] not in {"queued", "running"}:
                return None
            if job["workflow_revision"] != workflow["revision"]:
                return None
            if radar_redacted(json.loads(workflow["payload"])):
                raise WorkflowConflict(RADAR_REDACTED)
            stage = job["step_key"]
            if stage not in STAGES or job["step_index"] != STAGES.index(stage):
                raise WorkflowConflict("Etapa editorial inválida.")
            executor = workflow["executor"]
            if json.loads(job["payload"]) != {"operation": EXECUTORS[executor], "stage": stage}:
                raise WorkflowConflict("Operação editorial não autorizada.")
            sources = []
            if job["step_index"]:
                previous = db.execute("""SELECT * FROM jobs WHERE id=? AND workflow_id=?
                    AND workflow_revision=? AND step_index=?""",
                    (job["depends_on"], workflow["id"], workflow["revision"], job["step_index"] - 1)).fetchone()
                if not previous or previous["status"] != "succeeded":
                    raise WorkflowConflict("A dependência desta etapa não foi concluída.")
                source = db.execute("SELECT * FROM artifacts WHERE job_id=?", (previous["id"],)).fetchone()
                if not source or digest(json.loads(source["content"])) != source["content_hash"]:
                    raise WorkflowConflict("Artefato de entrada ausente ou com integridade inválida.")
                sources = [{"id": source["id"], "content": json.loads(source["content"]), "hash": source["content_hash"]}]
            elif job["depends_on"] is not None:
                raise WorkflowConflict("A primeira etapa não aceita dependências.")
            request = json.loads(workflow["payload"])
            context = {**request, "workflow_id": workflow["id"], "revision": workflow["revision"], "job_id": job_id,
                       "stage": stage, "feedback": workflow["feedback"], "sources": sources, "executor": executor, "cognitive_client": workflow["cognitive_client"]}
            attempt_id, timestamp = uuid.uuid4().hex, now()
            if stage in AUTHORIZED_STAGES.get(executor, ()):
                unknown = db.execute("""SELECT * FROM cognitive_runs WHERE job_id=? AND status='unknown'
                    ORDER BY created_at DESC LIMIT 1""", (job_id,)).fetchone()
                if unknown:
                    # Conciliação: segue a execução remota existente, sem nova autorização nem novo envio.
                    context["resume_run"] = dict(unknown)
                else:
                    grant = db.execute("""SELECT id FROM authorizations WHERE job_id=? AND revision=?
                        AND consumed_attempt_id IS NULL ORDER BY created_at LIMIT 1""", (job_id, workflow["revision"])).fetchone()
                    if not grant:
                        raise WorkflowConflict("Execução cognitiva sem autorização humana vigente.")
                    context["authorization_id"] = grant["id"]
            executor_name = "simulated-v1" if executor == "simulated" else (
                "hermes-v1" if stage in AUTHORIZED_STAGES.get(executor, ()) else "local-v1")
            db.execute("UPDATE jobs SET status='running',attempt=attempt+1,updated_at=?,error=NULL,result=NULL WHERE id=?",
                       (timestamp, job_id))
            db.execute("""INSERT INTO job_attempts(id,job_id,number,status,executor,input_hash,input_artifacts,started_at)
                VALUES(?,?,?,'running',?,?,?,?)""",
                (attempt_id, job_id, job["attempt"] + 1, executor_name, digest(context),
                 encode([s["id"] for s in sources]), timestamp))
            if context.get("authorization_id"):
                db.execute("UPDATE authorizations SET consumed_attempt_id=? WHERE id=?", (attempt_id, context["authorization_id"]))
            db.execute("UPDATE workflows SET status='running',updated_at=? WHERE id=?", (timestamp, workflow["id"]))
            self._job_event(db, job_id, "running")
            self._event(db, workflow["id"], workflow["revision"], "step.started", {"job_id": job_id, "attempt_id": attempt_id, "stage": stage})
            return attempt_id, context

    @classmethod
    def _cancel_remaining(cls, db, workflow_id):
        for row in db.execute("""SELECT id FROM jobs WHERE workflow_id=?
                AND status IN ('waiting','queued','awaiting_authorization')""", (workflow_id,)).fetchall():
            cls._job_status(db, row["id"], "cancelled")

    def _finish(self, job_id, attempt_id, outcome, *, content=None, error=None):
        next_job = None
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            attempt = db.execute("SELECT * FROM job_attempts WHERE id=? AND job_id=?", (attempt_id, job_id)).fetchone()
            if not attempt or attempt["status"] != "running":
                return None
            job = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            workflow = self._require(db, job["workflow_id"])
            if workflow["status"] == "cancel_requested":
                outcome, content = "cancelled", None
            elif workflow["revision"] != job["workflow_revision"] or workflow["status"] != "running":
                outcome, content, error = "interrupted", None, "Resultado fora da revisão ativa."
            result = None
            if outcome == "succeeded":
                artifact_id = uuid.uuid4().hex
                db.execute("""INSERT INTO artifacts(id,workflow_id,revision,stage,job_id,attempt_id,schema_version,
                    content,content_hash,created_at) VALUES(?,?,?,?,?,?,1,?,?,?)""",
                    (artifact_id, workflow["id"], workflow["revision"], job["step_key"], job_id, attempt_id,
                     encode(content), digest(content), now()))
                result = {"artifact_id": artifact_id, "simulated": True, "stage": job["step_key"]}
                following = db.execute("SELECT * FROM jobs WHERE depends_on=?", (job_id,)).fetchone()
                if following:
                    if (following["status"] != "waiting" or following["workflow_revision"] != workflow["revision"]
                            or following["workflow_id"] != workflow["id"] or following["step_index"] != job["step_index"] + 1):
                        raise WorkflowConflict("Transição inconsistente para a próxima etapa.")
                    if following["step_key"] in AUTHORIZED_STAGES.get(workflow["executor"], ()):
                        # Não enfileirar: custo potencial exige autorização humana desta revisão.
                        self._job_status(db, following["id"], "awaiting_authorization")
                        db.execute("UPDATE workflows SET status='queued' WHERE id=?", (workflow["id"],))
                        self._event(db, workflow["id"], workflow["revision"], "workflow.authorization_required",
                                    {"job_id": following["id"], "stage": following["step_key"]})
                    else:
                        self._job_status(db, following["id"], "queued")
                        next_job = following["id"]
                else:
                    if job["step_key"] != "proposal":
                        raise WorkflowConflict("O fluxo editorial não pode terminar antes da proposta.")
                    db.execute("UPDATE workflows SET status='awaiting_approval',current_artifact_id=? WHERE id=?",
                               (artifact_id, workflow["id"]))
                    self._event(db, workflow["id"], workflow["revision"], "workflow.awaiting_approval", result)
            else:
                db.execute("UPDATE workflows SET status=? WHERE id=?", (outcome, workflow["id"]))
                if outcome == "cancelled":
                    self._cancel_remaining(db, workflow["id"])
            self._job_status(db, job_id, outcome, result=result, error=error)
            db.execute("UPDATE job_attempts SET status=?,finished_at=?,result=?,error=? WHERE id=?",
                       (outcome, now(), encode(result) if result else None, error, attempt_id))
            db.execute("UPDATE workflows SET updated_at=? WHERE id=?", (now(), workflow["id"]))
            self._event(db, workflow["id"], workflow["revision"], f"step.{outcome}",
                        {"job_id": job_id, "attempt_id": attempt_id, "stage": job["step_key"], "error": error})
        return next_job

    async def run_step(self, job):
        try:
            claimed = self._claim(job["id"])
        except (ValueError, KeyError) as error:
            with self.store.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                self._job_status(db, job["id"], "blocked", error=str(error))
                db.execute("UPDATE workflows SET status='failed',updated_at=? WHERE id=?", (now(), job["workflow_id"]))
                self._event(db, job["workflow_id"], job["workflow_revision"], "step.blocked", {"job_id": job["id"], "error": str(error)})
            await self.notify()
            return
        if not claimed:
            return
        attempt_id, context = claimed
        self.active_job_id = job["id"]
        try:
            if context["executor"] in AUTHORIZED_STAGES:
                stages = self.hermes_simulated if context["cognitive_client"] == "simulated" else self.hermes
                # Etapas locais são instantâneas; a cognitiva controla o próprio prazo e o cancelamento remoto.
                stage = context["stage"]
                if stage == "analysis":
                    work = stages.analysis(context, attempt_id, lambda: self.stop_requested == job["id"])
                else:
                    work = asyncio.to_thread(getattr(stages, stage), context)
                self.active_task = asyncio.create_task(work)
                await self.notify()
                content = await self.active_task
                content["simulated"] = context["cognitive_client"] == "simulated"
                output = HermesStageOutput.model_validate(content)
            else:
                self.active_task = asyncio.create_task(self.executor(context))
                await self.notify()
                output = SimulatedOutput.model_validate(await asyncio.wait_for(self.active_task, timeout=5))
            if output.stage != context["stage"] or output.source_artifact_ids != [s["id"] for s in context["sources"]]:
                raise WorkflowConflict("Resultado não corresponde à etapa ou aos artefatos de entrada.")
            next_job = self._finish(job["id"], attempt_id, "succeeded", content=output.model_dump())
            if next_job:
                self.queue.put_nowait(next_job)
        except asyncio.CancelledError:
            interrupted = asyncio.current_task().cancelling() > 0
            self._finish(job["id"], attempt_id, "interrupted" if interrupted else "cancelled", error="Execução interrompida.")
            if interrupted:
                raise
        except CognitiveUnknown as error:
            # Sem nova tentativa até conciliar a mesma execução remota.
            self._finish(job["id"], attempt_id, "interrupted", error=str(error)[:2000])
        except CognitiveFailure as error:
            self._finish(job["id"], attempt_id, "failed", error=str(error)[:2000])
        except Exception as error:
            self._finish(job["id"], attempt_id, "failed", error=f"{type(error).__name__}: {error}"[:2000])
        finally:
            if self.active_task and not self.active_task.done():
                self.active_task.cancel()
                try:
                    await self.active_task
                except asyncio.CancelledError:
                    pass
            self.active_task = None
            self.active_job_id = None
            if self.stop_requested == job["id"]:
                self.stop_requested = None
            await self.notify()

    def recover(self):
        with self.store.connect() as db:
            # Execução remota pode ter continuado: desfecho desconhecido até conciliar.
            db.execute("""UPDATE cognitive_runs SET status='unknown',updated_at=?,
                error=COALESCE(error,'Backend encerrado durante a execução remota.')
                WHERE status IN ('submitting','admitted')""", (now(),))
            active = db.execute("""SELECT j.id,a.id AS attempt_id FROM jobs j JOIN job_attempts a ON a.job_id=j.id
                WHERE j.workflow_id IS NOT NULL AND a.status='running'""").fetchall()
        for row in active:
            self._finish(row["id"], row["attempt_id"], "interrupted", error="Backend interrompido. Nova tentativa exige ação explícita.")

    async def cancel(self, workflow_id):
        active_job = None
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            workflow = self._require(db, workflow_id)
            if workflow["status"] in {"approved", "rejected", "cancelled"}:
                return self.get(workflow_id)
            active = db.execute("SELECT id FROM jobs WHERE workflow_id=? AND status IN ('running','cancel_requested')", (workflow_id,)).fetchone()
            self._cancel_remaining(db, workflow_id)
            status = "cancel_requested" if active else "cancelled"
            if active:
                active_job = active["id"]
                self._job_status(db, active_job, "cancel_requested")
            db.execute("UPDATE workflows SET status=?,updated_at=? WHERE id=?", (status, now(), workflow_id))
            self._event(db, workflow_id, workflow["revision"], f"workflow.{status}", {})
        if active_job == self.active_job_id and self.active_task:
            self.stop_requested = active_job  # cancelamento do operador: pedir parada remota
            self.active_task.cancel()
        await self.notify()
        return self.get(workflow_id)

    async def retry(self, workflow_id, revision):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            workflow = self._require(db, workflow_id)
            if radar_redacted(json.loads(workflow["payload"])):
                raise WorkflowConflict(RADAR_REDACTED)
            if workflow["revision"] != revision or workflow["status"] not in {"failed", "interrupted"}:
                raise WorkflowConflict("Somente a revisão atual com falha ou interrupção pode ser retomada.")
            job = db.execute("""SELECT * FROM jobs WHERE workflow_id=? AND workflow_revision=?
                AND status IN ('failed','interrupted','blocked') ORDER BY step_index LIMIT 1""", (workflow_id, revision)).fetchone()
            if not job:
                raise WorkflowConflict("Não há etapa recuperável nesta revisão.")
            paid = job["step_key"] in AUTHORIZED_STAGES.get(workflow["executor"], ())
            if paid and db.execute("SELECT 1 FROM cognitive_runs WHERE job_id=? AND status='unknown'", (job["id"],)).fetchone():
                raise WorkflowConflict("A execução cognitiva anterior tem desfecho desconhecido. Concilie antes de tentar novamente.")
            # Nova execução paga nunca é automática: retry volta a pedir autorização humana.
            self._job_status(db, job["id"], "awaiting_authorization" if paid else "queued")
            db.execute("UPDATE workflows SET status='queued',updated_at=? WHERE id=?", (now(), workflow_id))
            self._event(db, workflow_id, revision, "workflow.authorization_required" if paid else "workflow.retried",
                        {"job_id": job["id"], "stage": job["step_key"]})
        if not paid:
            self.queue.put_nowait(job["id"])
        await self.notify()
        return self.get(workflow_id)

    async def authorize(self, workflow_id, request: AuthorizationRequest, key: str):
        """Autorização humana de UMA execução cognitiva sobre o snapshot desta revisão."""
        encoded = encode(request.model_dump())
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            workflow = self._require(db, workflow_id)
            if radar_redacted(json.loads(workflow["payload"])):
                raise WorkflowConflict(RADAR_REDACTED)
            radar = json.loads(workflow["payload"]).get("radar")
            if radar and datetime.fromisoformat(radar["expires_at"].replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                raise WorkflowConflict("Dataset Radar expirado; colete uma nova revisão antes de autorizar.")
            existing = db.execute("SELECT * FROM authorizations WHERE workflow_id=? AND idempotency_key=?", (workflow_id, key)).fetchone()
            if existing:
                if existing["request"] != encoded:
                    raise WorkflowConflict("Chave de autorização já usada com outro pedido.")
                return self.get(workflow_id)
            job = db.execute("SELECT * FROM jobs WHERE id=? AND workflow_id=?", (request.job_id, workflow_id)).fetchone()
            if (workflow["revision"] != request.expected_revision or not job or job["status"] != "awaiting_authorization"
                    or job["workflow_revision"] != workflow["revision"]
                    or job["step_key"] not in AUTHORIZED_STAGES.get(workflow["executor"], ())):
                raise WorkflowConflict("Nenhuma etapa desta revisão aguarda autorização com esse identificador.")
            source = db.execute("SELECT * FROM artifacts WHERE job_id=?", (job["depends_on"],)).fetchone()
            if not source or digest(json.loads(source["content"])) != source["content_hash"]:
                raise WorkflowConflict("Artefato de entrada ausente ou com integridade inválida.")
            authorization_id = uuid.uuid4().hex
            db.execute("""INSERT INTO authorizations(id,workflow_id,revision,job_id,input_artifact_id,scope,max_runs,
                operator_id,idempotency_key,request,created_at) VALUES(?,?,?,?,?,'cognitive_run',1,'local-operator',?,?,?)""",
                       (authorization_id, workflow_id, workflow["revision"], job["id"], source["id"], key, encoded, now()))
            self._job_status(db, job["id"], "queued")
            db.execute("UPDATE workflows SET status='queued',updated_at=? WHERE id=?", (now(), workflow_id))
            self._event(db, workflow_id, workflow["revision"], "workflow.authorized",
                        {"authorization_id": authorization_id, "job_id": job["id"], "max_runs": 1})
        self.queue.put_nowait(job["id"])
        await self.notify()
        return self.get(workflow_id)

    async def reconcile(self, workflow_id, revision):
        """Retoma o acompanhamento da MESMA execução remota de desfecho desconhecido; nunca reenvia."""
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            workflow = self._require(db, workflow_id)
            if radar_redacted(json.loads(workflow["payload"])):
                raise WorkflowConflict(RADAR_REDACTED)
            if workflow["revision"] != revision or workflow["status"] not in {"failed", "interrupted"}:
                raise WorkflowConflict("Somente a revisão atual com falha ou interrupção pode ser conciliada.")
            job = db.execute("""SELECT j.* FROM jobs j JOIN cognitive_runs r ON r.job_id=j.id
                WHERE j.workflow_id=? AND j.workflow_revision=? AND j.status IN ('failed','interrupted')
                AND r.status='unknown' ORDER BY r.created_at DESC LIMIT 1""", (workflow_id, revision)).fetchone()
            if not job:
                raise WorkflowConflict("Não há execução cognitiva com desfecho desconhecido nesta revisão.")
            self._job_status(db, job["id"], "queued")
            db.execute("UPDATE workflows SET status='queued',updated_at=? WHERE id=?", (now(), workflow_id))
            self._event(db, workflow_id, revision, "workflow.reconciling", {"job_id": job["id"]})
        self.queue.put_nowait(job["id"])
        await self.notify()
        return self.get(workflow_id)

    async def review(self, workflow_id, request: ReviewRequest, key: str):
        encoded = encode(request.model_dump())
        next_job = None
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            workflow = self._require(db, workflow_id)
            existing = db.execute("SELECT * FROM approvals WHERE workflow_id=? AND idempotency_key=?", (workflow_id, key)).fetchone()
            if existing:
                if existing["request"] != encoded:
                    raise WorkflowConflict("Chave de revisão já usada com outra decisão.")
                approval_id = existing["id"]
            else:
                if (workflow["status"] != "awaiting_approval" or workflow["revision"] != request.expected_revision
                        or workflow["current_artifact_id"] != request.artifact_id):
                    raise WorkflowConflict("Proposta ou revisão obsoleta, ou workflow fora da revisão humana.")
                artifact = db.execute("SELECT * FROM artifacts WHERE id=? AND workflow_id=? AND revision=? AND stage='proposal'",
                                      (request.artifact_id, workflow_id, request.expected_revision)).fetchone()
                if not artifact or digest(json.loads(artifact["content"])) != artifact["content_hash"]:
                    raise WorkflowConflict("Proposta com integridade inválida.")
                if request.decision == "request_changes" and radar_redacted(json.loads(workflow["payload"])):
                    raise WorkflowConflict(RADAR_REDACTED)  # nova revisão reexecutaria análise sem o dataset
                approval_id = uuid.uuid4().hex
                db.execute("""INSERT INTO approvals VALUES(?,?,?,?,?,?,'local-operator','editorial_proposal',?,?,?)""",
                           (approval_id, workflow_id, workflow["revision"], request.artifact_id, request.decision,
                            request.feedback, # operador vem do backend, nunca do payload do executor
                            key, encoded, now()))
                self._event(db, workflow_id, workflow["revision"], "review.recorded", {"approval_id": approval_id, "decision": request.decision})
                if request.decision == "request_changes":
                    revision = workflow["revision"] + 1
                    db.execute("""UPDATE workflows SET revision=?,status='queued',current_artifact_id=NULL,feedback=?,updated_at=? WHERE id=?""",
                               (revision, request.feedback, now(), workflow_id))
                    next_job = self._create_steps(db, workflow_id, revision, workflow["executor"])
                    self._event(db, workflow_id, revision, "workflow.revised", {"previous_revision": workflow["revision"]})
                else:
                    db.execute("UPDATE workflows SET status=?,updated_at=? WHERE id=?",
                               ("approved" if request.decision == "approve" else "rejected", now(), workflow_id))
            approval = self._approval(db.execute("SELECT * FROM approvals WHERE id=?", (approval_id,)).fetchone())
        if next_job:
            self.queue.put_nowait(next_job)
        await self.notify()
        return {"approval": approval, "workflow": self.get(workflow_id)}
