"""Adaptador de diagnóstico da API pública Hermes; não envia prompts nem inicia agentes."""
from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .config import Settings

MAX_RESPONSE = 128 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_connection(settings: Settings):
    with settings.hermes_config.open("rb") as source:
        raw = source.read(16 * 1024 + 1)
    if len(raw) > 16 * 1024:
        raise ValueError("Configuração excessiva")
    config = json.loads(raw)
    if not isinstance(config, dict):
        raise ValueError("Configuração inválida")
    url, token = config.get("base_url"), config.get("token")
    if not isinstance(url, str) or not isinstance(token, str) or not 16 <= len(token) <= 4096:
        raise ValueError("Configuração incompleta")
    if any(ord(char) < 33 or ord(char) > 126 for char in token):
        raise ValueError("Credencial inválida")
    validate_origin(url)
    return url.rstrip("/"), token


def validate_origin(url: str):
    if not isinstance(url, str) or any(ord(char) <= 32 or ord(char) > 126 for char in url):
        raise ValueError("Origem local inválida")
    parsed = urlsplit(url)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1"}
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"} or not parsed.port
            ):
        raise ValueError("Use uma API local com porta explícita")


def get_json(base_url: str, token: str, path: str):
    validate_origin(base_url)
    # Ignorar proxies de ambiente e recusar redirects: a credencial fica na origem local.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    request = Request(base_url + path, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    with opener.open(request, timeout=3) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ValueError("Resposta excessiva")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Resposta inválida")
    return value


class HermesConnector:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.lock = asyncio.Lock()
        self.last_report = None
        self.last_check = 0.0

    def status(self):
        if self.last_report:
            report = dict(self.last_report)
            if report["state"] == "connected" and time.monotonic() - self.last_check > 90:
                report.update(state="stale", connected=False, message="Verificação anterior expirou. Verifique a conexão novamente.")
            return report
        return self.report("not_checked", "Conexão com a API ainda não verificada.", checked=False)

    def report(self, state, message, *, checked=True, version=None, features=None):
        return {"state": state, "connected": state == "connected", "cli_available": self.settings.hermes_executable is not None,
                "configured": self.settings.hermes_config.is_file(), "message": message,
                "checked_at": datetime.now(timezone.utc).isoformat() if checked else None,
                "version": version, "features": features or []}

    def _probe(self):
        try:
            base_url, token = read_connection(self.settings)
        except FileNotFoundError:
            return self.report("not_configured", "Prepare a conexão local do Hermes seguindo o guia de integração.")
        except (ValueError, OSError, UnicodeError):
            return self.report("invalid_config", "Configuração local inválida. Confira o arquivo privado de conexão.")
        try:
            health = get_json(base_url, token, "/health")
            if health.get("platform") != "hermes-agent" or health.get("status") != "ok":
                return self.report("incompatible", "O serviço local não confirmou ser a API do Hermes Agent.")
            capabilities = get_json(base_url, token, "/v1/capabilities")
            auth = capabilities.get("auth")
            if (capabilities.get("object") != "hermes.api_server.capabilities"
                    or capabilities.get("platform") != "hermes-agent"
                    or not isinstance(auth, dict) or auth.get("type") != "bearer" or auth.get("required") is not True):
                return self.report("incompatible", "A API precisa anunciar capacidades Hermes e autenticação Bearer obrigatória.")
            available = capabilities.get("features", {})
            if not isinstance(available, dict):
                raise ValueError("Capacidades inválidas")
            features = [name for name in ("run_submission", "responses_api", "chat_completions") if available.get(name) is True]
            version = health.get("version")
            version = version if isinstance(version, str) and len(version) <= 64 and re.fullmatch(r"v?\d+\.\d+\.\d+(?:[.+_-][A-Za-z0-9.+_-]+)?", version) else None
            return self.report("connected", "API autenticada verificada. Nenhum prompt ou produção foi enviado.", version=version, features=features)
        except HTTPError as error:
            error.close()
            if error.code in {401, 403}:
                return self.report("unauthorized", "O Hermes recusou a credencial local. Confira a chave da conexão.")
            return self.report("incompatible", "O serviço não disponibilizou os endpoints de diagnóstico esperados.")
        except (URLError, OSError, TimeoutError):
            return self.report("unavailable", "A API local não respondeu. Confira se o gateway do perfil Hórus está ativo.")
        except (ValueError, UnicodeError):
            return self.report("incompatible", "A API devolveu um diagnóstico inválido ou acima do limite.")

    async def probe(self):
        async with self.lock:
            if self.last_report and time.monotonic() - self.last_check < 2:
                return self.status()
            self.last_report = await asyncio.to_thread(self._probe)
            self.last_check = time.monotonic()
            return self.status()
