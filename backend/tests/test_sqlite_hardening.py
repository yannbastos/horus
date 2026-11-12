"""Endurecimento do SQLite operacional (SEC-S2): secure_delete, WAL, páginas livres e backups de migração.

Somente `tmp_path`, dados fictícios e relógio injetado; sem rede e sem tocar o banco real. Os testes de investigação
registram o comportamento medido do SQLite (os números citados em docs/seguranca-dados.md saem daqui).
"""
import asyncio
import hashlib
import json
import os
import shutil
import sqlite3
import uuid
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from horus_backend import backups, retention, storage
from horus_backend.config import Settings
from horus_backend.jobs import JobManager
from horus_backend.migrations import MIGRATIONS, SCHEMA_VERSION, migrate
from horus_backend.retention import run_retention
from horus_backend.storage import Store

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)
EXPIRED = '2026-10-01T00:00:00Z'
TABLES = ('workflows', 'jobs', 'job_attempts', 'artifacts', 'approvals', 'authorizations', 'cognitive_runs', 'workflow_events', 'events')


def clock():
    return NOW


def new_marker():
    return 'MARCADOR-SECS2-' + uuid.uuid4().hex


class PlainStore(Store):
    """Controle: o comportamento anterior (conexões sem `secure_delete`)."""

    @contextmanager
    def connect(self):
        with super().connect() as db:
            db.execute('PRAGMA secure_delete=OFF')
            yield db


def seed(store, marker, *, expires=EXPIRED, items=300, status='awaiting_approval', wid=None):
    """Workflow Radar fictício com dataset grande (páginas de overflow) contendo o marcador único."""
    wid = wid or uuid.uuid4().hex
    dataset = {'items': [{'title': f'{marker} vídeo {i} ' + 'x' * 200, 'url': f'https://example.org/{marker}/{i}',
                          'channel': f'Canal {marker}'} for i in range(items)]}
    payload = {'objective': 'Avaliar referências', 'dataset': dataset, 'radar': {'snapshot_id': 'snap-1', 'expires_at': expires}}
    with store.connect() as db:
        db.execute("INSERT INTO workflows(id,idempotency_key,payload,revision,status,created_at,updated_at) VALUES(?,?,?,1,?,'t','t')",
                   (wid, wid, json.dumps(payload, ensure_ascii=False), status))
    return wid


def hits(path, marker):
    """Ocorrências do marcador nos bytes do `.sqlite3` e do `-wal`."""
    path, needle = Path(path), marker.encode()
    wal = path.with_name(path.name + '-wal')
    return path.read_bytes().count(needle), (wal.read_bytes().count(needle) if wal.exists() else 0)


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / 'horus.sqlite3'


@pytest.fixture
def open_reader(db_path):
    """Conexão extra aberta: impede que o fechamento da última conexão apague o WAL (como no backend em uso)."""
    readers = []

    def make(*, snapshot=False):
        reader = sqlite3.connect(db_path)
        reader.execute('SELECT COUNT(*) FROM sqlite_master').fetchone()  # só uma conexão que já leu mantém o WAL em uso
        if snapshot:
            reader.execute('BEGIN')
            reader.execute('SELECT COUNT(*) FROM workflows').fetchone()  # fixa o snapshot de leitura
        readers.append(reader)
        return reader
    yield make
    for reader in readers:
        reader.close()


def integrity(store):
    with store.connect() as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()


def counts(store):
    with store.connect() as db:
        return {t: db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in TABLES}


# --- secure_delete -----------------------------------------------------------------------------------------

def test_every_connection_enables_secure_delete(db_path):
    store = Store(db_path)
    with store.connect() as db:
        assert db.execute('PRAGMA secure_delete').fetchone()[0] == 1
        assert db.execute('PRAGMA foreign_keys').fetchone()[0] == 1
    assert sqlite3.connect(db_path).execute('PRAGMA secure_delete').fetchone()[0] == 0  # padrão do SQLite: por conexão


