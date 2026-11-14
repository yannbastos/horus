import json

import pytest
from pydantic import ValidationError

from conftest import ROOT, load
from generate_schemas import ALL_SCHEMAS, render
from horus_backend.hermes_contract.models import SCHEMAS, Dataset, EditorialResult, HermesRunRequest, RunEnvelope


@pytest.mark.parametrize("name", sorted(ALL_SCHEMAS))
def test_versioned_schema_files_match_models(name):
    path = ROOT / "schemas" / name
    assert path.read_text(encoding="utf-8") == render(ALL_SCHEMAS[name]), "Rode generate_schemas.py e revise o diff."
    assert ".v1." in name


def test_fixtures_follow_contract(envelope, valid_result):
    assert envelope.contract_version == "1.0"
    EditorialResult.model_validate(valid_result)


def test_request_body_carries_serialized_envelope(envelope):
    body = HermesRunRequest(input=envelope.model_dump_json(), instructions="Responda somente com JSON no contrato 1.0.")
    assert RunEnvelope.model_validate_json(body.input) == envelope
    with pytest.raises(ValidationError):
        HermesRunRequest.model_validate({**body.model_dump(), "toolsets": ["terminal"]})


def test_unknown_fields_and_versions_are_rejected(valid_result):
    for change in ({"contract_version": "2.0"}, {"extra": 1}, {"status": "done"}):
        with pytest.raises(ValidationError):
            EditorialResult.model_validate({**valid_result, **change})


def test_dataset_accepts_only_public_metrics_and_https():
    item = load("envelope-ficticio.json")["dataset"]
    bad_metric = json.loads(json.dumps(item))
    bad_metric["items"][0]["metrics"]["retention"] = 80
    bad_url = json.loads(json.dumps(item))
    bad_url["items"][0]["url"] = "http://example.org/x"
    duplicated = json.loads(json.dumps(item))
    duplicated["items"][1]["source_id"] = "D1"
    for candidate in (bad_metric, bad_url, duplicated):
        with pytest.raises(ValidationError):
            Dataset.model_validate(candidate)


def test_complete_requires_recommendation(valid_result):
    with pytest.raises(ValidationError):
        EditorialResult.model_validate({**valid_result, "recommendation": None})
    partial = EditorialResult.model_validate({**valid_result, "status": "insufficient_data", "recommendation": None,
                                              "opportunities": []})
    assert partial.status == "insufficient_data"
