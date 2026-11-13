# Núcleo de workflows editoriais — simulado

Implementado no backend: pedido → planejamento → pesquisa → análise → proposta → revisão humana. O executor básico `simulated` trata referências como texto, sem consulta externa ou verificação factual; as seções seguintes descrevem o executor Hermes e a integração Radar com cliente em processo. A validação desta entrega é offline e não comprova IA real.

## Execução e persistência

`JobManager` continua sendo o único worker. Os quatro jobs editoriais representam `planning`, `research`, `analysis` e `proposal`; não existe job pai esperando pelos filhos nem um segundo scheduler. `workflows.py` coordena as transições e utiliza uma função assíncrona simulada, limitada a cinco segundos por etapa. Não cria subprocessos, envia prompts ou aciona a fábrica.

Cada revisão possui quatro jobs. A primeira etapa começa em `queued` e as demais em `waiting`. Antes de executar, o backend confere a revisão, a operação fixa, o predecessor e a integridade do artefato de entrada. A conclusão grava artefato, tentativa, estado, evento e liberação da próxima etapa na mesma transação. A fila em memória é um mecanismo de despertar; os jobs persistidos são a fonte oficial.

Ao terminar a proposta, o workflow fica em `awaiting_approval` e libera o worker. Aprovar ou rejeitar encerra a revisão. `request_changes`, acompanhado de feedback, cria uma nova revisão simulada com quatro novos jobs, preservando tentativas, artefatos e decisões anteriores. Essa repetição automática só se aplica aos simuladores locais desta entrega, não autoriza chamadas pagas futuras.

## Schema e migrações

`migrations.py` aplica versões sequenciais em uma transação SQLite; a versão atual é 4 (cliente cognitivo persistido, descrito na seção M1). Não usa `executescript()` para migrações. Banco de versão futura ou banco sem versão com tabelas desconhecidas é recusado. Falha de DDL desfaz a migração e preserva a versão anterior.

Na migração de um banco versão 1 é gerada uma cópia consistente pela API de backup SQLite, com nome único `horus.backup-v1-<id>.sqlite3`, na pasta do banco. A reabertura de um banco já migrado não repete a cópia. A restauração dessa cópia é uma ação manual, com todos os backends encerrados; não há downgrade automático.

Antes de atualizar uma instalação, encerre os backends antigos. A migração é aplicada ao abrir o `Store`; nesta entrega somente bancos temporários de teste foram migrados, não o banco operacional do usuário.

| Estrutura | Uso |
|---|---|
| `jobs` existente | Etapas, revisão, predecessor e contador de execução; operações antigas permanecem compatíveis |
| `workflows` | Pedido, revisão atual, estado, feedback e proposta vigente |
| `job_attempts` | Identidade, entrada por hash, artefatos consumidos, executor, estado, horários e resultado de cada tentativa editorial |
| `artifacts` | Conteúdo validado, schema, hash, revisão e vínculo com job/tentativa; não é sobrescrito por novas revisões |
| `approvals` | Decisão, proposta/revisão, feedback, escopo e autoria local |
| `workflow_events` | Diário transacional de domínio, sem a poda aplicada aos logs técnicos de `events` |

As tabelas `events` e `media` anteriores são preservadas. `workflow_events` é um diário de domínio, não outro sistema de tarefas. Nesta etapa não há política de arquivamento/expurgo desse diário. O histórico detalhado de tentativas é dos jobs editoriais novos; tarefas legadas mantêm seu contrato anterior.

## API

Todas as rotas usam a autenticação local já existente do backend. Não aceitam executor, código, estados oficiais ou identidade do operador no payload.

| Operação | Contrato |
|---|---|
| `POST /v1/workflows` | Requer `Idempotency-Key`; corpo: `objective` e até cinco `references` textuais |
| `GET /v1/workflows` | Até 100 workflows recentes, com estado e revisão |
| `GET /v1/workflows/{id}` | Snapshot consistente com etapas de todas as revisões, tentativas, artefatos e decisões |
| `GET /v1/workflows/{id}/events?after=0` | JSON paginado, até 200 eventos; usar a última `sequence` como próximo cursor. Não é streaming |
| `POST /v1/workflows/{id}/review` | Requer `Idempotency-Key`, `expected_revision`, `artifact_id`, `decision` e feedback opcional |
| `POST /v1/workflows/{id}/cancel` | Cancela o workflow; execução ativa passa por `cancel_requested` antes da confirmação |
| `POST /v1/workflows/{id}/retry` | Corpo: `expected_revision`; retoma a etapa com falha/interrupção na revisão atual |

