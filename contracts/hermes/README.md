# Contrato Hórus ↔ Hermes — proposta com testes simulados

**Estado: contrato proposto.** Nada nesta pasta foi executado contra o Hermes real, e o backend do Hórus não usa este código. Os testes comprovam somente o lado do Hórus: schemas, validação de evidências e decisões diante das respostas do servidor simulado.

Não há gateway, inferência, rede externa, credenciais ou configuração do perfil `horus` envolvidos. Não foram adicionadas dependências: usa Python, Pydantic e pytest do `backend/.venv`.

## Executar

Na raiz do Hórus:

```powershell
& backend/.venv/Scripts/python.exe -m pytest contracts/hermes/tests -q -p no:cacheprovider
& backend/.venv/Scripts/python.exe contracts/hermes/generate_schemas.py   # após alterar models.py
```

## Conteúdo

| Caminho | Função |
|---|---|
| `horus_hermes_contract/models.py` | Pedido (`RunEnvelope`, `HermesRunRequest`) e resultado (`EditorialResult`), versão `1.0` |
| `schemas/*.v1.json` | JSON Schemas gerados dos modelos; um teste impede divergência |
| `horus_hermes_contract/validator.py` | Conversão da resposta em JSON e validação de evidências, executada pelo Hórus |
| `horus_hermes_contract/mapping.py` | Estados do Hermes → ações e resultado da tentativa; chaves de idempotência; regras de retry |
| `fake_server.py` | Hermes simulado, somente biblioteca padrão e `127.0.0.1` |
| `fixtures/` | Envelope e resultados **fictícios** (URLs `example.org`) |
| `tests/` | Schemas, validador e fluxo HTTP simulado |

## O que foi conferido no código instalado do Hermes 0.23.1

Leitura de `gateway/platforms/api_server_runs.py`, `api_server_run_idempotency.py`, `api_server.py` e `hermes_cli/tools_config.py`, sem executar o gateway:

- `POST /v1/runs` → 202 `{"run_id", "status", "replayed"}`, cabeçalho `Idempotency-Replayed`; chave inválida → 400 `invalid_idempotency_key`; mesma chave com outro corpo → 409 `idempotency_key_conflict`; limite de concorrência → 429.
- Corpo aceita `input`, `instructions`, `session_id`, `previous_response_id`, `conversation_history`, `model`, `provider`, `model_options`, `metadata`. Não há campo para toolsets, skills ou formato de resposta.
- Estados `queued`, `running`, `waiting_for_approval`, `stopping`, `completed`, `failed`, `cancelled`, `interrupted`; `failed` cobre o limite de iterações com `turn_exit_reason`.
- `usage` no fim: `input_tokens`, `output_tokens`, `total_tokens`, `cache_read_tokens`, `cache_write_tokens`. Não há teto de custo em dólares.
- Eventos SSE com `id:` e `data: {"event": ...}`; `POST /stop` passa por `stopping`; parar execução sem agente ativo → 409 `run_not_active`.
- Erros no envelope `{"error": {"message", "type", "param", "code"}}`.

## O que é proposta ou simplificação

- **Todo o resultado editorial** (`EditorialResult`) e as regras do validador são proposta do Hórus. O Hermes não garante JSON: o texto final precisa ser convertido e validado aqui.
- **Mapeamento e decisões** (`mapping.py`): incluindo o estado `unknown`, que não existe no núcleo de workflows atual.
- **Servidor simulado:** resolve a execução na admissão; devolve o histórico de eventos e fecha (o real mantém a conexão com keepalive).
- **Reinício:** `restart()` modela uma hipótese — execuções sem chave somem (404) e as com chave preservam o último status sem progredir. O comportamento real em reinício não foi testado.
- **Heurística de números:** valores com 4 ou mais dígitos nos textos precisam existir no snapshot; anos entre 1900 e 2100 são ignorados. Pode gerar falso positivo em números legítimos não métricos.

## Regras de validação

| Código | Regra |
|---|---|
| `schema` | Estrutura e versão `1.0`, sem campos extras |
| `task_mismatch` | `task_id` igual ao do pedido |
| `duplicate_id` | Identificadores únicos entre fontes, fatos, hipóteses e oportunidades |
| `unknown_dataset_source`, `source_url_mismatch` | Fonte `dataset` existe no snapshot com a mesma URL |
| `unknown_reference` | Fatos citam fontes; hipóteses citam fatos; oportunidades citam fatos/hipóteses; recomendação cita fontes; memória cita fatos |
| `metric_without_dataset_source`, `metric_unavailable`, `metric_mismatch` | Métrica citada existe no snapshot, para aquela fonte, com o mesmo valor |
| `forbidden_metric` | Retenção, receita, RPM, CPM, CTR, monetização e tempo de exibição não podem aparecer como dado; permitidos em `unknowns` |
| `unverified_number` | Números grandes no texto precisam corresponder ao snapshot |

## Incompatibilidades com o núcleo de workflows (`067aba0`)

Registradas para decisão; nenhuma foi alterada aqui.

1. Cada etapa valida `SimulatedOutput` (`simulated: True`, `title`, `text`, até uma fonte); `EditorialResult` exige outro modelo de saída por executor.
2. `WorkflowService.get()` sempre devolve `simulated: True`.
3. Timeout fixo de 5 s por etapa; uma execução Hermes leva minutos.
4. `job_attempts.executor` fixo em `simulated-v1`, sem colunas para `run_id`, chave de idempotência ou `usage`.
5. No reinício, tentativas em execução viram `interrupted` sem conciliação; o contrato propõe `unknown` e conciliação pela chave antes de qualquer retry.
6. Cancelar encerra apenas a task local e marca `cancelled`; com Hermes é preciso `POST /stop` e aguardar o estado final.
7. `request_changes` coloca nova revisão na fila automaticamente; execuções pagas exigem autorização.
8. O pedido do workflow aceita objetivo e até cinco referências em texto; o envelope exige dataset com métricas, perfil do canal e mercado.
9. Quatro etapas com executor cada; a proposta usa uma única execução Hermes (em `analysis`), com as demais etapas determinísticas.
