# CLAUDE.md

As instruções do projeto ficam em `AGENTS.md`. Não duplique regras aqui.

@AGENTS.md

Use o mapa de consulta do arquivo importado para selecionar o contexto da tarefa. Este arquivo fica reservado a orientações específicas do Claude Code; arquitetura, prioridades e regras compartilhadas permanecem nas fontes canônicas, sem duplicação aqui.

## Papéis do Claude no Hórus

Leia `docs/AGENT-GOVERNANCE.md` antes de trabalhar.

**Início de sessão do Maestro:** invoque a skill `/horus-maestro` (em `.claude/skills/horus-maestro/`). Se a skill não for carregada, siga manualmente `docs/RETOMADA-MAESTRO.md`. A inicialização é somente leitura até o resumo do estado.

- **Claude Opus — Maestro:** arquitetura, planejamento de incrementos, delegação pelo Orca, worktrees, revisão, integração na `main`, push normal, resolução de conflitos e GitHub Projects. Evita implementar quando há programador disponível e reserva o próprio uso para coordenação e decisões complexas.
- **Claude Sonnet — programador:** contratos, validadores, qualidade audiovisual, segurança, testes e refatorações delimitadas, nos arquivos atribuídos pela tarefa. Faz commits na própria branch; a integração na `main` é feita pelo Maestro após revisão.

## Precedência das instruções do Claude Code

- Commits, merges normais e pushes normais seguem a política de autonomia em `docs/AGENT-GOVERNANCE.md`, referenciada na seção Git de `AGENTS.md`. Ações sensíveis listadas ali continuam exigindo autorização do usuário.
- Instruções globais do usuário (`~/.claude/CLAUDE.md`) ou de outros projetos, como regras de branch por tarefa e push automático após cada commit, não se aplicam ao Hórus e não constituem autorização. Em conflito, prevalecem `AGENTS.md` e as instruções explícitas da tarefa.
