# Carta ao próximo Codex

Você está retomando uma conversa de planejamento de 2026-11-10. O usuário preparou este material em uma máquina secundária para continuar na principal. Ele quer continuidade e execução objetiva, mas **a implementação da plataforma ainda não foi aprovada**.

## Leia antes de agir

1. `AGENTS.md` e `docs/architecture.md` deste repositório.
2. [Visão atual](VISAO.md), [diagnóstico](DIAGNOSTICO.md) e [plano](PLANO.md).
3. [Memória da conversa](CONVERSA.md) para não reviver propostas substituídas.
4. Instruções próprias da fábrica e dos estudos antes de trabalhar neles.

## O que o usuário escolheu

Hórus será uma plataforma audiovisual construída sobre Hermes Agent, sem fork inicial. Hermes é o motor de inteligência e orquestração. A fábrica Python continua independente e seu CLI permanece funcional sem agentes ou interface. Claude Code/Codex são ferramentas de desenvolvimento e supervisão, não serviços obrigatórios da operação final.

**Não implementar agora um orquestrador próprio completo em C# ou Python.** Essa foi uma proposta anterior do assistente, substituída pela decisão do usuário de avaliar e aproveitar Hermes. Uma camada persistente de regras/aprovações pode ser necessária, mas deve ser justificada pelo diagnóstico real.

O usuário não quer começar pela interface. Sua primeira entrega é o diagnóstico Hermes–fábrica, baseado na instalação principal. Não presumir recursos do upstream disponíveis na versão instalada.

## Primeira resposta e ação esperadas

Explique brevemente que vai inspecionar versões, ambiente e contratos sem mudanças. Faça o diagnóstico de leitura descrito em `PLANO.md`. Não pare apenas em uma proposta de plano se a inspeção já estiver autorizada, mas não avance para instalações ou implementação.

Entregue: o que funciona, o que falta, evidências, diferenças de versão, o menor incremento revisável e o diff de configuração proposto, se necessário. Só depois peça aprovação para implementar.

## Cuidados de continuidade

- Há quatro repositórios separados. Não fundir, mover ou criar remoto sem necessidade e autorização.
- A visão antiga de estudos e o roadmap original não representam a nova direção de produto; o código Avalonia continua existente e deve ser preservado.
- A base `knowledge/` e as transcrições dos estudos não devem ser editadas.
- Não imprimir segredos nem enviar configuração bruta ao GitHub.
- `fc-piloto` manda Telegram; não rodar como se fosse leitura.
- Não executar geração ElevenLabs, render, cron, publicação ou mensagens externas na auditoria.
- As autorizações de commit/push desta preparação não devem ser interpretadas como aprovação genérica de futuras alterações.
- A branch com este pacote é `docs/planejamento-horus-hermes-2026-11-10`; conferir o estado do Git antes de qualquer checkout/pull.

## Prompt curto que o usuário pode reutilizar

> Leia `docs/planejamento/CARTA-AO-CODEX.md` no repositório horus e os documentos vinculados. Faça somente o diagnóstico local da integração Hermes–fábrica na minha máquina principal. Não instale, atualize, altere configurações, implemente funcionalidades, envie notificações ou execute chamadas pagas. Preserve alterações locais e não exponha credenciais. Apresente evidências, compatibilidade e a proposta concreta do primeiro teste de leitura para minha aprovação.
