# Estado e prioridades do Hórus

Fonte canônica do estado consolidado e da ordem de evolução, sem datas prometidas. A [visão](VISION.md) descreve objetivos; a [arquitetura](ARCHITECTURE.md) aponta as evidências de código.

Revisão documental em 2026-11-11. Os ensaios abaixo são registros anteriores, não testes executados nesta reorganização. Este roadmap não concede autorização para implementar, gastar, publicar, instalar, fazer commit ou push.

## Como interpretar os estados

- **Implementado:** existe código para a capacidade delimitada; não significa validação completa.
- **Parcialmente validado:** há ensaios documentados em cenários específicos; persistem limites explícitos.
- **Planejado:** requisito/direção, sem fluxo operacional completo confirmado no código.

Uma capacidade pode estar implementada e parcialmente validada. Builds e testes simulados não comprovam integração real, qualidade editorial ou prontidão para publicação.

## Estado consolidado

| Capacidade | Estado e limite |
|---|---|
| Desktop C#/Avalonia e temas | Implementados; preservados como ferramenta e referência funcional |
| Download e transcrição Avalonia | Implementados com ferramentas externas; fila/revisão/salvamento existentes, sem persistência da fila de interface |
| React/TypeScript + Tauri 2 | Implementados; build Windows e geração NSIS registrados; instalação NSIS ainda pendente |
| FastAPI/SQLite | Implementados: tarefas persistentes, eventos/logs, executor sequencial, cancelamento e recuperação de estados |
| Núcleo editorial simulado | Implementado e validado por testes do backend: quatro etapas no JobManager existente, schema v2, tentativas, artefatos, aprovação por revisão e recuperação; sem UI editorial ou serviços externos |
| Consulta de perfil da fábrica | Implementada; validação anterior com CLI real e persistência registrada |
| Render de rascunho short | Implementado; parcialmente validado via API em TestClient com processos reais; não certifica execução pela tela Produção ou pelo backend empacotado |
| Cancelamento/encerramento durante render | Parcialmente validados: árvore encerrada e estado recuperado; encerramento normal do backend não simula falha abrupta do Windows |
| Biblioteca de mídia/player | Implementados; seleção e reprodução de MP4 no Tauri registradas; pasta, busca temporal manual e outros cenários ainda pendentes |
| Transcrição React/Python | Implementada; testes simulados e transcrição curta tiny/CPU registrados; equivalência completa com Avalonia pendente |
| Diagnóstico Hermes | Implementado; integração autenticada anteriormente registrada; conectividade depende da configuração da sessão |
| Planejamento/delegação multiagente | Planejados; diagnóstico de capacidades não comprova orquestração |
| Memória ativa e histórico editorial consolidado | Planejados; tarefas/eventos técnicos persistentes não equivalem ao módulo completo |
| Biblioteca inteligente de técnicas | Planejada; distinta da Biblioteca de mídia atual e dos componentes Remotion existentes |
| Radar, análise editorial real e analytics | Planejados como fluxos integrados; aprovação por revisão já existe no núcleo simulado, sem autorizar produção |
| Fábrica e catálogo visual | Repositórios independentes; prontidão da fábrica requer inspeção própria, Storybook usa exemplos fictícios |
| Publicação automática e múltiplos canais | Evolução futura; publicação inicial manual |
| Linux/Arch Linux | Compatibilidade futura; não validada |

Evidências e procedimentos: [migração](migracao-local.md), [relatório local](validacao-local-2026-11-10.md) e [integração Hermes](integracao-hermes.md). Não somar contagens de testes de incrementos diferentes nem aplicá-las automaticamente ao código posterior da fábrica.

## Prioridade 1 — concluir a aceitação da base local

Preservar identidade visual, transcrição Avalonia, perfis, mídias e fábrica independente. Reutilizar evidências anteriores antes de repetir ensaios.

Pendências registradas: instalação NSIS; seleção de pasta, salvamento e arrastar arquivos nativos; busca temporal manual no player; recuperação após falha abrupta durante render; YouTube real; transcrição longa, vídeo, GPU e modelos maiores; comparação visual completa entre implementações. Validar render/cancelamento pela interface e backend empacotado antes de estender os resultados obtidos via TestClient.

