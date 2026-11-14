"""Etapa `script`: contrato contra o Hermes simulado (sem executor, sem rede externa)."""
import copy
import json

import pytest
from pydantic import ValidationError

from conftest import load
from fake_server import Scenario
from horus_backend.hermes_contract.script import (
    SCRIPT_INSTRUCTIONS, ScriptRunEnvelope, build_script_request, validate_script_output)
from horus_backend.hermes_contract.validator import OutputError, parse_output


@pytest.fixture
def senv():
    return ScriptRunEnvelope.model_validate(load("script-envelope-ficticio.json"))


def codes(issues):
    return {issue.code for issue in issues}


def test_valid_output_becomes_script_document(senv):
    document, issues = validate_script_output(load("script-saida-valida.json"), senv)
    assert issues == [] and document is not None
    assert [s.kind for s in document.sections] == ["hook", "body", "body", "conclusion"]
    assert document.simulated is True


def test_invalid_structure_is_rejected_not_repaired(senv):
    document, issues = validate_script_output(load("script-saida-invalida.json"), senv)
    assert document is None and codes(issues) == {"script_contract"}


def test_unknown_source_is_rejected(senv):
    document, issues = validate_script_output(load("script-saida-fonte-nao-permitida.json"), senv)
    assert document is None and codes(issues) == {"unknown_source"}
    assert "X9" in issues[0].message


@pytest.mark.parametrize("mutate,code", [
    (lambda r: r.update(task_id="f" * 32), "task_mismatch"),
    (lambda r: r.update(contract_version="2.0"), "schema"),
    (lambda r: r.update(simulated=False), "schema"),
    (lambda r: r["sections"][0].update(extra=1), "schema"),
    (lambda r: r["sections"][1].update(narration="x" * 8001), "schema"),
    (lambda r: r["sections"][1].update(narration=""), "schema"),
    (lambda r: r["sections"].__delitem__(slice(1, 3)), "schema"),  # 2 seções: abaixo do mínimo, sem completar
])
def test_each_rejection(senv, mutate, code):
    raw = copy.deepcopy(load("script-saida-valida.json"))
    mutate(raw)
    document, issues = validate_script_output(raw, senv)
    assert document is None and code in codes(issues)


def test_section_count_follows_envelope_constraints():
    data = load("script-envelope-ficticio.json")
    data["constraints"].update(min_sections=5, max_sections=6)
    document, issues = validate_script_output(load("script-saida-valida.json"), ScriptRunEnvelope.model_validate(data))
    assert document is None and codes(issues) == {"section_count"}


def test_giant_output_is_rejected_without_truncation(senv):
    base = load("script-saida-valida.json")
    big = [{"id": f"b{i}", "kind": "body", "heading": "H", "narration": "n" * 8000, "source_ids": []} for i in range(9)]
    raw = {**base, "sections": [base["sections"][0], *big, base["sections"][-1]]}
    wide = ScriptRunEnvelope.model_validate({**load("script-envelope-ficticio.json"),
                                             "constraints": {"target_duration_seconds": 60, "max_sections": 12}})
    document, issues = validate_script_output(raw, wide)  # 72.000 caracteres > limite de narração total
    assert document is None and codes(issues) == {"script_contract"}
    too_many = {**base, "sections": [base["sections"][0], *big * 4, base["sections"][-1]]}
    assert validate_script_output(too_many, senv)[0] is None


def test_prompt_injection_in_source_title_stays_data():
    injected = ScriptRunEnvelope.model_validate(load("script-envelope-injecao.json"))
    request = build_script_request(injected)
    assert "IGNORE" not in request.instructions and request.instructions == SCRIPT_INSTRUCTIONS
    assert ScriptRunEnvelope.model_validate_json(request.input) == injected  # só trafega como valor JSON
    raw = load("script-saida-injecao-obedecida.json")  # obedeceu: campo extra + fonte X9
    document, issues = validate_script_output(raw, injected)
    assert document is None and "schema" in codes(issues)
    raw.pop("tool_call")
    assert codes(validate_script_output(raw, injected)[1]) == {"unknown_source"}
    with pytest.raises(OutputError):
        parse_output("Claro! Segue o roteiro em texto livre.")


@pytest.mark.parametrize("path,value", [
    (("proposal", "title"), "Ver C:\\Users\\yann\\roteiro.txt"),
    (("proposal", "premise"), "Veja /home/yann/projeto"),
    (("proposal", "angle"), "file:///etc/passwd"),
    (("allowed_sources", 0, "title"), "api_key = abc123"),
    (("allowed_sources", 0, "title"), "Authorization: Bearer abcdefgh12345678"),
    (("allowed_sources", 0, "title"), "chave sk-abcdefghijklmnopqrstuvwx"),
])
def test_envelope_rejects_local_paths_and_credentials(path, value):
    data = copy.deepcopy(load("script-envelope-ficticio.json"))
    target = data
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValidationError):
        ScriptRunEnvelope.model_validate(data)


@pytest.mark.parametrize("mutate", [
    lambda d: d.update(workspace_path="C:/proj"),
    lambda d: d.update(api_key="x"),
    lambda d: d.update(other_projects=[{"title": "outro"}]),
    lambda d: d["proposal"].update(notes="texto livre"),
    lambda d: d["allowed_sources"][0].update(url="https://example.org/x"),
    lambda d: d["constraints"].update(target_duration_seconds=5),
    lambda d: d["constraints"].update(min_sections=9, max_sections=4),
    lambda d: d["allowed_sources"].append(dict(d["allowed_sources"][0])),
    lambda d: d["allowed_sources"].extend({"source_id": f"S{i}", "title": "t"} for i in range(60)),
    lambda d: d["proposal"].update(premise="p" * 1501),
    lambda d: d.update(stage="proposal"),
])
def test_envelope_has_no_room_for_extras_or_oversize(mutate):
    data = copy.deepcopy(load("script-envelope-ficticio.json"))
    mutate(data)
    with pytest.raises(ValidationError):
        ScriptRunEnvelope.model_validate(data)


def test_fake_server_round_trip(hermes, http, senv):
    request = build_script_request(senv).model_dump(exclude_none=True)
    hermes.scenarios.append(Scenario(output=lambda body: json.dumps(
        {**load("script-saida-valida.json"), "task_id": json.loads(body["input"])["task_id"]})))
    status, _, admitted = http.call("POST", "/v1/runs", request, {"Idempotency-Key": "script-1"})
    assert status == 202
    _, _, run = http.call("GET", f"/v1/runs/{admitted['run_id']}")
    assert run["status"] == "completed"
    sent = json.loads(hermes.requests[0]["body"]["input"])
    assert set(sent) == {"contract_version", "stage", "task_id", "attempt_id", "revision", "proposal",
                         "allowed_sources", "constraints"}
    document, issues = validate_script_output(parse_output(run["output"]), senv)
    assert issues == [] and document is not None


def test_fake_server_invalid_output_is_rejected(hermes, http, senv):
    hermes.scenarios.append(Scenario(output=json.dumps(load("script-saida-fonte-nao-permitida.json"))))
    _, _, admitted = http.call("POST", "/v1/runs", build_script_request(senv).model_dump(exclude_none=True))
    _, _, run = http.call("GET", f"/v1/runs/{admitted['run_id']}")
    assert validate_script_output(parse_output(run["output"]), senv)[0] is None
