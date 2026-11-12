# Segurança da integração Hermes

## Estado e auditoria em 12/11/2026

Esta implementação audita arquivos locais, bloqueia execução real insegura e disponibiliza `GET /v1/security/status`, autenticado pelo token local existente. Não inicia Hermes, não configura provedor, não abre rede durante a auditoria e não altera o perfil operacional. O Hermes continua externo, sem fork.

A inspeção do código instalado do Hermes 0.23.1 confirmou a resolução em `hermes_cli/tools_config.py::_get_platform_tools`, `toolsets.py`, os defaults em `hermes_cli/config_defaults.py` e a API em `gateway/platforms/api_server.py`. O perfil `%LOCALAPPDATA%/hermes/profiles/horus` contém `gateway.standalone: true`, `multiplex_profiles: false` e bind explícito `127.0.0.1:8643`, mas não contém `platform_toolsets.api_server` nem supressão global de ferramentas. Os únicos nomes de variáveis encontrados no `.env` foram `API_SERVER_ENABLED`, `API_SERVER_HOST`, `API_SERVER_KEY` e `API_SERVER_PORT`; valores não são interpretados, impressos ou registrados pela auditoria.

A seleção estática herdada contém: `browser_cdp`, `browser_dialog`, `browser_exec`, `browser_vault`, `cronjob_manage`, `delegate_task`, `execute_code`, `image_generate`, `manage_connections`, `memory`, `patch`, `process_manage`, `read_file`, `search_files`, `session_search`, `skill_manage`, `skill_view`, `skills_list`, `terminal`, `todo_list`, `vision_analyze`, `web_extract`, `web_search`, `write_file`. Isso descreve a configuração, não comprova disponibilidade de cada ferramenta em runtime: credenciais e checks internos podem restringi-las, nunca são usados como garantia de isolamento pelo Hórus.

Memória e perfil de usuário não foram desativados no YAML: os defaults do Hermes são `true`; `write_approval` é `false` e `memory.provider` é vazio por padrão. O YAML não configura modelo/provedor e os nomes presentes no `.env` não indicam credencial de inferência. A ausência de provedor não comprova impossibilidade de inferência, pois autenticação externa ao arquivo inspecionado pode existir.

Foram encontrados diretórios não vazios `skills` e `cron`. Seu conteúdo não foi executado nem interpretado. O status do perfil real, por isso, continua informando ferramentas e memória a partir do `config.yaml` e acrescenta o blocker `profile_extensions_present` (somente nomes e contagens, ex.: `skills: 2 itens; cron: 6 itens`), bloqueando execução. A leitura do YAML acima é evidência parcial, não atestado de segurança do processo em execução. Telemetria compartilhada é desligada por padrão no Hermes; verificações de atualização de plugins usam 24 horas por padrão; o catálogo `models.dev` pode abrir conexão própria.

## Ferramentas editoriais necessárias: nenhuma

O Hórus congela o snapshot na etapa local `research` e envia objetivo, perfil e dataset como dados no envelope. A análise devolve JSON, validado localmente antes de produzir artefato/proposta. Terminal, arquivos, navegador, pesquisa web, delegação, conexões e memória não são necessários. Nesta etapa todas as ferramentas efetivas são classificadas como perigosas/desnecessárias; o conjunto permitido é vazio. Texto de dataset, objetivo e feedback não pode alterar ferramentas, limites ou instruções do adaptador. A validação rejeita fonte fora do snapshot e métrica divergente; isso não comprova qualidade editorial nem elimina toda alucinação textual.

## Auditoria conservadora sem dependência nova

`backend/src/horus_backend/security.py` implementa um subconjunto estrito de YAML: mapas com chaves simples e indentação por espaços, escalares simples (`string`, inteiro decimal, `true`, `false`, `null`), listas de escalares em bloco e inline, comentários. Arquivos têm limite de 256 KiB e profundidade limitada. Não há avaliação de código nem importação do Hermes.

Âncoras/aliases, tags, blocos multilinha, tabs, chaves duplicadas, múltiplos documentos, flow maps e estruturas fora do subconjunto tornam o perfil não verificável. Configurações válidas para o Hermes podem ser recusadas deliberadamente. Esses casos geram `profile_unverifiable` (junto de perfil ausente, `config.yaml` ausente/excessivo e `.env` não verificável), com `tools` e `memory` nulos.

