"""Inspeção local sem executar ferramentas, baixar modelos ou consultar serviços."""
import shutil

from .config import Settings


def diagnose(settings: Settings):
    checks = []
    command = settings.command()
    checks.append({"id": "factory", "name": "CLI fabrica", "available": command is not None,
                   "detail": "Comando localizado; execução e dependências ainda precisam ser validadas." if command else
                   "Configure FABRICA_HOME e prepare o ambiente Python da fábrica."})
    for name, detail in (
        ("ffmpeg", "Conversão de áudio e vídeo."),
        ("ffprobe", "Inspeção técnica de mídia."),
        ("node", "Runtime usado pelo Remotion; não confirma dependências do projeto."),
    ):
        available = shutil.which(name) is not None
        checks.append({"id": name, "name": name, "available": available,
                       "detail": detail if available else "Não localizado no PATH do backend."})
    checks.append({"id": "hermes", "name": "Hermes CLI", "available": settings.hermes_executable is not None,
                   "detail": "A presença do CLI não confirma conexão com a API. Use a verificação Hermes em Ajustes."})
    return {"checks": checks, "hermes_connected": False,
            "notice": "Verificação de presença apenas. Não executa comandos, testa credenciais ou certifica prontidão para renderizar."}
