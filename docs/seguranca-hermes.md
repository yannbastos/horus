# Segurança da integração Hermes

## Estado em 12/11/2026

O backend audita configuração local, oferece `GET /v1/security/status` autenticado e recusa autorização/envio real enquanto houver blockers. Não inicia Hermes, escolhe provedor, configura credenciais ou aplica isolamento de SO. Hermes continua externo, sem fork. O incremento integrado em `d050658` já possui limpeza automática do Radar; retenção local não protege o processo Hermes.

O perfil `%LOCALAPPDATA%/hermes/profiles/horus` **não foi alterado** nesta revisão. O diagnóstico integrado informa 24 ferramentas herdadas de `hermes-api-server`, memória/perfil de usuário ativos pelos defaults, ausência de aprovação de escrita e de tetos de tokens. Há `skills: 2 itens; cron: 6 itens`. O inventário abaixo é somente leitura; não foram abertos `.env`, `auth*`, sessões, prompts ou saídas. A conexão privada Hórus–Hermes também não foi modificada.

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

   Desktop com porta dinâmica usa origem da sessão atual. Esperado: ferramentas/perigosas `[]`, `restricted: true`, ambas as memórias `false`, provedor de memória nulo. Tetos ausentes devem manter blockers; não forjar aprovação. Endpoint consulta arquivos locais, não prova perfil/estado do gateway.
6. Após aprovar valores, definir os três tetos no ambiente **do backend** e reiniciá-lo pelo launcher para recarregar `Settings`. Não alterar `.env`/conexão Hermes neste procedimento. Validar teto remoto no provedor separadamente antes de inferência. Com conexão/limites válidos e perfil mínimo, esperar `blockers: []` e `real_execution_allowed: true`: admissão local, não autorização de chamada.

   Exemplo com a proposta deste guia, somente depois de aprovada, na sessão que iniciará o backend:

   ```powershell
   $env:HORUS_MAX_TOKENS_PER_RUN = '16384'
   $env:HORUS_MAX_TOKENS_PER_DAY = '32768'
   $env:HORUS_MAX_RUNS_PER_DAY = '2'
   ```

   Processos já abertos não herdam essas mudanças; não basta definir variáveis numa janela diferente do launcher.

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

## Limites implementados e proposta pendente

`HORUS_MAX_TOKENS_PER_RUN`, `HORUS_MAX_TOKENS_PER_DAY` e **`HORUS_MAX_RUNS_PER_DAY`** são inteiros positivos do operador; ausência/invalidez bloqueia real. Teto por execução não pode superar o diário. Payload/agente/memória não os modificam. `HORUS_HERMES_PROFILE` seleciona diretório auditado, sem trocar gateway externo.

Proposta para primeiro ensaio, **não aplicada ao ambiente real**:

| Variável | Valor | Justificativa |
|---|---:|---|
| `HORUS_MAX_TOKENS_PER_RUN` | `16384` | Piloto de 3–5 itens, uma análise JSON, saída alvo de 2–4 mil tokens. Fixture com 3 itens: envelope 2.131 bytes UTF-8 e instruções do adaptador 756 bytes (serialização medida). Margem para contexto interno ainda não medido; se insuficiente, parar e medir antes de aumentar. |
| `HORUS_MAX_TOKENS_PER_DAY` | `32768` | Duas reservas integrais; impede acúmulo inicial de tentativas. |
| `HORUS_MAX_RUNS_PER_DAY` | `2` | Uma análise e eventual nova análise explicitamente autorizada/revisada; também limita chamadas baratas, falhas e consumo zero. |

Contrato permite até 50 itens; não se promete admitir snapshots máximos com essa proposta. Antes do envio, bytes UTF-8 de envelope+instruções precisam ser menores que teto por execução. Bytes são heurística para entrada; excluem prompt interno, reasoning e saída. Valores de saída/contexto são estimativas, não medição de modelo.