Extensões (`mcp_servers`, `custom_toolsets`, `hooks`, plugins ativos, motor contextual customizado, diretórios `plugins/`, `skills/`, `cron/` não vazios e overrides de ambiente) não ocultam o relatório: com `config.yaml` parseável, `hermes.tools` e `hermes.memory` são sempre preenchidos, e o blocker crítico `profile_extensions_present` lista apenas nomes e contagens, nunca conteúdo. Com extensões, `tools.restricted` nunca é `true` e `real_execution_allowed` permanece `false`; o gate recusa. `gateway_bind_unverified` só aparece quando o bind está fora de loopback ou não pode ser verificado (config parseável com host loopback não o emite). O bind explícito do YAML tem precedência sobre o nome `API_SERVER_HOST`, conforme `listen_address` do Hermes; sem bind explícito, a presença desse nome torna o bind desconhecido porque seu valor não é lido pela auditoria.

A resolução reproduz o comportamento relevante de 0.23.1: ausência/lista inválida herda `hermes-api-server`; lista explícita vazia é autoritativa; listas literais salvas como string são reconhecidas; compostos são expandidos para categorias configuráveis, respeitando categorias desligadas por padrão; `agent.disabled_toolsets` é subtraído por ferramenta no final. Categorias/extensões não catalogadas falham fechado. Credencial xAI em seleção composta também impede atestar o conjunto sem executar código do Hermes. A versão instalada foi inspecionada, mas o backend não comprova a versão nem o perfil do gateway remoto por meio da API.

Proposta pendente para o idealizador: substituir o parser restrito por `PyYAML.safe_load`, com revisão do lock, testes e empacotamento. O Maestro determinou não adicionar dependências nesta tarefa.

## Gerar configuração mínima em diretório temporário

Com o ambiente local já preparado, na raiz do repositório:

```powershell
$perfilTemporario = Join-Path ([IO.Path]::GetTempPath()) ('horus-hermes-' + [guid]::NewGuid().ToString('N'))
& backend/.venv/Scripts/python.exe scripts/harden_hermes_profile.py --profile $perfilTemporario
```

O script usa a função versionada `harden_profile`: cria `config.yaml` e o marcador `.no-bundled-skills`, sem `.env`, credenciais ou processo. Ele configura `platform_toolsets.api_server: []`, `agent.disabled_toolsets` com todas as categorias catalogadas, memória/perfil de usuário desligados, `memory.provider: ""`, `plugins.enabled: []`, `plugins.auto_update_check_hours: 0`, `auto_apply: false`, `updates.check: false` e telemetria compartilhada desligada. Não adiciona plugins, cron ou skills. O marcador impede instalação automática de skills empacotadas.

O caminho é obrigatório; o padrão recusa qualquer diretório chamado `horus` e o caminho operacional conhecido. `--allow-real` só pode ser usado depois de autorização explícita do idealizador. A função recusa configuração por symlink e diretórios de extensões não vazios. Antes de sobrescrever `config.yaml`, faz cópia com timestamp no mesmo diretório. Não exclui nem migra dados existentes. A configuração mínima foi gerada/auditada em diretórios temporários de testes; nenhum gateway Hermes foi iniciado nesta tarefa.

## Gate e teto de tokens

A rota de autorização consulta o gate para workflows cujo executor exposto é `hermes` (persistidos com `executor=hermes`, `cognitive_client=live`). A recusa retorna HTTP 409 com `detail.code: security_gate` e mensagem fixa em português, antes de criar autorização. O executor repete a inspeção antes do envio, cobrindo mudança de perfil entre autorização e consumo. `hermes_simulated` não passa pelo gate nem lê a conexão privada.

Bloqueiam: ferramenta efetiva, memória/perfil de usuário ativos, provedor externo de memória, bind público/desconhecido, conexão inválida/ausente, perfil não verificável e tetos ausentes/inválidos. `Settings.max_tokens_per_run` e `max_tokens_per_day` vêm do operador, não da API ou de dados do agente; padrões são `None`. Variáveis: `HORUS_MAX_TOKENS_PER_RUN` e `HORUS_MAX_TOKENS_PER_DAY`, inteiros positivos, com teto por execução menor ou igual ao diário. `HORUS_HERMES_PROFILE` seleciona o diretório a auditar; isso não inicia nem muda o perfil do gateway.

Antes de admitir uma nova chamada, o adaptador rejeita entrada cujo tamanho UTF-8 já exceda o teto por execução, reserva o teto integral diário em `request.metadata.horus_token_reservation` e persiste a intenção na mesma transação SQLite `BEGIN IMMEDIATE`. O consumo conhecido usa `usage.total_tokens`; consumo desconhecido mantém a reserva. Reservas não verificáveis bloqueiam novas chamadas. O dia é UTC. Execuções pendentes de dias anteriores continuam reservadas; simulações são excluídas pela junção com `workflows.cognitive_client`.

