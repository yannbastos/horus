# Segurança da integração Hermes

## Estado em 12/11/2026

O backend audita configuração local, oferece `GET /v1/security/status` autenticado e recusa autorização/envio real enquanto houver blockers. Não inicia Hermes, escolhe provedor, configura credenciais ou aplica isolamento de SO. Hermes continua externo, sem fork. O incremento integrado em `d050658` já possui limpeza automática do Radar; retenção local não protege o processo Hermes.

O coordenador informou a aplicação autorizada do endurecimento ao perfil `%LOCALAPPDATA%/hermes/profiles/horus`, com backup `.horus-hardening/cc69987dc93c44eea9f8e9d95cc7d457`, zero ferramentas e memória desligada. O gateway está parado, sem provedor configurado e **nenhum gasto ou inferência real está autorizado**. O incremento SEC-C3 não acessou nem alterou esse perfil ou o workspace operacional do Hórus; implementa e testa os limites aprovados no backend. Sem preços explícitos do operador, o novo blocker crítico `pricing_missing` mantém a execução real recusada.

O inventário abaixo preserva a evidência **anterior ao endurecimento**: 24 ferramentas herdadas de `hermes-api-server`, memória/perfil ativos e `skills: 2 itens; cron: 6 itens`. Na auditoria original não foram abertos `.env`, `auth*`, sessões, prompts ou saídas; a conexão privada Hórus–Hermes não foi modificada.

A seleção estática herdada contém `browser_cdp`, `browser_dialog`, `browser_exec`, `browser_vault`, `cronjob_manage`, `delegate_task`, `execute_code`, `image_generate`, `manage_connections`, `memory`, `patch`, `process_manage`, `read_file`, `search_files`, `session_search`, `skill_manage`, `skill_view`, `skills_list`, `terminal`, `todo_list`, `vision_analyze`, `web_extract`, `web_search`, `write_file`. Disponibilidade em runtime depende de credenciais/checks; ausência de credenciais não garante isolamento.

## Inventário das extensões reais

As duas entradas imediatas de `skills/` **não são duas skills**: há uma categoria contendo uma skill e um manifesto. A classificação usa arquivos documentais da skill e código instalado do Hermes; os exemplos não foram executados nem adotados como instruções desta tarefa.

| Item relativo ao perfil | O que é / quem cria | Código/rede e necessidade ao Hórus | Recomendação após autorização |
|---|---|---|---|
| `skills/autonomous-ai-agents/` | Categoria com `DESCRIPTION.md`, skill `hermes-agent` v3.3.0, `SKILL.md`, referências e templates `clock.mjs`, `plugin.js`, `skin.yaml`. Criada/sincronizada por `tools/skills_sync.py`. | Markdown é contexto; templates contêm código e o guia descreve CLI, instalação, rede e delegação. Presença não comprova execução automática; um agente com ferramentas poderia executá-los. Desnecessário ao fluxo editorial. | Quarentena de `skills/` completo com backup; não executar templates. Se recriado, bloquear e revisar. |
| `skills/.bundled_manifest` | Rastreamento de origem/hash das skills; escrito pelo sincronizador. | Não executa por si; orienta sincronização local. Desnecessário ao workflow. | Preservar na mesma quarentena/backup para reversão exata. |
| `cron/.jobs.lock` | Arquivo vazio de exclusão mútua; `cron/jobs.py::_jobs_lock`. | Não executa; sincroniza operações de jobs. Não é um job nem necessário ao Hórus. | Quarentena conjunta, somente após parar gateway/agendador. |
| `cron/.tick.lock` | Arquivo vazio de exclusão mútua do tick; `cron/scheduler.py`. | Não executa; sincroniza processos. Não é um job nem necessário ao Hórus. | Mesma quarentena com gateway parado. |
| `cron/executions.db` | SQLite de execuções criado por `cron/executions.py`; 24.576 bytes. | Banco não executa código por si; scheduler pode iniciar agentes/subprocessos/rede. Desnecessário ao fluxo fixo. | Backup de bytes e quarentena; não abrir para escrita ou apagar. |
| `cron/output/` | Saídas do scheduler; definido em `cron/jobs.py`. Vazio: zero entradas. | Arquivos não executam por si; saídas futuras podem ser sensíveis. Nenhum conteúdo lido. Desnecessário. | Preservar inclusive o diretório vazio. |
| `cron/ticker_heartbeat` | Marcador de tempo/PID, 24 bytes; `record_ticker_heartbeat`. | Não executa; escrito periodicamente pelo scheduler. Conteúdo não lido. Desnecessário. | Quarentena conjunta; pode reaparecer ao iniciar gateway. |
| `cron/ticker_last_success` | Marcador do último tick sem erro, 18 bytes; mesma função. | Não executa; metadado operacional. Conteúdo não lido. Desnecessário. | Mesma recomendação. |

