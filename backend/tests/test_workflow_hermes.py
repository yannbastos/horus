"""Workflow persistente com executor Hermes contra o Hermes SIMULADO (contracts/hermes/fake_server.py).

Comprova o lado do Hórus: autorização antes de custo, chave/referência/consumo persistidos, validação de
evidências, cancelamento remoto e conciliação sem reenvio. Não comprova o Hermes real.
"""
import copy
from decimal import Decimal
import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from horus_backend.api import create_app
from horus_backend.config import Settings

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts" / "hermes"
sys.path.insert(0, str(CONTRACTS))
from fake_server import FakeHermes, Scenario  # noqa: E402

TOKEN = "workflow-hermes-tests-session-token-123456789"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
ENVELOPE = json.loads((CONTRACTS / "fixtures" / "envelope-ficticio.json").read_text(encoding="utf-8"))
VALID = json.loads((CONTRACTS / "fixtures" / "resultado-valido.json").read_text(encoding="utf-8"))
REQUEST = {"objective": ENVELOPE["objective"], "dataset": ENVELOPE["dataset"], "channel_profile": ENVELOPE["channel_profile"]}


def echo(result=VALID):
    """Resposta válida que ecoa o task_id recebido no envelope, como um modelo obediente faria."""
    return lambda body: json.dumps({**result, "task_id": json.loads(body["input"])["task_id"]}, ensure_ascii=False)


@pytest.fixture
def hermes():
    with FakeHermes() as server:
        yield server


@pytest.fixture
def settings(tmp_path, hermes):
    connection = tmp_path / "hermes.json"
    connection.write_text(json.dumps({"base_url": hermes.base_url, "token": hermes.token}), encoding="utf-8")
    from horus_backend.security import harden_profile
    profile = tmp_path / "profile"
    harden_profile(profile)
    return Settings(hermes_profile=profile, max_tokens_per_run=100000, max_tokens_per_day=10000000, max_runs_per_day=100, token=TOKEN, data_dir=tmp_path / "data", factory_root=None, hermes_executable=None,
                    hermes_config=connection, workflow_executor="hermes", hermes_poll_seconds=.05, hermes_run_timeout=5,
                    price_input_usd_per_mtok=Decimal('1'), price_output_usd_per_mtok=Decimal('2'))


def client_for(settings):
    return TestClient(create_app(settings), base_url="http://127.0.0.1", headers=HEADERS)


def create(client, key="pedido-1"):
    response = client.post("/v1/workflows", json=REQUEST, headers={"Idempotency-Key": key})
    assert response.status_code == 202, response.text
    return response.json()


