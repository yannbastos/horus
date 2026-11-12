# Gestão técnica no GitHub

## Situação da adoção

Procedimento vigente em 2026-11-12. [Project privado](https://github.com/users/yannbastos/projects/1), vinculado a [yannbastos/horus-management](https://github.com/yannbastos/horus-management). O código permanece no repositório público yannbastos/horus, sem alteração de visibilidade ou proteções. O registro auditável da migração fica no repositório privado de gestão, em [`migracao-github/`](https://github.com/yannbastos/horus-management/tree/main/migracao-github); não publicar esses artefatos neste repositório público.

Issues e GitHub Projects são a fonte operacional de estado, prioridade, responsável e dependências. O [ROADMAP](ROADMAP.md) permanece como síntese contextual; não deve manter uma segunda fila operacional. Drive permanece para documentação, referências visuais, identidade e planejamento não técnico, incluindo HOR-083 a HOR-086. A planilha de origem é histórico preservado; não atualizar ali o estado técnico depois do corte registrado no relatório.

## Criar e refinar uma Issue

Antes de criar, consultar Issues abertas e fechadas e todos os itens do Project, com paginação completa. Procurar o identificador tanto no título quanto no corpo e no campo ID original. Se houver correspondência, reutilizar; se houver duas, registrar conflito antes de escrever.

Título: `[HOR-XXX] Descrição objetiva`. Preservar HOR-001 a HOR-130. Para tarefas novas, consultar o maior ID reservado nas Issues, Draft Issues e mapa; reservar o seguinte sob coordenação do Maestro para evitar colisões. Não reutilizar IDs removidos.

Corpo obrigatório:

- **Contexto:** motivação documentada.
- **Objetivo:** resultado esperado na fonte.
- **Escopo:** limites conhecidos.
- **Critérios de aceite:** checklist verificável, sem marcar ensaios não realizados.
- **Dependências:** links comprovados e dependências textuais ainda não resolvidas.
- **Evidências e referências:** links, commits e relatórios, com limites e origem.
- **Origem:** ID, aba, linha e link da planilha; estado, prioridade, marco e responsáveis originais durante a importação.

Quando faltar informação, registrar “Precisa de refinamento; não informado na fonte”. Critério genérico da planilha deve ser preservado e marcado para detalhamento antes de mover para Pronto. Não inventar evidências nem concluir trabalho com base apenas no título.

## Planejamento no Project

Nome: **HÓRUS — Desenvolvimento e Roadmap**. Descrição: “Planejamento, desenvolvimento, segurança, testes e evolução do aplicativo Hórus.” Repositório de gestão e Project privados. O repositório de código continua público.

Campos propostos:

| Campo | Valores |
|---|---|
| Status | Backlog, Pronto, Em andamento, Em revisão, Bloqueado, Concluído |
| Prioridade | P0 — Crítica, P1 — Alta, P2 — Média, P3 — Baixa |
| Marco | M1, M2, M3, M4, M5, M6, Futuro; preservar Fundação para o histórico |
| Módulo | Preservar as 26 classificações da fonte até revisão de equivalência |
| Agente | Codex, Claude Sonnet, Antigravity, Maestro, Humano, Não atribuído |
| ID original | Texto HOR-XXX |

Claude pode ser normalizado para Claude Sonnet no planejamento, preservando o nome de origem no corpo. Responsabilidade conjunta não cabe em um único valor: preservar todos no corpo e usar Não atribuído até definir coordenador. Agente é informativo; assignee nativo somente para usuário real confirmado.

Prioridades P0/P1/P2/P3 mantêm a ordem da fonte; P0 requer revisão humana para rebaixamento. Marco Pesquisa futura pode mapear para Futuro, mantendo o original. Fundação não equivale a M1.

Estados de origem: Concluído → Concluído e Issue fechada com histórico; Referência → Draft em Backlog; Não iniciado, Verificar e Parcial → Backlog até revisão. Parcial não prova execução ativa. Não marcar Pronto sem aceite refinado e dependências resolvidas; não inferir bloqueio apenas porque a tarefa depende de outra.

## Execução pelo Maestro e agentes no Orca

1. Consultar Issues abertas, P0, estado atual e dependências no Project.
2. Selecionar Issue Pronta e independente; verificar trabalho já em andamento.
3. Registrar Agente e escopo na Issue. Atualizar Em andamento ao iniciar.
4. Criar worktree pelo CLI Orca e branch como `feat/hor-123-descricao` ou `fix/hor-123-descricao`, conforme a tarefa. Registrar URL da Issue como referência no Orca usando os comandos suportados pela versão local.
5. Entregar ao agente a Issue, restrições, dependências, aceite e instruções AGENTS.md/CLAUDE.md.
6. Reportar na Issue resultado, branch/PR, arquivos relevantes, testes executados, evidências e limitações. Atualizar comentário de andamento do worktree.
7. Preparar PR no repositório de código com ID no título e referência segura. As Issues estão em outro repositório: `#NUMERO` isolado aponta ao destino errado. No conteúdo privado de gestão, registrar o link do PR público. No PR público, usar somente o ID HOR-XXX e informações técnicas já públicas; não copiar corpo privado, notas de segurança ou evidências confidenciais. Referências cruzadas completas a `yannbastos/horus-management#NUMERO` só quando a própria referência puder ser divulgada. Preferir fechamento manual após validação, sem automação entre os repositórios.
8. Em revisão quando houver entrega verificável; Maestro revisa e usuário autoriza merges quando exigido. Commit, push e merge seguem a autorização específica do repositório.
9. Concluir somente depois da integração validada, critérios cumpridos e evidências registradas. Sincronizar Issue fechada e Status Concluído.

Um bloqueio exige motivo, dependência/link quando existir, ação necessária e responsável pela resolução. Marcar Bloqueado e registrar o último estado útil. Retomar após evidência da resolução. Nenhum agente precisa de conta própria no GitHub.

## Visualizações e automações

Visualizações criadas via API GraphQL oficialmente suportada:

- Board — Execução: layout Board, agrupar por Status.
- Table — Backlog completo: layout Table, mostrar ID original, prioridade, módulo, marco, Agente e Assignees.
- Roadmap — Marcos: layout Roadmap; configurar campos de datas quando houver datas aprovadas. Marco sozinho não fornece um cronograma; até lá usar tabela agrupada por Marco sem inventar datas.
- Prioridades P0: filtrar pelo valor exato P0 — Crítica do campo Prioridade.
- Por agente: tabela agrupada por Agente; filtrar Codex, Claude Sonnet e Antigravity quando desejado.

O gh 2.103.3 instalado não apresenta subcomandos de criação de views ou workflows. A API oficial oferece createProjectV2View/updateProjectV2View e foi utilizada para layouts, colunas visíveis e filtro P0. A configuração pública de views não expõe agrupamento ou campos de data do Roadmap: ajustar Board por Status, tabela Por agente por Agente e Roadmap por Marco/datas na interface. Não inventar prazos; sem datas aprovadas, usar Marco como classificação e a tabela para planejamento.

O Project veio com a automação nativa de adicionar sub-issues habilitada. Ela foi preservada. Auto-close, item adicionado, item fechado, PR vinculado e PR merged permaneceram desabilitados na conferência da migração. Nenhuma automação de fechamento, prioridade ou merge foi ativada. A API pública consultada não oferece mutation para configurar esses workflows. Para tarefas novas, adicionar a Issue ao Project pelo gh ou interface; avaliar auto-add apenas se necessário.

## Segurança

Inspecionar conteúdo antes de envio. Não transportar credenciais, dados pessoais desnecessários, configurações de produção, caminhos privados ou detalhes exploráveis de falhas abertas. Sanitizar mantendo o objetivo e registrar a omissão; se insuficiente, reter o item para revisão. Repositório privado não dispensa essa inspeção. Não copiar relatórios privados integralmente por conveniência.
