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


class ManualScriptRequest(BaseModel):
    """Primeiro roteiro escrito pelo usuário; mesmas exigências de proposta aprovada da geração simulada."""
    model_config = ConfigDict(extra="forbid")
    source: Literal["manual"]
    expected_revision: int = Field(ge=1, strict=True)
    proposal_artifact_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    document: dict


class ScriptVersionRequest(BaseModel):
    """Nova versão com o texto do usuário. O documento é validado depois, pelo contrato, com erro sanitizado."""
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)
    document: dict


def diff_documents(previous, document):
    """Diferença de campos entre duas versões; só ids e nomes de campos, nunca o texto."""
    before = {section["id"]: section for section in previous["sections"]}
    after = {section["id"]: section for section in document["sections"]}
    changed = [{"id": key, "fields": [field for field in ("kind", "heading", "narration", "source_ids")
                                       if before[key][field] != after[key][field]]}
               for key in after if key in before and before[key] != after[key]]
    return {"title_changed": previous["title"] != document["title"],
            "sections_added": [key for key in after if key not in before],
            "sections_removed": [key for key in before if key not in after],
            "sections_changed": changed,
            "order_changed": [k for k in before if k in after] != [k for k in after if k in before]}


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
        item["origin"] = item.get("origin", "simulated")  # esquema anterior à v9
        item["authored_by"] = item["origin"]
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
            items = [self._record(row) for row in db.execute(
                "SELECT * FROM scripts WHERE workflow_id=? ORDER BY version DESC", (workflow_id,))]
            for index, item in enumerate(items):
                older = items[index + 1] if index + 1 < len(items) else None
                item["changes"] = ({"previous_version": older["version"], **diff_documents(older["document"], item["document"])}
                                   if older else None)
            return {"items": items}

    def _allowed_sources(self, db, workflow_id, proposal, revision):
        # Proveniência de artefatos não é referência de fonte editorial.
        allowed = set()
        if proposal.get("schema_version") == 2:
            refs = proposal.get("source_artifact_ids", [])
            if len(refs) != 1:
                raise WorkflowConflict("Snapshot da análise inválido.")
            _, analysis = self._artifact(db, refs[0], workflow_id, revision, "analysis")
            allowed = {source["id"] for source in analysis["result"]["sources"]}
        return allowed

    def _insert(self, db, scope, key, encoded, workflow_id, revision, artifact, version, document, origin):
        script_id, timestamp = uuid.uuid4().hex, now()
        # Simulado usa o INSERT legado (origin assume o padrão), compatível com bancos de esquema anterior.
        db.execute("""INSERT INTO scripts(id,workflow_id,workflow_revision,proposal_artifact_id,proposal_content_hash,
            version,status,document,created_at,review) VALUES(?,?,?,?,?,?, 'awaiting_review',?,?,NULL)""",
            (script_id, workflow_id, revision, artifact["id"], artifact["content_hash"], version, encode(document), timestamp))
        if origin != "simulated":
            db.execute("UPDATE scripts SET origin=? WHERE id=?", (origin, script_id))
        record = self._record(self._require(db, script_id))
        self._receipt(db, scope, key, encoded, record)
        WorkflowService._event(db, workflow_id, revision, "script.created",
                               {"script_id": script_id, "version": version, "origin": origin})
        return record

    def create(self, workflow_id, request: ScriptRequest | ManualScriptRequest, key):
        manual = isinstance(request, ManualScriptRequest)
        encoded, scope = encode(request.model_dump()), f"generate:{workflow_id}"
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            workflow = WorkflowService._require(db, workflow_id)
            replay = self._replay(db, scope, key, encoded)
            if replay is not None:
                return replay, False
            redacted = radar_redacted(json.loads(workflow["payload"]))
            if (workflow["status"] != "approved" or workflow["revision"] != request.expected_revision
                    or workflow["current_artifact_id"] != request.proposal_artifact_id or (redacted and not manual)):
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
            if manual:
                # Texto do usuário é dado: não é interpretado nem enviado a nenhum executor.
                allowed = set() if redacted else self._allowed_sources(db, workflow_id, proposal, request.expected_revision)
                document = validate_script(request.document, allowed, "human")
            else:
                allowed = self._allowed_sources(db, workflow_id, proposal, request.expected_revision)
                feedback = json.loads(previous["review"])["feedback"] if previous else ""
                document = validate_script(simulate_script(proposal, feedback, allowed), allowed)
            version = previous["version"] + 1 if previous else 1
            record = self._insert(db, scope, key, encoded, workflow_id, request.expected_revision, artifact, version,
                                  document.model_dump(mode="json"), "human" if manual else "simulated")
            return record, True

    def new_version(self, script_id, request: ScriptVersionRequest, key):
        """Versão N+1 escrita pelo usuário; nunca aprova: a decisão continua em `review`."""
        encoded, scope = encode(request.model_dump()), f"version:{script_id}"
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self._require(db, script_id)
            replay = self._replay(db, scope, key, encoded)
            if replay is not None:
                return replay, False
            workflow = WorkflowService._require(db, row["workflow_id"])
            latest = db.execute("SELECT MAX(version) FROM scripts WHERE workflow_id=?", (row["workflow_id"],)).fetchone()[0]
            if row["version"] != request.expected_version or row["version"] != latest:
                raise WorkflowConflict("Versão obsoleta: edite a versão mais recente do roteiro.")
            if row["status"] not in ("awaiting_review", "changes_requested"):
                raise WorkflowConflict("Roteiro aprovado ou rejeitado não aceita nova versão.")
            if (workflow["status"] != "approved" or workflow["revision"] != row["workflow_revision"]
                    or workflow["current_artifact_id"] != row["proposal_artifact_id"]):
                raise WorkflowConflict("Proposta aprovada e revisão atual são necessárias.")
            artifact, proposal = self._artifact(db, row["proposal_artifact_id"], row["workflow_id"], row["workflow_revision"], "proposal")
            allowed = (set() if radar_redacted(json.loads(workflow["payload"]))
                       else self._allowed_sources(db, row["workflow_id"], proposal, row["workflow_revision"]))
            document = validate_script(request.document, allowed, "human")
            record = self._insert(db, scope, key, encoded, row["workflow_id"], row["workflow_revision"], artifact,
                                  row["version"] + 1, document.model_dump(mode="json"), "human")
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
