# Fonte recebida — resumo de arquitetura e memória ativa

Documento fornecido pelo usuário: `Horus_Resumo_Arquitetura_Memoria_Ativa.docx`.
Recebido em 2026-11-10. Conteúdo textual extraído dos parágrafos; tabelas foram linearizadas e a diagramação original não foi preservada.
SHA-256 do DOCX de origem: `698b1de876bfacf03fa13d14b9296aa0b0b98f8d554aa52726a4b106e0f0606b`.

Este é um registro de origem, não um relatório de funcionalidades verificadas. Relatos sobre skills, licenças, serviços e hardware precisam ser confrontados com a auditoria. Infraestrutura e agentes especializados são intenção, não contratação ou integração confirmada. Veja os documentos de arquitetura e memória no diretório superior.

## Texto extraído

HÓRUS  |  DOCUMENTO DE REFERÊNCIA
Resumo consolidado do projeto
Visão de produto, arquitetura, memória ativa e roteiro de implementação
10 de novembro de 2026  •  Síntese das decisões e ideias discutidas
Este documento registra o planejamento da conversa. Ele diferencia decisões de arquitetura, funcionalidades desejadas e pontos que ainda dependem de auditoria técnica. Não comprova que as integrações propostas já estão implementadas.
1. Resumo executivo
O Hórus será uma plataforma de inteligência audiovisual para estudar vídeos, canais e tendências, detectar oportunidades, planejar conteúdos originais, coordenar a fábrica de vídeos e aprender com os resultados. O foco inicial será um canal dark do YouTube, com possível expansão para TikTok, Reels e outros canais após validação.
Decisão central: adotar a Opção A — usar o Hermes Agent como agente de orquestração, por integração externa, sem modificar seu código-fonte inicialmente. Claude, Codex e Antigravity serão recursos especializados coordenados de forma seletiva; a fábrica Python continuará como motor de execução.
2. Objetivo e limites do Hórus
Radar: encontrar vídeos de destaque em mercados EN/ES e oportunidades de adaptação original ao Brasil.
Análise audiovisual: estudar títulos, thumbnails, ganchos, narrativa, edição e sinais públicos de desempenho; separar observação de hipótese.
Planejamento: transformar pesquisa em briefing editorial, roteiro e conceito visual sujeito a aprovação.
Produção: reutilizar CLI `fabrica`, Remotion, ElevenLabs, Whisper, assets licenciados e verificações já existentes.
Gestão: acompanhar fila de trabalhos, canais, aprovações, publicação, desempenho, custos e aprendizados.
Referência: o Gin apresentado no vídeo enviado inspira descoberta, moldes e produção em lote. Isso não significa copiar o software nem presumir acesso a suas tecnologias internas. Não foi confirmado que o Gin seja um Hermes modificado.
3. O que já existe na fábrica
Componente
Situação relatada
CLI Python `fabrica` e estrutura do repositório
Já criados; devem ser auditados antes de modificações
Skills `fc-*`
Relatadas como funcionais em Claude Code e Hermes
Remotion e produção de teste
Um short técnico foi concluído da voz ao pacote
ElevenLabs (voz Emerson)
Provedor de voz escolhido; outros removidos em 08/11
Bloqueio de licenças
Relatado como funcional
Canal 01
Falta definir subnicho, validações e primeiras publicações reais
Telegram no Hermes
Ainda pendente de configurar no contexto inicial
4. Arquitetura escolhida
Fluxo lógico: Você (Telegram / futuro dashboard) → Hórus / Hermes (tarefas, decisões, memória e autorizações) → agentes especializados e serviços da plataforma → CLI `fabrica` → narração, assets, edição e renderização → revisão → publicação.
Camada
Responsabilidade
Hórus
Produto central: API, painel, perfis, políticas, aprovações, métricas e filas.
Hermes
Orquestração, automações recorrentes, memória de trabalho, relatórios e comunicação via Telegram.
Claude
Pesquisa, análise editorial, roteiros e/ou desenvolvimento quando adequado.
Codex
Desenvolvimento, testes, correções e revisão técnica quando necessário.
Antigravity
Possível agente para fluxos de engenharia e interfaces; integração requer validação.
CLI `fabrica`
Motor determinístico de execução e renderização, independente de Hermes e dashboard.
Regra de orquestração: não acionar três agentes para a mesma tarefa por padrão. Delegar ao agente mais apropriado conforme capacidade, custo, disponibilidade e histórico; exigir saídas estruturadas, logs e limites. A disponibilidade e as condições de uso programático de cada ferramenta precisam ser verificadas.
5. Memória ativa: conceito e aplicação
Não é necessário começar com um “segundo cérebro” complexo. A proposta é criar uma memória operacional compartilhada e persistente, capaz de orientar decisões futuras sem acumular transcrições indiscriminadas.
5.1. O que deve ser lembrado
Decisões técnicas e sua justificativa (ex.: escolha exclusiva do ElevenLabs).
Erros recorrentes e correções validadas de render, áudio, legendas e licenciamento.
Preferências editoriais específicas de cada canal e feedback de aprovações.
Hipóteses e experimentos: formato, título, duração, gancho e desempenho observado.
Contexto operacional: andamento das fases, tarefas pendentes e restrições relevantes.
5.2. Ciclo de memória ativa
RECUPERAR → EXECUTAR → REGISTRAR → VALIDAR → REUTILIZAR. Antes de atuar, o agente busca regras relevantes. Durante o trabalho, segue a configuração oficial. Depois, registra propostas de aprendizado. Regras críticas ou mudanças editoriais relevantes só entram em vigor mediante validação adequada.
5.3. Fontes da verdade
Informação
Local recomendado
Configurações editoriais
`perfil.yaml` de cada canal (fonte oficial)
Instruções dos agentes
`CLAUDE.md`, `AGENTS.md` e skills pertinentes
Decisões e aprendizados duráveis
Markdown versionado em Git
Métricas, tarefas, custos e histórico
Banco operacional local à aplicação (SQLite inicialmente; avaliar depois)
Assets e projetos audiovisuais
Arquivos locais / Yottamaster
Interface de consulta pessoal
Obsidian opcional sobre arquivos Markdown
Evitar: guardar toda conversa como memória, criar duplicatas do perfil, deixar um agente alterar regras críticas sem revisão ou implementar busca vetorial antes de demonstrar necessidade.
6. Infraestrutura híbrida: nuvem + armazenamento local
A intenção é contratar uma VPS Hostinger para deixar o Hermes e as automações disponíveis 24 horas por dia via Telegram; usar ElevenLabs para narração e Epidemic Sound para músicas/efeitos, respeitando as licenças de uso. As chamadas aos modelos de IA poderão gerar custos adicionais às assinaturas.
Local
Função planejada
Hostinger VPS
Hermes 24/7, Telegram, Radar leve, tarefas, memória ativa e banco operacional persistente
PC Windows
Ambiente de desenvolvimento, revisão e renderização pesada com Remotion
Yottamaster VN400C3
DAS USB de 4 baias para biblioteca audiovisual, projetos, arquivos finais e backups
Serviços externos
Modelos Claude/Codex/Antigravity conforme integração permitida; ElevenLabs; Epidemic Sound
O Yottamaster VN400C3 é um gabinete DAS, não um servidor autônomo. Se o PC estiver desligado, renders dependentes dele não rodam; os jobs devem permanecer na fila. Recomenda-se manter o banco ativo no SSD da máquina que o executa e fazer backups consistentes no DAS, sem colocar SQLite ativo em compartilhamento de rede.
A VPS não implica execução local de modelos. Armazenamento de memória, inferência de IA e renderização são serviços distintos. O acesso remoto ao PC/DAS deverá usar conexão privada autenticada; não expor compartilhamentos domésticos diretamente à internet.
7. Pipeline audiovisual e pontos de controle
Descobrir oportunidades → analisar desempenho e estrutura → selecionar ideia → criar título e conceito de thumbnail → aprovar → gerar `roteiro.yaml` → aprovar → narrar com ElevenLabs → conferir/alinhár áudio com Whisper → obter imagens/sons autorizados → renderizar no Remotion → checklist automático → revisão humana → empacotar `.srt`, `metadata.json` e créditos → publicar (manual inicialmente).
Regras permanentes: recursos com licença não comercial ou não verificada bloqueiam a publicação; reprovações técnicas alimentam regras da fábrica, preferências de estilo alimentam o perfil do canal. Nunca presumir que métricas privadas, como retenção de terceiros, sejam públicas. Analisar formatos não autoriza copiar roteiros ou vídeos.
8. Roadmap proposto
Fase
Entrega / critério
0 — Consolidação
Subnicho Canal 01, APIs, checklist, guia de voz, biblioteca sonora, Telegram, políticas e primeiro vídeo real; validar 5–10 shorts.
1 — Radar MVP
Coleta EN/ES, snapshots e ranking de candidatos por CLI, com cache e respeito às cotas.
2 — Análise editorial
Relatórios com fontes, distinção fato/hipótese e briefing original aprovado.
3 — Fila de produção
Jobs persistentes, limite de concorrência, retomada e aprovações.
4 — Dashboard
Painel local para Radar, canais, fila e revisões sem duplicar o motor.
5 — Analytics + memória
Métricas, custos, feedback, experimentos e recuperação contextual.
6 — Escala
Mais canais e publicação programada somente depois de validar tempo, qualidade e políticas.
9. Pendências e decisões em aberto
Auditar o repositório real para confirmar estrutura e funcionalidades existentes, antes de reestruturar.
Verificar instalação, recursos, APIs, permissões e política de autenticação do Hermes na VPS.
Confirmar quais interfaces oficiais de Claude, Codex e Antigravity podem operar sem intervenção em servidor, com seus custos e termos de uso.
Definir capacidade da VPS e limites financeiros; dimensionar armazenamento e rotina de backup.
Verificar licença da Epidemic Sound para cada canal e eventuais restrições de API/download automatizado.
Definir contratos de tarefas e formatos estruturados de saída entre o Hermes e o CLI.
Testar autenticação do Telegram com lista de usuários autorizados e aprovações de ações sensíveis.
10. Próximo passo recomendado
Entregar este resumo ao desenvolvedor/Claude Code e solicitar UMA auditoria inicial sem alterações no código. O resultado esperado é um mapa da arquitetura atual, dos componentes reutilizáveis, das lacunas para integrar Hermes e o Radar, dos riscos e de um primeiro incremento pequeno. Priorizar o lançamento do Canal 01 antes de investir em uma interface grande ou em um sistema de memória excessivamente complexo.
Princípio norteador: Hórus pesquisa, coordena e aprende; Hermes orquestra; agentes especializados executam tarefas cognitivas quando necessários; a fábrica Python produz; você mantém o controle de aprovações e publicação.
