import hashlib
import json
import os

import pytest
from fastapi.testclient import TestClient

from horus_backend.api import create_app
from horus_backend.config import Settings
from horus_backend import diagnostics as d
from horus_backend.narration import kokoro


@pytest.fixture
def prepared(tmp_path, monkeypatch):
    files = ['scripts/.venv/' + ('Scripts/python.exe' if os.name == 'nt' else 'bin/python'),
             'remotion/package.json', 'remotion/package-lock.json', 'remotion/tsconfig.json',
             'remotion/node_modules/.bin/remotion', 'browser.exe', 'ffmpeg.exe', 'ffprobe.exe',
             'small/model.bin', 'small/config.json', 'small/tokenizer.json', 'small/vocabulary.txt',
             'ArchivoExpanded-SemiBold.ttf', 'kokoro-python.exe']
    for name in files:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'fixture')
    (tmp_path / 'remotion/src').mkdir()
    for name in kokoro.HASHES:
        path = tmp_path / 'kokoro' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'fixture')
    monkeypatch.setattr(kokoro, 'HASHES', dict.fromkeys(kokoro.HASHES, hashlib.sha256(b'fixture').hexdigest()))
    monkeypatch.setattr(d.WindowsSapi, 'voices', lambda self: [{'language': 'pt-BR'}])
    monkeypatch.setattr(d, 'has_module', lambda name: True)
    monkeypatch.setenv('HORUS_DEMO_BROWSER', str(tmp_path / 'browser.exe'))
    return Settings(token='test-only-connection-token-0123456789', data_dir=tmp_path / 'data',
                    factory_root=tmp_path, alignment_model=tmp_path, ffmpeg=tmp_path / 'ffmpeg.exe',
                    subtitle_font=tmp_path / 'ArchivoExpanded-SemiBold.ttf',
                    kokoro_python=tmp_path / 'kokoro-python.exe', kokoro_model_dir=tmp_path / 'kokoro')


def test_route_ready_and_private(prepared):
    with TestClient(create_app(prepared), base_url='http://127.0.0.1',
                    headers={'Authorization': 'Bearer ' + prepared.token}) as client:
        response = client.get('/v1/diagnostics')
    assert response.status_code == 200
    result = response.json()
    assert result['checks'] and result['hermes_connected'] is False
    assert result['production']['ready'] is True
    assert result['production']['missing'] == []
    assert str(prepared.factory_root) not in json.dumps(result)
    assert all(set(c) == {'id', 'name', 'available', 'detail', 'required_for'}
               for c in result['production']['checks'])


@pytest.mark.parametrize('relative,ident', [
    ('scripts/.venv/' + ('Scripts/python.exe' if os.name == 'nt' else 'bin/python'), 'factory'),
    ('remotion/package.json', 'factory'), ('remotion/package-lock.json', 'factory'),
    ('remotion/tsconfig.json', 'factory'), ('remotion/node_modules/.bin/remotion', 'factory'),
    ('ffmpeg.exe', 'ffmpeg'), ('ffprobe.exe', 'ffprobe'),
    ('small/model.bin', 'alignment_model'), ('small/config.json', 'alignment_model'),
    ('small/tokenizer.json', 'alignment_model'), ('small/vocabulary.txt', 'alignment_model'),
    ('ArchivoExpanded-SemiBold.ttf', 'subtitle_font'), ('kokoro-python.exe', 'kokoro'),
    *[('kokoro/' + name, 'kokoro') for name in kokoro.HASHES]])
def test_missing_files(prepared, relative, ident):
    (prepared.factory_root / relative).unlink()
    result = d.production_diagnostics(prepared)
    assert ident in result['missing']
    assert str(prepared.factory_root) not in json.dumps(result)


def test_no_voices_or_engine(prepared, monkeypatch):
    monkeypatch.setattr(d.WindowsSapi, 'voices', lambda self: [])
    monkeypatch.setattr(d, 'has_module', lambda name: False)
    (prepared.kokoro_model_dir / 'config.json').write_bytes(b'wrong hash')
    result = d.production_diagnostics(prepared)
    assert {'sapi_pt_br', 'kokoro', 'alignment_engine'} <= set(result['missing'])
    assert result['ready'] is False


def test_invalid_configured_paths(prepared, monkeypatch):
    from dataclasses import replace
    absent = prepared.factory_root / 'does-not-exist'
    monkeypatch.setenv('HORUS_DEMO_BROWSER', str(absent))
    result = d.production_diagnostics(replace(prepared, factory_root=absent,
        ffmpeg=absent, alignment_model=absent, subtitle_font=absent,
        kokoro_python=absent, kokoro_model_dir=absent))
    assert {'factory', 'ffmpeg', 'ffprobe', 'alignment_model', 'subtitle_font', 'kokoro'} <= set(result['missing'])
    assert result['ready'] is False


def test_missing_browser(prepared, monkeypatch):
    from pathlib import Path
    original = Path.is_file
    monkeypatch.setattr(Path, 'is_file', lambda p: False if p.name in {'browser.exe', 'msedge.exe'} else original(p))
    result = d.production_diagnostics(prepared)
    assert 'browser' in result['missing']
    assert result['ready'] is False


def test_missing_factory_source(prepared):
    (prepared.factory_root / 'remotion/src').rmdir()
    assert 'factory' in d.production_diagnostics(prepared)['missing']


def test_optional_voice_does_not_block_alternative(prepared, monkeypatch):
    monkeypatch.setattr(d.WindowsSapi, 'voices', lambda self: [])
    result = d.production_diagnostics(prepared)
    assert result['ready'] is True
    assert result['missing'] == ['sapi_pt_br']


def test_provider_error_does_not_expose_path(prepared, monkeypatch):
    def fail(self):
        raise d.NarrationError('private:' + str(prepared.factory_root))
    monkeypatch.setattr(d.WindowsSapi, 'voices', fail)
    result = d.production_diagnostics(prepared)
    assert 'sapi_pt_br' in result['missing']
    assert str(prepared.factory_root) not in json.dumps(result)
