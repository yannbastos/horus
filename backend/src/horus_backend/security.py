"""Auditoria local conservadora do Hermes 0.23.1; nunca executa código do agente."""
from __future__ import annotations

import ast
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

MAX_CONFIG = 256 * 1024

# Snapshot estático das categorias do Hermes 0.23.1. Extensões desconhecidas falham fechado.
TOOLSETS = {
    'web': {'web_search', 'web_extract'}, 'search': {'web_search'},
    'terminal': {'terminal', 'process_manage'},
    'file': {'read_file', 'write_file', 'patch', 'search_files'},
    'code_execution': {'execute_code'}, 'vision': {'vision_analyze'},
    'video': {'video_analyze'}, 'image_gen': {'image_generate'},
    'video_gen': {'video_generate', 'xai_video_edit', 'xai_video_extend'},
    'x_search': {'x_search'}, 'browser': {'browser_exec', 'browser_cdp', 'browser_dialog', 'browser_vault'},
    'skills': {'skills_list', 'skill_view', 'skill_manage'}, 'todo': {'todo_list'},
    'memory': {'memory'}, 'session_search': {'session_search'},
    'connections': {'manage_connections'}, 'clarify': {'clarify'},
    'delegation': {'delegate_task'}, 'cronjob': {'cronjob_manage'},
    'computer_use': {'computer_use'}, 'tts': {'text_to_speech'},
    'kanban': {'kanban_' + name for name in ('show', 'list', 'complete', 'block', 'request_review',
        'request_changes', 'heartbeat', 'comment', 'create', 'link', 'unblock', 'attach', 'attach_url', 'attachments')},
    'discord': {'discord'}, 'discord_admin': {'discord_admin'},
}
DEFAULT_OFF = {'kanban', 'discord', 'discord_admin', 'video', 'video_gen', 'x_search'}
CORE = set().union(*(tools for name, tools in TOOLSETS.items() if name not in DEFAULT_OFF))
API_DEFAULT = CORE - {'text_to_speech', 'clarify', 'computer_use'}
BUNDLES = {'hermes-api-server': API_DEFAULT, 'hermes-cli': CORE | TOOLSETS['kanban'],
           'debugging': TOOLSETS['terminal'] | TOOLSETS['file'] | TOOLSETS['web'],
           'safe': TOOLSETS['web'] | TOOLSETS['vision'] | TOOLSETS['image_gen']}


class Unverifiable(ValueError):
    """Mensagem pública fixa; nunca inclui conteúdo ou caminho do arquivo."""


class SecurityGate(ValueError):
    pass


def _comment(line):
    quote = None
    escaped = False
    for index, char in enumerate(line):
        if escaped:
            escaped = False
        elif char == '\\' and quote == '"':
            escaped = True
        elif char in "\"'":
            quote = None if quote == char else char if quote is None else quote
        elif char == '#' and quote is None and (index == 0 or line[index - 1].isspace()):
            return line[:index].rstrip()
    if quote:
        raise Unverifiable('YAML fora do subconjunto verificável.')
    return line.rstrip()


def _scalar(text):
    text = text.strip()
    if text in {'true', 'false'}:
        return text == 'true'
    if text in {'null', '~'}:
        return None
    if re.fullmatch(r'-?(0|[1-9][0-9]*)', text):
        return int(text)
    if text.startswith('['):
        if not text.endswith(']'):
            raise Unverifiable('Lista inválida.')
        inside = text[1:-1].strip()
        # Somente escalares simples, sem vírgulas entre aspas nem listas aninhadas.
        if any(c in inside for c in '[]{}'):
            raise Unverifiable('Lista complexa.')
        return [_scalar(item) for item in inside.split(',')] if inside else []
    if text.startswith(('"', "'")):
        try:
            # YAML e Python divergem em escapes: aceitar apenas JSON para aspas duplas;
            # aspas simples somente sem escapes/dobras.
            value = json.loads(text) if text.startswith('"') else ast.literal_eval(text)
        except (ValueError, SyntaxError):
            raise Unverifiable('Escalar inválido.') from None
        if not isinstance(value, str) or (text.startswith("'") and ('\\' in text or "''" in text)):
            raise Unverifiable('Escalar não suportado.')
        return value
    if (not text or any(c in text for c in '{}[]&*!|>\"\'`') or ': ' in text
            or text.lower() in {'yes', 'no', 'on', 'off', 'true', 'false', 'null'}
            or text.startswith(('%', '@', '-', '?'))):
        raise Unverifiable('YAML fora do subconjunto verificável.')
    return text


