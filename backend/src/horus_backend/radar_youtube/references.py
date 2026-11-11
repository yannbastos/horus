"""Extrai identificadores, sem abrir URLs ou recorrer a scraping."""
import re
from urllib.parse import parse_qs, unquote, urlsplit

VIDEO = re.compile(r'^[A-Za-z0-9_-]{11}$')
CHANNEL = re.compile(r'^UC[A-Za-z0-9_-]{22}$')
HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'}

def _url(value):
    try:
        url = urlsplit(value)
        if url.scheme != 'https' or url.username or url.password or url.port:
            raise ValueError()
        if url.hostname not in HOSTS | {'youtu.be'}:
            raise ValueError()
        return url
    except ValueError:
        raise ValueError('Use ID ou URL HTTPS oficial do YouTube, sem credenciais/porta.') from None

def video_id(value: str) -> str:
    value = value.strip()
    if VIDEO.fullmatch(value):
        return value
    url = _url(value)
    parts = url.path.strip('/').split('/')
    if url.hostname == 'youtu.be' and len(parts) == 1:
        result = parts[0]
    elif url.path == '/watch':
        candidates = parse_qs(url.query).get('v', [])
        result = candidates[0] if len(candidates) == 1 else ''
    elif len(parts) == 2 and parts[0] in {'shorts', 'live', 'embed'}:
        result = parts[1]
    else:
        result = ''
    if not VIDEO.fullmatch(result):
        raise ValueError('Vídeo inválido; playlists e referências ambíguas não são aceitas.')
    return result

def channel_reference(value: str) -> tuple[str, str]:
    value = value.strip()
    if CHANNEL.fullmatch(value):
        return 'id', value
    if value.startswith('https://'):
        url = _url(value)
        if url.hostname not in HOSTS:
            raise ValueError('URL de canal inválida.')
        parts = [unquote(part) for part in url.path.strip('/').split('/')]
        if len(parts) > 1 and parts[-1] in {'videos', 'shorts', 'streams', 'featured', 'about'}:
            parts.pop()
        if len(parts) == 2 and parts[0] == 'channel' and CHANNEL.fullmatch(parts[1]):
            return 'id', parts[1]
        if len(parts) == 2 and parts[0] == 'user' and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', parts[1]):
            return 'forUsername', parts[1]
        if len(parts) != 1:
            raise ValueError('Use channel ID ou @handle; /c/ não é resolvido por scraping.')
        value = parts[0]
    if re.fullmatch(r'@[^\s/?#@]{1,100}', value):
        return 'forHandle', value
    raise ValueError('Canal inválido. Use channel ID, @handle ou URL oficial suportada.')
