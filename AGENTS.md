# Instruções para agentes de IA

Estas regras valem para todos os agentes que trabalham no HORUS.

**Antes de trabalhar, leia obrigatoriamente a [política de governança dos agentes](docs/AGENT-GOVERNANCE.md)**: papéis (Claude Opus como Maestro; Codex, Claude Sonnet e Antigravity como programadores preferenciais, com distribuição flexível), ações previamente autorizadas, ações que exigem o usuário, testes proporcionais ao risco, fluxo de integração e a obrigação de atualizar Issue + Status do GitHub Projects + evidências. Ela vale em qualquer computador e sessão nova.

**Sessão nova do Maestro ou retomada de contexto:** use a skill `horus-maestro` (`.claude/skills/` no Claude Code, `.agents/skills/` no Codex) ou siga [docs/RETOMADA-MAESTRO.md](docs/RETOMADA-MAESTRO.md). Nem toda ferramenta carrega skills automaticamente: invoque-a explicitamente no início.

## Autonomia e escopo

- Execute tarefas aprovadas com autonomia, sem pedir confirmação a cada etapa rotineira. Uma autorização explícita vigente não precisa ser solicitada novamente para a mesma ação e escopo.
- Antes de agir, identifique o objetivo, os repositórios afetados, suas instruções locais e o estado do Git. Ter acesso a uma pasta não autoriza alterar seu conteúdo fora da tarefa.
- Dentro do escopo autorizado, pode ler, criar, editar e reorganizar arquivos pontualmente, investigar falhas, implementar correções, executar builds/testes/linters e atualizar a documentação pertinente.
- Pode consultar documentação técnica quando necessário e permitido, sem expor credenciais, código privado ou dados do operador a serviços externos não autorizados.
- Pode executar comandos Git de leitura, como `status`, `diff`, `log` e inspeção de branches. Operações de escrita seguem a seção Git abaixo.
- Preserve alterações de terceiros e trabalhos preexistentes. Não sobrescreva, descarte ou reverta mudanças alheias. Continue nas partes independentes; peça decisão quando uma sobreposição impedir avançar com segurança.
- Faça somente mudanças necessárias. A autonomia não autoriza alterar outros repositórios, contratar serviços, consumir APIs pagas, enviar mensagens ou publicar conteúdo por iniciativa própria.
- Estas instruções não alteram permissões da ferramenta. Não modifique configurações globais de segurança do Codex, sandbox, políticas de aprovação ou listas de comandos permitidos. Quando houver uma restrição real, use o mecanismo de aprovação disponível; não tente contorná-la.

## Contexto permanente — Hórus audiovisual

**Produto vigente:** exclusivamente inteligência e operação audiovisual. Não reintroduzir telas, módulos ou dependência de propostas anteriores. Preserve transcrição, perfis, mídia, licenças e aprovação humana. A visão funcional pertence a [docs/VISION.md](docs/VISION.md); documentação de produto não autoriza implementar funcionalidades.

