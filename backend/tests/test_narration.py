import hashlib
import itertools
import socket
import sys
import wave
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import keyring
import pytest
from keyring.backend import KeyringBackend
from fastapi.testclient import TestClient
from horus_backend.api import create_app
from horus_backend.config import Settings
from horus_backend.narration.providers import ElevenLabs, NarrationError, WindowsSapi, Piper, voice


class MemoryKeyring(KeyringBackend):
    priority = 1
    def __init__(self): self.values = {}
    def get_password(self, service, username): return self.values.get((service, username))
    def set_password(self, service, username, password): self.values[service, username] = password
    def delete_password(self, service, username): self.values.pop((service, username), None)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def blocked(*args, **kwargs): raise AssertionError('Network forbidden')
    original_connect = socket.socket.connect
    def guarded_connect(sock, address):
        # Windows asyncio self-pipe uses socketpair implemented over loopback.
        import inspect
        if inspect.currentframe().f_back.f_code is socket._fallback_socketpair.__code__:
            return original_connect(sock, address)
        return blocked(sock, address)
    monkeypatch.setattr(socket.socket, 'connect', guarded_connect)
    monkeypatch.setattr(socket, 'create_connection', blocked)
    monkeypatch.setattr(socket, 'getaddrinfo', blocked)
    monkeypatch.setattr(keyring, 'get_keyring', lambda: memory)
    memory = MemoryKeyring()


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(token='test-token-for-narration-123456', data_dir=tmp_path, factory_root=None, hermes_executable=None))
    with TestClient(app, base_url='http://127.0.0.1', headers={'Authorization': 'Bearer test-token-for-narration-123456'}) as client:
        yield client


def test_contract_auth_status(client):
    response = client.get('/v1/narration/providers')
    assert response.status_code == 200
    providers = {p['id']: p for p in response.json()}
    assert set(providers) == {'windows_sapi', 'piper', 'elevenlabs'}
    assert providers['piper']['status'] == 'not_installed'
    assert providers['elevenlabs']['status'] == 'disabled'
    for p in providers.values():
        assert set(p) == {'id', 'name', 'kind', 'status', 'reason', 'engine_license', 'voices', 'native_word_timestamps', 'requires_authorization'}
    assert client.get('/v1/narration/providers', headers={'Authorization': ''}).status_code == 401


def test_credentials_never_echo(client, caplog):
    secret = 'synthetic-test-value'
    assert client.put('/v1/narration/providers/elevenlabs/credential', json={'key': secret}).json() == {'configured': True}
    for payload in ({'key': secret, 'extra': secret}, {'key': [secret]}):
        response = client.put('/v1/narration/providers/elevenlabs/credential', json=payload)
        assert response.status_code == 422
        assert secret not in response.text
    assert secret not in client.get('/v1/narration/providers').text
    assert client.app.state.narration.credentials.get() == secret
    assert client.delete('/v1/narration/providers/elevenlabs/credential').json() == {'configured': False}
    assert client.app.state.narration.credentials.get() is None
    assert secret not in caplog.text


def test_credential_failure_sanitized(client, monkeypatch):
    def fail(*args): raise RuntimeError('synthetic-test-value')
    monkeypatch.setattr(keyring, 'set_password', fail)
    response = client.put('/v1/narration/providers/elevenlabs/credential', json={'key': 'synthetic-test-value'})
    assert response.status_code == 503
    assert 'synthetic-test-value' not in response.text


def test_estimate(client):
    body = {'provider': 'elevenlabs', 'voice_id': 'mock', 'text': 'Olá mundo!'}
    result = client.post('/v1/narration/estimate', json=body).json()
    assert result['characters'] == 10
    assert result['cost']['source'] == 'unknown'
    assert result['credits']['source'] == 'not_checked'
    assert result['requires_authorization'] is True
    settings = SimpleNamespace(elevenlabs_price_per_1k_chars=Decimal('0.25'), elevenlabs_currency='USD')
    provider = ElevenLabs(settings, None)
    assert provider.estimate('a' * 1000)['cost']['amount'] == 0.25
    assert provider.estimate('a' * 1000)['cost']['source'] == 'configured_price'
    assert client.post('/v1/narration/estimate', json={**body, 'script_id': 'a' * 32, 'script_version': 1}).status_code == 422
    assert client.post('/v1/narration/estimate', json={'provider': 'piper', 'voice_id': 'x', 'script_id': 'a' * 32, 'script_version': 1}).status_code == 404


