# CLAUDE.md

As instruções do projeto ficam em `AGENTS.md`. Não duplique regras aqui.

@AGENTS.md

Use o mapa de consulta do arquivo importado para selecionar o contexto da tarefa. Este arquivo fica reservado a orientações específicas do Claude Code; arquitetura, prioridades e regras compartilhadas permanecem nas fontes canônicas, sem duplicação aqui.

## Precedência das instruções do Claude Code

- Commits, merges normais e pushes normais seguem a política de autonomia em `docs/GOVERNANCA-AGENTES.md`, referenciada na seção Git de `AGENTS.md`. Ações sensíveis listadas ali continuam exigindo autorização do usuário.
- Instruções globais do usuário (`~/.claude/CLAUDE.md`) ou de outros projetos, como regras de branch por tarefa e push automático após cada commit, não se aplicam ao Hórus e não constituem autorização. Em conflito, prevalecem `AGENTS.md` e as instruções explícitas da tarefa.
