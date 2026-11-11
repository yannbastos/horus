# Registro da reorganização documental — 2026-11-11

Esta reorganização é exclusivamente documental. Não implementa funcionalidades, altera configurações/dependências ou concede autorização para commit/push, inferência, produção, mensagens ou publicação.

## Fontes e preservação integral

O [contexto original](../contexto-original/README.md) foi lido integralmente e preservado sem alteração. Após a revisão independente, foi movido para a área histórica com o mesmo conteúdo. Sua seção “Sua tarefa agora” e as instruções de aprovação pertencem ao pedido histórico, não a uma tarefa executável permanente.

As cópias abaixo preservam os bytes dos documentos antes da consolidação. A extensão .md.txt evita apresentá-las como instruções ativas ou navegar seus links a partir de uma localização diferente da original. Para interpretar um caminho relativo dentro dessas cópias, use como base o diretório original indicado na tabela.

| Cópia integral | Localização original |
|---|---|
| [AGENTS anterior à reorganização](AGENTS-ANTES.md.txt) | AGENTS.md, incluindo alterações locais preexistentes |
| [Visão anterior](VISION-ANTES.md.txt) | docs/vision.md |
| [Arquitetura anterior](ARCHITECTURE-ANTES.md.txt) | docs/architecture.md |
| [Roadmap anterior](ROADMAP-ANTES.md.txt) | docs/roadmap.md |
| [README anterior](README-ANTES.md.txt) | README.md |
| [Índice anterior do planejamento](PLANEJAMENTO-INDICE-ANTES.md.txt) | docs/planejamento/README.md |

O original continuava não rastreado pelo Git no início da tarefa. Preservá-lo não significa adicioná-lo ao índice. As demais peças de planejamento mantêm seu conteúdo histórico, com avisos de classificação e referências atualizadas. Relatórios de validação e arquivos de código permanecem preservados.

Os documentos de visão, arquitetura e roadmap foram renomeados em duas etapas para respeitar maiúsculas/minúsculas no Windows. Somente as três renomeações foram registradas no índice Git, com o conteúdo anterior (R100); as edições permanecem fora do índice para revisão. Nenhum commit ou push foi realizado. Isso evita que core.ignorecase oculte a mudança de caixa em um futuro commit autorizado.

## Mapa das decisões do contexto original

