"""Trava estática (HOR-110): só os módulos do backend listados e documentados podem tocar rede ou processos externos.

Varre `backend/src/horus_backend/**/*.py` por AST (sem importar nada, sem rede) e falha quando um módulo
importa/usa API de rede, cria processo externo ou contém URL externa fora de `ALLOWLIST`.
Cada entrada aponta para um ID (`F-xx`) de `docs/inventario-fluxos-dados.md`. Para liberar um novo ponto:
1) documente-o no inventário (destino, dados, gatilho, controle, estado); 2) só então acrescente-o aqui.
A lista também falha quando uma entrada deixa de ser encontrada, para o inventário não ficar defasado.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "backend" / "src" / "horus_backend"
INVENTORY = ROOT / "docs" / "inventario-fluxos-dados.md"
FRONTEND = ROOT / "frontend" / "src"

# Módulos que abrem rede, escutam portas ou carregam motores que baixam modelos. `urllib.parse` é só texto: fora da lista.
NETWORK_MODULES = {
    "socket", "ssl", "socketserver", "http.client", "http.server", "urllib.request", "urllib3", "httpx", "requests",
    "aiohttp", "websockets", "websocket", "ftplib", "smtplib", "poplib", "imaplib", "telnetlib", "xmlrpc", "uvicorn",
    "huggingface_hub", "faster_whisper", "kokoro", "yt_dlp", "ctranslate2", "webbrowser", "subprocess",
}
# `import http` + `http.client.X` é raro; cobrimos o pacote para não depender do estilo de import.
NETWORK_PACKAGES = {"http", "xmlrpc"}
NETWORK_CALLS = {"open_connection", "open_unix_connection", "start_server", "create_connection", "create_datagram_endpoint",
                 "getaddrinfo", "urlopen", "build_opener", "create_subprocess_exec", "create_subprocess_shell",
                 "system", "popen", "Popen", "check_output", "check_call", "from_pretrained", "snapshot_download",
                 "hf_hub_download", "WhisperModel", "KPipeline", "KModel"}
# `subprocess.run/call` e `OwnedProcess.start` são tratados abaixo (nome qualificado), para não pegar `.run` genérico.
PROCESS_QUALIFIED = {"subprocess.run", "subprocess.call", "OwnedProcess.start"}
DYNAMIC_IMPORTS = {"__import__", "import_module"}
FOREIGN_TEXT = re.compile(r"(?<![\w.])fetch\(|node:(?:net|http|https|dns|tls)|require\(['\"](?:net|http|https|dns|tls)['\"]\)")
URL = re.compile(r"https?://([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::[0-9a-z]*)?(?![A-Za-z0-9.-])", re.I)
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "tauri.localhost"}  # tauri.localhost: origem CORS do WebView, não destino


def _hit(kind: str, detail: str) -> str:
    return f"{kind}:{detail}"


def scan_source(text: str) -> set[str]:
    """Conjunto de achados `tipo:detalhe` de um módulo Python. Puro: não executa o código analisado."""
    tree = ast.parse(text)
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                docstrings.add(id(first.value))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in NETWORK_MODULES or alias.name.split(".")[0] in NETWORK_PACKAGES or alias.name.split(".")[0] in NETWORK_MODULES:
                    found.add(_hit("import", alias.name))
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names = {node.module, *(f"{node.module}.{alias.name}" for alias in node.names)}
            root = node.module.split(".")[0]
            if names & NETWORK_MODULES or root in NETWORK_PACKAGES or root in NETWORK_MODULES:
                found.add(_hit("import", node.module))
        elif isinstance(node, ast.Call):
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else func.id if isinstance(func, ast.Name) else None
            qualified = f"{func.value.id}.{func.attr}" if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) else name
            if name in DYNAMIC_IMPORTS:
                found.add(_hit("dynamic_import", name))
            if name in NETWORK_CALLS:
                found.add(_hit("call", name))
            elif qualified in PROCESS_QUALIFIED:
                found.add(_hit("call", qualified))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            for host in URL.findall(node.value):
                if host.split(":")[0].lower() not in LOOPBACK_HOSTS:
                    found.add(_hit("url", host.lower()))
            if FOREIGN_TEXT.search(node.value):
                found.add(_hit("embedded_js_network", "fetch/net/http"))
    return found


# arquivo (relativo a horus_backend) -> {achado: ID do inventário}. Qualquer achado fora daqui reprova.
ALLOWLIST: dict[str, dict[str, str]] = {
    "hermes.py": {  # F-01 diagnóstico loopback do Hermes
        "import:urllib.request": "F-01", "call:build_opener": "F-01"},
    "workflow_hermes.py": {  # F-02 execuções cognitivas (gate + autorização) em loopback
        "import:urllib.request": "F-02", "call:build_opener": "F-02"},
    "radar_youtube/transport.py": {  # F-03 YouTube Data API, desligado por padrão
        "import:socket": "F-03", "import:ssl": "F-03", "import:urllib.request": "F-03", "call:build_opener": "F-03",
        "url:www.googleapis.com": "F-03"},
    "transcriber.py": {  # F-04 download de modelo Whisper, F-05 yt-dlp
        "import:faster_whisper": "F-04", "call:WhisperModel": "F-04", "import:ctranslate2": "F-04", "import:subprocess": "F-05", "import:yt_dlp": "F-05", "call:subprocess.call": "F-05"},
    "jobs.py": {  # F-04/F-05/F-12 workers de tarefa herdam o ambiente completo
        "call:OwnedProcess.start": "F-04"},
    "processes.py": {"call:create_subprocess_exec": "F-11"},  # F-11 lançador único de processos possuídos
    "__main__.py": {"import:socket": "F-10", "import:uvicorn": "F-10"},  # F-10 API local em 127.0.0.1
    "narration/kokoro_worker.py": {  # F-07 Kokoro offline com bloqueio de socket
        "import:socket": "F-07", "import:kokoro": "F-07", "call:KModel": "F-07", "call:KPipeline": "F-07"},
    "narration/kokoro.py": {"call:OwnedProcess.start": "F-07", "url:huggingface.co": "F-07"},  # URL só em metadado de licença
    "narration/providers.py": {  # F-08 SAPI/Piper locais, F-09 ElevenLabs sem transporte
        "import:subprocess": "F-08", "url:www.microsoft.com": "F-08", "url:github.com": "F-08", "url:elevenlabs.io": "F-09"},
    "speech_alignment.py": {  # F-06 ASR offline para alinhamento
        "call:OwnedProcess.start": "F-06", "import:faster_whisper": "F-06", "call:WhisperModel": "F-06"},
    "local_pilot.py": {  # URLs de licença de fonte/fonte tipográfica são metadado, nunca acessadas
        "call:OwnedProcess.start": "F-11", "url:github.com": "F-11", "url:learn.microsoft.com": "F-11",
        "url:openfontlicense.org": "F-11"},
    "production.py": {"call:OwnedProcess.start": "F-12"},
    "av_quality.py": {"call:OwnedProcess.start": "F-13"},
    "production_worker.py": {  # F-12 render Remotion offline com auditoria de rede
        "import:http.server": "F-12", "import:socket": "F-12", "import:subprocess": "F-12", "call:subprocess.run": "F-12",
        "embedded_js_network:fetch/net/http": "F-12"},
    # Adaptadores sem transporte: só constroem pedidos/convertem respostas já obtidas; URLs são documentação.
    "asset_sources/pexels.py": {"url:api.pexels.com": "F-15", "url:www.pexels.com": "F-15"},
    "asset_sources/pixabay.py": {"url:pixabay.com": "F-15"},
    "radar_workflow.py": {"url:example.org": "F-16"},  # URL fictícia de fixture simulada
    "radar_youtube/collector.py": {"url:www.youtube.com": "F-03"},  # só monta links de registros públicos
}
ALLOWLIST["narration/providers.py"]["call:subprocess.run"] = "F-08"

# Frontend: só o cliente HTTP dos serviços fala com a API local (CSP do Tauri limita connect-src a loopback).
FRONTEND_FETCH_FILES = {"services/api.ts", "services/narration.ts", "services/production.ts"}


def _scan_tree() -> dict[str, set[str]]:
    results = {}
    for path in sorted(SOURCE.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        hits = scan_source(path.read_text(encoding="utf-8-sig"))
        if hits:
            results[path.relative_to(SOURCE).as_posix()] = hits
    return results


def test_backend_network_surface_is_allowlisted():
    unexpected = []
    for file, hits in _scan_tree().items():
        for hit in sorted(hits - set(ALLOWLIST.get(file, {}))):
            unexpected.append(f"{file}: {hit}")
    assert not unexpected, (
        "API de rede/processo externo fora da allowlist. Documente o fluxo em docs/inventario-fluxos-dados.md "
        "e só então registre em ALLOWLIST (HOR-110):\n" + "\n".join(unexpected))


def test_allowlist_has_no_stale_entries():
    scanned = _scan_tree()
    stale = [f"{file}: {hit}" for file, entries in ALLOWLIST.items() for hit in entries
             if hit not in scanned.get(file, set())]
    assert not stale, "Entradas da allowlist que o código não usa mais; atualize teste e inventário:\n" + "\n".join(stale)


def test_every_allowlisted_flow_is_documented_in_inventory():
    inventory = INVENTORY.read_text(encoding="utf-8-sig")
    documented = set(re.findall(r"\bF-\d{2}\b", inventory))
    used = {flow for entries in ALLOWLIST.values() for flow in entries.values()}
    assert used <= documented, f"IDs sem linha no inventário: {sorted(used - documented)}"
    assert "ALLOWLIST" in inventory and "test_network_inventory.py" in inventory


def test_scanner_detects_new_network_usage():
    samples = {
        "import:httpx": "import httpx\n",
        "import:requests": "from requests import get\n",
        "import:urllib.request": "from urllib.request import urlopen\n",
        "call:urlopen": "import urllib.request as u\nu.urlopen('x')\n",
        "import:socket": "import socket\n",
        "import:http.client": "import http.client\n",
        "call:open_connection": "import asyncio\nasyncio.open_connection('h', 1)\n",
        "call:subprocess.run": "import subprocess\nsubprocess.run(['curl', 'x'])\n",
        "call:create_subprocess_exec": "import asyncio\nasyncio.create_subprocess_exec('x')\n",
        "call:OwnedProcess.start": "OwnedProcess.start(['x'])\n",
        "dynamic_import:import_module": "import importlib\nimportlib.import_module('httpx')\n",
        "call:from_pretrained": "Model.from_pretrained('x')\n",
        "url:api.exemplo.com": "URL = 'https://api.exemplo.com/v1'\n",
        "embedded_js_network:fetch/net/http": "JS = \"require('node:net')\"\n",
    }
    for expected, code in samples.items():
        assert expected in scan_source(code), expected


def test_scanner_ignores_local_and_text_only_usage():
    code = ('"""Doc com https://exemplo.com/licenca em docstring."""\n'
            "from urllib.parse import urlsplit\nimport json\n"
            "BASE = 'http://127.0.0.1:8765'\nLOCAL = 'http://localhost:1420/x'\n"
            "def f(path):\n    return urlsplit(path).hostname\n")
    assert scan_source(code) == set()


def test_frontend_fetch_is_limited_to_service_clients():
    if not FRONTEND.is_dir():
        return
    offenders = []
    for path in FRONTEND.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or ".test." in path.name:
            continue
        relative = path.relative_to(FRONTEND).as_posix()
        text = path.read_text(encoding="utf-8")
        if re.search(r"(?<![\w.])(?:fetch\(|XMLHttpRequest|new WebSocket|EventSource\(|sendBeacon)", text) and relative not in FRONTEND_FETCH_FILES:
            offenders.append(relative)
    assert not offenders, f"Chamada de rede fora dos clientes de serviço (documente em F-14): {offenders}"