Antes de enviar, o adaptador verifica quantidade diária/saldo sob o mesmo `BEGIN IMMEDIATE` que insere intenção em `cognitive_runs` e reserva teto integral em `request.metadata.horus_token_reservation`. Cada intenção real criada no dia UTC conta uma vez: concluída, falha, cancelada, desconhecida ou consumo zero. Replay/conciliação não cria linha/vaga nova; nova intenção/retentativa conta. Autorizações ainda não enviadas não reservam vaga e são rechecadas na admissão. Junção com `workflows.cognitive_client='live'` exclui simulações apesar do legado `provider='hermes'`.

Consumo conhecido usa `usage.total_tokens`; desconhecido conserva reserva integral, inclusive pendências antigas. Quantidade diária usa dia UTC da criação; pendência antiga mantém reserva de tokens sem contar como nova chamada. Polling pede parada ao observar excesso e recusa resultado acima do teto. API de runs não oferece parâmetro comprovado para teto remoto total; `usage` pode chegar só no final. **Hórus não garante corte financeiro rígido.**

Proposta financeira: credencial/projeto exclusivo, sem recarga automática, saldo inicial máximo equivalente a **US$ 5**, corte diário de **US$ 1** se existir bloqueio efetivo no provedor, e alerta abaixo disso. Valores propostos, sem afirmar preços/recursos de provedor selecionado. Idealizador aprova moeda/teto/provedor e verifica no próprio provedor interrupção de cobrança, incluindo reasoning/caches/auxiliares/tentativas. Alerta sem interrupção não é hard cap. Sem mecanismo confiável, manter real bloqueado operacionalmente até decidir exposição aceitável; Hórus não verifica painel nem controla cobrança remota.

## Validação e riscos residuais

Testes usam `tmp_path`, segredos/dados fictícios, simulador em processo e HTTP exclusivamente em loopback. Cobrem reativações por plugins/MCP/skills/código/contexto, seleção não vazia/alias/desconhecidos/ambiente; status sem ler conteúdo; dry-run sem escrita; backup seletivo; restauração de bytes/diretórios vazios; corrupção/drift/falha de aplicação; limites/rechecagem transacional; injeção de dataset sem efeito e resposta com URL externa reprovada pelo validador. Não equivalem a jailbreak de modelo real.

```powershell
& backend/.venv/Scripts/python.exe -m pytest backend/tests -q
& backend/.venv/Scripts/python.exe -m pytest contracts/hermes/tests -q -p no:cacheprovider
```

Resultado final desta revisão: **386 aprovados, 1 ignorado** no backend; **54 aprovados** no contrato. O teste de criação real de symlink foi ignorado por falta de permissão no Windows; não foi contornado por elevação. A recusa de hardlink, restauração de bytes e rollback de falhas de movimento/cópia passaram. Há aviso de depreciação preexistente de Starlette/httpx; nenhuma dependência foi instalada/atualizada. Também passaram ensaio do CLI em perfil temporário (dry-run, aplicação e restore), ensaio offline das funções instaladas e `git diff --check`. Uma falha intermitente Winsock no teste de reflexão foi corrigida consumindo o corpo POST e delimitando a resposta HTTP do servidor fictício; a suíte completa passou após a correção.

O processo Hermes continua com permissões do usuário e pode acessar rede por componentes internos/provedor/catálogos. `network_isolation.enforced` permanece `false`. Job Objects não bloqueiam arquivos/rede; AppContainer, usuário dedicado/VM e política de saída exigem desenho, compatibilidade e autorização próprios. Nada disso foi instalado/configurado aqui.

Gate não autentica versão, ambiente completo, plugins já carregados ou perfil realmente usado pelo gateway; mudanças locais após inspeção são risco residual. A seleção mínima vazia sob as condições inspecionadas não comprova operação contínua do perfil real após reinício. Alteração do perfil, limites reais, ensaio de reinício/inferência, credenciais/provedor e confinamento dependem do idealizador.
