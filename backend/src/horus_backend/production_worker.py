"""Worker isolado: fixtures ou SAPI offline explícito; renderer independente, sem publicação."""
from __future__ import annotations
import argparse
import hashlib
import http.server
import json
import math
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import wave
import zlib


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def run_factory_render(root, command, environment):
    """Preserva diagnóstico local de falha; o erro público continua controlado."""
    log = root/'render-stderr.log'
    with log.open('wb') as stderr:
        completed = subprocess.run(command, env=environment, stdout=subprocess.DEVNULL, stderr=stderr)
    if completed.returncode:
        with log.open('rb') as stderr:
            stderr.seek(max(0, log.stat().st_size-8192))
            tail = stderr.read().decode('utf-8', errors='replace')
        write_json(root/'render-failure.json', {'schema_version':1,
            'exit_code':completed.returncode, 'stderr_tail':tail, 'stderr_limit_bytes':8192})
    return completed


def stage(value):
    print(json.dumps({"stage": value}), flush=True)


def png(path, index):
    width, height = 180, 320
    color = ((30 + index * 43) % 255, 65, 125)
    raw = b"".join(b"\0" + bytes(color) * width for _ in range(height))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) +
                     chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def timestamp(seconds):
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    return f"{h:02}:{m:02}:{ms // 1000:02},{ms % 1000:03}"


# Guard executado somente pelos processos Node pertencentes a esta produção.
# Não modifica Remotion, browser do usuário ou configurações globais.
NODE_GUARD = r"""
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const loopback = h => ['localhost','127.0.0.1','::1','[::1]'].includes(h);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  // net.connect encaminha seus argumentos normalizados como [options, callback].
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = normalized[0];
  const host = typeof options === 'object' ? (options.host || options.hostname || 'localhost') :
    typeof options === 'number' || (typeof options === 'string' && /^\d+$/.test(options)) ?
      (typeof normalized[1] === 'string' ? normalized[1] : 'localhost') : null;
  if (host && !loopback(host)) throw new Error('External Node network denied for local demo');
  return connect.apply(this,args);
};
const spawn = cp.spawn;
cp.spawn = function(command, args, options) {
  let manifest;
  let launch;
  if (path.resolve(command).toLowerCase() === path.resolve(process.env.HORUS_DEMO_BROWSER).toLowerCase()) {
    const id = process.pid + '-' + crypto.randomUUID();
    const folder = path.dirname(process.env.HORUS_DEMO_NETLOG);
    const netlog = 'browser-netlog-' + id + '.json';
    args = args.filter(a => !a.startsWith('--proxy-') && a !== '--no-proxy-server');
    args.push('--proxy-server=http://' + process.env.HORUS_DEMO_PROXY, '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-quic',
      '--log-net-log=' + path.join(folder,netlog), '--net-log-capture-mode=Default');
    manifest = path.join(folder,'browser-launch-' + id + '.json');
    launch = {browser_guard_applied:true, browser_closed:false,
      netlog_file:netlog,
      external_proxy:process.env.HORUS_DEMO_PROXY, dns_external:'NOTFOUND', node_loopback_only:true};
  }
  const child = spawn.call(this,command,args,options);
  if (manifest) {
    launch.browser_pid = child.pid;
    fs.writeFileSync(manifest, JSON.stringify(launch));
    child.once('exit', () => {
      launch.browser_closed = true;
      fs.writeFileSync(manifest, JSON.stringify(launch));
    });
  }
  return child;
};
"""


def deny_proxy():
    from urllib.parse import urlsplit
    rejected = set()
    class Handler(http.server.BaseHTTPRequestHandler):
        def deny(self):
            host = urlsplit(self.path).hostname if '://' in self.path else self.path.split(':')[0]
            rejected.add(host or 'unknown')
            self.send_response(403)
            self.end_headers()
        do_GET = do_CONNECT = do_POST = do_HEAD = deny
        def log_message(self, *args):
            pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, rejected