def wait(client, workflow_id, check, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        workflow = client.get(f"/v1/workflows/{workflow_id}").json()
        if check(workflow):
            return workflow
        time.sleep(.03)
    pytest.fail(f"Condição não atingida: {workflow['status']} {[s['status'] for s in workflow['steps']]}")


def pending(client, workflow_id):
    return wait(client, workflow_id, lambda w: w["pending_authorization"] is not None)


def authorize(client, workflow, key="autorizacao-1"):
    response = client.post(f"/v1/workflows/{workflow['id']}/authorize", headers={"Idempotency-Key": key},
                           json={"expected_revision": workflow["revision"], "job_id": workflow["pending_authorization"]["job_id"]})
    assert response.status_code == 200, response.text
    return response.json()


def test_cognitive_workflow_requires_authorization_and_ends_in_human_review(settings, hermes):
    hermes.scenarios.append(Scenario(output=echo()))
    with client_for(settings) as client:
        workflow = pending(client, create(client)["id"])
        # Etapas locais concluídas; nenhuma chamada ao Hermes antes da autorização humana.
        assert [s["status"] for s in workflow["steps"]] == ["succeeded", "succeeded", "awaiting_authorization", "waiting"]
        assert workflow["status"] == "queued" and workflow["simulated"] is False and workflow["executor"] == "hermes"
        assert hermes.requests == []
        time.sleep(.3)
        assert hermes.requests == []

        workflow = authorize(client, workflow)
        workflow = wait(client, workflow["id"], lambda w: w["status"] == "awaiting_approval")
        assert [a["executor"] for a in workflow["attempts"]] == ["local-v1", "local-v1", "hermes-v1", "local-v1"]
        [run] = workflow["cognitive_runs"]
        assert next(a for a in workflow["artifacts"] if a["stage"] == "analysis")["content"]["provider"] == "hermes"
        analysis_attempt = workflow["attempts"][2]["id"]
        assert run["status"] == "completed" and run["external_ref"].startswith("run_")
        assert run["idempotency_key"] == f"horus-{analysis_attempt}"
        assert run["usage"]["total_tokens"] == 2000
        assert "request" not in run
        [grant] = workflow["authorizations"]
        assert grant["consumed_attempt_id"] == analysis_attempt and grant["max_runs"] == 1
        assert len(hermes.requests) == 1 and hermes.requests[0]["idempotency_key"] == run["idempotency_key"]
        sent = json.loads(hermes.requests[0]["body"]["input"])
        assert sent["task_id"] == workflow["steps"][2]["id"] and sent["dataset"]["snapshot_id"] == "snap-ficticio-1"

        proposal = next(a for a in workflow["artifacts"] if a["stage"] == "proposal")
        assert workflow["current_artifact_id"] == proposal["id"]
        assert proposal["content"]["requires_human_review"] is True and proposal["content"]["simulated"] is False
        assert proposal["content"]["title"] == VALID["recommendation"]["title_options"][0]
        assert proposal["content"]["evidence"] == {"sources": 3, "facts": 3, "hypotheses": 1}

        response = client.post(f"/v1/workflows/{workflow['id']}/review", headers={"Idempotency-Key": "revisao-1"},
                               json={"expected_revision": 1, "artifact_id": proposal["id"], "decision": "approve"})
        assert response.status_code == 200
        assert response.json()["workflow"]["status"] == "approved"
        assert len(hermes.requests) == 1


def test_hermes_executor_requires_dataset_and_payload_cannot_choose_executor(settings):
    with client_for(settings) as client:
        response = client.post("/v1/workflows", json={"objective": "sem dados"}, headers={"Idempotency-Key": "x"})
        assert response.status_code == 409 and "dataset" in response.json()["detail"]
        response = client.post("/v1/workflows", json={**REQUEST, "executor": "simulated"}, headers={"Idempotency-Key": "y"})
        assert response.status_code == 422


def test_authorization_is_idempotent_scoped_and_single_use(settings, hermes):
    hermes.scenarios.extend([Scenario(output=echo()), Scenario(output=echo())])
    with client_for(settings) as client:
        workflow = pending(client, create(client)["id"])
        body = {"expected_revision": 1, "job_id": workflow["pending_authorization"]["job_id"]}
        url = f"/v1/workflows/{workflow['id']}/authorize"
        assert client.post(url, json={**body, "expected_revision": 2}, headers={"Idempotency-Key": "a"}).status_code == 409
        assert client.post(url, json={**body, "job_id": "f" * 32}, headers={"Idempotency-Key": "b"}).status_code == 409
        assert client.post(url, json=body, headers={"Idempotency-Key": "c"}).status_code == 200
        assert client.post(url, json=body, headers={"Idempotency-Key": "c"}).status_code == 200  # replay
        assert client.post(url, json=body, headers={"Idempotency-Key": "d"}).status_code == 409  # já não aguarda
        workflow = wait(client, workflow["id"], lambda w: w["status"] == "awaiting_approval")
        assert len(workflow["authorizations"]) == 1 and len(hermes.requests) == 1


def test_invalid_output_fails_and_retry_asks_authorization_again(settings, hermes):
    invented = copy.deepcopy(VALID)
    invented["facts"][0]["metric_refs"][0]["value"] = 9_999_999
    hermes.scenarios.extend([Scenario(output=echo(invented)), Scenario(output=echo())])
    with client_for(settings) as client:
        workflow = authorize(client, pending(client, create(client)["id"]))
        workflow = wait(client, workflow["id"], lambda w: w["status"] == "failed")
        [run] = workflow["cognitive_runs"]
        assert run["status"] == "invalid_output" and "metric_mismatch" in run["error"]
        assert "metric_mismatch" in workflow["steps"][2]["error"]
        assert not any(a["stage"] == "analysis" for a in workflow["artifacts"])

        retried = client.post(f"/v1/workflows/{workflow['id']}/retry", json={"expected_revision": 1}).json()
        assert retried["pending_authorization"]["stage"] == "analysis"
        time.sleep(.3)
        assert len(hermes.requests) == 1  # nenhuma nova execução paga sem autorização
        workflow = authorize(client, retried, key="autorizacao-2")
        workflow = wait(client, workflow["id"], lambda w: w["status"] == "awaiting_approval")
        assert [r["status"] for r in workflow["cognitive_runs"]] == ["invalid_output", "completed"]
        assert len({r["idempotency_key"] for r in workflow["cognitive_runs"]}) == 2


def test_operator_cancel_stops_remote_run(settings, hermes):
    hermes.scenarios.append(Scenario(hold=True))
    with client_for(settings) as client:
        workflow = authorize(client, pending(client, create(client)["id"]))
        workflow = wait(client, workflow["id"], lambda w: any(r["status"] == "admitted" for r in w["cognitive_runs"]))
        client.post(f"/v1/workflows/{workflow['id']}/cancel")
        workflow = wait(client, workflow["id"], lambda w: w["status"] == "cancelled")
        [run] = workflow["cognitive_runs"]
        assert run["status"] == "cancelled"
        assert hermes.runs[run["external_ref"]].status == "cancelled"


def test_restart_marks_unknown_blocks_retry_and_reconcile_adopts_same_run(settings, hermes):
    hermes.scenarios.append(Scenario(output=echo(), hold=True))
    with client_for(settings) as client:
        workflow = authorize(client, pending(client, create(client)["id"]))
        workflow = wait(client, workflow["id"], lambda w: any(r["status"] == "admitted" for r in w["cognitive_runs"]))
    # Hórus encerrado com a execução remota ainda ativa.
    with client_for(settings) as client:
        workflow = wait(client, workflow["id"], lambda w: w["status"] == "interrupted")
        [run] = workflow["cognitive_runs"]
        assert run["status"] == "unknown"
        response = client.post(f"/v1/workflows/{workflow['id']}/retry", json={"expected_revision": 1})
        assert response.status_code == 409 and "Concilie" in response.json()["detail"]

        hermes.release(run["external_ref"])  # o Hermes terminou enquanto o Hórus estava fora
        response = client.post(f"/v1/workflows/{workflow['id']}/reconcile", json={"expected_revision": 1})
        assert response.status_code == 200
        workflow = wait(client, workflow["id"], lambda w: w["status"] == "awaiting_approval")
        [run] = workflow["cognitive_runs"]
        assert run["status"] == "completed" and run["usage"]["total_tokens"] == 2000
        assert len(hermes.requests) == 1  # resultado aproveitado sem novo envio nem nova autorização
        assert len(workflow["authorizations"]) == 1
        assert client.post(f"/v1/workflows/{workflow['id']}/reconcile", json={"expected_revision": 1}).status_code == 409


@pytest.mark.parametrize("scenario,remote,expected", [
    (Scenario(request_approval=True), "cancelled", "policy_violation"),
    (Scenario(final_status="failed", turn_exit_reason="max_iterations"), "failed", "failed"),
])
def test_remote_policy_and_failures_end_without_automatic_rerun(settings, hermes, scenario, remote, expected):
    hermes.scenarios.append(scenario)
    with client_for(settings) as client:
        workflow = authorize(client, pending(client, create(client)["id"]))
        workflow = wait(client, workflow["id"], lambda w: w["status"] == "failed")
        [run] = workflow["cognitive_runs"]
        assert run["status"] == expected
        assert hermes.runs[run["external_ref"]].status == remote
        time.sleep(.3)
        assert len(hermes.requests) == 1


def test_request_changes_reruns_local_stages_and_waits_for_new_authorization(settings, hermes):
    hermes.scenarios.extend([Scenario(output=echo()), Scenario(output=echo())])
    with client_for(settings) as client:
        workflow = wait(client, authorize(client, pending(client, create(client)["id"]))["id"],
                        lambda w: w["status"] == "awaiting_approval")
        response = client.post(f"/v1/workflows/{workflow['id']}/review", headers={"Idempotency-Key": "mudancas"},
                               json={"expected_revision": 1, "artifact_id": workflow["current_artifact_id"],
                                     "decision": "request_changes", "feedback": "Foque em obras do Nordeste."})
        assert response.status_code == 200
        workflow = wait(client, workflow["id"], lambda w: w["revision"] == 2 and w["pending_authorization"] is not None)
        assert len(hermes.requests) == 1
        workflow = wait(client, authorize(client, workflow, key="autorizacao-r2")["id"], lambda w: w["status"] == "awaiting_approval")
        assert json.loads(hermes.requests[1]["body"]["input"])["feedback"] == "Foque em obras do Nordeste."
        assert len(workflow["cognitive_runs"]) == 2 and len(workflow["authorizations"]) == 2


def test_hermes_refusal_is_recorded_without_retry(settings, hermes):
    hermes.max_concurrent_runs = 1
    hermes.scenarios.append(Scenario(hold=True))
    # Ocupa a única vaga com outra execução para provocar 429 na admissão do workflow.
    import urllib.request
    urllib.request.urlopen(urllib.request.Request(hermes.base_url + "/v1/runs", method="POST",
                           data=json.dumps({"input": "ocupado"}).encode(),
                           headers={"Authorization": f"Bearer {hermes.token}", "Content-Type": "application/json"}))
    with client_for(settings) as client:
        workflow = authorize(client, pending(client, create(client)["id"]))
        workflow = wait(client, workflow["id"], lambda w: w["status"] == "failed")
        [run] = workflow["cognitive_runs"]
        assert run["status"] == "failed" and run["error"].startswith("429")
        assert run["external_ref"] is None


def test_api_authorization_blocks_before_any_submission(settings, hermes):
    """O fake_server é local; comprova que o gate não admite sequer uma execução."""
    (settings.hermes_profile / 'config.yaml').write_text('memory:\n  memory_enabled: true\n', encoding='utf-8')
    with client_for(settings) as client:
        workflow = pending(client, create(client)['id'])
        response = client.post(f"/v1/workflows/{workflow['id']}/authorize", headers={'Idempotency-Key': 'denied'},
                               json={'expected_revision': workflow['revision'], 'job_id': workflow['pending_authorization']['job_id']})
        assert response.status_code == 409
        assert response.json()['detail']['code'] == 'security_gate'
        assert hermes.requests == []
        assert client.get(f"/v1/workflows/{workflow['id']}").json()['authorizations'] == []


def test_gate_rechecks_profile_after_authorization(settings, hermes):
    from horus_backend.workflow_hermes import CognitiveFailure
    import asyncio
    stages = create_app(settings).state.manager.workflows.hermes
    (settings.hermes_profile / 'config.yaml').write_text('memory:\n  memory_enabled: true\n', encoding='utf-8')
    with pytest.raises(CognitiveFailure, match='security_gate'):
        asyncio.run(stages.analysis({'cognitive_client': 'live'}, 'attempt-denied', lambda: False))
    assert hermes.requests == []


def test_daily_budget_is_reserved_and_blocks_next_authorization(settings, hermes):
    from dataclasses import replace
    settings = replace(settings, max_tokens_per_day=settings.max_tokens_per_run)
    hermes.scenarios.append(Scenario(hold=True, output=echo()))
    with client_for(settings) as client:
        workflow = authorize(client, pending(client, create(client)['id']))
        wait(client, workflow['id'], lambda w: bool(w['cognitive_runs']))
        status = client.get('/v1/security/status').json()
        assert any(b['code'] == 'daily_token_limit' for b in status['blockers'])
        assert status['real_execution_allowed'] is False


@pytest.mark.parametrize('failed', [False, True])
def test_daily_real_run_limit_counts_zero_usage_and_failures(settings, hermes, failed):
    from dataclasses import replace
    from horus_backend.security import daily_runs
    settings = replace(settings, max_runs_per_day=1)
    hermes.scenarios.append(Scenario(output='' if failed else echo(), final_status='failed' if failed else 'completed',
                                    usage={'input_tokens': 0, 'output_tokens': 0, 'total_tokens': 0}))
    app = create_app(settings)
    with TestClient(app, base_url='http://127.0.0.1', headers=HEADERS) as client:
        workflow = authorize(client, pending(client, create(client)['id']))
        wait(client, workflow['id'], lambda w: w['status'] == ('failed' if failed else 'awaiting_approval'))
        assert daily_runs(app.state.store) == 1
        report = client.get('/v1/security/status').json()
        assert 'daily_run_limit' in {b['code'] for b in report['blockers']}
        second = pending(client, create(client, key='pedido-2')['id'])
        response = client.post(f"/v1/workflows/{second['id']}/authorize", headers={'Idempotency-Key': 'segunda'},
            json={'expected_revision': second['revision'], 'job_id': second['pending_authorization']['job_id']})
        assert response.status_code == 409 and len(hermes.requests) == 1
        # A fonte oficial é cognitive_client: simulação não consome quota e dia anterior não conta.
        with app.state.store.connect() as db:
            db.execute("UPDATE workflows SET cognitive_client='simulated' WHERE id=?", (workflow['id'],))
        assert daily_runs(app.state.store) == 0
        with app.state.store.connect() as db:
            db.execute("UPDATE workflows SET cognitive_client='live' WHERE id=?", (workflow['id'],))
            db.execute("UPDATE cognitive_runs SET created_at='2000-01-01T00:00:00Z'")
        assert daily_runs(app.state.store) == 0


def test_daily_run_limit_rechecked_inside_reservation_transaction(settings, hermes, monkeypatch):
    from dataclasses import replace
    import horus_backend.workflow_hermes as adapter
    settings = replace(settings, max_runs_per_day=1)
    def exhausted_after_authorization(store, db, *, day=None):
        # Outra admissão pode consumir a última vaga após a autorização; rechecagem sob lock.
        assert db.in_transaction
        return 1
    monkeypatch.setattr(adapter, 'daily_runs', exhausted_after_authorization)
    with client_for(settings) as client:
        workflow = authorize(client, pending(client, create(client)['id']))
        result = wait(client, workflow['id'], lambda w: w['status'] == 'failed')
        assert result['cognitive_runs'] == [] and hermes.requests == []
        assert 'Teto diário' in result['steps'][2]['error']


def test_remote_error_body_never_reaches_events(settings, hermes, caplog):
    # O cliente não usa corpo remoto, mesmo que o servidor reflita token e API_SERVER_KEY.
    from urllib.error import HTTPError
    from io import BytesIO
    from horus_backend.workflow_hermes import HermesHTTPError, HermesRunClient
    secret = 'ficticio-API_SERVER_KEY-nao-registrar'
    connection = json.loads(settings.hermes_config.read_text())
    client = HermesRunClient(connection['base_url'], connection['token'])
    class Denied:
        def open(self, *a, **kw):
            raise HTTPError(connection['base_url'], 403, 'Forbidden', {}, BytesIO(json.dumps({'error': {
                'code': secret, 'message': connection['token'] + secret}}).encode()))
    client.opener = Denied()
    with pytest.raises(HermesHTTPError) as caught:
        client.submit({}, 'key')
    assert secret not in str(caught.value) + caplog.text
    assert connection['token'] not in str(caught.value) + caplog.text
    assert caught.value.code == 'remote_error'