Exemplo de pedido, para enviar a um backend local já iniciado e autenticado:

```json
{
  "objective": "Propor um vídeo original sobre transformação urbana",
  "references": ["Referência textual fornecida pelo operador; não será consultada"]
}
```

Quando o snapshot estiver em `awaiting_approval`, uma decisão pode usar:

```json
{
  "expected_revision": 1,
  "artifact_id": "ID de 32 caracteres hexadecimais retornado pelo backend",
  "decision": "approve"
}
```

Decisões aceitas: `approve`, `reject` e `request_changes`. A última exige feedback não vazio. O exemplo não é um ID válido: use exatamente a proposta vigente retornada pela consulta. Revisão/proposta obsoleta ou estado inadequado retorna 409. Repetir a mesma chave e decisão devolve o registro original; reutilizar a chave com outra decisão é conflito.

O operador é registrado pelo servidor como `local-operator`, no escopo `editorial_proposal`; o corpo não pode escolher essa autoria. Isso representa o operador da instância autenticada, não autenticação multiusuário ou prova de presença humana. Aprovação simulada não autoriza render, narração, orçamento ou publicação.

As rotas antigas de jobs continuam disponíveis. A operação interna `editorial.simulated` não pode ser submetida diretamente por `POST /v1/jobs`. Uma etapa editorial com falha só pode ser retomada pela rota do workflow. Cancelar uma etapa editorial pendente/ativa cancela seu fluxo; cancelar um job já encerrado permanece uma operação sem efeito, como antes.

## Executor cognitivo Hermes — simulado

O executor dos **novos** workflows é escolhido pelo operador na inicialização do backend (`HORUS_WORKFLOW_EXECUTOR=simulated|hermes`, padrão `simulated`) e gravado em `workflows.executor`; o payload da API não escolhe executor. Workflows simulados mantêm o comportamento descrito acima.

Com `hermes`, o pedido exige `dataset` e `channel_profile` no formato do [contrato 1.0](../contracts/hermes/README.md). As quatro etapas continuam como jobs do mesmo JobManager:

| Etapa | Executor | Comportamento |
|---|---|---|
| `planning` | `local-v1` | Plano fixo; sem rede |
| `research` | `local-v1` | Valida e congela dataset e perfil fornecidos pelo operador, com hash; sem rede |
| `analysis` | `hermes-v1` | Única execução cognitiva: `POST /v1/runs` com envelope do contrato, acompanhamento por `GET /v1/runs/{id}` e validação de evidências no Hórus |
| `proposal` | `local-v1` | Proposta montada somente do resultado validado; `requires_human_review: true` |

**Autorização antes de custo.** Ao concluir `research`, `analysis` fica em `awaiting_authorization` e o workflow aparece com `pending_authorization`. `POST /v1/workflows/{id}/authorize` (com `Idempotency-Key`, `expected_revision` e `job_id`) registra em `authorizations` a autorização do operador local para **uma** execução sobre o snapshot da revisão (`max_runs = 1`), consumida pela tentativa. Retry de `analysis`, falha de validação e `request_changes` voltam a pedir autorização; nenhuma execução paga é repetida automaticamente.

**Rastreabilidade.** `cognitive_runs` guarda, por execução: tentativa, chave de idempotência `horus-<attempt_id>`, corpo enviado e hash, referência externa (`run_id`), estado local e remoto, `usage` e erro. O registro é gravado **antes** do envio; se a resposta da admissão se perder, o pedido é repetido uma vez com a mesma chave e o mesmo corpo. A resposta da API omite o corpo enviado.

**Validação.** O texto final é convertido e validado pelo `EditorialResult` e pelas regras de evidência (fontes, métricas idênticas ao snapshot, termos proibidos). Resposta fora do contrato termina a tentativa como `failed` (`invalid_output`), sem correção automática.

