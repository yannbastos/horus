# Instruções para agentes de IA

Estas regras valem para todos os agentes que trabalham no HORUS.

## Autonomia e escopo

- Execute tarefas aprovadas com autonomia, sem pedir confirmação a cada etapa rotineira. Uma autorização explícita vigente não precisa ser solicitada novamente para a mesma ação e escopo.
- Antes de agir, identifique o objetivo, os repositórios afetados, suas instruções locais e o estado do Git. Ter acesso a uma pasta não autoriza alterar seu conteúdo fora da tarefa.
- Dentro do escopo autorizado, pode ler, criar, editar e reorganizar arquivos pontualmente, investigar falhas, implementar correções, executar builds/testes/linters e atualizar a documentação pertinente.
- Pode consultar documentação técnica quando necessário e permitido, sem expor credenciais, código privado ou dados do operador a serviços externos não autorizados.
- Pode executar comandos Git de leitura, como `status`, `diff`, `log` e inspeção de branches. Operações de escrita seguem a seção Git abaixo.
- Preserve alterações de terceiros e trabalhos preexistentes. Não sobrescreva, descarte ou reverta mudanças alheias. Continue nas partes independentes; peça decisão quando uma sobreposição impedir avançar com segurança.
- Faça somente mudanças necessárias. A autonomia não autoriza alterar outros repositórios, contratar serviços, consumir APIs pagas, enviar mensagens ou publicar conteúdo por iniciativa própria.
- Estas instruções não alteram permissões da ferramenta. Não modifique configurações globais de segurança do Codex, sandbox, políticas de aprovação ou listas de comandos permitidos. Quando houver uma restrição real, use o mecanismo de aprovação disponível; não tente contorná-la.

## Contexto de continuidade — Hórus audiovisual

**Produto vigente:** exclusivamente inteligência e operação audiovisual. Não reintroduzir telas, módulos ou dependência de propostas anteriores. Biblioteca é mídia de produção; Histórico operacional registra execuções, revisões, erros e decisões editoriais. Preserve transcrição, perfis, mídia, licenças e aprovação humana.

**Stack oficial:** React/TypeScript + Tauri 2, Rust nativo mínimo, Python/FastAPI e SQLite. Implementação incremental autorizada. Windows local, sem VPS e sem redesign. Preserve fábrica/CLI/Remotion independentes e Hermes externo sem fork. O Avalonia continua oferecendo transcrição até validar equivalência funcional. Build release e instalador Tauri passaram; não presumir validação de render, mídia ou desempenho.

Leia [continuidade técnica](docs/planejamento/CARTA-AO-CODEX.md), [stack local](docs/planejamento/STACK-LOCAL.md) e [migração](docs/migracao-local.md). Documentos históricos não substituem as decisões atuais.

**Princípio fundamental:** o HORUS deve ser desenvolvido para funcionar bem, não apenas para parecer bem programado.

O idealizador é o responsável pelo produto e principal usuário. Os agentes assumem a implementação, a arquitetura, os testes, a correção de bugs e a manutenção da documentação.

## Antes de alterar

- Leia este arquivo e [docs/architecture.md](docs/architecture.md).
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
- Preserve a compatibilidade futura com Linux: evite APIs exclusivas do Windows e caminhos fixos.
- Nas telas React, use os tokens de `frontend/src/styles/tokens.css`; no Avalonia, use `src/Horus/Theme/Tokens.axaml`. Preserve a identidade visual em ambos.

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
- `docs/architecture.md` descreve apenas o que está implementado.

## Git

- Não crie commits, faça push ou merge automaticamente sem autorização expressa que cubra a tarefa ou uma política explícita previamente aprovada, com repositórios, operações e branches definidos. Um pedido pontual anterior não cria uma política permanente.
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

Decisões técnicas rotineiras que respeitem estas regras não precisam de aprovação.

## Comunicação

Seja objetivo e não explique conceitos básicos de programação sem que isso seja pedido. Explique as decisões técnicas relevantes e sinalize problemas e riscos encontrados.

Ao concluir uma implementação, informe:

- O que foi desenvolvido.
- Como utilizar ou testar.
- Quais verificações foram realizadas.
- Se existem problemas conhecidos.
- Se alguma decisão importante precisa de aprovação.