As metas de RAM e inicialização continuam sem comprovação integral. O relatório distingue RSS de compromisso privado e janela visível de interface utilizável. Critérios e metas pertencem à [arquitetura](ARCHITECTURE.md#desempenho-e-ciclo-de-vida).

Aceite: evidências delimitadas de instalação, ciclo de vida, recuperação, equivalência funcional/visual e desempenho, sem inferir prontidão editorial a partir do build.

## Prioridade 2 — primeiro workflow orquestrado

Validar **Pedido → Planejamento → Pesquisa → Análise → Proposta editorial → Aprovação humana**, conforme [AI-SYSTEM.md](AI-SYSTEM.md#workflow-mínimo-e-evolução--planejado).

Primeiro incremento backend concluído em modo simulado: [contratos, limites e resultados](workflows-editoriais.md). A suíte do backend passou em 89 testes em bancos temporários, incluindo migração, encerramento abrupto, idempotência e decisões obsoletas. Banco operacional, UI editorial e chamadas de IA/YouTube não foram exercitados neste incremento.

Antes de ampliar produção automatizada, confirmar capacidades reais de delegação do Hermes instalado e contratos com o backend; definir modelo/provedor, orçamento e aprovação aplicável à análise delimitada. O diagnóstico autenticado já existente não precisa ser reimplementado.

Aceite: fontes e hipóteses identificadas, artefatos rastreáveis, responsáveis/estados claros, aprovação humana por revisão e tratamento de falhas sem execução/gasto duplicado. Nenhuma infraestrutura VPS é necessária nesta etapa.

## Evolução após os marcos iniciais

Os temas abaixo preservam o planejamento existente; sua numeração antiga não deve sobrepor as prioridades acima.

| Frente | Entrega e critério para avançar |
|---|---|
| Diagnóstico e consolidação | Confirmar ambiente, contratos e situação atual da fábrica; não transportar bloqueios de auditoria antiga como fatos atuais |
| Radar mínimo | Descoberta/validação de candidatos com fonte/data, paginação, ausências, permissões e cotas verificadas; indicadores somente quando permitidos |
| Integração Hermes | Ferramentas/skills externas e resultados/erros rastreáveis; sem fork e sem efeitos implícitos |
| Análise e planejamento | Briefings e roteiros originais, observação separada de hipótese, aprovação por revisão |
| Produção gerenciada | Custos, aprovações, retomada e integridade; uma produção recuperável sem repetir cobrança/render por perda de contato |
| Interface integrada | Conectar telas aos contratos validados, com mesmas regras pela interface e CLI, sem duplicar o motor |
| Biblioteca de técnicas | Integrar progressivamente análise, catálogo e modelos reutilizáveis segundo [MOTION-LIBRARY.md](MOTION-LIBRARY.md) |
| Analytics e histórico operacional | Resultados próprios autorizados, custos por tentativa, experimentos, dados ausentes/revogação tratados e memória revisável |
| Expansão gradual | Longos, cortes, mais canais e automações após validar Canal 01, qualidade, capacidade e orçamento; publicação automática exige aprovação separada |

A fila persistente e a revisão editorial simulada não concluem produção gerenciada: execução cognitiva real, aprovações de produção, custos e reconciliação de operações pagas ainda precisam de validação/implementação.

## Caminho para o primeiro vídeo real

1. Completar identidade editorial e perfil do Canal 01.
2. Reavaliar e resolver as lacunas atuais de licenciamento, aprovação e pacote na fábrica; o diagnóstico antigo não certifica o código posterior.
3. Aprovar pauta e roteiro, executar voz/alinhamento e selecionar recursos com licenças verificadas.
4. Renderizar, conferir checklist e realizar revisão humana.
5. Preparar os arquivos completos e publicar manualmente.
6. Validar de cinco a dez Shorts por tempo, custo e qualidade; views isoladas não comprovam o pipeline.

O primeiro vídeo não depende de dashboard completo ou descoberta automatizada. Antes do segundo canal, validar explicitamente vídeo longo e cortes: composição 16:9, narração em blocos quando necessária, legendas, ganchos, sincronismo, tempo e custo. Não declarar essa capacidade disponível com base no planejamento.

## Pendências transversais e decisões abertas

- Licença geral, distribuição e processo de contribuição.
- Compatibilidade Linux e posterior validação Arch Linux.
- Configuração/disponibilidade real do DAS e estratégia de backup/restauração.
- Modelo/provedor, orçamento, delegação e contratos para execução cognitiva real.
- Identidade editorial completa do Canal 01 e prontidão atual da fábrica.
- Proteção de segredos, revisão de aprovações e integridade de artefatos.
- Substituição definitiva do Avalonia somente após equivalência aceita.

A stack e a direção local já estão definidas; não tratá-las como escolha ainda aberta por causa de planos anteriores.

## Consulta aprofundada

O [índice de planejamento](planejamento/README.md) classifica propostas, diagnósticos e históricos. [PLANO.md](planejamento/PLANO.md) e [VALIDACAO.md](planejamento/VALIDACAO.md) preservam dependências, cenários e critérios detalhados, não uma ordem executável automaticamente.

O [roadmap anterior](historico/reorganizacao-2026-11-11/ROADMAP-ANTES.md.txt) foi preservado integralmente. Autorizações pontuais nele ou em cartas antigas não são permissões permanentes.
