"""Registro na produção: somente mocks e processos temporários locais."""
import asyncio
import itertools
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from horus_backend.narration.production_worker import synthesize_sections
from horus_backend.narration.providers import ElevenLabs, Piper, NarrationError
from horus_backend.config import Settings
from horus_backend import local_pilot


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in ('HORUS_FFMPEG','HORUS_ALIGNMENT_MODEL','HORUS_SUBTITLE_FONT','HORUS_PILOT_FACTORY',
                 'HORUS_PIPER_EXECUTABLE','HORUS_PIPER_MODELS'):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize('provider_id', ['windows_sapi','piper'])
def test_each_section_uses_selected_provider_and_records_identity(tmp_path, monkeypatch, provider_id):
    calls = []
    model = {'id':'voice','version':'1','sha256':'a'*64} if provider_id == 'piper' else None
    class Provider:
        id, kind = provider_id, 'local'
        def status(self): return {'status':'available'}
        def voices(self): return [{'id':'voice','name':'Voz selecionada','language':'pt-BR'}]
        def synthesize(self,text,voice,output,authorization=None):
            calls.append((text,voice,output,authorization))
            output.write_bytes(b'wave-fixture')
            return {'model':model,'speech_aligned':True}  # Flag do provedor nunca é adotada.
    monkeypatch.setattr('horus_backend.local_pilot_windows.scene',lambda *args:None)
    request = {'narration':{'provider':provider_id,'voice_id':'voice'},'folder':str(tmp_path),
               'sections':[{'n':1,'text':'primeira'},{'n':2,'text':'segunda'}],'scene_size':[540,960]}
    synthesize_sections(request,{provider_id:Provider()})
    assert [(c[0],c[1],c[2].name,c[3]) for c in calls] == [
        ('primeira','voice','section-1.wav',None),('segunda','voice','section-2.wav',None)]
    voice = json.loads((tmp_path/'voice.json').read_text(encoding='utf-8'))
    assert voice['engine'] == provider_id and voice['voice_id'] == 'voice'
    assert voice['model'] == model and 'speech_aligned' not in voice


@pytest.mark.parametrize('enabled,credential',list(itertools.product([False,True],repeat=2)))
def test_production_paid_never_reaches_transport_or_credentials(tmp_path, enabled, credential):
    def forbidden(*args,**kwargs): pytest.fail('Production must block before consulting paid provider')
    accesses = []
    def get():
        accesses.append(True)
        return 'synthetic' if credential else None
    provider = ElevenLabs(Settings(token='',narration_paid_enabled=enabled),
                         SimpleNamespace(get=get), SimpleNamespace(synthesize=forbidden))
    request = {'narration':{'provider':'elevenlabs','voice_id':'voice'},'folder':str(tmp_path),
               'sections':[{'n':1,'text':'roteiro fictício'}]}
    with pytest.raises(ValueError,match='paid_provider_not_authorized'):
        synthesize_sections(request,{'elevenlabs':provider})
    assert not list(tmp_path.iterdir())
    assert accesses == []


def test_renderer_import_does_not_require_api_or_keyring(tmp_path):
    env = {k:v for k,v in os.environ.items() if k.upper() in {'SYSTEMROOT','WINDIR','PATH','TEMP','TMP'}}
    env['PYTHONPATH'] = str(Path(local_pilot.__file__).resolve().parents[1])
    result = subprocess.run([sys.executable,'-S','-c',
        'import horus_backend.local_pilot; import horus_backend.pilot_quality'],
        cwd=tmp_path,env=env,capture_output=True,timeout=20)
    assert result.returncode==0, result.stderr.decode(errors='replace')


def test_piper_model_identity_is_content_hash(tmp_path, monkeypatch):
    import hashlib
    executable = tmp_path/'piper.exe'
    executable.touch()
    model = tmp_path/'pt.onnx'
    model.write_bytes(b'local-model-fixture')
    model.with_suffix('.onnx.json').write_text('{}')
    monkeypatch.setattr('horus_backend.narration.providers.run',lambda *args,**kwargs:'')
    result = Piper(executable,tmp_path).synthesize('fala','pt.onnx',tmp_path/'out.wav')
    digest = hashlib.sha256(model.read_bytes()).hexdigest()
    assert result['model'] == {'id':'pt.onnx','version':'sha256:'+digest,'sha256':digest}


def test_piper_rejects_weights_changed_during_synthesis(tmp_path, monkeypatch):
    executable = tmp_path/'piper.exe'
    executable.touch()
    model = tmp_path/'pt.onnx'
    model.write_bytes(b'before')
    model.with_suffix('.onnx.json').write_text('{}')
    monkeypatch.setattr('horus_backend.narration.providers.run',lambda *args,**kwargs:model.write_bytes(b'after'))
    with pytest.raises(NarrationError,match='narration_model_changed'):
        Piper(executable,tmp_path).synthesize('fala','pt.onnx',tmp_path/'out.wav')


@pytest.mark.parametrize('stop',['cancel','timeout'])
def test_synthesis_process_is_owned_and_stopped(tmp_path,monkeypatch,stop):
    from horus_backend.processes import OwnedProcess
    original_start = OwnedProcess.start
    processes = []
    async def start(command,**kwargs):
        assert command[1:3] == ['-m','horus_backend.narration.production_worker']
        assert kwargs['env']['HORUS_PIPER_MODELS'] == str(tmp_path)
        assert 'HORUS_PRIVATE_TEST_SECRET' not in kwargs['env']
        process = await original_start([sys.executable,'-c','import time; time.sleep(60)'],**kwargs)
        processes.append(process)
        return process
    monkeypatch.setenv('HORUS_PIPER_MODELS',str(tmp_path))
    monkeypatch.setenv('HORUS_PRIVATE_TEST_SECRET','do-not-forward')
    monkeypatch.setattr(OwnedProcess,'start',start)
    request = tmp_path/'input.json'
    request.write_text(json.dumps({'narration':{'provider':'piper','voice_id':'v'}}))
    wait_for = asyncio.wait_for
    if stop == 'timeout':
        async def short_wait(awaitable,timeout): return await wait_for(awaitable,.05)
        monkeypatch.setattr(local_pilot.asyncio,'wait_for',short_wait)
    async def run():
        task = asyncio.create_task(local_pilot.synthesize(request))
        if stop == 'cancel':
            while not processes: await asyncio.sleep(.01)
            task.cancel()
        with pytest.raises(asyncio.CancelledError if stop == 'cancel' else TimeoutError): await task
        assert processes[0].process.returncode is not None
    asyncio.run(run())
