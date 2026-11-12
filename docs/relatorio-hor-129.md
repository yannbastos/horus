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
- `pytest contracts/hermes/tests`: primeira execução 53 aprovados e 1 falha (`test_fake_hermes_api.py::test_authentication_is_required`); duas repetições seguintes passaram (54 e o teste isolado). Investigada na seção seguinte.
- Não executados: frontend, dotnet, rede, backend na porta 8773.

## Pendente

Decisões operacionais do idealizador (itens C1–C10), preços/limites no provedor e autorização da primeira chamada.

## Investigação da falha intermitente (contrato Hermes)

- Traceback original da primeira execução não foi preservado (só o resumo final). Reproduzi isolando o teste, 60 execuções consecutivas, log exclusivo: **1 falha em 60** (execução 28) e 59 aprovações.
- Erro capturado: `ConnectionAbortedError: [WinError 10053]` em `socket.py` `readinto`, durante a leitura da resposta do `urllib` em `Http.call` (`contracts/hermes/conftest.py`).
- Evidência de código: `contracts/hermes/fake_server.py::do_POST` responde 401 em `_authorized()` **antes** de ler o corpo (`rfile.read(Content-Length)`). O cliente envia um POST com corpo; no Windows, o servidor que responde e fecha sem consumir o corpo pode abortar a conexão antes de o cliente ler o 401.
- **Hipótese consistente com o erro, não provada por teste de controle:** corrida entre fechamento da conexão pelo servidor simulado e a leitura do cliente. Não há indício de proxy (o cliente usa `urlopen` padrão e 127.0.0.1; não verifiquei variáveis de proxy do ambiente), timeout (5 s, sem erro de tempo) nem de relação com os arquivos deste incremento.
- Limitação: um único evento reproduzido; a correção não foi testada. O defeito está no servidor/cliente de teste, não no backend de produção. Correção possível, **a decidir pelo Maestro** (não aplicada, contrato intocado): consumir o corpo antes do 401 em `do_POST` ou o cliente tolerar `ConnectionAbortedError` com uma repetição.

## Revisão documental (segundo commit)

Abertura do checklist esclarece que A/B são offline/loopback sem escrita e C só enumera evidências futuras fora da autorização atual; o exemplo B valida `HORUS_BACKEND_PORT` e `HORUS_API_TOKEN`, aborta se ausentes/inválidos, sem gerar token, presumir porta ou imprimi-los. Não foram executados backend nem endpoint.

## Correção do simulador (terceiro commit)

Escopo ampliado pelo Maestro somente para `contracts/hermes/fake_server.py` e um teste de regressão. Sem retries no cliente; backend, autenticação e Hermes real intocados.

- **Mudança:** `do_POST` lê o corpo (Content-Length inválido ou negativo conta como 0; sem novo timeout, o `urlopen` existente tem 5 s) **antes** de autenticar. Continua sem parse, admissão ou execução antes do 401; status 401 e `invalid_api_key` preservados.
- **Controle:** o novo `test_invalid_token_consumes_body_before_401_without_admission` (corpos JSON, malformado e 4 MiB, 5 conexões cada, `http.client` direto) **falhou antes da correção** com `ConnectionAbortedError [WinError 10053]` (mesmo erro da falha original) e passa depois. Isso demonstra que o corpo não lido no caminho 401 produz o aborto; não prova que foi a única causa da falha intermitente original, que usava corpo pequeno.
- Asserção adicional: zero runs, zero requisições registradas e nenhuma chave de idempotência para token inválido, inclusive com JSON malformado.
- **Validação:** `contracts/hermes/tests` completo: 57 aprovados. Amostra limitada: 30 execuções dos testes de autenticação/regressão, 0 falhas (log exclusivo, fora do repositório). Repetições não constituem prova absoluta.
- **Limitações:** o corpo é lido por inteiro conforme Content-Length, sem limite (simulador só para loopback de testes); corpo menor que o declarado bloqueia até o timeout do cliente.