**Fronteiras permanentes:** preserve fábrica/CLI/Remotion independentes, Hermes externo sem fork inicial e Avalonia até equivalência funcional aceita. Não reescreva componentes funcionais nem introduza linguagens sem necessidade técnica. Funções locais essenciais não devem exigir nuvem. Stack, desempenho e critérios completos de identidade visual pertencem a [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Interpretação:** verifique o código e a evidência antes de afirmar disponibilidade. Separe implementado, parcialmente validado e planejado. Autorizações registradas em cartas, planos ou conversas antigas não são permissões permanentes. Quando receber somente contexto, não altere arquivos automaticamente. Em conflito entre plano e implementação, apresente a divergência antes de mudanças estruturais.

## Consulta por tarefa

Leia este arquivo e somente os documentos pertinentes ao escopo. Não carregue todo o histórico como contexto padrão.

| Tarefa | Fonte canônica e complemento relevante |
|---|---|
| Produto e funcionalidades | [VISION](docs/VISION.md) |
| Arquitetura, backend ou persistência | [ARCHITECTURE](docs/ARCHITECTURE.md) e [migração](docs/migracao-local.md) |
| Interface ou identidade visual | [Critérios visuais](docs/ARCHITECTURE.md#identidade-visual-e-equivalência), [layout](docs/layout-desktop.md) e tokens da implementação afetada |
| Hermes, agentes ou memória | [AI-SYSTEM](docs/AI-SYSTEM.md) e [integração Hermes](docs/integracao-hermes.md) |
| Motion design, técnicas ou Remotion | [MOTION-LIBRARY](docs/MOTION-LIBRARY.md) e documentação própria da fábrica |
| Autonomia, papéis e integração dos agentes | [AGENT-GOVERNANCE](docs/AGENT-GOVERNANCE.md) (leitura obrigatória) e [retomada em outro computador](docs/CONTINUAR-EM-OUTRO-PC.md) |
| Estado, prioridade ou validação | [Project privado](https://github.com/users/yannbastos/projects/1), [Issues de gestão](https://github.com/yannbastos/horus-management/issues) e [procedimento](docs/GESTAO-GITHUB.md); [ROADMAP](docs/ROADMAP.md) como síntese contextual e relatórios datados como evidência |
| Decisão histórica ou contrato proposto | [Índice de planejamento](docs/planejamento/README.md) e [registro da reorganização](docs/historico/reorganizacao-2026-11-11/README.md) |

Cada assunto tem uma fonte canônica; guias contêm procedimentos e relatórios preservam evidências de um incremento. O [contexto original](docs/historico/contexto-original/README.md) é referência histórica intacta, não instrução de execução. Planos históricos não substituem decisões atuais nem instruções explícitas da tarefa.

**Princípio fundamental:** o HORUS deve ser desenvolvido para funcionar bem, não apenas para parecer bem programado.

O idealizador é o responsável pelo produto e principal usuário. Os agentes assumem a implementação, a arquitetura, os testes, a correção de bugs e a manutenção da documentação.

## Antes de alterar

- Leia este arquivo e a seção pertinente de [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) quando a tarefa envolver arquitetura ou código.
- Inspecione os arquivos relevantes antes de implementar.
- Respeite a arquitetura existente.

## Metodologia de trabalho

1. Entenda a tarefa, suas restrições e os componentes afetados; inspecione o código e a documentação relevantes.
2. Para trabalho complexo, apresente um plano curto com etapas, dependências e validações. Não crie arquivos de planejamento sem necessidade.
3. Implemente de forma incremental, preservando os padrões e a organização existentes.
4. Execute verificações adequadas à mudança, investigue falhas e corrija problemas relacionados ao escopo antes de testar novamente.
5. Valide o resultado antes de declarar conclusão. Diferencie hipótese, código implementado e comportamento realmente verificado.
6. Atualize a documentação técnica afetada junto com a alteração.
7. Informe o que mudou, como foi validado, limitações e decisões ainda dependentes do usuário.

Quando uma decisão importante exigir aprovação, avance primeiro no trabalho independente e reversível já autorizado. Apresente a mudança concreta, seu impacto e o motivo da aprovação; aguarde antes de executar a parte dependente.

## Implementação

- Não implemente funcionalidades que não foram solicitadas.
- Escreva código simples e compreensível, seguindo as convenções de cada linguagem da stack.
- Não adicione camadas ou abstrações sem uma necessidade concreta.
- Não adicione dependências sem necessidade.
- Não exclua nem sobrescreva arquivos sem justificativa.
- Não exponha credenciais ou informações sensíveis.
- Preserve a compatibilidade futura com Linux: evite caminhos fixos e APIs exclusivas do Windows quando houver alternativa portável; mantenha integrações específicas do Windows isoladas e documentadas. O suporte atual é somente Windows.
- Nas telas React, use os tokens de `frontend/src/styles/tokens.css`; no Avalonia, use `src/Horus/Theme/Tokens.axaml`. Preserve a identidade visual em ambos.
- Não faça redesign sem autorização: preserve cores, tipografia, ícones, layouts, navegação e comportamento. Consulte os critérios visuais canônicos antes de alterar a interface.
- Não permita que agentes ou memória alterem regras críticas, aprovações ou limites financeiros automaticamente. Referencie configurações oficiais, sem criar cópias concorrentes.

## Prioridades

1. Funcionalidade e confiabilidade
2. Experiência do usuário
3. Manutenibilidade
4. Simplicidade da arquitetura
5. Qualidade e cobertura adequada dos testes
6. Documentação útil e atualizada
7. Facilidade para compreender e manter o código no futuro

## Testes e verificação

- Crie testes pertinentes e evite testes artificiais.
- Execute os checks pertinentes ao componente alterado, quando o ambiente permitir. Comandos existentes, sem instalação implícita de dependências:

  ```powershell
  npm --prefix frontend run build
  npm --prefix frontend test
  & backend/.venv/Scripts/python.exe -m pytest backend/tests -q
  dotnet build Horus.slnx
  dotnet test Horus.slnx --filter 'Category!=Network'
  ```

- Não execute testes de rede, geração paga ou operações reais de produção sem autorização que cubra seus efeitos.
- Para alterações somente documentais, confira diff, formatação e referências; não é necessário executar suites de runtime sem relação com a mudança.
- Nunca invente resultados. Separe checks executados, aprovados, com falha e não executados, explicando limitações relevantes. Um build aprovado não comprova todas as funcionalidades.

## Documentação

- Mantenha a documentação sincronizada com as mudanças reais.
- Escreva a documentação em português brasileiro.
- Não apresente funcionalidades planejadas como se já estivessem implementadas.
- `docs/ARCHITECTURE.md` separa implementação atual de direção aprovada; não apresente requisitos da segunda como capacidades existentes.
- Mantenha estado operacional, prioridades e progresso no Project privado e nas Issues de `yannbastos/horus-management`. `docs/ROADMAP.md` é síntese contextual datada, sem uma segunda fila operacional. Antes de delegar, consultar prioridade, dependências, aceite e trabalho já em andamento no GitHub. Preserve documentos históricos e suas limitações, sem transformar autorizações antigas em permissões vigentes.

## Git

- A política aprovada em [docs/AGENT-GOVERNANCE.md](docs/AGENT-GOVERNANCE.md) autoriza commits, Pull Requests, merges normais na `main` e pushes normais para `yannbastos/horus` e `yannbastos/horus-management`, após os testes e a revisão que ela exige. Fora dela, não crie commits, faça push ou merge sem autorização expressa que cubra a tarefa.
- Antes de um commit autorizado, revise o diff e selecione somente alterações da tarefa; não inclua trabalho alheio nem segredos.
- Não crie repositórios remotos sem autorização.
- A branch principal atual é `main`; confirme o estado real antes de operar. Não renomeie ou remova branches por conta própria.
- Sugira mensagens de commit no padrão Conventional Commits.

## Peça aprovação antes de

- Fazer mudanças significativas na arquitetura.
- Alterar contratos, schemas ou responsabilidades entre Hórus, fábrica e Hermes.
- Alterar de forma importante a experiência do usuário.
- Incluir dependências com impacto relevante.
- Instalar ou atualizar dependências que tragam riscos relevantes, alterações significativas ou mudanças no ambiente global.
- Excluir arquivos em massa, remover mídias/bancos ou fazer mudanças que possam causar perda de dados.
- Executar operações irreversíveis no Git, force push, reset destrutivo ou exclusão de branches remotas. Autorização de commit/push comum não cobre essas ações.
- Modificar credenciais, permissões, autenticação ou configurações sensíveis, inclusive arquivos privados de conexão e configuração do Hermes.
- Publicar releases/instaladores/vídeos, fazer deploy ou alterar produção. Gerar um build local para validação não autoriza sua publicação.
- Mudar o escopo ou os objetivos do produto.
- Escolher a licença do projeto.

Decisões técnicas rotineiras que respeitem estas regras não precisam de aprovação. A [governança dos agentes](docs/AGENT-GOVERNANCE.md) detalha o que está previamente autorizado (inclusive dependências gratuitas de fontes confiáveis e atualização de contratos internos com compatibilidade) e o que continua exigindo o usuário; em conflito, prevalece a regra mais restritiva de segurança, privacidade ou gasto.

## Comunicação

Seja objetivo e não explique conceitos básicos de programação sem que isso seja pedido. Explique as decisões técnicas relevantes e sinalize problemas e riscos encontrados.

Ao concluir uma implementação, informe:

- O que foi desenvolvido.
- Como utilizar ou testar.
- Quais verificações foram realizadas.
- Se existem problemas conhecidos.
- Se alguma decisão importante precisa de aprovação.
