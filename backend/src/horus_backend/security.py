"""Auditoria local conservadora do Hermes 0.23.1; nunca executa código do agente."""
from __future__ import annotations

import ast
import difflib
import hashlib
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

MAX_CONFIG = 256 * 1024
MAX_MANIFEST = 16 * 1024 * 1024
EXTENSION_DIRS = ('plugins', 'skills', 'cron', 'hooks', 'tools', 'context_engine', 'mcp')

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


def _read(path: Path, limit=MAX_CONFIG):
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
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
        for dirname in EXTENSION_DIRS:
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
        # Exigir seleção vazia mesmo quando disabled_toolsets suprime todos os nomes atuais.
        # Evita reativação por aliases, categorias novas ou alteração posterior da supressão.
        selection = _map(config, 'platform_toolsets').get('api_server')
        if selection != [] and selection != '[]':
            extensions.append(('platform_toolsets.api_server.nonempty_or_missing', 1))
        for key in ('context_engine', 'skills', 'tools', 'toolsets'):
            if config.get(key):
                extensions.append((key, 1))
        overrides = sum(1 for name in names if name.startswith(('HERMES_TOOL', 'HERMES_MEMORY', 'HERMES_PLUGIN', 'HERMES_ENABLE_PROJECT_PLUGINS', 'HERMES_BUNDLED_', 'MEMORY_', 'HERMES_CONTEXT', 'HERMES_MCP', 'HERMES_SKILL', 'HERMES_KANBAN', 'HERMES_CONFIG', 'HERMES_ENV')))
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


def daily_runs(store, db=None):
    """Cada intenção real conta uma vez, inclusive recusada/sem consumo ou ainda desconhecida."""
    if db is None:
        with store.connect() as connection:
            return daily_runs(store, connection)
    return db.execute("""SELECT COUNT(*) FROM cognitive_runs r JOIN jobs j ON j.id=r.job_id
                      JOIN workflows w ON w.id=j.workflow_id
                      WHERE r.provider='hermes' AND w.cognitive_client='live' AND r.created_at>=?""",
                      (datetime.now(timezone.utc).date().isoformat(),)).fetchone()[0]


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
    runs_configured = type(settings.max_runs_per_day) is int and settings.max_runs_per_day > 0
    if not runs_configured:
        block('run_limit_missing', 'Configure teto positivo de execuções reais por dia no operador.')
    elif store is not None and daily_runs(store) >= settings.max_runs_per_day:
        block('daily_run_limit', 'O teto diário de execuções reais foi atingido.')
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
                                'max_tokens_per_day': settings.max_tokens_per_day,
                                'max_runs_per_day': settings.max_runs_per_day, 'runs_configured': runs_configured})
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
context:
  engine: compressor
telemetry:
  shared_metrics:
    enabled: false
    send: false
updates:
  check: false
