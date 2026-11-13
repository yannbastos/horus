"""Roteiros locais simulados; conteúdo versionado e revisão humana transacionais."""
from __future__ import annotations

import json
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .script_contract import validate_script
from .storage import now
from .workflows import RADAR_REDACTED, WorkflowConflict, WorkflowService, digest, encode, radar_redacted


class ScriptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1, strict=True)
    proposal_artifact_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class ScriptReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_version: int = Field(ge=1, strict=True)
    decision: Literal["approve", "reject", "request_changes"]
    feedback: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def require_feedback(self):
        if self.decision == "request_changes" and not self.feedback:
            raise ValueError("Descreva as alterações solicitadas.")
        return self


def simulate_script(proposal, feedback, allowed_source_ids):
    """Transformação fixa do snapshot, sem inferência ou acesso externo."""
    recommendation = proposal.get("recommendation") or {}
    premise = recommendation.get("premise") or proposal.get("text") or "Proposta editorial para revisão humana."
    return {"schema_version": 1, "simulated": True, "title": proposal["title"][:200], "sections": [
        {"id": "hook", "kind": "hook", "heading": "Abertura simulada",
         "narration": f"Roteiro simulado: {proposal['title']}", "source_ids": []},
        {"id": "body", "kind": "body", "heading": "Desenvolvimento simulado",
         "narration": f"Simulação baseada na proposta aprovada: {premise[:5000]}" + (
             f"\nAjustes da revisão anterior: {feedback.strip()}" if (feedback or "").strip() else ""),
         "source_ids": sorted(allowed_source_ids)[:50]},
        {"id": "conclusion", "kind": "conclusion", "heading": "Conclusão simulada",
         "narration": "Encerramento simulado. A aprovação deste roteiro não autoriza produção ou publicação.", "source_ids": []}]}


