# Arquitetura do Hórus

Fonte canônica da stack, das fronteiras e das decisões arquiteturais. A seção de implementação descreve código inspecionado; a direção aprovada contém requisitos que ainda não estão integralmente implementados. O [roadmap](ROADMAP.md) distingue implementação de validação. Aprovações antigas não autorizam novas tarefas.

## Implementação atual

Inspeção documental e de código em 2026-11-11; nenhum teste de runtime foi executado nesta reorganização.

Incremento posterior autorizado: [núcleo editorial simulado](workflows-editoriais.md), validado por testes do backend em bancos temporários. Isso acrescenta workflow/revisões sem declarar integração cognitiva real ou modificar a fábrica.

| Componente | Evidência no repositório | Responsabilidade e limite |
|---|---|---|
| React/TypeScript | [App.tsx](../frontend/src/App.tsx), [features](../frontend/src/features), [package.json](../frontend/package.json) | Navegação, temas, transcrição, mídia local, operações limitadas da fábrica, tela do Radar ([Radar.tsx](../frontend/src/features/Radar.tsx)) e análises editoriais com autorização e decisão humana ([EditorialWorkflows.tsx](../frontend/src/features/EditorialWorkflows.tsx)) |
| Tauri 2 / Rust | [src-tauri](../frontend/src-tauri), [main.rs](../frontend/src-tauri/src/main.rs) | Diálogos nativos, conexão e ciclo de vida do backend; integrações nativas mínimas |
| FastAPI | [api.py](../backend/src/horus_backend/api.py) | API local autenticada, tarefas, mídia, transcrição, diagnóstico, workflows editoriais rotas do Radar (datasets, demonstração e início de workflow) e status de segurança somente leitura (`GET /v1/security/status`) |
| Executor sequencial | [jobs.py](../backend/src/horus_backend/jobs.py), [processes.py](../backend/src/horus_backend/processes.py) | Uma tarefa técnica por vez, subprocessos, logs, cancelamento e retentativa explícita; não é um workflow multiagente |
| SQLite | [storage.py](../backend/src/horus_backend/storage.py), [migrações](../backend/src/horus_backend/migrations.py) | Schema v4: tarefas/mídia preservadas, workflows, tentativas editoriais, artefatos, aprovações, diário de domínio, execuções cognitivas/autorizações (v3) e cliente cognitivo por workflow (v4, aditiva); estado do Radar em arquivo SQLite separado; cópias do Radar redigidas após 28 dias por [retention.py](../backend/src/horus_backend/retention.py), sem apagar linhas; `secure_delete` em todas as conexões, checkpoint `TRUNCATE` do WAL após redação e inventário de backups em simulação ([segurança dos dados](seguranca-dados.md)); sem controle financeiro completo ou memória ativa |
| Workflow fixo simulado | [workflows.py](../backend/src/horus_backend/workflows.py) | Quatro etapas como jobs no worker existente; revisão humana por artefato/revisão, sem modelos ou pesquisa externa |
| Transcrição Python | [transcriber.py](../backend/src/horus_backend/transcriber.py), [Transcription.tsx](../frontend/src/features/Transcription.tsx) | faster-whisper em subprocesso e download YouTube; equivalência completa ainda depende de validação |
| Hermes externo | [hermes.py](../backend/src/horus_backend/hermes.py) | Diagnóstico autenticado de saúde/capacidades e executor cognitivo ([workflow_hermes.py](../backend/src/horus_backend/workflow_hermes.py)); workflows do Radar usam por padrão o simulador em processo ([hermes_simulator.py](../backend/src/horus_backend/hermes_simulator.py)), sem rede. Execução real recusada por um gate *deny by default* ([security.py](../backend/src/horus_backend/security.py)) enquanto o perfil `horus` tiver ferramentas perigosas, memória ativa, extensões não auditáveis ou faltarem tetos de tokens e de execuções diárias; script de endurecimento com backup, quarentena e reversão verificados ([segurança do Hermes](seguranca-hermes.md)) |
| Desktop preservado | [src/Horus](../src/Horus), [tests/Horus.Tests](../tests/Horus.Tests) | C#/.NET 10, Avalonia, transcrição Whisper.net, conversão FFmpeg e download yt-dlp |

Fluxo técnico existente: React → API FastAPI → tarefas SQLite → subprocesso. Para a fábrica, esse subprocesso invoca o CLI independente. As operações enumeradas são consulta de perfil, render de rascunho short, transcrição e download YouTube. Não há shell arbitrário nem comandos de aprovação/publicação expostos pela integração.

