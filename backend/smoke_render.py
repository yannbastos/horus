"""Valida render e cancelamento reais com fixture isolada, sem voz paga ou downloads."""
from __future__ import annotations

import json
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
    report = {'fixture': str(root), 'audio': 'silêncio sintético; não é teste de qualidade editorial'}
    headers = {'Authorization': f'Bearer {settings.token}'}
    with TestClient(create_app(settings), base_url='http://127.0.0.1', headers=headers) as client:
        def submit():
            response = client.post('/v1/jobs', json={'operation': 'factory.render.preview', 'channel_id': 'canal01', 'video_id': 'fixture'})
            response.raise_for_status()
            return response.json()['id']

        started = time.monotonic()
        job_id = submit()
        try:
            job = wait_job(client, job_id)
            assert job['status'] == 'succeeded', job
            output = video / 'render/short-rascunho.mp4'
            assert output.is_file() and output.stat().st_size > 0
            shutil.copyfile(output, root / 'render-completed.mp4')
            report['render'] = {'status': job['status'], 'seconds': round(time.monotonic() - started, 2), 'bytes': output.stat().st_size}
            # Aguarda a árvore real Node/Chrome antes de solicitar cancelamento.
            cancelled_id = submit()
            deadline = time.monotonic() + 45
            owned = []
            while time.monotonic() < deadline:
                active = client.app.state.manager.active_process
                if active:
                    parent = psutil.Process(active.process.pid)
                    descendants = parent.children(recursive=True)
                    if any('chrome' in child.name().lower() for child in descendants):
                        owned = [(p.pid, p.create_time()) for p in [parent, *descendants]]
                        break
                if client.get(f'/v1/jobs/{cancelled_id}').json()['status'] in {'failed', 'succeeded'}:
                    break
                time.sleep(.05)
            assert owned, 'Render não iniciou a árvore Chrome para testar cancelamento.'
            response = client.post(f'/v1/jobs/{cancelled_id}/cancel')
            response.raise_for_status()
            cancelled = wait_job(client, cancelled_id, 15)
            assert cancelled['status'] == 'cancelled', cancelled
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
                    break
                time.sleep(.1)
            assert not alive, f'Processos da tarefa sobreviveram: {alive}'
            report['cancel'] = {'status': cancelled['status'], 'owned_processes_stopped': len(owned)}
        finally:
            report['jobs'] = client.get('/v1/jobs').json()
            (root / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    with TestClient(create_app(settings), base_url='http://127.0.0.1', headers=headers) as client:
        assert client.get(f'/v1/jobs/{job_id}').json()['status'] == 'succeeded'
        assert client.get(f'/v1/jobs/{cancelled_id}').json()['status'] == 'cancelled'
        report['history_after_restart'] = True
    (root / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'jobs'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
