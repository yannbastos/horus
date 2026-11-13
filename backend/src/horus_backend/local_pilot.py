"""Piloto offline Windows: SAPI isolado, tempos de WAV e evidências do render real.

Alinha palavras por ASR offline quando configurado; fallback por seções medidas.
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
import shutil
import sys
import time
import wave

from .processes import OwnedProcess
from .narration.providers import PRODUCTION_ORIGINS

def narration_disclosure(provider, voice):
    return f'Narração sintética local {provider}; voz {voice}; não é voz humana ou clonada; licença não verificada.'


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


async def synthesize(input_path):
    if os.name != 'nt':
        raise ValueError('Piloto requer Windows SAPI offline com voz pt-BR instalada.')
    env = {k:v for k,v in os.environ.items() if k.upper() in {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'}}
    request = json.loads(input_path.read_text(encoding='utf-8'))
    if request.get('narration'):
        for name in ('HORUS_PIPER_EXECUTABLE', 'HORUS_PIPER_MODELS', 'HORUS_KOKORO_PYTHON', 'HORUS_KOKORO_MODEL_DIR'):
            if os.environ.get(name): env[name] = os.environ[name]
        # Módulo do mesmo backend; PYTHONPATH não vem do operador.
        env['PYTHONPATH'] = str(Path(__file__).resolve().parents[1])
        command = [sys.executable, '-m', 'horus_backend.narration.production_worker', str(input_path)]
    else:
        command = [sys.executable, str(Path(__file__).with_name('local_pilot_windows.py')), str(input_path)]
    owned = await OwnedProcess.start(command, env=env, cwd=input_path.parent)
    try:
        # Limite explícito de geração, nunca cortar texto para caber em estimativa.
        stdout, stderr = await asyncio.wait_for(owned.process.communicate(), timeout=1200)
        if owned.process.returncode:
            error_path = input_path.with_suffix('.error.json')
            if error_path.is_file():
                raise ValueError(json.loads(error_path.read_text(encoding='utf-8'))['error'])
            raise ValueError('SAPI/cenas locais indisponíveis; confirme voz offline pt-BR e política de scripts local, sem bypass.')
    finally:
        await owned.stop()
        owned.close()


def wav_info(path):
    with wave.open(str(path), 'rb') as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getcomptype() != 'NONE':
            raise ValueError('Narração deve produzir WAV PCM mono de 16 bits.')
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


# Hash da fonte independente usada para derivar a regra visual; não modifica a fábrica.
FACTORY_CAPTION_SHA256 = 'aa4688a4affa70d607ae246ebaf47fe01dae102c604ad050fa87d886b4d04e2c'


def subtitle_words(words, fps=30):
    """Mesmos grupos/frames do LegendaPalavra.tsx (3 palavras, sem atravessar linhas).

    O grupo permanece até o próximo começar, inclusive nas pausas. Só o último
    desaparece 0,6 s após a última palavra. SRT usa intervalos de frames semiabertos.
    """
    groups = []
    for word in words:
        if not groups or len(groups[-1]) == 3 or groups[-1][0]['section'] != word['section']:
            groups.append([])
        groups[-1].append(word)
    cues = []
    for i, group in enumerate(groups):
        first = math.ceil(group[0]['start'] * fps) / fps
        end = (math.ceil(groups[i+1][0]['start'] * fps) / fps if i+1 < len(groups)
               else (math.floor(group[-1]['end'] * fps + .6 * fps) + 1) / fps)
        if end <= first:
            raise ValueError('Grupo de legenda menor que um frame; renderer não pode exibir o texto integral.')
        cues.append({'start':round(first,3), 'end':round(end,3), 'text':' '.join(w['text'] for w in group)})
    return cues


def measured_subtitle_words(words):
    """Cues com bordas acústicas medidas; as pausas entre grupos ficam sem texto."""
    groups = []
    for word in words:
        if not groups or len(groups[-1]) == 3 or groups[-1][0]['section'] != word['section']:
            groups.append([])
        groups[-1].append(word)
    return [{'start':round(group[0]['start'],3), 'end':round(group[-1]['end'],3),
             'text':' '.join(w['text'] for w in group)} for group in groups]


def video_name(plan):
    return 'short.mp4' if plan.get('render_quality','draft') == 'final' else 'short-rascunho.mp4'


async def owned_tool(command, *, cwd, timeout=1800):
    """Execução local com posse, ambiente mínimo, timeout e encerramento da árvore."""
    env = {k:v for k,v in os.environ.items() if k.upper() in
           {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'}}
    owned = await OwnedProcess.start([str(arg) for arg in command], cwd=cwd, env=env)
    try:
        stdout, stderr = await asyncio.wait_for(owned.process.communicate(), timeout=timeout)
        if owned.process.returncode:
            raise ValueError('Ferramenta local falhou: '+stderr.decode('utf-8',errors='replace')[-2000:])
        return stdout + stderr
    finally:
        await owned.stop()
        owned.close()


def configure_caption_overlay(root, folder):
    executable = os.environ.get('HORUS_FFMPEG')
    if not executable:
        return None  # fallback fiel à regra da fábrica, inclusive sua falha temporal de QC
    executable = Path(executable).resolve(strict=True)
    filters = asyncio.run(owned_tool([executable,'-hide_banner','-filters'],cwd=root,timeout=30))
    if not re.search(rb'\bsubtitles\s', filters):
        raise ValueError('HORUS_FFMPEG precisa do filtro subtitles/libass preparado fora do job.')
    configured_font = os.environ.get('HORUS_SUBTITLE_FONT')
    local = next((p/'frontend/public/fonts/ArchivoExpanded-SemiBold.ttf' for p in Path(__file__).resolve().parents
                  if (p/'frontend/public/fonts/ArchivoExpanded-SemiBold.ttf').is_file()),None)
    font = Path(configured_font) if configured_font else local
    if font is None:
        font = Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts/ariblk.ttf'
    font = font.resolve(strict=True)
    if font.name not in {'ArchivoExpanded-SemiBold.ttf','ariblk.ttf'}:
        raise ValueError('Fonte sem metadados locais conhecidos; configure ArchivoExpanded-SemiBold.ttf ou ariblk.ttf.')
    fonts = folder/'fonts'
    fonts.mkdir()
    copied = fonts/font.name
    shutil.copy2(font,copied)
    ofl = font.name == 'ArchivoExpanded-SemiBold.ttf'
    return {'method':'ffmpeg_libass_srt', 'executable':str(executable), 'font_path':str(copied),
            'font_source':str(font), 'font_sha256':sha(copied),
            'font_family':'Archivo Expanded' if ofl else 'Arial Black',
            'font_author':'Omnibus-Type' if ofl else 'Microsoft Corporation',
            'font_source_url':'https://github.com/Omnibus-Type/Archivo' if ofl else 'https://learn.microsoft.com/en-us/typography/font-list/arial-black',
            'font_license':{'id':'OFL-1.1' if ofl else 'Microsoft-Windows-font',
                'name':'SIL Open Font License 1.1' if ofl else 'Microsoft Windows supplied font; licença não verificada',
                'url':'https://openfontlicense.org/open-font-license-official-text/' if ofl else 'https://learn.microsoft.com/en-us/typography/fonts/font-faq',
                'commercial_use':'unknown','attribution_required':None,'verified_by':None,'verified_at':None}}


def overlay_subtitles(root, folder, video, plan):
    config_path = root/'caption-overlay.json'
    if not config_path.is_file():
        return None
    config = json.loads(config_path.read_text(encoding='utf-8'))
    original = video.with_name(video.stem+'-without-subtitles.mp4')
    video.rename(original)
    # Nomes relativos fixos evitam escapes de drive/aspas na linguagem de filtros.
    style = ('FontName='+config['font_family']+',FontSize=12,Bold=-1,PrimaryColour=&H00FFFFFF,'
             'OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=1,Alignment=2,'
             'MarginL=23,MarginR=58,MarginV=86')
    command = [config['executable'],'-hide_banner','-v','error','-i',str(original),
        '-map','0:v:0','-map','0:a:0','-vf',"subtitles=fixture.srt:fontsdir=fonts:force_style='"+style+"'",
        '-c:v','libx264','-crf','20' if plan.get('render_quality')=='final' else '30',
        '-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',str(video)]
    started = time.monotonic()
    asyncio.run(owned_tool(command,cwd=folder))
    result = {**config,'srt_sha256':sha(folder/'fixture.srt'),
              'alignment_sha256':sha(folder/'alinhamento.json'),
              'intermediate_sha256':sha(original),'final_sha256':sha(video),
              'overlay_seconds':round(time.monotonic()-started,3),
              'audio':'stream_copy','video_encodes_after_factory':1,
              'style':style,'timing':'SRT medido; quantização libass/frame sem estender pausas'}
    write(folder/'render/caption-overlay.json', result)
    return result


def align_narration(wav, script_text, *, sections, engine, model_dir):
    """Alinhamento antes do render, timeout/posse no módulo ASR; nenhum download."""
    if not model_dir:
        return {'executed':False, 'reason':'HORUS_ALIGNMENT_MODEL não configurado',
                'document':None, 'report':None, 'asr_seconds':None}
    from .speech_alignment import run_alignment
    environment = {k:v for k,v in os.environ.items() if k.upper() in
                   {'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'}}
    return run_alignment(wav, script_text, sections=sections, engine=engine,
                         model_dir=Path(model_dir), environment=environment, timeout=900)


def prepare(root, folder, plan, *, alignment_model=None, progress=None):
    """Produz insumos medidos, preservando plan.json aprovado como estimativa original."""
    sections = [{'n':line['n'], 'text':line['narracao'], 'heading':scene['heading'],
                 'summary':' '.join(line['narracao'].split()[:32])}
                for scene,line in zip(plan['scenes'],plan['roteiro']['linhas'])]
    if any(re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', section['text']) for section in sections):
        raise ValueError('Texto contém controle incompatível com fala integral SAPI.')
    request = root / 'sapi-input.json'
    size = [1080,1920] if plan.get('render_quality','draft') == 'final' else [540,960]
    selection = {k: plan['audio'][k] for k in ('provider','voice_id') if plan.get('audio',{}).get(k)}
    write(request, {'folder':str(folder), 'sections':sections, 'scene_size':size, 'narration':selection})
    asyncio.run(synthesize(request))
    overlay = configure_caption_overlay(root,folder)
    voice = json.loads((folder/'voice.json').read_text(encoding='utf-8-sig'))
    if not voice['voice']:
        raise ValueError('Voz medida ausente.')
    engine = voice.get('engine', 'windows_sapi')
    origin = voice.get('origin', 'system_voice')
    if selection and (engine != selection['provider'] or voice.get('voice_id') != selection['voice_id']):
        raise ValueError('Síntese diverge do provedor/voz registrados no plano.')
    synthesis = {'engine':engine, 'voice':voice['voice'], 'voice_id':voice.get('voice_id'),
                 'origin':origin, 'model':voice.get('model')}
    attribution = engine + '; ' + voice['voice'] + '; licença não verificada.'
    cursor, lines, subtitles, words, assets, evidence_assets, scenes = 0.0, [], [], [], [], [], []
    generated = datetime.now(timezone.utc).isoformat()
    paths = []
    def add_asset(path, asset_id, origin, license, attribution):
        evidence_assets.append({'id':asset_id,'relative_path':path.relative_to(root).as_posix(),
            'sha256':sha(path),'origin':origin,'license':license,'attribution':attribution,'generated_at':generated})
        if origin in {'system_voice','local_tts_model'}:
            evidence_assets[-1]['narration'] = synthesis
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
            add_asset(path,f'section-{n}',origin,'unverified',attribution)
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
    assets.append({'tipo':'narracao','arquivo':'fixture.wav','fonte':engine+'_local_tts',
        'licenca':'não verificada; exige aceite humano','exige_credito':False,'publicavel':False})
    add_asset(folder/'fixture.wav','narration',origin,'unverified',attribution)
    write(folder/'manifesto_assets.json',{'assets':assets})
    write(folder/'alinhamento.json',{'audio':'fixture.wav','duracao_audio':measured,
        'motor':engine+'_measured_sections_heuristic_subtitles','palavras':words,'linhas':lines})
    from .production_contract import _timestamp
    (folder/'fixture.srt').write_text('\n'.join(f"{i}\n{_timestamp(s['start'])} --> {_timestamp(s['end'])}\n{s['text']}\n"
        for i,s in enumerate(subtitles,1)),encoding='utf-8')
    for name,kind in [('fixture.wav','audio'),('voice.json','manifest'),('manifesto_assets.json','manifest'),
                      ('alinhamento.json','manifest'),('fixture.srt','subtitles')]:
        paths.append({'kind':kind,'relative_path':(folder/name).relative_to(root).as_posix()})
    write(root/'pilot-measurements.json',{'schema_version':1,'demo_only':True,
        'narration':{'kind':'local_tts','engine':engine,'voice':voice['voice'],
                     'voice_id':voice.get('voice_id'), 'origin':origin, 'model':voice.get('model'),
                     'duration_seconds':measured,'sha256':sha(folder/'fixture.wav')},
        'scenes':scenes,'subtitles':subtitles,'assets':evidence_assets,'alignment_method':'measured_sections'})
    paths.append({'kind':'manifest','relative_path':'pilot-measurements.json'})
    # A fonte é deliberadamente estimated: somente as seções foram medidas.
    word_document = {'schema_version':1,'narration_sha256':sha(folder/'fixture.wav'),
        'duration_seconds':measured,'source':'estimated',
        'engine':{'name':engine+'_measured_sections_heuristic_subtitles','voice':voice['voice']},'words':[]}
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
    if progress:
        progress('align')
    alignment = align_narration(folder/'fixture.wav', '\n'.join(s['text'] for s in sections),
        sections=[{'section':s['n'],'start':l['inicio'],'end':l['fim']} for s,l in zip(sections,lines)],
        engine=word_document['engine'], model_dir=alignment_model)
    if alignment['executed']:
        checked = validate_word_timings(alignment['document'], narration_sha256=word_document['narration_sha256'],
            duration_seconds=measured, script_text='\n'.join(s['text'] for s in sections),
            sections=[{'section':s['n'],'start':l['inicio'],'end':l['fim']} for s,l in zip(sections,lines)])
        if not checked['ok']:
            raise ValueError('Contrato do alinhamento acústico inválido.')
    write(root/'alignment-report.json', {k:v for k,v in alignment.items() if k != 'document'})
    paths.append({'kind':'manifest','relative_path':'alignment-report.json'})
    write(root/'word-timings.json',checked['value'])
    if checked['speech_aligned']:
        subtitles = (measured_subtitle_words if overlay else subtitle_words)(checked['value']['words'])
        write(folder/'alinhamento.json', {'audio':'fixture.wav','duracao_audio':measured,
            'motor':'forced_alignment','palavras':[
                {'texto':w['text'],'inicio':w['start'],'fim':w['end'],'linha':w['section']}
                for w in checked['value']['words']], 'linhas':lines})
        (folder/'fixture.srt').write_text('\n'.join(
            f"{i}\n{_timestamp(c['start'])} --> {_timestamp(c['end'])}\n{c['text']}\n"
            for i,c in enumerate(subtitles,1)), encoding='utf-8')
        evidence = json.loads((root/'pilot-measurements.json').read_text(encoding='utf-8'))
        evidence.update(subtitles=subtitles, alignment_method='forced_alignment')
        write(root/'pilot-measurements.json', evidence)
    if progress:
        progress('subtitles')
    provenance = {'schema_version':1,'assets':[
        {'asset_id':a['id'],'relative_path':a['relative_path'],'sha256':a['sha256'],
         'kind':'image' if a['origin']=='original_local' else 'voice','origin':a['origin'],
         'source_url':None,'author':None,
         'license':{'id':'original' if a['origin']=='original_local' else None,
                    'name':None,'url':None,'commercial_use':'unknown','attribution_required':None,
                    'verified_by':None,'verified_at':None},
         'status':'unverified','notes':(json.dumps(a['narration'],ensure_ascii=False)
                                     if 'narration' in a else a['attribution'])} for a in evidence_assets]}
    if overlay:
        font = Path(overlay['font_path'])
        relative = font.relative_to(root).as_posix()
        evidence = json.loads((root/'pilot-measurements.json').read_text(encoding='utf-8'))
        evidence['assets'].append({'id':'subtitle-font','relative_path':relative,'sha256':sha(font),
            'origin':'licensed_manual','license':'unverified','attribution':overlay['font_author']+'; '+overlay['font_license']['name'],
            'generated_at':generated})
        write(root/'pilot-measurements.json',evidence)
        evidence_assets = evidence['assets']
        provenance['assets'].append({'asset_id':'subtitle-font','relative_path':relative,'sha256':sha(font),
            'kind':'font','origin':'licensed_manual','source_url':overlay['font_source_url'],
            'author':overlay['font_author'],'license':overlay['font_license'],'status':'unverified',
            'notes':'Arquivo local: '+overlay['font_source']+'; sem licença/aceite humano presumidos.'})
        paths.append({'kind':'font','relative_path':relative})
        write(root/'caption-overlay.json',overlay)
        paths.append({'kind':'manifest','relative_path':'caption-overlay.json'})
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
    plan = json.loads((root/'plan.json').read_text(encoding='utf-8')) if (root/'plan.json').is_file() else {}
    if not (folder/'render'/video_name(plan)).is_file():
        raise ValueError('Evidence exige MP4 real.')
    write(folder/'render/narration-signal.json', signal_measurements(folder/'render/audio-review.wav'))
    evidence['video'] = {'duration_seconds':float(stream['duration']),'width':int(stream['width']),
        'height':int(stream['height']),'frames':int(stream['nb_read_frames'])}
    write(root/'pilot-evidence.json',evidence)
    return {'narration_kind':'local_tts','narration_disclosure':narration_disclosure(evidence['narration']['engine'], evidence['narration']['voice']),'alignment_method':evidence['alignment_method']}


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
    from .pilot_quality import validate_pilot_evidence
    verdict = validate_pilot_evidence(evidence,word_timings=registered_json(root,artifacts,'word-timings.json'))
    if any(not error.startswith('subtitles_timing:') for error in verdict['blocking_errors']):
        raise ValueError('Manifesto de narração inválido.')
    if (narration['kind'] != 'local_tts' or narration['engine'] not in PRODUCTION_ORIGINS
            or not isinstance(narration['voice'],str) or not narration['voice'].strip()
            or evidence['alignment_method'] not in {'measured_sections','forced_alignment'} or evidence['demo_only'] is not True):
        raise ValueError('Narração local não comprovada.')
    audio_asset = next(item for item in evidence['assets'] if item['sha256']==narration['sha256'])
    audio = registered.get(audio_asset['relative_path'])
    if (not audio or audio['kind'] != 'audio' or audio['sha256'] != narration['sha256']
            or audio_asset['origin'] != PRODUCTION_ORIGINS[narration['engine']] or audio_asset['license'] != 'unverified'):
        raise ValueError('WAV ou proveniência da narração não correspondem à evidência.')
    _, duration = wav_info(root/audio['relative_path'])
    expected = narration['duration_seconds']
    if type(expected) not in (float,int) or not math.isfinite(expected) or abs(expected-duration) > .001:
        raise ValueError('Duração da narração não corresponde ao WAV registrado.')
    if not any(item['kind']=='video' for item in artifacts):
        raise ValueError('Piloto sem vídeo registrado.')
    return {'narration_kind':'local_tts','narration_disclosure':narration_disclosure(evidence['narration']['engine'], evidence['narration']['voice']),'alignment_method':evidence['alignment_method']}


def quality_report(root, folder, production_id, *, ffmpeg=None, ffprobe=None):
    """QC físico dentro do worker já possuído; subprocessos seguem sua árvore."""
    from .av_quality import run_quality
    from .media_contracts import validate_quality_report
    report = run_quality(root,production_id=production_id,ffmpeg=ffmpeg,ffprobe=ffprobe)
    words = json.loads((root/'word-timings.json').read_text(encoding='utf-8'))
    checked = validate_quality_report(report,video_sha256=sha(folder/'render'/video_name(json.loads((root/'plan.json').read_text(encoding='utf-8')))),
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
              re.fullmatch(re.escape(prefix)+r'(?:scene-\d+\.png|section-\d+\.wav|fixture\.wav|fonts/[A-Za-z0-9_-]+\.ttf)',a['relative_path'])}
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