O núcleo editorial acrescenta API → coordenação de domínio → os mesmos jobs/JobManager → função simulada local. Pedido e revisão humana não ocupam o worker. As transições editoriais e artefatos são transacionais. Uma [trava por banco](../backend/src/horus_backend/worker_lock.py) impede workers concorrentes sobre o mesmo caminho; não há segundo executor nem scheduler distribuído. O primeiro fluxo editorial (M1) está integrado: dataset do Radar → [adapter](../backend/src/horus_backend/radar_workflow.py) → workflow com executor `hermes_simulated` → autorização explícita → análise simulada validada pelo contrato → proposta → aprovação/rejeição na interface, persistida no SQLite. Detalhes, rotas e limites em [workflows editoriais](workflows-editoriais.md). Dados de demonstração são fictícios (`operator_fixture`); nenhuma coleta real do YouTube ou inferência real faz parte desse fluxo.

Tarefas pendentes sobrevivem ao reinício; execuções em andamento passam a interrompidas e exigem revisão antes de nova tentativa. Chaves de idempotência impedem submissões duplicadas com a mesma entrada. Isso não garante execução exatamente uma vez em serviços externos.

A Fase 1 da migração de transcrição reutiliza `jobs.result` para checkpoints atômicos de texto/cursor, sem novo schema ou executor. A interface recupera transcrições/downloads pelo histórico filtrado e reanexa ao mesmo job; um recibo local preserva a chave quando a resposta do POST é desconhecida. Recibo não substitui o SQLite como fonte oficial. Conexões interrompidas não liberam novas submissões enquanto houver execução desconhecida. Procedimentos e limites estão na seção de recuperação do [guia local](migracao-local.md#recuperação-da-transcrição--fase-1).

A revisão dessa fase acrescenta keepalive de transporte sem eventos persistidos, renovação de reconexões após frames válidos, identificação local da base e descarte de recibo inválido somente com confirmação. Texto anterior fica referenciado, sem cópias em cada atualização de metadados. Retry direto de transcrição é recusado para preservar o resultado; timeout mantém o checkpoint. O custo quadrático do texto acumulado está documentado e possui medição em banco temporário, sem otimização ampla.

As etapas 1/2 de paridade acrescentam descoberta centralizada em `dependencies.py`, diagnóstico sem carregar motores e fallback CUDA→CPU limitado ao início da mesma tarefa, antes de qualquer trecho de texto. Falhas posteriores preservam o parcial sem reprocessamento automático. A fila React sincroniza drops consecutivos e mantém regras de salvamento/FIFO; testes de IPC Tauri simulado portam casos úteis do Avalonia. Não foi removido código C# nem homologado o instalador/GPU por esses testes.

Detalhes operacionais, comandos, variáveis de ambiente, formatos e limitações pertencem ao [guia de migração](migracao-local.md). Evidências de ensaios pertencem ao [relatório local](validacao-local-2026-11-10.md), sem equivaler à validação integral do produto.

## Estrutura e repositórios

~~~text
frontend/src/
  components/          Identidade, navegação e componentes
  features/            Transcrição, Biblioteca, tarefas e Ajustes
  platform/            Adaptação desktop/navegador
  services/            Cliente da API e eventos
  styles/              Tokens e estilos
frontend/src-tauri/    Tauri 2 e Rust nativo
frontend/scripts/      Empacotamento do backend
frontend/tests/        Testes de interface
backend/src/horus_backend/
                       API, configuração, persistência, executor e adaptadores
backend/tests/         Testes do backend
src/Horus/             Desktop Avalonia preservado
tests/Horus.Tests/     Testes .NET, comportamento e interface
docs/                  Documentação canônica, guias e histórico
~~~

Fábrica e Storybook ficam em repositórios independentes. Na organização local, consulte o [README da fábrica](../../../fabrica-canais/README.md), o [contrato proposto Hórus–fábrica](../../../fabrica-canais/docs/CONTRATO-HORUS-FABRICA.md) e o [README do Storybook](<../../HORUS Storybook/README.md>). Esses links dependem da disposição local dos repositórios; não implicam que seus arquivos estejam presentes em um clone isolado do Hórus.

Não há consolidação em monorepo ou remoção do C# autorizada pela documentação. O código Python do backend está organizado em módulos de arquivo, não nas subpastas idealizadas no planejamento inicial.

## Direção arquitetural aprovada

Adotar uma plataforma unificada com **monólito modular**: responsabilidades claras, interfaces explícitas e baixo acoplamento. Os módulos internos deverão compartilhar autenticação local quando necessária, persistência, tarefas, eventos, aprovações e configurações. Essa direção não declara que todos esses serviços já existem.

| Tecnologia / fronteira | Decisão |
|---|---|
| React + TypeScript | Interface componentizada, tipada, responsiva e com carregamento sob demanda; separar apresentação e negócio; permitir reutilização futura na web |
| Tauri 2 | Camada desktop, seleção de arquivos/pastas, acesso autorizado, reprodução e acompanhamento de operações |
| Rust | Apenas integrações nativas necessárias; não reescrever Python sem evidência técnica |
| Python + FastAPI | APIs, regras de negócio, integrações, tarefas e persistência; funcionar sem Tauri |
| SQLite | Persistência local inicial; PostgreSQL/Supabase é possibilidade futura, sem introdução nesta etapa |
| Fábrica Python / CLI / Remotion | Motor independente de processamento, composição, prévia e render; não criar um segundo motor nem acoplá-lo à interface |
| Hermes Agent | Inteligência externa, ferramentas e skills sem fork inicial; contratos cognitivos em [AI-SYSTEM.md](AI-SYSTEM.md) |
| Processos e computadores | Permitir separação futura sem introduzir microsserviços ou infraestrutura distribuída antecipadamente |

Windows local é a plataforma inicial, sem VPS. Linux, inclusive Arch Linux, exige validação própria; usar caminhos e interfaces portáveis onde possível. Não afirmar portabilidade completa: a implementação atual possui integrações específicas do Windows, como Job Objects e o empacotamento NSIS.

O backend deverá ser a fonte oficial dos estados, eventos, custos, aprovações e histórico operacional. Hoje essa centralização cobre tarefas técnicas, eventos e revisões/aprovações do fluxo editorial simulado. Custos, execução cognitiva real e aprovações da produção audiovisual ainda precisam de implementação e validação. Regras obrigatórias da fábrica também devem valer quando seu CLI for usado diretamente.

### Armazenamento e segurança

O Yottamaster VN400C3 foi escolhido como direção para mídia, datasets, projetos e backups. É um DAS conectado ao computador, não um servidor independente; disponibilidade e configuração reais precisam ser verificadas. Manter bancos ativos preferencialmente no SSD local confiável.

Tratar indisponibilidade da mídia explicitamente. Fazer backups consistentes do banco e inventariar artefatos; Git não preserva mídia ignorada e redundância de discos não equivale a backup. Definir retenção, criptografia, cópia separada, RPO/RTO e teste de restauração isolado conforme necessidade, sem sobrescrever a operação ativa.

A API usa loopback, token e origens permitidas; CORS não substitui autenticação. Validar operações, IDs e caminhos finais, inclusive links/junctions; não expor disco inteiro ou shell genérico. Credenciais ficam fora do frontend e do Git. Tauri deve controlar somente o backend que iniciou. Ambientes de Python da fábrica e Hermes permanecem independentes conforme suas versões.

### Desempenho e ciclo de vida

- Carregar funcionalidades pesadas sob demanda; não iniciar Whisper, FFmpeg ou Remotion sem necessidade.
- Isolar trabalho pesado da interface, limitar concorrência e encerrar subprocessos corretamente.
- Evitar renderizações React desnecessárias, polling e processos contínuos em repouso.
- Preservar interface responsiva durante transcrição/render e monitorar CPU/RAM.
- Não introduzir linguagens, abstrações, serviços ou dependências sem necessidade demonstrada.
- Reutilizar a composição Remotion existente; player/editor Remotion na interface é evolução futura, não dependência atual.

Metas iniciais de avaliação: aproximadamente 250 MB de RAM em repouso, CPU próxima de zero e inicialização em aproximadamente três segundos. **Não são garantias nem resultados comprovados.** Medir build de produção com Tauri, WebView2 e backend, explicando memória compartilhada e o instante de interface utilizável. Medir serviços pesados em cenários separados. Protocolo e resultados anteriores estão no [planejamento de desempenho](planejamento/STACK-LOCAL.md#8-desempenho-e-testes) e no [relatório local](validacao-local-2026-11-10.md).

## Identidade visual e equivalência

A migração tecnológica deve preservar integralmente design, cores, tipografia, ícones, layouts, navegação, estilo e comportamento. Não há redesign autorizado. Reaproveitar componentes compatíveis; reconstruções devem reproduzir aparência e comportamento. Melhorias visuais exigem proposta e aprovação separadas.

| Elemento | Critério a preservar |
|---|---|
| Referência | Desktop audiovisual atual e [capturas](layout-desktop.md), complementados pelo Storybook; não recuperar navegação antiga como direção atual |
| Navegação | Visão geral, Radar, Biblioteca, Produção, Canais, Histórico operacional, Transcrição e Ajustes |
| Geometria | Barra lateral de 216 px, organização de cabeçalho/conteúdo/rodapé; referência 1320 × 840 e mínimo 1040 × 680, com rolagem |
| Cores | Temas claro, escuro e sistema; índigo, superfícies rebaixadas, linhas finas, cantos retos e botões de alto contraste |
| Tokens React | [frontend/src/styles/tokens.css](../frontend/src/styles/tokens.css); não copiar valores para documentos ou componentes |
| Tokens Avalonia | [src/Horus/Theme/Tokens.axaml](../src/Horus/Theme/Tokens.axaml), com DynamicResource; observar diferença de ordem do alfa AXAML/CSS |
| Tipografia | Archivo Expanded nos títulos, Inter no corpo e textos longos, Geist Mono nos rótulos curtos; fontes locais, pesos e hierarquia preservados |
| Marca | Olho geométrico orbital próprio, em AXAML/SVG conforme implementação; mesma geometria, sem reutilizar marcas, ícones ou código das referências |
| Movimento | Referência Avalonia: entrada finita de 2,4 s, depois estática, com transições curtas de cor; sem animação contínua durante leitura; Storybook respeita movimento reduzido |
| Interação | Foco por teclado, seleção, hover, rolagem, temas, atalhos e continuidade da transcrição ao navegar |
| Legibilidade | Contraste de texto mínimo de 4,5:1; roteiros e transcrições em Inter |
| Estados futuros | Preparação explícita, sem métricas fictícias, progresso inventado ou demonstração apresentada como operação real |
| Composição da transcrição | Painel lateral rebaixado com fontes, opções e fila; etapas numeradas transcrever/salvar/próximo preenchidas conforme o progresso; área de leitura em Inter |

Archivo Expanded e Geist Mono são distribuídas sob SIL OFL, com licenças junto às fontes; Inter vem dos pacotes locais de cada implementação. O histórico registra inspiração no ArtCraft Launcher e na composição Hermes, preservando marca própria, sem reutilizar seu código ou identidade.

O Storybook é laboratório independente com dados fictícios, controles locais e referências de fundamentos, componentes, movimento e telas; sua proposta de site não é publicação. Tokens não se sincronizam automaticamente entre catálogo, React e Avalonia. Comparações devem fixar escala e fontes e verificar os dois temas/tamanhos; diferenças de rasterização não autorizam redesign. A comparação visual completa ainda é uma pendência de validação.

## Desktop Avalonia preservado

A solução .NET mantém um projeto de aplicativo em src/Horus. O scaffold anterior com camadas vazias foi removido; não recriar camadas sem necessidade. Views e ViewModels usam MVVM/CommunityToolkit, injeção das funções dependentes de janela, bindings compilados e testes headless.

A transcrição mantém FIFO de até 20 arquivos incluindo o atual; pausa ao concluir e só permite avançar após salvar com sucesso a revisão atual. Editar exige novo salvamento; erro/cancelamento preservam arquivo e texto parcial. A fila de interface não persiste entre sessões. Whisper.net, FFmpeg e yt-dlp pertencem ao desktop preservado; a nova implementação usa outro motor/modelos, conforme [migração](migracao-local.md#transcrição).

As prévias de Radar, Biblioteca, Produção, Canais e Histórico no Avalonia não possuem backend operacional. Não confundir o cartão Hermes desse desktop com o diagnóstico real implementado na nova base. Detalhes de componentes, dependências, testes, história visual e compatibilidade foram [preservados integralmente](historico/reorganizacao-2026-11-11/ARCHITECTURE-ANTES.md.txt).

## Navegação

[Visão](VISION.md) · [Sistema de IA](AI-SYSTEM.md) · [Biblioteca de técnicas](MOTION-LIBRARY.md) · [Roadmap](ROADMAP.md) · [Guias e histórico](planejamento/README.md).