Não foi encontrado `cron/jobs.json`; seis itens **não comprovam seis tarefas agendadas**. Ausência desse arquivo/linhas não atesta ausência de trabalho em memória no processo ativo.

O SQLite foi aberto com `sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)` e `PRAGMA query_only=ON`. Consultas apenas a nomes de tabelas, `PRAGMA table_info` e `COUNT(*)`: uma tabela `executions`, **0 linhas**. Colunas: `id TEXT`, `job_id TEXT`, `source TEXT`, `process_id TEXT`, `pid INTEGER`, `process_started_at INTEGER`, `status TEXT`, `handoff_pending INTEGER`, `handoff_started_at REAL`, `claimed_at TEXT`, `started_at TEXT`, `finished_at TEXT`, `error TEXT`, `delivery_outcome TEXT`, `scheduled_instant TEXT`, `progress_at TEXT`. Nenhum valor de linha/prompt/saída foi consultado.

## Zero ferramentas: configuração e evidência

O Hórus realiza `research` localmente e envia objetivo, perfil e snapshot no envelope. A análise devolve JSON validado antes de produzir proposta/aprovação humana. Nenhuma ferramenta Hermes é necessária: arquivos, URL, navegador, terminal, memória e delegação estão fora do conjunto permitido.

`minimal_profile()` configura API em `127.0.0.1:8643`, standalone sem multiplexação, `platform_toolsets.api_server: []`, todas as categorias estáticas em `agent.disabled_toolsets`, memória/perfil desligados, `memory.provider: ""`, `write_approval: true`, plugins opt-in vazios, atualização automática/telemetria desligadas e `context.engine: compressor`. O script cria `.no-bundled-skills`.

Revisão somente leitura do Hermes instalado 0.23.1; `install-stamp.json` confirma `baseVersion: 0.23.1` e commit `3b421578588243f920886e6fe79a6faa87ea026e`:

| Caminho/função instalada | Comportamento e tratamento |
|---|---|
| `gateway/platforms/api_server.py:2215` | Passa `sorted(_get_platform_tools(user_config, "api_server"))` para `AIAgent`. Hórus não envia políticas de salas que substituem essa seleção. |
| `hermes_cli/tools_config.py::_get_platform_tools:572` | `[]` explícito não herda composto padrão/alias legado `hermes`. Gate exige seleção explicitamente vazia; lista não vazia bloqueia **mesmo com supressão atual completa**. Categoria desconhecida falha fechado. |
| `_enabled_plugin_toolsets:521` | Plugins descobertos podem acrescentar categorias mesmo com `[]`. Config ativa, overrides e diretórios não vazios bloqueiam. `plugins.enabled: []` impede opt-in comum; backends empacotados ainda podem ser importados para registrar provedores. Não constitui isolamento do processo. |
| `_merge_mcp_servers:734` | MCP global habilitado é mesclado mesmo com `[]`; supressão estática não enumera MCP futuro. Qualquer configuração MCP, MCP de plugin ou extensão bloqueia sem iniciá-lo. |
| `_composite_toolsets:508` | Credenciais xAI podem acrescentar `x_search`, inclusive com `[]`; supressão global da categoria o retira. Auditoria mantém recusa quando não consegue resolver o ambiente com segurança. |
| `model_tools.py::_select_tool_names:333` | Seleção vazia produz conjunto vazio, com supressão final. Worker Kanban pode acrescentar ferramentas: nomes de ambiente `HERMES_KANBAN*` bloqueiam. |
| `agent/agent_init.py::_inject_context_engine_tools:1965` | `[]` não injeta schemas contextuais, mas **ainda chama `on_session_start`**. Motor customizado bloqueia mesmo sem ferramentas. |
| `agent/memory_manager_tools.py::memory_provider_tools_enabled:27` | Memória suprimida e seleção vazia não expõem ferramentas do provedor; flags/provedor também são auditados. |
| `tools/skills_sync.py::sync_skills:396` | **Correção do guia anterior:** `.no-bundled-skills` permite sincronizar essenciais; pode recriar `hermes-agent`, categoria e manifesto. Skills em disco/preload bloqueiam; marcador não garante diretório vazio. |

