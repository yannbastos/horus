from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest

from test_workflows import settings, client_for, create, wait, review
from horus_backend.storage import Store
from horus_backend.workflows import digest, encode


def approved(client):
    workflow = wait(client, create(client)["id"])
    assert review(client, workflow).status_code == 200
    return workflow


def generate(client, workflow, key="generate", **extra):
    return client.post(f"/v1/workflows/{workflow['id']}/scripts", headers={"Idempotency-Key": key},
        json={"expected_revision": workflow["revision"], "proposal_artifact_id": workflow["current_artifact_id"], **extra})


def decide(client, script, decision="approve", key="script-review", **extra):
    return client.post(f"/v1/scripts/{script['id']}/review", headers={"Idempotency-Key": key},
        json={"expected_version": script["version"], "decision": decision, **extra})


def test_versioned_review_and_restart(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        jobs = client.get('/v1/jobs').json()
        first = generate(client, workflow)
        assert first.status_code == 201, first.text
        first = first.json()
        assert first['status'] == 'awaiting_review'
        assert first['document']['simulated'] is True
        assert first['review'] is None
        assert generate(client, workflow).json() == first
        assert generate(client, workflow, key='double-click').status_code == 409
        assert decide(client, first, 'request_changes', feedback='').status_code == 422
        changed = decide(client, first, 'request_changes', feedback='Incluir fechamento original')
        assert changed.status_code == 200
        second = generate(client, workflow, key='generate-2').json()
        assert second['version'] == 2 and second['id'] != first['id']
        assert 'Incluir fechamento original' in second['document']['sections'][1]['narration']
        assert decide(client, first, key='old').status_code == 409
        assert decide(client, first, 'request_changes', feedback='Incluir fechamento original').json() == changed.json()
        result = decide(client, second, key='approve-2')
        assert result.status_code == 200
        result = result.json()
        assert result['status'] == 'approved'
        assert result['document'] == second['document']
        assert result['created_at'] <= result['review']['reviewed_at']
        assert generate(client, workflow, key='final').status_code == 409
        assert client.get('/v1/jobs').json() == jobs
        assert len(client.get(f"/v1/workflows/{workflow['id']}").json()['approvals']) == 1
    with client_for(settings) as client:
        assert client.get(f"/v1/scripts/{second['id']}").json() == result
        assert client.get(f"/v1/workflows/{workflow['id']}/scripts").json()['items'] == [result, changed.json()]
        assert generate(client, workflow).json() == first
        assert decide(client, second, key='approve-2').json() == result


def test_approval_revision_artifact_and_hash_gates(settings):
    with client_for(settings) as client:
        workflow = wait(client, create(client)['id'])
        assert generate(client, workflow).status_code == 409
        review(client, workflow)
        assert generate(client, workflow, expected_revision=2).status_code == 409
        assert generate(client, workflow, proposal_artifact_id='f'*32).status_code == 409
        store = client.app.state.store
        with store.connect() as db:
            db.execute("UPDATE artifacts SET content='{}' WHERE id=?", (workflow['current_artifact_id'],))
        assert generate(client, workflow).status_code == 409
        assert client.get(f"/v1/workflows/{workflow['id']}/scripts").json() == {'items': []}


def test_persisted_human_approval_is_required(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        with client.app.state.store.connect() as db:
            db.execute('DELETE FROM approvals')
        assert generate(client, workflow).status_code == 409


def test_api_auth_payload_and_idempotency(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        path = f"/v1/workflows/{workflow['id']}/scripts"
        assert client.post(path, json={}).status_code == 422
        assert generate(client, workflow, executor='hermes').status_code == 422
        assert generate(client, workflow, expected_revision=True).status_code == 422
        first = generate(client, workflow).json()
        assert generate(client, workflow, expected_revision=2).status_code == 409
        assert decide(client, first).status_code == 200
        assert decide(client, first, 'reject').status_code == 409
        assert decide(client, first, key='different').status_code == 409
        for route in (path, f"/v1/scripts/{first['id']}", f"/v1/scripts/{first['id']}/review"):
            assert client.get(route, headers={'Authorization': ''}).status_code == 401
            assert client.post(route, json={}, headers={'Authorization': ''}).status_code == 401
        assert client.get('/v1/scripts/'+'f'*32).status_code == 404
        assert client.get('/v1/workflows/'+'f'*32+'/scripts').status_code == 404


def test_competing_generation_and_review(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda key: generate(client, workflow, key), ['one', 'two']))
        assert sorted(r.status_code for r in results) == [201, 409]
        script = next(r.json() for r in results if r.status_code == 201)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda decision: decide(client, script, decision, decision), ['approve', 'reject']))
        assert sorted(r.status_code for r in results) == [200, 409]
        assert len(client.get(f"/v1/workflows/{workflow['id']}/scripts").json()['items']) == 1


