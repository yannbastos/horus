import builtins
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

from horus_backend import dependencies, transcriber
from horus_backend.config import Settings
from horus_backend.diagnostics import diagnose


@pytest.fixture(autouse=True)
def clean_configuration(monkeypatch):
    for key in [*dependencies.TOOL_ENV.values(), 'HORUS_TOOLS_DIR', 'HORUS_WHISPER_DEVICE']:
        monkeypatch.delenv(key, raising=False)


def fake_engine(monkeypatch, factory, count=0):
    monkeypatch.setitem(sys.modules, 'ctranslate2', SimpleNamespace(get_cuda_device_count=lambda: count))
    monkeypatch.setitem(sys.modules, 'faster_whisper', SimpleNamespace(WhisperModel=factory))
    frames = []
    monkeypatch.setattr(transcriber, 'emit', lambda kind, message: frames.append((kind, message)))
    return frames


def model_with(segments):
    return SimpleNamespace(transcribe=lambda *args, **kwargs: (iter(segments), SimpleNamespace(duration=10)))


@pytest.mark.parametrize('requested,count,expected', [('auto', 0, 'cpu'), ('cuda', 0, 'cpu'), ('cpu', 1, 'cpu'), ('auto', 1, 'cuda')])
def test_device_and_actual_compute_are_reported(monkeypatch, tmp_path, requested, count, expected):
    calls = []
    def factory(name, **kwargs):
        calls.append(kwargs)
        return model_with([SimpleNamespace(text=' Olá! ', end=10)])
    frames = fake_engine(monkeypatch, factory, count)
    monkeypatch.setenv('HORUS_WHISPER_DEVICE', requested)
    transcriber.transcribe(tmp_path / 'audio.wav', 'tiny', 'pt', tmp_path / 'models')
    assert [item['device'] for item in calls] == [expected]
    assert calls[0]['compute_type'] == ('int8' if expected == 'cpu' else 'float16')
    assert any(kind == 'status' and f'Transcrevendo em {expected.upper()}' in message for kind, message in frames)
    assert [text for kind, text in frames if kind == 'segment'] == ['Olá!']


@pytest.mark.parametrize('failure', ['count', 'load', 'lazy'])
def test_cuda_failures_fallback_once_before_text(monkeypatch, tmp_path, failure):
    calls = []
    def lazy():
        raise RuntimeError('cudnn64 DLL could not be loaded')
        yield  # pragma: no cover
    def factory(name, **kwargs):
        calls.append(kwargs['device'])
        if kwargs['device'] == 'cuda':
            if failure == 'load':
                raise RuntimeError('CUDA driver version insufficient')
            return model_with_generator(lazy())
        return model_with([SimpleNamespace(text='CPU sem duplicação', end=10)])
    frames = fake_engine(monkeypatch, factory, count=1)
    if failure == 'count':
        def unavailable():
            raise OSError('CUDA DLL not found')
        monkeypatch.setattr(sys.modules['ctranslate2'], 'get_cuda_device_count', unavailable)
    transcriber.transcribe(tmp_path / 'a.wav', 'small', 'auto', tmp_path / 'models')
    assert calls == (['cpu'] if failure == 'count' else ['cuda', 'cpu'])
    assert [text for kind, text in frames if kind == 'segment'] == ['CPU sem duplicação']


def model_with_generator(generator):
    return SimpleNamespace(transcribe=lambda *args, **kwargs: (generator, SimpleNamespace(duration=10)))


def test_cuda_failure_after_partial_never_replays_in_cpu(monkeypatch, tmp_path):
    calls = []
    def partial():
        yield SimpleNamespace(text='Parcial preservado', end=3)
        raise RuntimeError('CUDA out of memory')
    def factory(name, **kwargs):
        calls.append(kwargs['device'])
        return model_with_generator(partial())
    frames = fake_engine(monkeypatch, factory, 1)
    with pytest.raises(RuntimeError, match='Texto parcial preservado'):
        transcriber.transcribe(tmp_path / 'a.wav', 'tiny', 'pt', tmp_path / 'models')
    assert calls == ['cuda']
    assert [text for kind, text in frames if kind == 'segment'] == ['Parcial preservado']