Sob ausência das extensões/overrides recusados: **zero ferramentas selecionadas para `api_server`**. Há revisão estática e ensaio offline de funções extraídas do código instalado. Não houve importação do runtime Hermes, gateway ou inferência. O ensaio substitui explicitamente fronteiras de descoberta, catálogo/supressão e contexto por dados fictícios: não valida descoberta real, todos os backends ou processo ativo.

```powershell
& backend/.venv/Scripts/python.exe scripts/verify_hermes_tool_selection.py --source "$env:LOCALAPPDATA/hermes/hermes-agent"
if ($LASTEXITCODE -ne 0) { throw 'Código Hermes divergente: reavaliar antes de aplicar.' }
```

Retorno verificado: `minimal_tools: []`, `plugin_can_reactivate: true`, `mcp_can_reactivate: true`, `context_empty_list_injects: false`, `context_hook_runs_even_without_tools: true`, `memory_provider_tools: false`, `xai_suppressed: true`. SHA-256 dos módulos:

| Arquivo | SHA-256 |
|---|---|
| `hermes_cli/tools_config.py` | `0155400154f6048239839f8703a4727bd2de3d7ed2a84a00c212883daa7efab8` |
| `model_tools.py` | `d1da6f6d7346ca7c9a4eb67337056492bdc219dc55fb1df7cb1f49cd189a94aa` |
| `agent/agent_init.py` | `bd7adefd16bc728934e54b89d1d72ae04063b3e23650c39651ff664e9b56794f` |
| `agent/memory_manager_tools.py` | `dbd96b5e8aeae41afa6bbec48ad1a837315a268be2eedcf43c7cc609540c480d` |

## Auditoria e gate

`security.py` usa YAML estrito sem dependência nova: mapas/chaves simples, escalares simples, listas de escalares, máximo 256 KiB e profundidade limitada. Tags, âncoras, aliases, tabs, duplicatas, documentos múltiplos, blocos multilinha e flow maps falham fechado. Um YAML aceito pelo Hermes pode ser recusado. Não foi adicionado PyYAML.

Status retorna categorias/contagens, sem nomes de arquivos/skills, conteúdos, valores de ambiente ou credenciais. A auditoria normal consulta nomes de chaves do `.env`, sem interpretar/divulgar valores; o inventário manual desta revisão não abriu esse arquivo. Config parseável mantém ferramentas/memória informadas mesmo com extensões e `tools.restricted: false`; config não verificável retorna desconhecido e bloqueia.

Bloqueiam extensões configuradas (`mcp_servers`, `custom_toolsets`, `hooks`, `context_engine`, skills/preload, ferramentas/toolsets extras, plugins ativos), motor diferente de `compressor`, diretórios não vazios `plugins`, `skills`, `cron`, `hooks`, `tools`, `context_engine`, `mcp` e overrides de ferramentas/memória/plugins/contexto/MCP/skills/Kanban/configuração no ambiente. O relatório expõe apenas categorias e números. Memória ativa/externa, bind público/desconhecido, conexão inválida/ausente e limites ausentes/inválidos também bloqueiam.