def test_transaction_rollback_allows_safe_retry(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        with client.app.state.store.connect() as db:
            db.execute("CREATE TRIGGER fail_script BEFORE INSERT ON script_receipts BEGIN SELECT RAISE(ABORT,'test'); END")
        import sqlite3
        with pytest.raises(sqlite3.IntegrityError):
            generate(client, workflow)
        assert client.get(f"/v1/workflows/{workflow['id']}/scripts").json()['items'] == []
        with client.app.state.store.connect() as db:
            db.execute('DROP TRIGGER fail_script')
        script = generate(client, workflow).json()
        assert script['version'] == 1
        assert decide(client, script, 'reject').json()['status'] == 'rejected'
        assert generate(client, workflow, key='after-reject').status_code == 409


def test_simulated_radar_sources_and_invalid_output_are_sanitized(settings, monkeypatch, caplog):
    from test_radar_workflow import start, authorize, wait as radar_wait
    settings = replace(settings, hermes_poll_seconds=.03)
    from horus_backend import scripts

    with client_for(settings) as client:
        client.app.state.monkeypatch = monkeypatch
        monkeypatch.setattr('horus_backend.workflow_hermes.read_connection', lambda *a, **k: pytest.fail('Configuração privada acessada'))
        workflow = start(client)
        authorize(client, workflow)
        workflow = radar_wait(client, workflow['id'], lambda w: w['status'] == 'awaiting_approval')
        assert review(client, workflow).status_code == 200
        analysis = next(a for a in workflow['artifacts'] if a['stage'] == 'analysis')
        allowed = {s['id'] for s in analysis['content']['result']['sources']}
        assert allowed
        original = scripts.simulate_script
        sentinel = 'CONFIDENTIAL_SENTINEL_PRIVATE_TEXT'

        def invented(*args):
            doc = original(*args)
            doc['sections'][1]['source_ids'] = [sentinel]
            return doc

        monkeypatch.setattr(scripts, 'simulate_script', invented)
        response = generate(client, workflow)
        assert response.status_code == 422 and sentinel not in response.text

        def malformed(*args):
            return {**original(*args), 'title': {'private': sentinel}}

        monkeypatch.setattr(scripts, 'simulate_script', malformed)
        response = generate(client, workflow)
        assert response.status_code == 422 and sentinel not in response.text
        response = generate(client, workflow, expected_revision=sentinel)
        assert response.status_code == 422 and sentinel not in response.text
        with client.app.state.store.connect() as db:
            assert db.execute('SELECT COUNT(*) FROM scripts').fetchone()[0] == 0
            assert db.execute('SELECT COUNT(*) FROM script_receipts').fetchone()[0] == 0
            assert sentinel not in encode([dict(row) for row in db.execute('SELECT * FROM workflow_events')])
        assert sentinel not in caplog.text
        monkeypatch.setattr(scripts, 'simulate_script', original)
        script = generate(client, workflow).json()
        cited = {ref for section in script['document']['sections'] for ref in section['source_ids']}
        assert cited == allowed
        assert not cited.intersection({a['id'] for a in workflow['artifacts']})
        assert decide(client, script).status_code == 200


def test_corrupted_referenced_analysis_is_refused(settings, monkeypatch):
    from test_radar_workflow import start, authorize, wait as radar_wait
    settings = replace(settings, hermes_poll_seconds=.03)
    with client_for(settings) as client:
        client.app.state.monkeypatch = monkeypatch
        workflow = start(client)
        authorize(client, workflow)
        workflow = radar_wait(client, workflow['id'], lambda w: w['status'] == 'awaiting_approval')
        review(client, workflow)
        with client.app.state.store.connect() as db:
            db.execute("UPDATE artifacts SET content='{}' WHERE workflow_id=? AND stage='analysis'", (workflow['id'],))
        assert generate(client, workflow).status_code == 409


def test_analysis_from_another_workflow_is_refused_even_with_valid_hash(settings):
    import json
    with client_for(settings) as client:
        workflow = approved(client)
        other = wait(client, create(client, key='other-workflow')['id'])
        foreign_analysis = next(a for a in other['artifacts'] if a['stage'] == 'analysis')
        with client.app.state.store.connect() as db:
            row = db.execute('SELECT content FROM artifacts WHERE id=?', (workflow['current_artifact_id'],)).fetchone()
            content = {**json.loads(row['content']), 'schema_version': 2,
                       'source_artifact_ids': [foreign_analysis['id']]}
            db.execute('UPDATE artifacts SET content=?,content_hash=? WHERE id=?',
                       (encode(content), digest(content), workflow['current_artifact_id']))
        assert generate(client, workflow).status_code == 409
        assert client.get(f"/v1/workflows/{workflow['id']}/scripts").json()['items'] == []


def test_identical_concurrent_requests_replay(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: generate(client, workflow), range(2)))
        assert sorted(r.status_code for r in results) == [200, 201]
        assert results[0].json() == results[1].json()
        script = results[0].json()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: decide(client, script), range(2)))
        assert [r.status_code for r in results] == [200, 200]
        assert results[0].json() == results[1].json()


