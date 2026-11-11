import asyncio
import json
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from horus_backend.api import create_app
from horus_backend.config import Settings
from horus_backend.migrations import MIGRATIONS, SCHEMA_VERSION
from horus_backend.storage import Store
from horus_backend.workflows import STAGES, WorkflowRequest, WorkflowService, simulate

TOKEN = "workflow-tests-local-session-token-123456789"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
REQUEST = {"objective": "Planejar um vídeo original sobre cidades", "references": ["referência fornecida pelo operador"]}


@pytest.fixture
def settings(tmp_path):
    factory = tmp_path / "fake_factory.py"
    factory.write_text('import json; print(json.dumps({"id":"canal01"}))', encoding="utf-8")
    return Settings(token=TOKEN, data_dir=tmp_path / "data", factory_root=tmp_path,
                    factory_command=(sys.executable, str(factory)), hermes_executable=None,
                    hermes_config=tmp_path / "unused-private-config.json")


def client_for(settings):
    return TestClient(create_app(settings), base_url="http://127.0.0.1", headers=HEADERS)


def create(client, key="request-1", payload=None):
    response = client.post("/v1/workflows", json=payload or REQUEST, headers={"Idempotency-Key": key})
    assert response.status_code == 202, response.text
    return response.json()


def wait(client, workflow_id, statuses=("awaiting_approval",)):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        response = client.get(f"/v1/workflows/{workflow_id}")
        assert response.status_code == 200
        workflow = response.json()
        if workflow["status"] in statuses:
            return workflow
        time.sleep(.02)
    pytest.fail(f"Workflow não chegou a {statuses}: {workflow['status']}")


def review(client, workflow, decision="approve", key="review-1", **extra):
    return client.post(f"/v1/workflows/{workflow['id']}/review", headers={"Idempotency-Key": key},
                       json={"expected_revision": workflow["revision"], "artifact_id": workflow["current_artifact_id"],
                             "decision": decision, **extra})


def test_complete_workflow_is_simulated_and_keeps_worker_free(settings, monkeypatch):
    from horus_backend.hermes import HermesConnector
    from horus_backend.processes import OwnedProcess

    async def forbidden(*args, **kwargs):
        pytest.fail("O workflow simulado não deve usar processos ou Hermes.")

    with client_for(settings) as client:
        with monkeypatch.context() as guard:
            guard.setattr(HermesConnector, "probe", forbidden)
            guard.setattr(OwnedProcess, "start", forbidden)
            workflow = wait(client, create(client)["id"])
        assert [step["step_key"] for step in workflow["steps"]] == list(STAGES)
        assert all(step["status"] == "succeeded" for step in workflow["steps"])
        assert len(workflow["attempts"]) == len(workflow["artifacts"]) == 4
        assert all(item["content"]["simulated"] is True for item in workflow["artifacts"])
        assert all(item["executor"] == "simulated-v1" for item in workflow["attempts"])
        assert workflow["approvals"] == []
        assert client.app.state.manager.active_id is None
        # Aguardar revisão humana não ocupa o único worker: operação antiga continua funcionando.
        job = client.post("/v1/jobs", json={"operation": "factory.profile"}).json()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            job = client.get(f"/v1/jobs/{job['id']}").json()
            if job["status"] == "succeeded":
                break
            time.sleep(.02)
        assert job["status"] == "succeeded"
        response = review(client, workflow)
        assert response.status_code == 200, response.text
        assert response.json()["workflow"]["status"] == "approved"
        assert response.json()["approval"]["operator_id"] == "local-operator"
        assert response.json()["approval"]["scope"] == "editorial_proposal"
        assert len(client.get("/v1/jobs").json()) == 5  # Aprovação não produz vídeo.