A API recusa autorização real com HTTP 409 `detail.code: security_gate`, antes de criá-la; adaptador repete a inspeção antes do envio. Simulação independe de perfil, conexão e tetos. Bind YAML explícito prevalece sobre `API_SERVER_HOST`; sem host explícito e com esse nome de ambiente, o valor não é presumido seguro.

Cliente HTTP aceita apenas IP literal `127.0.0.1`/`::1`, HTTP, porta explícita, sem caminho base, usuário/senha, query ou fragmento. Ignora proxies/redirects e não reflete erros remotos/eco de chave. Restringe o cliente Hórus, não as conexões do processo Hermes.

## Backup, quarentena e restauração

`scripts/harden_hermes_profile.py` exige `--profile`. Caminho real conhecido ou diretório chamado `horus` exige `--allow-real`, inclusive dry-run/restore. A flag não concede autorização: alterações reais continuam dependentes do idealizador.

`--dry-run` mostra diff YAML, marcador e raízes que seriam movidas, sem criar diretório/arquivo. YAML deve ser verificável; credenciais reconhecíveis preenchidas fazem diff/backup abortar. Aplicação guarda tudo **dentro do perfil**, em `.horus-hardening/<id>/`: `backup/payload/` contém somente config, marcador anterior e raízes de extensões presentes; `backup/manifest.json` registra presença, diretórios vazios, tamanho/SHA-256 dos arquivos. Origem/backup são verificados antes da mudança. `quarantine/` recebe por movimento as extensões completas e manifesto próprio.

Nada é copiado para fora do perfil. `.env`, `auth*`, credenciais reconhecíveis e bancos de sessão da raiz ficam intocados. Arquivos reservados dentro das extensões fazem abortar antes da cópia. Bancos só são aceitos em `cron/executions.db` e seus sidecars. Links, junctions, hardlinks e arquivos especiais são recusados. Config e extensões não abrangem sessões, memória, autenticação ou backup completo do Hermes.

`--restore <backup>` verifica pertencimento ao perfil, hashes e ausência de alterações posteriores nas raízes ativas. Move o estado mínimo para `replaced-by-restore/`, copia o anterior e verifica hashes/presença, inclusive diretórios vazios, CRLF/binários/marcador. Credenciais/sessões permanecem no lugar. Erros recuperáveis preservam backup e tentam repor o estado anterior; não há exclusão recursiva. Corte abrupto de energia/processo não é transação de filesystem: estado `prepared`/divergência exige recuperação manual supervisionada. Não apagar arquivos para forçar nova tentativa.

Hashes não autenticam manifesto/payload contra adulteração conjunta. `copy2` não promete restaurar ACL/ADS Windows integralmente. Extensões podem conter dados privados/segredos embutidos não reconhecíveis por nome/chave: backup precisa permanecer privado no perfil e sob revisão humana; nunca publicar, enviar ou colocar no Git.

## Aplicação operacional — exige autorização, não executada

Este roteiro foi registrado antes da aplicação comunicada pelo coordenador acima. Não foi repetido pelo SEC-C3; restauração, reinício ou nova alteração operacional continuam sujeitos à autorização correspondente.

1. Idealizador aprova parada/reinício **somente do gateway `horus`**, substituição YAML e quarentena inventariada. Isso não aprova inferência, credenciais, provedor ou firewall. Confirmar revisão do Hermes e perfil realmente usado pelo gateway. Abortar por versão divergente, multiplexação/perfil incerto, trabalho/subprocesso pendente.
2. Parar pelo mecanismo suportado: `hermes -p horus gateway stop`. Não usar `--force`, `--replace`, `--interrupt`, `-z` ou encerramento genérico de Python. Se houver recusa por trabalho ativo, conciliar antes. Confirmar no supervisor do operador que gateway exclusivo/scheduler encerraram; arquivo `.lock` vazio não comprova processo ativo/inativo. Não iniciar gateway para inventariar.
3. Na raiz do repo, revisar plano sem escrita (flag real continua sujeita à autorização):

   ```powershell
   $perfilHorus = Join-Path $env:LOCALAPPDATA 'hermes/profiles/horus'
   & backend/.venv/Scripts/python.exe scripts/harden_hermes_profile.py --profile $perfilHorus --allow-real --dry-run
   if ($LASTEXITCODE -ne 0) { throw 'Plano recusado; não prosseguir.' }
   ```

   Conferir extensões, bind/porta, memórias desligadas, plugins vazios e motor `compressor`. Abortar por item inesperado, credencial reconhecida, link, banco desconhecido ou diff fora do previsto. Não copiar perfil inteiro para outra pasta: retiraria credenciais/sessões do escopo permitido.
