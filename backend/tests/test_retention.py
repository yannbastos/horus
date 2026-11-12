"""Retenção das cópias do Radar no banco operacional. Offline, bancos em tmp_path, relógio injetado."""
import hashlib
import json
import socket
import sqlite3
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from horus_backend import retention
from horus_backend.api import create_app
from horus_backend.config import Settings
from horus_backend.retention import run_retention
from horus_backend.storage import Store

TOKEN = 'retention-test-token-local-1234567'
HEADERS = {'Authorization': f'Bearer {TOKEN}'}
TABLES = ('workflows', 'jobs', 'job_attempts', 'artifacts', 'approvals', 'authorizations', 'cognitive_runs', 'workflow_events', 'events')
YOUTUBE_TEXT = ('[DEMONSTRAÇÃO]', 'example.org')


def future():
    return datetime.now(timezone.utc) + timedelta(days=29)


def settings(tmp_path):
    return Settings(token=TOKEN, data_dir=tmp_path, factory_root=None, hermes_executable=None,
                    hermes_config=tmp_path / 'never-read.json', hermes_poll_seconds=.01)


@pytest.fixture
def app(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs): raise AssertionError('Rede/conexão proibida')
    monkeypatch.setattr('horus_backend.workflow_hermes.read_connection', forbidden)
    return create_app(settings(tmp_path))


@pytest.fixture
def client(app, monkeypatch):
    with TestClient(app, base_url='http://127.0.0.1', headers=HEADERS) as client:
        def forbidden(*args, **kwargs): raise AssertionError('Socket proibido')
        monkeypatch.setattr(socket.socket, 'connect', forbidden)
        yield client


def wait(client, wid, predicate):
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        value = client.get('/v1/workflows/' + wid).json()
        if predicate(value): return value
        time.sleep(.01)
    pytest.fail(str(value))


def create(client, key, until='pending'):
    info = client.post('/v1/radar/datasets/demo', headers={'Idempotency-Key': key}).json()
    body = dict(snapshot_id=info['snapshot_id'], revision=1, objective='Avaliar referências',
                channel=dict(channel_id='canal-01', summary='Perfil editorial'))
    response = client.post('/v1/workflows/radar', json=body, headers={'Idempotency-Key': key})
    assert response.status_code == 202, response.text
    w = wait(client, response.json()['id'], lambda w: w['pending_authorization'] is not None)
    if until == 'pending':
        return w
    response = client.post(f"/v1/workflows/{w['id']}/authorize", json=dict(expected_revision=1, job_id=w['pending_authorization']['job_id']),
                           headers={'Idempotency-Key': 'authorize-' + key})
    assert response.status_code == 200, response.text
    return wait(client, w['id'], lambda w: w['status'] == ('awaiting_approval' if until == 'proposal' else 'failed'))


def review(client, w, decision, feedback=''):
    return client.post(f"/v1/workflows/{w['id']}/review", json=dict(expected_revision=1, artifact_id=w['current_artifact_id'],
                       decision=decision, feedback=feedback), headers={'Idempotency-Key': 'review-' + decision})


def table_hashes(store):
    with store.connect() as db:
        return {t: hashlib.sha256(json.dumps([list(r) for r in db.execute(f'SELECT * FROM {t} ORDER BY 1')], default=str).encode()).hexdigest() for t in TABLES}


def counts(store):
    with store.connect() as db:
        return {t: db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in TABLES}


def dump(store, wid):
    """Todo o texto persistido do workflow, em qualquer tabela."""
    with store.connect() as db:
        rows = [list(r) for t in TABLES for r in db.execute(f'SELECT * FROM {t}')]
    return json.dumps(rows, ensure_ascii=False)


def test_not_expired_changes_nothing(client, app):
    create(client, 'a', 'proposal')
    before = table_hashes(app.state.store)
    report = run_retention(app.state.store)
    assert (report.evaluated, report.redacted, report.not_expired, report.ignored) == (1, 0, 1, 1)
    assert table_hashes(app.state.store) == before