**Cancelamento e falhas.**
- Cancelar pelo operador envia `POST /v1/runs/{id}/stop` e só registra `cancelled` quando o Hermes confirma estado final; sem confirmação, o registro fica `unknown`.
- Pedido de aprovação de ferramenta (`waiting_for_approval`) nunca é aprovado: o Hórus pede parada e registra `policy_violation`.
- Recusas da API (400/401/403/409/422/429) terminam como `failed`, sem nova tentativa.
- Tempo limite do Hórus (`hermes_run_timeout`, padrão 900 s) pede parada; sem confirmação, `unknown`.

**Conciliação.** Encerrar o backend durante a execução, perder contato ou receber 404/5xx deixa a execução `unknown` e a tentativa `interrupted`. Retry é recusado enquanto houver execução `unknown`. `POST /v1/workflows/{id}/reconcile` (com `expected_revision`) reenfileira a etapa para **acompanhar a mesma execução remota**, sem novo `POST` e sem nova autorização; se ela concluiu, o resultado é validado e aproveitado. Workflow cancelado com execução `unknown` não é reaberto por conciliação.

**Conexão.** Usa o arquivo privado de conexão do diagnóstico Hermes (`hermes_config`): origem HTTP em loopback com porta explícita, sem proxy de ambiente e sem redirects. Nenhuma configuração do perfil Hermes é alterada pelo Hórus.

**Limites desta entrega.** Somente o Hermes simulado foi exercitado; não houve gateway real, modelo, custo real, YouTube ou UI editorial. O acompanhamento usa consulta periódica (`hermes_poll_seconds`), não SSE. Não há teto monetário: a autorização limita a quantidade de execuções e `usage` registra tokens informados. Não há correção automática de JSON inválido nem delegação a subagentes.

Novas tabelas da migração v3: `cognitive_runs` e `authorizations`; nova coluna `workflows.executor` (padrão `simulated`). Nenhuma tabela existente foi reconstruída.

## Interrupção e concorrência

Uma trava de sistema operacional no arquivo adjacente `.sqlite3.worker.lock` impede dois JobManagers sobre o mesmo caminho de banco. A segunda instância é recusada antes da recuperação de tarefas. O sistema operacional libera a trava após morte do processo; a existência do arquivo, sozinha, não significa que há worker ativo.

Após reinício, etapas confirmadas e seus artefatos permanecem concluídos; etapas `queued` são recuperadas sem reexecutar predecessores. Tentativas em execução são registradas como `interrupted` e exigem retry explícito. Cancelamento persistido é concluído sem repetir a simulação. Resultados de tentativas encerradas não podem substituir artefatos aceitos posteriormente.

Uma falha deixa sucessores em espera. O retry preserva os resultados já concluídos e cria uma nova tentativa somente na etapa interrompida/com falha. Não há reconciliação de serviços externos: nenhum executor externo faz parte deste núcleo.

## Verificações deste incremento — 2026-11-11

Executada a suíte completa do backend em diretório temporário exclusivo dentro de `artifacts/`:

```powershell
& backend/.venv/Scripts/python.exe -m pytest backend/tests -q --tb=short --maxfail=1 --basetemp <diretorio-novo-de-teste> -o cache_dir=artifacts/pytest-cache-workflows
```

Resultado: **89 testes passaram**, incluindo 22 testes do núcleo editorial e os 67 testes anteriores. Cobertura nova: fluxo completo, idempotência, liberação do worker, versões/decisões obsoletas, revisão concorrente, falha/retry, cancelamento, dependências e integridade, rollback de uma conclusão parcial, eventos duráveis, autenticação, resultado inválido, segundo backend, backup/migração e recusa de downgrade. Ensaios de morte abrupta usam processos Python locais com `os._exit()` e bancos temporários, antes ou depois da confirmação de uma etapa.

Não foram executados builds/testes visuais, instalação NSIS, banco operacional, modelos reais, YouTube API, renderização ou publicação. Não houve alteração de outros repositórios, instalação de dependências, commit ou push.

Limites: fluxo linear fixo, somente simulação, aprovação local de um operador e consulta por API. UI editorial, custos e executores reais continuam para entregas futuras.

## Radar e Hermes em processo (M1)

