import hashlib
import json
import os
from pathlib import Path
import sqlite3
import math
import struct
import time
import wave

import pytest

from test_workflows import settings, client_for
from test_production import script_for, start, finished
from horus_backend.local_pilot import subtitle_sections, wav_info, signal_measurements
from horus_backend.migrations import migrate, MIGRATIONS


def test_scene_regions_survive_original_ken_burns_and_caption_reserve():
    from horus_backend.local_pilot_windows import SCENE_REGIONS, transformed_bounds
    for direction in ('esquerda','direita','cima','baixo'):
        for step in range(101):
            for name,bounds in SCENE_REGIONS.items():
                left,top,right,bottom = transformed_bounds(bounds,step/100,direction)
                assert 0 < left < right < 1080 and 0 < top < bottom < 1920
                if name == 'disclosure':
                    assert top >= 1620  # legenda existente termina em y=1596 no 9:16
                else:
                    assert bottom < 1220  # região reservada acima das legendas


def test_measured_wrap_keeps_accented_text_and_long_tokens():
    from horus_backend.local_pilot_windows import wrap_measured
    text = 'Água, ação e informação ' + 'W'*70
    lines = wrap_measured(text,lambda value:len(value)*10,200)
    assert all(len(line)*10 <= 200 for line in lines)
    assert ''.join(''.join(lines).split()) == ''.join(text.split())
    with pytest.raises(ValueError): wrap_measured('W',lambda value:len(value)*300,200)


@pytest.mark.skipif(os.name != 'nt',reason='Medição GDI nativa do Windows.')
def test_native_scene_measures_all_text_and_records_safe_bounds(tmp_path):
    from horus_backend.local_pilot_windows import scene,SCENE_REGIONS
    section = {'n':1,'heading':'Água e ação no bairro fictício: revisão com informação original',
               'summary':' '.join(['Informação']*32)}
    path = tmp_path/'scene.png'
    scene(path,section)
    layout = json.loads(path.with_suffix('.layout.json').read_text(encoding='utf-8'))
    for key in ('heading','summary'):
        assert ' '.join(layout[key]['lines']) == section[key]
    assert ' '.join(layout['disclosure']['lines']) == 'VOZ SINTÉTICA LOCAL | LICENÇA NÃO VERIFICADA'
    for key,item in layout.items():
        left,top,right,bottom = item['bounds']
        x0,y0,x1,y1 = SCENE_REGIONS[key]
        assert x0 <= left < right <= x1 and y0 <= top < bottom <= y1


def test_subtitles_keep_complete_text_and_measured_boundaries():
    text = 'Uma seção inteira com acentos, números 123 e conclusão sem corte.'
    segments = subtitle_sections(text, 2.5, 43.125)
    assert ' '.join(s['text'] for s in segments) == text
    assert segments[0]['start'] == 2.5 and segments[-1]['end'] == 43.125
    assert all(a['end'] == b['start'] for a,b in zip(segments,segments[1:]))
    assert all(s['start'] < s['end'] for s in segments)
    with pytest.raises(ValueError): subtitle_sections('',0,1)
    with pytest.raises(ValueError): subtitle_sections('fala',1,1)


def test_wav_duration_uses_frames_not_estimate(tmp_path):
    path = tmp_path/'audio.wav'
    with wave.open(str(path),'wb') as audio:
        audio.setparams((1,2,22050,0,'NONE','not compressed'))
        audio.writeframes(b'\0\0'*44101)
    assert wav_info(path)[1] == pytest.approx(44101/22050)
    with wave.open(str(path),'wb') as audio:
        audio.setparams((2,2,22050,0,'NONE','not compressed'))
        audio.writeframes(b'\0'*8)
    with pytest.raises(ValueError): wav_info(path)


def test_narration_rejects_silence_and_old_fixture_tone(tmp_path):
    path = tmp_path/'audio.wav'
    for tone in (False, True):
        with wave.open(str(path),'wb') as audio:
            audio.setparams((1,2,16000,0,'NONE','not compressed'))
            audio.writeframes(b''.join(struct.pack('<h',round(400*math.sin(2*math.pi*220*i/16000)) if tone else 0)
                                       for i in range(16000)))
        with pytest.raises(ValueError): signal_measurements(path)