O polling pede parada ao observar consumo acima do teto, e resultados acima dele são recusados. Isso é um controle técnico de admissão e contabilização, **não um limite financeiro rígido no provedor**: a API de runs não oferece teto de tokens totais comprovado por execução, o prompt interno do Hermes não está no envelope e `usage` pode chegar somente ao final. Bytes de entrada são uma estimativa conservadora do texto enviado, não do contexto inteiro do modelo. Não se envia parâmetro de orçamento sem suporte comprovado. Configurar números no Hórus não garante ausência de cobrança excedente; antes de liberar inferência real é necessário configurar e validar teto do provedor/modelo, e aprovar seus custos. Não houve inferência nem consumo pago nesta tarefa.

A coluna `cognitive_runs.provider` permanece `hermes`, pois o CHECK da migração v3 impede outros valores. Por decisão do Maestro, não houve migração. O artefato de análise simulado expõe `provider: hermes_simulated`; a fonte persistente oficial é `workflows.cognitive_client`. Auditorias de consumo devem juntar `cognitive_runs` → `jobs` → `workflows`, como faz o contador diário.

## Rede e subprocessos: controle efetivo e limites

O cliente real valida origem no construtor e em cada chamada: somente HTTP com IP literal `127.0.0.1` ou `::1`, porta explícita, sem usuário/senha, query, fragmento ou caminho base. URLs públicas/hostname `localhost` são recusados antes de abrir socket. Proxies de ambiente são ignorados e redirects não são seguidos. IDs de execução só formam caminhos locais válidos. Corpos/códigos de erro remotos não são refletidos em eventos; eco do token de conexão em resposta JSON é descartado, incluindo escapes JSON. Consumo persistido inclui somente campos numéricos conhecidos. Status não expõe valores do `.env`, credenciais nem caminhos absolutos de usuário.

Na máquina inspecionada estão disponíveis `CreateJobObjectW` (kernel32), `CreateAppContainerProfile` (userenv) e o cmdlet `New-NetFirewallRule`. Apenas a existência das APIs/comando foi verificada, sem criar sandbox, regra ou processo. Job Objects podem agrupar/limitar processos filhos e encerrá-los com o job sem exigir administrador para processos próprios; **não bloqueiam acesso a arquivos/rede** e não isolam retroativamente um gateway externo já iniciado. AppContainer/restricted token exigem lançar processo com identidade/capacidades e ACLs adequadas, com validação de compatibilidade do Python/Hermes; não foi implementado um launcher nesta etapa. Windows Firewall por programa exige elevação para aplicar regras locais e afeta todos os perfis que compartilham o mesmo executável Python.

O Hermes possui backends de terminal `local`, Docker e opções remotas como SSH/Modal/Daytona/Vercel; backends de contêiner não isolam automaticamente o processo principal do agente. Configurá-los não garante bloqueio de rede de navegador, provedor ou catálogo. Não foram instalados Docker, helpers ou serviços, nem configurados backends remotos.

**Risco residual:** o processo Hermes executa com as permissões do usuário e ainda pode abrir conexões próprias (provedor, catálogo `models.dev`, componentes internos). A configuração mínima retira ferramentas do modelo; não constitui sandbox de SO. O status informa `network_isolation.enforced: false` mesmo quando o perfil mínimo passa no gate. Não existe prova técnica de que o gateway ativo usa o arquivo auditado nem proteção contra alterações locais após a inspeção. Para isolamento mais forte recomenda-se usuário Windows dedicado/VM e política de saída restrita por administrador, ou launcher AppContainer após ensaio específico e aprovação. A ausência de isolamento de SO não é escondida como segurança comprovada.

## Aplicar ao perfil operacional: somente após autorização do idealizador

