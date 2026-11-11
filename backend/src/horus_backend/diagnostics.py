"""Inspeção local sem executar ferramentas, baixar modelos ou consultar serviços."""
import os
from .config import Settings
from .dependencies import find_tool, has_module


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
    return {"checks": checks, "hermes_connected": False,
            "notice": "Verificação de presença apenas. Não executa comandos, testa credenciais ou certifica prontidão para renderizar."}