def test_migration_v5_preserves_approved_workflow(settings, monkeypatch):
    import sqlite3
    from horus_backend.migrations import MIGRATIONS, SCHEMA_VERSION
    with monkeypatch.context() as isolated:
        isolated.setattr('horus_backend.migrations.SCHEMA_VERSION', 4)
        with client_for(settings) as client:
            workflow = approved(client)
            before = client.get(f"/v1/workflows/{workflow['id']}").json()
            path = client.app.state.store.path
    with client_for(settings) as client:
        after = client.get(f"/v1/workflows/{workflow['id']}").json()
        assert after == before
        assert generate(client, workflow).status_code == 201
        with client.app.state.store.connect() as db:
            assert db.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION
            assert not db.execute('PRAGMA foreign_key_check').fetchall()
    backups = list(path.parent.glob('horus.backup-v4-*.sqlite3'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 4
        assert db.execute('SELECT status FROM workflows').fetchone()[0] == 'approved'
    rollback = path.parent / 'rollback.sqlite3'
    with monkeypatch.context() as isolated:
        isolated.setattr('horus_backend.migrations.SCHEMA_VERSION', 4)
        Store(rollback)
    with monkeypatch.context() as isolated:
        isolated.setitem(MIGRATIONS, 5, (*MIGRATIONS[5], 'INVALID SQL'))
        with pytest.raises(sqlite3.OperationalError):
            Store(rollback)
    with sqlite3.connect(rollback) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 4
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='scripts'").fetchone()


def test_long_proposal_preserves_review_feedback(settings):
    with client_for(settings) as client:
        workflow = wait(client, create(client)['id'])
        with client.app.state.store.connect() as db:
            import json
            artifact = db.execute('SELECT content FROM artifacts WHERE id=?', (workflow['current_artifact_id'],)).fetchone()
            content = {**json.loads(artifact['content']), 'text': 'P' * 8000}
            db.execute('UPDATE artifacts SET content=?,content_hash=? WHERE id=?',
                       (encode(content), digest(content), workflow['current_artifact_id']))
        assert review(client, workflow).status_code == 200
        first = generate(client, workflow).json()
        feedback = 'F' * 1995 + 'FINAL'
        assert decide(client, first, 'request_changes', feedback=feedback).status_code == 200
        second = generate(client, workflow, key='second').json()
        assert second['document']['sections'][1]['narration'].endswith(feedback)


def test_review_rollback_preserves_pending_state(settings):
    import sqlite3
    with client_for(settings) as client:
        workflow = approved(client)
        script = generate(client, workflow).json()
        with client.app.state.store.connect() as db:
            db.execute("CREATE TRIGGER fail_review BEFORE INSERT ON script_receipts BEGIN SELECT RAISE(ABORT,'test'); END")
        with pytest.raises(sqlite3.IntegrityError):
            decide(client, script)
        assert client.get(f"/v1/scripts/{script['id']}").json() == script
        with client.app.state.store.connect() as db:
            assert db.execute("SELECT COUNT(*) FROM workflow_events WHERE kind='script.reviewed'").fetchone()[0] == 0
            db.execute('DROP TRIGGER fail_review')
        assert decide(client, script).json()['status'] == 'approved'


def test_simulated_script_omits_adjustments_label_without_feedback():
    from horus_backend.scripts import simulate_script
    proposal = {"title": "T", "recommendation": {"premise": "Premissa."}}
    empty = simulate_script(proposal, "", set())["sections"][1]["narration"]
    assert "Ajustes" not in empty and "\n" not in empty
    with_feedback = simulate_script(proposal, "Mais exemplos", set())["sections"][1]["narration"]
    assert with_feedback.endswith("Ajustes da revisão anterior: Mais exemplos")
