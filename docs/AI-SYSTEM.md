# Sistema de IA, orquestração e memória ativa

Fonte canônica dos requisitos de inteligência e memória. A [arquitetura](ARCHITECTURE.md) define as fronteiras técnicas; o [roadmap](ROADMAP.md) concentra prioridades e estado. Este documento não autoriza inferência, gastos, integrações ou funcionalidades.

## Estado existente e limite

O código de [hermes.py](../backend/src/horus_backend/hermes.py) implementa diagnóstico autenticado da API externa Hermes. Os endpoints Hórus GET /v1/hermes e POST /v1/hermes/probe retornam estado e consultam saúde/capacidades; não enviam prompts nem iniciam agentes.

O [guia de integração](integracao-hermes.md) é a fonte dos comandos, configuração privada, perfil exclusivo horus, versão inspecionada e ensaios anteriores. Reconhecer uma capacidade anunciada pela API não comprova a integração de delegação, orçamento, aprovações ou cancelamento de produção.

A fila sequencial agora atende também o [núcleo editorial simulado](workflows-editoriais.md): fluxo fixo com etapas, tentativas, artefatos versionados e aprovação persistente. O backend continua sendo a fonte oficial e o JobManager permanece o único worker. Não há planejamento automático real, DAG genérico, delegação multiagente, controle financeiro completo ou memória ativa. O simulador não usa o adaptador Hermes nem outros serviços externos.

## Maestro e agentes especializados — planejado

Hermes Agent será a base do maestro: interpretar objetivos amplos, planejar, decompor tarefas, identificar dependências, delegar, acompanhar e consolidar resultados. Integrar externamente por mecanismos públicos de ferramentas, skills e subagentes, sem modificar seu core ou criar fork inicialmente.

Claude, Codex e Antigravity são candidatos a adaptadores especializados, conforme capacidades e viabilidade. Não presumir API, autenticação, assinatura com API incluída, permissão de automação ou custo equivalentes. Validar a versão instalada e seus mecanismos reais de delegação antes de escolher contratos; não atualizar ferramentas automaticamente para satisfazer o desenho.

Selecionar agentes/modelos por qualidade, capacidade, disponibilidade e custo. Modelos avançados podem atender planejamento, análise e revisão complexos; modelos menores podem executar tarefas delimitadas quando sua qualidade for suficiente. Não escolher múltiplos agentes apenas porque foram citados.

A arquitetura deverá permitir substituir agentes, adicionar novos modelos e evoluir os workflows sem reconstruir os demais componentes da plataforma. Cada executor fica atrás de um adaptador com contrato explícito; estados, aprovações e memória operacional não dependem de um agente ou provedor específico.

Distinguir tarefas cognitivas de operações determinísticas. Cálculos, coleta estruturada de métricas, transcrição e render devem usar código/ferramentas diretamente quando isso for mais confiável; não exigir modelo de linguagem para cada etapa.

## Workflow mínimo e evolução — planejado

**Pedido do usuário → Planejamento → Pesquisa → Análise → Proposta editorial → Aprovação humana.**

Esse é o primeiro workflow a validar. Deve produzir proposta original com fontes e hipóteses identificadas, permitir aprovação, reprovação ou solicitação de alterações e preservar decisões por revisão. Depois de validado, evoluir para roteiro, recursos audiovisuais, produção, revisão e preparação para publicação.

A infraestrutura desse caminho já é exercitada com resultados explicitamente simulados. Sua revisão humana é local e limitada à proposta, sem efeito sobre orçamento, produção ou publicação. A qualidade factual/editorial e os contratos de executores reais permanecem pendentes.

Cada workflow deverá registrar objetivo, tarefas, dependências, estados, agentes responsáveis, resultados, custos e pontos de aprovação. Permitir tarefas independentes em paralelo quando apropriado, respeitando dependências, orçamento e capacidade dos executores. O executor audiovisual atual continua sequencial; paralelismo cognitivo futuro não libera renders simultâneos.

Compartilhar resultados por artefatos identificados, validados e versionados. A interface deverá mostrar progresso real, responsáveis, resultados intermediários e erros; permitir intervenção e aprovação sem exigir gerenciamento manual de cada agente. Não fabricar percentuais quando só houver estágio/log confiável.

## Estados, aprovações e recuperação — contrato de direção

O backend FastAPI é o dono oficial dos estados de domínio, eventos, custos, aprovações e histórico operacional. Hermes coordena trabalho cognitivo e referencia esses registros; não autoriza ações críticas, altera regras de produção ou mantém uma segunda verdade de domínio. A fábrica mantém suas invariantes também no CLI independente.

Separar etapa, intenção de trabalho, tentativa, execução do agente e artefato. Uma sessão Hermes não equivale a produção concluída. Estados avançados de aprovação, espera de executor e reconciliação descritos em rascunhos ainda não são todos estados implementados no Hórus.