def test_retention_leaves_no_marker_in_db_or_wal(db_path, open_reader):
    store, marker = Store(db_path), new_marker()
    open_reader()
    seed(store, marker)
    before = hits(db_path, marker)
    assert before[1] > 0, 'o WAL ainda guarda as páginas originais antes do checkpoint'  # sem checkpoint: tudo está no -wal
    report = run_retention(store, clock=clock)
    assert (report.redacted, report.failed) == (1, 0)
    assert report.checkpoint['status'] == 'ok' and report.checkpoint['wal_bytes'] == 0 and not report.checkpoint_pending
    assert hits(db_path, marker) == (0, 0)
    integrity(store)
    with store.connect() as db:
        assert marker not in db.execute('SELECT payload FROM workflows').fetchone()[0]


def test_control_without_secure_delete_marker_survives(db_path, open_reader):
    """Demonstra o problema: a redação por UPDATE sem secure_delete deixa o valor antigo no arquivo."""
    store, marker = PlainStore(db_path), new_marker()
    open_reader()
    seed(store, marker)
    report = run_retention(store, clock=clock)
    assert report.redacted == 1 and report.checkpoint['status'] == 'ok'
    db_hits, wal_hits = hits(db_path, marker)
    assert wal_hits == 0, 'após TRUNCATE o -wal está vazio'
    assert db_hits > 0, 'páginas livres/células antigas mantêm o valor redigido no .sqlite3'
    with store.connect() as db:
        assert db.execute('PRAGMA freelist_count').fetchone()[0] > 0
        assert marker not in db.execute('SELECT payload FROM workflows').fetchone()[0]  # a linha lógica está limpa


@pytest.mark.parametrize('operation', ['update', 'delete'])
def test_secure_delete_zeroes_overflow_pages(db_path, operation):
    """Valor grande (~60 KB, páginas de overflow) trocado por um curto ou apagado, com e sem secure_delete."""
    marker, results = new_marker(), {}
    for name, cls in (('plain', PlainStore), ('secure', Store)):
        path = db_path.with_name(f'{name}-{operation}.sqlite3')
        store = cls(path)
        reader = sqlite3.connect(path)
        with store.connect() as db:
            db.execute('INSERT INTO media VALUES(?,?,?,?,?,?)', ('m', 'p', marker * 3000, 1, 1, 'now'))
        store.checkpoint()
        with store.connect() as db:
            db.execute("UPDATE media SET name='[redigido]'" if operation == 'update' else 'DELETE FROM media')
            freelist = db.execute('PRAGMA freelist_count').fetchone()[0]
        store.checkpoint()
        reader.close()
        results[name] = (*hits(path, marker), freelist)
    assert results['plain'][0] > 0 and results['plain'][2] > 0  # sem secure_delete o valor antigo permanece
    assert results['secure'][:2] == (0, 0) and results['secure'][2] > 0  # páginas livres existem, mas zeradas


# --- WAL e checkpoint --------------------------------------------------------------------------------------

def test_wal_keeps_old_value_until_truncate_checkpoint(db_path, open_reader):
    store, marker = Store(db_path), new_marker()
    reader = open_reader()
    wal = db_path.with_name(db_path.name + '-wal')
    with store.connect() as db:
        db.execute('INSERT INTO media VALUES(?,?,?,?,?,?)', ('m', 'p', marker * 3000, 1, 1, 'now'))
    with store.connect() as db:
        db.execute('DELETE FROM media')
    assert hits(db_path, marker)[1] > 0  # secure_delete zerou as páginas, mas os quadros originais seguem no -wal
    reader.execute('PRAGMA wal_checkpoint(PASSIVE)')
    assert hits(db_path, marker)[1] > 0 and wal.stat().st_size > 0, 'PASSIVE copia para o banco, mas não esvazia o -wal'
    result = store.checkpoint()
    assert result['status'] == 'ok' and result['wal_bytes'] == 0 and wal.stat().st_size == 0
    assert hits(db_path, marker) == (0, 0)
    assert result['freelist_pages'] > 0 and result['page_count'] >= result['freelist_pages']  # só contagens
    assert marker not in json.dumps(result)


