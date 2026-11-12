"""Endurecimento e reversão em perfis fictícios; nenhum acesso ao perfil operacional."""
import hashlib
import json
from pathlib import Path

import pytest

from horus_backend.security import audit_profile, harden_profile, restore_profile


def tree(path):
    return {p.relative_to(path).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
            for p in path.rglob('*')}


@pytest.fixture
def profile(tmp_path):
    path = tmp_path / 'fixture'
    path.mkdir()
    (path / 'config.yaml').write_bytes(b'# original CRLF\r\nmemory:\r\n  memory_enabled: true\r\n')
    (path / '.env').write_bytes(b'API_SERVER_KEY=ficticio-nao-copiar\r\n')
    (path / 'auth.json').write_bytes(b'credencial-ficticia')
    (path / 'sessions').mkdir()
    (path / 'sessions/state.db').write_bytes(b'banco-de-sessao-ficticio')
    (path / 'skills/fixture/empty').mkdir(parents=True)
    (path / 'skills/fixture/SKILL.md').write_bytes(b'instrucao-ficticia\x00\xff')
    (path / 'cron/output').mkdir(parents=True)
    (path / 'cron/executions.db').write_bytes(b'banco-cron-ficticio')
    return path


def test_dry_run_changes_no_bytes_or_directories(profile, tmp_path):
    before = tree(tmp_path)
    plan = harden_profile(profile, dry_run=True)
    assert '-  memory_enabled: true' in plan['diff'] and '+  api_server: []' in plan['diff']
    assert plan['would_quarantine'] == ['skills', 'cron']
    assert tree(tmp_path) == before
    missing = tmp_path / 'does-not-exist'
    harden_profile(missing, dry_run=True)
    assert not missing.exists()


@pytest.mark.parametrize('marker', [None, b'marcador-original\r\n'])
def test_restore_original_bytes_and_empty_directories_without_credentials(profile, marker):
    if marker is not None:
        (profile / '.no-bundled-skills').write_bytes(marker)
    original = tree(profile)
    result = harden_profile(profile)
    backup = result['backup']
    copied = tree(backup / 'payload')
    assert set(copied) == {name for name in original if name.split('/')[0] not in {'.env', 'auth.json', 'sessions'}}
    assert b'ficticio-nao-copiar' not in b''.join(p.read_bytes() for p in backup.rglob('*') if p.is_file())
    assert audit_profile(profile)['tools']['restricted'] is True
    assert not (profile / 'skills').exists() and not (profile / 'cron').exists()
    quarantine = backup.parent / 'quarantine'
    manifest = json.loads((quarantine / 'manifest.json').read_text())
    assert manifest['entries']['cron/executions.db']['sha256'] == original['cron/executions.db']
    dry_before = tree(profile)
    restore_profile(profile, backup, dry_run=True)
    assert tree(profile) == dry_before
    restore_profile(profile, backup)
    after = {key: value for key, value in tree(profile).items() if not key.startswith('.horus-hardening')}
    assert after == original


@pytest.mark.parametrize('mutation', ['backup', 'active', 'new_extension', 'extra_backup_file'])
def test_restore_refuses_corruption_and_drift_before_writing(profile, mutation):
    backup = harden_profile(profile)['backup']
    if mutation == 'backup':
        (backup / 'payload/config.yaml').write_bytes(b'corrompido')
    elif mutation == 'active':
        (profile / 'config.yaml').write_bytes(b'alterado-por-terceiro')
    elif mutation == 'new_extension':
        (profile / 'skills').mkdir()
    else:
        (backup / 'payload/nao-inventariado.txt').write_text('alterado')
    before = tree(profile)
    with pytest.raises(ValueError):
        restore_profile(profile, backup)
    assert tree(profile) == before


@pytest.mark.parametrize('raw', ['[]', 'null', '{}', '{invalido', '{"version":2,"state":"applied"}'])
def test_restore_refuses_malformed_manifest_without_writing(profile, raw):
    backup = harden_profile(profile)['backup']
    (backup / 'manifest.json').write_text(raw)
    before = tree(profile)
    with pytest.raises(ValueError):
        restore_profile(profile, backup)
    assert tree(profile) == before


