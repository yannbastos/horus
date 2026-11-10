# Roadmap do Hórus

Evolução incremental da plataforma audiovisual, sem datas prometidas. Consulte o [README](../README.md) para o estado disponível e a [visão](vision.md) para os objetivos.

**Próximo marco tecnológico:** revisar e aprovar a prova de conceito [React/Tauri/FastAPI/SQLite local](planejamento/STACK-LOCAL.md), preservando o design, o Avalonia e a fábrica durante a validação. Essa direção substitui a hipótese de VPS nesta etapa; não significa migração já implementada.

## Base existente

| Entrega | Estado |
|---|---|
| Desktop C#/Avalonia e temas | Implementados |
| Download YouTube e transcrição local | Implementados, com dependências externas |
| Fila, revisão e salvamento de transcrição | Implementados, sem persistência da fila entre sessões |
| Testes automatizados de comportamento e interface | Existentes |
| Fábrica Python e render de Short | Em repositório separado, parcialmente consolidados |
| Base de conhecimento e catálogo visual | Em repositórios separados |
| Primeira prévia do layout audiovisual desktop | Integrada à branch principal; permanece em Avalonia até validar a migração |

## Próximas fases

| Fase | Entrega esperada | Critério para avançar |
|---|---|---|
| 0. Diagnóstico e consolidação | Confirmar Hermes instalado, contratos, ambiente e bloqueios da fábrica | Relatório real, primeiro teste de leitura revisado e plano de correções |
| 1. Radar mínimo | Descoberta e validação de candidatos pelo CLI, dentro das permissões aplicáveis | Dados com fonte/data, tratamento de ausências e limites de cota; indicadores apenas quando permitidos |
| 2. Integração Hermes | Ferramentas/skills externas para consultar e coordenar operações autorizadas | Consulta de perfil real e erros rastreáveis, sem fork ou efeitos implícitos |
| 3. Análise e planejamento | Relatórios e briefings originais associados às fontes | Separação de observação/hipótese e aprovação por versão |
| 4. Produção gerenciada | Fila persistente, custos, retomada e aprovações | Uma produção recuperável, sem repetir cobrança ou render por perda de contato |
| 5. Interface integrada | Conectar telas aos contratos já validados | Mesmas regras e estados pelo CLI e pela interface, sem duplicar o motor |
| 6. Analytics e memória | Resultados próprios autorizados, experimentos e aprendizados revisados | Evidências, custos e mudanças de regras rastreáveis |
| 7. Expansão gradual | Longos, cortes, mais canais e automações adicionais | Canal 01 validado, capacidade e orçamento demonstrados |

O usuário autorizou adiantar o layout desktop como trabalho visual. Isso não implementa as fases operacionais nem dispensa o diagnóstico do ambiente.

## Caminho para o primeiro vídeo real

1. Completar a identidade editorial e o perfil do Canal 01.
2. Corrigir as lacunas de licenciamento, aprovação e pacote identificadas na fábrica.
3. Aprovar pauta e roteiro, executar voz/alinhamento, selecionar recursos verificados e renderizar.
4. Conferir o checklist e realizar revisão humana.
5. Preparar os arquivos completos e publicar manualmente.
6. Validar de cinco a dez Shorts pelo tempo, custo e qualidade da produção; views isoladas não comprovam o pipeline.

O primeiro vídeo não depende de dashboard completo ou descoberta automatizada. Vídeos longos e cortes precisam de validação explícita antes do segundo canal.

## Pendências transversais

- Definir e documentar licença geral, distribuição e processo de contribuição.
- Avaliar a stack final da interface antes de qualquer migração.
- Validar compatibilidade Windows e, posteriormente, Linux/Arch Linux.
- Definir infraestrutura, armazenamento e backup conforme necessidade demonstrada.
- Proteger segredos, aprovações, orçamento e integridade dos artefatos.

## Planejamento executável

Tarefas, dependências, esforço relativo, riscos e critérios detalhados estão em [planejamento/PLANO.md](planejamento/PLANO.md) e [planejamento/VALIDACAO.md](planejamento/VALIDACAO.md). A [auditoria preliminar](planejamento/DIAGNOSTICO.md) distingue o que foi encontrado no código do que precisa de investigação local.