1. Revisar este relatório e autorizar explicitamente parada/reinício do gateway `horus`, cópia de segurança do perfil, mudanças pontuais de configuração e tratamento das extensões existentes. O diagnóstico/status não concede essa autorização.
2. Parar o gateway exclusivo pelo procedimento suportado pelo Hermes. Não encerrar o gateway principal nem processos genéricos Python. Confirmar que não há execução ou subprocesso pendente; se houver, conciliar antes.
3. Fazer backup completo do perfil para um diretório privado fora dele, preservando permissões e dados. Não imprimir `.env`, chaves ou bancos, nem colocá-los no Git. A cópia feita pelo script cobre somente `config.yaml`, não substitui esse backup completo.
4. Revisar e retirar do perfil ativo, com autorização e sem exclusão irreversível, plugins/skills/cron/hooks/MCP e configurações extras. Diretórios de extensão não vazios são recusados pelo script e gate; não renomeá-los automaticamente por agente. Manter dados antigos no backup privado para decisão humana.
5. Gerar primeiro um perfil temporário com o comando acima e comparar seu YAML com a configuração operacional. Depois, executar explicitamente `scripts/harden_hermes_profile.py --profile "$env:LOCALAPPDATA/hermes/profiles/horus" --allow-real`. O script faz backup do YAML existente e não modifica `.env`, chave de conexão ou bancos.
6. Revisar a chave e bind de API pelos procedimentos existentes, sem exibir credenciais; bind deve ser IP de loopback explícito no YAML. Verificar que não há override desconhecido de ambiente. Não configurar modelo/provedor até aprovação de custo e destino dos dados.
7. Configurar tetos de tokens do operador e validar limites reais do provedor antes de qualquer inferência. Se houver exigência de confinamento de SO, preparar e validar o mecanismo aprovado antes de iniciar o gateway.
8. Reiniciar somente o perfil exclusivo, sob autorização aplicável. Consultar `GET /v1/security/status` com o token local e conferir blockers, ferramentas vazias, memória desligada e riscos residuais. Diretórios recriados pelo Hermes podem tornar o perfil não verificável e exigem revisão, não bypass do gate.
9. Aprovar separadamente uma análise delimitada, com dados fictícios e consumo observado; nenhuma chamada real foi aprovada ou executada nesta tarefa. Para voltar, parar o gateway e restaurar o backup autorizado; não realizar downgrade ou perda de dados por iniciativa do agente.

## Validação e exemplos do endpoint

Os testes negativos usam perfis fictícios/`tmp_path` e servidores HTTP exclusivamente em loopback. Cobrem categorias de ferramenta, memória, provedor externo, bind público, perfil ausente/corrompido, limites, reserva diária, rechecagem antes do envio, autenticação do status, injeção de dados, evidência inventada, origem pública, redirects, proxies e erros que refletem segredos fictícios. Não comprovam confinamento do processo Hermes nem comportamento de um modelo real.

Os exemplos abaixo são respostas efetivamente coletadas por `TestClient` contra `GET /v1/security/status`, sem iniciar o lifespan/worker ou abrir rede. O SQLite do Hórus usado nos exemplos ficou em diretório temporário; a conexão real foi somente lida. O exemplo fictício demonstra aprovação do gate; não demonstra isolamento de SO ou inferência. Os horários e valores representam a coleta, não cache permanente.

### Perfil fictício mínimo

```json
{
  "schema_version": "security.status.v1",
  "checked_at": "2026-11-12T11:59:39.496202+00:00",
  "real_execution_allowed": true,
  "blockers": [],
  "processing": {
    "local_only": true,
    "workflow_executor_default": "simulated",
    "radar_executor": "hermes_simulated",
    "external_connections": [
      {
        "id": "hermes_gateway",
        "kind": "loopback",
        "target": "127.0.0.1:8643",
        "enabled": true,
        "purpose": "Agente local Hermes"
      },
      {
        "id": "youtube_data_api",
        "kind": "external",
        "target": "googleapis.com",
        "enabled": false,
        "purpose": "Coleta não conectada à API do aplicativo"
      }
    ]
  },
  "hermes": {
    "profile_found": true,
    "tools": {
      "source": "platform_toolsets.api_server",
      "restricted": true,
      "effective": [],
      "dangerous": [],
      "required_for_editorial": []
    },
    "memory": {
      "local_enabled": false,
      "user_profile_enabled": false,
      "write_approval": true,
      "external_provider": null
    },
    "provider_configured": false,
    "connection": "loopback",
    "profile_label": "perfil selecionado pelo operador",
    "network_isolation": {
      "enforced": false,
      "mechanism": null,
      "reason": "Sem bloqueio de rede no nível do SO; gateway externo não é iniciado pelo Hórus."
    },
    "cost_limits": {
      "configured": true,
      "max_tokens_per_run": 100000,
      "max_tokens_per_day": 300000
    }
  },
  "radar": {
    "retention_days": 28,
    "network_enabled": false,
    "automatic_cleanup": {
      "available": false,
      "last_run_at": null
    }
  },
  "credentials": {
    "items": [
      {
        "id": "backend_session_token",
        "storage": "memory",
        "description": "Token de sessão mantido em memória."
      },
      {
        "id": "hermes_connection_key",
        "storage": "local_file",
        "protection": "arquivo local; ACLs não auditadas; sem cifragem dedicada",
        "location_label": "%LOCALAPPDATA%/Horus/workspace/integrations/hermes.json"
      }
    ]
  },
  "private_mode": {
    "available": false,
    "enabled": false,
    "reason": "Ainda não implementado no backend."
  },
  "audit": {
    "available": false,
    "reason": "Registro de transmissões externas ainda não implementado."
  }
}
```

