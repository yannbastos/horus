# Núcleo de workflows editoriais — simulado

Implementado no backend, sem nova interface ou integração de IA. Pedido → planejamento → pesquisa → análise → proposta → revisão humana. Todos os resultados são identificados como simulação; referências são somente texto fornecido pelo operador, sem consulta externa ou verificação factual.

## Execução e persistência

`JobManager` continua sendo o único worker. Os quatro jobs editoriais representam `planning`, `research`, `analysis` e `proposal`; não existe job pai esperando pelos filhos nem um segundo scheduler. `workflows.py` coordena as transições e utiliza uma função assíncrona simulada, limitada a cinco segundos por etapa. Não cria subprocessos, envia prompts ou aciona a fábrica.

Cada revisão possui quatro jobs. A primeira etapa começa em `queued` e as demais em `waiting`. Antes de executar, o backend confere a revisão, a operação fixa, o predecessor e a integridade do artefato de entrada. A conclusão grava artefato, tentativa, estado, evento e liberação da próxima etapa na mesma transação. A fila em memória é um mecanismo de despertar; os jobs persistidos são a fonte oficial.

Ao terminar a proposta, o workflow fica em `awaiting_approval` e libera o worker. Aprovar ou rejeitar encerra a revisão. `request_changes`, acompanhado de feedback, cria uma nova revisão simulada com quatro novos jobs, preservando tentativas, artefatos e decisões anteriores. Essa repetição automática só se aplica aos simuladores locais desta entrega, não autoriza chamadas pagas futuras.

## Schema e migrações

`migrations.py` aplica versões sequenciais em uma transação SQLite; a versão atual é 3 (acréscimos do executor cognitivo, descritos abaixo). Não usa `executescript()` para migrações. Banco de versão futura ou banco sem versão com tabelas desconhecidas é recusado. Falha de DDL desfaz a migração e preserva a versão anterior.

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
