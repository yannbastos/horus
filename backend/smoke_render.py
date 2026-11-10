"""Valida render e cancelamento reais com fixture isolada, sem voz paga ou downloads."""
from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid
import wave

from fastapi.testclient import TestClient
import psutil

from horus_backend.api import create_app
from horus_backend.config import Settings, discover_factory


def wait_job(client, job_id, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f'/v1/jobs/{job_id}').json()
        if job['status'] in {'succeeded', 'failed', 'cancelled', 'blocked', 'interrupted'}:
            return job
        time.sleep(.1)
    raise RuntimeError(f'Tarefa não encerrou em {timeout}s: {job_id}')


def wait_owned(client, job_id):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        manager = client.app.state.manager
        active = manager.active_process
        if active and manager.active_id == job_id:
            try:
                parent = psutil.Process(active.process.pid)
                descendants = parent.children(recursive=True)
                if any('chrome' in child.name().lower() for child in descendants):
                    return [(p.pid, p.create_time()) for p in [parent, *descendants]]
            except psutil.NoSuchProcess:
                pass
        if client.get(f'/v1/jobs/{job_id}').json()['status'] in {'failed', 'succeeded'}:
            break
        time.sleep(.05)
    raise AssertionError('Render não iniciou a árvore Chrome para testar encerramento.')


def assert_stopped(owned):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        alive = []
        for pid, created in owned:
            try:
                process = psutil.Process(pid)
                if process.create_time() == created and process.is_running():
                    alive.append(pid)
            except psutil.NoSuchProcess:
                pass
        if not alive:
            return
        time.sleep(.1)
    raise AssertionError(f'Processos da tarefa sobreviveram: {alive}')


