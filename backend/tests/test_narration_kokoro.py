import asyncio
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import wave

import pytest
from horus_backend.narration import kokoro
from horus_backend.narration.providers import NarrationError
from horus_backend.processes import OwnedProcess


@pytest.fixture
def provider(tmp_path, monkeypatch):
    hashes = {}
    for name in kokoro.HASHES:
        path = tmp_path / name
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(name.encode())
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    monkeypatch.setattr(kokoro, 'HASHES', hashes)
    return kokoro.Kokoro(sys.executable, tmp_path)


def test_not_configured(monkeypatch):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a: pytest.fail('network'))
    assert kokoro.Kokoro(None, None).status()['status'] == 'not_installed'


def test_hash_divergence_blocks(provider):
    (provider.model_dir / 'voices/pf_dora.pt').write_bytes(b'changed')
    status = provider.status()
    assert status['status'] == 'blocked'
    assert status['reason'] == 'kokoro_hash_mismatch:voices/pf_dora.pt'


def test_voices_unknown_commercial_license(provider):
    assert len(provider.voices()) == 3
    for voice in provider.voices():
        assert voice['language'] == 'pt-BR'
        assert voice['commercial_use'] == 'unknown'
        assert voice['license']['name'] == 'Apache-2.0'
        assert voice['preview'] == 'local'
        assert 'CC BY' in voice['notes']


@pytest.mark.parametrize('mode', ['success', 'invalid', 'timeout', 'cancel', 'failed', 'changed'])
def test_owned_synthesizer(provider, tmp_path, monkeypatch, mode):
    original = OwnedProcess.start
    processes = []
    async def start(command, **kwargs):
        assert command[1] == '-I'
        request = json.loads(Path(command[-1]).read_text())
        assert request['voice_id'] == 'pf_dora'
        assert kwargs['env']['HF_HUB_OFFLINE'] == '1'
        assert kwargs['env']['TRANSFORMERS_OFFLINE'] == '1'
        assert 'HTTP_PROXY' not in kwargs['env'] and 'SECRET' not in kwargs['env']
        script = "import time; time.sleep(60)"
        if mode in {'success', 'changed'}:
            script = ("import wave; w=wave.open(" + repr(request['output']) +
                      ",'wb'); w.setparams((1,2,24000,0,'NONE','')); w.writeframes(b'\\0\\0'*240); w.close()")
        elif mode == 'invalid':
            script = 'from pathlib import Path; Path(' + repr(request['output']) + ').write_bytes(b"invalid")'
        elif mode == 'failed': script = 'raise SystemExit(1)'
        owned = await original([sys.executable, '-I', '-c', script], **kwargs)
        processes.append(owned)
        if mode == 'changed': (provider.model_dir/'config.json').write_bytes(b'changed')
        return owned
    monkeypatch.setenv('SECRET', 'private')
    monkeypatch.setenv('HTTP_PROXY', 'private')
    monkeypatch.setattr(OwnedProcess, 'start', start)
    if mode == 'timeout': provider.timeout = .05
    output = tmp_path/'out.wav'
    async def run():
        task = asyncio.create_task(provider.synthesize_async('Frase fictícia.', 'pf_dora', output))
        if mode == 'cancel':
            while not processes: await asyncio.sleep(.01)
            task.cancel()
        if mode == 'success':
            result = await task
            assert result['model']['id'] == 'pf_dora'
            assert kokoro.HASHES['voices/pf_dora.pt'] in result['model']['version']
            assert result['publishable'] is False
        else:
            error = asyncio.CancelledError if mode == 'cancel' else NarrationError
            with pytest.raises(error): await task
            assert not output.exists()
        assert processes[0].process.returncode is not None
    asyncio.run(run())