4. Aplicar e anotar exatamente o caminho `backup` impresso, sem publicar seus arquivos:

   ```powershell
   & backend/.venv/Scripts/python.exe scripts/harden_hermes_profile.py --profile $perfilHorus --allow-real
   if ($LASTEXITCODE -ne 0) { throw 'Falha: preservar backup e inspecionar antes de reiniciar.' }
   ```

   Conferir `backup/manifest.json` em `state: applied` e manifesto da quarentena. Não editar manifesto/payload.
5. Validar status do backend **antes de reiniciar Hermes**. Usar sessão Hórus autenticada; porta/token vêm do launcher backend, nunca da chave Hermes. Exemplo para backend do operador na porta padrão, com `HORUS_API_TOKEN` já fornecido:

   ```powershell
   $statusHorus = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/v1/security/status' -Headers @{ Authorization = ('Bearer ' + $env:HORUS_API_TOKEN) }
   $statusHorus | ConvertTo-Json -Depth 12
   ```

   Desktop com porta dinâmica usa origem da sessão atual. Esperado: ferramentas/perigosas `[]`, `restricted: true`, ambas as memórias `false`, provedor de memória nulo. Preços ausentes ou limites inválidos mantêm blockers; não forjar aprovação. Endpoint consulta arquivos locais, não prova perfil/estado do gateway.
6. O backend aplica os padrões aprovados da seção seguinte; overrides e preços explícitos vêm do ambiente **do backend**, carregado em `Settings` ao iniciar. Não alterar `.env`/conexão Hermes neste procedimento. Validar teto remoto no provedor separadamente antes de inferência. Somente com conexão, limites, preços, saldo e perfil válidos, esperar `blockers: []` e `real_execution_allowed: true`: admissão local, não autorização de chamada.

   Overrides equivalentes aos padrões já aprovados, na sessão que iniciará o backend:

   ```powershell
   $env:HORUS_MAX_TOKENS_PER_RUN = '16384'
   $env:HORUS_MAX_TOKENS_PER_DAY = '32768'
   $env:HORUS_MAX_RUNS_PER_DAY = '2'
   $env:HORUS_BUDGET_TOTAL_USD = '5'
   $env:HORUS_BUDGET_DAILY_USD = '1'
   ```

   Processos já abertos não herdam essas mudanças; não basta definir variáveis numa janela diferente do launcher. Os preços de entrada/saída devem ser obtidos e definidos pelo operador; este guia não fornece tabela nem libera inferência.

7. Se autorizado, reiniciar pelo launcher existente `./scripts/Prepare-Hermes.ps1 -StartGateway` (seleciona `-p horus`) e repetir status **antes de qualquer análise**. **Se skills essenciais ou cron reaparecerem, abortar liberação e manter gate fechado.** Não esvaziar diretórios de processo ativo, retirar blockers ou aceitar esses itens automaticamente. A instalação inspecionada pode recriá-los; não foi validado caminho operacional sem essa recriação. Resolver exige ensaio autorizado/decisão adicional, sem fork/bypass nesta tarefa.
8. Somente após verificações aprovadas e autorização separada de destino/custo/dados, considerar análise delimitada fictícia. Nenhuma inferência é autorizada por este guia.

Para reverter: gateway exclusivo parado, raízes gerenciadas sem alterações posteriores; substituir `<id>` pelo backup impresso:

