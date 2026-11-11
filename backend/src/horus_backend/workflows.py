"""Fluxo editorial fixo e simulado. Executado exclusivamente pelo JobManager."""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .storage import Store, now

STAGES = ("planning", "research", "analysis", "proposal")
Stage = Literal["planning", "research", "analysis", "proposal"]


class WorkflowConflict(ValueError):
    pass


class WorkflowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    objective: str = Field(min_length=1, max_length=4000)
    references: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(default_factory=list, max_length=5)


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1, strict=True)


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
    def __init__(self, store: Store, queue: asyncio.Queue, notify):
        self.store, self.queue, self.notify = store, queue, notify
        # Substituição somente em testes; nunca aceitar um executor informado pela API.
        self.executor = simulate
        self.active_task: asyncio.Task | None = None
        self.active_job_id: str | None = None

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
    def _create_steps(cls, db, workflow_id, revision):
        previous = None
        first = None
        for index, stage in enumerate(STAGES):
            job_id = uuid.uuid4().hex
            status = "waiting" if previous else "queued"
            payload = {"operation": "editorial.simulated", "stage": stage}
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
            item["simulated"] = True
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

    async def create(self, request: WorkflowRequest, key: str):
        payload = encode(request.model_dump())
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
                db.execute("""INSERT INTO workflows(id,idempotency_key,payload,revision,status,created_at,updated_at)
                    VALUES(?,?,?,1,'queued',?,?)""", (workflow_id, key, payload, timestamp, timestamp))
                first = self._create_steps(db, workflow_id, 1)
                self._event(db, workflow_id, 1, "workflow.created", {"simulated": True})
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
            stage = job["step_key"]
            if stage not in STAGES or job["step_index"] != STAGES.index(stage):
                raise WorkflowConflict("Etapa editorial inválida.")
            if json.loads(job["payload"]) != {"operation": "editorial.simulated", "stage": stage}:
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
            context = {**request, "workflow_id": workflow["id"], "revision": workflow["revision"],
                       "stage": stage, "feedback": workflow["feedback"], "sources": sources}
            attempt_id, timestamp = uuid.uuid4().hex, now()
            db.execute("UPDATE jobs SET status='running',attempt=attempt+1,updated_at=?,error=NULL,result=NULL WHERE id=?",
                       (timestamp, job_id))
            db.execute("""INSERT INTO job_attempts(id,job_id,number,status,executor,input_hash,input_artifacts,started_at)
                VALUES(?,?,?,'running','simulated-v1',?,?,?)""",
                (attempt_id, job_id, job["attempt"] + 1, digest(context), encode([s["id"] for s in sources]), timestamp))
            db.execute("UPDATE workflows SET status='running',updated_at=? WHERE id=?", (timestamp, workflow["id"]))
            self._job_event(db, job_id, "running")
            self._event(db, workflow["id"], workflow["revision"], "step.started", {"job_id": job_id, "attempt_id": attempt_id, "stage": stage})
            return attempt_id, context

    @classmethod
    def _cancel_remaining(cls, db, workflow_id):
        for row in db.execute("SELECT id FROM jobs WHERE workflow_id=? AND status IN ('waiting','queued')", (workflow_id,)).fetchall():
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
            self._finish(job["id"], attempt_id, "interrupted" if interrupted else "cancelled", error="Execução simulada interrompida.")
            if interrupted:
                raise
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
            await self.notify()

    def recover(self):
        with self.store.connect() as db:
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
            self.active_task.cancel()
        await self.notify()
        return self.get(workflow_id)

    async def retry(self, workflow_id, revision):
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            workflow = self._require(db, workflow_id)
            if workflow["revision"] != revision or workflow["status"] not in {"failed", "interrupted"}:
                raise WorkflowConflict("Somente a revisão atual com falha ou interrupção pode ser retomada.")
            job = db.execute("""SELECT * FROM jobs WHERE workflow_id=? AND workflow_revision=?
                AND status IN ('failed','interrupted','blocked') ORDER BY step_index LIMIT 1""", (workflow_id, revision)).fetchone()
            if not job:
                raise WorkflowConflict("Não há etapa recuperável nesta revisão.")
            self._job_status(db, job["id"], "queued")
            db.execute("UPDATE workflows SET status='queued',updated_at=? WHERE id=?", (now(), workflow_id))
            self._event(db, workflow_id, revision, "workflow.retried", {"job_id": job["id"]})
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
                    next_job = self._create_steps(db, workflow_id, revision)
                    self._event(db, workflow_id, revision, "workflow.revised", {"previous_revision": workflow["revision"]})
                else:
                    db.execute("UPDATE workflows SET status=?,updated_at=? WHERE id=?",
                               ("approved" if request.decision == "approve" else "rejected", now(), workflow_id))
            approval = self._approval(db.execute("SELECT * FROM approvals WHERE id=?", (approval_id,)).fetchone())
        if next_job:
            self.queue.put_nowait(next_job)
        await self.notify()
        return {"approval": approval, "workflow": self.get(workflow_id)}
