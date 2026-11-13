"""Revisão humana de licença por asset (HOR-097). Append-only; nunca reescreve o `asset-provenance.json` registrado."""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .media_contracts import PILOT_INPUT_PATH, STOCK_HOSTS, _url_problem, apply_license_reviews, validate_asset_provenance
from .storage import now
from .workflows import WorkflowConflict

_FIELDS = ("id", "production_id", "asset_id", "asset_sha256", "decision", "license", "evidence",
           "reviewed_by", "reviewed_at", "supersedes")
_INPUTS = PILOT_INPUT_PATH
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ReviewLicense(_Strict):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=2000)
    commercial_use: Literal["allowed", "restricted", "unknown"]
    attribution_required: bool


class LicenseReviewRequest(_Strict):
    asset_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
    asset_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    decision: Literal["verified", "rejected"]
    license: ReviewLicense
    evidence: str = Field(min_length=1, max_length=2000)
    reviewed_by: Literal["human"]

    @field_validator("evidence")
    @classmethod
    def readable(cls, value):
        if not value.strip() or _CONTROL.search(value):
            raise ValueError("evidência vazia ou com caracteres de controle")
        return value


def _row(row) -> dict:
    return {key: (json.loads(row[key]) if key == "license" else row[key]) for key in _FIELDS}


class LicenseReviewService:
    def __init__(self, store, data_dir: Path):
        self.store, self.data_dir = store, Path(data_dir)

    def _provenance(self, db, production_id: str) -> dict | None:
        """Proveniência registrada (hash conferido) e validada; `None` se ausente ou inválida. Só leitura."""
        from .local_pilot import registered_json
        row = db.execute("SELECT artifacts FROM productions WHERE id=?", (production_id,)).fetchone()
        if row is None:
            raise KeyError(production_id)
        artifacts = json.loads(row["artifacts"])
        root = self.data_dir / "productions" / production_id
        inputs = {a["relative_path"]: a["sha256"] for a in artifacts if _INPUTS.fullmatch(a["relative_path"])}
        data = registered_json(root, artifacts, "asset-provenance.json")
        verdict = validate_asset_provenance(data, artifacts=inputs)
        return verdict["value"] if verdict["ok"] else None

    @staticmethod
    def _history(db, production_id: str) -> list[dict]:
        return [_row(r) for r in db.execute(
            "SELECT * FROM license_reviews WHERE production_id=? ORDER BY seq", (production_id,))]

    def list(self, production_id: str) -> dict:
        with self.store.connect() as db:
            provenance = self._provenance(db, production_id)
            history = self._history(db, production_id)
        current = list({r["asset_id"]: r for r in history}.values())
        effective = None
        if provenance is not None:
            try:
                effective = apply_license_reviews(provenance, history)
            except ValueError:
                effective = None
        return {"production_id": production_id, "current": current, "history": history,
                "effective_provenance": effective, "publishable": False}

    def create(self, production_id: str, request: LicenseReviewRequest, key: str) -> tuple[dict, bool]:
        encoded = json.dumps(request.model_dump(), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            provenance = self._provenance(db, production_id)  # KeyError (404) se a produção não existe
            receipt = db.execute("SELECT * FROM license_reviews WHERE production_id=? AND idempotency_key=?",
                                 (production_id, key)).fetchone()
            if receipt:
                if receipt["request"] != encoded:
                    raise WorkflowConflict("Chave de idempotência usada com outra decisão.")
                return _row(receipt), False
            if provenance is None:
                raise WorkflowConflict("Produção sem asset-provenance.json registrado e válido.")
            asset = next((a for a in provenance["assets"] if a["asset_id"] == request.asset_id), None)
            if asset is None:
                raise WorkflowConflict("Asset não consta na proveniência da produção.")
            if asset["sha256"] != request.asset_sha256:
                raise WorkflowConflict("asset_sha256 diverge do asset registrado.")
            lic = request.license
            if request.decision == "verified" and lic.commercial_use == "unknown":
                raise WorkflowConflict("commercial_use desconhecido não pode ser verified.")
            if problem := _url_problem(lic.url, STOCK_HOSTS.get(asset["origin"])):
                raise WorkflowConflict(f"license.url inválida: {problem}")
            previous = db.execute("SELECT id FROM license_reviews WHERE production_id=? AND asset_id=? "
                                  "ORDER BY seq DESC LIMIT 1", (production_id, request.asset_id)).fetchone()
            review_id = uuid.uuid4().hex
            db.execute("""INSERT INTO license_reviews(id,production_id,asset_id,asset_sha256,decision,license,evidence,
                reviewed_by,reviewed_at,supersedes,idempotency_key,request) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (review_id, production_id, request.asset_id, request.asset_sha256, request.decision,
                        json.dumps(lic.model_dump(), sort_keys=True), request.evidence, "human", now(),
                        previous["id"] if previous else None, key, encoded))
            return _row(db.execute("SELECT * FROM license_reviews WHERE id=?", (review_id,)).fetchone()), True
