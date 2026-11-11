"""Fluxo HTTP contra o Hermes SIMULADO. Comprova o contrato do lado do Hórus, não o Hermes real."""
import json

import pytest

from conftest import Http
from fake_server import Scenario
from horus_backend.hermes_contract.mapping import (
    ATTEMPT_OUTCOME, Observation, decide, idempotency_key, may_repair, may_retry_after,
    may_retry_automatically)
from horus_backend.hermes_contract.models import HermesRunRequest
from horus_backend.hermes_contract.validator import OutputError, parse_output, validate_result

KEY = idempotency_key("b" * 31 + "1")


def request_body(envelope, **extra):
    return HermesRunRequest(input=envelope.model_dump_json(), instructions="Contrato 1.0; responda só JSON.",
                            **extra).model_dump(exclude_none=True)


def submit(http, envelope, key=KEY, **extra):
    return http.call("POST", "/v1/runs", request_body(envelope, **extra), {"Idempotency-Key": key} if key else {})


def observe(http, run_id):
    status, _, body = http.call("GET", f"/v1/runs/{run_id}")
    return Observation(admitted=True, http_status=status, run_status=body.get("status") if status == 200 else None), body


def sse(raw: str):
    events = []
    for frame in raw.split("\n\n"):
        data = [line[6:] for line in frame.splitlines() if line.startswith("data: ")]
        if data:
            events.append(json.loads(data[0]))
    return events


def test_authentication_is_required(hermes, envelope):
    status, _, body = Http(hermes, token="wrong").call("POST", "/v1/runs", request_body(envelope))
    assert status == 401 and body["error"]["code"] == "invalid_api_key"


def test_successful_run_is_validated_by_horus(hermes, http, envelope, valid_result):
    hermes.scenarios.append(Scenario(output=json.dumps(valid_result), tools=("todo_list",)))
    status, headers, admission = submit(http, envelope)
    assert status == 202 and admission == {"run_id": admission["run_id"], "status": "queued", "replayed": False}
    observation, body = observe(http, admission["run_id"])
    assert decide(observation) == "validate_output"
    assert body["usage"]["total_tokens"] == 2000
    result, issues = validate_result(parse_output(body["output"]), envelope)
    assert issues == [] and ATTEMPT_OUTCOME["validate_output"] == "succeeded"
    status, _, raw = http.call("GET", f"/v1/runs/{admission['run_id']}/events")
    names = [event["event"] for event in sse(raw)]
    assert names[:2] == ["run.queued", "run.started"] and names[-1] == "run.completed"
    assert {"tool.started", "tool.completed"} <= set(names)
    assert raw.rstrip().endswith(": stream closed")


def test_idempotent_resubmission_replays_same_run(hermes, http, envelope, valid_result):
    hermes.scenarios.append(Scenario(output=json.dumps(valid_result)))
    _, _, first = submit(http, envelope)
    status, headers, second = submit(http, envelope)
    assert status == 202 and second["replayed"] is True and headers.get("Idempotency-Replayed") == "true"
    assert second["run_id"] == first["run_id"]
    assert len(hermes.requests) == 1  # nenhuma segunda execução (nem cobrança) foi criada


def test_same_key_with_different_body_conflicts(http, envelope):
    submit(http, envelope)
    changed = envelope.model_copy(update={"objective": "Outro objetivo"})
    status, _, body = submit(http, changed)
    assert status == 409 and body["error"]["code"] == "idempotency_key_conflict"


@pytest.mark.parametrize("key", ["com espaço", "x" * 256, "acentuação"])
def test_invalid_idempotency_key(http, envelope, key):
    status, _, body = http.call("POST", "/v1/runs", request_body(envelope), {"Idempotency-Key": key.encode("utf-8").decode("latin-1")})
    assert status == 400 and body["error"]["code"] == "invalid_idempotency_key"


def test_lost_admission_is_resubmitted_with_same_key(hermes, http, envelope, valid_result):
    hermes.scenarios.append(Scenario(output=json.dumps(valid_result)))
    assert decide(Observation(admitted=False)) == "resubmit_same_key"
    submit(http, envelope)          # a resposta "se perdeu" do ponto de vista do cliente
    _, _, replay = submit(http, envelope)
    assert replay["replayed"] is True and len(hermes.requests) == 1


