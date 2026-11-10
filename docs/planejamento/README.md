# Continuidade do Hórus audiovisual

Registro em 2026-11-10. Estado: planejamento, sem implementação da integração.

**Comece pela [carta ao próximo Codex](CARTA-AO-CODEX.md).**

**Decisão mais recente:** [stack local e migração sem redesign](STACK-LOCAL.md). React/TypeScript, Tauri 2, Rust mínimo, FastAPI e SQLite são a direção oficial. Não utilizar VPS nesta etapa. A implementação depende de aprovação do incremento.

## Documentos

- [Stack local](STACK-LOCAL.md): auditoria, arquitetura, preservação visual, dependências, prova de conceito e critérios de validação vigentes.

- [Visão e decisões](VISAO.md): direção escolhida pelo usuário e limites de autorização.
- [Diagnóstico](DIAGNOSTICO.md): evidências locais, pesquisa do Hermes e questões ainda abertas.
- [Plano de aplicação](PLANO.md): tarefas, critérios de aceite e inspeção na máquina principal.
- [Memória da conversa](CONVERSA.md): evolução das decisões e orientações substituídas.
- [Arquitetura híbrida](ARQUITETURA-HIBRIDA.md): proposta histórica VPS–PC, substituída pelo escopo local; preservar como histórico.
- [Memória ativa](MEMORIA-ATIVA.md): fontes oficiais, evidências e validação de aprendizados.
- [Mapa de contratos](CONTRATOS.md): direções de comunicação e especificação externa da fábrica.
- [Plano de validação](VALIDACAO.md): cenários de falha, portões de aceite e modelo do relatório local; testes ainda não executados.
- [Fonte recebida](fontes/RESUMO-ARQUITETURA-MEMORIA-ATIVA.md): texto extraído do DOCX fornecido, com hash de origem; não confundir relatos com auditoria.

## Repositórios

| Repositório | Papel |
|---|---|
| [horus](https://github.com/yannbastos/horus) | Aplicativo existente e referência central deste planejamento |
| [fabrica-canais](https://github.com/yannbastos/fabrica-canais) | Motor Python/CLI e Remotion, independente |
| [estudos-videos-claude](https://github.com/yannbastos/estudos-videos-claude) | Fontes, transcrições e resumos existentes |
| [horus-storybook](https://github.com/yannbastos/horus-storybook) | Laboratório visual React/Storybook |
| [hermes-agent](https://github.com/NousResearch/hermes-agent) | Dependência externa; não criar fork nesta etapa |

O pacote inicial foi incorporado às branches principais dos quatro repositórios. O layout audiovisual permanece em `feat/layout-desktop-audiovisual`. Os históricos foram mantidos separados; nenhuma migração para monorepo foi aprovada.

## Como interpretar a documentação existente

`docs/architecture.md` descreve o aplicativo implementado. A visão e o roadmap anteriores descrevem sua origem como ferramenta de estudos. A nova direção audiovisual está em `VISAO.md`; isso não transforma funcionalidades planejadas em existentes nem autoriza reescrita do aplicativo.

Este pacote é uma síntese revisada do contexto disponível, não uma exportação literal do chat. Não contém configurações privadas, credenciais, mídia ou transcrições de raciocínio interno.
