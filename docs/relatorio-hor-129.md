# Relatório HOR-129 — checklist pré-inferência

Data: 12/11/2026. Base: `main` `dfd5286`, branch `feat/hor-129-pre-inference-checklist`. Escopo: documentação e testes; nenhuma inferência, provedor, credencial, preço ou perfil foi configurado ou habilitado. **Não declara a pré-inferência aprovada.**

## Entregas

- `docs/checklist-pre-inferencia.md`: checklist executável com esperado, critérios de abortar, classificação IMPL/ENSAIO/CONFIG/AUSENTE, riscos e Issues existentes.
- `backend/tests/test_pre_inference.py`: dois testes para lacunas reais (padrão simulado e fail-closed sem perfil/preços; gate local aberto não implica isolamento de SO, auditoria nem modo privado).
- Link no `docs/seguranca-hermes.md`. `scripts/check_pre_inference.py` não foi criado: o endpoint `/v1/security/status` e os testes existentes já cumprem o papel.

## Achados

- Blockers existentes cobrem perfil, ferramentas, memória, extensões, bind, conexão, tetos de tokens/execuções, orçamento e preços ausentes.
- O gate local não cobre isolamento de SO (`network_isolation.enforced: false`), corte financeiro remoto, auditoria (`audit.available: false`) nem modo privado: `real_execution_allowed` pode ser `true` com isso em aberto.
- Preços do operador ausentes (`pricing_missing`); perfil `horus` ausente neste PC, portanto o endurecimento relatado não foi reverificado.
- Issues vinculadas: HOR-109 a HOR-118, HOR-124, HOR-026, HOR-031 (todas abertas; nenhuma alterada).

## Validação executada (venv própria, offline, sem gateway/CLI Hermes)

- `uv sync --project backend --frozen --extra test`: ok.
- `pytest backend/tests`: 470 aprovados, 1 ignorado (symlink).
- `pytest contracts/hermes/tests`: primeira execução 53 aprovados e 1 falha (`test_fake_hermes_api.py::test_authentication_is_required`); duas repetições seguintes passaram (54 e o teste isolado). Falha intermitente não explicada; não investigada além disso.
- Não executados: frontend, dotnet, rede, backend na porta 8773.

## Pendente

Decisões operacionais do idealizador (itens C1–C10), preços/limites no provedor e autorização da primeira chamada.