'''


MANAGED_ROOTS = ('config.yaml', '.no-bundled-skills', *EXTENSION_DIRS)


def _plain_path(path):
    """Recusa links/junctions em todos os ancestrais, antes de resolver o caminho."""
    path = Path(os.path.abspath(path.expanduser()))
    for part in (path, *path.parents):
        if part.is_symlink() or getattr(part, 'is_junction', lambda: False)():
            raise ValueError('Links e junctions não são permitidos no backup/perfil.')
        if part.is_file() and part.stat().st_nlink > 1:
            raise ValueError('Arquivo com hardlinks exige revisão manual.')
    return path


def _profile_target(path, allow_real):
    path = _plain_path(path)
    if (path == profile_default().resolve() or path.name.lower() == 'horus') and not allow_real:
        raise ValueError('Perfil horus real exige caminho explícito e --allow-real após autorização do idealizador.')
    _plain_path(path / '.horus-hardening')
    return path


def _safe_backup_name(relative):
    # Credenciais e bancos de sessão nunca entram no backup, mesmo dentro de extensões.
    for part in relative.parts:
        lower = part.lower()
        if (lower.startswith('.env') or lower.lstrip('.').startswith(('auth', 'credential', 'secret', 'session', 'token', 'password', 'api_key'))
                or lower.endswith(('.pem', '.key', '.pfx', '.p12'))):
            raise ValueError('Extensão contém arquivo reservado; revisão manual necessária antes do backup.')
    lower = relative.name.lower()
    if any(suffix in lower for suffix in ('.db', '.sqlite')) and relative.as_posix() not in {
            'cron/executions.db', 'cron/executions.db-wal', 'cron/executions.db-shm'}:
        raise ValueError('Banco fora do inventário cron permitido; revisão manual necessária.')


def _fingerprint(path):
    entries = {}
    def visit(item):
        _plain_path(item)
        relative = item.relative_to(path)
        _safe_backup_name(relative)
        if item.is_dir():
            entries[relative.as_posix()] = {'kind': 'directory'}
            for child in sorted(item.iterdir()):
                visit(child)
        elif item.is_file():
            digest = hashlib.sha256()
            with item.open('rb') as stream:
                for chunk in iter(lambda: stream.read(65536), b''):
                    digest.update(chunk)
            entries[relative.as_posix()] = {'kind': 'file', 'size': item.stat().st_size, 'sha256': digest.hexdigest()}
        else:
            raise ValueError('Arquivo especial não pode ser copiado.')
    for name in MANAGED_ROOTS:
        item = path / name
        _plain_path(item)
        if item.exists():
            visit(item)
    return entries


def _config_without_credentials(path):
    if not path.exists():
        return ''
    raw = _read(path)
    config = parse_yaml_subset(raw)
    def check(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if re.search(r'(?:^|_)(?:token|key|password|secret|credentials?|auth|authorization|bearer|connection_string)(?:$|_)', key, re.I) and child:
                    raise ValueError('Configuração contém possível credencial; não será exibida nem copiada.')
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)
    check(config)
    return raw


def _copy_managed(source, target):
    for name in MANAGED_ROOTS:
        item = source / name
        if item.is_dir():
            shutil.copytree(item, target / name, copy_function=shutil.copy2)
        elif item.exists():
            shutil.copy2(item, target / name)


def _move_managed(source, target, roots=MANAGED_ROOTS):
    source, target = _plain_path(source), _plain_path(target)
    if not target.is_relative_to(source):
        raise ValueError('Movimento precisa permanecer dentro do perfil.')
    target.mkdir(parents=True, exist_ok=False)
    for name in roots:
        if (source / name).exists():
            (source / name).rename(target / name)


def _write_manifest(path, manifest):
    encoded = json.dumps(manifest, indent=2, sort_keys=True) + '\n'
    if len(encoded.encode('utf-8')) > MAX_MANIFEST:
        raise ValueError('Manifesto excessivo; revisão manual necessária.')
    pending = path.with_suffix('.pending')
    pending.write_text(encoded, encoding='utf-8')
    pending.replace(path)


def harden_profile(path: Path, *, allow_real=False, dry_run=False):
    """Config + extensões somente; backup e quarentena ficam no próprio perfil.

    O gateway deve estar parado. Hashes detectam divergência, não substituem ACLs
    nem uma assinatura do manifesto. Dry-run não cria sequer o diretório destino.
    """
    path = _profile_target(path, allow_real)
    before = _fingerprint(path)
    original = _config_without_credentials(path / 'config.yaml')
    diff = ''.join(difflib.unified_diff(original.splitlines(True), minimal_profile().splitlines(True),
                                       fromfile='config.yaml (anterior)', tofile='config.yaml (mínimo)'))
    moved = [name for name in EXTENSION_DIRS if (path / name).exists()]
    if dry_run:
        return {'config': path / 'config.yaml', 'diff': diff, 'would_quarantine': moved, 'backup': None}
    path.mkdir(parents=True, exist_ok=True)
    transaction = path / '.horus-hardening' / uuid.uuid4().hex
    payload = transaction / 'backup' / 'payload'
    payload.mkdir(parents=True)
    _copy_managed(path, payload)
    if _fingerprint(payload) != before or _fingerprint(path) != before:
        raise ValueError('Backup divergiu do perfil; nenhuma configuração foi aplicada.')
    manifest = {'version': 1, 'state': 'prepared', 'before': before, 'quarantined': moved}
    manifest_path = payload.parent / 'manifest.json'
    _write_manifest(manifest_path, manifest)
    try:
        _move_managed(path, transaction / 'quarantine', EXTENSION_DIRS)
        quarantine = _fingerprint(transaction / 'quarantine')
        if quarantine != {key: value for key, value in before.items() if key.split('/')[0] in EXTENSION_DIRS}:
            raise ValueError('Quarentena divergiu do inventário.')
        _write_manifest(transaction / 'quarantine' / 'manifest.json', {'version': 1, 'entries': quarantine})
        (path / 'config.yaml').write_text(minimal_profile(), encoding='utf-8')
        # Preservar bytes de marcador preexistente; só sua existência tem significado.
        (path / '.no-bundled-skills').touch(exist_ok=True)
        manifest.update(state='applied', after=_fingerprint(path))
        _write_manifest(manifest_path, manifest)
    except Exception:
        # Preserva falha e originais; não apaga dados para tentar recuperar.
        _move_managed(path, transaction / 'failed-application')
        _copy_managed(payload, path)
        if _fingerprint(path) != before:
            raise ValueError('Reversão automática divergiu; preservar backup e interromper operação.') from None
        raise
    return {'config': path / 'config.yaml', 'diff': diff, 'would_quarantine': moved, 'backup': payload.parent}


def restore_profile(path: Path, backup: Path, *, allow_real=False, dry_run=False):
    """Restaura bytes e presença de diretórios; recusa backup corrompido ou drift ativo."""
    path = _profile_target(path, allow_real)
    backup = _plain_path(backup)
    # Não aceitar manifestos de outro perfil nem payload em diretório arbitrário.
    if (backup.name != 'backup' or backup.parent.parent != path / '.horus-hardening'
            or not re.fullmatch(r'[0-9a-f]{32}', backup.parent.name)):
        raise ValueError('Backup precisa pertencer a este perfil.')
    _plain_path(backup / 'manifest.json')
    manifest = json.loads(_read(backup / 'manifest.json', MAX_MANIFEST))
    if not isinstance(manifest, dict) or manifest.get('version') != 1 or manifest.get('state') != 'applied':
        raise ValueError('Backup não está em estado restaurável; revisar manualmente.')
    payload = backup / 'payload'
    _plain_path(payload)
    if any(child.name not in MANAGED_ROOTS for child in payload.iterdir()):
        raise ValueError('Backup contém raiz não inventariada; restauração abortada.')
    before = _fingerprint(payload)
    # Não materializar caminhos do JSON: copiamos apenas raízes fixas inventariadas.
    if before != manifest.get('before'):
        raise ValueError('Hash do backup divergiu; restauração abortada antes da escrita.')
    if _fingerprint(path) != manifest.get('after'):
        raise ValueError('Perfil ativo mudou após aplicação; conciliar antes de restaurar.')
    if dry_run:
        return {'restore': sorted(before), 'backup': backup}
    replaced = backup.parent / 'replaced-by-restore'
    if replaced.exists():
        raise ValueError('Restauração anterior incompleta; preservar estado para revisão manual.')
    moved_all = False
    try:
        _move_managed(path, replaced)
        moved_all = True
        _copy_managed(payload, path)
        if _fingerprint(path) != before:
            raise ValueError('Hash após restauração divergiu.')
        manifest['state'] = 'restored'
        _write_manifest(backup / 'manifest.json', manifest)
    except Exception:
        failed = backup.parent / 'failed-restore'
        _move_managed(path, failed)
        if not moved_all:
            _copy_managed(failed, path)  # raízes ainda não movidas: continuam sendo o estado mínimo
        _copy_managed(replaced, path)
        if _fingerprint(path) != manifest.get('after'):
            raise ValueError('Rollback da restauração divergiu; preservar arquivos para revisão manual.') from None
        raise
    return {'restore': sorted(before), 'backup': backup}