def test_closing_last_connection_removes_wal_but_not_plain_residue(db_path):
    """Sem conexão extra o SQLite faz checkpoint e remove o -wal ao fechar; isso não cobre páginas livres sem secure_delete."""
    marker = new_marker()
    for cls, expected in ((PlainStore, True), (Store, False)):
        path = db_path.with_name(cls.__name__ + '.sqlite3')
        store = cls(path)
        with store.connect() as db:
            db.execute('INSERT INTO media VALUES(?,?,?,?,?,?)', ('m', 'p', marker * 3000, 1, 1, 'now'))
        with store.connect() as db:
            db.execute('DELETE FROM media')
        assert not path.with_name(path.name + '-wal').exists()
        assert (hits(path, marker)[0] > 0) is expected


def test_checkpoint_with_active_reader_is_busy_and_does_not_break_cycle(db_path, open_reader):
    store, marker = Store(db_path), new_marker()
    seed(store, marker)
    reader = open_reader(snapshot=True)  # snapshot anterior à redação: impede o truncamento
    report = run_retention(store, clock=clock, checkpoint_timeout=0.05)
    assert (report.redacted, report.failed) == (1, 0)
    assert report.checkpoint['status'] == 'busy' and report.checkpoint_pending
    assert report.checkpoint['wal_bytes'] > 0 and marker not in json.dumps(report.checkpoint)
    integrity(store)
    reader.rollback()
    retry = run_retention(store, clock=clock, retry_checkpoint=True)  # nada novo a redigir: só repete o checkpoint
    assert retry.redacted == 0 and retry.checkpoint['status'] == 'ok' and not retry.checkpoint_pending
    assert hits(db_path, marker) == (0, 0)
    skipped = run_retention(store, clock=clock)
    assert skipped.checkpoint is None  # sem redação nova e sem pendência: não roda


def test_checkpoint_errors_are_reported_not_raised(db_path, monkeypatch):
    store, marker = Store(db_path), new_marker()
    seed(store, marker)
    real = sqlite3.connect

    def locked(*args, **kwargs):
        if kwargs.get('isolation_level', 'default') is None:  # somente a conexão do checkpoint
            raise sqlite3.OperationalError('database is locked')
        return real(*args, **kwargs)
    monkeypatch.setattr(storage.sqlite3, 'connect', locked)
    report = run_retention(store, clock=clock)
    assert report.redacted == 1 and report.failed == 0
    assert report.checkpoint == {'status': 'error', 'error': 'OperationalError'} and report.checkpoint_pending
    monkeypatch.undo()
    integrity(store)


def test_dry_run_never_checkpoints(db_path, open_reader):
    store, marker = Store(db_path), new_marker()
    open_reader()
    seed(store, marker)
    report = run_retention(store, clock=clock, dry_run=True, retry_checkpoint=True)
    assert report.redacted == 1 and report.checkpoint is None
    assert hits(db_path, marker)[1] > 0


def test_job_manager_cycle_tracks_pending_checkpoint(db_path, monkeypatch, open_reader):
    store, marker = Store(db_path), new_marker()
    seed(store, marker, expires='2000-01-01T00:00:00Z')
    settings = Settings(token='t' * 32, data_dir=db_path.parent, factory_root=None, hermes_executable=None,
                        hermes_config=db_path.parent / 'never-read.json', hermes_poll_seconds=.01)
    manager = JobManager(store, settings)
    original = retention.run_retention
    monkeypatch.setattr('horus_backend.jobs.run_retention',
                        lambda store, **kw: original(store, checkpoint_timeout=0.05, **kw))
    reader = open_reader(snapshot=True)
    report = asyncio.run(manager.run_retention())
    assert report.redacted == 1 and manager.checkpoint_pending
    assert manager.retention_status['last_status'] == 'ok' and manager.retention_status['checkpoint']['status'] == 'busy'
    reader.rollback()
    asyncio.run(manager.run_retention())
    assert not manager.checkpoint_pending and manager.retention_status['checkpoint']['status'] == 'ok'
    assert hits(db_path, marker) == (0, 0)
    assert marker not in json.dumps(manager.retention_status)


# --- integridade e recuperação -----------------------------------------------------------------------------

