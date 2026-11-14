"""Falhas locais simuladas: sem rede, modelos reais, render real ou chamadas pagas."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import wave

import pytest

from horus_backend import local_pilot, production_worker
from horus_backend.narration import providers
from horus_backend.processes import OwnedProcess, ProductionFailure, sanitized_tail
from horus_backend.worker_lock import WorkerLock
from test_production import script_for, start, finished
from test_workflows import settings, client_for


def test_sanitized_diagnostic_redacts_before_limiting():
    private = 'Este roteiro inteiro não deve aparecer no diagnóstico.'
    raw = ('x'*10000 + '\n' + private + '\n' +
           'token=secret-value\nAuthorization: Bearer other-secret\n{"api_key": "json-secret"}\nHORUS_API_TOKEN=env-secret\n' +
           'File "C:\\Users\\operator\\private.py", line 1\n' +
           '/home/operator/private/file.wav\nEND')
    result = sanitized_tail(raw, private=[private])
    assert len(result.encode()) <= 8192 and result.endswith('END')
    for forbidden in (private, 'secret-value', 'other-secret', 'json-secret', 'env-secret', 'operator'):
        assert forbidden not in result


@pytest.mark.parametrize('kind', ['missing', 'timeout', 'exit'])
def test_sapi_process_diagnostics_are_separate(monkeypatch, kind):
    private = 'Texto privado integral da narração.'
    error = {'missing': FileNotFoundError(2, 'missing', 'C:/Users/operator/python.exe'),
             'timeout': subprocess.TimeoutExpired(['ignored'], 60, stderr=private.encode()),
             'exit': subprocess.CalledProcessError(9, ['ignored'], stderr=(private+'\ntoken=secret').encode())}[kind]
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr(providers.subprocess, 'run', fail)
    with pytest.raises(providers.NarrationError) as caught:
        providers.run(['fake'], payload={'text': private})
    failure = caught.value.detail
    assert caught.value.code == failure['code'] == 'local_narration_failed'
    assert failure['stage'] == 'narration' and failure['duration_seconds'] >= 0
    assert failure['exit_code'] == (9 if kind == 'exit' else None)
    assert private not in json.dumps(failure) and 'secret' not in failure['stderr_tail']


@pytest.mark.parametrize('kind', ['missing', 'exit'])
def test_ffmpeg_failure_has_diagnostic_and_releases_process(tmp_path, kind):
    command = [str(tmp_path/'missing-ffmpeg.exe')] if kind == 'missing' else [sys.executable, '-I', '-c',
        "import sys; sys.stderr.write('decoder failed\\ntoken=secret-value\\nC:/Users/operator/out.mp4'); sys.exit(23)"]
    with pytest.raises(ProductionFailure) as caught:
        asyncio.run(local_pilot.owned_tool(command, cwd=tmp_path))
    detail = caught.value.detail
    assert detail['code'] == ('local_tool_unavailable' if kind == 'missing' else 'local_tool_failed')
    assert detail['stage'] == 'render' and detail['duration_seconds'] >= 0
    assert detail['exit_code'] == (None if kind == 'missing' else 23)
    assert 'operator' not in detail['stderr_tail'] and 'secret-value' not in str(caught.value)
    assert 'secret-value' not in detail['stderr_tail']


def test_render_diagnostic_is_sanitized_on_disk(tmp_path):
    private = 'Texto completo privado do roteiro audiovisual.'
    (tmp_path/'plan.json').write_text(json.dumps({'roteiro':{'linhas':[{'narracao':private}]}}), encoding='utf-8')
    command = [sys.executable, '-I', '-c',
        'import sys; sys.stderr.write('+repr(private+'\ntoken=secret-value\nC:/Users/operator/video.mp4\nEND')+'); sys.exit(17)']
    completed = production_worker.run_factory_render(tmp_path, command, dict(os.environ))
    assert completed.returncode == 17
    report = json.loads((tmp_path/'render-failure.json').read_text(encoding='utf-8'))
    assert report['stage'] == 'render' and report['exit_code'] == 17 and report['duration_seconds'] >= 0
    for path in (tmp_path/'render-failure.json', tmp_path/'render-stderr.log'):
        text = path.read_text(encoding='utf-8')
        assert all(v not in text for v in (private, 'secret-value', 'operator'))


def test_worker_unexpected_failure_is_structured_without_exception_text(tmp_path, monkeypatch):
    def fail():
        raise RuntimeError('secret-value C:/Users/operator/private')
    monkeypatch.setattr(production_worker, 'main', fail)
    monkeypatch.setattr(sys, 'argv', ['worker', str(tmp_path)])
    monkeypatch.setattr(production_worker, 'CURRENT_STAGE', 'align')
    assert production_worker.entrypoint() == 1
    result = json.loads((tmp_path/'result.json').read_text(encoding='utf-8'))
    assert result['failure']['stage'] == 'align' and result['failure']['type'] == 'RuntimeError'
    assert 'secret-value' not in json.dumps(result) and 'operator' not in json.dumps(result)
    assert result['artifacts'] == []


def test_corrupt_render_keeps_tool_exit_and_sanitized_stderr(tmp_path, monkeypatch):
    def fail():
        raise subprocess.CalledProcessError(45, ['ffprobe'], stderr=b'Invalid data found\ntoken=private\nC:/Users/operator/partial.mp4')
    monkeypatch.setattr(production_worker, 'main', fail)
    monkeypatch.setattr(sys, 'argv', ['worker', str(tmp_path)])
    monkeypatch.setattr(production_worker, 'CURRENT_STAGE', 'render')
    assert production_worker.entrypoint() == 1
    result = json.loads((tmp_path/'result.json').read_text(encoding='utf-8'))
    detail = result['failure']
    assert detail['exit_code'] == 45 and detail['stage'] == 'render' and detail['duration_seconds'] >= 0
    assert 'Invalid data found' in detail['stderr_tail']
    assert 'private' not in detail['stderr_tail'] and 'operator' not in detail['stderr_tail']


@pytest.mark.parametrize('mode,code', [('missing','narration_invalid_wav'), ('corrupt','narration_invalid_wav'),
    ('empty','narration_empty_wav'), ('truncated','narration_truncated_wav')])
def test_partial_narration_is_never_accepted(tmp_path, mode, code):
    path = tmp_path/'voice.wav'
    if mode == 'corrupt':
        path.write_bytes(b'not a WAV')
    elif mode in {'empty','truncated'}:
        with wave.open(str(path), 'wb') as audio:
            audio.setparams((1, 2, 24000, 0, 'NONE', ''))
            audio.writeframes(b'\0\0'*100 if mode == 'truncated' else b'')
        if mode == 'truncated':
            path.write_bytes(path.read_bytes()[:-20])
    with pytest.raises(ProductionFailure) as caught:
        local_pilot.wav_info(path)
    assert caught.value.detail['code'] == code and caught.value.detail['stage'] == 'narration'


@pytest.mark.parametrize('stage', ['narration', 'align', 'render'])
@pytest.mark.parametrize('status', ['running', 'cancel_requested'])
def test_restart_preserves_stage_without_reexecuting_or_serving_partial(settings, stage, status):
    with client_for(settings) as client:
        script = script_for(client)
        client.portal.call(client.app.state.manager.worker.cancel)
        item = start(client, script).json()
        root = settings.data_dir/'productions'/item['id']
        root.mkdir(parents=True)
        (root/'partial.mp4').write_bytes(b'\0\0\0\x18ftypisomPARTIAL')
        client.app.state.store.update(item['job_id'], status, new_attempt=True, result={'stage':stage})
    with client_for(settings) as client:
        restored = client.get('/v1/productions/'+item['id']).json()
        assert restored['status'] == 'interrupted' and restored['stage'] == stage
        assert restored['failure']['code'] == 'production_interrupted'
        assert restored['failure']['stage'] == stage and restored['artifacts'] == []
        assert start(client, script).json()['id'] == item['id']
        assert client.post('/v1/jobs/'+item['job_id']+'/retry').status_code == 409
        assert client.get('/v1/jobs/'+item['job_id']).json()['attempt'] == 1
        assert (root/'partial.mp4').is_file()  # preservado para conciliação; não registrado
        other = finished(client, start(client, script, key='explicit-next').json())
        assert other['status'] == 'succeeded' and other['id'] != item['id']


def test_worker_lock_is_released_by_os_after_crash(tmp_path):
    database = tmp_path/'state.sqlite'
    command = [sys.executable, '-c',
        'import os,sys; from pathlib import Path; from horus_backend.worker_lock import WorkerLock; '
        'lock=WorkerLock(Path(sys.argv[1])); lock.acquire(); os._exit(7)', str(database)]
    assert subprocess.run(command, timeout=10).returncode == 7
    lock = WorkerLock(database)
    lock.acquire()
    with pytest.raises(RuntimeError):
        lock.acquire()
    other = WorkerLock(database)
    with pytest.raises(RuntimeError):
        other.acquire()
    lock.close()
    other.acquire()
    other.close()


@pytest.mark.parametrize('mode', ['nonzero', 'corrupt_result', 'missing_result', 'error_with_zero_exit'])
def test_failed_worker_never_registers_video_and_queue_continues(settings, monkeypatch, mode):
    original = OwnedProcess.start
    calls = []
    async def fake_worker(command, **kwargs):
        if 'production_worker.py' in command[1] and not calls:
            calls.append(command)
            root = Path(command[2])
            (root/'partial.mp4').write_bytes(b'\0\0\0\x18ftypisomPARTIAL')
            if mode == 'corrupt_result':
                (root/'result.json').write_text('{')
            elif mode != 'missing_result':
                (root/'result.json').write_text(json.dumps({'error':'Render falhou; confira o diagnóstico.',
                    'failure':{'code':'render_failed', 'stage':'render'},
                    'artifacts':[{'kind':'video', 'relative_path':'partial.mp4'}]}))
            command = [sys.executable, '-I', '-c', 'raise SystemExit('+('3' if mode == 'nonzero' else '0')+')']
        return await original(command, **kwargs)
    monkeypatch.setattr(OwnedProcess, 'start', fake_worker)
    with client_for(settings) as client:
        script = script_for(client)
        item = finished(client, start(client, script).json())
        assert item['status'] == 'failed' and item['failure']['code']
        assert not any(a['kind']=='video' for a in item['artifacts'])
        assert client.app.state.manager.active_process is None
        assert finished(client, start(client, script, key='next').json())['status'] == 'succeeded'


def test_artifacts_and_success_are_atomic(settings):
    with client_for(settings) as client:
        script = script_for(client)
        with client.app.state.store.connect() as db:
            db.execute("""CREATE TRIGGER fail_success BEFORE UPDATE OF status ON jobs
                WHEN NEW.status='succeeded' AND json_extract(NEW.payload,'$.operation')='production.run'
                BEGIN SELECT RAISE(ABORT,'simulated crash before commit'); END""")
        item = finished(client, start(client, script).json())
        assert item['status'] == 'failed' and item['artifacts'] == []
        assert item['failure']['type'] == 'IntegrityError'


@pytest.mark.parametrize('proof', ['missing', 'hash_mismatch', 'no_video_frames', 'no_audio_frames', 'invalid_duration'])
def test_mp4_header_is_insufficient_without_matching_decode_evidence(settings, monkeypatch, proof):
    original = OwnedProcess.start
    async def fake_worker(command, **kwargs):
        root = Path(command[2])
        (root/'partial.mp4').write_bytes(b'\0\0\0\x18ftypisomPARTIAL')
        artifacts = [{'kind':'video', 'relative_path':'partial.mp4'}]
        if proof != 'missing':
            import hashlib
            folder = root/'canais/demo/videos/fixture/render'
            folder.mkdir(parents=True)
            validation = {'sha256':hashlib.sha256((root/'partial.mp4').read_bytes()).hexdigest(),
                'stream':{'nb_read_frames':2, 'duration':1.0}, 'audio_stream':{'nb_read_frames':1, 'duration':1.0}}
            if proof == 'hash_mismatch': validation['sha256'] = '0'*64
            if proof == 'no_video_frames': validation['stream']['nb_read_frames'] = 0
            if proof == 'no_audio_frames': validation['audio_stream']['nb_read_frames'] = 0
            if proof == 'invalid_duration': validation['stream']['duration'] = 'NaN'
            (folder/'validation.json').write_text(json.dumps(validation))
            artifacts.append({'kind':'manifest', 'relative_path':'canais/demo/videos/fixture/render/validation.json'})
        (root/'result.json').write_text(json.dumps({'artifacts':artifacts}))
        return await original([sys.executable, '-I', '-c', 'pass'], **kwargs)
    monkeypatch.setattr(OwnedProcess, 'start', fake_worker)
    with client_for(settings) as client:
        item = finished(client, start(client, script_for(client), mode='local_demo').json())
        assert item['status'] == 'blocked' and item['artifacts'] == []
        assert item['failure']['code'] == 'production_precondition_failed'