def test_expired_awaiting_approval_is_redacted_but_reviewable(client, app):
    w = create(client, 'a', 'proposal')
    store = app.state.store
    assert any(text in dump(store, w['id']) for text in YOUTUBE_TEXT)
    proposal_before = next(a for a in w['artifacts'] if a['stage'] == 'proposal')
    dry = run_retention(store, clock=future, dry_run=True)
    assert dry.redacted == 1 and dry.workflow_ids == [w['id']] and 'redacted_at' not in client.get('/v1/workflows/' + w['id']).json()['radar']
    before = table_hashes(store)
    assert run_retention(store, clock=future, dry_run=True).redacted == 1 and table_hashes(store) == before  # dry-run não escreve
    report = run_retention(store, clock=future)
    assert (report.evaluated, report.redacted, report.failed) == (1, 1, 0)
    value = client.get('/v1/workflows/' + w['id']).json()
    assert value['status'] == 'awaiting_approval' and value['radar']['redacted_at'] and value['radar']['snapshot_id']
    for table, column in (('workflows', 'payload'), ('artifacts', 'content'), ('cognitive_runs', 'request')):
        with store.connect() as db:
            for row in db.execute(f'SELECT {column} FROM {table}'):
                assert not any(text in row[0] for text in YOUTUBE_TEXT), (table, row[0][:200])
    assert not any(text in json.dumps(value, ensure_ascii=False) for text in YOUTUBE_TEXT)
    research = next(a for a in value['artifacts'] if a['stage'] == 'research')['content']
    assert research['dataset']['redacted'] and len(research['dataset']['sha256']) == 64 and research['snapshot_hash']
    analysis = next(a for a in value['artifacts'] if a['stage'] == 'analysis')['content']['result']
    assert analysis['sources']['redacted'] and analysis['facts']['redacted'] and analysis['opportunities'] and analysis['recommendation']
    assert next(a for a in value['artifacts'] if a['stage'] == 'proposal') == proposal_before  # proposta e hash preservados
    kinds = [e['kind'] for e in client.get(f"/v1/workflows/{w['id']}/events").json()]
    assert kinds.count('workflow.radar_redacted') == 1
    event = next(e for e in client.get(f"/v1/workflows/{w['id']}/events").json() if e['kind'] == 'workflow.radar_redacted')
    assert not any(text in json.dumps(event, ensure_ascii=False) for text in YOUTUBE_TEXT) and event['data']['reason'] == 'radar_retention' and event['data']['editorial_literal_matches'] == 0
    assert review(client, value, 'approve').status_code == 200
    assert client.get('/v1/workflows/' + w['id']).json()['status'] == 'approved'


@pytest.mark.parametrize('how', ['approve', 'reject', 'cancel', 'failed'])
def test_expired_terminal_keeps_decisions(client, app, how, monkeypatch):
    if how == 'failed':
        monkeypatch.setattr('horus_backend.hermes_simulator.editorial_result', lambda envelope: {})
    w = create(client, how, 'failed' if how == 'failed' else 'proposal' if how in {'approve', 'reject'} else 'pending')
    if how in {'approve', 'reject'}:
        assert review(client, w, how, 'Decisão do operador').status_code == 200
    if how == 'cancel':
        client.post(f"/v1/workflows/{w['id']}/cancel")
        wait(client, w['id'], lambda w: w['status'] == 'cancelled')
    store = app.state.store
    with store.connect() as db:
        status = db.execute('SELECT status FROM workflows').fetchone()[0]
        approvals = [tuple(r) for r in db.execute('SELECT decision,feedback,artifact_id FROM approvals')]
    assert run_retention(store, clock=future).redacted == 1
    with store.connect() as db:
        assert db.execute('SELECT status FROM workflows').fetchone()[0] == status
        assert [tuple(r) for r in db.execute('SELECT decision,feedback,artifact_id FROM approvals')] == approvals
    for table, column in (('workflows', 'payload'), ('artifacts', 'content'), ('cognitive_runs', 'request')):
        with store.connect() as db:
            assert not any(text in r[0] for r in db.execute(f'SELECT {column} FROM {table}') for text in YOUTUBE_TEXT)


def test_guards_return_409_for_redacted_workflow(client, app, monkeypatch):
    pending = create(client, 'p', 'pending')
    proposal = create(client, 'r', 'proposal')
    monkeypatch.setattr('horus_backend.hermes_simulator.editorial_result', lambda envelope: {})
    failed = create(client, 'f', 'failed')
    assert run_retention(app.state.store, clock=future).redacted == 3
    post = lambda path, body, key='k': client.post(f'/v1/workflows/{path}', json=body, headers={'Idempotency-Key': key})
    for path in ('retry', 'reconcile'):
        response = post(f"{failed['id']}/{path}", dict(expected_revision=1))
        assert response.status_code == 409 and 'removido' in response.text
    response = post(f"{pending['id']}/authorize", dict(expected_revision=1, job_id=pending['pending_authorization']['job_id']))
    assert response.status_code == 409 and 'removido' in response.text
    assert post(f"{proposal['id']}/review", dict(expected_revision=1, artifact_id=proposal['current_artifact_id'],
                                                 decision='request_changes', feedback='mudar'), 'chg').status_code == 409
    assert client.get('/v1/workflows/' + pending['id']).json()['status'] == 'queued'  # estado inalterado
    assert client.get('/v1/workflows/' + failed['id']).status_code == 200


def test_idempotent_second_run(client, app):
    create(client, 'a', 'proposal')
    store = app.state.store
    first = run_retention(store, clock=future)
    assert first.redacted == 1 and first.checkpoint['status'] == 'ok'  # checkpoint(TRUNCATE) após redigir
    after = table_hashes(store)
    second = run_retention(store, clock=future)
    assert (second.redacted, second.already_redacted, second.failed) == (0, 1, 0) and second.checkpoint is None
    assert table_hashes(store) == after
    with store.connect() as db:
        assert db.execute("SELECT COUNT(*) FROM workflow_events WHERE kind='workflow.radar_redacted'").fetchone()[0] == 1