@pytest.mark.parametrize('name', ['.env', 'auth.json', '.auth.json', 'session.db', 'credentials.json',
                                 'key.pem', 'state.db', 'tokens.json', 'api_key.txt'])
def test_credentials_or_unreviewed_databases_inside_extensions_abort(profile, name):
    (profile / 'skills/fixture' / name).write_bytes(b'nunca-copiar')
    before = tree(profile)
    with pytest.raises(ValueError):
        harden_profile(profile)
    assert tree(profile) == before


def test_config_credentials_are_never_printed_or_backed_up(profile):
    (profile / 'config.yaml').write_text('provider:\n  api_key: segredo-ficticio\n')
    before = tree(profile)
    with pytest.raises(ValueError) as error:
        harden_profile(profile, dry_run=True)
    assert 'segredo-ficticio' not in str(error.value)
    assert tree(profile) == before


def test_real_label_requires_explicit_flag_even_for_restore_and_dry_run(tmp_path):
    profile = tmp_path / 'horus'
    with pytest.raises(ValueError, match='allow-real'):
        harden_profile(profile, dry_run=True)
    result = harden_profile(profile, allow_real=True)
    with pytest.raises(ValueError, match='allow-real'):
        restore_profile(profile, result['backup'])
    restore_profile(profile, result['backup'], allow_real=True)


def test_copy_failure_keeps_originals_and_backup(profile, monkeypatch):
    import horus_backend.security as security
    original = tree(profile)
    write = Path.write_text
    def fail_minimal(path, *args, **kwargs):
        if path == profile / 'config.yaml':
            raise OSError('falha-ficticia')
        return write(path, *args, **kwargs)
    monkeypatch.setattr(Path, 'write_text', fail_minimal)
    with pytest.raises(OSError):
        harden_profile(profile)
    after = {key: value for key, value in tree(profile).items() if not key.startswith('.horus-hardening')}
    assert after == original
    assert list(profile.glob('.horus-hardening/*/backup/manifest.json'))


def test_symlink_extension_or_backup_refused(profile, tmp_path):
    outside = tmp_path / 'outside'
    outside.mkdir()
    try:
        (profile / 'plugins').symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip('Criação de symlink não disponível neste Windows.')
    with pytest.raises(ValueError, match='Links'):
        harden_profile(profile)
    assert not list(outside.iterdir())


def test_hardlinked_config_is_refused_without_modifying_other_file(profile, tmp_path):
    import os
    outside = tmp_path / 'shared-config.yaml'
    os.link(profile / 'config.yaml', outside)
    original = outside.read_bytes()
    with pytest.raises(ValueError, match='hardlinks'):
        harden_profile(profile)
    assert outside.read_bytes() == original and not (profile / '.horus-hardening').exists()


@pytest.mark.parametrize('failure', ['move', 'copy'])
def test_restore_failure_keeps_minimal_state_and_original_backup(profile, monkeypatch, failure):
    import horus_backend.security as security
    backup = harden_profile(profile)['backup']
    active = {key: value for key, value in tree(profile).items() if not key.startswith('.horus-hardening')}
    original_backup = tree(backup)
    if failure == 'copy':
        original_copy = security._copy_managed
        def fail_copy(source, target):
            if source == backup / 'payload':
                # Simula falha depois de copiar uma raiz, antes de terminar as demais.
                (target / 'config.yaml').write_text('copia-parcial')
                raise OSError('falha-ficticia')
            return original_copy(source, target)
        monkeypatch.setattr(security, '_copy_managed', fail_copy)
    else:
        original_rename = Path.rename
        def fail_move(path, target):
            if path == profile / '.no-bundled-skills' and Path(target).parent.name == 'replaced-by-restore':
                raise OSError('falha-ficticia')
            return original_rename(path, target)
        monkeypatch.setattr(Path, 'rename', fail_move)
    with pytest.raises(OSError):
        restore_profile(profile, backup)
    assert {key: value for key, value in tree(profile).items() if not key.startswith('.horus-hardening')} == active
    assert tree(backup) == original_backup
