# Governança dos agentes — autonomia e desenvolvimento contínuo

Política vigente desde 13/11/2026, definida pelo usuário (idealizador e responsável pelo produto). Ela substitui as exigências anteriores de aprovação individual para commits, merges e pushes normais. Regras de segurança, privacidade e gastos mais restritivas, em [AGENTS.md](../AGENTS.md) ou em outros documentos, continuam valendo.

## Papéis

| Agente | Função | Preferências |
|---|---|---|
| Claude Opus — Maestro | Arquitetura, planejamento, delegação pelo Orca, worktrees, revisão, integração, conflitos, GitHub Projects | Evita implementar quando há agente disponível |
| Codex — programador | Python/FastAPI, fábrica, jobs e workflows, persistência, falhas, testes de integração | |
| Claude Sonnet — programador | Contratos, validadores, qualidade audiovisual, segurança, testes, refatorações delimitadas | |
| Antigravity — programador | React/TypeScript, interface, prévia e revisão audiovisual, acessibilidade, Playwright | |

As preferências não são limites rígidos. O Maestro redistribui por dependência, disponibilidade e limite de uso, não deixa agente ocioso quando há tarefa independente autorizada e não inicia tarefas simultâneas nos mesmos arquivos sem coordenação explícita (cada tarefa declara os arquivos de que é dona).

## Ações autorizadas sem aprovação individual

- Criar e administrar branches e worktrees; selecionar e delegar Issues.
- Modificar código e documentação; implementar funcionalidades aprovadas no roadmap; corrigir bugs e regressões.
- Instalar dependências gratuitas necessárias, de fontes confiáveis, preferindo lockfiles e ambientes isolados; sem alterar configurações globais de segurança.
- Executar testes e builds.
- Criar commits e Pull Requests; fazer merges normais na `main` e pushes normais para `yannbastos/horus` e `yannbastos/horus-management`.
- Atualizar Issues e o GitHub Projects.
- Atualizar contratos internos quando necessário, preservando compatibilidade.
- Avançar para a próxima tarefa elegível após concluir uma entrega.

## Ações que continuam exigindo autorização do usuário

- Configurar, usar ou contratar APIs ou serviços pagos; aumentar limites financeiros.
- Habilitar inferência real do Hermes ou alterar permissões sensíveis do perfil operacional Hermes.
- Transmitir informações privadas a serviços externos; publicar vídeos ou fazer uploads externos.
- Excluir dados operacionais ou backups; migrações destrutivas em bancos operacionais.
- Alterar visibilidade de repositórios ou permissões administrativas do GitHub.
- Git destrutivo: `push --force`, `reset --hard`, `clean -fd`, reescrita de histórico, exclusão de worktree com alterações não preservadas.
- Desativar controles de segurança; manipular credenciais reais além de procedimentos locais já autorizados.

Quando algo exigir autorização, o trabalho independente continua.

## Incrementos

Cada incremento tem objetivo específico, escopo limitado, critérios de aceite, responsável, testes, dependências e evidências. Incrementos independentes são integrados assim que validados; quem depende de contrato ainda não integrado espera por ele.

## Testes proporcionais ao risco

- Durante a implementação: testes unitários e de contrato dos módulos afetados, typecheck/lint e regressões relacionadas.
- Antes de integrar: testes dos módulos afetados, integração relevante, build quando houver frontend ou empacotamento, regressão das funcionalidades impactadas.
- Mudanças críticas (segurança, autenticação, persistência, migrações, integração estrutural): todas as suítes relevantes, integridade de dados, testes negativos.
- Periodicamente, e antes de release: validação completa da `main`.
- Nunca reduzir cobertura, remover testes, ignorar falhas ou mudar critérios de aceite para obter resultado positivo.

## Fluxo Git

Branches `feat/HOR-XXX-descricao` ou `fix/HOR-XXX-descricao` (o Orca pode prefixar `yannbastos/`), em worktrees isolados.

1. Selecionar a Issue e confirmar dependências.
2. Criar branch/worktree e delegar.
3. Testes focados; revisão de diff e segurança pelo Maestro.
4. Merge normal na `main` após validação; testes necessários na `main`.
5. Push normal; atualizar Issue e Project; selecionar a próxima tarefa.

A `main` permanece funcional: não integrar código com falha crítica conhecida, não ignorar mudanças inesperadas de outros agentes e não commitar credenciais, dados pessoais, arquivos operacionais ou configurações sensíveis. Em conflito crítico, resolver só o que for seguro ou manter a entrega em revisão.

## GitHub Projects

Fonte oficial de estado: [Project](https://github.com/users/yannbastos/projects/1) e [Issues de gestão](https://github.com/yannbastos/horus-management/issues), conforme o [procedimento](GESTAO-GITHUB.md).

- Ao iniciar: comentário na Issue e Status Em andamento.
- Ao entregar: commits, testes e evidências; Em revisão quando necessário.
- Ao concluir: confirmar critérios de aceite, Status Concluído e fechar a Issue só com todos os critérios atendidos. Recurso parcial mantém a Issue aberta.
- Ao bloquear: motivo, Status Bloqueado e a autorização ou dependência exata.
- Verificar por leitura que a gravação no Project foi aplicada. Não criar Issues duplicadas.

## Prioridade por valor

1. Narração natural e inteligível.
2. Assets com licenciamento verificável.
3. Legendas sincronizadas com a fala.
4. Controle automático de qualidade.
5. Revisão humana do resultado.
6. Produção audiovisual completa e reproduzível.
7. Integração com Hermes, quando autorizada.
8. Confiabilidade e recuperação dos workflows.

Cerca de 70% do esforço no caminho crítico até o primeiro vídeo piloto completo e 30% em segurança, testes e infraestrutura, ajustando por risco real. Evitar refatorações amplas e documentação sem necessidade concreta.

## Segurança e privacidade

Privacy First, Local First, Least Privilege, Deny by Default. Nenhuma inferência real do Hermes, provedor pago, memória externa, conector que transmita dados privados, publicação automática, ferramenta perigosa no Hermes ou permissão irrestrita sem autorização. Manter os controles de orçamento, tokens e execução existentes. Memória local não é isolamento de SO. Não implementar criptografia própria. Barreiras de segurança devem ser técnicas, não só instruções em prompt.

## Uso dos modelos

Opus para coordenação, arquitetura complexa e revisão crítica; Sonnet para implementação, testes e validações; Codex para backend e integrações; Antigravity para frontend e testes visuais. Modelos rápidos para tarefas simples. Não presumir que a assinatura de um produto cobre o uso por outra integração.

## Continuidade

Ao concluir um incremento: revisar, testar, integrar e fazer push quando os critérios forem atendidos, atualizar o Project e delegar a próxima tarefa independente enquanto houver capacidade e autorização. Agente bloqueado ou no limite de uso: registrar e redistribuir. Não prometer execução futura sem mecanismo ativo; registrar o ponto de retomada na Issue.

## Comunicação com o usuário

Relatórios curtos: Concluído, Validação, Em andamento, Bloqueios reais e Próximo incremento. Decisões sensíveis vêm com opções e recomendação.
