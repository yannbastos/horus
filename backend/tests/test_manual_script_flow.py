"""Ensaio opt-in HOR-133: API pública, texto humano e ferramentas locais reais."""
import hashlib
import json
import os
import math
from pathlib import Path
import struct
import sys
import time
import wave

import pytest

from horus_backend.config import Settings
from horus_backend.narration.providers import WindowsSapi
from test_workflows import TOKEN, client_for, settings, review
from test_scripts import decide
from test_scripts_manual import manual
from test_production import start
from horus_backend.local_pilot import normalize_narration, wav_info
from horus_backend.production_worker import run_factory_render

REQUIRED = ('HORUS_PILOT_FACTORY', 'HORUS_ALIGNMENT_MODEL', 'HORUS_FFMPEG')
TEXTS = [
    ('Uma conta que cabe no bairro', 'Imagine que um bairro fictício chamado Vila Aurora queira economizar água. Em 2026, um grupo de 12 moradores decidiu observar o consumo durante 30 dias. A primeira descoberta foi simples: medir antes de comprar ajuda a escolher melhor.'),
    ('Medir antes de decidir', 'A equipe criou uma planilha com três informações: data, volume consumido e número de pessoas em casa. Uma moradora explicou que a sigla ONG significa organização não governamental. Os números deste exemplo são inventados; servem para mostrar como transformar uma dúvida em uma pergunta que pode ser investigada.'),
    ('Uma experiência pequena', 'Depois da observação, os moradores combinaram uma experiência de duas semanas: identificar torneiras com vazamento e registrar o tempo necessário para cada reparo. Em vez de prometer uma redução de 50%, preferiram comparar os registros e explicar as diferenças. Nenhum resultado isolado prova que a mesma solução funciona em todo lugar.'),
    ('Revisar faz parte', 'No fim, o grupo apresentou o que aprendeu. A ideia principal não era vender uma solução milagrosa, mas compartilhar um método simples: observar, testar e revisar. Este vídeo usa um roteiro original de demonstração e uma voz sintética local. Antes de qualquer publicação, uma pessoa precisa ouvir a narração, conferir as legendas e verificar as licenças.')]


def document():
    return {'title': 'Vila Aurora: medir, testar e revisar', 'sections': [
        {'id': f'section-{i}', 'kind': 'hook' if i == 1 else 'conclusion' if i == len(TEXTS) else 'body',
         'heading': heading, 'narration': text} for i, (heading, text) in enumerate(TEXTS, 1)]}


def approved_simulated_hermes(client):
    response = client.post('/v1/radar/datasets/demo', headers={'Idempotency-Key':'dataset'})
    assert response.status_code == 201, response.text
    dataset = response.json()
    response = client.post('/v1/workflows/radar', headers={'Idempotency-Key':'proposal'}, json={
        'snapshot_id':dataset['snapshot_id'], 'revision':1, 'objective':'Vídeo original sobre economia de água',
        'channel':{'channel_id':'manual-demo','summary':'Exemplo fictício em português brasileiro'}})
    assert response.status_code == 202, response.text
    wid = response.json()['id']
    def wait_for(predicate):
        deadline = time.monotonic()+20
        while time.monotonic() < deadline:
            workflow = client.get('/v1/workflows/'+wid).json()
            if predicate(workflow):
                return workflow
            time.sleep(.02)
        pytest.fail(str(workflow))
    workflow = wait_for(lambda w: w['pending_authorization'] is not None)
    assert workflow['executor'] == 'hermes_simulated'
    response = client.post(f'/v1/workflows/{wid}/authorize', headers={'Idempotency-Key':'authorize'},
        json={'expected_revision':workflow['revision'], 'job_id':workflow['pending_authorization']['job_id']})
    assert response.status_code == 200, response.text
    workflow = wait_for(lambda w: w['status'] == 'awaiting_approval')
    assert review(client, workflow).status_code == 200
    return workflow


def test_simulated_hermes_proposal_accepts_original_manual_script(settings):
    with client_for(settings) as client:
        response = manual(client, approved_simulated_hermes(client), document())
        assert response.status_code == 201, response.text
        assert response.json()['origin'] == 'human'
        assert decide(client, response.json()).status_code == 200