def test_failure_rolls_back_only_that_workflow(client, app, monkeypatch):
    first, second = create(client, 'a', 'proposal'), create(client, 'b', 'proposal')
    store = app.state.store
    original, calls = retention._redact_artifacts, []

    def flaky(*args):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError('falha injetada após a atualização do payload')
        return original(*args)
    monkeypatch.setattr(retention, '_redact_artifacts', flaky)
    before = table_hashes(store)
    report = run_retention(store, clock=future)
    assert (report.redacted, report.failed) == (1, 1) and report.errors[0]['workflow_id'] in {first['id'], second['id']}
    failed_id = report.errors[0]['workflow_id']
    ok_id = next(w['id'] for w in (first, second) if w['id'] != failed_id)
    with store.connect() as db:
        for wid, expected in ((failed_id, False), (ok_id, True)):
            assert ('redacted_at' in json.loads(db.execute('SELECT payload FROM workflows WHERE id=?', (wid,)).fetchone()[0])['radar']) is expected
        assert db.execute("SELECT COUNT(*) FROM workflow_events WHERE kind='workflow.radar_redacted'").fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM artifacts WHERE workflow_id=? AND content LIKE ?', (failed_id, '%example.org%')).fetchone()[0] > 0
    monkeypatch.setattr(retention, '_redact_artifacts', original)
    assert run_retention(store, clock=future).redacted == 1  # a próxima janela conclui o que falhou
    assert before != table_hashes(store)


def test_startup_runs_retention_and_state_survives_restart(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs): raise AssertionError('Rede/conexão proibida')
    monkeypatch.setattr('horus_backend.workflow_hermes.read_connection', forbidden)
    first = create_app(settings(tmp_path))
    with TestClient(first, base_url='http://127.0.0.1', headers=HEADERS) as client:
        monkeypatch.setattr(socket.socket, 'connect', forbidden)
        w = create(client, 'a', 'proposal')
    monkeypatch.undo()
    monkeypatch.setattr('horus_backend.workflow_hermes.read_connection', forbidden)
    path = first.state.store.path
    with sqlite3.connect(path) as db:  # somente tmp_path: força a expiração sem alterar o relógio do processo
        payload = json.loads(db.execute('SELECT payload FROM workflows WHERE id=?', (w['id'],)).fetchone()[0])
        payload['radar']['expires_at'] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat().replace('+00:00', 'Z')
        db.execute('UPDATE workflows SET payload=? WHERE id=?', (json.dumps(payload), w['id']))
    assert 'redacted_at' not in json.loads(sqlite3.connect(path).execute('SELECT payload FROM workflows').fetchone()[0])['radar']
    with TestClient(create_app(settings(tmp_path)), base_url='http://127.0.0.1', headers=HEADERS) as client:  # start() limpa
        value = client.get('/v1/workflows/' + w['id']).json()
        assert value['radar']['redacted_at'] and value['status'] == 'awaiting_approval'
    reopened = Store(path)
    with reopened.connect() as db:
        assert 'redacted_at' in json.loads(db.execute('SELECT payload FROM workflows').fetchone()[0])['radar']
    assert run_retention(reopened).redacted == 0


def test_integrity_and_no_rows_removed(client, app):
    create(client, 'a', 'proposal'), create(client, 'b', 'pending')
    store = app.state.store
    before = counts(store)
    assert run_retention(store, clock=future).redacted == 2
    after = counts(store)
    assert after.pop('workflow_events') == before.pop('workflow_events') + 2 and after == before
    with store.connect() as db:
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'


def test_non_radar_workflows_untouched(client, app):
    simulated = client.post('/v1/workflows', json=dict(objective='Sem Radar'), headers={'Idempotency-Key': 'sim'}).json()
    wait(client, simulated['id'], lambda w: w['status'] == 'awaiting_approval')
    store = app.state.store
    payload = json.dumps(dict(objective='x', dataset=dict(items=[dict(title='[DEMONSTRAÇÃO] externo', url='https://example.org/x')])))
    with store.connect() as db:  # linha artificial: executor hermes com dataset, porém sem bloco radar
        db.execute("""INSERT INTO workflows(id,idempotency_key,payload,revision,status,created_at,updated_at,executor)
            VALUES('h','h',?,1,'failed','now','now','hermes')""", (payload,))
    before = table_hashes(store)
    report = run_retention(store, clock=future)
    assert (report.evaluated, report.redacted) == (0, 0) and table_hashes(store) == before


def test_no_network_during_cleanup(client, app):
    create(client, 'a', 'proposal')
    with pytest.raises(AssertionError):
        socket.socket().connect(('127.0.0.1', 9))
    assert run_retention(app.state.store, clock=future).redacted == 1
