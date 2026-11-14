import hashlib
import json
import sqlite3
from contextlib import closing

import pytest

from horus_backend.backups import inspect_database, main, restore, verify
from horus_backend.migrations import MIGRATIONS, SCHEMA_VERSION
from horus_backend.storage import Store


def database(path, version=9):
    with closing(sqlite3.connect(path)) as db:
        for number in range(1, version + 1):
            for statement in MIGRATIONS[number]:
                db.execute(statement)
        db.execute(f'PRAGMA user_version={version}')
        db.execute('CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT)')
        db.execute("INSERT INTO fixture VALUES(1, 'conteúdo fictício')")
        db.commit()
    return path


def backup_path(current, version=9):
    return current.with_name(f'{current.stem}.backup-v{version}-' + 'a' * 32 + '.sqlite3')


def test_verify_integrity_counts_comparison_and_no_writes(tmp_path, capsys):
    current = database(tmp_path / 'horus.sqlite3')
    backup = backup_path(current)
    backup.write_bytes(current.read_bytes())
    with closing(sqlite3.connect(current)) as db:
        db.execute("INSERT INTO fixture VALUES(2, 'novo')")
        db.commit()
    original = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    result = verify(current)
    assert result['ok']
    assert result['current']['user_version'] == 9
    assert result['backups'][0]['integrity_check'] == ['ok']
    assert result['backups'][0]['comparison']['fixture'] == {'backup': 1, 'current': 2, 'delta': 1}
    assert main(['verify', str(current), '--json']) == 0
    assert json.loads(capsys.readouterr().out) == result
    assert original == {p.name: p.read_bytes() for p in tmp_path.iterdir()}


def test_corrupt_backup_is_reported_and_cannot_restore(tmp_path, capsys):
    current = database(tmp_path / 'horus.sqlite3')
    backup = backup_path(current)
    backup.write_bytes(b'not a SQLite database')
    assert not verify(current)['ok']
    assert main(['verify', str(current)]) == 1
    assert 'Verificação falhou' in capsys.readouterr().out
    destination = tmp_path / 'restored.sqlite3'
    assert main(['restore', str(backup), '--to', str(destination), '--json']) == 1
    assert not destination.exists()
    assert not json.loads(capsys.readouterr().out)['ok']


@pytest.mark.parametrize('version', [8, 9])
def test_restore_and_current_version_migrate_only_copy(tmp_path, version, capsys):
    backup = database(tmp_path / 'backup.sqlite3', version)
    before = hashlib.sha256(backup.read_bytes()).hexdigest()
    destination = tmp_path / 'restored.sqlite3'
    assert main(['restore', str(backup), '--to', str(destination), '--json']) == 0
    report = json.loads(capsys.readouterr().out)
    assert report['user_version'] == version
    assert report['tables']['fixture'] == 1
    assert 'aplicativo fechado' in report['instruction']
    store = Store(destination)
    with store.connect() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION
        assert db.execute('SELECT value FROM fixture').fetchone()[0] == 'conteúdo fictício'
        assert 'origin' in {r[1] for r in db.execute('PRAGMA table_info(scripts)')}
    assert hashlib.sha256(backup.read_bytes()).hexdigest() == before
    assert inspect_database(backup)['user_version'] == version
    if version < SCHEMA_VERSION:
        assert list(tmp_path.glob('restored.backup-v8-*.sqlite3'))


def test_existing_destination_and_source_refused(tmp_path):
    backup = database(tmp_path / 'backup.sqlite3')
    destination = tmp_path / 'existing.sqlite3'
    destination.write_bytes(b'preservar')
    original = backup.read_bytes()
    for target in (destination, backup):
        with pytest.raises(ValueError, match='já existe'):
            restore(backup, target)
    assert destination.read_bytes() == b'preservar'
    assert backup.read_bytes() == original


def test_pending_wal_and_existing_destination_sidecar_refused(tmp_path):
    backup = database(tmp_path / 'backup.sqlite3')
    destination = tmp_path / 'new.sqlite3'
    destination.with_name(destination.name + '-wal').write_bytes(b'pending')
    with pytest.raises(ValueError, match='sidecar'):
        restore(backup, destination)
    backup.with_name(backup.name + '-wal').write_bytes(b'pending')
    result = inspect_database(backup)
    assert not result['ok'] and 'WAL/journal' in result['error']


def test_missing_current_is_not_created(tmp_path):
    path = tmp_path / 'absent.sqlite3'
    assert not verify(path)['ok']
    assert list(tmp_path.iterdir()) == []


def test_corruption_does_not_skip_other_backups(tmp_path):
    current = database(tmp_path / 'horus.sqlite3')
    good = backup_path(current)
    good.write_bytes(current.read_bytes())
    broken = current.with_name('horus.backup-v9-' + 'b' * 32 + '.sqlite3')
    broken.write_bytes(b'corrupt')
    report = verify(current)
    assert not report['ok']
    results = {item['name']: item for item in report['backups']}
    assert results[good.name]['ok'] and not results[broken.name]['ok']
    assert results[broken.name]['comparison'] is None


def test_counts_quote_table_names_and_show_new_tables(tmp_path):
    current = database(tmp_path / 'horus.sqlite3')
    backup = backup_path(current)
    backup.write_bytes(current.read_bytes())
    with closing(sqlite3.connect(current)) as db:
        db.execute('CREATE TABLE "quoted""name" (id INTEGER)')
        db.commit()
    result = verify(current)
    assert result['backups'][0]['comparison']['quoted"name'] == {'backup': None, 'current': 0, 'delta': None}