| Tema original | Fonte canônica |
|---|---|
| Contexto, finalidade e funcionalidades | [VISION](../../VISION.md) |
| Stack e responsabilidades, frontend, desktop, backend e motor | [ARCHITECTURE](../../ARCHITECTURE.md) |
| Windows local, Linux futuro, sem VPS; PostgreSQL/Supabase como opção posterior | [ARCHITECTURE](../../ARCHITECTURE.md#direção-arquitetural-aprovada) |
| Monólito modular, plataforma unificada e possibilidade futura de separar processos/hosts | [ARCHITECTURE](../../ARCHITECTURE.md#direção-arquitetural-aprovada) |
| DAS Yottamaster, SSD para banco ativo e backups | [ARCHITECTURE](../../ARCHITECTURE.md#armazenamento-e-segurança) |
| Recursos sob demanda, baixo consumo e metas não garantidas | [ARCHITECTURE](../../ARCHITECTURE.md#desempenho-e-ciclo-de-vida) |
| Preservação integral de identidade e comportamento; sem redesign | [ARCHITECTURE](../../ARCHITECTURE.md#identidade-visual-e-equivalência) |
| Regras de desenvolvimento e interpretação, sem implementação implícita | [AGENTS](../../../AGENTS.md) |
| Hermes externo, adaptadores e verificação de capacidades | [AI-SYSTEM](../../AI-SYSTEM.md) |
| Maestro, tarefas/dependências, estados oficiais, custos e aprovações | [AI-SYSTEM](../../AI-SYSTEM.md#estados-aprovações-e-recuperação--contrato-de-direção) |
| Memória ativa, fontes oficiais e limites de ingestão | [AI-SYSTEM](../../AI-SYSTEM.md#fontes-oficiais-e-memória-ativa) |
| Biblioteca de técnicas, campos, análise/implementação/validação e feedback | [MOTION-LIBRARY](../../MOTION-LIBRARY.md) |
| Prova de conceito e prioridade do primeiro workflow | [ROADMAP](../../ROADMAP.md) |

Os dez itens da prova de conceito original permanecem cobertos: interface, desktop, backend, seleção de arquivos, CLI, progresso/logs, cancelamento, recuperação, player e medição. Requisitos e critérios detalhados continuam no [planejamento local](../../planejamento/STACK-LOCAL.md#6-prova-de-conceito-incremental); o roadmap distingue avanços e lacunas.

As regras preexistentes de autonomia delimitada, Git, aprovações, testes, comunicação, preservação do trabalho alheio e segurança foram mantidas no AGENTS. A remoção de “implementação incremental autorizada” do contexto permanente impede transportar uma autorização histórica; não desfaz decisões técnicas nem autorizações expressas vigentes para uma tarefa específica.

## Divergências tratadas

- Render: afirmações antigas de ausência de validação foram retiradas dos pontos de entrada atuais; os ensaios têm escopo explícito, sem certificação editorial.
- Prioridades: aceitação da base local e primeiro workflow são marcos distintos; fases antigas não sobrepõem essa ordem.
- Biblioteca: mídia atual e técnicas planejadas coexistem, sem renomeação de telas ou eliminação de capacidade.
- Hermes: diagnóstico existe; execução cognitiva/delegação integrada permanece planejada.
- Estado oficial: tarefas/eventos já persistem; aprovações, custos e memória completos são requisitos futuros do backend.
- Arquitetura: realidade atual separada de direção aprovada; a frase antiga “apenas implementado” foi ajustada no AGENTS para permitir essa separação.
- Portabilidade: a nova stack contém integração Windows; observações antigas de ausência de APIs Windows referem-se ao Avalonia.
- Tokens: cada implementação tem seus arquivos; não existe sincronização automática com Storybook.
- Autorizações: cartas e planos registram atos anteriores, sem conceder permissão permanente.

## Limites que permanecem abertos

As questões abertas de produto/implementação estão em [ROADMAP](../../ROADMAP.md#pendências-transversais-e-decisões-abertas). Não foram resolvidas por uma alteração documental.

Persistem diferenças históricas entre incrementos: tamanhos de instalador, contagens de testes, configuração/conectividade Hermes observada em sessões diferentes e bloqueios da fábrica avaliados sobre revisões distintas. Esses registros não foram apagados nem artificialmente reconciliados em um resultado único. Devem ser interpretados com data, revisão e escopo.

A prontidão do código atual da fábrica além dos ensaios citados não foi certificada. Configuração privada do Hermes não foi inspecionada nesta reorganização. Links públicos históricos para branches, documentação e releases permanecem referências externas, sem consulta de rede nesta tarefa.

## Verificações da reorganização

- Links locais e âncoras conferidos em 25 arquivos Markdown, incluindo destinos de código e os repositórios irmãos disponíveis nesta organização local.
- Hash do contexto original e das seis cópias históricas comparado com a base anterior à edição: conteúdo idêntico.
- Sete seções de regras preexistentes do AGENTS comparadas integralmente: autonomia/escopo, metodologia, prioridades, testes, Git, aprovações e comunicação permaneceram iguais.
- Corpos dos dez planejamentos preservados, exceto atualização da capitalização dos links e inclusão dos avisos de classificação.
- Guia Hermes, guia visual e relatório de validação preservados byte a byte.
- Arquivos rastreados fora da documentação comparados por hash: nenhuma alteração.
- Diff de conteúdo e renomeações revisado; checks de whitespace no índice e fora dele sem erros. Nenhuma suíte de runtime executada, pois o escopo é documental.

## Ajustes após revisão independente — 2026-11-11

Correções documentais aprovadas pelo usuário depois da revisão da reorganização. As verificações acima descrevem o estado anterior a estes ajustes.

- Regras de autonomia, metodologia, testes, Git e aprovações que já existiam localmente no AGENTS foram separadas da reorganização para versionamento próprio.
- O contexto original foi movido, com o mesmo conteúdo, para a [área histórica](../contexto-original/README.md) e identificado como referência, não instrução vigente.
- O CLAUDE.md passou a declarar que commit e push exigem autorização específica e que instruções globais conflitantes não são autorização.
- A remoção da autorização permanente de implementação incremental foi confirmada pelo usuário.
- Suporte atual (somente Windows) e futuro (Linux) foram diferenciados no README e no AGENTS.
- Avisos de autorizações antigas foram explicitados em CARTA-AO-CODEX, CONVERSA, VALIDACAO e no guia visual; o guia Hermes indica que a preparação exige autorização.
- AI-SYSTEM registra que o Hórus controla a memória operacional e o Hermes utiliza a memória contextual, e preserva a capacidade de substituir agentes e modelos.