def test_create_and_review_are_idempotent_and_conflicts_are_rejected(settings):
    with client_for(settings) as client:
        first = create(client)
        assert create(client)["id"] == first["id"]
        assert client.post("/v1/workflows", json={"objective": "Outra entrada"}, headers={"Idempotency-Key": "request-1"}).status_code == 409
        workflow = wait(client, first["id"])
        a = review(client, workflow)
        b = review(client, workflow)
        assert a.status_code == b.status_code == 200
        assert a.json()["approval"]["id"] == b.json()["approval"]["id"]
        assert len(b.json()["workflow"]["approvals"]) == 1
        assert review(client, workflow, decision="reject").status_code == 409
        assert review(client, workflow, key="other-review").status_code == 409
        assert len(b.json()["workflow"]["attempts"]) == 4


def test_changes_create_versioned_artifacts_and_reject_obsolete_approval(settings):
    with client_for(settings) as client:
        old = wait(client, create(client)["id"])
        response = review(client, old, "request_changes", feedback="Mudar a abordagem para transporte", key="change-1")
        assert response.status_code == 200, response.text
        current = wait(client, old["id"])
        assert current["revision"] == 2
        assert len(current["steps"]) == len(current["artifacts"]) == len(current["attempts"]) == 8
        assert {a["id"] for a in old["artifacts"]}.issubset({a["id"] for a in current["artifacts"]})
        assert current["current_artifact_id"] != old["current_artifact_id"]
        assert review(client, old, key="obsolete").status_code == 409
        assert review(client, old, "request_changes", feedback="Mudar a abordagem para transporte", key="change-1").status_code == 200
        assert client.get(f"/v1/workflows/{old['id']}").json()["revision"] == 2
        assert review(client, current, key="approve-2").json()["workflow"]["status"] == "approved"


def test_rejection_is_terminal_and_persists(settings):
    with client_for(settings) as client:
        workflow = wait(client, create(client)["id"])
        assert review(client, workflow, decision="reject").json()["workflow"]["status"] == "rejected"
    with client_for(settings) as restarted:
        restored = restarted.get(f"/v1/workflows/{workflow['id']}").json()
        assert restored["status"] == "rejected"
        assert len(restored["approvals"]) == 1
        assert len(restored["attempts"]) == 4


def test_awaiting_approval_and_journal_survive_restart(settings):
    with client_for(settings) as client:
        workflow = wait(client, create(client)["id"])
        events = client.get(f"/v1/workflows/{workflow['id']}/events").json()
        assert events[0]["kind"] == "workflow.created"
        assert any(e["kind"] == "workflow.awaiting_approval" for e in events)
        cursor = events[-1]["sequence"]
    with client_for(settings) as restarted:
        restored = restarted.get(f"/v1/workflows/{workflow['id']}").json()
        assert restored["status"] == "awaiting_approval"
        assert restored["attempts"] == workflow["attempts"]
        assert restarted.get(f"/v1/workflows/{workflow['id']}/events?after={cursor}").json() == []
        assert review(restarted, restored).status_code == 200
        assert restarted.get(f"/v1/workflows/{workflow['id']}/events?after={cursor}").json()[0]["kind"] == "review.recorded"


def test_failed_attempt_is_preserved_and_retry_does_not_repeat_completed_step(settings):
    with client_for(settings) as client:
        service = client.app.state.manager.workflows

        async def fail_research(context):
            if context["stage"] == "research":
                raise RuntimeError("falha simulada")
            return await simulate(context)

        service.executor = fail_research
        failed = wait(client, create(client)["id"], ("failed",))
        assert [a["status"] for a in failed["attempts"]] == ["succeeded", "failed"]
        assert "falha simulada" in failed["attempts"][1]["error"]
        failed_job = next(j for j in failed["steps"] if j["status"] == "failed")
        assert client.post(f"/v1/jobs/{failed_job['id']}/retry").status_code == 409
        service.executor = simulate
        assert client.post(f"/v1/workflows/{failed['id']}/retry", json={"expected_revision": 1}).status_code == 200
        completed = wait(client, failed["id"])
        assert len(completed["attempts"]) == 5
        assert len(completed["artifacts"]) == 4
        assert completed["steps"][0]["attempt"] == 1
        assert completed["steps"][1]["attempt"] == 2
        assert completed["attempts"][1]["status"] == "failed"


