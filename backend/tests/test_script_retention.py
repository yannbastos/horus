"""Retenção M3: bancos temporários, relógio injetado e rede bloqueada."""
import json

import pytest
from test_retention import app, client, create, future, review
from horus_backend import hermes_simulator
from horus_backend.retention import run_retention
from horus_backend.workflows import encode


SENTINEL = 'RADAR_SCRIPT_RETENTION_SENTINEL'


def seed_script(client, monkeypatch):
    from horus_backend import api
    demo, result = api.demo, hermes_simulator.editorial_result

    def with_title(*args, **kwargs):
        dataset = demo(*args, **kwargs)
        next(item for item in dataset.records if item.source_id == 'video_demo_0').title = SENTINEL
        return dataset

    def derived(envelope):
        value = result(envelope)
        value['recommendation']['title_options'] = [envelope.dataset.items[0].title]
        value['recommendation']['premise'] = envelope.dataset.items[0].title
        return value

    monkeypatch.setattr(api, 'demo', with_title)
    monkeypatch.setattr(hermes_simulator, 'editorial_result', derived)
    workflow = create(client, 'script-retention', 'proposal')
    assert review(client, workflow, 'approve').status_code == 200
    path = f"/v1/workflows/{workflow['id']}/scripts"
    payload = {'expected_revision': 1, 'proposal_artifact_id': workflow['current_artifact_id']}
    generation = client.post(path, json=payload, headers={'Idempotency-Key': 'generate'})
    assert generation.status_code == 201
    script = generation.json()
    assert SENTINEL in encode(script['document'])
    return workflow, script, path, payload


def test_editorial_copies_preserved_and_raw_sources_redacted(client, app, monkeypatch):
    workflow, script, path, payload = seed_script(client, monkeypatch)
    review_path = f"/v1/scripts/{script['id']}/review"
    decision = {'expected_version': 1, 'decision': 'approve'}
    assert client.post(review_path, json=decision, headers={'Idempotency-Key': 'approve'}).status_code == 200
    report = run_retention(app.state.store, clock=future)
    assert report.redacted == 1 and report.failed == 0
    assert client.get(f"/v1/workflows/{workflow['id']}").json()['radar']['redacted_at']
    responses = [client.get(f"/v1/scripts/{script['id']}"), client.get(path),
                 client.post(path, json=payload, headers={'Idempotency-Key': 'generate'}),
                 client.post(review_path, json=decision, headers={'Idempotency-Key': 'approve'})]
    assert all(response.status_code == 200 and SENTINEL in response.text for response in responses)
    with app.state.store.connect() as db:
        assert SENTINEL in db.execute('SELECT document FROM scripts').fetchone()[0]
        assert all(SENTINEL in row[0] for row in db.execute('SELECT response FROM script_receipts'))
        sources = [json.loads(row[0]) for row in db.execute("SELECT content FROM artifacts WHERE stage IN ('research','analysis')")]
        assert next(item for item in sources if item['stage'] == 'research')['dataset']['redacted']
        assert next(item for item in sources if item['stage'] == 'analysis')['result']['sources']['redacted']
        assert next(item for item in sources if item['stage'] == 'analysis')['result']['facts']['redacted']
        event = json.loads(db.execute("SELECT data FROM workflow_events WHERE kind='workflow.radar_redacted'").fetchone()[0])
        assert event['script_editorial_literal_matches'] == 3
        assert event['script_receipt_editorial_literal_matches'] == 6
        assert event['editorial_literal_matches'] > 0  # Métrica anterior continua separada.
        assert SENTINEL not in encode(event)
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert client.get(f"/v1/scripts/{script['id']}").json()['status'] == 'approved'
    assert client.post(path, json=payload, headers={'Idempotency-Key': 'new-generation'}).status_code == 409
    assert client.post(path, json={**payload, 'expected_revision': 2}, headers={'Idempotency-Key': 'generate'}).status_code == 409
    assert run_retention(app.state.store, clock=future).already_redacted == 1


@pytest.mark.parametrize('decision', ['approve', 'reject'])
def test_redacted_radar_blocks_new_changes_atomically_but_allows_final_review(client, app, monkeypatch, decision):
    workflow, script, path, payload = seed_script(client, monkeypatch)
    report = run_retention(app.state.store, clock=future)
    assert report.redacted == 1 and report.failed == 0
    review_path = f"/v1/scripts/{script['id']}/review"

    def snapshot():
        with app.state.store.connect() as db:
            return [tuple(row) for table in ('scripts', 'script_receipts', 'workflow_events')
                    for row in db.execute(f'SELECT * FROM {table} ORDER BY 1')]

    before = snapshot()
    response = client.post(review_path, json={'expected_version': 1, 'decision': 'request_changes', 'feedback': 'Rever abertura'},
                           headers={'Idempotency-Key': 'blocked-changes'})
    assert response.status_code == 409 and 'Radar' in response.json()['detail']
    assert snapshot() == before
    response = client.post(review_path, json={'expected_version': 1, 'decision': decision},
                           headers={'Idempotency-Key': 'final-review'})
    assert response.status_code == 200
    assert response.json()['status'] == {'approve': 'approved', 'reject': 'rejected'}[decision]
    assert response.json()['document'] == script['document']
    assert client.post(review_path, json={'expected_version': 1, 'decision': decision},
                       headers={'Idempotency-Key': 'final-review'}).json() == response.json()
    assert client.post(path, json=payload, headers={'Idempotency-Key': 'generate'}).json() == script


def test_changes_replay_preserved_but_regeneration_blocked_after_retention(client, app, monkeypatch):
    workflow, script, path, payload = seed_script(client, monkeypatch)
    review_path = f"/v1/scripts/{script['id']}/review"
    decision = {'expected_version': 1, 'decision': 'request_changes', 'feedback': 'Rever abertura'}
    headers = {'Idempotency-Key': 'changes-before-retention'}
    previous = client.post(review_path, json=decision, headers=headers)
    assert previous.status_code == 200
    assert run_retention(app.state.store, clock=future).redacted == 1
    assert client.post(review_path, json=decision, headers=headers).json() == previous.json()
    assert client.post(review_path, json={**decision, 'feedback': 'Outro pedido'}, headers=headers).status_code == 409
    assert client.post(path, json=payload, headers={'Idempotency-Key': 'new-generation'}).status_code == 409