def main():
    factory = discover_factory()
    assert factory, 'Configure FABRICA_HOME.'
    modules = factory / 'remotion/node_modules'
    assert list((modules / '.remotion').rglob('chrome-headless-shell.exe')), 'Prepare o navegador local do Remotion antes; este teste não baixa ferramentas.'
    interpreter = factory / 'scripts/.venv/Scripts/python.exe'
    assert interpreter.is_file(), 'Prepare o ambiente Python da fábrica.'
    # Artefatos ficam disponíveis para inspeção. Nunca copiar .env ou áudio original.
    root = Path(__file__).resolve().parents[1] / 'artifacts' / f'render-validation-{uuid.uuid4().hex[:10]}'
    root.mkdir(parents=True)
    shutil.copytree(factory / 'scripts/fabrica', root / 'scripts/fabrica', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(factory / 'canais/_template', root / 'canais/_template')
    channel = root / 'canais/canal01'
    channel.mkdir(exist_ok=True)
    shutil.copyfile(factory / 'canais/canal01/perfil.yaml', channel / 'perfil.yaml')
    source = factory / 'canais/canal01/videos/2026-11-07-teste-pipeline'
    video = channel / 'videos/fixture'
    video.mkdir(parents=True)
    for name in ('roteiro.yaml', 'alinhamento.json', 'manifesto_assets.json'):
        shutil.copyfile(source / name, video / name)
    if (source / 'assets').exists():
        shutil.copytree(source / 'assets', video / 'assets')
    alignment = json.loads((video / 'alinhamento.json').read_text(encoding='utf-8'))
    audio = video / alignment['audio']
    audio.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(audio), 'wb') as wav:
        wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        wav.writeframes(b'\0\0' * int(16000 * alignment['duracao_audio']))
    remotion = root / 'remotion'
    shutil.copytree(factory / 'remotion/src', remotion / 'src')
    for name in ('package.json', 'package-lock.json', 'tsconfig.json'):
        shutil.copyfile(factory / 'remotion' / name, remotion / name)
    # Junction somente para dependências já instaladas; nenhuma instalação implícita.
    subprocess.run(['cmd.exe', '/c', 'mklink', '/J', str(remotion / 'node_modules'), str(modules)], check=True, capture_output=True)
    settings = Settings(token='isolated-render-validation-token', data_dir=root / 'data', factory_root=root,
                        factory_command=(str(interpreter), '-m', 'fabrica.cli'))
    revision = subprocess.run(['git', '-c', f'safe.directory={factory.as_posix()}', '-C', str(factory),
                               'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    # O HEAD não identifica alterações locais em paralelo; registrar o código efetivamente copiado.
    snapshot_hashes = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                       for directory in (root / 'scripts/fabrica', remotion / 'src')
                       for path in directory.rglob('*') if path.is_file()}
    report = {'fixture': str(root), 'factory_revision': revision, 'snapshot_hashes': snapshot_hashes,
              'audio': 'silêncio sintético; não é teste de qualidade editorial'}
    headers = {'Authorization': f'Bearer {settings.token}'}
    with TestClient(create_app(settings), base_url='http://127.0.0.1', headers=headers) as client:
        def submit(video_id='fixture'):
            response = client.post('/v1/jobs', json={'operation': 'factory.render.preview', 'channel_id': 'canal01', 'video_id': video_id})
            response.raise_for_status()
            return response.json()['id']

        try:
            missing = wait_job(client, submit('missing'))
            assert missing['status'] == 'failed' and 'Pasta do vídeo não encontrada' in missing['error'], missing
            # Recusa real do contrato novo de confinamento, antes de iniciar Remotion.
            unsafe = channel / 'videos/unsafe'
            unsafe.mkdir()
            for name in ('roteiro.yaml', 'alinhamento.json', 'manifesto_assets.json'):
                shutil.copyfile(video / name, unsafe / name)
            # Carregar/escrever YAML com o ambiente da fábrica, sem nova dependência no backend.
            env = {**os.environ, 'PYTHONPATH': str(root / 'scripts'), 'FABRICA_HOME': str(root), 'PYTHONUTF8': '1'}
            subprocess.run([str(interpreter), '-c',
                            "import pathlib,sys,yaml; p=pathlib.Path(sys.argv[1]); d=yaml.safe_load(p.read_text(encoding='utf-8')); d['linhas'][0]['visual_override']='../outside.png'; p.write_text(yaml.safe_dump(d,allow_unicode=True),encoding='utf-8')",
                            str(unsafe / 'roteiro.yaml')], env=env, check=True)
            refused = wait_job(client, submit('unsafe'))
            assert refused['status'] == 'failed' and 'fora' in refused['error'].lower(), refused
            report['invalid_inputs'] = {'missing_video': missing['status'], 'outside_override': refused['status'],
                                        'reasons_visible': True}
            assert client.post('/v1/jobs', json={'operation': 'factory.publish'}).status_code == 422
            started = time.monotonic()
            job_id = submit()
            job = wait_job(client, job_id)
            assert job['status'] == 'succeeded', job
            output = video / 'render/short-rascunho.mp4'
            assert output.is_file() and output.stat().st_size > 0
            shutil.copyfile(output, root / 'render-completed.mp4')
            receipt_path = video / 'render/short-rascunho.insumos.json'
            receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
            assert receipt['rascunho'] is True
            assert receipt['video_sha256'] == hashlib.sha256(output.read_bytes()).hexdigest()
            shutil.copyfile(receipt_path, root / 'render-completed.insumos.json')
            report['render'] = {'status': job['status'], 'seconds': round(time.monotonic() - started, 2), 'bytes': output.stat().st_size}
            report['render']['receipt_verified'] = True
            # Verificação somente de leitura; não aprovar ou promover a fixture de teste.
            checked = subprocess.run([str(interpreter), '-m', 'fabrica.cli', 'publicar', 'checar', '--canal', 'canal01',
                                      '--video', 'fixture'], env=env, cwd=root, capture_output=True, text=True, encoding='utf-8')
            assert checked.returncode == 3, checked.stdout + checked.stderr
            assert 'teste' in (checked.stdout + checked.stderr).lower()
            report['publication_check'] = {'exit_code': checked.returncode, 'test_fixture_blocked': True}
            # Aguarda a árvore real Node/Chrome antes de solicitar cancelamento.
            cancelled_id = submit()
            owned = wait_owned(client, cancelled_id)
            response = client.post(f'/v1/jobs/{cancelled_id}/cancel')
            response.raise_for_status()
            cancelled = wait_job(client, cancelled_id, 15)
            assert cancelled['status'] == 'cancelled', cancelled
            assert_stopped(owned)
            assert not receipt_path.exists(), 'Render cancelado não pode conservar comprovante de sucesso anterior.'
            report['cancel'] = {'status': cancelled['status'], 'owned_processes_stopped': len(owned)}
        finally:
            report['jobs'] = client.get('/v1/jobs').json()
            (root / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    with TestClient(create_app(settings), base_url='http://127.0.0.1', headers=headers) as client:
        assert client.get(f'/v1/jobs/{job_id}').json()['status'] == 'succeeded'
        assert client.get(f'/v1/jobs/{cancelled_id}').json()['status'] == 'cancelled'
        assert client.get(f"/v1/jobs/{refused['id']}").json()['status'] == 'failed'
        report['history_after_restart'] = True
        response = client.post('/v1/jobs', json={'operation': 'factory.render.preview', 'channel_id': 'canal01', 'video_id': 'fixture'})
        response.raise_for_status()
        interrupted_id = response.json()['id']
        interrupted_owned = wait_owned(client, interrupted_id)
        # Fechar o backend durante o render precisa interromper somente sua árvore.
    assert_stopped(interrupted_owned)
    with TestClient(create_app(settings), base_url='http://127.0.0.1', headers=headers) as client:
        interrupted = client.get(f'/v1/jobs/{interrupted_id}').json()
        assert interrupted['status'] == 'interrupted' and interrupted['attempt'] == 1, interrupted
        assert client.app.state.manager.active_process is None
        report['shutdown_during_render'] = {'status': interrupted['status'], 'attempt': interrupted['attempt'],
                                            'owned_processes_stopped': len(interrupted_owned), 'automatic_retry': False}
        report['jobs'] = client.get('/v1/jobs').json()
    (root / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k not in {'jobs', 'snapshot_hashes'}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
