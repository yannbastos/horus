import copy
import json

import pytest

from conftest import load
from horus_hermes_contract.validator import OutputError, parse_output, validate_result


def codes(issues):
    return {issue.code for issue in issues}


def test_valid_result_passes(envelope, valid_result):
    result, issues = validate_result(valid_result, envelope)
    assert issues == []
    assert result is not None and result.status == "complete"


def test_invented_metrics_and_references_are_reported(envelope):
    result, issues = validate_result(load("resultado-metrica-inventada-invalido.json"), envelope)
    assert result is None
    assert {"metric_mismatch", "forbidden_metric", "unverified_number", "unknown_dataset_source",
            "unknown_reference", "metric_unavailable"} <= codes(issues)


@pytest.mark.parametrize("mutate,code", [
    (lambda r: r["facts"][0]["metric_refs"][0].update(value=1840001), "metric_mismatch"),
    (lambda r: r["facts"][0].update(text="O vídeo D1 tem 9.999.999 visualizações."), "unverified_number"),
    (lambda r: r["facts"][0]["source_ids"].append("W1"), "unknown_reference"),
    (lambda r: r["hypotheses"][0]["based_on"].append("H9"), "unknown_reference"),
    (lambda r: r["opportunities"][0]["based_on"].append("Z1"), "unknown_reference"),
    (lambda r: r["recommendation"]["differs_from"].append("D7"), "unknown_reference"),
    (lambda r: r["memory_proposals"][0]["evidence"].append("H1"), "unknown_reference"),
    (lambda r: r["sources"][0].update(url="https://example.org/outro"), "source_url_mismatch"),
    (lambda r: r["facts"][1].update(id="F1"), "duplicate_id"),
    (lambda r: r.update(task_id="f" * 32), "task_mismatch"),
    (lambda r: r["recommendation"].update(premise="Vídeo com alta retenção garantida."), "forbidden_metric"),
    (lambda r: r["opportunities"][0].update(summary="Potencial de RPM alto no Brasil."), "forbidden_metric"),
    (lambda r: r["facts"].append({"id": "F4", "text": "D2 tem 1000 curtidas.", "source_ids": ["D2"],
                                  "metric_refs": [{"source_id": "D2", "field": "likes", "value": 1000}]}), "metric_mismatch"),
])
def test_each_rule(envelope, valid_result, mutate, code):
    candidate = copy.deepcopy(valid_result)
    mutate(candidate)
    result, issues = validate_result(candidate, envelope)
    assert result is None
    assert code in codes(issues), issues


def test_metric_must_cite_a_dataset_source(envelope, valid_result):
    candidate = copy.deepcopy(valid_result)
    candidate["sources"].append({"id": "W1", "kind": "web", "url": "https://example.org/noticia",
                                 "retrieved_at": "2026-11-11T12:00:00Z"})
    candidate["facts"][0]["metric_refs"][0]["source_id"] = "W1"
    _, issues = validate_result(candidate, envelope)
    assert "metric_without_dataset_source" in codes(issues)


def test_unknowns_may_name_unavailable_metrics(envelope, valid_result):
    assert any("Retenção" in item for item in valid_result["unknowns"])
    assert validate_result(valid_result, envelope)[1] == []


def test_years_are_not_treated_as_metrics(envelope, valid_result):
    candidate = copy.deepcopy(valid_result)
    candidate["facts"][2]["text"] += " Publicados em 2026."
    assert validate_result(candidate, envelope)[1] == []


def test_schema_errors_are_reported_without_result(envelope, valid_result):
    candidate = copy.deepcopy(valid_result)
    del candidate["facts"][0]["source_ids"]
    result, issues = validate_result(candidate, envelope)
    assert result is None and codes(issues) == {"schema"}


@pytest.mark.parametrize("text", [
    "", "   ", "não é json", "[1, 2]", '{"a": 1} trailing', "```json\n[1]\n```",
])
def test_invalid_output_text(text):
    with pytest.raises(OutputError):
        parse_output(text)


def test_output_accepts_plain_or_fenced_object(valid_result):
    raw = json.dumps(valid_result, ensure_ascii=False)
    assert parse_output(raw) == valid_result
    assert parse_output(f"```json\n{raw}\n```") == valid_result