@pytest.mark.parametrize('exit_code', [0, 3])
def test_renderer_preserves_bounded_failure_diagnostic(tmp_path, exit_code):
    command = [sys.executable, '-c',
        f"import sys; sys.stderr.write('x'*10000+'END'); sys.exit({exit_code})"]
    result = run_factory_render(tmp_path, command, dict(os.environ))
    assert result.returncode == exit_code
    if exit_code:
        report = json.loads((tmp_path/'render-failure.json').read_text(encoding='utf-8'))
        assert report['exit_code'] == exit_code and report['stderr_tail'].endswith('END')
        assert len(report['stderr_tail'].encode()) == 8192
    else:
        assert not (tmp_path/'render-failure.json').exists()


@pytest.mark.parametrize('measurement', [b'no JSON', b'{"input_i":"-inf","input_tp":"-inf","input_lra":"0","input_thresh":"-inf","target_offset":"inf"}'])
def test_normalization_rejects_unmeasurable_audio_without_replacing_source(tmp_path, monkeypatch, measurement):
    path = tmp_path/'section-1.wav'
    with wave.open(str(path), 'wb') as wav:
        wav.setparams((1,2,24000,0,'NONE','not compressed'))
        wav.writeframes(b'\0\0'*24000)
    original = path.read_bytes()
    async def fake_tool(*args, **kwargs):
        return measurement
    monkeypatch.setattr('horus_backend.local_pilot.owned_tool', fake_tool)
    with pytest.raises(ValueError):
        normalize_narration(tmp_path, tmp_path, [{'n':1}], tmp_path/'unused.exe')
    assert path.read_bytes() == original
    assert not (tmp_path/'narration-normalization.json').exists()


@pytest.mark.skipif(not os.environ.get('HORUS_FFMPEG'), reason='Normalização física exige FFmpeg explícito.')
def test_real_normalization_preserves_sections_and_originals(tmp_path):
    sections = [{'n':1}, {'n':2}]
    originals = []
    for n, frames in ((1, 72000), (2, 96000)):
        path = tmp_path/f'section-{n}.wav'
        with wave.open(str(path), 'wb') as wav:
            wav.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', round(400*math.sin(2*math.pi*440*i/24000))) for i in range(frames)))
        originals.append(path.read_bytes())
    report = normalize_narration(tmp_path, tmp_path, sections, Path(os.environ['HORUS_FFMPEG']))
    assert report['sample_count_unchanged']
    assert report['output_lufs'] == pytest.approx(-16, abs=1)
    assert report['effective_loudness_gain_db'] > 10
    for n, frames, content in zip((1,2), (72000,96000), originals):
        assert (tmp_path/'narration-original'/f'section-{n}.wav').read_bytes() == content
        assert wav_info(tmp_path/f'section-{n}.wav')[0].nframes == frames
        assert (tmp_path/f'section-{n}.wav').read_bytes() != content


