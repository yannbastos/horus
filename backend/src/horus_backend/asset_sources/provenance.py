"""Candidato -> entrada de `asset-provenance.json`, validada pelo contrato. Sempre `unverified`."""
from __future__ import annotations

import re
from dataclasses import replace
from typing import Mapping, Sequence

from ..media_contracts import validate_asset_provenance
from .base import AssetCandidate, AssetSourceError

_SHA = re.compile(r"^[0-9a-f]{64}$")
_PREFIX = {"stock_pexels": "pexels", "stock_pixabay": "pixabay", "licensed_manual": "local"}


def with_obtained_file(candidate: AssetCandidate, *, relative_path: str, sha256: str,
                       size_bytes: int | None = None) -> AssetCandidate:
    """Registra o arquivo de um candidato de stock depois que o USUÁRIO o obteve por fora (sem download aqui)."""
    if not _SHA.match(sha256):
        raise AssetSourceError("invalid_hash", "sha256 deve ter 64 hex minúsculos.")
    return replace(candidate, relative_path=relative_path, sha256=sha256, size_bytes=size_bytes)


def _notes(candidate: AssetCandidate) -> str:
    parts = [f"Consultado em {candidate.queried_at}; declarado pela fonte, não verificado."]
    if candidate.author_url:
        parts.append(f"Autor: {candidate.author_url}")
    dims = " x ".join(str(v) for v in (candidate.width, candidate.height) if v)
    if dims:
        parts.append(f"Dimensões: {dims}.")
    parts.extend(candidate.terms_restrictions)
    return " ".join(parts)[:2000]


def to_provenance_asset(candidate: AssetCandidate) -> dict:
    """Entrada de ativo (dict) para `asset-provenance.json`; exige arquivo e hash. `status` é sempre `unverified`."""
    if not candidate.relative_path or not candidate.sha256:
        raise AssetSourceError("file_not_obtained", "candidato sem arquivo/hash não tem proveniência registrável.")
    asset = {
        "asset_id": f"{_PREFIX.get(candidate.origin, 'asset')}-{candidate.source_id}"[:64],
        "relative_path": candidate.relative_path, "sha256": candidate.sha256, "kind": candidate.kind,
        "origin": candidate.origin, "source_url": candidate.source_url, "author": candidate.author,
        "license": {"id": candidate.license_id, "name": candidate.license_name, "url": candidate.license_url,
                    "commercial_use": candidate.commercial_use,
                    "attribution_required": candidate.attribution_required,
                    "verified_by": None, "verified_at": None},
        "status": "unverified", "notes": _notes(candidate)}
    result = validate_asset_provenance({"schema_version": 1, "assets": [asset]})
    if not result["ok"]:
        first = result["errors"][0]
        raise AssetSourceError("contract_rejected", f"{first['code']}@{first['path']}: {first['message']}")
    return asset


def build_provenance(candidates: Sequence[AssetCandidate]) -> Mapping:
    """Documento `asset-provenance.json` completo, revalidado (ids/caminhos duplicados são recusados)."""
    document = {"schema_version": 1, "assets": [to_provenance_asset(c) for c in candidates]}
    result = validate_asset_provenance(document)
    if not result["ok"]:
        first = result["errors"][0]
        raise AssetSourceError("contract_rejected", f"{first['code']}@{first['path']}: {first['message']}")
    return result["value"]
