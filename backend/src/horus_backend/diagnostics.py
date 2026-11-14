"""Inspeção local sem mídia, downloads ou serviços; SAPI apenas enumera vozes."""
import os
from pathlib import Path
from .config import Settings
from .dependencies import find_tool, has_module
from .narration.kokoro import Kokoro
from .narration.providers import WindowsSapi, NarrationError
from .speech_alignment import resolve_model_path


def production_diagnostics(settings: Settings):
    """Pré-condições locais; nunca carrega motores nem executa mídia ou rede."""
    checks = []

    def add(ident, name, available, instruction, required_for=('draft', 'final')):
        checks.append(dict(id=ident, name=name, available=bool(available),
                           detail=('Presença local verificada. ' if available else 'Indisponível. ') + instruction,
                           required_for=list(required_for)))

    source = settings.factory_root
    files = ['scripts/.venv/' + ('Scripts/python.exe' if os.name == 'nt' else 'bin/python'),
             'remotion/package.json', 'remotion/package-lock.json', 'remotion/tsconfig.json']
    factory = bool(source and all((source / p).is_file() for p in files)
                   and (source / 'remotion/src').is_dir()
                   and any((source / ('remotion/node_modules/.bin/' + p)).is_file()
                           for p in ('remotion.cmd', 'remotion')))
    add('factory', 'Fábrica do piloto', factory,
        'Configure FABRICA_HOME (ou HORUS_PILOT_FACTORY) e prepare scripts/.venv, código e dependências Remotion pelos locks.')
    browsers = [os.environ.get('HORUS_DEMO_BROWSER', ''),
                'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
                'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
    add('browser', 'Navegador do render', any(Path(p).is_file() for p in browsers if p),
        'Prepare um navegador local e configure HORUS_DEMO_BROWSER quando necessário.')
    ffmpeg = settings.ffmpeg
    add('ffmpeg', 'FFmpeg do piloto', ffmpeg and ffmpeg.is_file(),
        'Configure HORUS_FFMPEG com o executável local preparado com subtitles/libass; filtros não são executados nesta consulta.')
    add('ffprobe', 'FFprobe do piloto', ffmpeg and ffmpeg.with_name('ffprobe' + ffmpeg.suffix).is_file(),
        'Prepare ffprobe ao lado do executável indicado em HORUS_FFMPEG; mantenha também as ferramentas acessíveis ao worker pelo PATH ou compositor Remotion.')
    model = settings.alignment_model
    model_path = resolve_model_path(Path(model), 'small') if model else None
    add('alignment_model', 'Modelo de alinhamento', model_path and all(
        (model_path / p).is_file() for p in ('model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt')),
        'Configure HORUS_ALIGNMENT_MODEL com small/ ou faster-whisper-small/ contendo model.bin, config.json, tokenizer.json e vocabulary.txt.')
    add('alignment_engine', 'Motor de alinhamento', all(has_module(m) for m in ('faster_whisper', 'ctranslate2', 'av')),
        'Prepare o extra de transcrição do backend; o modelo não é carregado nesta consulta.')
    try:
        sapi = any(v['language'].lower() == 'pt-br' for v in WindowsSapi().voices())
    except (NarrationError, OSError):
        sapi = False
    add('sapi_pt_br', 'Voz SAPI pt-BR', sapi,
        'Instale uma voz SAPI pt-BR no Windows e confira Ajustes/Narração.', ('windows_sapi',))
    try:
        kokoro = Kokoro(settings.kokoro_python, settings.kokoro_model_dir).verify()
    except (NarrationError, OSError, ValueError):
        kokoro = False
    add('kokoro', 'Kokoro local', kokoro,
        'Configure HORUS_KOKORO_PYTHON e HORUS_KOKORO_MODEL_DIR com executável e pesos/vozes de hashes oficiais; confira Ajustes/Narração.', ('kokoro',))
    configured = settings.subtitle_font
    local = next((p / 'frontend/public/fonts/ArchivoExpanded-SemiBold.ttf'
                  for p in Path(__file__).resolve().parents
                  if (p / 'frontend/public/fonts/ArchivoExpanded-SemiBold.ttf').is_file()), None)
    font = Path(configured) if configured else local or Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts/ariblk.ttf'
    add('subtitle_font', 'Fonte das legendas', font.is_file() and font.name in {'ArchivoExpanded-SemiBold.ttf', 'ariblk.ttf'},
        'Configure HORUS_SUBTITLE_FONT com ArchivoExpanded-SemiBold.ttf ou ariblk.ttf existente, ou prepare a fonte padrão do aplicativo.')
    missing = [c['id'] for c in checks if not c['available']]
    common_ready = not any(not c['available'] for c in checks if 'draft' in c['required_for'])
    return dict(checks=checks, ready=common_ready and bool(sapi or kokoro), missing=missing)


def diagnose(settings: Settings):
    checks = []
    command = settings.command()
    checks.append({"id": "factory", "name": "CLI fabrica", "available": command is not None,
                   "detail": "Comando localizado; execução e dependências ainda precisam ser validadas." if command else
                   "Configure FABRICA_HOME e prepare o ambiente Python da fábrica."})
    for name, detail in (
        ("ffmpeg", "Opcional para transcrição via PyAV; permite mesclar vídeo/áudio do download."),
        ("ffprobe", "Inspeção técnica de mídia."),
        ("node", "Runtime usado pelo Remotion; não confirma dependências do projeto."),
    ):
        available = find_tool(name) is not None
        checks.append({"id": name, "name": name, "available": available,
                       "detail": detail if available else "Não localizado na configuração de ferramentas ou PATH do backend."})
    for module, name, detail in (
        ('faster_whisper', 'Whisper Python', 'Motor de transcrição; modelos são preparados no primeiro uso.'),
        ('ctranslate2', 'CTranslate2', 'CPU int8; CUDA exige driver e bibliotecas compatíveis. Presença não valida GPU.'),
        ('av', 'PyAV', 'Decodifica áudio/vídeo sem instalar outro FFmpeg para transcrever.'),
        ('yt_dlp', 'yt-dlp Python', 'Downloader fornecido pelo backend; evita depender de outro executável.'),
    ):
        checks.append({'id': module, 'name': name, 'available': has_module(module), 'detail': detail})
    checks.append({'id': 'yt-dlp', 'name': 'Downloader disponível',
                   'available': has_module('yt_dlp') or find_tool('yt-dlp') is not None,
                   'detail': 'Usa o módulo Python quando presente; executável configurado/PATH como alternativa.'})
    device = os.environ.get('HORUS_WHISPER_DEVICE', 'auto').strip().lower()
    checks.append({'id': 'whisper_device', 'name': 'Modo de transcrição', 'available': device in {'auto', 'cpu', 'cuda'},
                   'detail': f'Modo {device.upper()}. GPU é verificada somente ao transcrever; fallback CPU antes do primeiro trecho.'
                   if device in {'auto', 'cpu', 'cuda'} else 'HORUS_WHISPER_DEVICE inválido. Use auto, cpu ou cuda.'})
    checks.append({"id": "hermes", "name": "Hermes CLI", "available": settings.hermes_executable is not None,
                   "detail": "A presença do CLI não confirma conexão com a API. Use a verificação Hermes em Ajustes."})
    return {"checks": checks, "hermes_connected": False, "production": production_diagnostics(settings),
            "notice": "Verificação de presença apenas. Não executa comandos, testa credenciais ou certifica prontidão para renderizar."}