class NetworkAuditError(ValueError):
    def __init__(self, code, message, error_type='ValueError'):
        self.detail = {'code':code, 'type':error_type, 'message':message}
        super().__init__(f'{error_type}: {message}')


def browser_has_exited(pid):
    """Consulta somente o PID capturado pelo spawn; nunca encerra processos."""
    if type(pid) is not int or not 0 < pid < 2**31:
        return False
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE,wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x100000,False,pid)  # SYNCHRONIZE, sem escrita
        if not handle:
            return ctypes.get_last_error() == 87  # ERROR_INVALID_PARAMETER: PID inexistente
        try:
            return kernel.WaitForSingleObject(handle,0) == 0
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid,0)  # POSIX: consulta; nunca executar esta chamada no Windows
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return False


def read_audit_json(path, *, deadline, allow_unclosed_events=False, require_closed=False):
    """Espera flush/fechamento sem descartar evento nem reconstruir evento parcial."""
    previous, stable_since = None, None
    role = 'NetLog' if 'netlog' in path.name else 'manifesto de lançamento'
    while True:
        now = time.monotonic()
        try:
            raw = path.read_text(encoding='utf-8')
            try:
                value = json.loads(raw)
                if not require_closed:
                    return value, True
                if isinstance(value,dict):
                    if value.get('browser_closed') is True:
                        return {**value,'exit_confirmation':'node_exit_event'}, True
                    if browser_has_exited(value.get('browser_pid')):
                        return {**value,'exit_confirmation':'os_process_handle'}, True
                failure = NetworkAuditError('browser_not_closed', 'Encerramento do browser ainda não confirmado')
            except json.JSONDecodeError as error:
                # Chromium pode ser encerrado à força pelo Remotion. Só o sufixo
                # estrutural pode faltar; nenhum byte de evento é removido.
                partial = None
                if allow_unclosed_events and raw.rstrip().rstrip(',').endswith('}'):
                    try:
                        partial = json.loads(raw.rstrip().rstrip(',') + ']}')
                    except json.JSONDecodeError:
                        pass
                if raw != previous:
                    previous, stable_since = raw, now
                if partial is not None and time.monotonic()-stable_since >= .5 and time.monotonic() >= deadline:
                    return partial, False
                failure = NetworkAuditError('audit_json_incomplete',
                    f'{role} JSON incompleto/inválido (linha {error.lineno}, coluna {error.colno})',
                    type(error).__name__)
        except OSError as error:
            failure = NetworkAuditError('audit_file_unavailable',
                f'{role} indisponível (errno={error.errno}, winerror={getattr(error,"winerror",None)})', type(error).__name__)
        except (UnicodeError, ValueError) as error:
            failure = NetworkAuditError('audit_encoding_invalid', 'Arquivo de auditoria não é UTF-8 válido', type(error).__name__)
        if time.monotonic() >= deadline:
            raise failure
        time.sleep(.05)


