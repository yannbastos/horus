"""Ensaio offline de funções puras extraídas do código Hermes instalado.

Não importa Hermes, descobre plugins, abre perfil nem inicia agente/gateway.
As fronteiras de descoberta são fictícias e explícitas: isto não atesta runtime.
"""
import argparse
import ast
import builtins
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from horus_backend.security import TOOLSETS, minimal_profile, parse_yaml_subset


def verify(source: Path):
    files = {}
    namespace = {}
    def restricted_import(name, *args, **kwargs):
        if name == '__future__':
            return builtins.__import__(name)
        if name == 'agent.skill_utils':
            return SimpleNamespace(parse_config_string_list=lambda value: value)
        raise AssertionError('Importação inesperada no ensaio offline: ' + name)
    namespace['__builtins__'] = {**vars(builtins), '__import__': restricted_import}

    def extract(relative, names):
        raw = (source / relative).read_bytes()
        parsed = ast.parse(raw.decode('utf-8-sig'))
        selected = [node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name in names]
        assert {node.name for node in selected} == set(names), 'Função esperada ausente: reavaliar versão.'
        # Somente as funções nomeadas; não executar imports/inicializadores do módulo.
        module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *selected], type_ignores=[])
        ast.fix_missing_locations(module)
        exec(compile(module, relative, 'exec'), namespace)
        files[relative] = {'sha256': hashlib.sha256(raw).hexdigest(), 'functions': {n.name: n.lineno for n in selected}}

    extract('hermes_cli/tools_config.py', ['_get_platform_tools', '_enabled_plugin_toolsets', '_merge_mcp_servers', '_context_engine_active'])
    extract('model_tools.py', ['_select_tool_names'])
    extract('agent/agent_init.py', ['_inject_context_engine_tools'])
    extract('agent/memory_manager_tools.py', ['memory_provider_tools_enabled'])
    discoveries = {'plugins': set(), 'mcp': set(), 'xai': False}
    # Fronteiras controladas, não substitutos de teste de integração de descoberta.
    namespace.update(
        _coerce_platform_toolsets_value=lambda value, platform: value,
        _configurable_keys=lambda: set(TOOLSETS),
        _get_plugin_toolset_keys=lambda: discoveries['plugins'],
        _platform_default_keys=lambda: {'hermes-api-server', 'hermes-cli'},
        _explicit_toolsets=lambda names, *args: set(names),
        _composite_toolsets=lambda *args: {'x_search'} if discoveries['xai'] else set(),
        _recover_platform_native_toolsets=lambda *args, **kwargs: None,
        enabled_mcp_server_names=lambda config: discoveries['mcp'],
        _prune_toolsets_stripped_by_disabled=lambda names, disabled: names - set(disabled),
        _warn_all_invalid_platform_toolsets=lambda *args: None,
        _DEFAULT_OFF_TOOLSETS=set(),
        os=SimpleNamespace(environ={}),
        get_hermes_home=lambda: 'home-ficticio-sem-acesso-a-disco',
    )
    def selection(tools, names, quiet, disable):
        for name in names:
            members = TOOLSETS.get(name, {name + '_ficticia'})
            tools.difference_update(members) if disable else tools.update(members)
    namespace['_apply_toolset_selection'] = selection
    config = parse_yaml_subset(minimal_profile())
    resolved = namespace['_get_platform_tools'](config, 'api_server')
    assert resolved == set()
    tools = namespace['_select_tool_names'](list(resolved), config['agent']['disabled_toolsets'], True)
    assert tools == set()
    hook_calls = []
    engine = SimpleNamespace(on_session_start=lambda *args, **kwargs: hook_calls.append(True))
    agent = SimpleNamespace(context_compressor=engine, tools=[], enabled_toolsets=[],
                            session_id='ficticia', platform='api_server', model='nenhum')
    namespace['_inject_context_engine_tools'](agent)
    assert agent.tools == [] and agent._context_engine_tool_names == set()
    assert not namespace['memory_provider_tools_enabled']([], config['agent']['disabled_toolsets'])
    discoveries['plugins'] = {'plugin_ficticio'}
    assert namespace['_get_platform_tools'](config, 'api_server') == {'plugin_ficticio'}
    discoveries['plugins'] = set()
    discoveries['mcp'] = {'mcp_ficticio'}
    assert namespace['_get_platform_tools'](config, 'api_server') == {'mcp_ficticio'}
    discoveries['mcp'] = set()
    discoveries['xai'] = True
    assert namespace['_get_platform_tools'](config, 'api_server') == set()  # supressão de x_search
    config['context']['engine'] = 'custom_ficticio'
    assert namespace['_get_platform_tools'](config, 'api_server') == set()  # engine vazio não injeta tools
    return {'scope': 'funções extraídas; descoberta fictícia, sem runtime Hermes', 'minimal_tools': sorted(tools),
            'plugin_can_reactivate': True, 'mcp_can_reactivate': True, 'context_empty_list_injects': False,
            'context_hook_runs_even_without_tools': bool(hook_calls),
            'memory_provider_tools': False, 'xai_suppressed': True, 'source_files': files}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    print(json.dumps(verify(parser.parse_args().source), indent=2, ensure_ascii=False))