def test_cancellation_stops_simulated_step_and_prevents_dependents(settings):
    with client_for(settings) as client:
        async def slow(context):
            await asyncio.sleep(30)
            return await simulate(context)

        client.app.state.manager.workflows.executor = slow
        workflow = wait(client, create(client)["id"], ("running",))
        queued = create(client, key="second")
        assert client.post(f"/v1/workflows/{queued['id']}/cancel").json()["status"] == "cancelled"
        # Compatibilidade: cancelar um job editorial cancela seu workflow inteiro.
        active = next(j for j in workflow["steps"] if j["status"] == "running")
        assert client.post(f"/v1/jobs/{active['id']}/cancel").status_code == 200
        cancelled = wait(client, workflow["id"], ("cancelled",))
        assert all(step["status"] == "cancelled" for step in cancelled["steps"])
        assert len(cancelled["attempts"]) == 1
        assert cancelled["attempts"][0]["status"] == "cancelled"
        assert cancelled["artifacts"] == []
        assert client.get(f"/v1/workflows/{queued['id']}").json()["attempts"] == []
        assert client.post(f"/v1/workflows/{workflow['id']}/cancel").json()["status"] == "cancelled"


def seed_without_worker(settings):
    store = Store(settings.data_dir / "horus.sqlite3")

    async def notify():
        pass

    service = WorkflowService(store, asyncio.Queue(), notify)
    workflow = asyncio.run(service.create(WorkflowRequest(**REQUEST), "seed"))
    return store, service, workflow


@pytest.mark.parametrize("completed_before_crash", [False, True])
def test_abrupt_process_exit_recovers_without_duplicate_artifact(settings, completed_before_crash):
    store, service, workflow = seed_without_worker(settings)
    job_id = workflow["steps"][0]["id"]
    script = """
import asyncio, os, sys
from pathlib import Path
from horus_backend.storage import Store
from horus_backend.worker_lock import WorkerLock
from horus_backend.workflows import WorkflowService, simulate
store = Store(Path(sys.argv[1]))
lock = WorkerLock(store.path)
lock.acquire()
service = WorkflowService(store, asyncio.Queue(), None)
attempt, context = service._claim(sys.argv[2])
if sys.argv[3] == 'True':
    service._finish(sys.argv[2], attempt, 'succeeded', content=asyncio.run(simulate(context)))
os._exit(0)
"""
    process = subprocess.run([sys.executable, "-c", script, str(store.path), job_id, str(completed_before_crash)], capture_output=True, timeout=10)
    assert process.returncode == 0, process.stderr.decode(errors="replace")
    with client_for(settings) as restarted:
        if completed_before_crash:
            recovered = wait(restarted, workflow["id"])
            assert len(recovered["attempts"]) == 4
            assert recovered["steps"][0]["attempt"] == 1
        else:
            interrupted = restarted.get(f"/v1/workflows/{workflow['id']}").json()
            assert interrupted["status"] == "interrupted"
            assert interrupted["attempts"][0]["status"] == "interrupted"
            assert interrupted["artifacts"] == []
            assert restarted.post(f"/v1/workflows/{workflow['id']}/retry", json={"expected_revision": 1}).status_code == 200
            recovered = wait(restarted, workflow["id"])
            assert len(recovered["attempts"]) == 5
        assert len(recovered["artifacts"]) == 4
        assert len({a["job_id"] for a in recovered["artifacts"]}) == 4


def test_dependency_and_artifact_integrity_are_checked_before_execution(settings):
    store, service, workflow = seed_without_worker(settings)
    research_id = workflow["steps"][1]["id"]
    with store.connect() as db:
        db.execute("UPDATE jobs SET status='queued' WHERE id=?", (research_id,))
    asyncio.run(service.run_step(store.get_job(research_id)))
    blocked = service.get(workflow["id"])
    assert blocked["status"] == "failed"
    assert blocked["steps"][1]["status"] == "blocked"
    assert blocked["attempts"] == []


