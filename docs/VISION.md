# Visão do produto

Fonte canônica da visão e do escopo audiovisual. Esta visão não declara funcionalidades prontas nem autoriza implementação. Consulte o [estado e as prioridades](ROADMAP.md).

## Finalidade e experiência

O Hórus é uma plataforma de inteligência e operação audiovisual voltada à pesquisa, análise, planejamento, produção e gerenciamento de conteúdos digitais. O usuário define o objetivo e acompanha o trabalho, os resultados intermediários e as aprovações em uma interface unificada.

O produto deverá reunir descoberta de oportunidades, análise de referências, desenvolvimento de roteiros originais, operação de produções, gerenciamento de canais, analytics e memória ativa. A experiência unificada não elimina a independência técnica da fábrica audiovisual e do Hermes.

## Escopo funcional

| Área | Objetivo do produto |
|---|---|
| Radar | Pesquisar vídeos, canais e tendências; identificar oportunidades com fontes, datas e métricas verificáveis |
| Análise audiovisual | Estudar narrativa, ganchos, títulos, thumbnails, formatos e técnicas de edição, separando observações de hipóteses |
| Planejamento editorial | Selecionar ideias e desenvolver briefings, roteiros, títulos e thumbnails originais sujeitos à aprovação |
| Produção | Executar transcrições e processamento audiovisual; coordenar a fábrica, acompanhar tarefas, revisões e entregas |
| Biblioteca de mídia | Organizar recursos de produção, narração, transcrições, legendas e arquivos finais |
| Biblioteca de técnicas | Transformar análises em conhecimento e modelos reutilizáveis; especificação em [MOTION-LIBRARY.md](MOTION-LIBRARY.md) |
| Canais e resultados | Gerenciar perfis editoriais, custos, métricas próprias autorizadas e experimentos |
| Histórico operacional | Rastrear execuções, falhas, revisões, custos e decisões editoriais |
| Inteligência e memória | Coordenar agentes especializados e recuperar conhecimentos validados; desenho em [AI-SYSTEM.md](AI-SYSTEM.md) |

As áreas acima descrevem o escopo pretendido. Uma tela de preparação, um componente visual ou uma integração parcial não comprova a operação do módulo completo.

## Fluxo editorial e expansão

Fluxo pretendido: descoberta → análise → seleção → planejamento → aprovação → produção → controle técnico e de licenças → revisão final → publicação manual → análise de resultados.

O foco inicial é um canal no YouTube. Validar Shorts e vídeos longos, qualidade, tempo de produção e orçamento antes de expandir para outros canais e formatos. O primeiro vídeo não depende de um dashboard completo ou da descoberta automatizada.

A prioridade de inteligência é validar o primeiro workflow orquestrado, descrito em [AI-SYSTEM.md](AI-SYSTEM.md). Roteiro, geração de recursos, produção automatizada e preparação para publicação entram progressivamente após validação.

## Princípios do produto

- Originalidade e análise de referências sem presumir autorização para reutilizar seus materiais.
- Aprovação humana por revisão, rastreabilidade de fontes e licenças, limites de custo e recuperação de falhas.
- Observações, estimativas e hipóteses identificadas; métricas privadas de concorrentes não são presumidas disponíveis.
- Sem promessa de receita, monetização ou publicação automática.
- Memória operacional não substitui configurações oficiais: consulte as [fontes de informação](AI-SYSTEM.md#fontes-oficiais-e-memória-ativa).
- Identidade visual e experiência atuais preservadas; os critérios estão em [ARCHITECTURE.md](ARCHITECTURE.md#identidade-visual-e-equivalência).
- Funções locais essenciais independentes de nuvem. Windows local inicialmente; limites técnicos e evolução para Linux em [ARCHITECTURE.md](ARCHITECTURE.md).

## Referências

[Arquitetura](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Guias e histórico técnico](planejamento/README.md) · [Contexto original (histórico)](historico/contexto-original/README.md).

A versão anterior desta visão foi [preservada integralmente](historico/reorganizacao-2026-11-11/VISION-ANTES.md.txt) como registro histórico.