`HORUS_RADAR_EXECUTOR=hermes_simulated|hermes` escolhe o executor de **novos workflows do Radar**, com padrão `hermes_simulated`. Não altera `HORUS_WORKFLOW_EXECUTOR` nem o contrato de `POST /v1/workflows`. O payload nunca escolhe executor. A migração v3→v4 é exclusivamente aditiva: `workflows.cognitive_client TEXT NOT NULL DEFAULT 'live' CHECK(cognitive_client IN ('live','simulated'))`. Workflows antigos preservam `live`; os novos simulados persistem `executor='hermes'` e `cognitive_client='simulated'`, sem reconstruir tabelas, índices ou FKs. A API traduz essa combinação para `executor='hermes_simulated'` e `simulated: true`.

O cliente `HermesSimulator` é injetado em `HermesStages.client_factory` e executa em processo, sem sockets, ferramentas, provedor ou leitura da conexão privada Hermes. A saída determinística usa somente o envelope: fontes do dataset, fatos com métricas idênticas, proposta genérica e uso de tokens zero. Não interpreta títulos, objetivo ou resumo como instruções; não certifica mérito editorial. As consultas progridem por `queued`, `running` e `completed`; `stop` confirma `cancelled`. `analysis` exige autorização humana, e o artefato `proposal` traz `simulated: true`. A aprovação/rejeição continua registrada em `approvals`.

| Rota autenticada | Resposta e limites |
|---|---|
| `GET /v1/radar/datasets` | Resumos da última revisão não expirada por snapshot, máximo 100 |
| `GET /v1/radar/datasets/{snapshot_id}/{revision}` | `{dataset, eligibility}`; 404 ausente/expirado |
| `POST /v1/radar/datasets/demo` | 201, resumo fictício; `Idempotency-Key` obrigatório |
| `POST /v1/workflows/radar` | 202, snapshot; `Idempotency-Key` obrigatório; recebe `snapshot_id`, `revision`, `objective`, `channel: {channel_id, summary}` e `source_ids` opcional, máximo 50 |

O adapter converte `PublicRecord` de tipo vídeo em `DatasetItem`, preserva a origem e os horários, trunca título em 300 caracteres, canal em 200 e idioma em 16, inclui somente métricas não nulas e associa inscritos pelo `youtube_id` do canal correspondente a `channel_id`. `unavailable` não exclui o vídeo por si só. `ChannelProfile.revision_hash` é SHA-256 do resumo UTF-8. Sem seleção explícita, usa os primeiros 50 elegíveis; seleção vazia, duplicada, desconhecida ou inelegível retorna 409. A validação do corpo retorna 422.

A elegibilidade informa `invalid_source_id`, `invalid_url`, `missing_title`, `missing_channel` e `missing_published_at`. O snapshot expõe `radar: {snapshot_id, revision, origin, expires_at, included, excluded}`; exclusões registram as razões de inelegibilidade. A idempotência considera também o corpo original, diferenciando seleção implícita e explícita; chave reutilizada com outro corpo retorna 409.

### Retenção das cópias do Radar (M2)

Implementada em `backend/src/horus_backend/retention.py` (`run_retention(store, clock=..., dry_run=False)`). Vale somente para workflows com bloco `radar`; `simulated`/`hermes` sem Radar não são tocados. Gatilho: `radar.expires_at <= agora` (28 dias após a coleta). Ação: **redação** sem apagar linhas, sem alterar estados e sem mudança de schema. O marcador é `{"redacted": true, "reason": "radar_retention", "expired_at": <expires_at>, "sha256": <hash do conteúdo original>}`; `request_hash`, `snapshot_hash`, `input_hash` e `content_hash` permanecem.

