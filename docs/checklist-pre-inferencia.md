# Checklist de segurança antes da primeira inferência real do Hermes

Escopo: Issue [HOR-129](https://github.com/yannbastos/horus-management/issues/116) (P0, Security Core). Estado em 12/11/2026, sobre `main` `dfd5286`.

**Este checklist não aprova nem habilita inferência.** Ele separa o que o código já impõe, o que só foi ensaiado com simuladores, o que depende de configuração do operador e o que ainda não existe. Concluir todas as seções é condição necessária; a liberação continua dependendo de autorização humana específica de provedor, destino, custo e dados (veja [seguranca-hermes.md](seguranca-hermes.md)). Nenhum item abaixo exige rede externa, credencial, provedor ou preço.

Regras de execução: as etapas A e B são somente leitura/offline. Não iniciar gateway, não usar `hermes -z`, não abrir `.env`/`auth*`/sessões, não definir preços ou credenciais para "ver passar". Qualquer item **ABORTAR** mantém o gate fechado e interrompe o checklist.

## Legenda de evidência

| Marca | Significado |
|---|---|
| **IMPL** | Controle implementado no backend e coberto por teste offline. |
| **ENSAIO** | Verificado apenas com simulador/fixture/código Hermes extraído; não prova o processo real. |
| **CONFIG** | Depende de configuração/decisão do operador ainda ausente ou não verificável pelo repositório. |
| **AUSENTE** | Sem controle implementado; pendência registrada em Issue. |

## A. Verificações automatizadas (offline)

Na raiz do repositório, com a `.venv` do backend criada por `uv sync --project backend --frozen --extra test`:

```powershell
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_pre_inference.py backend/tests/test_security.py backend/tests/test_security_budget.py backend/tests/test_security_profile.py backend/tests/test_workflow_hermes.py backend/tests/test_hermes.py -q -p no:cacheprovider
& backend/.venv/Scripts/python.exe -m pytest contracts/hermes/tests -q -p no:cacheprovider
```

- **Esperado:** saída zero, sem falhas; `test_security.py` pode ignorar 1 teste (symlink sem permissão no Windows).
- **ABORTAR:** qualquer falha ou teste desabilitado além do symlink. Não editar testes para passar.
- Cobertura existente: perfil sem ferramentas/memória, extensões, tetos de tokens/execuções, orçamento e preços (`security_gate` HTTP 409 antes de criar autorização), autorização humana única/idempotente, cancelamento, reconciliação após reinício, exfiltração/prompt injection fictícios e cliente restrito a loopback.

## B. Estado do gate local (somente leitura)

Com um backend do operador **já em execução** (não iniciado por este checklist), consultar o endpoint autenticado. Ele lê arquivos locais, não inicia Hermes nem abre rede:

```powershell
$s = Invoke-RestMethod -Uri "http://127.0.0.1:$env:HORUS_BACKEND_PORT/v1/security/status" -Headers @{ Authorization = ('Bearer ' + $env:HORUS_API_TOKEN) }
$s.real_execution_allowed; $s.blockers | Select-Object code, severity
```

Sem backend em execução, o equivalente offline é o teste `test_default_installation_is_simulated_and_refuses_real_execution`.

| # | Verificação | Esperado para **prosseguir** | ABORTAR se | Estado conhecido neste PC |
|---|---|---|---|---|
| B1 | `real_execution_allowed` | `true` com `blockers: []` (necessário, não suficiente) | `false` ou blocker `critical` | **Fechado.** Perfil `horus` ausente; sem preços |
| B2 | `workflow_executor_default`, `radar_executor` | `simulated` / `hermes_simulated` até a autorização final | `hermes` sem decisão registrada | Padrão do código é simulado (IMPL, testado) |
| B3 | `pricing_configured` | `true`, com preços de entrada e saída informados pelo **operador** | `pricing_missing` | **CONFIG ausente.** Sem tabela embutida; não inventar |
| B4 | `budget_configured`, `runs_configured`, `configured` | `true`; padrões aprovados 16384 tokens/execução, 32768/dia, 2 execuções/dia, USD 5 total, USD 1/dia | `budget_limits_invalid`, `cost_limits_missing`, `run_limit_missing` | IMPL; variáveis `HORUS_*` do backend podem sobrescrever |
| B5 | `hermes.tools.effective`, `dangerous`, `restricted` | `[]`, `[]`, `true` | `profile_unverifiable`, `dangerous_tools_enabled` | Depende do perfil real (ausente aqui) |
| B6 | `memory.local_enabled`, `user_profile_enabled`, `external_provider` | `false`, `false`, nulo | `memory_enabled`, `external_memory_provider` | Idem |
| B7 | `profile_extensions_present` | ausente (skills/cron/plugins/mcp/hooks vazios) | presente | Ver R3 |
| B8 | `connection` e bind | `loopback`; bind loopback | `connection_invalid`, `connection_not_configured`, `gateway_bind_unverified` | Não verificado aqui |
| B9 | Uso diário e orçamento | dentro dos tetos | `daily_run_limit`, `daily_token_limit`, `total_budget_limit`, `daily_budget_limit`, `cost_usage_unverifiable`, `usage_unverifiable` | Banco novo: zero |

## C. Controles além do que o status mede

O status **não bloqueia** nenhum item desta seção. `real_execution_allowed: true` com todos eles em aberto é o comportamento atual, fixado por `test_local_gate_open_is_not_pre_inference_approval`.

| # | Controle | Evidência hoje | Critério para considerar atendido | ABORTAR se | Issue |
|---|---|---|---|---|---|
| C1 | Isolamento de SO/rede do Hermes | **AUSENTE.** `network_isolation.enforced: false`; Job Objects não limitam arquivo/rede; sem AppContainer, usuário dedicado, VM ou política de saída | Mecanismo aplicado e verificado por ensaio autorizado (tráfego/arquivos bloqueados) | Gateway com as permissões plenas do usuário e risco não aceito por escrito | [HOR-124](https://github.com/yannbastos/horus-management/issues/111); saída de dados [HOR-111](https://github.com/yannbastos/horus-management/issues/99) |
| C2 | Corte financeiro remoto | **CONFIG/AUSENTE.** Controle local e estimado; a API de runs não oferece teto remoto comprovado; a execução pode exceder antes do `usage` | Credencial/projeto exclusivo, teto e recarga validados **no provedor** pelo operador | Chave compartilhada, saldo ilimitado ou teto não verificado | [HOR-026](https://github.com/yannbastos/horus-management/issues/28), [HOR-031](https://github.com/yannbastos/horus-management/issues/33) |
| C3 | Autorização humana por chamada | **IMPL.** Autorização única, escopada e idempotente; gate repetido antes do envio; nova tentativa exige nova autorização; sem retentativa paga automática | Cada execução real com autorização de destino, custo e dados | Qualquer envio sem autorização (reportar como defeito) | — |
| C4 | Ferramentas e memória | **IMPL** no gate; **ENSAIO** na seleção (`scripts/verify_hermes_tool_selection.py`, funções extraídas do Hermes 0.23.1, sem importar o runtime). O endurecimento do perfil real foi relatado pelo coordenador, mas não é verificável neste PC | B5–B7 verdes **e** repetidos após reinício do gateway | Skills essenciais/cron reaparecem após reinício | [HOR-112](https://github.com/yannbastos/horus-management/issues/100) |
| C5 | Auditoria de transmissões | **AUSENTE.** `audit.available: false` | Registro de cada envio externo sem conteúdo confidencial | Sem decisão explícita do idealizador aceitando a lacuna | [HOR-115](https://github.com/yannbastos/horus-management/issues/103) |
| C6 | Modos Local/Controlado/Conectado e consentimento | **AUSENTE.** `private_mode.available: false` | Modo implementado com consentimento granular | Idem | [HOR-113](https://github.com/yannbastos/horus-management/issues/101) |
| C7 | Credenciais em repouso | Chave em arquivo local; ACLs não auditadas; sem cifragem dedicada | Proteção decidida/implementada | Chave em repositório, log ou frontend | [HOR-114](https://github.com/yannbastos/horus-management/issues/102) |
| C8 | Retenção, treinamento e subprocessadores do provedor | **CONFIG.** Nenhum provedor escolhido | Política do provedor revisada pelo operador | Provedor não revisado | [HOR-116](https://github.com/yannbastos/horus-management/issues/104) |
| C9 | Exfiltração e prompt injection | **ENSAIO** com simulador e dados fictícios; não equivale a jailbreak de modelo real | Regressões com modelo real só após autorização | — | [HOR-118](https://github.com/yannbastos/horus-management/issues/106) |
| C10 | Política e inventário de destinos | Inventário parcial em `seguranca-hermes.md`; política formal pendente | Política e fluxos formalizados | — | [HOR-109](https://github.com/yannbastos/horus-management/issues/97), [HOR-110](https://github.com/yannbastos/horus-management/issues/98) |

Todas as Issues acima estavam abertas em 12/11/2026; a vinculação a HOR-129 vem da própria Issue [HOR-129](https://github.com/yannbastos/horus-management/issues/116) (HOR-109 a HOR-118) e das Issues de custo/sandbox existentes. Nenhuma Issue foi alterada.

## D. Ordem e critério de saída

1. A e B1–B9 aprovados no ambiente que será usado (perfil real, não fixtures).
2. Cada item C classificado por decisão escrita do idealizador: atendido ou **risco aceito** nomeado. Nada em C pode ser inferido do gate local.
3. Autorização humana separada para a primeira chamada: provedor, modelo, destino, teto monetário no provedor, dados do envelope (fictícios na primeira). Primeira execução com dataset fictício e limite mínimo.
4. Depois da primeira execução, conciliar `usage` e `reserved_usd` e repetir B; divergência fecha o gate.

## Riscos concretos

- **R1 — gate local aberto não é segurança.** O status pode retornar `blockers: []` com C1, C2, C5 e C6 em aberto.
- **R2 — estimativa não é cobrança.** Reasoning/cache não informados, polling tardio e preços digitados errados deixam o gasto real acima do estimado.
- **R3 — recriação de extensões.** O Hermes 0.23.1 pode recriar skills essenciais/cron ao reiniciar; o gate volta a bloquear, mas não há caminho operacional validado sem recriação.
- **R4 — perfil real não verificado aqui.** O perfil `horus` está ausente neste PC; o endurecimento relatado não foi reauditado por este trabalho.
- **R5 — processo externo sem confinamento.** O Hermes mantém rede e arquivos do usuário.
- **R6 — mudança após inspeção.** Plugins já carregados, ambiente completo e perfil efetivamente usado pelo gateway não são autenticados pelo gate.

## Fora de escopo

Configurar perfil, provedor, credenciais, preços, firewall ou sandbox; iniciar gateway; qualquer chamada paga ou de rede externa.
