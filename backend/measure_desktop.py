"""Mede a árvore desktop Windows; prontidão técnica não mede interface utilizável."""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess
import time
import uuid

import psutil


def windows(pid):
    found = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    @callback_type
    def visit(handle, _):
        owner = wintypes.DWORD()
        ctypes.windll.user32.GetWindowThreadProcessId(handle, ctypes.byref(owner))
        if owner.value == pid and ctypes.windll.user32.IsWindowVisible(handle):
            found.append(handle)
        return True

    ctypes.windll.user32.EnumWindows(visit, 0)
    return found


def tree(pid):
    parent = psutil.Process(pid)
    return [parent, *parent.children(recursive=True)]


def snapshot(pid):
    result = {}
    for process in tree(pid):
        try:
            memory = process.memory_info()
            cpu = process.cpu_times()
            result[(process.pid, process.create_time())] = {
                'name': process.name(), 'rss': memory.rss, 'private': memory.private,
                'cpu_seconds': cpu.user + cpu.system,
            }
        except psutil.NoSuchProcess:
            pass
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=int, default=20)
    parser.add_argument('--idle-seconds', type=int, default=60)
    args = parser.parse_args()
    if args.runs < 1 or args.idle_seconds < 1:
        parser.error('Use ao menos uma execução e um segundo de amostragem.')
    root = Path(__file__).resolve().parents[1]
    executable = root / 'frontend/src-tauri/target/release/horus-desktop.exe'
    assert executable.is_file(), 'Compile o desktop release primeiro.'
    output = root / 'artifacts' / f'desktop-measure-{uuid.uuid4().hex[:10]}'
    output.mkdir(parents=True)
    report = {'platform': platform.platform(), 'logical_cpus': psutil.cpu_count(),
              'ram_gib': round(psutil.virtual_memory().total / 1024**3, 1),
              'executable': str(executable), 'runs': [],
              'method': 'Janela nativa visível e socket backend em LISTEN; não mede primeira interface utilizável. Cache de arquivos aquecido, sem Vite; perfil WebView isolado criado na primeira execução e reutilizado. RSS somado inclui memória compartilhada; private é compromisso privado, não RAM física exclusiva.'}
    for index in range(args.runs):
        started = time.monotonic()
        process = subprocess.Popen([str(executable)], cwd=executable.parent,
                                   env={**os.environ, 'HORUS_DATA_DIR': str(output / 'data'),
                                        'WEBVIEW2_USER_DATA_FOLDER': str(output / 'webview')},
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        known = []
        run = {}
        try:
            native_window = backend_ready = None
            webview_present = False
            deadline = started + 30
            while time.monotonic() < deadline:
                assert process.poll() is None, f'Desktop encerrou: {process.returncode}'
                if native_window is None and windows(process.pid):
                    native_window = time.monotonic() - started
                for child in tree(process.pid)[1:]:
                    try:
                        if child.name().lower() == 'msedgewebview2.exe':
                            webview_present = True
                        if backend_ready is None:
                            if child.name().lower() == 'horus-backend.exe' and any(c.status == psutil.CONN_LISTEN for c in child.net_connections(kind='tcp')):
                                backend_ready = time.monotonic() - started
                    except psutil.NoSuchProcess:
                        pass
                if native_window is not None and backend_ready is not None and webview_present:
                    break
                time.sleep(.05)
            assert native_window is not None and backend_ready is not None, 'Janela/backend não ficaram prontos.'
            assert webview_present, 'WebView2 ausente da árvore; medição incompleta.'
            run = {'native_window_seconds': round(native_window, 3), 'backend_listening_seconds': round(backend_ready, 3)}
            if index == args.runs - 1:
                time.sleep(5)
                before = snapshot(process.pid)
                sampled = time.monotonic()
                time.sleep(args.idle_seconds)
                after = snapshot(process.pid)
                assert any(p['name'].lower() == 'msedgewebview2.exe' for p in after.values()), 'WebView2 ausente na amostra de repouso.'
                elapsed = time.monotonic() - sampled
                core_percent = sum(max(0, item['cpu_seconds'] - before.get(key, item)['cpu_seconds']) for key, item in after.items()) / elapsed * 100
                report['idle'] = {'seconds': round(elapsed, 2), 'rss_sum_mib': round(sum(p['rss'] for p in after.values()) / 1024**2, 1),
                                  'private_commit_sum_mib': round(sum(p['private'] for p in after.values()) / 1024**2, 1),
                                  'cpu_percent_one_core': round(core_percent, 3),
                                  'cpu_percent_machine': round(core_percent / psutil.cpu_count(), 3),
                                  'processes': [{'pid': key[0], **value} for key, value in after.items()]}
            report['runs'].append(run)
            print(json.dumps({'run': index + 1, **run}), flush=True)
        finally:
            known = [(p.pid, p.create_time()) for p in tree(process.pid)] if process.poll() is None else []
            ctypes.windll.user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
            for handle in windows(process.pid):
                ctypes.windll.user32.PostMessageW(handle, 0x0010, 0, 0)
            try:
                process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                for pid, created in reversed(known):
                    try:
                        owned = psutil.Process(pid)
                        if owned.create_time() == created:
                            owned.kill()
                    except psutil.NoSuchProcess:
                        pass
                raise RuntimeError('Desktop não encerrou normalmente.')
            survivors = []
            for pid, created in known:
                try:
                    owned = psutil.Process(pid)
                    if owned.create_time() == created and owned.is_running():
                        survivors.append(pid)
                except psutil.NoSuchProcess:
                    pass
            run['survivors_after_close'] = survivors
            (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            assert not survivors, f'Processos sobreviveram ao fechamento: {survivors}'
    report['median_backend_listening_seconds'] = statistics.median(r['backend_listening_seconds'] for r in report['runs'])
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'report': str(output / 'report.json'), 'idle': report.get('idle'), 'median_backend_listening_seconds': report['median_backend_listening_seconds']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