| Local | Conteúdo | Tratamento |
|---|---|---|
| `workflows.payload.dataset` | itens: título, canal, URL, métricas, horários | **redigido** |
| `artifacts.content` `research` | `dataset` congelado | **redigido** |
| `artifacts.content` `analysis` | `result.sources` (URL/título) e `result.facts` (texto e `metric_refs`) | **redigido** |
| `cognitive_runs.request` | `input` (envelope serializado com o dataset) | **redigido** (`request_hash` mantido) |
| `jobs.error`, `job_attempts.error`, `cognitive_runs.error`, `workflow_events.data.error` | mensagens de erro | trocadas só se repetirem literalmente título/URL/canal do dataset |
| `workflows.payload` (`radar`, `channel_profile`, `objective`, `_radar_request`), `feedback` | metadados, IDs, entrada do operador | preservado; `radar.redacted_at` é acrescentado |
| `artifacts.content` `planning`, `proposal`; `analysis.result` (hipóteses, oportunidades, recomendação, `unknowns`, `memory_proposals`) | texto editorial derivado | preservado (a proposta mantém `content_hash`, então `review` segue válido); o evento registra `editorial_literal_matches`, a contagem de campos preservados que repetem literalmente texto do YouTube |
| `scripts.document`, `script_receipts.response.document` (M3) | roteiro derivado da proposta e cópias editoriais nos recibos idempotentes | preservado; correspondências literais inventariadas separadamente em `script_editorial_literal_matches` e `script_receipt_editorial_literal_matches`, sem alterar a métrica legada; cada recibo conta sua própria cópia |
| `jobs.result`, `job_attempts.result`, `events`, demais eventos, `approvals`, `authorizations` | IDs, estados, decisões, feedback | preservado (sem conteúdo do YouTube) |

Cada workflow é redigido em uma transação `BEGIN IMMEDIATE`; falha desfaz só aquele workflow, e o próximo ciclo tenta de novo. Idempotente: `radar.redacted_at` marca o workflow como já tratado. Workflows com etapa em execução (`running`/`cancel_requested`) são adiados ao próximo ciclo, pois a etapa ainda gravaria o dataset. Cada workflow redigido gera um evento `workflow.radar_redacted` (contagens, sem conteúdo). O relatório traz `evaluated`, `redacted`, `already_redacted`, `not_expired`, `deferred_active`, `failed` e `ignored`; `dry_run=True` não escreve.

Execução: `JobManager.start()` (após `recover`) e a cada 6 h, via `asyncio.to_thread`, sem scheduler externo. O mesmo ciclo chama `RadarState.purge()` do arquivo do Radar. Falha no ciclo é registrada em log e não impede a inicialização.

Remoção física (SEC-S2): todas as conexões do banco operacional usam `PRAGMA secure_delete=ON` (`Store.connect`), de modo que páginas liberadas pela redação, inclusive as de *overflow* do dataset, são zeradas. Quando o ciclo redige ao menos um workflow, `run_retention` executa `wal_checkpoint(TRUNCATE)` (`Store.checkpoint`) para esvaziar o `-wal`. O resultado vai em `RetentionReport.checkpoint` e em `retention_status["checkpoint"]`: `status` (`ok`, `busy` com leitor ativo ou `error`), `wal_frames`, `checkpointed_frames`, `wal_bytes`, `freelist_pages`, `page_count`, sem conteúdo. `busy`/`error` não falham o ciclo: o checkpoint fica pendente e o ciclo seguinte o repete, mesmo sem novas redações. `dry_run` nunca executa checkpoint. Detalhes, medições e limites em [segurança dos dados](seguranca-dados.md).

Respostas após a redação: `retry`, `reconcile` e `authorize` retornam 409 ("Dataset Radar expirado e removido…"); `review` `request_changes` também (nova revisão reexecutaria a análise sem o dataset); `approve`/`reject` de proposta existente continuam permitidos; uma etapa já enfileirada é bloqueada por `_claim`. `GET /v1/workflows/{id}` funciona e expõe `radar.redacted_at`; `request.dataset` e os artefatos mostram apenas o marcador. Repetir `POST /v1/workflows/radar` com a mesma chave não reabre o workflow (a fonte expirada já retorna 404).