def network_summary(root, rejected, *, timeout=5):
    from urllib.parse import urlsplit
    launches = sorted(root.glob('browser-launch-*.json')) or [root/'browser-launch.json']
    url_hosts, remote_addresses = set(), set()
    browsers = []
    for manifest in launches:
        launch, _ = read_audit_json(manifest, deadline=time.monotonic()+timeout,
                                    require_closed=manifest.name != 'browser-launch.json')
        if not isinstance(launch, dict) or launch.get('browser_guard_applied') is not True:
            raise NetworkAuditError('browser_guard_missing', 'Guard do browser ausente ou inválido')
        name = launch.get('netlog_file', 'browser-netlog.json' if manifest.name == 'browser-launch.json' else None)
        if not isinstance(name,str) or Path(name).name != name or not name.startswith('browser-netlog') or not name.endswith('.json'):
            raise NetworkAuditError('netlog_reference_invalid', 'Referência local do NetLog inválida')
        netlog, complete = read_audit_json(root/name, deadline=time.monotonic()+timeout, allow_unclosed_events=True)
        try:
            constants, events = netlog['constants']['logEventTypes'], netlog['events']
            if not isinstance(constants,dict) or not constants or not isinstance(events,list) or not events:
                raise ValueError()
            if not all(isinstance(k,str) and type(v) is int for k,v in constants.items()):
                raise ValueError()
            names = {value:key for key,value in constants.items()}
            for event in events:
                if type(event['type']) is not int or not isinstance(event.get('params',{}),dict):
                    raise ValueError()
                params = event.get('params', {})
                url = params.get('url')
                if isinstance(url, str):
                    host = urlsplit(url).hostname
                    if host:
                        url_hosts.add(host)
                if names.get(event['type']) == 'TCP_CONNECT_ATTEMPT' and 'address' in params:
                    if not isinstance(params['address'],str):
                        raise ValueError()
                    remote_addresses.add(params['address'])
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            raise NetworkAuditError('netlog_schema_invalid', 'Estrutura de eventos/constantes do NetLog inválida', type(error).__name__) from None
        browsers.append({'launch_file':manifest.name,'netlog_file':name,'netlog_complete':complete,'event_count':len(events),
                         'exit_confirmation':launch.get('exit_confirmation','legacy_manifest')})
    external_tcp = [a for a in remote_addresses if not a.startswith(('127.0.0.1:', '[::1]:'))]
    summary = {**launch, 'browser_guard_applied':True, 'netlog_complete':all(b['netlog_complete'] for b in browsers),
               'event_count':sum(b['event_count'] for b in browsers), 'browsers':browsers,
               'url_hosts': sorted(url_hosts), 'tcp_destinations':sorted(remote_addresses),
               'external_tcp_destinations':external_tcp, 'proxy_denied_hosts':sorted(rejected), 'scope':'Browser NetLog + Node loopback guard; não é captura do sistema inteiro.'}
    write_json(root / 'network-summary.json', summary)
    if external_tcp:
        raise NetworkAuditError('external_tcp_detected', 'Auditoria do render encontrou destino TCP externo')