class ScriptService:
    def __init__(self, store):
        self.store = store

    @staticmethod
    def _record(row):
        item = dict(row)
        item["document"] = json.loads(item["document"])
        item["review"] = json.loads(item["review"]) if item["review"] else None
        return item

    @staticmethod
    def _require(db, script_id):
        row = db.execute("SELECT * FROM scripts WHERE id=?", (script_id,)).fetchone()
        if row is None:
            raise KeyError(script_id)
        return row

    @staticmethod
    def _replay(db, scope, key, request):
        row = db.execute("SELECT * FROM script_receipts WHERE scope=? AND idempotency_key=?", (scope, key)).fetchone()
        if row:
            if row["request"] != request:
                raise WorkflowConflict("Chave de idempotência já usada com outro pedido de roteiro.")
            return json.loads(row["response"])

    @staticmethod
    def _receipt(db, scope, key, request, record):
        db.execute("INSERT INTO script_receipts VALUES(?,?,?,?)", (scope, key, request, encode(record)))

    @staticmethod
    def _artifact(db, artifact_id, workflow_id, revision, stage):
        row = db.execute("SELECT * FROM artifacts WHERE id=? AND workflow_id=? AND revision=? AND stage=?",
                         (artifact_id, workflow_id, revision, stage)).fetchone()
        if not row:
            raise WorkflowConflict("Snapshot aprovado ausente ou inválido.")
        try:
            content = json.loads(row["content"])
            if digest(content) != row["content_hash"]:
                raise ValueError()
        except (ValueError, TypeError):
            raise WorkflowConflict("Snapshot aprovado com integridade inválida.") from None
        return row, content

    def get(self, script_id):
        with self.store.connect() as db:
            return self._record(self._require(db, script_id))

    def list(self, workflow_id):
        with self.store.connect() as db:
            db.execute("BEGIN")
            WorkflowService._require(db, workflow_id)
            return {"items": [self._record(row) for row in db.execute(
                "SELECT * FROM scripts WHERE workflow_id=? ORDER BY version DESC", (workflow_id,))]}

    def create(self, workflow_id, request: ScriptRequest, key):
        encoded, scope = encode(request.model_dump()), f"generate:{workflow_id}"
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            workflow = WorkflowService._require(db, workflow_id)
            replay = self._replay(db, scope, key, encoded)
            if replay is not None:
                return replay, False
            if (workflow["status"] != "approved" or workflow["revision"] != request.expected_revision
                    or workflow["current_artifact_id"] != request.proposal_artifact_id
                    or radar_redacted(json.loads(workflow["payload"]))):
                raise WorkflowConflict("Proposta aprovada e revisão atual são necessárias.")
            approval = db.execute("""SELECT 1 FROM approvals WHERE workflow_id=? AND revision=? AND artifact_id=?
                AND decision='approve' AND operator_id='local-operator' AND scope='editorial_proposal'""",
                (workflow_id, request.expected_revision, request.proposal_artifact_id)).fetchone()
            if not approval:
                raise WorkflowConflict("Aprovação humana persistida necessária.")
            artifact, proposal = self._artifact(db, request.proposal_artifact_id, workflow_id, request.expected_revision, "proposal")
            previous = db.execute("SELECT * FROM scripts WHERE workflow_id=? ORDER BY version DESC LIMIT 1", (workflow_id,)).fetchone()
            if previous and previous["status"] != "changes_requested":
                raise WorkflowConflict("O roteiro atual não permite nova geração.")
            # Proveniência de artefatos não é referência de fonte editorial.
            allowed = set()
            if proposal.get("schema_version") == 2:
                refs = proposal.get("source_artifact_ids", [])
                if len(refs) != 1:
                    raise WorkflowConflict("Snapshot da análise inválido.")
                _, analysis = self._artifact(db, refs[0], workflow_id, request.expected_revision, "analysis")
                allowed = {source["id"] for source in analysis["result"]["sources"]}
            feedback = json.loads(previous["review"])["feedback"] if previous else ""
            document = validate_script(simulate_script(proposal, feedback, allowed), allowed).model_dump(mode="json")
            script_id, timestamp = uuid.uuid4().hex, now()
            version = previous["version"] + 1 if previous else 1
            db.execute("""INSERT INTO scripts VALUES(?,?,?,?,?,?, 'awaiting_review',?,?,NULL)""",
                (script_id, workflow_id, request.expected_revision, artifact["id"], artifact["content_hash"], version, encode(document), timestamp))
            record = self._record(self._require(db, script_id))
            self._receipt(db, scope, key, encoded, record)
            WorkflowService._event(db, workflow_id, request.expected_revision, "script.created", {"script_id": script_id, "version": version})
            return record, True

    def review(self, script_id, request: ScriptReviewRequest, key):
        encoded, scope = encode(request.model_dump()), f"review:{script_id}"
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self._require(db, script_id)
            replay = self._replay(db, scope, key, encoded)
            if replay is not None:
                return replay
            if request.decision == "request_changes":
                workflow = WorkflowService._require(db, row["workflow_id"])
                if radar_redacted(json.loads(workflow["payload"])):
                    raise WorkflowConflict(RADAR_REDACTED)
            latest = db.execute("SELECT MAX(version) FROM scripts WHERE workflow_id=?", (row["workflow_id"],)).fetchone()[0]
            if row["status"] != "awaiting_review" or row["version"] != request.expected_version or row["version"] != latest:
                raise WorkflowConflict("Versão obsoleta ou roteiro fora da revisão humana.")
            status = {"approve": "approved", "reject": "rejected", "request_changes": "changes_requested"}[request.decision]
            review = {"decision": request.decision, "feedback": request.feedback, "reviewed_at": now()}
            db.execute("UPDATE scripts SET status=?,review=? WHERE id=?", (status, encode(review), script_id))
            record = self._record(self._require(db, script_id))
            self._receipt(db, scope, key, encoded, record)
            WorkflowService._event(db, row["workflow_id"], row["workflow_revision"], "script.reviewed",
                {"script_id": script_id, "version": row["version"], "decision": request.decision, "operator_id": "local-operator"})
            return record