def test_integrity_and_row_counts_after_cycle(db_path, open_reader):
    store = Store(db_path)
    open_reader()
    for _ in range(3):
        seed(store, new_marker(), items=40)
    before = counts(store)
    assert run_retention(store, clock=clock).redacted == 3
    after = counts(store)
    assert after.pop('workflow_events') == before.pop('workflow_events') + 3 and after == before
    integrity(store)
    with store.connect() as db:
        assert db.execute('PRAGMA freelist_count').fetchone()[0] >= 0


def test_reopen_and_recover_after_failure_in_the_middle(db_path, monkeypatch):
    store, marker = Store(db_path), new_marker()
    wid = seed(store, marker)
    monkeypatch.setattr(retention, '_redact_artifacts', lambda *a: (_ for _ in ()).throw(RuntimeError('falha injetada')))
    report = run_retention(store, clock=clock)
    assert (report.redacted, report.failed, report.checkpoint) == (0, 1, None)  # nada redigido: sem checkpoint
    monkeypatch.undo()
    reopened = Store(db_path)  # reabre como após reinício do processo
    integrity(reopened)
    with reopened.connect() as db:  # a transação do workflow foi desfeita por inteiro
        assert 'redacted_at' not in json.loads(db.execute('SELECT payload FROM workflows WHERE id=?', (wid,)).fetchone()[0])['radar']
    assert run_retention(reopened, clock=clock).redacted == 1
    assert hits(db_path, marker) == (0, 0)
    integrity(reopened)


def test_copy_of_files_mid_transaction_recovers_from_wal(db_path, tmp_path, open_reader):
    """Falha simulada: .sqlite3 + -wal copiados com uma transação de redação aberta (sem commit) e sem -shm."""
    store, marker = Store(db_path), new_marker()
    open_reader()
    wid = seed(store, marker)
    db = sqlite3.connect(db_path)
    db.execute('BEGIN IMMEDIATE')
    db.execute("UPDATE workflows SET payload='{}', status='failed' WHERE id=?", (wid,))
    crashed = tmp_path / 'crash'
    crashed.mkdir()
    shutil.copyfile(db_path, crashed / db_path.name)
    shutil.copyfile(str(db_path) + '-wal', str(crashed / db_path.name) + '-wal')
    db.rollback()
    db.close()
    recovered = Store(crashed / db_path.name)
    integrity(recovered)
    with recovered.connect() as conn:  # só o que foi confirmado antes da "queda"
        row = conn.execute('SELECT status,payload FROM workflows WHERE id=?', (wid,)).fetchone()
    assert row['status'] == 'awaiting_approval' and marker in row['payload']
    assert run_retention(recovered, clock=clock).redacted == 1
    assert hits(crashed / db_path.name, marker) == (0, 0)


# --- páginas livres, auto_vacuum e VACUUM -----------------------------------------------------------------

def test_preexisting_residue_needs_one_time_vacuum(db_path):
    """secure_delete só vale para páginas liberadas depois de ligado; resíduo antigo da freelist exige VACUUM."""
    marker = new_marker()
    old = PlainStore(db_path)  # como o banco do operador antes desta entrega
    with old.connect() as db:
        db.execute('INSERT INTO media VALUES(?,?,?,?,?,?)', ('m', 'p', marker * 3000, 1, 1, 'now'))
    with old.connect() as db:
        db.execute('DELETE FROM media')
    store = Store(db_path)
    store.checkpoint()
    assert hits(db_path, marker)[0] > 0 and store.checkpoint()['freelist_pages'] > 0
    run_retention(store, clock=clock, retry_checkpoint=True)
    assert hits(db_path, marker)[0] > 0, 'ligar secure_delete e rodar a retenção não limpa páginas livres antigas'
    size_before = db_path.stat().st_size
    with closing(sqlite3.connect(db_path, isolation_level=None)) as db:
        db.execute('VACUUM')
    store.checkpoint()
    assert hits(db_path, marker) == (0, 0)
    assert db_path.stat().st_size < size_before and store.checkpoint()['freelist_pages'] == 0
    integrity(store)