@pytest.mark.parametrize('error', [ValueError('invalid media'), RuntimeError('model cache unavailable')])
def test_non_gpu_errors_do_not_fallback_or_repeat_download(monkeypatch, tmp_path, error):
    calls = []
    def factory(name, **kwargs):
        calls.append(kwargs['device'])
        raise error
    fake_engine(monkeypatch, factory, 1)
    with pytest.raises(type(error), match=str(error)):
        transcriber.transcribe(tmp_path / 'a.wav', 'tiny', 'pt', tmp_path / 'models')
    assert calls == ['cuda']


def test_cpu_failure_after_cuda_fallback_is_final(monkeypatch, tmp_path):
    calls = []
    def factory(name, **kwargs):
        calls.append(kwargs['device'])
        raise RuntimeError('CUDA unavailable' if kwargs['device'] == 'cuda' else 'CPU model failure')
    fake_engine(monkeypatch, factory, 1)
    with pytest.raises(RuntimeError, match='CPU model failure'):
        transcriber.transcribe(tmp_path / 'a.wav', 'tiny', 'pt', tmp_path / 'models')
    assert calls == ['cuda', 'cpu']


def test_invalid_device_is_actionable_and_cpu_does_not_probe_cuda(monkeypatch):
    runtime = SimpleNamespace(get_cuda_device_count=lambda: pytest.fail('CPU explícita não deve consultar CUDA'))
    monkeypatch.setenv('HORUS_WHISPER_DEVICE', 'cpu')
    assert transcriber.choose_device(runtime) == 'cpu'
    monkeypatch.setenv('HORUS_WHISPER_DEVICE', 'invalid')
    with pytest.raises(ValueError, match='auto, cpu ou cuda'):
        transcriber.choose_device(runtime)


def test_silent_audio_has_empty_text_and_finishes(monkeypatch, tmp_path):
    frames = fake_engine(monkeypatch, lambda *args, **kwargs: model_with([]))
    transcriber.transcribe(tmp_path / 'silence.wav', 'tiny', 'auto', tmp_path / 'models')
    assert not [item for item in frames if item[0] == 'segment']
    assert frames[-1] == ('progress', '100')


def test_tool_resolution_uses_configuration_shared_folder_and_path(monkeypatch, tmp_path):
    executable = tmp_path / ('ffmpeg.exe' if os.name == 'nt' else 'ffmpeg')
    executable.write_bytes(b'not executed')
    monkeypatch.setattr(dependencies.shutil, 'which', lambda name: '/path/fallback')
    monkeypatch.setenv('HORUS_TOOLS_DIR', str(tmp_path))
    assert dependencies.find_tool('ffmpeg') == str(executable.resolve())
    monkeypatch.setenv('HORUS_FFMPEG', str(tmp_path / 'absent'))
    assert dependencies.find_tool('ffmpeg') is None  # Configuração explícita inválida não usa outro binário silenciosamente.
    monkeypatch.setenv('HORUS_FFMPEG', str(executable))
    assert dependencies.find_tool('ffmpeg') == str(executable.resolve())
    monkeypatch.delenv('HORUS_FFMPEG')
    monkeypatch.delenv('HORUS_TOOLS_DIR')
    assert dependencies.find_tool('ffmpeg') == '/path/fallback'


def test_packaged_tools_can_be_discovered_without_legacy_folders(monkeypatch, tmp_path):
    tools = tmp_path / 'tools'
    tools.mkdir()
    node = tools / ('node.exe' if os.name == 'nt' else 'node')
    node.write_bytes(b'not executed')
    monkeypatch.setattr(sys, 'frozen', True, raising=False)
    monkeypatch.setattr(sys, 'executable', str(tmp_path / 'horus-backend.exe'))
    assert dependencies.find_tool('node') == str(node.resolve())