def parse_yaml_subset(raw: str) -> dict:
    """Mapas, listas de escalares, escalares simples; sem tags, âncoras ou coerções ambíguas."""
    if len(raw.encode('utf-8')) > MAX_CONFIG or '\t' in raw:
        raise Unverifiable('Configuração excessiva ou não suportada.')
    lines = []
    for line in raw.splitlines():
        clean = _comment(line)
        if clean.strip():
            indent = len(clean) - len(clean.lstrip(' '))
            lines.append((indent, clean.strip()))
    if not lines or lines[0][0] != 0:
        raise Unverifiable('Configuração vazia ou inválida.')

    def block(index, indent, depth=0):
        if depth > 24:
            raise Unverifiable('Configuração muito aninhada.')
        sequence = lines[index][1].startswith('- ')
        result = [] if sequence else {}
        while index < len(lines) and lines[index][0] == indent:
            text = lines[index][1]
            if sequence:
                if not text.startswith('- '):
                    raise Unverifiable('Lista inválida.')
                result.append(_scalar(text[2:]))
                index += 1
            else:
                match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_-]*):(?: (.*))?', text)
                if not match or match[1] in result:
                    raise Unverifiable('Chave inválida ou duplicada.')
                key, value = match.groups()
                index += 1
                if value is not None and value.strip():
                    result[key] = _scalar(value)
                elif index < len(lines) and lines[index][0] > indent:
                    result[key], index = block(index, lines[index][0], depth + 1)
                else:
                    result[key] = None
            if index < len(lines) and lines[index][0] > indent:
                raise Unverifiable('Indentação inválida.')
        return result, index

    result, end = block(0, 0)
    if end != len(lines) or not isinstance(result, dict):
        raise Unverifiable('Configuração inválida.')
    return result


def _map(config, key):
    value = config.get(key)
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise Unverifiable('Seção inválida.')
    return value


def _names(value):
    if isinstance(value, str):
        try:
            value = ast.literal_eval(value)
        except (ValueError, SyntaxError):
            raise Unverifiable('Lista de ferramentas inválida.') from None
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
        raise Unverifiable('Lista de ferramentas inválida.')
    return value


def resolve_tools(config: dict, env_names=frozenset()):
    selected = _map(config, 'platform_toolsets').get('api_server')
    explicit = isinstance(selected, list) or isinstance(selected, str) and selected.startswith('[')
    selected = _names(selected) if explicit else ['hermes-api-server']
    selected = [alias for name in selected for alias in (['hermes-cli', 'hermes-api-server'] if name == 'hermes' else [name])]
    if any(name not in TOOLSETS and name not in BUNDLES and name != 'no_mcp' for name in selected):
        raise Unverifiable('Ferramenta não catalogada.')
    enabled = {name for name in selected if name in TOOLSETS}
    composite = set().union(*(BUNDLES.get(name, set()) for name in selected))
    enabled |= {name for name, tools in TOOLSETS.items() if tools <= composite and name not in DEFAULT_OFF}
    # Hermes injeta x_search em seleção composta quando há credenciais xAI; não presume valores.
    if 'XAI_API_KEY' in env_names and not any(name in TOOLSETS for name in selected):
        raise Unverifiable('Credencial pode habilitar ferramenta fora da seleção explícita.')
    if not explicit and 'kanban' in (config.get('toolsets') or []):
        enabled.add('kanban')
    tools = set().union(*(TOOLSETS[name] for name in enabled))
    disabled = _map(config, 'agent').get('disabled_toolsets', [])
    for name in _names(disabled):
        legacy = name.removesuffix('_tools')
        if legacy not in TOOLSETS and legacy not in BUNDLES:
            raise Unverifiable('Supressão não catalogada.')
        tools -= TOOLSETS.get(legacy, BUNDLES.get(legacy, set()))
    return sorted(tools), 'platform_toolsets.api_server' if explicit else 'default:hermes-api-server'