def test_auto_vacuum_shrinks_file_but_does_not_replace_secure_delete(tmp_path):
    marker, results = new_marker(), {}
    for secure in (False, True):
        path = tmp_path / f'av-{secure}.sqlite3'
        with closing(sqlite3.connect(path, isolation_level=None)) as db:
            db.execute('PRAGMA auto_vacuum=FULL')
            db.execute('PRAGMA journal_mode=WAL')
            db.execute(f"PRAGMA secure_delete={'ON' if secure else 'OFF'}")
            db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')
            db.execute('INSERT INTO t(v) VALUES(?)', (marker * 3000,))
            db.execute("INSERT INTO t(v) VALUES('fica')")
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            grown = path.stat().st_size
            db.execute("UPDATE t SET v='[redigido]' WHERE id=1")
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
            results[secure] = (grown, path.stat().st_size, hits(path, marker)[0], db.execute('PRAGMA freelist_count').fetchone()[0])
    for secure, (grown, shrunk, found, freelist) in results.items():
        assert shrunk < grown and freelist == 0  # FULL devolve as páginas livres ao sistema de arquivos
    assert results[False][2] > 0, 'auto_vacuum sozinho deixa restos do valor antigo na página de dados'
    assert results[True][2] == 0


def test_vacuum_cost_scales_with_database_size_and_needs_space(tmp_path):
    """VACUUM reescreve o banco todo: no modo WAL o -wal cresce até ~tamanho do banco antes do checkpoint."""
    path = tmp_path / 'big.sqlite3'
    with closing(sqlite3.connect(path, isolation_level=None)) as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA secure_delete=ON')
        db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')
        db.execute('BEGIN')
        db.executemany('INSERT INTO t(v) VALUES(?)', [('x' * 2000,) for _ in range(5000)])
        db.execute('COMMIT')
        db.execute('DELETE FROM t WHERE id % 2 = 0')
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        size = path.stat().st_size
        db.execute('VACUUM')
        wal_peak = path.with_name(path.name + '-wal').stat().st_size
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        assert wal_peak >= size * 0.4, 'espaço extra necessário: arquivo + WAL ~ 2x'
        assert path.stat().st_size < size * 0.75
        db.execute(f"VACUUM INTO '{tmp_path / 'limpo.sqlite3'}'")  # alternativa: cópia compacta, sem páginas livres
        with closing(sqlite3.connect(tmp_path / 'limpo.sqlite3')) as clean:
            assert clean.execute('PRAGMA freelist_count').fetchone()[0] == 0


# --- backups de migração -----------------------------------------------------------------------------------

def legacy_database(path, *, radar=True, redacted=False, version=3):
    """Banco criado por uma versão anterior do Hórus, com (ou sem) cópia do Radar."""
    with closing(sqlite3.connect(path, isolation_level=None)) as db:
        db.execute('PRAGMA journal_mode=WAL')
        for v in range(1, version + 1):
            for statement in MIGRATIONS[v]:
                db.execute(statement)
        db.execute(f'PRAGMA user_version={version}')
        if radar and version >= 2:
            payload = {'dataset': {'items': [{'title': 'x'}]}, 'radar': {'expires_at': EXPIRED, **({'redacted_at': 'x'} if redacted else {})}}
            db.execute("INSERT INTO workflows(id,idempotency_key,payload,revision,status,created_at,updated_at) VALUES('w','w',?,1,'failed','t','t')",
                       (json.dumps(payload),))


def make_backup(directory, *, version=3, age_days=0, source=None, stem='horus'):
    name = directory / f'{stem}.backup-v{version}-{uuid.uuid4().hex}.sqlite3'
    shutil.copyfile(source, name)
    stamp = (NOW - timedelta(days=age_days)).timestamp()
    os.utime(name, (stamp, stamp))
    return name


@pytest.fixture
def backup_dir(tmp_path):
    source = tmp_path / 'fonte.sqlite3'
    legacy_database(source)
    with closing(sqlite3.connect(source)) as db:
        db.execute('PRAGMA journal_mode=DELETE')
    directory = tmp_path / 'data'
    directory.mkdir()
    (directory / 'horus.sqlite3').write_bytes(b'banco principal ficticio')
    return directory, source