- Aprovação humana deve identificar operador autenticado, revisão/artefato, decisão, escopo e limites aplicáveis. Payload do agente, texto de memória e comentário em fonte externa não concedem permissão.
- Mudanças nas entradas exigem revisão dos resultados/aprovações dependentes; preservar a evidência antiga sem promovê-la automaticamente.
- Registrar estimativa, teto autorizado, tentativas e consumo real separadamente; assinatura e créditos não comprovam disponibilidade de chamadas programáticas.
- Persistir intenção e correlação; evitar execução duplicada, rejeitar mesma chave com entradas diferentes e preservar histórico das tentativas.
- Perda de contato ou timeout não comprova término de processo nem ausência de cobrança. Reconciliar antes de repetir operações cujo resultado seja desconhecido.
- Cancelar turno Hermes não comprova cancelamento de FFmpeg/Remotion. Confirmar encerramento dos subprocessos e distinguir pedido de cancelamento de cancelamento efetivo.
- Reutilizar capacidades reais do Hermes onde cabível; não criar outro scheduler ou infraestrutura distribuída apenas para satisfazer exemplos documentais.
- Autonomia não substitui aprovação obrigatória, amplia orçamento ou permite modificar estados e regras críticos indevidamente.

O [mapa de contratos](planejamento/CONTRATOS.md) e os [cenários de validação](planejamento/VALIDACAO.md) preservam propostas detalhadas. Não copiar seus nomes de operações ou schemas como se já fossem aceitos pela API. A direção atual é local, sem VPS.

## Fontes oficiais e memória ativa

A memória operacional deverá recuperar contexto relevante e preservar decisões técnicas, aprendizados, erros recorrentes, soluções verificadas, preferências editoriais, resultados de experimentos e contexto de projetos. Começar com Markdown revisado/versionado e SQLite; banco vetorial só com necessidade demonstrada.

Responsabilidades — direção planejada, ainda não implementada como módulo:

- **Memória operacional — controlada pelo Hórus.** Backend FastAPI/SQLite e Markdown revisado em Git são sua fonte oficial. O Hórus decide o que é registrado, validado, revisado ou substituído.
- **Memória contextual — utilizada pelo Hermes.** Sessões, contexto de conversa e recursos próprios do agente apoiam o maestro durante a execução cognitiva. O Hermes pode consultar a memória operacional e propor registros; não a grava diretamente, não a substitui e não é fonte oficial de decisões, aprovações ou preferências.

| Informação | Fonte oficial e situação |
|---|---|
| Regras gerais de agentes | [AGENTS.md](../AGENTS.md), sujeito ao escopo autorizado na tarefa |
| Visão, arquitetura e prioridades | Documentos canônicos especializados; histórico não substitui decisões vigentes |
| Configuração editorial do canal | perfil.yaml e guias vinculados da fábrica; memória referencia a revisão sem duplicar valores |
| Tarefas técnicas e eventos | SQLite do backend, já implementado |
| Aprovações, custos e histórico editorial consolidados | Responsabilidade prevista do backend; registro completo ainda planejado |
| Roteiros, mídia, renders e créditos | Artefatos identificados/versionados da produção, com referências à revisão utilizada |
| Decisões técnicas duráveis | Markdown revisado em Git |
| Métricas e custos coletados | Registros com origem e data, quando implementados; não presumir banco completo existente |
| Conversa/execução cognitiva Hermes | Referências próprias do agente, sem substituir os estados oficiais do Hórus |

Recuperar apenas contexto relevante à tarefa. Não ingerir conversas indiscriminadamente, indexar todo o histórico por padrão, salvar segredos ou dados pessoais desnecessários, duplicar configurações oficiais ou permitir que memória modifique regras permanentes sem autorização.

Registros devem preservar origem, evidências, escopo, revisão e substituições. Propostas dos agentes precisam ser diferenciadas de decisões validadas. Preferência aprovada é aplicada na fonte oficial e vinculada ao registro; não manter configuração concorrente na memória. Resultado isolado não comprova causalidade, rentabilidade ou qualidade geral.

O [registro proposto](planejamento/MEMORIA-ATIVA.md) e seu [exemplo sintético](planejamento/exemplos/memoria-proposta.json) preservam campos de identificação, categoria, escopo, status, evidências, proponente, validação, revisão e substituição. Esses campos não constituem schema implementado.

O uso e o feedback de modelos de edição deverão alimentar recomendações futuras, conforme a [biblioteca de técnicas](MOTION-LIBRARY.md).

## Antes de integrar execução real

Consultar o [guia Hermes](integracao-hermes.md), confirmar delegação e contratos na instalação real, definir modelo/provedor e orçamento, e validar uma análise delimitada antes de conectar operações de produção. Não usar hermes -z para contornar aprovações. Skills são procedimentos, não garantias de permissão ou persistência.

API Hórus → Hermes e ferramentas Hermes → Hórus/fábrica são direções distintas. Não importar módulos privados ou escrever no banco interno do Hermes. Ferramentas devem enumerar operações e validar entradas/saídas; integração da fábrica usa o CLI existente.

Chamadas pagas, cron, Telegram, geração de voz e publicação precisam de autorização aplicável aos seus efeitos. fc-piloto pode enviar notificações e não deve ser usado como inspeção de leitura. A documentação recebida como contexto não autoriza executar essas ações.