def test_worker_refuses_network_in_separate_process():
    import subprocess
    worker = Path(kokoro.__file__).with_name('kokoro_worker.py')
    script = '''import runpy, socket, sys
ns=runpy.run_path(sys.argv[1]); ns['block_network']()
for call in (lambda: socket.getaddrinfo('example.com',443),
             lambda: socket.socket().connect(('127.0.0.1',9)),
             lambda: socket.socket().connect_ex(('127.0.0.1',9)),
             lambda: socket.socket(socket.AF_INET,socket.SOCK_DGRAM).sendto(b'x',('127.0.0.1',9))):
    try: call()
    except RuntimeError: pass
    else: raise AssertionError('network allowed')
'''
    result = subprocess.run([sys.executable, '-I', '-c', script, str(worker)], capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr


@pytest.mark.skipif(not all(os.environ.get(k) for k in ('HORUS_KOKORO_PYTHON','HORUS_KOKORO_MODEL_DIR')),
                    reason='Kokoro real exige configuração explícita.')
def test_real_kokoro_preview(tmp_path):
    provider = kokoro.Kokoro(os.environ['HORUS_KOKORO_PYTHON'], os.environ['HORUS_KOKORO_MODEL_DIR'])
    output = tmp_path/'preview.wav'
    provider.preview('Esta frase fictícia verifica uma prévia de narração inteiramente local.', 'pf_dora', output)
    with wave.open(str(output)) as wav: assert wav.getnframes() > 24000
    print('preview_sha256=' + hashlib.sha256(output.read_bytes()).hexdigest())

@pytest.mark.skipif(not all(os.environ.get(k) for k in (
    'HORUS_KOKORO_PYTHON','HORUS_KOKORO_MODEL_DIR','HORUS_PILOT_FACTORY','HORUS_FFMPEG','HORUS_ALIGNMENT_MODEL')),
    reason='Produção real exige Kokoro, fábrica, FFmpeg e Whisper explícitos.')
def test_real_kokoro_local_pilot(tmp_path):
    import time
    from horus_backend.config import Settings
    from test_workflows import TOKEN, client_for
    from test_production import start
    from test_scripts import approved, generate, decide
    settings = Settings(token=TOKEN, data_dir=tmp_path/'data',
                        factory_root=Path(os.environ['HORUS_PILOT_FACTORY']), hermes_executable=None,
                        hermes_config=tmp_path/'unused.json')
    with client_for(settings) as client:
        script = generate(client, approved(client)).json()
        document = script['document']
        texts = [
            'No bairro fictício Jardim Aurora, moradores imaginam um jardim que aproveita a água da chuva. Este exemplo original demonstra uma produção audiovisual inteiramente local.',
            'A proposta começa com um reservatório fechado. A água coletada segue para canteiros identificados. Uma rotina de inspeção evita desperdício e mantém o projeto organizado.',
            'O resultado precisa de revisão humana. A narração é sintética, produzida no computador, e sua licença ainda não foi verificada. Este vídeo é somente um piloto de demonstração.']
        for section, text in zip(document['sections'], texts): section['narration'] = text
        with client.app.state.store.connect() as db:
            db.execute('UPDATE scripts SET document=? WHERE id=?', (json.dumps(document),script['id']))
        assert decide(client, script).status_code == 200
        response = start(client, script, mode='local_pilot', narration={'provider':'kokoro','voice_id':'pf_dora'})
        assert response.status_code == 201, response.text
        ident = response.json()['id']
        deadline = time.monotonic()+900
        while time.monotonic() < deadline:
            item = client.get('/v1/productions/'+ident).json()
            if item['status'] not in {'queued','running','cancel_requested'}: break
            time.sleep(.2)
        assert item['status'] == 'succeeded', item
        root = settings.data_dir/'productions'/ident
        timings = json.loads((root/'word-timings.json').read_text(encoding='utf-8'))
        evidence = json.loads((root/'pilot-evidence.json').read_text(encoding='utf-8'))
        assert evidence['narration']['origin'] == 'local_tts_model'
        assert evidence['narration']['engine'] == 'kokoro'
        assert item['speech_aligned'] and not item['publishable'] and item['demo_only']
        assert item['review'] is None
        assert timings['alignment']['matched_words'] == 77
        assert timings['alignment']['interpolated_words'] == 0
        assert item['quality_report']['status'] != 'fail', item['quality_report']
        video = next(a for a in item['artifacts'] if a['kind']=='video')
        assert hashlib.sha256((root/video['relative_path']).read_bytes()).hexdigest() == video['sha256']
        print(json.dumps({'root':str(root), 'matched_words':timings['alignment']['matched_words'],
            'interpolated_words':timings['alignment']['interpolated_words'],
            'qc':item['quality_report']['status'], 'video_sha256':video['sha256']}, ensure_ascii=False))

def test_production_passes_only_configured_kokoro_paths(tmp_path, monkeypatch):
    from horus_backend.config import Settings
    from test_workflows import TOKEN, client_for
    from test_production import script_for, start, finished
    settings = Settings(token=TOKEN, data_dir=tmp_path/'data', factory_root=None,
                        hermes_executable=None, hermes_config=tmp_path/'unused.json',
                        kokoro_python=tmp_path/'isolated-python.exe', kokoro_model_dir=tmp_path/'models',
                        piper_executable=None, piper_models=None,
                        alignment_model=None, ffmpeg=None, subtitle_font=None)
    seen = []
    async def start_owned(command, **kwargs):
        env = kwargs['env']
        expected = {k:v for k,v in os.environ.items() if k.upper() in
                    {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'}}
        expected.update(PYTHONUTF8='1', PYTHONUNBUFFERED='1',
                        HORUS_KOKORO_PYTHON=str(settings.kokoro_python.resolve()),
                        HORUS_KOKORO_MODEL_DIR=str(settings.kokoro_model_dir.resolve()))
        seen.append(env)
        assert env == expected
        raise OSError('simulated process failure')
    monkeypatch.setenv('HORUS_TOKEN', 'private')
    monkeypatch.setenv('ELEVENLABS_API_KEY', 'private')
    monkeypatch.setenv('HORUS_KOKORO_PYTHON', 'must-not-use-environment-value')
    monkeypatch.setenv('HORUS_KOKORO_MODEL_DIR', 'must-not-use-environment-value')
    monkeypatch.setenv('HORUS_KOKORO_EXTRA', 'private')
    monkeypatch.setattr(OwnedProcess, 'start', start_owned)
    with client_for(settings) as client:
        script = script_for(client)
        response = start(client, script, mode='local_pilot', narration={'provider':'kokoro','voice_id':'pf_dora'})
        assert response.status_code == 201, response.text
        assert finished(client, response.json())['status'] == 'failed'
    assert len(seen) == 1
