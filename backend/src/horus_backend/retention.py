"""Retenção das cópias de dados públicos do YouTube no banco operacional (política de 28 dias do Radar).

Os dados do dataset são *redigidos* (substituídos por um marcador estável com o hash do original), sem apagar
linhas, sem alterar estados e sem tocar em conteúdo editorial, decisões ou hashes existentes. Cada workflow é
redigido em uma única transação BEGIN IMMEDIATE. Idempotente: workflow com `radar.redacted_at` é ignorado.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .storage import Store
from .workflows import WorkflowService, digest, encode

REASON = "radar_retention"
ERROR_MARKER = "[redigido: retenção do Radar]"
# Workflows com execução em andamento são adiados: a etapa em curso ainda gravaria o dataset em um artefato.
ACTIVE = {"running", "cancel_requested"}
log = logging.getLogger(__name__)


@dataclass
class RetentionReport:
    dry_run: bool = False
    evaluated: int = 0
    redacted: int = 0
    already_redacted: int = 0
    not_expired: int = 0
    deferred_active: int = 0
    failed: int = 0
    workflow_ids: list[str] = field(default_factory=list)  # redigidos (ou que seriam, em dry-run)
    errors: list[dict] = field(default_factory=list)

    @property
    def ignored(self) -> int:
        return self.already_redacted + self.not_expired + self.deferred_active


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def is_marker(value) -> bool:
    return isinstance(value, dict) and value.get("redacted") is True and value.get("reason") == REASON


def marker(original, expired_at: str) -> dict:
    return {"redacted": True, "reason": REASON, "expired_at": expired_at, "sha256": digest(original)}


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _literals(dataset) -> list[str]:
    """Textos do YouTube cuja presença literal em campos preservados é registrada ou removida de erros."""
    found = set()
    for item in (dataset.get("items") or []) if isinstance(dataset, dict) else []:
        for key in ("title", "url", "channel"):
            text = item.get(key)
            if isinstance(text, str) and len(text) >= 4:
                found.add(text.lower())
    return sorted(found)


def _hits(value, literals) -> int:
    return sum(any(literal in text.lower() for literal in literals) for text in _strings(value))


def _redact_artifacts(db, workflow_id, expired_at, literals) -> tuple[int, int]:
    """research.dataset e analysis.result.sources/facts. Proposta e demais campos editoriais ficam intactos."""
    changed = literal_hits = 0
    for row in db.execute("SELECT id,stage,content FROM artifacts WHERE workflow_id=? ORDER BY created_at", (workflow_id,)).fetchall():
        content = json.loads(row["content"])
        before = encode(content)
        if row["stage"] == "research" and "dataset" in content and not is_marker(content["dataset"]):
            content["dataset"] = marker(content["dataset"], expired_at)
        elif row["stage"] == "analysis" and isinstance(content.get("result"), dict):
            for key in ("sources", "facts"):
                if key in content["result"] and not is_marker(content["result"][key]):
                    content["result"][key] = marker(content["result"][key], expired_at)
        if row["stage"] == "analysis" and isinstance(content.get("result"), dict):
            literal_hits += _hits({k: v for k, v in content["result"].items() if k not in {"sources", "facts"}}, literals)
        elif row["stage"] == "proposal":
            literal_hits += _hits(content, literals)
        if encode(content) != before:
            db.execute("UPDATE artifacts SET content=? WHERE id=?", (encode(content), row["id"]))  # content_hash permanece
            changed += 1
    return changed, literal_hits


def _redact_runs(db, workflow_id, expired_at) -> int:
    changed = 0
    for row in db.execute("""SELECT r.id,r.request FROM cognitive_runs r JOIN jobs j ON j.id=r.job_id
            WHERE j.workflow_id=?""", (workflow_id,)).fetchall():
        body = json.loads(row["request"])
        if "input" in body and not (isinstance(body["input"], str) and body["input"].startswith('{"redacted"')):
            body["input"] = encode(marker(body["input"], expired_at))  # request_hash permanece
            db.execute("UPDATE cognitive_runs SET request=? WHERE id=?", (json.dumps(body), row["id"]))
            changed += 1
    return changed


def _scrub_errors(db, workflow_id, literals) -> int:
    """Mensagens de erro só são trocadas quando reproduzem literalmente texto do dataset."""
    if not literals:
        return 0
    changed = 0
    queries = (
        ("jobs", "SELECT id,error FROM jobs WHERE workflow_id=? AND error IS NOT NULL"),
        ("job_attempts", """SELECT a.id,a.error FROM job_attempts a JOIN jobs j ON j.id=a.job_id
            WHERE j.workflow_id=? AND a.error IS NOT NULL"""),
        ("cognitive_runs", """SELECT r.id,r.error FROM cognitive_runs r JOIN jobs j ON j.id=r.job_id
            WHERE j.workflow_id=? AND r.error IS NOT NULL"""))
    for table, query in queries:
        for row in db.execute(query, (workflow_id,)).fetchall():
            if _hits(row["error"], literals):
                db.execute(f"UPDATE {table} SET error=? WHERE id=?", (ERROR_MARKER, row["id"]))
                changed += 1
    for row in db.execute("SELECT sequence,data FROM workflow_events WHERE workflow_id=?", (workflow_id,)).fetchall():
        data = json.loads(row["data"])
        if isinstance(data.get("error"), str) and _hits(data["error"], literals):
            data["error"] = ERROR_MARKER
            db.execute("UPDATE workflow_events SET data=? WHERE sequence=?", (encode(data), row["sequence"]))
            changed += 1
    return changed


def _redact_workflow(db, row, payload, expired_at, stamp) -> None:
    dataset = payload.get("dataset")
    literals = _literals(dataset)
    if dataset is not None and not is_marker(dataset):
        payload["dataset"] = marker(dataset, expired_at)
    payload["radar"]["redacted_at"] = stamp
    # Primeira escrita: qualquer falha adiante desfaz o workflow inteiro.
    db.execute("UPDATE workflows SET payload=? WHERE id=?", (encode(payload), row["id"]))
    artifacts, editorial_hits = _redact_artifacts(db, row["id"], expired_at, literals)
    runs = _redact_runs(db, row["id"], expired_at)
    errors = _scrub_errors(db, row["id"], literals)
    WorkflowService._event(db, row["id"], row["revision"], "workflow.radar_redacted", {
        "reason": REASON, "expired_at": expired_at, "snapshot_id": payload["radar"].get("snapshot_id"),
        "artifacts": artifacts, "cognitive_runs": runs, "error_fields": errors,
        "editorial_literal_matches": editorial_hits})


def run_retention(store: Store, *, clock=utcnow, dry_run: bool = False) -> RetentionReport:
    """Redige as cópias do Radar de workflows com `radar.expires_at <= agora`. Devolve contagens."""
    report = RetentionReport(dry_run=dry_run)
    with store.connect() as db:
        ids = [row["id"] for row in db.execute(
            "SELECT id FROM workflows WHERE json_extract(payload,'$.radar') IS NOT NULL ORDER BY created_at")]
    for workflow_id in ids:
        report.evaluated += 1
        try:
            with store.connect() as db:
                if not dry_run:
                    db.execute("BEGIN IMMEDIATE")  # releitura já dentro da transação de escrita
                row = db.execute("SELECT id,status,revision,payload FROM workflows WHERE id=?", (workflow_id,)).fetchone()
                payload = json.loads(row["payload"])
                radar = payload["radar"]
                if radar.get("redacted_at"):
                    report.already_redacted += 1
                elif parse_time(radar["expires_at"]) > clock():
                    report.not_expired += 1
                elif row["status"] in ACTIVE:
                    report.deferred_active += 1
                else:
                    if not dry_run:
                        _redact_workflow(db, row, payload, radar["expires_at"], clock().isoformat())
                    report.redacted += 1
                    report.workflow_ids.append(workflow_id)
        except Exception as error:  # a transação do workflow foi desfeita; os demais seguem
            report.failed += 1
            report.errors.append({"workflow_id": workflow_id, "error": type(error).__name__})
            log.warning("Retenção do Radar falhou para %s: %s", workflow_id, type(error).__name__)
    return report
