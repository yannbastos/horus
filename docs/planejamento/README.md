# Índice de guias, propostas e histórico

Comece por [AGENTS.md](../../AGENTS.md) e selecione somente o contexto pertinente à tarefa. Este diretório preserva planejamentos e evidências anteriores; não é uma lista de tarefas autorizadas.

## Fontes canônicas atuais

| Assunto | Documento |
|---|---|
| Produto e escopo | [VISION](../VISION.md) |
| Stack, fronteiras, armazenamento, desempenho e identidade visual | [ARCHITECTURE](../ARCHITECTURE.md) |
| Hermes, workflows e memória ativa | [AI-SYSTEM](../AI-SYSTEM.md) |
| Biblioteca inteligente de técnicas | [MOTION-LIBRARY](../MOTION-LIBRARY.md) |
| Estado, prioridades e critérios de evolução | [ROADMAP](../ROADMAP.md) |

## Guias e evidências

| Documento | Classificação e uso |
|---|---|
| [Migração local](../migracao-local.md) | Guia operacional e cronologia de incrementos; trechos históricos não sobrepõem o roadmap |
| [Integração Hermes](../integracao-hermes.md) | Guia de configuração e diagnóstico autenticado; não comprova orquestração |
| [Layout desktop](../layout-desktop.md) | Referência visual do Avalonia e capturas; não representa integração operacional dos módulos |
| [Validação local](../validacao-local-2026-11-10.md) | Relatório datado com ambiente, resultados e limites dos ensaios; não reexecutado na reorganização |

## Planejamentos preservados

| Documento | Classificação e limite |
|---|---|
| [CARTA-AO-CODEX](CARTA-AO-CODEX.md) | Carta histórica de continuidade; estado/prioridades atuais estão no roadmap; autorizações não são permanentes |
| [STACK-LOCAL](STACK-LOCAL.md) | Planejamento da migração e critérios originais; direção consolidada em ARCHITECTURE, estrutura proposta distinta da implementação |
| [DIAGNOSTICO](DIAGNOSTICO.md) | Auditoria dos commits identificados; não representa automaticamente o código atual da fábrica ou instalação Hermes |
| [PLANO](PLANO.md) | Sequência e dependências propostas anteriormente; escolhas de stack já resolvidas e prioridades atuais não devem ser reabertas por esse texto |
| [MEMORIA-ATIVA](MEMORIA-ATIVA.md) | Contrato proposto e campos do exemplo, não schema implementado; regras canônicas em AI-SYSTEM |
| [CONTRATOS](CONTRATOS.md) | Rascunhos de interfaces, não endpoints públicos já implementados |
| [VALIDACAO](VALIDACAO.md) | Cenários e critérios propostos, não relatório atual de testes; casos VPS–PC fora da etapa local |
| [CONVERSA](CONVERSA.md) | Síntese histórica de decisões; não exportação de conversa nem autorização permanente |
| [VISAO](VISAO.md) | Resumo histórico; visão canônica em VISION |
| [ARQUITETURA-HIBRIDA](ARQUITETURA-HIBRIDA.md) | Proposta VPS–PC substituída pela operação local; não contratar/configurar VPS a partir dela |

Os exemplos JSON são sintéticos, sem força de schema ou autorização. Não duplicar contratos e perfil editorial entre repositórios.

## Componentes independentes

| Repositório | Papel |
|---|---|
| Hórus | Aplicativo, regras e estado de domínio |
| Fábrica | Motor Python/CLI e Remotion independente |
| Storybook | Laboratório de interface e referências visuais com dados fictícios |
| Hermes Agent | Inteligência externa; diagnóstico existente, execução cognitiva ainda não integrada ao Hórus |

Não consolidar repositórios automaticamente. Preserve arquivos do operador e controles de aprovação, licença e custo. Referências e caminhos locais estão na [arquitetura](../ARCHITECTURE.md#estrutura-e-repositórios).

## Preservação e interpretação

O [contexto original](../historico/contexto-original/README.md) permanece intacto na área histórica, como referência e não como instrução vigente. O [registro da reorganização](../historico/reorganizacao-2026-11-11/README.md) mapeia decisões e preserva cópias integrais dos documentos substituídos.

Os históricos não autorizam implementação, instalação, chamadas pagas, mensagens, publicação, commit ou push. Em caso de divergência, use as fontes canônicas para direção e o código/evidência delimitada para disponibilidade; sinalize conflitos sem realizar mudanças estruturais por iniciativa própria.