def test_tampered_dependency_artifact_is_not_consumed(settings):
    store, service, workflow = seed_without_worker(settings)
    first = workflow["steps"][0]["id"]
    attempt, context = service._claim(first)
    research = service._finish(first, attempt, "succeeded", content=asyncio.run(simulate(context)))
    with store.connect() as db:
        db.execute("UPDATE artifacts SET content='{}' WHERE job_id=?", (first,))
    asyncio.run(service.run_step(store.get_job(research)))
    blocked = service.get(workflow["id"])
    assert blocked["status"] == "failed"
    assert "integridade" in blocked["steps"][1]["error"]
    assert len(blocked["attempts"]) == 1


def test_step_result_and_next_release_commit_atomically(settings):
    store, service, workflow = seed_without_worker(settings)
    with store.connect() as db:
        db.execute("""CREATE TRIGGER fail_release BEFORE UPDATE OF status ON jobs
            WHEN NEW.step_key='research' AND NEW.status='queued'
            BEGIN SELECT RAISE(ABORT,'falha de teste na transação'); END""")
    with client_for(settings) as client:
        failed = wait(client, workflow["id"], ("failed",))
        assert failed["artifacts"] == []
        assert failed["steps"][0]["status"] == "failed"
        assert failed["steps"][1]["status"] == "waiting"
        assert failed["attempts"][0]["status"] == "failed"
        with store.connect() as db:
            db.execute("DROP TRIGGER fail_release")
        assert client.post(f"/v1/workflows/{workflow['id']}/retry", json={"expected_revision": 1}).status_code == 200
        assert len(wait(client, workflow["id"])["artifacts"]) == 4


def test_late_result_from_old_attempt_cannot_change_recovered_workflow(settings):
    store, service, workflow = seed_without_worker(settings)
    job_id = workflow["steps"][0]["id"]
    old_attempt, context = service._claim(job_id)
    service.recover()
    with client_for(settings) as client:
        client.post(f"/v1/workflows/{workflow['id']}/retry", json={"expected_revision": 1})
        completed = wait(client, workflow["id"])
        assert service._finish(job_id, old_attempt, "succeeded", content=asyncio.run(simulate(context))) is None
        after = client.get(f"/v1/workflows/{workflow['id']}").json()
        assert after["artifacts"] == completed["artifacts"]
        assert after["current_artifact_id"] == completed["current_artifact_id"]


def test_technical_log_retention_does_not_erase_editorial_history(settings):
    with client_for(settings) as client:
        workflow = wait(client, create(client)["id"])
        review(client, workflow)
        store = client.app.state.store
        job_id = workflow["steps"][0]["id"]
        with store.connect() as db:
            db.executemany("INSERT INTO events(job_id,kind,message,created_at) VALUES(?,'stdout','log','test')",
                           [(job_id,)] * 2001)
        store.event(job_id, "stdout", "última linha")
        assert len(client.get(f"/v1/workflows/{workflow['id']}").json()["approvals"]) == 1
        assert client.get(f"/v1/workflows/{workflow['id']}/events").json()[0]["kind"] == "workflow.created"


def test_cancelling_completed_step_does_not_cancel_workflow_waiting_for_review(settings):
    with client_for(settings) as client:
        workflow = wait(client, create(client)["id"])
        assert client.post(f"/v1/jobs/{workflow['steps'][0]['id']}/cancel").json()["status"] == "succeeded"
        assert client.get(f"/v1/workflows/{workflow['id']}").json()["status"] == "awaiting_approval"


def test_invalid_executor_output_does_not_advance_or_approve(settings):
    with client_for(settings) as client:
        async def invalid(context):
            return {**await simulate(context), "official_status": "approved"}

        client.app.state.manager.workflows.executor = invalid
        failed = wait(client, create(client)["id"], ("failed",))
        assert failed["artifacts"] == failed["approvals"] == []
        assert failed["steps"][1]["status"] == "waiting"
        assert len(failed["attempts"]) == 1


def test_competing_reviews_have_one_winner(settings):
    with client_for(settings) as client:
        workflow = wait(client, create(client)["id"])
        with ThreadPoolExecutor(max_workers=2) as pool:
            approve = pool.submit(review, client, workflow, "approve", "approve")
            reject = pool.submit(review, client, workflow, "reject", "reject")
            assert sorted([approve.result().status_code, reject.result().status_code]) == [200, 409]
        assert len(client.get(f"/v1/workflows/{workflow['id']}").json()["approvals"]) == 1


