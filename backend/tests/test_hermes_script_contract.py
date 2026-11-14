"""Etapa `script` do Hermes: integração do conversor com o `script_contract` existente (só contrato, sem executor)."""
import copy
import json
from pathlib import Path

import pytest

from horus_backend.hermes_contract.script import ScriptRunEnvelope, validate_script_output
from horus_backend.script_contract import validate_script

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "hermes" / "fixtures"


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def envelope():
    return ScriptRunEnvelope.model_validate(load("script-envelope-ficticio.json"))


def test_converted_document_is_valid_for_existing_script_contract(envelope):
    document, issues = validate_script_output(load("script-saida-valida.json"), envelope)
    assert issues == []
    again = validate_script(document, {s.source_id for s in envelope.allowed_sources})
    assert again == document and again.schema_version == 1


def test_human_origin_flag_is_coherent(envelope):
    document, _ = validate_script_output(load("script-saida-valida.json"), envelope, origin="human")
    assert document is not None and document.simulated is False


def test_output_never_carries_simulated_or_schema_version(envelope):
    for field in ("simulated", "schema_version"):
        raw = {**load("script-saida-valida.json"), field: 1 if field == "schema_version" else True}
        document, issues = validate_script_output(raw, envelope)
        assert document is None and issues[0].code == "schema"


@pytest.mark.parametrize("fixture,code", [
    ("script-saida-invalida.json", "script_contract"),
    ("script-saida-fonte-nao-permitida.json", "unknown_source"),
    ("script-saida-injecao-obedecida.json", "schema"),
])
def test_invalid_fixtures_are_rejected_with_structured_issue(envelope, fixture, code):
    document, issues = validate_script_output(load(fixture), envelope)
    assert document is None
    assert issues and all(i.code and i.path and i.message for i in issues) and issues[0].code == code


def test_rejection_does_not_mutate_input_nor_fill_gaps(envelope):
    raw = load("script-saida-fonte-nao-permitida.json")
    before = copy.deepcopy(raw)
    assert validate_script_output(raw, envelope)[0] is None
    assert raw == before  # nada truncado, removido ou inventado


def test_only_allowed_sources_may_be_cited(envelope):
    raw = load("script-saida-valida.json")
    raw["sections"][1]["source_ids"] = ["D1", "D1"]  # repetido na seção: o contrato de roteiro rejeita
    assert validate_script_output(raw, envelope)[0] is None
    raw["sections"][1]["source_ids"] = ["D2"]
    assert validate_script_output(raw, envelope)[0] is not None
