# Hórus — visão e decisões de produto

Fonte: decisões expressas pelo usuário na conversa de 2026-11-10. Estado: planejamento arquitetural.

**Atualização vigente:** a stack e a migração local estão em [STACK-LOCAL.md](STACK-LOCAL.md). React/TypeScript + Tauri 2, Rust apenas nativo, Python/FastAPI e SQLite foram definidos pelo usuário. Sem VPS nesta etapa e sem mudança de design. O código implementado continua Avalonia até migração aprovada e validada.

## Direção escolhida

Hórus será uma plataforma de inteligência audiovisual para pesquisar, estudar, planejar, produzir e acompanhar conteúdos digitais. Hermes Agent será seu motor de inteligência e orquestração, por integrações externas, **sem fork ou alteração de seu código-fonte inicialmente**.

A fábrica Python continua sendo um motor independente. Seu CLI `fabrica` deve funcionar sem interface gráfica, sem Hermes e sem Claude Code ou Codex permanentemente abertos.

O produto se inspira conceitualmente em descoberta de oportunidades, análise de canais, moldes e automação audiovisual, sem copiar outra ferramenta. Qualidade, conteúdo original, rastreabilidade e controle editorial prevalecem sobre volume.

## Responsabilidades

| Componente | Responsabilidade |
|---|---|
| Hórus | Interface, regras de negócio, canais, ideias, aprovações, acompanhamento de produções, custos e relatórios |
| Hermes | Pesquisa autônoma, raciocínio, uso de ferramentas, skills, memória contextual, tarefas recorrentes e coordenação autorizada |
| Fábrica | Execução técnica: voz, alinhamento, assets, composição, render, validação e pacote, conforme capacidades efetivamente implementadas |
| Estudos | Conhecimento inicial baseado nas referências preservadas, com fontes e distinção entre fato, opinião e alegação |
| Storybook | Identidade visual e componentes de referência, sem presumir funcionalidades operacionais |
| Claude Code e Codex | Desenvolvimento, testes, documentação e supervisão; produção interativa pode continuar na transição |

Preparação de roteiro, legendas exportáveis e verificações completas são objetivos da fábrica, mas não devem ser apresentados como já concluídos sem inspeção.

## Módulos do produto

1. Radar: descoberta de vídeos e canais, observações, filtros e oportunidades.
2. Análise audiovisual: narrativa, gancho, ritmo, títulos, thumbnails e, futuramente, análise validada de cenas.
3. Planejamento editorial: ideias originais, briefings, títulos, conceitos de thumbnail e aprovações.
4. Produção: conexão com a fábrica, fila, revisões, renders e arquivos finais.
5. Gestão de canais: perfis editoriais e identidade de cada canal.
6. Analytics e aprendizagem: dados próprios autorizados, custos, experimentos e resultados.
7. Memória operacional: decisões, erros, soluções validadas e feedback rastreável.

## Fluxo pretendido

Descoberta → análise → seleção humana → planejamento → aprovação → produção → controle de qualidade → revisão humana → publicação manual → aprendizagem.

Aprovações devem identificar a versão revisada. Alterações nas entradas precisam invalidar resultados dependentes. Estados e custos importantes devem sobreviver a reinicializações. A localização e a implementação desse registro ainda serão decididas após avaliar o Hermes instalado.

O agente não pode dispensar bloqueios de licença, orçamento ou aprovação simplesmente por interpretar uma instrução como autorização. Essas regras devem ser aplicadas nas operações correspondentes.

## Diretrizes aprovadas

- Reutilizar o CLI, componentes e skills existentes; não criar outro motor de voz ou render.
- Preservar a possibilidade de atualizar Hermes sem reaplicar alterações internas.
- Manter `perfil.yaml` como fonte oficial das configurações editoriais.
- Markdown e Git para conhecimento durável; persistência estruturada para execuções e métricas quando necessária.
- Obsidian opcional; sem banco vetorial ou infraestrutura distribuída antecipada.
- Um canal inicialmente e um render simultâneo; segundo canal somente após validar Shorts e longos do primeiro.
- Não tratar resultados de poucos vídeos como prova de sucesso comercial ou causalidade.
- Não alegar retenção privada de concorrentes; separar métricas, estimativas e hipóteses.
- Verificar políticas e permissões vigentes antes de implementar coleta, indicadores e históricos.
- Publicação inicialmente manual; automação é posterior.

## Hipóteses que ainda não são decisões de implementação

O documento de referência acrescentava uma intenção VPS–PC. Essa parte foi substituída pelo escopo local de [STACK-LOCAL.md](STACK-LOCAL.md). A arquitetura híbrida permanece histórica. Armazenamento, serviços de áudio e agentes especializados não devem ser presumidos contratados, disponíveis ou integrados.

- React/TypeScript, Tauri 2, Rust mínimo, FastAPI e SQLite são a direção definida, ainda sem implementação. Avalonia será preservado durante a validação; sua remoção não foi autorizada.
- MCP e servidor HTTP são candidatos de integração, condicionados à versão instalada.
- Usar a persistência de execuções do Hermes e adicionar somente os registros de domínio necessários é uma proposta a investigar.
- Não há autorização para fundir repositórios, reescrever transcrição em Python, remover Avalonia ou criar infraestrutura nova.

## Autorização e ambiente

O usuário estava fora da máquina principal e proibiu baixar ou instalar Hermes nesta máquina. Autorizou publicar documentos e contexto nos repositórios existentes. **Isso não autoriza a implementação da plataforma, instalação de dependências, alterações no Hermes, chamadas pagas, mensagens externas ou publicação de vídeos.**

Na continuação, autorizou iniciar a preparação da arquitetura híbrida, contratos, memória e critérios de teste, com commits e pushes progressivos nas branches de planejamento. O escopo deste incremento permanece documental; integrações executáveis precisam de proposta concreta e aprovação.

A primeira entrega na máquina principal deve ser um diagnóstico da integração real. Apresentar o planejamento e obter aprovação antes de implementá-lo.