def test_invalid_output_allows_one_repair_only(hermes, http, envelope, valid_result):
    hermes.scenarios.extend([Scenario(output="Claro! Aqui está a proposta: ..."),
                             Scenario(output=json.dumps(valid_result))])
    _, _, admission = submit(http, envelope)
    observation, body = observe(http, admission["run_id"])
    assert decide(observation) == "validate_output"
    with pytest.raises(OutputError):
        parse_output(body["output"])
    assert may_repair("succeeded", repairs_done=0, invalid_output=True)
    repair_key = idempotency_key("b" * 31 + "1", repair=1)
    assert repair_key != KEY
    _, _, repaired = submit(http, envelope, key=repair_key)
    _, body = observe(http, repaired["run_id"])
    assert validate_result(parse_output(body["output"]), envelope)[1] == []
    assert not may_repair("succeeded", repairs_done=1, invalid_output=True)
    with pytest.raises(ValueError):
        idempotency_key("b" * 32, repair=2)


def test_iteration_budget_failure(hermes, http, envelope):
    hermes.scenarios.append(Scenario(final_status="failed", turn_exit_reason="max_iterations"))
    _, _, admission = submit(http, envelope)
    observation, body = observe(http, admission["run_id"])
    assert decide(observation) == "record_failed"
    assert body["turn_exit_reason"] == "max_iterations" and body["completed"] is False
    assert ATTEMPT_OUTCOME["record_failed"] == "failed"
    assert not may_retry_automatically("failed") and may_retry_after("failed", reconciled=False)


def test_stop_cancels_active_run(hermes, http, envelope):
    hermes.scenarios.append(Scenario(hold=True))
    _, _, admission = submit(http, envelope)
    observation, _ = observe(http, admission["run_id"])
    assert decide(observation) == "wait"
    status, _, body = http.call("POST", f"/v1/runs/{admission['run_id']}/stop")
    assert status == 200 and body["status"] == "cancelled"
    assert decide(observe(http, admission["run_id"])[0]) == "record_cancelled"
    _, _, raw = http.call("GET", f"/v1/runs/{admission['run_id']}/events")
    assert [e["event"] for e in sse(raw)][-2:] == ["run.stopping", "run.cancelled"]
    status, _, again = http.call("POST", f"/v1/runs/{admission['run_id']}/stop")
    assert status == 200 and again["status"] == "cancelled"  # parar uma execução encerrada é inofensivo


def test_interrupted_run(hermes, http, envelope):
    hermes.scenarios.append(Scenario(final_status="interrupted"))
    _, _, admission = submit(http, envelope)
    observation, body = observe(http, admission["run_id"])
    assert decide(observation) == "record_interrupted" and body["interrupted"] is True


def test_tool_approval_request_is_never_auto_approved(hermes, http, envelope):
    hermes.scenarios.append(Scenario(request_approval=True))
    _, _, admission = submit(http, envelope)
    observation, _ = observe(http, admission["run_id"])
    assert decide(observation) == "stop_policy_violation"
    assert http.call("POST", f"/v1/runs/{admission['run_id']}/stop")[2]["status"] == "cancelled"
    assert ATTEMPT_OUTCOME["stop_policy_violation"] == "failed"


def test_concurrency_limit(hermes, http, envelope):
    hermes.scenarios.append(Scenario(hold=True))
    submit(http, envelope)
    status, _, body = submit(http, envelope, key=idempotency_key("d" * 32))
    assert status == 429 and body["error"]["code"] == "rate_limit_exceeded"


def test_restart_unkeyed_run_becomes_unknown(hermes, http, envelope):
    hermes.scenarios.append(Scenario(hold=True))
    _, _, admission = submit(http, envelope, key=None)
    hermes.restart()
    observation, _ = observe(http, admission["run_id"])
    assert observation.http_status == 404 and decide(observation) == "mark_unknown"
    assert ATTEMPT_OUTCOME["mark_unknown"] == "unknown"
    assert not may_retry_after("unknown", reconciled=False)
    assert may_retry_after("unknown", reconciled=True)


def test_restart_keyed_run_is_found_but_never_finishes(hermes, http, envelope):
    hermes.scenarios.append(Scenario(hold=True))
    _, _, admission = submit(http, envelope)
    hermes.restart()
    observation, body = observe(http, admission["run_id"])
    assert decide(observation) == "wait" and body["status"] == "running"
    # Ninguém conclui a execução: /stop não tem agente ativo. O Hórus precisa de um prazo e então "unknown".
    status, _, stop = http.call("POST", f"/v1/runs/{admission['run_id']}/stop")
    assert status == 409 and stop["error"]["code"] == "run_not_active"
    _, _, replay = submit(http, envelope)
    assert replay["replayed"] is True and replay["run_id"] == admission["run_id"]


@pytest.mark.parametrize("status_code,run_status", [(None, None), (500, None), (200, "novo_estado")])
def test_unexpected_observations_are_unknown(status_code, run_status):
    assert decide(Observation(admitted=True, http_status=status_code, run_status=run_status)) == "mark_unknown"


def test_unknown_run_id(http):
    status, _, body = http.call("GET", "/v1/runs/run_inexistente")
    assert status == 404 and body["error"]["code"] == "run_not_found"