def test_sapi_failure_creates_no_evidence_or_tone(tmp_path,monkeypatch):
    from horus_backend.local_pilot import prepare
    from test_production_contract import build
    folder = tmp_path/'assets'
    folder.mkdir()
    async def unavailable(path):
        raise ValueError('Voz pt-BR indisponível.')
    monkeypatch.setattr('horus_backend.local_pilot.synthesize',unavailable)
    with pytest.raises(ValueError): prepare(tmp_path,folder,build(mode='local_pilot').model_dump(mode='json'))
    assert not (folder/'fixture.wav').exists()
    assert not (tmp_path/'pilot-evidence.json').exists()


def test_sapi_other_platform_is_explicit(tmp_path,monkeypatch):
    import asyncio
    from horus_backend.local_pilot import synthesize
    with monkeypatch.context() as scope:
        scope.setattr('horus_backend.local_pilot.os.name','posix')
        with pytest.raises(ValueError,match='Windows SAPI'):
            asyncio.run(synthesize(tmp_path/'request.json'))


def test_metadata_cannot_claim_tts_without_registered_evidence(tmp_path):
    from horus_backend.local_pilot import confirmed_metadata
    with pytest.raises(ValueError,match='manifesto'):
        confirmed_metadata(tmp_path,[])


def test_estimated_words_provenance_quality_and_registered_hashes(tmp_path,monkeypatch):
    from horus_backend import local_pilot as pilot
    from horus_backend.production import inspect_artifact
    from test_production_contract import build
    plan=build(mode='local_pilot').model_dump(mode='json')
    folder=tmp_path/'canais/demo/videos/fixture'
    folder.mkdir(parents=True)
    pilot.write(tmp_path/'plan.json',plan)
    async def synthetic_inputs(request):
        for section in json.loads(request.read_text(encoding='utf-8'))['sections']:
            path=folder/f"section-{section['n']}.wav"
            with wave.open(str(path),'wb') as audio:
                audio.setparams((1,2,22050,0,'NONE','not compressed'))
                audio.writeframes(b''.join(struct.pack('<h',round(3000*math.sin(2*math.pi*440*i/22050))) for i in range(22050)))
            (folder/f"scene-{section['n']}.png").write_bytes(b'\x89PNG\r\n\x1a\nunit-fixture')
            pilot.write(folder/f"scene-{section['n']}.layout.json",{})
        pilot.write(folder/'voice.json',{'culture':'pt-BR','voice':'Voz fictícia do teste'})
    monkeypatch.setattr(pilot,'synthesize',synthetic_inputs)
    paths=pilot.prepare(tmp_path,folder,plan)
    words=json.loads((tmp_path/'word-timings.json').read_text(encoding='utf-8'))
    assert words['source']=='estimated'
    assert [w['text'] for w in words['words']]==[w for l in plan['roteiro']['linhas'] for w in l['narracao'].split()]
    assert all(a['end']<=b['start']+.001 for a,b in zip(words['words'],words['words'][1:]))
    (folder/'render').mkdir()
    (folder/'render/short-rascunho.mp4').write_bytes(b'\0\0\0\x18ftypunit-fixture')
    evidence=json.loads((tmp_path/'pilot-measurements.json').read_text(encoding='utf-8'))
    evidence['video']={'duration_seconds':3.8,'width':540,'height':960,'frames':114}
    pilot.write(tmp_path/'pilot-evidence.json',evidence)
    pilot.quality_report(tmp_path,folder,'unit-production')
    paths += [{'relative_path':'plan.json','kind':'plan'},
              {'relative_path':'quality-report.json','kind':'manifest'},
              {'relative_path':(folder/'render/short-rascunho.mp4').relative_to(tmp_path).as_posix(),'kind':'video'}]
    artifacts=[inspect_artifact(tmp_path,p['relative_path'],p['kind']) for p in paths]
    metadata=pilot.confirmed_media(tmp_path,artifacts,'unit-production')
    assert metadata['speech_aligned'] is False
    assert metadata['quality_report']['status']=='warn'
    assert metadata['asset_provenance'] is not None
    assert all(a['status']=='unverified' and a['license']['commercial_use']=='unknown' for a in metadata['asset_provenance']['assets'])
    assert all(c['method']=='estimated' for c in metadata['quality_report']['checks'] if c['category']=='sync')
    # Somente fixture do contrato: nenhuma inferência acústica real é alegada neste teste.
    declared_alignment=json.loads(json.dumps(words))|{'source':'forced_alignment','alignment':{
        'method':'asr_sequence_match','asr_engine':'fixture','matched_words':len(words['words']),
        'interpolated_words':0,'match_rate':1.0,'longest_interpolated_seconds':0.0}}
    for item in declared_alignment['words']:
        item['timing']='measured'   # extensão HOR-054: forced_alignment declara o tipo de tempo de cada palavra
    pilot.write(tmp_path/'word-timings.json',declared_alignment)
    refreshed=[inspect_artifact(tmp_path,p['relative_path'],p['kind']) for p in paths]
    assert pilot.confirmed_media(tmp_path,refreshed,'unit-production')['speech_aligned'] is True
    without_plan=[a for a in refreshed if a['relative_path']!='plan.json']
    assert pilot.confirmed_media(tmp_path,without_plan,'unit-production')['speech_aligned'] is False
    declared_alignment['words'][0]['text']='x'*len(declared_alignment['words'][0]['text'])
    pilot.write(tmp_path/'word-timings.json',declared_alignment)
    refreshed=[inspect_artifact(tmp_path,p['relative_path'],p['kind']) for p in paths]
    assert pilot.confirmed_media(tmp_path,refreshed,'unit-production')['speech_aligned'] is False
    pilot.write(tmp_path/'word-timings.json',words)
    evidence['demo_only']=False
    pilot.write(tmp_path/'pilot-evidence.json',evidence)
    pilot.quality_report(tmp_path,folder,'unit-production')
    report=json.loads((tmp_path/'quality-report.json').read_text(encoding='utf-8'))
    assert report['status']=='fail' and report['blocking_errors']
    assert (folder/'fixture.wav').exists() and (folder/'render/short-rascunho.mp4').exists()
    (tmp_path/'quality-report.json').write_text('{}',encoding='utf-8')
    assert pilot.confirmed_media(tmp_path,artifacts,'unit-production')['quality_report'] is None
    (tmp_path/'asset-provenance.json').write_text('{}',encoding='utf-8')
    assert pilot.confirmed_media(tmp_path,artifacts,'unit-production')['asset_provenance'] is None


