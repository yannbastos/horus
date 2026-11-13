"""Piloto offline Windows: SAPI isolado, tempos de WAV e evidências do render real.

Não faz alinhamento de palavras: distribui legendas dentro de seções medidas.
Não concede licença à voz do sistema nem autoriza publicação.
"""
from __future__ import annotations

import asyncio
from array import array
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import wave

from .processes import OwnedProcess

DISCLOSURE = 'Narração sintética local Windows SAPI (pt-BR); não é voz humana ou clonada; licença não verificada.'


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


async def synthesize(input_path):
    if os.name != 'nt':
        raise ValueError('Piloto requer Windows SAPI offline com voz pt-BR instalada.')
    env = {k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'}}
    owned = await OwnedProcess.start([sys.executable, str(Path(__file__).with_name('local_pilot_windows.py')), str(input_path)], env=env, cwd=input_path.parent)
    try:
        # Limite explícito de geração, nunca cortar texto para caber em estimativa.
        stdout, stderr = await asyncio.wait_for(owned.process.communicate(), timeout=1200)
        if owned.process.returncode:
            raise ValueError('SAPI/cenas locais indisponíveis; confirme voz offline pt-BR e política de scripts local, sem bypass.')
    finally:
        await owned.stop()
        owned.close()


def wav_info(path):
    with wave.open(str(path), 'rb') as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getcomptype() != 'NONE':
            raise ValueError('SAPI deve produzir WAV PCM mono de 16 bits.')
        frames, rate = audio.getnframes(), audio.getframerate()
        duration = frames / rate
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError('WAV sem duração positiva.')
        return audio.getparams(), duration


def signal_measurements(path):
    """Distingue silêncio/tom M4 de 220 Hz; não reconhece palavras nem atesta qualidade vocal."""
    with wave.open(str(path), 'rb') as audio:
        rate = audio.getframerate()
        samples = array('h', audio.readframes(audio.getnframes()))
    if sys.byteorder != 'little':
        samples.byteswap()
    size = min(2048, len(samples))
    if not size:
        raise ValueError('Áudio vazio.')
    cosine = [math.cos(2*math.pi*220*i/rate) for i in range(size)]
    sine = [math.sin(2*math.pi*220*i/rate) for i in range(size)]
    total_energy = tone_energy = 0.0
    count = min(64, max(1, len(samples)//size))
    for index in range(count):
        start = round((len(samples)-size)*index/max(1,count-1))
        window = samples[start:start+size]
        total_energy += sum(value*value for value in window)
        real = sum(value*coefficient for value,coefficient in zip(window,cosine))
        imaginary = sum(value*coefficient for value,coefficient in zip(window,sine))
        tone_energy += 2*(real*real+imaginary*imaginary)/size
    fraction = tone_energy/total_energy if total_energy else 0.0
    rms = math.sqrt(total_energy/(count*size))/32768
    if rms < .001 or fraction > .8:
        raise ValueError('Narração silenciosa ou compatível com tom M4 de 220 Hz; piloto recusado.')
    return {'sampled_windows':count,'window_samples':size,'rms_fraction':rms,
            'energy_fraction_at_220hz':fraction,
            'scope':'Teste de energia/silêncio e tom 220 Hz; não é reconhecimento de fala ou alinhamento.'}


def subtitle_sections(text, start, end):
    """Grupos curtos com tempo proporcional; só os limites da seção são medidos."""
    words = re.sub(r'[\x00-\x1f\x7f\u2028\u2029]+', ' ', text).replace('-->', '->').split()
    if not words or end <= start:
        raise ValueError('Seção sem texto ou duração.')
    return [{'start':start + (end-start)*i/len(words),
             'end':start + (end-start)*min(i+3,len(words))/len(words),
             'text':' '.join(words[i:i+3])} for i in range(0,len(words),3)]


def prepare(root, folder, plan):
    """Produz insumos medidos, preservando plan.json aprovado como estimativa original."""
    sections = [{'n':line['n'], 'text':line['narracao'], 'heading':scene['heading'],
                 'summary':' '.join(line['narracao'].split()[:32])}
                for scene,line in zip(plan['scenes'],plan['roteiro']['linhas'])]
    if any(re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', section['text']) for section in sections):
        raise ValueError('Texto contém controle incompatível com fala integral SAPI.')
    request = root / 'sapi-input.json'
    write(request, {'folder':str(folder), 'sections':sections})
    asyncio.run(synthesize(request))
    voice = json.loads((folder/'voice.json').read_text(encoding='utf-8-sig'))
    if voice['culture'] != 'pt-BR' or not voice['voice']:
        raise ValueError('Voz medida não é pt-BR.')
    cursor, lines, subtitles, words, assets, evidence_assets, scenes = 0.0, [], [], [], [], [], []
    generated = datetime.now(timezone.utc).isoformat()
    paths = []
    def add_asset(path, asset_id, origin, license, attribution):
        evidence_assets.append({'id':asset_id,'relative_path':path.relative_to(root).as_posix(),
            'sha256':sha(path),'origin':origin,'license':license,'attribution':attribution,'generated_at':generated})
    params = None
    with wave.open(str(folder/'fixture.wav'), 'wb') as combined:
        for section, scene in zip(sections,plan['scenes']):
            n = section['n']
            path = folder/f'section-{n}.wav'
            current, duration = wav_info(path)
            if params is None:
                params = current
                combined.setparams(params)
            elif current[:3] != params[:3]:
                raise ValueError('Formatos WAV por seção incompatíveis.')
            with wave.open(str(path),'rb') as audio:
                while data := audio.readframes(65536):
                    combined.writeframes(data)
            end = cursor + duration
            if end > 600:
                raise ValueError('Fala medida excede limite de 600 segundos; revise roteiro explicitamente.')
            lines.append({'n':n,'inicio':cursor,'fim':end})
            scenes.append({'id':scene['id'],'start':cursor,'end':end,'asset_id':f'scene-{n}'})
            subtitles.extend(subtitle_sections(section['text'],cursor,end))
            tokens = section['text'].split()
            words.extend({'texto':token,'inicio':cursor+duration*i/len(tokens),
                          'fim':cursor+duration*(i+1)/len(tokens),'linha':n} for i,token in enumerate(tokens))
            image = folder/f'scene-{n}.png'
            paths.append({'kind':'manifest','relative_path':image.with_suffix('.layout.json').relative_to(root).as_posix()})
            add_asset(image,f'scene-{n}','original_local','original','Cena informativa original gerada localmente a partir do roteiro aprovado.')
            add_asset(path,f'section-{n}','system_voice','unverified',voice['voice']+'; '+DISCLOSURE)
            assets.append({'linha':n,'tipo':'imagem','arquivo':image.name,'fonte':'original_local',
                'licenca':'original; piloto não publicável','exige_credito':False,'publicavel':False})
            paths.extend([{'kind':'scene','relative_path':image.relative_to(root).as_posix()},
                          {'kind':'audio','relative_path':path.relative_to(root).as_posix()}])
            cursor = end
    _, measured = wav_info(folder/'fixture.wav')
    if abs(cursor-measured) > .001:
        raise ValueError('Duração concatenada diverge das seções.')
    write(root/'narration-signal.json',signal_measurements(folder/'fixture.wav'))
    paths.append({'kind':'manifest','relative_path':'narration-signal.json'})
    assets.append({'tipo':'narracao','arquivo':'fixture.wav','fonte':'windows_sapi_local_tts',
        'licenca':'não verificada; exige aceite humano','exige_credito':False,'publicavel':False})
    add_asset(folder/'fixture.wav','narration','system_voice','unverified',voice['voice']+'; '+DISCLOSURE)
    write(folder/'manifesto_assets.json',{'assets':assets})
    write(folder/'alinhamento.json',{'audio':'fixture.wav','duracao_audio':measured,
        'motor':'windows_sapi_measured_sections_heuristic_subtitles','palavras':words,'linhas':lines})
    from .production_contract import _timestamp
    (folder/'fixture.srt').write_text('\n'.join(f"{i}\n{_timestamp(s['start'])} --> {_timestamp(s['end'])}\n{s['text']}\n"
        for i,s in enumerate(subtitles,1)),encoding='utf-8')
    for name,kind in [('fixture.wav','audio'),('voice.json','manifest'),('manifesto_assets.json','manifest'),
                      ('alinhamento.json','manifest'),('fixture.srt','subtitles')]:
        paths.append({'kind':kind,'relative_path':(folder/name).relative_to(root).as_posix()})
    write(root/'pilot-measurements.json',{'schema_version':1,'demo_only':True,
        'narration':{'kind':'local_tts','engine':'windows_sapi','voice':voice['voice'],
                     'duration_seconds':measured,'sha256':sha(folder/'fixture.wav')},
        'scenes':scenes,'subtitles':subtitles,'assets':evidence_assets,'alignment_method':'measured_sections'})
    paths.append({'kind':'manifest','relative_path':'pilot-measurements.json'})
    # A fonte é deliberadamente estimated: somente as seções foram medidas.
    word_document = {'schema_version':1,'narration_sha256':sha(folder/'fixture.wav'),
        'duration_seconds':measured,'source':'estimated',
        'engine':{'name':'windows_sapi_measured_sections_heuristic_subtitles','voice':voice['voice']},'words':[]}
    offset = 0
    for section, line in zip(sections,lines):
        tokens = list(re.finditer(r'\S+',section['text']))
        for index, match in enumerate(tokens):
            duration = line['fim']-line['inicio']
            word_document['words'].append({'index':len(word_document['words']),'text':match.group(),
                'section':section['n'],'start':round(line['inicio']+duration*index/len(tokens),3),
                'end':round(line['inicio']+duration*(index+1)/len(tokens),3),
                'char_offset':offset+match.start(),'char_length':len(match.group())})
        offset += len(section['text'])+1  # roteiro concatenado com uma quebra entre seções
    from .media_contracts import validate_word_timings, validate_asset_provenance
    checked = validate_word_timings(word_document,narration_sha256=word_document['narration_sha256'],
        duration_seconds=measured,script_text='\n'.join(s['text'] for s in sections),
        sections=[{'section':s['n'],'start':l['inicio'],'end':l['fim']} for s,l in zip(sections,lines)])
    if not checked['ok']:
        raise ValueError('Contrato de palavras estimadas inválido.')
    write(root/'word-timings.json',checked['value'])
    provenance = {'schema_version':1,'assets':[
        {'asset_id':a['id'],'relative_path':a['relative_path'],'sha256':a['sha256'],
         'kind':'image' if a['origin']=='original_local' else 'voice','origin':a['origin'],
         'source_url':None,'author':None,
         'license':{'id':'original' if a['origin']=='original_local' else None,
                    'name':None,'url':None,'commercial_use':'unknown','attribution_required':None,
                    'verified_by':None,'verified_at':None},
         'status':'unverified','notes':a['attribution']} for a in evidence_assets]}
    checked = validate_asset_provenance(provenance,artifacts={a['relative_path']:a['sha256'] for a in evidence_assets})
    if not checked['ok']:
        raise ValueError('Contrato de proveniência inválido.')
    write(root/'asset-provenance.json',checked['value'])
    paths.extend({'kind':'manifest','relative_path':name} for name in ('word-timings.json','asset-provenance.json'))
    return paths


def finalize(root, folder):
    """Chamado somente depois de decodificação, hash e auditoria do renderer."""
    evidence = json.loads((root/'pilot-measurements.json').read_text(encoding='utf-8'))
    validation = json.loads((folder/'render/validation.json').read_text(encoding='utf-8'))
    stream = validation['stream']
    if not (folder/'render/short-rascunho.mp4').is_file():
        raise ValueError('Evidence exige MP4 real.')
    write(folder/'render/narration-signal.json', signal_measurements(folder/'render/audio-review.wav'))
    evidence['video'] = {'duration_seconds':float(stream['duration']),'width':int(stream['width']),
        'height':int(stream['height']),'frames':int(stream['nb_read_frames'])}
    write(root/'pilot-evidence.json',evidence)
    return {'narration_kind':'local_tts','narration_disclosure':DISCLOSURE,'alignment_method':'measured_sections'}


def confirmed_metadata(root, artifacts):
    """Flags do serviço derivam dos arquivos registrados, não do modo ou de booleanos do worker.

    Verificação de integração mínima; o QC editorial/contrato completo pertence a pilot_quality.
    """
    registered = {item['relative_path']:item for item in artifacts}
    evidence_item = registered.get('pilot-evidence.json')
    if not evidence_item or evidence_item['kind'] != 'manifest':
        raise ValueError('Piloto sem manifesto de evidência registrado.')
    evidence = json.loads((root/'pilot-evidence.json').read_text(encoding='utf-8'))
    narration = evidence['narration']
    if (narration['kind'] != 'local_tts' or narration['engine'] != 'windows_sapi'
            or not isinstance(narration['voice'],str) or not narration['voice'].strip()
            or evidence['alignment_method'] != 'measured_sections' or evidence['demo_only'] is not True):
        raise ValueError('Narração local não comprovada.')
    audio_asset = next(item for item in evidence['assets'] if item['sha256']==narration['sha256'])
    audio = registered.get(audio_asset['relative_path'])
    if (not audio or audio['kind'] != 'audio' or audio['sha256'] != narration['sha256']
            or audio_asset['origin'] != 'system_voice' or audio_asset['license'] != 'unverified'):
        raise ValueError('WAV ou proveniência da narração não correspondem à evidência.')
    _, duration = wav_info(root/audio['relative_path'])
    expected = narration['duration_seconds']
    if type(expected) not in (float,int) or not math.isfinite(expected) or abs(expected-duration) > .001:
        raise ValueError('Duração da narração não corresponde ao WAV registrado.')
    if not any(item['kind']=='video' for item in artifacts):
        raise ValueError('Piloto sem vídeo registrado.')
    return {'narration_kind':'local_tts','narration_disclosure':DISCLOSURE,'alignment_method':'measured_sections'}


def quality_report(root, folder, production_id, *, ffmpeg=None, ffprobe=None):
    """QC físico dentro do worker já possuído; subprocessos seguem sua árvore."""
    from .av_quality import run_quality
    from .media_contracts import validate_quality_report
    report = run_quality(root,production_id=production_id,ffmpeg=ffmpeg,ffprobe=ffprobe)
    words = json.loads((root/'word-timings.json').read_text(encoding='utf-8'))
    checked = validate_quality_report(report,video_sha256=sha(folder/'render/short-rascunho.mp4'),
        production_id=production_id,word_timings_source=words['source'])
    if not checked['ok']:
        raise ValueError('Contrato do relatório QC inválido: '+str(checked['errors']))
    write(root/'quality-report.json',checked['value'])


def registered_json(root, artifacts, relative):
    """Só lê JSON confinado e com o hash registrado; inválido/ausente não é evidência."""
    from .production import confined
    from .workflows import WorkflowConflict
    try:
        item = next(a for a in artifacts if a['relative_path']==relative and a['kind'] in {'manifest','plan'})
        path = confined(root,relative)
        if path.stat().st_size > 16*1024*1024 or sha(path) != item['sha256']:
            return None
        return json.loads(path.read_text(encoding='utf-8'))
    except (StopIteration, OSError, ValueError, TypeError, KeyError, WorkflowConflict):
        return None


def confirmed_media(root, artifacts, production_id):
    """Deriva metadados dos contratos registrados, nunca de flags devolvidas pelo worker."""
    from .media_contracts import validate_quality_report, validate_word_timings, validate_asset_provenance
    prefix = 'canais/demo/videos/fixture/'
    inputs = {a['relative_path']:a['sha256'] for a in artifacts if
              re.fullmatch(re.escape(prefix)+r'(?:scene-\d+\.png|section-\d+\.wav|fixture\.wav)',a['relative_path'])}
    provenance = validate_asset_provenance(registered_json(root,artifacts,'asset-provenance.json'),artifacts=inputs)
    word_data = registered_json(root,artifacts,'word-timings.json')
    word_result = validate_word_timings(word_data)
    # Só existe caminho para true quando os fatos físicos e o roteiro também conferem.
    if word_result['ok'] and word_data['source'] != 'estimated':
        try:
            from .production import confined
            plan = registered_json(root,artifacts,'plan.json')
            lines = plan['roteiro']['linhas']
            audio = confined(root,prefix+'fixture.wav')
            measured_sections, cursor = [], 0.0
            for line in lines:
                path = confined(root,prefix+f"section-{line['n']}.wav")
                if sha(path) != inputs[path.relative_to(root).as_posix()]:
                    raise ValueError('Hash da seção divergente.')
                duration = wav_info(path)[1]
                measured_sections.append({'section':line['n'],'start':cursor,'end':cursor+duration})
                cursor += duration
            audio_hash = sha(audio)
            if audio_hash != inputs[prefix+'fixture.wav']:
                raise ValueError('Hash da narração divergente.')
            duration = wav_info(audio)[1]
            if abs(cursor-duration) > .001:
                raise ValueError('Duração concatenada diverge das seções medidas.')
            word_result = validate_word_timings(word_data,narration_sha256=audio_hash,
                duration_seconds=duration,script_text='\n'.join(l['narracao'] for l in lines),
                sections=measured_sections)
        except (OSError, ValueError, TypeError, KeyError, wave.Error, EOFError):
            word_result = {'speech_aligned':False}
    video = next((a for a in artifacts if a['kind']=='video'),None)
    quality = validate_quality_report(registered_json(root,artifacts,'quality-report.json'),
        video_sha256=video['sha256'] if video else None,production_id=production_id,
        word_timings_source=word_data.get('source') if isinstance(word_data,dict) else None)
    return {'quality_report':quality['value'] if quality['ok'] and video else None,
            'speech_aligned':word_result.get('speech_aligned',False),
            'asset_provenance':provenance['value'] if provenance['ok'] else None}