def render(root, source):
    sys.path.insert(0, str(source / 'scripts'))
    os.environ['FABRICA_HOME'] = str(root)
    from fabrica.modelos import Roteiro, Alinhamento, Manifesto
    from fabrica import render as renderer
    plan = json.loads((root / 'plan.json').read_text(encoding='utf-8'))
    folder = root / 'canais/demo/videos/fixture'
    roteiro = Roteiro.model_validate(plan['roteiro'])
    alignment = Alinhamento.model_validate_json((folder / 'alinhamento.json').read_text(encoding='utf-8'))
    Manifesto.model_validate_json((folder / 'manifesto_assets.json').read_text(encoding='utf-8'))
    for line in roteiro.linhas:
        line.visual_override = f'scene-{line.n}.png'
    write_json(folder / 'roteiro.json', roteiro.model_dump(mode='json'))
    # Reutiliza o renderer real. Browser explícito impede download automático;
    # npx só resolve pacote já instalado e npm permanece offline.
    original_run = subprocess.run
    # O lock do seletor padrão 3000 do Remotion é apenas interno ao Node.
    # Uma porta explícita escolhida pelo SO evita a disputa entre worktrees.
    # Se outro processo a ocupar antes do bind, Remotion falha, sem reusar servidor.
    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0))
        render_port = listener.getsockname()[1]
    overlay_enabled = plan['mode']=='local_pilot' and (root/'caption-overlay.json').is_file()
    def offline_run(command, **kwargs):
        if overlay_enabled:
            props_path = next(Path(arg.split('=',1)[1]) for arg in command if arg.startswith('--props='))
            props = json.loads(props_path.read_text(encoding='utf-8'))
            props['palavras'] = []  # entrada suportada; alinhamento e fonte permanecem intactos
            write_json(props_path,props)
        command += [f"--browser-executable={os.environ['HORUS_DEMO_BROWSER']}", f'--port={render_port}', '--concurrency=1', '--log=error']
        return original_run(command, **kwargs)
    renderer.subprocess.run = offline_run
    started = time.monotonic()
    video = renderer.renderizar(roteiro, folder, rascunho=plan.get('render_quality','draft') != 'final')
    factory_seconds = round(time.monotonic()-started,3)
    overlay_result = None
    if overlay_enabled:
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
        from horus_backend.local_pilot import overlay_subtitles
        overlay_result = overlay_subtitles(root,folder,video,plan)
        insumos = video.with_suffix('.insumos.json')
        data = json.loads(insumos.read_text(encoding='utf-8'))
        data.update(video_sha256=overlay_result['final_sha256'],caption_overlay=overlay_result)
        write_json(insumos,data)
    # Decodificação real + duração/frames, usando ffprobe/ffmpeg já preparados.
    probe = original_run([os.environ['HORUS_DEMO_FFPROBE'], '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=nb_read_frames,width,height,duration,r_frame_rate', '-of', 'json', str(video)], capture_output=True, check=True)
    stream = json.loads(probe.stdout)['streams'][0]
    if int(stream['nb_read_frames']) < 2 or abs(float(stream['duration']) - (alignment.duracao_audio + .8)) > .2:
        raise ValueError('Vídeo não corresponde à duração/frames esperados.')
    audio_probe = original_run([os.environ['HORUS_DEMO_FFPROBE'], '-v', 'error', '-count_frames', '-select_streams', 'a:0',
        '-show_entries', 'stream=nb_read_frames,duration,codec_name,sample_rate,channels', '-of', 'json', str(video)], capture_output=True, check=True)
    audio_stream = json.loads(audio_probe.stdout)['streams'][0]
    if overlay_result:
        intermediate = video.with_name(video.stem+'-without-subtitles.mp4')
        prior = original_run([os.environ['HORUS_DEMO_FFPROBE'],'-v','error','-count_frames','-select_streams','v:0',
            '-show_entries','stream=nb_read_frames,width,height,duration,r_frame_rate','-of','json',str(intermediate)],capture_output=True,check=True)
        if json.loads(prior.stdout)['streams'][0] != stream:
            raise ValueError('Sobreposição alterou resolução/fps/frames/duração do vídeo.')
        audio_packets = []
        for path in (intermediate,video):
            packet = original_run([os.environ['HORUS_DEMO_FFPROBE'],'-v','error','-select_streams','a:0',
                '-show_packets','-show_data_hash','sha256','-show_entries','packet=pts_time,duration_time,data_hash',
                '-of','json',str(path)],capture_output=True,check=True)
            audio_packets.append(json.loads(packet.stdout))
        if audio_packets[0] != audio_packets[1]:
            raise ValueError('Sobreposição alterou pacotes/tempos de áudio.')
        overlay_result.update(video_stream_unchanged=True,audio_packets_unchanged=True)
        write_json(folder/'render/caption-overlay.json',overlay_result)
    if int(audio_stream['nb_read_frames']) < 1 or float(audio_stream['duration']) < alignment.duracao_audio - .1:
        raise ValueError('MP4 sem áudio completo decodificável.')
    original_run([os.environ['HORUS_DEMO_FFMPEG'], '-v', 'error', '-i', str(video), '-frames:v', '1',
                  str(folder / 'render/frame.png')], capture_output=True, check=True)
    if plan['mode'] == 'local_pilot':
        original_run([os.environ['HORUS_DEMO_FFMPEG'], '-v', 'error', '-i', str(video), '-vn', '-ac', '1',
            '-ar', '22050', '-c:a', 'pcm_s16le', str(folder / 'render/audio-review.wav')], capture_output=True, check=True)
        if overlay_result:
            for i in range(1,4):
                original_run([os.environ['HORUS_DEMO_FFMPEG'],'-v','error','-ss',str(alignment.duracao_audio*i/4),
                    '-i',str(video),'-frames:v','1',str(folder/f'render/subtitles-compare-{i}.png')],capture_output=True,check=True)
        original_run([os.environ['HORUS_DEMO_FFMPEG'], '-v', 'error', '-ss', str(alignment.duracao_audio / 2),
            '-i', str(video), '-frames:v', '1', str(folder / 'render/subtitles-frame.png')], capture_output=True, check=True)
    write_json(folder / 'render/validation.json', {'render_port':render_port, 'factory_render_seconds':factory_seconds, 'total_render_seconds':round(time.monotonic()-started,3), 'caption_overlay':overlay_result, 'stream': stream, 'audio_stream': audio_stream, 'demo_only': True, 'real_voice': False,
               'speech_aligned': False, 'sha256': hashlib.sha256(video.read_bytes()).hexdigest()})