```powershell
$backupHorus = Join-Path $perfilHorus '.horus-hardening/<id>/backup'
& backend/.venv/Scripts/python.exe scripts/harden_hermes_profile.py --profile $perfilHorus --allow-real --restore $backupHorus --dry-run
if ($LASTEXITCODE -ne 0) { throw 'Backup/estado divergente; não restaurar.' }
& backend/.venv/Scripts/python.exe scripts/harden_hermes_profile.py --profile $perfilHorus --allow-real --restore $backupHorus
if ($LASTEXITCODE -ne 0) { throw 'Restauração falhou/recusou; preservar arquivos para conciliação.' }
```

Só declara sucesso após verificar hashes. Conferir `state: restored` e status: perfil anterior inseguro deve **voltar a bloquear**, com extensões preservadas. Reinício permanece sujeito à autorização. Se gateway recriou extensões/terceiro editou YAML, restore recusa sobrescrever: preservar e decidir recuperação supervisionada; não remover arquivos para contornar recusa.

## Limites aprovados e aplicados no backend (SEC-C3)

`Settings` aplica estes padrões quando a variável **não existe**; variáveis presentes sobrescrevem os padrões. Vazio, zero, negativo, texto inválido ou combinação inválida bloqueiam execução real, sem fallback silencioso. Payload, agente e memória não modificam a configuração oficial do operador. `HORUS_HERMES_PROFILE` seleciona diretório auditado, sem trocar o gateway externo.

| Variável | Padrão | Validação |
|---|---:|---|
| `HORUS_MAX_TOKENS_PER_RUN` | `16384` | Inteiro positivo, menor ou igual ao teto diário. |
| `HORUS_MAX_TOKENS_PER_DAY` | `32768` | Inteiro positivo. |
| `HORUS_MAX_RUNS_PER_DAY` | `2` | Inteiro positivo; falhas e consumo zero também contam. |
| `HORUS_BUDGET_TOTAL_USD` | `5` | Decimal positivo em USD. |
| `HORUS_BUDGET_DAILY_USD` | `1` | Decimal positivo em USD, menor ou igual ao total. |
| `HORUS_PRICE_INPUT_USD_PER_MTOK` | **Ausente** | Preço explícito positivo em USD por milhão de tokens de entrada. |
| `HORUS_PRICE_OUTPUT_USD_PER_MTOK` | **Ausente** | Preço explícito positivo em USD por milhão de tokens de saída. |

Inteiros aceitam até 11 dígitos ASCII. Decimais usam ponto, até 12 casas decimais, valor máximo `1000000000000` e até 40 caracteres; não aceitam vírgula, espaços, sinais, notação científica, `NaN` ou infinito. Operações monetárias usam `Decimal`; JSON usa strings decimais para preservar precisão. Ambos os preços são obrigatórios: ausência/invalidez gera `pricing_missing` crítico, sem tabela de preços embutida nem consulta a provedor. Orçamento inválido gera `budget_limits_invalid`; tetos inválidos mantêm `cost_limits_missing`/`run_limit_missing`.

Contrato permite até 50 itens; não se promete admitir snapshots máximos com esses tetos. Antes do envio, bytes UTF-8 de envelope+instruções precisam ser menores que o teto por execução. Bytes são heurística para entrada; excluem prompt interno, reasoning e saída. Polling pede parada ao observar excesso e recusa resultado acima do teto. A API de runs não oferece parâmetro comprovado para teto remoto total; `usage` pode chegar só no final.

### Reserva antes do envio e persistência sem migração

A reserva conservadora em USD é `R = max_tokens_per_run × max(preço_entrada, preço_saída) / 1.000.000`. Exemplo **fictício de teste**, sem indicação de preço real: com preços 10/20 USD por milhão, `R = 16384 × 20 / 1000000 = 0.32768 USD`.

