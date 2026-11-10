"""Teste local do backend real: handshake, CLI, persistência, repouso e saída por EOF."""
import argparse
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import psutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--packaged', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    command = [str(root / 'dist/horus-backend/horus-backend.exe')] if args.packaged else [sys.executable, '-m', 'horus_backend']
    token = secrets.token_hex(32)
    with tempfile.TemporaryDirectory(prefix='horus-smoke-') as data:
        env = {**os.environ, 'HORUS_API_TOKEN': token, 'HORUS_MANAGED': '1', 'HORUS_DATA_DIR': data}
        saved_id = failed_id = None
        for attempt in range(2):
            started = time.perf_counter()
            with tempfile.TemporaryFile(mode='w+b') as errors:
                process = subprocess.Popen([*command, '--port', '0'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                           stderr=errors, env=env, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                try:
                    line = process.stdout.readline()
                    if not line:
                        errors.seek(0)
                        raise RuntimeError(errors.read().decode(errors='replace'))
                    ready = json.loads(line)
                    startup = time.perf_counter() - started
                    with httpx.Client(base_url=f"http://127.0.0.1:{ready['port']}", headers={'Authorization': f'Bearer {token}'}, timeout=15) as client:
                        assert client.get('/health').json()['factory_available'], 'Prepare a fábrica antes do teste real.'
                        if saved_id:
                            assert client.get(f'/v1/jobs/{saved_id}').json()['status'] == 'succeeded'
                            restored_failure = client.get(f'/v1/jobs/{failed_id}').json()
                            assert restored_failure['status'] == 'failed'
                            assert 'Pasta do vídeo não encontrada' in restored_failure['error']
                        else:
                            response = client.post('/v1/jobs', json={'operation': 'factory.profile', 'channel_id': 'canal01'})
                            response.raise_for_status()
                            saved_id = response.json()['id']
                            deadline = time.monotonic() + 30
                            while time.monotonic() < deadline:
                                job = client.get(f'/v1/jobs/{saved_id}').json()
                                if job['status'] not in {'queued', 'running'}:
                                    break
                                time.sleep(.05)
                            assert job['status'] == 'succeeded', job
                            assert isinstance(job['result'], dict)
                            # Recusa do CLI real em stdout precisa chegar ao aviso principal da API.
                            response = client.post('/v1/jobs', json={'operation': 'factory.render.preview',
                                                   'channel_id': 'canal01', 'video_id': f'horus-missing-{secrets.token_hex(8)}'})
                            response.raise_for_status()
                            failed_id = response.json()['id']
                            deadline = time.monotonic() + 30
                            while time.monotonic() < deadline:
                                failed = client.get(f'/v1/jobs/{failed_id}').json()
                                if failed['status'] not in {'queued', 'running'}:
                                    break
                                time.sleep(.05)
                            assert failed['status'] == 'failed', failed
                            assert 'Pasta do vídeo não encontrada' in failed['error'], failed
                        native = psutil.Process(process.pid)
                        tree = [native, *native.children(recursive=True)]
                        for item in tree:
                            item.cpu_percent()
                        time.sleep(2)
                        print(json.dumps({'mode': 'packaged' if args.packaged else 'python', 'restart': attempt == 1,
                                          'backend_ready_seconds': round(startup, 3),
                                          'backend_tree_rss_mb': round(sum(p.memory_info().rss for p in tree) / 1024**2, 1),
                                          'backend_tree_cpu_percent': sum(p.cpu_percent() for p in tree),
                                          'factory_profile': 'succeeded', 'factory_error_reason': True,
                                          'persistent_history': attempt == 1}))
                finally:
                    process.stdin.close()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                        raise RuntimeError('O backend não encerrou ao fechar o canal de controle.')
                assert process.returncode == 0, process.returncode


if __name__ == '__main__':
    main()