def test_second_backend_cannot_recover_another_workers_running_step(settings):
    with client_for(settings) as first:
        async def slow(context):
            await asyncio.sleep(30)
            return await simulate(context)

        first.app.state.manager.workflows.executor = slow
        workflow = wait(first, create(first)["id"], ("running",))
        with pytest.raises(RuntimeError, match="Outro backend"):
            with client_for(settings):
                pass
        assert first.get(f"/v1/workflows/{workflow['id']}").json()["status"] == "running"
    with client_for(settings) as next_instance:
        assert next_instance.get(f"/v1/workflows/{workflow['id']}").json()["status"] == "interrupted"


def test_contract_rejects_unapproved_operations_and_requires_authentication(settings):
    with client_for(settings) as client:
        assert client.post("/v1/workflows", json=REQUEST).status_code == 422
        assert client.post("/v1/workflows", json={**REQUEST, "executor": "hermes"}, headers={"Idempotency-Key": "bad"}).status_code == 422
        assert client.post("/v1/jobs", json={"operation": "editorial.simulated", "stage": "planning"}).status_code == 422
        assert client.post("/v1/workflows", json=REQUEST, headers={"Authorization": "wrong", "Idempotency-Key": "bad"}).status_code == 401
        assert client.get("/v1/workflows/missing").status_code == 404
        workflow = wait(client, create(client)["id"])
        assert review(client, workflow, operator_id="agent").status_code == 422
        assert review(client, workflow, decision="request_changes").status_code == 422
        assert client.get(f"/v1/workflows/{workflow['id']}/events?after=-1").status_code == 422


def create_v1(path):
    with sqlite3.connect(path) as db:
        for statement in MIGRATIONS[1]:
            db.execute(statement)
        db.execute("PRAGMA user_version=1")
        db.execute("INSERT INTO jobs VALUES('old-job','old-key','{}','succeeded','before','before',1,'{}',NULL)")
        db.execute("INSERT INTO events(job_id,kind,message,created_at) VALUES('old-job','state','succeeded','before')")
        db.execute("INSERT INTO media VALUES('old-media','old.mp4','old.mp4',1,1,'before')")


def test_migration_preserves_legacy_rows_and_creates_one_consistent_backup(tmp_path):
    path = tmp_path / "legacy.sqlite3"
    create_v1(path)
    store = Store(path)
    assert store.get_job("old-job")["result"] == {}
    assert store.events("old-job", 0)[0]["sequence"] == 1
    assert store.media("old-media")["path"] == "old.mp4"
    Store(path)
    backups = list(tmp_path.glob("legacy.backup-v1-*.sqlite3"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup, store.connect() as current:
        assert backup.execute("PRAGMA user_version").fetchone()[0] == 1
        assert backup.execute("SELECT id FROM jobs").fetchone()[0] == "old-job"
        assert current.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert current.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert current.execute("PRAGMA foreign_key_check").fetchall() == []


def test_migration_failure_rolls_back_schema_and_version(tmp_path, monkeypatch):
    path = tmp_path / "legacy.sqlite3"
    create_v1(path)
    monkeypatch.setitem(MIGRATIONS, 2, (*MIGRATIONS[2][:3], "INVALID SQL"))
    with pytest.raises(sqlite3.OperationalError):
        Store(path)
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
        assert db.execute("SELECT id FROM jobs").fetchone()[0] == "old-job"
        assert "workflow_id" not in {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
        assert db.execute("SELECT name FROM sqlite_master WHERE name='workflows'").fetchone() is None


def test_future_database_is_refused_without_downgrade(tmp_path):
    path = tmp_path / "future.sqlite3"
    with sqlite3.connect(path) as db:
        db.execute("PRAGMA user_version=999")
    with pytest.raises(RuntimeError, match="mais recente"):
        Store(path)
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 999
    assert list(tmp_path.glob("*.backup-*.sqlite3")) == []