def snapshot(directory):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.iterdir())}


def test_migration_created_backup_is_inventoried_with_radar_flag(tmp_path):
    database = tmp_path / 'horus.sqlite3'
    legacy_database(database)
    migrate(database)  # cria horus.backup-v3-<token>.sqlite3
    found = backups.inventory(database, clock=clock)
    assert [(e.version, e.radar_workflows, e.radar_unredacted) for e in found] == [(3, 1, 1)]
    assert backups.plan(database, retention_days=None, clock=clock).needs_operator_decision == [found[0].name]
    assert not [p for p in tmp_path.iterdir() if p.name.endswith(('-wal', '-shm')) and 'backup' in p.name]


def test_inventory_radar_detection_variants(tmp_path):
    database = tmp_path / 'horus.sqlite3'
    for label, kwargs in (('sem-radar', dict(radar=False)), ('redigido', dict(redacted=True)), ('v1', dict(version=1))):
        src = tmp_path / f'{label}.src'
        legacy_database(src, **kwargs)
        with closing(sqlite3.connect(src)) as db:
            db.execute('PRAGMA journal_mode=DELETE')
        make_backup(tmp_path, source=src, version=kwargs.get('version', 3), age_days={'sem-radar': 1, 'redigido': 2, 'v1': 3}[label])
    (tmp_path / f'horus.backup-v3-{"a" * 32}.sqlite3').write_bytes(b'nao e sqlite' * 20)
    (tmp_path / 'horus.backup-v3-notes.sqlite3').write_bytes(b'ignorado')
    (tmp_path / f'outro.backup-v3-{"b" * 32}.sqlite3').write_bytes(b'outro banco')
    by_version = {(e.version, e.radar_workflows, e.radar_unredacted) for e in backups.inventory(database, clock=clock)}
    assert by_version == {(3, 0, 0), (3, 1, 0), (1, 0, 0), (3, None, None)}


def test_dry_run_lists_reasons_and_deletes_nothing(backup_dir):
    directory, source = backup_dir
    database = directory / 'horus.sqlite3'
    newest = make_backup(directory, age_days=1, source=source)
    old = make_backup(directory, age_days=90, source=source)
    recent = make_backup(directory, age_days=5, source=source)
    future = make_backup(directory, version=SCHEMA_VERSION + 1, age_days=400, source=source)
    before = snapshot(directory)
    report = backups.remove_backups(database, retention_days=30, clock=clock)  # dry_run é o padrão
    assert report.dry_run and report.removed == [] and snapshot(directory) == before
    action = {e.name: (e.action, e.reason) for e in report.entries}
    assert action[old.name][0] == 'remove' and '30 dias' in action[old.name][1]
    assert action[newest.name] == ('keep', 'backup da migração mais recente')
    assert action[recent.name] == ('keep', 'dentro do prazo de 30 dias')
    assert action[future.name][0] == 'keep' and 'maior que o schema atual' in action[future.name][1]
    assert [e.name for e in report.candidates] == [old.name]
    assert all(e.radar_workflows == 1 and e.radar_unredacted == 1 for e in report.entries)


def test_removal_disabled_without_explicit_configuration(backup_dir):
    directory, source = backup_dir
    for age in (1, 50, 500):
        make_backup(directory, age_days=age, source=source)
    before = snapshot(directory)
    for dry_run in (True, False):
        report = backups.remove_backups(directory / 'horus.sqlite3', retention_days=None, dry_run=dry_run, clock=clock)
        assert report.removed == [] and report.candidates == [] and snapshot(directory) == before
    assert all('remoção desligada' in e.reason for e in report.entries[1:])