### Perfil real (somente leitura)

```json
{
  "schema_version": "security.status.v1",
  "checked_at": "2026-11-12T11:59:39.532897+00:00",
  "real_execution_allowed": false,
  "blockers": [
    {
      "code": "dangerous_tools_enabled",
      "severity": "critical",
      "message": "O perfil Hermes permite ferramentas desnecessárias ao workflow editorial."
    },
    {
      "code": "profile_extensions_present",
      "severity": "critical",
      "message": "Extensões não auditáveis no perfil Hermes (skills: 2 itens; cron: 6 itens); revise-as manualmente."
    },
    {
      "code": "memory_enabled",
      "severity": "critical",
      "message": "Desative memória e perfil de usuário do Hermes."
    },
    {
      "code": "cost_limits_missing",
      "severity": "critical",
      "message": "Configure tetos positivos de tokens por execução e por dia no operador."
    }
  ],
  "processing": {
    "local_only": true,
    "workflow_executor_default": "simulated",
    "radar_executor": "hermes_simulated",
    "external_connections": [
      {
        "id": "hermes_gateway",
        "kind": "loopback",
        "target": "127.0.0.1:8643",
        "enabled": true,
        "purpose": "Agente local Hermes"
      },
      {
        "id": "youtube_data_api",
        "kind": "external",
        "target": "googleapis.com",
        "enabled": false,
        "purpose": "Coleta não conectada à API do aplicativo"
      }
    ]
  },
  "hermes": {
    "profile_found": true,
    "tools": {
      "source": "default:hermes-api-server",
      "restricted": false,
      "effective": ["browser_cdp", "…", "write_file"],
      "dangerous": ["browser_cdp", "…", "write_file"],
      "required_for_editorial": []
    },
    "memory": {
      "local_enabled": true,
      "user_profile_enabled": true,
      "write_approval": false,
      "external_provider": null
    },
    "provider_configured": false,
    "connection": "loopback",
    "profile_label": "%LOCALAPPDATA%/hermes/profiles/horus",
    "network_isolation": {
      "enforced": false,
      "mechanism": null,
      "reason": "Sem bloqueio de rede no nível do SO; gateway externo não é iniciado pelo Hórus."
    },
    "cost_limits": {
      "configured": false,
      "max_tokens_per_run": null,
      "max_tokens_per_day": null
    }
  },
  "radar": {
    "retention_days": 28,
    "network_enabled": false,
    "automatic_cleanup": {
      "available": false,
      "last_run_at": null
    }
  },
  "credentials": {
    "items": [
      {
        "id": "backend_session_token",
        "storage": "memory",
        "description": "Token de sessão mantido em memória."
      },
      {
        "id": "hermes_connection_key",
        "storage": "local_file",
        "protection": "arquivo local; ACLs não auditadas; sem cifragem dedicada",
        "location_label": "%LOCALAPPDATA%/Horus/workspace/integrations/hermes.json"
      }
    ]
  },
  "private_mode": {
    "available": false,
    "enabled": false,
    "reason": "Ainda não implementado no backend."
  },
  "audit": {
    "available": false,
    "reason": "Registro de transmissões externas ainda não implementado."
  }
}
```

### Checks executados

- `backend/.venv/Scripts/python.exe -m pytest backend/tests -q`: **310 aprovados**, com um aviso de depreciação do adaptador Starlette/httpx já existente no ambiente.
- `backend/.venv/Scripts/python.exe -m pytest contracts/hermes/tests -q -p no:cacheprovider`: **54 aprovados**.
- Suíte específica `backend/tests/test_security.py`: **81 aprovados**.
- `git diff --check` e referências locais dos três documentos: aprovados.
- Sem inferência real, rede externa, instalação, alteração de firewall, mudança do perfil operacional ou testes de sandbox de SO.