def test_diagnostics_does_not_load_native_engines(monkeypatch, tmp_path):
    original = builtins.__import__
    def safe_import(name, *args, **kwargs):
        if name.split('.')[0] in {'faster_whisper', 'ctranslate2', 'av', 'yt_dlp'}:
            pytest.fail('Diagnóstico não pode carregar motor nativo')
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, '__import__', safe_import)
    monkeypatch.setattr(dependencies, 'has_module', lambda name: name in {'faster_whisper', 'ctranslate2', 'av', 'yt_dlp'})
    monkeypatch.setattr(dependencies, 'find_tool', lambda name: None)
    # Diagnose importa as funções por nome; substituir os pontos de consulta, não os motores.
    from horus_backend import diagnostics
    monkeypatch.setattr(diagnostics, 'has_module', dependencies.has_module)
    monkeypatch.setattr(diagnostics, 'find_tool', dependencies.find_tool)
    report = diagnose(Settings(token='local-test-token-123456789', data_dir=tmp_path, factory_root=None))
    checks = {item['id']: item for item in report['checks']}
    assert checks['av']['available'] is True
    assert checks['yt-dlp']['available'] is True
    assert dependencies.transcription_capabilities() == {'engine': True, 'downloader': True, 'ffmpeg': False}


def test_downloader_prefers_python_and_uses_discovered_tool_arguments(monkeypatch, tmp_path):
    captured = []
    monkeypatch.setattr(transcriber, 'find_tool', lambda name: {'ffmpeg': 'C:/Media Tools/ffmpeg.exe', 'node': 'C:/Runtime/node.exe'}.get(name))
    monkeypatch.setitem(sys.modules, 'yt_dlp', SimpleNamespace(main=lambda args: captured.append(args)))
    assert transcriber.download('https://youtu.be/dQw4w9WgXcQ', tmp_path) == 0
    args = captured[0]
    assert args[args.index('--ffmpeg-location') + 1] == 'C:/Media Tools/ffmpeg.exe'
    assert args[args.index('--js-runtimes') + 1] == 'node:C:/Runtime/node.exe'
    assert args[-2:] == ['--', 'https://youtu.be/dQw4w9WgXcQ']


def test_downloader_validates_tls_with_system_certificate_store(monkeypatch, tmp_path):
    # Redes com inspeção TLS assinam com CA corporativa presente só no repositório do sistema;
    # o certifi embutido recusa. A verificação continua ativa.
    captured = []
    monkeypatch.setattr(transcriber, 'find_tool', lambda name: None)
    monkeypatch.setitem(sys.modules, 'yt_dlp', SimpleNamespace(main=lambda args: captured.append(args)))
    transcriber.download('https://youtu.be/dQw4w9WgXcQ', tmp_path)
    args = captured[0]
    assert args[args.index('--compat-options') + 1] == 'no-certifi'
    assert '--no-check-certificates' not in args and '--no-check-certificate' not in args


def test_downloader_executable_fallback_does_not_use_shell(monkeypatch, tmp_path):
    import subprocess
    monkeypatch.setitem(sys.modules, 'yt_dlp', None)
    monkeypatch.setattr(transcriber, 'find_tool', lambda name: '/configured/yt-dlp' if name == 'yt-dlp' else None)
    captured = []
    monkeypatch.setattr(subprocess, 'call', lambda args: captured.append(args) or 0)
    assert transcriber.download('https://youtu.be/dQw4w9WgXcQ', tmp_path) == 0
    assert captured[0][0] == '/configured/yt-dlp'
    assert 'best[ext=mp4]/best' in captured[0]


@pytest.mark.parametrize('device,valid', [('auto', True), ('cpu', True), ('cuda', True), ('invalid', False)])
def test_diagnostics_validates_device_configuration_without_gpu_probe(monkeypatch, tmp_path, device, valid):
    monkeypatch.setenv('HORUS_WHISPER_DEVICE', device)
    report = diagnose(Settings(token='local-test-token-123456789', data_dir=tmp_path, factory_root=None))
    item = next(item for item in report['checks'] if item['id'] == 'whisper_device')
    assert item['available'] is valid
    if not valid:
        assert 'auto, cpu ou cuda' in item['detail']