@pytest.mark.parametrize('enabled,credential,authorized', list(itertools.product([False, True], repeat=3)))
def test_paid_three_conditions(tmp_path, enabled, credential, authorized):
    class Transport:
        calls = 0
        def synthesize(self, **kwargs): self.calls += 1; return {'credits': 5}
    transport = Transport()
    provider = ElevenLabs(Settings(token='x', narration_paid_enabled=enabled), SimpleNamespace(get=lambda: 'synthetic' if credential else None), transport)
    authorization = {'text_sha256': hashlib.sha256(b'hello').hexdigest(), 'voice_id': 'mock',
                     'estimated_cost': provider.estimate('hello')['cost'], 'confirmed': True} if authorized else None
    if enabled and credential and authorized:
        result = provider.synthesize('hello', 'mock', tmp_path / 'a.wav', authorization)
        assert result['credits']['source'] == 'mock'
        assert result['license'] == 'unknown'
        assert transport.calls == 1
    else:
        with pytest.raises(NarrationError) as error: provider.synthesize('hello', 'mock', tmp_path / 'a.wav', authorization)
        assert error.value.status == 403
        assert transport.calls == 0


@pytest.mark.parametrize('enabled,credential', list(itertools.product([False, True], repeat=2)))
def test_paid_api_always_disabled(client, enabled, credential):
    service = client.app.state.narration
    object.__setattr__(service.settings, 'narration_paid_enabled', enabled)
    if credential: service.credentials.put('synthetic')
    response = client.post('/v1/narration/preview', json={'provider': 'elevenlabs', 'voice_id': 'mock'})
    assert response.status_code == 403
    assert response.json() == {'code': 'paid_provider_not_authorized'}


@pytest.mark.parametrize('failure,code', [(401, 'provider_credential_rejected'), (429, 'provider_quota_exceeded'), ('timeout', 'provider_timeout')])
def test_mock_errors_sanitized(tmp_path, failure, code):
    class Transport:
        def synthesize(self, **kwargs):
            if failure == 'timeout': raise TimeoutError('synthetic-secret')
            error = RuntimeError('synthetic-secret'); error.status_code = failure; raise error
    provider = ElevenLabs(Settings(token='x', narration_paid_enabled=True), SimpleNamespace(get=lambda: 'synthetic-secret'), Transport())
    auth = {'text_sha256': hashlib.sha256(b'hello').hexdigest(), 'voice_id': 'mock', 'estimated_cost': provider.estimate('hello')['cost'], 'confirmed': True}
    with pytest.raises(NarrationError) as error: provider.synthesize('hello', 'mock', tmp_path / 'out.wav', auth)
    assert str(error.value) == code


def test_local_preview_preference(client):
    class Fake(WindowsSapi):
        def voices(self): return [voice('local', 'Local', 'pt-BR')]
        def synthesize(self, text, voice_id, output, authorization=None):
            with wave.open(str(output), 'wb') as file:
                file.setparams((1, 2, 22050, 0, 'NONE', 'not compressed')); file.writeframes(b'\0\0' * 2205)
    service = client.app.state.narration
    service.providers['windows_sapi'] = Fake()
    pref = {'provider': 'windows_sapi', 'voice_id': 'local'}
    assert client.put('/v1/narration/preference', json=pref).json() == pref
    assert client.get('/v1/narration/preference').json() == pref
    assert client.put('/v1/narration/preference', json={**pref, 'voice_id': 'absent'}).status_code == 422
    assert client.post('/v1/narration/preview', json={**pref, 'text': 'x' * 301}).status_code == 422
    result = client.post('/v1/narration/preview', json=pref).json()
    path = service.previews[result['id']][1]
    assert path.is_file()
    assert client.get(result['url'], headers={'Authorization': ''}).status_code == 401
    assert client.get(result['url']).content.startswith(b'RIFF')
    assert not path.exists()
    assert client.get(result['url']).status_code == 404
    assert client.get('/v1/narration/previews/../x').status_code == 404