def test_explicit_removal_keeps_latest_only_and_future_backups(backup_dir):
    directory, source = backup_dir
    keep_latest = make_backup(directory, age_days=200, source=source)  # o mais novo, porém vencido: continua
    older = [make_backup(directory, age_days=age, source=source) for age in (300, 400)]
    fresh_old = make_backup(directory, age_days=250, source=source)
    future = make_backup(directory, version=SCHEMA_VERSION + 2, age_days=900, source=source)
    sidecar = Path(str(older[0]) + '-wal')
    sidecar.write_bytes(b'x')
    other = {'horus.sqlite3'}
    report = backups.remove_backups(directory / 'horus.sqlite3', retention_days=100, dry_run=False, clock=clock)
    assert sorted(report.removed) == sorted([older[0].name, older[1].name, fresh_old.name]) and report.errors == []
    assert sorted(p.name for p in directory.iterdir()) == sorted(other | {keep_latest.name, future.name})
    assert not sidecar.exists()
    integrity_db = sqlite3.connect(directory / keep_latest.name)
    assert integrity_db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    integrity_db.close()


def test_single_backup_is_never_removed(backup_dir):
    directory, source = backup_dir
    only = make_backup(directory, age_days=5000, source=source)
    report = backups.remove_backups(directory / 'horus.sqlite3', retention_days=1, dry_run=False, clock=clock)
    assert report.removed == [] and only.exists() and report.entries[0].reason == 'único backup existente'
    assert report.needs_operator_decision == [only.name]  # contém Radar não redigido: decisão do operador


def test_removal_error_is_reported_and_others_continue(backup_dir, monkeypatch):
    directory, source = backup_dir
    make_backup(directory, age_days=1, source=source)
    blocked, free = make_backup(directory, age_days=300, source=source), make_backup(directory, age_days=400, source=source)
    real_unlink = Path.unlink

    def unlink(self, *args, **kwargs):
        if self.name == blocked.name:
            raise PermissionError('em uso')
        return real_unlink(self, *args, **kwargs)
    monkeypatch.setattr(Path, 'unlink', unlink)
    report = backups.remove_backups(directory / 'horus.sqlite3', retention_days=30, dry_run=False, clock=clock)
    assert report.removed == [free.name] and report.errors == [{'backup': blocked.name, 'error': 'PermissionError'}]
    assert blocked.exists() and not free.exists()


@pytest.mark.parametrize('value,expected', [(None, None), ('', None), ('  ', None), ('abc', None), ('0', None), ('-3', None),
                                            ('1.5', None), ('30', 30), (' 7 ', 7)])
def test_retention_days_environment_parsing(value, expected):
    environ = {} if value is None else {backups.ENV_RETENTION_DAYS: value}
    assert backups.retention_days_from_env(environ) == expected


def test_cli_lists_by_default_and_requires_env_to_apply(backup_dir, monkeypatch, capsys):
    directory, source = backup_dir
    make_backup(directory, age_days=1, source=source)
    old = make_backup(directory, age_days=900, source=source)
    database = str(directory / 'horus.sqlite3')
    monkeypatch.delenv(backups.ENV_RETENTION_DAYS, raising=False)
    assert backups.main([database]) == 0 and old.exists()
    assert 'dry_run=True' in capsys.readouterr().out
    assert backups.main([database, '--apply']) == 0 and old.exists()  # sem a variável: nada é removido
    captured = capsys.readouterr()
    assert 'defina HORUS_BACKUP_RETENTION_DAYS' in captured.err and 'dry_run=True' in captured.out
    monkeypatch.setenv(backups.ENV_RETENTION_DAYS, '30')
    assert backups.main([database]) == 0 and old.exists()  # variável sozinha também não remove
    assert backups.main([database, '--apply']) == 0 and not old.exists()
    assert backups.main([]) == 2


def test_backups_are_never_touched_by_retention_cycle(db_path, tmp_path, open_reader):
    """O ciclo automático não remove nem lê backups: a remoção só existe por chamada explícita."""
    store, marker = Store(db_path), new_marker()
    open_reader()
    legacy = tmp_path / 'legacy.src'
    legacy_database(legacy)
    with closing(sqlite3.connect(legacy)) as db:
        db.execute('PRAGMA journal_mode=DELETE')
    backup = make_backup(tmp_path, age_days=9000, source=legacy)
    seed(store, marker)
    before = hashlib.sha256(backup.read_bytes()).hexdigest()
    run_retention(store, clock=clock)
    assert backup.exists() and hashlib.sha256(backup.read_bytes()).hexdigest() == before