No M3, nova geração de roteiro e nova decisão `request_changes` também retornam 409 após a redação do Radar, sem transição, evento ou recibo parcial. Aprovar/rejeitar a versão atual e replays idempotentes anteriores continuam permitidos; GET/histórico/replay preservam o documento editorial e sua auditoria. Isso não assegura ausência de títulos/URLs/canais incorporados ao texto editorial da proposta ou roteiro: a política preserva derivados, e os contadores de correspondência apenas inventariam essa limitação. Detalhes em [roteiros simulados](roteiros-simulados.md#retenção-dados-fonte-e-cópias-editoriais).

**Limites:** a redação usa `UPDATE`; o `secure_delete` e o checkpoint cobrem o que for liberado a partir de agora, mas **não limpam páginas livres antigas** (exigem um `VACUUM` manual, decisão do idealizador), **não alcançam** backups `horus.backup-v*.sqlite3` gerados em migrações (a remoção é opt-in via `HORUS_BACKUP_RETENTION_DAYS`, nunca automática; há inventário e *dry-run*), SSD/TRIM, cópias de sombra do Windows, OneDrive, exportações do operador, logs nem a cópia mantida pelo Hermes real. Dados reais continuam condicionados a tratar esses itens; recomenda-se BitLocker. Ver [segurança dos dados](seguranca-dados.md).

O simulador mantém execuções em memória: reinício conserva a seleção do cliente e autorizações pendentes no SQLite. Uma análise em andamento no encerramento fica `unknown`, como no cliente real; `POST /v1/workflows/{id}/reconcile` consulta o simulador novo, que não conhece a execução perdida e a encerra deterministicamente como `interrupted` (não há trabalho externo a conciliar). O workflow fica `failed`, o retry volta a liberar a etapa e exige **nova autorização**; não há troca para cliente real nem reenvio automático. `stop` de execução desconhecida responde `cancelled`, sem exceção. Coberto por `test_restart_during_simulated_analysis_recovers`. O cliente HTTP existente e as regras de autorização permanecem em uso para `hermes`.

Validação M1 usa exclusivamente bancos temporários e conexão/socket bloqueados durante a execução simulada. Inclui migração aditiva/rollback, reabertura, aprovação/rejeição persistidas, cancelamento confirmado, saída inválida e expiração; não comprova integração com Hermes real. A retenção tem testes próprios em `backend/tests/test_retention.py`; o endurecimento do SQLite (`secure_delete`, WAL, páginas livres e backups) em `backend/tests/test_sqlite_hardening.py`.

### Exemplos observados em teste local da API M1

Respostas resumidas de TestClient em banco temporário; datas/IDs são desta execução, sem dados reais. `POST /v1/radar/datasets/demo` retornou 201 e `GET /v1/radar/datasets` retornou 200 com uma lista contendo o mesmo resumo:

```json
{"snapshot_id":"rad_4ef08c01b241a5e4eb8f8ef5","revision":1,"origin":"operator_fixture","status":"complete","collected_at":"2026-11-12T10:54:52.094753Z","expires_at":"2026-12-10T10:54:52.094753Z","records":6,"videos":5,"eligible_videos":4,"issues":0}
```

`GET /v1/radar/datasets/rad_4ef08c01b241a5e4eb8f8ef5/1` retornou 200, com dataset completo (abreviado abaixo) e as cinco entradas de elegibilidade:

```json
{"dataset":{"schema_version":"radar.youtube.v1","snapshot_id":"rad_4ef08c01b241a5e4eb8f8ef5","revision":1,"origin":"operator_fixture"},"eligibility":{"video_demo_0":{"eligible":true,"reasons":[]},"video_demo_1":{"eligible":true,"reasons":[]},"video_demo_2":{"eligible":true,"reasons":[]},"video_demo_3":{"eligible":true,"reasons":[]},"video_demo_4":{"eligible":false,"reasons":["missing_published_at"]}}}
```

`POST /v1/workflows/radar` retornou 202:

```json
{"id":"f798c29e43864f819e24f957ecfa8518","status":"queued","executor":"hermes_simulated","simulated":true,"radar":{"snapshot_id":"rad_4ef08c01b241a5e4eb8f8ef5","revision":1,"origin":"operator_fixture","expires_at":"2026-12-10T10:54:52.094753Z","included":["video_demo_0","video_demo_1","video_demo_2","video_demo_3"],"excluded":[{"source_id":"video_demo_4","reasons":["missing_published_at"]}]}}
```

Para reproduzir os fluxos completos: `& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_radar_workflow.py -q` (11 casos). As suítes obrigatórias são `& backend/.venv/Scripts/python.exe -m pytest backend/tests -q` e `& backend/.venv/Scripts/python.exe -m pytest contracts/hermes/tests -q -p no:cacheprovider`.

Resultado final desta execução M1: **223 testes backend aprovados** em 75,77 s e **54 testes de contrato aprovados** em 8,88 s; `git diff --check` aprovado. A suíte backend emite somente o aviso preexistente de depreciação Starlette/httpx; não foram instaladas dependências para suprimi-lo. Nenhum banco operacional, provedor, Hermes real ou YouTube real foi acessado.