O adaptador verifica execuções, tokens e orçamento no mesmo `BEGIN IMMEDIATE` que grava a intenção em `cognitive_runs`, **antes de enviar**. Captura o instante depois de obter a trava e usa o mesmo dia UTC nos três controles e na criação da intenção, inclusive se virar meia-noite durante a transação. Recusa se `gasto_total_estimado + reservas_abertas + R > orçamento_total`, ou se `gasto_estimado_do_dia_UTC + reservas_abertas + R > orçamento_diário`; igualdade é permitida. O gate da autorização devolve HTTP 409 `security_gate`, com mensagem de saldo total/diário insuficiente. Uma autorização aceita antes de outra reserva ainda será rechecada na admissão: pode falhar com `security_gate` sem criar execução ou enviar pedido. Não há retentativa paga automática.

Cada intenção real criada no dia UTC conta uma vez: concluída, falha, cancelada, desconhecida ou consumo zero. Replay/conciliação usa a mesma intenção, sem nova vaga/reserva; nova tentativa exige autorização. Autorizações ainda não enviadas não reservam vaga. A junção com `workflows.cognitive_client='live'` exclui `hermes_simulated` de todos os limites e custos, apesar do legado `provider='hermes'` na tabela.

O schema continua v4. Dados adicionais ficam nos JSON existentes:

- `request.metadata.horus_token_reservation`: teto integral de tokens, como string.
- `request.metadata.horus_cost_reservation_usd`: reserva monetária integral, como string decimal.
- `request.metadata.horus_price_input_usd_per_mtok` e `horus_price_output_usd_per_mtok`: preços congelados na intenção; mudança posterior na configuração não recalcula o histórico.
- `usage.horus_estimated_cost_usd`: custo calculado ou reserva integral se consumo desconhecido.
- `usage.horus_cost_finalized`: `true` somente quando há consumo verificável; a reserva só é liberada em estado final com esse marcador. O adaptador cria os marcadores de custo; conteúdo remoto não os fornece.

Com `input_tokens`, `output_tokens` e `total_tokens` inteiros não negativos e consistentes, o custo é `(entrada × preço_entrada + saída × preço_saída + (cache_leitura + cache_escrita + tokens_não_classificados) × maior_preço) / 1.000.000`. Tokens não classificados são `max(total − entrada − saída − caches, 0)`. Não há tarifas próprias de cache: ele recebe o maior preço configurado, somado conservadoramente mesmo quando também incluído na entrada pelo provedor. Campos incompletos/inválidos preservam a reserva inteira, inclusive após falha/cancelamento/conclusão. Consumo zero completo libera a reserva monetária, mas continua contando uma execução real.

O acumulado total acompanha o banco local, sem reinicialização diária. Gasto diário e quantidade de chamadas usam o dia UTC da criação da intenção. Reservas monetárias desconhecidas/abertas atravessam a meia-noite e oneram também o novo dia, até conciliação com consumo verificável; não são convertidas em saldo livre. Consumo de tokens desconhecido conserva a reserva integral. Intenção antiga ainda pendente conserva tokens, sem contar como nova chamada. Registros reais anteriores sem reserva monetária verificável bloqueiam com `cost_usage_unverifiable`, valores monetários `null` no status e sem migração ou estimativa retroativa automática. Simulações antigas não bloqueiam.

### Consulta do orçamento

`GET /v1/security/status` estende `hermes.cost_limits` de forma aditiva, sem credenciais ou preços privados. Exemplo com os padrões aprovados, banco vazio e preços **não configurados**:

```json
{
  "configured": true,
  "max_tokens_per_run": 16384,
  "max_tokens_per_day": 32768,
  "max_runs_per_day": 2,
  "runs_configured": true,
  "budget_total_usd": "5",
  "budget_daily_usd": "1",
  "budget_configured": true,
  "pricing_configured": false,
  "estimated_spent_total_usd": "0",
  "estimated_spent_today_usd": "0",
  "reserved_usd": "0",
  "runs_today": 0
}
```

`configured` preserva o significado anterior de tetos de tokens válidos; `budget_configured` e `pricing_configured` são independentes. O exemplo mantém `pricing_missing` crítico e `real_execution_allowed: false`. `reserved_usd` soma todas as reservas abertas, sem duplicar os gastos já finalizados. Novos envios sem saldo geram `total_budget_limit`/`daily_budget_limit`.