def unavailable_message(error):
    """Causa real de uma falha de SO/tempo no piloto local; nunca atribui tudo à voz SAPI nem expõe caminhos."""
    if isinstance(error, TimeoutError):
        return 'Piloto local indisponivel: tempo limite esgotado em uma etapa local (síntese, alinhamento ou FFmpeg).'
    detail = (error.strerror or '').strip() if isinstance(error, OSError) else ''
    return ('Piloto local indisponivel: falha de sistema em uma etapa local (' + type(error).__name__
            + (': ' + detail[:120] if detail else '') + '); confira HORUS_FFMPEG, HORUS_ALIGNMENT_MODEL e a voz escolhida.')


def factory_missing(source, python, browser, ffprobe, ffmpeg):
    """Pré-condições do render ausentes, cada uma com a própria causa."""
    if not source:
        return ['fábrica não configurada: defina FABRICA_HOME (HORUS_PILOT_FACTORY é aceita como alias)']
    missing = []
    if not python or not python.is_file(): missing.append('Python da fábrica em scripts/.venv')
    if not (source / 'remotion/node_modules/.bin/remotion.cmd').is_file() and not (source / 'remotion/node_modules/.bin/remotion').is_file():
        missing.append('Remotion instalado pelos locks em sandbox')
    if not browser: missing.append('browser local preparado')
    if not ffmpeg: missing.append('ffmpeg local para validar frames/duração')
    if not ffprobe: missing.append('ffprobe local para validar frames/duração')
    return missing


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('--factory-source', type=Path)
    parser.add_argument('--factory-render', action='store_true')
    args = parser.parse_args()
    root, source = args.root, args.factory_source
    if args.factory_render:
        render(root, source)
        return
    from horus_backend.production_contract import ProductionPlan, render_srt
    plan = ProductionPlan.model_validate_json((root / 'plan.json').read_text(encoding='utf-8-sig')).model_dump(mode='json')
    artifacts = [{'kind': 'plan', 'relative_path': 'plan.json'}]
    folder = root / 'canais/demo/videos/fixture'
    folder.mkdir(parents=True)
    prefix = folder.relative_to(root).as_posix()
    def artifact(name, kind):
        artifacts.append({'kind': kind, 'relative_path': f'{prefix}/{name}'})
    stage('narration')
    if plan['mode'] == 'local_pilot':
        from horus_backend.local_pilot import prepare
        try:
            artifacts.extend(prepare(root, folder, plan, alignment_model=os.environ.get("HORUS_ALIGNMENT_MODEL"), progress=stage))
        except ValueError as error:
            write_json(root / 'result.json', {'blocked': True, 'error': 'Piloto local bloqueado: ' + str(error), 'artifacts': artifacts})
            return
        except (OSError, TimeoutError) as error:
            write_json(root / 'result.json', {'blocked': True, 'error': unavailable_message(error), 'artifacts': artifacts})
            return
    else:
        rate = 16000
        with wave.open(str(folder / 'fixture.wav'), 'wb') as audio:
            audio.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
            for offset in range(math.ceil(plan['total_duration'])):
                count = min(rate, round(plan['total_duration'] * rate) - offset * rate)
                if count > 0:
                    audio.writeframes(b''.join(struct.pack('<h', round(400 * math.sin(2 * math.pi * 220 * (offset * rate + i) / rate))) for i in range(count)))
        artifact('fixture.wav', 'audio')
        stage('scenes')
        assets, lines = [], []
        for scene in plan['scenes']:
            n = scene['n']
            filename = f'scene-{n}.png'
            png(folder / filename, n)
            artifact(filename, 'scene')
            lines.append({'n': n, 'inicio': scene['start'], 'fim': scene['end']})
            assets.append({'linha': n, 'tipo': 'imagem', 'arquivo': filename, 'fonte': 'original_local_fixture',
                           'licenca': 'demonstração; publicação não verificada', 'exige_credito': False, 'publicavel': False})
        assets.append({'tipo': 'narracao', 'arquivo': 'fixture.wav', 'fonte': 'fixture_tone_sem_voz_real',
                       'licenca': 'demonstração; publicação não verificada', 'exige_credito': False, 'publicavel': False})
        write_json(folder / 'manifesto_assets.json', {'assets': assets})
        artifact('manifesto_assets.json', 'manifest')
        # Tempos sintéticos por cena, deliberadamente sem palavras alinhadas à fala.
        write_json(folder / 'alinhamento.json', {'audio': 'fixture.wav', 'duracao_audio': plan['total_duration'],
                   'motor': 'synthetic_fixture_tone_no_real_voice', 'palavras': [], 'linhas': lines})
        artifact('alinhamento.json', 'manifest')
        stage('subtitles')
        (folder / 'fixture.srt').write_text(render_srt(ProductionPlan.model_validate(plan)), encoding='utf-8')
        artifact('fixture.srt', 'subtitles')
    if plan['mode'] in {'local_demo', 'local_pilot'}:
        stage('render')
        python = source / 'scripts/.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python') if source else None
        browser = next((Path(p) for p in [os.environ.get('HORUS_DEMO_BROWSER', ''),
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            'C:/Program Files/Microsoft/Edge/Application/msedge.exe'] if p and Path(p).is_file()), None)
        def tool(name):
            found = shutil.which(name)
            if found:
                return found
            if source:
                # Executáveis distribuídos pelo lock @remotion/compositor, sem instalação global.
                suffix = '.exe' if os.name == 'nt' else ''
                matches = sorted((source / 'remotion/node_modules/@remotion').glob(f'compositor-*/{name}{suffix}'))
                if len(matches) == 1:
                    return str(matches[0])
            return None
        ffprobe, ffmpeg = tool('ffprobe'), tool('ffmpeg')
        missing = factory_missing(source, python, browser, ffprobe, ffmpeg)
        if missing:
            write_json(root / 'result.json', {'blocked': True, 'error': 'Prepare separadamente, sem downloads no job: ' + '; '.join(missing), 'artifacts': artifacts})
            return
        # Somente código/locks/dependências Remotion; nenhum public-dir/mídia do operador.
        remotion = root / 'remotion'
        remotion.mkdir()
        for name in ('src', 'node_modules', 'package.json', 'package-lock.json', 'tsconfig.json'):
            item = source / 'remotion' / name
            if item.is_dir():
                # Prefixo Win32 estendido só para cópia Python: não altera política global de caminhos.
                copy_source, copy_target = item, remotion / name
                if os.name == 'nt':
                    copy_source = Path('\\\\?\\' + str(copy_source.resolve()))
                    copy_target = Path('\\\\?\\' + str(copy_target.resolve()))
                shutil.copytree(copy_source, copy_target, ignore=shutil.ignore_patterns('.env', '.env.*', '*.mp4'))
            elif item.is_file():
                shutil.copy2(item, remotion / name)
        (root / 'offline-guard.cjs').write_text(NODE_GUARD, encoding='utf-8')
        proxy, proxy_thread, rejected = deny_proxy()
        env = {**os.environ, 'HORUS_DEMO_PROXY':f'127.0.0.1:{proxy.server_port}', 'NODE_OPTIONS': '--require=' + str(root / 'offline-guard.cjs'),
               'HORUS_DEMO_NETLOG':str(root / 'browser-netlog.json'), 'HORUS_DEMO_LAUNCH':str(root / 'browser-launch.json'),
               'npm_config_offline': 'true', 'npm_config_yes': 'false', 'HORUS_DEMO_BROWSER': str(browser),
               'HORUS_DEMO_FFPROBE': ffprobe, 'HORUS_DEMO_FFMPEG': ffmpeg}
        try:
            completed = run_factory_render(root,
                [str(python), str(Path(__file__).resolve()), str(root), '--factory-source', str(source), '--factory-render'], env)
        finally:
            proxy.shutdown()
            proxy.server_close()
            proxy_thread.join()
        if completed.returncode:
            artifacts.append({'kind':'manifest','relative_path':'render-failure.json'})
            write_json(root / 'result.json', {'error': 'Render offline da fábrica falhou; consulte render-failure.json para o diagnóstico local.', 'artifacts': artifacts})
            sys.exit(1)
        try:
            network_summary(root, rejected)
        except (ValueError, KeyError, OSError, TypeError) as error:
            detail = (error.detail if isinstance(error, NetworkAuditError) else
                      {'code':'audit_invalid', 'type':type(error).__name__, 'message':'Evidência de auditoria inválida'})
            write_json(root/'network-failure.json', detail)
            artifacts.append({'kind':'manifest','relative_path':'network-failure.json'})
            write_json(root / 'result.json', {'error':
                f"Não foi possível validar a auditoria de rede do browser; vídeo não liberado ({detail['type']}: {detail['message']}).",
                'audit_error':detail, 'artifacts':artifacts})
            sys.exit(1)
        artifacts.append({'kind':'manifest', 'relative_path':'network-summary.json'})
        name = 'short' if plan.get('render_quality','draft')=='final' else 'short-rascunho'
        artifact(f'render/{name}.mp4', 'video')
        artifact(f'render/{name}.insumos.json', 'manifest')
        if (folder/'render/caption-overlay.json').is_file():
            artifact('render/caption-overlay.json','manifest')
            for i in range(1,4):
                artifact(f'render/subtitles-compare-{i}.png','scene')
        artifact('render/validation.json', 'manifest')
        artifact('render/frame.png', 'scene')
    metadata = {}
    if plan['mode'] == 'local_pilot':
        from horus_backend.local_pilot import finalize
        metadata = finalize(root, folder)
        artifacts.append({'kind':'manifest','relative_path':'pilot-evidence.json'})
        artifact('render/audio-review.wav', 'audio')
        artifact('render/subtitles-frame.png', 'scene')
        artifact('render/narration-signal.json', 'manifest')
        stage('quality')
        from horus_backend.local_pilot import quality_report
        quality_report(root,folder,root.name,ffmpeg=Path(ffmpeg),ffprobe=Path(ffprobe))
        artifacts.append({'kind':'manifest','relative_path':'quality-report.json'})
    else:
        metadata = {'narration_kind':'fixture_tone','narration_disclosure':'Tom sintetico local; sem narracao.'}
    stage('review')
    write_json(root / 'result.json', {'artifacts': artifacts, 'demo_only': True, 'real_voice': False, 'speech_aligned': False, **metadata})


if __name__ == '__main__':
    main()