@pytest.mark.skipif(not os.environ.get('HORUS_PILOT_FACTORY'),reason='SAPI real explícito somente no ensaio Windows.')
def test_real_sapi_owned_process_cancels_without_finishing(tmp_path):
    import asyncio
    import sys
    from horus_backend.processes import OwnedProcess
    import horus_backend.local_pilot as pilot
    request = tmp_path/'request.json'
    request.write_text(json.dumps({'folder':str(tmp_path),'sections':[
        {'n':index,'text':'Esta é uma seção longa para verificar cancelamento local. '*130,
         'heading':'Cancelamento fictício','summary':'Verificar posse do processo SAPI.'} for index in range(1,31)]}),encoding='utf-8')
    async def run():
        env = {k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'}}
        owned = await OwnedProcess.start([sys.executable,str(Path(pilot.__file__).with_name('local_pilot_windows.py')),str(request)],env=env,cwd=tmp_path)
        try:
            deadline = time.monotonic()+15
            while not (tmp_path/'section-1.wav').exists() and time.monotonic()<deadline:
                await asyncio.sleep(.01)
            assert (tmp_path/'section-1.wav').exists(),'SAPI não iniciou WAV.'
            assert owned.process.returncode is None
        finally:
            await owned.stop()
            owned.close()
        assert owned.process.returncode is not None
    asyncio.run(run())
    assert not (tmp_path/'voice.json').exists()
    before = [(p.name,p.stat().st_size) for p in tmp_path.glob('*.wav')]
    time.sleep(.2)
    assert before == [(p.name,p.stat().st_size) for p in tmp_path.glob('*.wav')]


def seed_v6(settings, monkeypatch):
    with monkeypatch.context() as old:
        old.setattr('horus_backend.migrations.SCHEMA_VERSION',6)
        with client_for(settings) as client:
            script = script_for(client)
            record = finished(client,start(client,script).json())
            assert record['status'] == 'succeeded'
            with client.app.state.store.connect() as db:
                # Inclui uma produção/revisão local_demo já persistida e seu recibo.
                db.execute("UPDATE productions SET mode='local_demo',review=? WHERE id=?",
                           (json.dumps({'decision':'reject','artifact_sha256':'a'*64}),record['id']))
                db.execute('INSERT INTO production_receipts VALUES(?,?,?,?)',
                           ('review:'+record['id'],'review-key','{}',record['id']))
                productions = [tuple(row) for row in db.execute('SELECT * FROM productions')]
                receipts = [tuple(row) for row in db.execute('SELECT * FROM production_receipts ORDER BY scope')]
                path = Path(db.execute('PRAGMA database_list').fetchone()[2])
    return path,productions,receipts,script


def test_migration_v7_preserves_v6_productions_receipts_ids_and_fks(settings,monkeypatch):
    path,productions,receipts,script = seed_v6(settings,monkeypatch)
    for _ in range(2):
        migrate(path)
        with sqlite3.connect(path) as db:
            db.execute('PRAGMA foreign_keys=ON')
            assert db.execute('PRAGMA user_version').fetchone()[0] == 7
            assert db.execute('SELECT * FROM productions').fetchall() == productions
            assert db.execute('SELECT * FROM production_receipts ORDER BY scope').fetchall() == receipts
            assert db.execute('PRAGMA foreign_key_check').fetchall() == []
            assert len(db.execute('PRAGMA index_list(productions)').fetchall()) == 2
            assert len(db.execute('PRAGMA index_list(production_receipts)').fetchall()) == 1
            with pytest.raises(sqlite3.IntegrityError):
                db.execute("UPDATE productions SET job_id='missing'")
            with pytest.raises(sqlite3.IntegrityError):
                db.execute("UPDATE production_receipts SET production_id='missing'")
            db.execute("UPDATE productions SET mode='local_pilot'")
            db.rollback()
    assert len(list(path.parent.glob(path.stem+'.backup-v6-*.sqlite3'))) == 1
    with client_for(settings) as client:
        # Mesmo recibo retorna o ID anterior, sem criar outro job.
        response = start(client,script)
        assert response.status_code == 200 and response.json()['id'] == productions[0][0]


def test_migration_v7_failure_rolls_back_after_table_replacement(settings,monkeypatch):
    path,productions,receipts,_ = seed_v6(settings,monkeypatch)
    monkeypatch.setitem(MIGRATIONS,7,(*MIGRATIONS[7], 'INSERT INTO missing_table VALUES(1)'))
    with pytest.raises(sqlite3.OperationalError): migrate(path)
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 6
        assert db.execute('SELECT * FROM productions').fetchall() == productions
        assert db.execute('SELECT * FROM production_receipts ORDER BY scope').fetchall() == receipts
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        assert not db.execute("SELECT name FROM sqlite_master WHERE name LIKE '%_v7'").fetchall()
        with pytest.raises(sqlite3.IntegrityError): db.execute("UPDATE productions SET mode='local_pilot'")


@pytest.mark.skipif(not os.environ.get('HORUS_PILOT_FACTORY'),reason='Ensaio real explícito requer sandbox fábrica preparada.')
def test_real_local_pilot_render_review_and_restart(settings):
    from dataclasses import replace
    from test_scripts import approved, generate, decide
    settings = replace(settings,factory_root=Path(os.environ['HORUS_PILOT_FACTORY']))
    with client_for(settings) as client:
        script = generate(client,approved(client)).json()
        # Conteúdo fictício escrito antes da aprovação M3 do teste; sem editar snapshot aprovado.
        document = script['document']
        document['title'] = 'Jardim Aurora: água para o bairro fictício'
        content = [
            ('Um bairro, uma ideia', 'No bairro fictício Jardim Aurora, moradores imaginam um jardim que aproveita a água da chuva. Este exemplo original demonstra uma produção audiovisual inteiramente local.'),
            ('Da chuva ao jardim', 'A proposta começa com um reservatório fechado. A água coletada segue para canteiros identificados. Uma rotina de inspeção evita desperdício e mantém o projeto organizado.'),
            ('Revisar antes de publicar', 'O resultado precisa de revisão humana. A narração é sintética, produzida no computador, e sua licença ainda não foi verificada. Este vídeo é somente um piloto de demonstração.')]
        for section,(heading,narration) in zip(document['sections'],content):
            section.update(heading=heading,narration=narration)
        with client.app.state.store.connect() as db:
            db.execute('UPDATE scripts SET document=? WHERE id=?',(json.dumps(document,ensure_ascii=False),script['id']))
        assert decide(client,script).status_code == 200
        cancelled = start(client,script,key='cancel-real-pilot',mode='local_pilot').json()
        cancel_root = settings.data_dir/'productions'/cancelled['id']
        deadline = time.monotonic()+15
        while not (cancel_root/'canais/demo/videos/fixture/section-1.wav').exists() and time.monotonic()<deadline:
            time.sleep(.01)
        assert (cancel_root/'canais/demo/videos/fixture/section-1.wav').exists()
        assert client.post(f"/v1/jobs/{cancelled['job_id']}/cancel").status_code == 200
        assert finished(client,cancelled)['status'] == 'cancelled'
        assert not (cancel_root/'pilot-evidence.json').exists()
        # Artefatos parciais conciliados pelo teste: saída preservada, nova produção explícita.
        response = start(client,script,mode='local_pilot')
        assert response.status_code == 201,response.text
        initial = response.json()
        assert initial['narration_kind'] is None
        assert initial['id'] != cancelled['id']
        deadline = time.monotonic()+900
        while time.monotonic()<deadline:
            item = client.get('/v1/productions/'+initial['id']).json()
            if item['status'] not in {'queued','running','cancel_requested'}: break
            time.sleep(.2)
        assert item['status']=='succeeded',item
        assert item['narration_kind']=='local_tts'
        aligned = bool(settings.alignment_model)
        assert item['alignment_method'] == ('forced_alignment' if aligned else 'measured_sections')
        assert not item['real_voice'] and item['speech_aligned'] is aligned and not item['publishable']
        assert item['quality_report']['status']==('fail' if aligned else 'warn')
        assert item['quality_report']['video_sha256']==next(a['sha256'] for a in item['artifacts'] if a['kind']=='video')
        assert item['quality_acknowledgement_required'] is aligned
        assert item['asset_provenance'] is not None
        root = settings.data_dir/'productions'/item['id']
        evidence = json.loads((root/'pilot-evidence.json').read_text(encoding='utf-8'))
        assert evidence['narration']['voice'] and evidence['narration']['duration_seconds']>0
        assert evidence['video']['duration_seconds'] >= evidence['narration']['duration_seconds']
        assert evidence['video']['frames']>2
        for name in ('word-timings.json','asset-provenance.json','quality-report.json'):
            artifact=next(a for a in item['artifacts'] if a['relative_path']==name)
            assert hashlib.sha256((root/name).read_bytes()).hexdigest()==artifact['sha256']
        word_timings=json.loads((root/'word-timings.json').read_text(encoding='utf-8'))
        assert word_timings['source']==('forced_alignment' if aligned else 'estimated') and len(word_timings['words'])==77
        if not aligned:
            assert evidence['subtitles'][0]['start']==0
            assert evidence['subtitles'][-1]['end']==pytest.approx(evidence['narration']['duration_seconds'])
        else:
            assert word_timings['alignment']['matched_words'] == 77
            assert word_timings['alignment']['interpolated_words'] == 0
            assert evidence['subtitles'] == __import__('horus_backend.local_pilot',fromlist=['subtitle_words']).subtitle_words(word_timings['words'])
            sync = next(c for c in item['quality_report']['checks'] if c['id']=='subtitles_vs_words')
            assert sync['method']=='measured' and sync['status']=='fail'
            assert sync['measured']['mean_deviation_seconds'] > 0
            assert sync['measured']['max_deviation_seconds'] > .6
            hold = next(c for c in item['quality_report']['checks'] if c['id']=='subtitles_vs_sections')
            assert hold['status']=='fail' and hold['measured']['max_hold_seconds'] > .6
        for asset in evidence['assets']:
            assert hashlib.sha256((root/asset['relative_path']).read_bytes()).hexdigest()==asset['sha256']
        assert {a['license'] for a in evidence['assets'] if a['origin']=='system_voice'}=={'unverified'}
        video = next(a for a in item['artifacts'] if a['kind']=='video')
        route = f"/v1/productions/{item['id']}/artifacts/{video['id']}"
        assert client.get(route).status_code==200
        assert start(client,script,mode='local_pilot').json()['id']==item['id']
        review_route = '/v1/productions/'+item['id']+'/review'
        assert client.post(review_route,json={'decision':'approve','artifact_sha256':'0'*64},headers={'Idempotency-Key':'bad-review'}).status_code==409
        # Decisão fictícia do teste sobre mídia fictícia; não é aceite/licença do operador.
        review_body = {'decision':'reject','artifact_sha256':video['sha256'],
                       'notes':[{'at_seconds':2.125,'text':'Conferir legenda e fala neste instante.'}]}
        response = client.post(review_route,json=review_body,headers={'Idempotency-Key':'test-review'})
        assert response.status_code==200,response.text
        item = response.json()
        assert item['review']['notes']==review_body['notes']
        assert client.post(review_route,json=review_body,headers={'Idempotency-Key':'test-review'}).json()==item
        changed = review_body | {'notes':[{'at_seconds':2.125,'text':'Nota alterada'}]}
        assert client.post(review_route,json=changed,headers={'Idempotency-Key':'test-review'}).status_code==409
        print('REAL_PILOT_MP4='+str(root/video['relative_path']))
        print('REAL_PILOT_EVIDENCE='+str(root/'pilot-evidence.json'))
        print('REAL_PILOT_SHA256='+video['sha256'])
        print('REAL_PILOT_DURATION='+str(evidence['video']['duration_seconds']))
        print('REAL_PILOT_SCRIPT_WORDS='+str(sum(len(line['narracao'].split()) for line in
              json.loads((root/'plan.json').read_text(encoding='utf-8'))['roteiro']['linhas'])))
        print('REAL_PILOT_ALIGNMENT='+json.dumps(json.loads((root/'alignment-report.json').read_text(encoding='utf-8'))))
        print('REAL_PILOT_SYNC='+json.dumps([c for c in item['quality_report']['checks'] if c['category']=='sync']))
    with client_for(settings) as client:
        assert client.get('/v1/productions/'+item['id']).json()==item


def test_measured_cues_follow_factory_groups_frames_and_final_hold():
    from horus_backend.local_pilot import subtitle_words
    words = [{'text':str(i), 'section':1 if i < 4 else 2,
              'start':i*.21+.011, 'end':i*.21+.15, 'timing':'measured'} for i in range(7)]
    cues = subtitle_words(words)
    assert [c['text'] for c in cues] == ['0 1 2','3','4 5 6']
    assert cues[0]['start'] == .033
    assert cues[0]['end'] == cues[1]['start']
    assert cues[-1]['end'] == 2.033
    assert all(c['start'] < c['end'] for c in cues)


def test_factory_caption_rule_has_not_drifted():
    from horus_backend.local_pilot import FACTORY_CAPTION_SHA256
    source = os.environ.get('HORUS_PILOT_FACTORY')
    if not source:
        pytest.skip('Fábrica não configurada; detecção de deriva exige HORUS_PILOT_FACTORY.')
    path = Path(source)/'remotion/src/componentes/LegendaPalavra.tsx'
    if not path.is_file():
        pytest.skip('Fonte da fábrica indisponível para detectar deriva.')
    assert hashlib.sha256(path.read_bytes()).hexdigest() == FACTORY_CAPTION_SHA256


@pytest.mark.parametrize('case', ['missing_model','missing_extra'])
def test_alignment_fallback_explicit_without_model_or_extra(tmp_path, monkeypatch, case):
    from horus_backend.local_pilot import align_narration
    monkeypatch.setattr('importlib.util.find_spec', lambda name:None if case == 'missing_extra' else True)
    result = align_narration(tmp_path/'missing.wav','fala',sections=[],engine={},model_dir=tmp_path)
    assert result['executed'] is False and result['reason'] and result['document'] is None
    assert ('transcription' if case == 'missing_extra' else 'não encontrado') in result['reason']


@pytest.mark.parametrize('aligned', [False,True])
def test_prepare_selects_valid_alignment_before_render(tmp_path, monkeypatch, aligned):
    from horus_backend import local_pilot as pilot
    from horus_backend.speech_alignment import align_with_report
    from test_production_contract import build
    plan = build(mode='local_pilot').model_dump(mode='json')
    folder = tmp_path/'canais/demo/videos/fixture'
    folder.mkdir(parents=True)
    async def inputs(request):
        for section in json.loads(request.read_text(encoding='utf-8'))['sections']:
            with wave.open(str(folder/f"section-{section['n']}.wav"),'wb') as audio:
                audio.setparams((1,2,16000,0,'NONE','not compressed'))
                audio.writeframes(b''.join(struct.pack('<h',round(3000*math.sin(2*math.pi*440*i/16000))) for i in range(32000)))
            (folder/f"scene-{section['n']}.png").write_bytes(b'png')
            pilot.write(folder/f"scene-{section['n']}.layout.json",{})
        pilot.write(folder/'voice.json',{'culture':'pt-BR','voice':'fixture'})
    def alignment(wav, script_text, *, sections, engine, model_dir):
        asr = []
        if aligned:
            for text, section in zip(script_text.split('\n'),sections):
                tokens = text.split()
                asr.extend({'word':token,'start':section['start']+i*2/len(tokens),
                            'end':section['start']+(i+1)*2/len(tokens)} for i,token in enumerate(tokens))
        document, report = align_with_report(script_text,asr,sections=sections,engine=engine,
            narration_sha256=pilot.sha(wav),duration_seconds=pilot.wav_info(wav)[1])
        return {'executed':True,'reason':None,'document':document,'report':report,'asr_seconds':.01}
    monkeypatch.setattr(pilot,'synthesize',inputs)
    monkeypatch.setattr(pilot,'align_narration',alignment)
    events = []
    pilot.prepare(tmp_path,folder,plan,alignment_model=tmp_path,progress=events.append)
    assert events == ['align','subtitles']
    words = json.loads((tmp_path/'word-timings.json').read_text(encoding='utf-8'))
    evidence = json.loads((tmp_path/'pilot-measurements.json').read_text(encoding='utf-8'))
    assert words['source'] == 'forced_alignment'
    assert words['alignment']['match_rate'] == (1 if aligned else 0)
    assert all(w['timing'] == ('measured' if aligned else 'interpolated') for w in words['words'])
    assert evidence['alignment_method'] == ('forced_alignment' if aligned else 'measured_sections')
    factory = json.loads((folder/'alinhamento.json').read_text(encoding='utf-8'))
    if aligned:
        assert [w['inicio'] for w in factory['palavras']] == [w['start'] for w in words['words']]
        assert evidence['subtitles'] == pilot.subtitle_words(words['words'])
    else:
        assert factory['motor'] == 'windows_sapi_measured_sections_heuristic_subtitles'


@pytest.mark.parametrize('cancel', [False,True])
def test_alignment_environment_offline_flags_and_owned_cancellation(tmp_path, monkeypatch, cancel):
    import asyncio
    import sys
    from horus_backend import speech_alignment as alignment
    from horus_backend.processes import OwnedProcess
    model = tmp_path/'small'
    model.mkdir()
    (model/'model.bin').write_bytes(b'fixture')
    wav = tmp_path/'voice.wav'
    with wave.open(str(wav),'wb') as audio:
        audio.setparams((1,2,16000,0,'NONE','not compressed'))
        audio.writeframes(b'\0\0'*16000)
    monkeypatch.setattr('importlib.util.find_spec', lambda name:True)
    monkeypatch.setenv('HORUS_PRIVATE_TEST_SECRET','must-not-leak')
    original = OwnedProcess.start
    processes = []
    captured = []
    async def start(command, **kwargs):
        captured.append(kwargs['env'])
        command = [sys.executable,'-I','-c','import time; time.sleep(60)' if cancel else "print('{\"words\": []}')"]
        owned = await original(command, **kwargs)
        processes.append(owned)
        return owned
    monkeypatch.setattr(OwnedProcess,'start',start)
    async def run():
        task = asyncio.create_task(alignment.run_alignment_async(wav,'fala',sections=[{'section':1,'start':0,'end':1}],
            engine={'name':'fixture','voice':'fixture'},model_dir=tmp_path,
            environment={'SYSTEMROOT':os.environ.get('SYSTEMROOT',''),'HF_HUB_OFFLINE':'0'},timeout=10))
        if cancel:
            while not processes:
                await asyncio.sleep(.01)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert processes[0].process.returncode is not None
        else:
            assert (await task)['executed']
    asyncio.run(run())
    assert 'HORUS_PRIVATE_TEST_SECRET' not in captured[0]
    assert set(captured[0]) == {'SYSTEMROOT','HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE',
        'HF_HUB_DISABLE_TELEMETRY','HF_HUB_DISABLE_SYMLINKS_WARNING','PYTHONIOENCODING'}
    assert all(captured[0][key] == '1' for key in ('HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE','HF_HUB_DISABLE_TELEMETRY'))


@pytest.mark.parametrize('change', ['early','hold','overlap','video','next_section','cross_section'])
def test_caption_hold_negative_rules(change):
    from horus_backend.pilot_quality import caption_holds
    words = [{'text':'uma','start':1.,'end':1.2,'section':1},
             {'text':'outra','start':2.,'end':2.2,'section':2}]
    cues = [{'text':'uma','start':1.,'end':1.6}, {'text':'outra','start':2.,'end':2.8}]
    duration = 3.
    if change == 'early': cues[0]['start'] = .8
    if change == 'hold': cues[0]['end'] = 1.9
    if change == 'overlap': cues[0]['end'] = 2.1
    if change == 'video': duration = 2.5
    if change == 'next_section': words[1]['start'] = 1.5
    if change == 'cross_section': cues = [{'text':'uma outra','start':1.,'end':2.8}]
    assert caption_holds(cues,words,duration,[])['errors']


def test_caption_hold_reports_measured_maintenance():
    from horus_backend.pilot_quality import caption_holds
    result = caption_holds([{'text':'fala','start':1.,'end':1.8}],
                           [{'text':'fala','start':1.,'end':1.2,'section':1}],2.,[])
    assert not result['errors'] and result['hold_seconds'] == [.6]


@pytest.mark.parametrize('invalid', [None, 'missing', 'estimated', 'below_threshold', 'hash'])
def test_forced_evidence_requires_valid_acoustic_contract(invalid):
    from test_pilot_quality import good
    from horus_backend.pilot_quality import validate_pilot_evidence
    from horus_backend.speech_alignment import align_script
    evidence = good()
    evidence['alignment_method'] = 'forced_alignment'
    words = align_script('Primeira fala.\nSegunda fala.',
        [{'word':t,'start':a,'end':b} for t,a,b in [
            ('Primeira',.2,1.),('fala',1.,3.8),('Segunda',4.1,6.),('fala',6.,9.8)]],
        sections=[{'section':1,'start':0,'end':4.},{'section':2,'start':4.,'end':10.}],
        narration_sha256=evidence['narration']['sha256'],duration_seconds=10.,
        engine={'name':'fixture','voice':'fixture'})
    if invalid == 'missing': words = None
    if invalid == 'estimated':
        words['source'] = 'estimated'
        words.pop('alignment')
        for word in words['words']: word.pop('timing')
    if invalid == 'below_threshold':
        words['words'][0]['timing'] = 'interpolated'
        words['alignment'].update(matched_words=3,interpolated_words=1,match_rate=.75,
                                  longest_interpolated_seconds=.8)
    if invalid == 'hash': words['narration_sha256'] = 'f'*64
    result = validate_pilot_evidence(evidence,word_timings=words)
    method = next(c for c in result['checks'] if c['id']=='alignment_method')
    assert method['status'] == ('pass' if invalid is None else 'fail')


def test_qc_measures_words_even_when_factory_hold_fails(tmp_path):
    from test_av_quality import build, word_doc, stamp
    from horus_backend import av_quality as qc
    from horus_backend.local_pilot import write
    root, evidence = build(tmp_path,words=word_doc())
    words = json.loads((root/'word-timings.json').read_text(encoding='utf-8'))
    words['source'] = 'forced_alignment'
    words['alignment'] = {'method':'asr_sequence_match','asr_engine':'fixture','matched_words':18,
        'interpolated_words':0,'match_rate':1.,'longest_interpolated_seconds':0.}
    for word in words['words']: word['timing'] = 'measured'
    write(root/'word-timings.json',words)
    evidence['alignment_method'] = 'forced_alignment'
    # A cue da primeira seção mantém texto por mais de 0,6 s: falha explícita,
    # mas hashes, WAV, cobertura e desvio acústico continuam sendo medidos.
    evidence['subtitles'][0]['end'] = 1.9
    write(root/'pilot-evidence.json',evidence)
    folder = root/'canais/demo/videos/fixture'
    (folder/'fixture.srt').write_text('\n'.join(
        f"{i}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}\n"
        for i,c in enumerate(evidence['subtitles'],1)),encoding='utf-8')
    report = qc.run_quality(root,production_id='fixture')
    sync = next(c for c in report['checks'] if c['id']=='subtitles_vs_words')
    assert sync['method']=='measured' and sync['measured']['max_deviation_seconds'] > .6
    assert next(c for c in report['checks'] if c['id']=='evidence_manifest')['status']=='fail'
    assert next(c for c in report['checks'] if c['id']=='audio_clipping')['status']=='pass'