### O que o controle local não garante

O Hórus impede **novas admissões locais** que excederiam o orçamento estimado segundo os preços e tetos configurados. **Não garante a cobrança remota real, a correção/atualização dos preços do operador, nem contabiliza reasoning/cache/auxiliares não informados pelo provedor.** Uma execução pode exceder o teto antes de o polling receber `usage`; a estimativa pode superar a reserva e bloquear chamadas seguintes. Repetição de transporte usa a mesma chave de idempotência, mas o Hórus não verifica a política de cobrança remota. Não audita painel, crédito, câmbio ou chamadas feitas fora deste banco. Remover/trocar o banco ou editar sua configuração/histórico afeta o controle e não é um mecanismo de liberação autorizado.

Credencial/projeto exclusivo, recarga e corte remoto devem ser validados separadamente pelo operador. O processo Hermes continua sem confinamento de SO. Aprovação dos limites iniciais não autoriza configurar provedor/credenciais, iniciar gateway ou efetuar gasto; cada chamada paga continua dependendo de autorização humana aplicável.

## Validação e riscos residuais

Testes usam `tmp_path`, segredos/dados fictícios, simulador em processo e HTTP exclusivamente em loopback. Cobrem reativações por plugins/MCP/skills/código/contexto, seleção não vazia/alias/desconhecidos/ambiente; status sem ler conteúdo; dry-run sem escrita; backup seletivo; restauração de bytes/diretórios vazios; corrupção/drift/falha de aplicação; limites/rechecagem transacional; injeção de dataset sem efeito e resposta com URL externa reprovada pelo validador. Os testes de orçamento usam Hermes em memória, relógio UTC controlado e recusa de sockets externos: padrões/overrides/inválidos, falta de preços, igualdade e excesso de reservas/gastos total/diário, duas admissões concorrentes sob lock e duas autorizações humanas concorrentes, virada UTC (inclusive dentro da admissão), consumo/cache registrado, consumo desconhecido, simulação excluída e status numérico. Não equivalem a jailbreak de modelo real.

```powershell
& backend/.venv/Scripts/python.exe -m pytest backend/tests -q
& backend/.venv/Scripts/python.exe -m pytest contracts/hermes/tests -q -p no:cacheprovider
```

Resultado final do SEC-C3: **455 aprovados, 1 ignorado** no backend (incluindo 34 novos testes de orçamento); **54 aprovados** no contrato, ambos os comandos com saída zero. O teste de criação real de symlink foi ignorado por falta de permissão no Windows; não foi contornado por elevação. Há aviso de depreciação preexistente de Starlette/httpx; nenhuma dependência foi instalada/atualizada. `git diff --check` e conferência de referências documentais locais passaram. Ensaios manuais do CLI/instalação Hermes pertencem à evidência anterior e não foram repetidos pelo SEC-C3; este incremento não acessou perfis ou bancos operacionais nem autorizou tráfego externo.

O processo Hermes continua com permissões do usuário e pode acessar rede por componentes internos/provedor/catálogos. `network_isolation.enforced` permanece `false`. Job Objects não bloqueiam arquivos/rede; AppContainer, usuário dedicado/VM e política de saída exigem desenho, compatibilidade e autorização próprios. Nada disso foi instalado/configurado aqui.

Gate não autentica versão, ambiente completo, plugins já carregados ou perfil realmente usado pelo gateway; mudanças locais após inspeção são risco residual. A seleção mínima vazia sob as condições inspecionadas não comprova operação contínua do perfil real após reinício. Os limites iniciais desta seção estão aprovados e implementados; alteração operacional do perfil, ensaio de reinício/inferência, credenciais/provedor, preços aplicáveis e confinamento continuam dependendo do idealizador. Não há decisão de implementação pendente no SEC-C3, nem autorização de gasto real.

Checklist executável pré-inferência (HOR-129): [checklist-pre-inferencia.md](checklist-pre-inferencia.md).