def _read(path: Path):
    with path.open('rb') as stream:
        raw = stream.read(MAX_CONFIG + 1)
    if len(raw) > MAX_CONFIG:
        raise Unverifiable('Arquivo excessivo.')
    return raw.decode('utf-8-sig')


def env_key_names(path: Path):
    if not path.exists():
        return set()
    names = set()
    # Valores não são interpretados, retornados nem registrados.
    for line in _read(path).splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
        if not match:
            raise Unverifiable('Formato de ambiente não verificável.')
        names.add(match[1])
    return names


def profile_default():
    if os.name == 'nt':
        return Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData/Local')) / 'hermes/profiles/horus'
    return Path.home() / '.hermes/profiles/horus'


def audit_profile(path: Path):
    found = path.is_dir()
    try:
        config = parse_yaml_subset(_read(path / 'config.yaml'))
        names = env_key_names(path / '.env') | set(os.environ)
        # Extensões podem registrar ferramentas mesmo com api_server: []. Não as executar/importar;
        # registra somente nomes e contagens, nunca conteúdo.
        extensions = []
        for key in ('mcp_servers', 'custom_toolsets', 'hooks'):
            value = config.get(key)
            if value:
                extensions.append((key, len(value) if isinstance(value, (dict, list)) else 1))
        for dirname in ('plugins', 'skills', 'cron'):
            directory = path / dirname
            if directory.exists():
                count = sum(1 for _ in directory.iterdir())
                if count:
                    extensions.append((dirname, count))
        plugins = _map(config, 'plugins')
        if plugins.get('enabled') or plugins.get('auto_apply'):
            extensions.append(('config.plugins', 1))
        if _map(config, 'context').get('engine', 'compressor') != 'compressor':
            extensions.append(('context.engine', 1))
        overrides = sum(1 for name in names if name.startswith(('HERMES_TOOL', 'HERMES_MEMORY', 'HERMES_PLUGIN', 'HERMES_ENABLE_PROJECT_PLUGINS', 'HERMES_BUNDLED_PLUGINS', 'MEMORY_')))
        if overrides:
            extensions.append(('env.overrides', overrides))
        effective, source = resolve_tools(config, names)
        memory = _map(config, 'memory')
        flags = {key: memory.get(key, default) for key, default in
                 [('memory_enabled', True), ('user_profile_enabled', True), ('write_approval', False)]}
        if any(type(value) is not bool for value in flags.values()):
            raise Unverifiable('Flags de memória não verificáveis.')
        provider = memory.get('provider', '')
        if not isinstance(provider, str):
            raise Unverifiable('Provedor de memória não verificável.')
        extra = _map(_map(_map(config, 'platforms'), 'api_server'), 'extra')
        host = extra.get('host', '127.0.0.1')
        # Bind não verificável não impede o relatório de ferramentas e memória.
        bind_ok = not (('API_SERVER_HOST' in names and 'host' not in extra) or not isinstance(host, str)) \
            and host in {'127.0.0.1', '::1'}
        return {'profile_found': found, '_extensions': extensions,
                'tools': {'source': source, 'restricted': not effective and not extensions, 'effective': effective,
                          'dangerous': effective, 'required_for_editorial': []},
                'memory': {'local_enabled': flags['memory_enabled'], 'user_profile_enabled': flags['user_profile_enabled'],
                           'write_approval': flags['write_approval'], 'external_provider': 'configured' if provider else None},
                'provider_configured': bool(config.get('model') or config.get('provider') or
                    names & {'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'XAI_API_KEY'}),
                'bind_loopback': bind_ok}
    except (OSError, ValueError, TypeError, RecursionError, OverflowError):
        return {'profile_found': found, '_extensions': [], 'tools': {'source': 'unknown', 'restricted': None, 'effective': None,
                'dangerous': None, 'required_for_editorial': []}, 'memory': {'local_enabled': None,
                'user_profile_enabled': None, 'write_approval': None, 'external_provider': None},
                'provider_configured': None, 'bind_loopback': None}


def cost_configured(settings):
    return all(type(value) is int and value > 0 for value in
               (settings.max_tokens_per_run, settings.max_tokens_per_day)) and settings.max_tokens_per_run <= settings.max_tokens_per_day


def daily_tokens(settings, store, db=None):
    """Reserva integral para consumo desconhecido; resultados conhecidos usam usage validado."""
    if db is None:
        with store.connect() as connection:
            return daily_tokens(settings, store, connection)
    rows = db.execute("""SELECT r.usage,r.request,r.status FROM cognitive_runs r JOIN jobs j ON j.id=r.job_id JOIN workflows w ON w.id=j.workflow_id
                      WHERE r.provider='hermes' AND w.cognitive_client='live' AND
                      (r.created_at>=? OR r.status IN ('submitting','admitted','unknown','policy_violation'))""",
                      (datetime.now(timezone.utc).date().isoformat(),)).fetchall()
    total = 0
    for row in rows:
        try:
            usage = json.loads(row['usage']) if row['usage'] else {}
            used = usage.get('total_tokens')
            if type(used) is not int or used < 0 or row['status'] not in {'completed', 'failed', 'cancelled', 'invalid_output', 'interrupted'}:
                request = json.loads(row['request'])
                reservation = request.get('metadata', {}).get('horus_token_reservation')
                if not isinstance(reservation, str) or not reservation.isdigit() or int(reservation) <= 0:
                    raise SecurityGate('security_gate: Reserva anterior não verificável.')
                used = int(reservation)
            total += max(used, 0)
        except (ValueError, TypeError, AttributeError):
            raise SecurityGate('security_gate: Consumo anterior não verificável.') from None
    return total


def security_status(settings, store=None):
    from .hermes import read_connection
    profile = audit_profile(settings.hermes_profile)
    blockers = []
    def block(code, message, severity='critical'):
        blockers.append({'code': code, 'severity': severity, 'message': message})
    if profile['tools']['effective'] is None:
        block('profile_unverifiable', 'Perfil Hermes ausente, inválido ou fora do subconjunto verificável.')
    elif profile['tools']['dangerous']:
        block('dangerous_tools_enabled', 'O perfil Hermes permite ferramentas desnecessárias ao workflow editorial.')
    extensions = profile.pop('_extensions')
    if extensions:
        listing = '; '.join(f'{name}: {count} {"item" if count == 1 else "itens"}' for name, count in extensions)
        block('profile_extensions_present', f'Extensões não auditáveis no perfil Hermes ({listing}); revise-as manualmente.')
    memory = profile['memory']
    if memory['local_enabled'] is True or memory['user_profile_enabled'] is True:
        block('memory_enabled', 'Desative memória e perfil de usuário do Hermes.')
    if memory['external_provider']:
        block('external_memory_provider', 'Remova o provedor externo de memória.')
    if profile.pop('bind_loopback') is not True:
        block('gateway_bind_unverified', 'Bind do gateway fora de loopback ou não verificável.')
    connection, target = 'not_configured', None
    try:
        base_url, _ = read_connection(settings)
        parsed = urlsplit(base_url)
        connection, target = 'loopback', parsed.netloc
    except FileNotFoundError:
        block('connection_not_configured', 'Conexão local do Hermes não configurada.')
    except (ValueError, OSError, UnicodeError):
        connection = 'invalid'
        block('connection_invalid', 'Conexão Hermes inválida; use somente IP de loopback.')
    configured = cost_configured(settings)
    if not configured:
        block('cost_limits_missing', 'Configure tetos positivos de tokens por execução e por dia no operador.')
    elif store is not None:
        try:
            if daily_tokens(settings, store) + settings.max_tokens_per_run > settings.max_tokens_per_day:
                block('daily_token_limit', 'O saldo diário não comporta uma nova execução.')
        except SecurityGate:
            block('usage_unverifiable', 'Consumo diário não verificável.')
    profile.update(connection=connection, profile_label='%LOCALAPPDATA%/hermes/profiles/horus' if settings.hermes_profile == profile_default() else 'perfil selecionado pelo operador',
                   network_isolation={'enforced': False, 'mechanism': None, 'reason': 'Sem bloqueio de rede no nível do SO; gateway externo não é iniciado pelo Hórus.'},
                   cost_limits={'configured': configured, 'max_tokens_per_run': settings.max_tokens_per_run,
                                'max_tokens_per_day': settings.max_tokens_per_day})
    return {'schema_version': 'security.status.v1', 'checked_at': datetime.now(timezone.utc).isoformat(),
            'real_execution_allowed': not blockers, 'blockers': blockers,
            'processing': {'local_only': True if settings.workflow_executor != 'hermes' and settings.radar_executor != 'hermes' else False,
                'workflow_executor_default': settings.workflow_executor, 'radar_executor': settings.radar_executor,
                'external_connections': [{'id': 'hermes_gateway', 'kind': 'loopback', 'target': target,
                    'enabled': connection == 'loopback', 'purpose': 'Agente local Hermes'},
                    {'id': 'youtube_data_api', 'kind': 'external', 'target': 'googleapis.com', 'enabled': False,
                     'purpose': 'Coleta não conectada à API do aplicativo'}]},
            'hermes': profile,
            'radar': {'retention_days': 28, 'network_enabled': False, 'automatic_cleanup': {'available': False, 'last_run_at': None}},
            'credentials': {'items': [{'id': 'backend_session_token', 'storage': 'memory', 'description': 'Token de sessão mantido em memória.'},
                {'id': 'hermes_connection_key', 'storage': 'local_file', 'protection': 'arquivo local; ACLs não auditadas; sem cifragem dedicada',
                 'location_label': '%LOCALAPPDATA%/Horus/workspace/integrations/hermes.json'}]},
            'private_mode': {'available': False, 'enabled': False, 'reason': 'Ainda não implementado no backend.'},
            'audit': {'available': False, 'reason': 'Registro de transmissões externas ainda não implementado.'}}


def require_secure(settings, store=None):
    report = security_status(settings, store)
    if not report['real_execution_allowed']:
        raise SecurityGate('security_gate: ' + ' '.join(item['message'] for item in report['blockers']))


def minimal_profile():
    """Sem ferramentas: snapshot entra no envelope; evidências são validadas no Hórus."""
    disabled = ', '.join(TOOLSETS)
    return f'''gateway:
  standalone: true
  multiplex_profiles: false
platforms:
  api_server:
    enabled: true
    extra:
      host: 127.0.0.1
      port: 8643
platform_toolsets:
  api_server: []
agent:
  disabled_toolsets: [{disabled}]
memory:
  memory_enabled: false
  user_profile_enabled: false
  write_approval: true
  provider: ""
plugins:
  enabled: []
  auto_update_check_hours: 0
  auto_apply: false
telemetry:
  shared_metrics:
    enabled: false
    send: false
updates:
  check: false
'''


def harden_profile(path: Path, *, allow_real=False):
    """Gera configuração em diretório novo; escrita existente sempre tem backup."""
    path = path.expanduser().resolve()
    if (path == profile_default().resolve() or path.name.lower() == 'horus') and not allow_real:
        raise ValueError('Perfil horus real exige caminho explícito e --allow-real após autorização do idealizador.')
    # Não tocar extensões, .env, autenticação nem dados. Perfil existente com extras exige revisão humana.
    if path.exists() and not allow_real and any(child.name not in {'config.yaml', '.no-bundled-skills'} and not child.name.startswith('config.yaml.backup-') for child in path.iterdir()):
        raise ValueError('Use um diretório vazio ou somente configuração; dados existentes exigem revisão manual.')
    if path.exists() and any((path / name).exists() and any((path / name).iterdir()) for name in ('plugins', 'skills', 'cron')):
        raise ValueError('Extensões existentes exigem revisão manual antes da escrita.')
    path.mkdir(parents=True, exist_ok=True)
    config = path / 'config.yaml'
    if config.is_symlink() or (path / '.no-bundled-skills').is_symlink():
        raise ValueError('Configuração vinculada não pode ser sobrescrita.')
    if config.exists():
        backup = path / ('config.yaml.backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        shutil.copy2(config, backup)
    config.write_text(minimal_profile(), encoding='utf-8')
    (path / '.no-bundled-skills').touch(exist_ok=True)
    return config
