# Roteiros estruturados simulados — M3

O backend oferece geração local determinística de roteiro a partir de uma proposta aprovada e revisão humana por versão (HOR-049/HOR-050). O documento usa o contrato puro `script_contract.py`; não há inferência, acesso externo, execução da fábrica ou produção após aprovação.

## API autenticada

Todas as rotas usam o token local existente. Todos os POSTs exigem `Idempotency-Key` (1–128 caracteres). A chave é vinculada à operação e ao recurso: replay do mesmo pedido devolve a resposta original persistida, mesmo depois de revisão ou reinício; outro payload com a mesma chave retorna 409. Para obter o estado atual, consulte GET.

- `POST /v1/workflows/{workflow_id}/scripts`: `{expected_revision, proposal_artifact_id}`; 201 na criação, 200 no replay.
- `GET /v1/workflows/{workflow_id}/scripts`: `{items: [...]}`, versões em ordem decrescente.
- `GET /v1/scripts/{script_id}`: conteúdo e estado atual de uma versão.
- `POST /v1/scripts/{script_id}/review`: `{expected_version, decision, feedback?}`; decisões `approve`, `reject`, `request_changes`; feedback obrigatório para solicitar alterações, máximo 2.000 caracteres.

IDs desconhecidos retornam 404; ausência de autenticação, 401; revisão, estado, aprovação ou chave conflitante, 409; payload ou documento inválido, 422. Os erros das rotas de roteiro usam mensagens sanitizadas, sem reproduzir conteúdo privado da validação Pydantic.

A geração exige workflow `approved`, revisão e artefato atuais, aprovação `approve` persistida com operador local e escopo de proposta, e hash íntegro da proposta. A primeira geração só ocorre sem roteiro anterior. Apenas `changes_requested` permite nova versão; `awaiting_review`, `approved` e `rejected` impedem outra geração. Cada versão tem novo ID; conteúdo, origem, hash da proposta, revisão e data de criação permanecem preservados. A revisão só aceita a versão mais recente em `awaiting_review`; aprovar ou rejeitar é final. Replay não reaplica transições.

## Conteúdo e fontes

O gerador fixo produz abertura, desenvolvimento e conclusão com `simulated: true`. Reutiliza título e trecho da proposta, explicita a simulação e inclui o feedback da versão anterior no desenvolvimento. Não verifica fatos ou melhora criativamente o texto. O desenvolvimento limita o trecho da proposta para preservar integralmente o feedback de até 2.000 caracteres.

Propostas editoriais v1 simuladas não possuem fontes verificadas: `source_ids=[]`. Propostas v2 referenciam uma análise; o serviço confere workflow, revisão, etapa e hash desse artefato antes de usar os IDs de `result.sources` do snapshot aprovado. `source_artifact_ids` serve somente à proveniência. O validador puro confere todas as referências antes da persistência; o cliente não fornece fontes nem escolhe executor. Snapshots do Radar já redigidos pela retenção não permitem nova geração nem nova decisão `request_changes` (409, sem gravação parcial). Aprovação e rejeição da versão atual continuam permitidas; replay idempotente de uma decisão anterior é preservado.

### Retenção: dados fonte e cópias editoriais

A política M2 de 28 dias redige dataset, fontes/fatos e envelope cognitivo, mas preserva a proposta e texto editorial derivado. O roteiro simulado copia somente título/trecho editorial da proposta, IDs de referência e feedback; não copia dataset, URLs das fontes ou métricas brutas. `scripts.document` e `script_receipts.response.document` são novas cópias editoriais preservadas, assim como decisões e metadados. GET, histórico e replay continuam devolvendo esse documento editorial depois da redação, com o mesmo `ScriptDocument`; não há marcador ou novo estado M3.

**Limitação explícita:** o texto editorial pode repetir literalmente título/canal/URL do dataset (por exemplo, se a proposta já os incorporou). A política vigente preserva essas correspondências, não garante ausência de texto do Radar em todo o banco ou em toda resposta. A limpeza não foi ampliada para remover derivados editoriais. O evento de retenção inventaria os campos textuais dos documentos M3 com correspondências literais por `script_editorial_literal_matches` e `script_receipt_editorial_literal_matches`; recibos contam suas próprias cópias, inclusive replays de revisão. `editorial_literal_matches` continua medindo apenas os artefatos anteriores. São contagens sem conteúdo, e não uma avaliação semântica ou comprovação de conformidade para dados reais.

## Persistência e recuperação

Migração incremental v4→v5 adiciona `scripts` e `script_receipts`, sem reconstruir tabelas anteriores. A migração existente cria backup do banco anterior e executa DDL em transação; falha reverte integralmente o incremento. Não abrir o banco operacional para ensaiar este recorte.

Geração e revisão usam `BEGIN IMMEDIATE`: verificação de estado, versão, documento/decisão, recibo e evento de auditoria são uma única transação. A restrição única `(workflow_id, version)` reforça o versionamento. Pedidos concorrentes com chaves distintas têm um único vencedor; pedidos iguais com a mesma chave compartilham a mesma resposta. Falha antes do commit não deixa versão ou recibo parcial; reenvie a mesma chave. Não existe tarefa em execução a recuperar nem fila nova: a simulação é síncrona e limitada pelo contrato. O worker editorial existente permanece independente.

Os recibos preservam a resposta original, portanto contêm uma cópia do documento editorial. Aprovação da proposta, jobs e tentativas anteriores não são alterados. A auditoria usa os eventos locais `script.created` e `script.reviewed` (operador local definido pelo backend).

## Validação local

Executar na worktree com a dependência `script_contract.py` da entrega Sonnet integrada para testes:

```powershell
uv sync --project backend --frozen --extra test
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_scripts.py -q
& backend/.venv/Scripts/python.exe -m pytest backend/tests -q
git diff --check
```

Os testes usam bancos temporários, API em processo e executores simulados. O fluxo com fontes bloqueia conexões de socket e leitura da configuração privada do Hermes. Cobrem aprovação persistida, revisão/artefato/hash, validação de referências e estrutura, erros sem sentinela confidencial, autenticação, idempotência divergente, concorrência, histórico, feedback, estados finais, rollback e recuperação após reinício, além da migração v5 com backup e rollback.

Limites: integração visual e aceite conjunto pertencem à revisão com o frontend; não foram exercitados por estes testes backend. Não houve inferência real, acesso a credenciais, renderização, publicação, merge ou push.

Evidência desta entrega (2026-11-12): instalação por `uv sync --frozen --extra test` concluída em venv própria, sem alteração dos locks; suíte específica com 13 aprovados em 3,30 s e regressão completa final com 483 aprovados e um ignorado em 103,21 s; `git diff --check` aprovado. A validação usa o módulo temporário do contrato da entrega Sonnet (`39c1bac`), sem incluí-lo no commit backend. O runner emite aviso existente de depreciação Starlette/httpx; nenhuma dependência foi atualizada.

Revisão de retenção M3: `pytest backend/tests/test_script_retention.py backend/tests/test_scripts.py backend/tests/test_retention.py -q` concluiu com 30 aprovados; `pytest backend/tests/test_sqlite_hardening.py -q`, com 35 aprovados. A reprodução com título sentinela do Radar confirma redação dos dados fonte e preservação editorial por GET/histórico/replays; testa contagens sem conteúdo, bloqueio atômico de `request_changes`, aprovação/rejeição após redação e replay de decisão anterior. Todos os bancos são temporários e os fluxos simulados bloqueiam rede; nenhuma mudança de schema, contrato de documento ou política de 28 dias foi necessária.
