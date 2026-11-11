# Planejamento do Hórus audiovisual

O Hórus tem foco exclusivo em inteligência e operação audiovisual. A implementação incremental da stack local foi autorizada; o estado comprovado está no [guia de migração](../migracao-local.md).

## Documentos vigentes

- [Continuidade técnica](CARTA-AO-CODEX.md): contexto e próximos passos para agentes.
- [Visão do produto](../vision.md): escopo audiovisual e limites.
- [Stack local](STACK-LOCAL.md): planejamento técnico e auditoria inicial.
- [Diagnóstico](DIAGNOSTICO.md): evidências da fábrica e questões da integração Hermes.
- [Plano](PLANO.md): tarefas, dependências e critérios.
- [Registros operacionais](MEMORIA-ATIVA.md): decisões, revisões e rastreabilidade da produção.
- [Contratos](CONTRATOS.md) e [validação](VALIDACAO.md): propostas de integração externa, sujeitas à versão real das ferramentas.
- [Decisões vigentes](CONVERSA.md): síntese das orientações do operador.

[Arquitetura híbrida](ARQUITETURA-HIBRIDA.md) é uma hipótese histórica substituída pela operação local. Não implementá-la com base nesse documento.

## Componentes independentes

| Repositório | Papel |
|---|---|
| [Hórus](https://github.com/yannbastos/horus) | Aplicativo e regras da operação |
| [Fábrica](https://github.com/yannbastos/fabrica-canais) | Motor Python/CLI e Remotion |
| [Storybook](https://github.com/yannbastos/horus-storybook) | Referências visuais audiovisuais |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Inteligência externa futura, sem fork inicial |

Nenhuma migração para monorepo está autorizada. Não confundir contratos propostos com endpoints implementados. Preservar dados do operador, aprovações e controles de licença/custo.