@pytest.mark.skipif(not all(os.environ.get(k) for k in REQUIRED), reason='Ensaio real exige fábrica, Whisper e FFmpeg explícitos.')
@pytest.mark.parametrize('provider', ['kokoro', 'windows_sapi'])
def test_real_manual_script_to_final_mp4(tmp_path, provider):
    if provider == 'kokoro' and not all(os.environ.get(k) for k in ('HORUS_KOKORO_PYTHON', 'HORUS_KOKORO_MODEL_DIR')):
        pytest.skip('Kokoro real exige Python e modelo explícitos.')
    settings = Settings(token=TOKEN, data_dir=tmp_path/'data',
        factory_root=Path(os.environ['HORUS_PILOT_FACTORY']), hermes_executable=None,
        hermes_config=tmp_path/'unused.json', workflow_executor='simulated',
        radar_executor='hermes_simulated', hermes_poll_seconds=.03)
    if provider == 'windows_sapi':
        voices = [v for v in WindowsSapi().voices() if 'Maria' in v['name']]
        assert voices, 'Microsoft Maria deve estar instalada para este ensaio.'
        voice = voices[0]['id']
    else:
        voice = 'pf_dora'
    began = time.monotonic()
    with client_for(settings) as client:
        response = manual(client, approved_simulated_hermes(client), document())
        assert response.status_code == 201, response.text
        script = response.json()
        assert script['origin'] == script['authored_by'] == 'human'
        assert script['document']['simulated'] is False
        assert decide(client, script).status_code == 200
        response = start(client, script, mode='local_pilot', render_quality='final',
                         narration={'provider': provider, 'voice_id': voice})
        assert response.status_code == 201, response.text
        pid = response.json()['id']
        deadline = time.monotonic()+1800
        while time.monotonic() < deadline:
            item = client.get('/v1/productions/'+pid).json()
            if item['status'] not in {'queued', 'running', 'cancel_requested'}:
                break
            time.sleep(.2)
        assert item['status'] == 'succeeded', item
        root = settings.data_dir/'productions'/pid
        read = lambda name: json.loads((root/name).read_text(encoding='utf-8'))
        evidence, words = read('pilot-evidence.json'), read('word-timings.json')
        video = next(a for a in item['artifacts'] if a['kind'] == 'video')
        assert hashlib.sha256((root/video['relative_path']).read_bytes()).hexdigest() == video['sha256']
        assert (evidence['video']['width'], evidence['video']['height']) == (1080, 1920)
        assert 60 <= evidence['narration']['duration_seconds'] <= 120
        assert not item['publishable'] and item['demo_only']
        assert item['speech_aligned'], read('alignment-report.json')
        assert item['quality_report']['status'] != 'fail', item['quality_report']
        if provider == 'kokoro':
            normalization = read('narration-normalization.json')
            assert -18 <= normalization['output_lufs'] <= -14
            assert any(a['relative_path'] == 'narration-normalization.json' for a in item['artifacts'])
            assert next(c for c in item['quality_report']['checks'] if c['id'] == 'audio_loudness')['status'] == 'pass'
            for section in normalization['sections']:
                assert hashlib.sha256((root/section['relative_path']).read_bytes()).hexdigest() == section['sha256']
        assert 'roteiro simulado' not in json.dumps(evidence, ensure_ascii=False).lower()
        # Verificação fictícia de uma cena original; não concede licença à voz ou à fonte.
        asset = next(a for a in evidence['assets'] if a['id'] == 'scene-1')
        license_body = {'asset_id': asset['id'], 'asset_sha256': asset['sha256'], 'decision': 'verified',
            'license': {'id': 'original', 'name': 'Cena original do ensaio', 'url': 'https://example.org/ensaio',
                        'commercial_use': 'allowed', 'attribution_required': False},
            'evidence': 'Decisão fictícia automatizada: cena gerada localmente para este ensaio.', 'reviewed_by': 'human'}
        route = f'/v1/productions/{pid}'
        response = client.post(route+'/license-reviews', json=license_body, headers={'Idempotency-Key': 'license'})
        assert response.status_code == 201, response.text
        review_body = {'decision': 'approve', 'artifact_sha256': video['sha256'],
            'notes': [{'at_seconds': 1.0, 'text': 'Aprovação fictícia de teste; não é aceite editorial humano.'}]}
        if item['quality_acknowledgement_required']:
            assert client.post(route+'/review', json=review_body, headers={'Idempotency-Key': 'missing-ack'}).status_code == 409
            review_body['acknowledge_quality_errors'] = True
        response = client.post(route+'/review', json=review_body, headers={'Idempotency-Key': 'review'})
        assert response.status_code == 200, response.text
        reviewed = response.json()
        assert reviewed['review']['decision'] == 'approve' and not reviewed['publishable']
        summary = {'provider': provider, 'root': str(root), 'elapsed_seconds': round(time.monotonic()-began, 3),
            'video_sha256': video['sha256'], 'narration': evidence['narration'], 'video': evidence['video'],
            'alignment': words.get('alignment'), 'alignment_report': read('alignment-report.json'),
            'qc': item['quality_report'], 'render': read('canais/demo/videos/fixture/render/validation.json')}
        (tmp_path/'manual-flow-report.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
        print('MANUAL_FLOW_REPORT='+str(tmp_path/'manual-flow-report.json'))
        print('MANUAL_FLOW_RESULT='+json.dumps({k:v for k,v in summary.items() if k not in {'qc','render','alignment_report'}}, ensure_ascii=False))
    with client_for(settings) as client:
        assert client.get(route).json() == reviewed
        assert client.get('/v1/scripts/'+script['id']).json()['origin'] == 'human'
