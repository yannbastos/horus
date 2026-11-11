"""Somente GET nos endpoints públicos oficiais; rede exige opt-in explícito."""
import json
import socket
import ssl
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener
from pydantic import SecretStr

ENDPOINTS = {'search', 'videos', 'channels', 'playlistItems'}

class CollectionError(RuntimeError):
    def __init__(self, code, message, *, retryable=False, quota=False):
        super().__init__(message)
        self.code, self.retryable, self.quota = code, retryable, quota

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class GoogleTransport:
    def __init__(self, api_key: str, *, allow_network=False, timeout=15):
        if not api_key.strip() or not 1 <= timeout <= 60:
            raise ValueError('Chave e timeout válido são necessários.')
        self._key, self.allow_network, self.timeout = SecretStr(api_key), allow_network, timeout

    def get(self, resource, params):
        if not self.allow_network:
            raise CollectionError('network_disabled', 'Rede desabilitada; use fixtures ou autorize a coleta real.')
        if resource not in ENDPOINTS or 'key' in params:
            raise ValueError('Endpoint/parâmetros não autorizados.')
        # Chave somente no transporte, nunca em parâmetros persistidos, datasets ou mensagens de erro.
        url = 'https://www.googleapis.com/youtube/v3/' + resource + '?' + urlencode({**params, 'key': self._key.get_secret_value()})
        try:
            opener = build_opener(NoRedirect(), HTTPSHandler(context=ssl.create_default_context()))
            with opener.open(Request(url, headers={'Accept': 'application/json'}), timeout=self.timeout) as response:
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise CollectionError('response_too_large', 'Resposta excedeu o limite local.')
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except HTTPError as error:
            reason = ''
            try:
                body = json.loads(error.read(100_000))
                reason = body['error']['errors'][0]['reason']
            except (ValueError, KeyError, IndexError, TypeError):
                pass
            if reason in {'quotaExceeded', 'dailyLimitExceeded'}:
                raise CollectionError('upstream_quota', 'Cota recusada pelo YouTube.', quota=True) from None
            retryable = error.code in {429, 500, 502, 503, 504} or reason in {'rateLimitExceeded', 'userRateLimitExceeded'}
            code = 'rate_limit' if error.code == 429 or reason in {'rateLimitExceeded', 'userRateLimitExceeded'} else f'http_{error.code}'
            raise CollectionError(code, 'YouTube recusou a consulta; verifique acesso/configuração.', retryable=retryable) from None
        except (URLError, socket.timeout, TimeoutError, OSError):
            raise CollectionError('transport', 'Falha de transporte HTTPS; sem substituição por scraping.', retryable=True) from None
        except (ValueError, UnicodeError):
            raise CollectionError('invalid_response', 'Resposta JSON inválida do YouTube.') from None