def test_piper_config(tmp_path):
    executable = tmp_path / 'piper.exe'; executable.touch()
    model = tmp_path / 'voice.onnx'; model.touch()
    provider = Piper(executable, tmp_path)
    assert provider.status()['status'] == 'not_installed'
    model.with_suffix('.onnx.json').write_text('{}')
    assert provider.status()['voices'][0]['id'] == 'voice.onnx'
    with pytest.raises(NarrationError): provider.synthesize('text', '../voice.onnx', tmp_path / 'x.wav')


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows SAPI only')
def test_sapi_real_conditional(tmp_path):
    provider = WindowsSapi()
    voices = provider.voices()
    if not voices: pytest.skip('No installed SAPI voices')
    output = tmp_path / 'sapi.wav'
    provider.preview('Esta é uma frase fictícia.', voices[0]['id'], output)
    with wave.open(str(output)) as file: assert file.getnframes() > 0

def test_estimate_approved_script_and_integrity(client):
    from test_scripts import approved, generate, decide
    script = generate(client, approved(client)).json()
    body = {'provider': 'elevenlabs', 'voice_id': 'mock', 'script_id': script['id'], 'script_version': script['version']}
    assert client.post('/v1/narration/estimate', json=body).status_code == 409
    assert decide(client, script).status_code == 200
    result = client.post('/v1/narration/estimate', json=body)
    assert result.status_code == 200, result.text
    assert result.json()['characters'] == len('\n'.join(s['narration'] for s in script['document']['sections']))
    with client.app.state.store.connect() as db:
        db.execute("UPDATE scripts SET document='{}' WHERE id=?", (script['id'],))
    assert client.post('/v1/narration/estimate', json=body).status_code == 409


def test_previews_expire_and_close(client):
    import tempfile
    import time
    service = client.app.state.narration
    temp = tempfile.TemporaryDirectory()
    path = Path(temp.name) / 'preview.wav'; path.touch()
    service.previews['expired'] = (temp, path, time.monotonic() - 1)
    assert client.get('/v1/narration/previews/expired').status_code == 404
    assert not path.exists()
    temp = tempfile.TemporaryDirectory()
    path = Path(temp.name) / 'preview.wav'; path.touch()
    service.previews['pending'] = (temp, path, time.monotonic() + 300)
    service.close()
    assert not path.exists()


def test_preference_survives_restart(client):
    from horus_backend.narration.service import NarrationService
    class Fake(WindowsSapi):
        def voices(self): return [voice('v', 'Voice', 'pt-BR')]
    service = client.app.state.narration
    service.providers['windows_sapi'] = Fake()
    assert client.put('/v1/narration/preference', json={'provider': 'windows_sapi', 'voice_id': 'v'}).status_code == 200
    restarted = NarrationService(service.settings, service.store)
    assert restarted.preference.read_text() == service.preference.read_text()

@pytest.mark.parametrize('enabled,configured,expected', [(False, False, 'disabled'), (False, True, 'disabled'), (True, False, 'not_configured'), (True, True, 'blocked')])
def test_paid_status(enabled, configured, expected):
    provider = ElevenLabs(Settings(token='x', narration_paid_enabled=enabled), SimpleNamespace(get=lambda: 'synthetic' if configured else None))
    assert provider.status()['status'] == expected


def test_windows_status_without_installation(monkeypatch):
    monkeypatch.setattr(sys, 'platform', 'linux')
    assert WindowsSapi().status()['status'] == 'not_installed'


def test_authorization_bound_to_generation(tmp_path):
    class Transport:
        def synthesize(self, **kwargs): pytest.fail('Stale authorization reached transport')
    provider = ElevenLabs(Settings(token='x', narration_paid_enabled=True), SimpleNamespace(get=lambda: 'synthetic'), Transport())
    auth = {'text_sha256': hashlib.sha256(b'hello').hexdigest(), 'voice_id': 'mock', 'estimated_cost': provider.estimate('hello')['cost'], 'confirmed': True}
    for text, voice_id in [('changed', 'mock'), ('hello', 'different')]:
        with pytest.raises(NarrationError) as error: provider.synthesize(text, voice_id, tmp_path / 'out.wav', auth)
        assert error.value.status == 403
