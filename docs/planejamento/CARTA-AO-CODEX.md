# Carta ao próximo Codex

Você está retomando uma conversa de planejamento de 2026-11-10. O usuário preparou este material em uma máquina secundária para continuar na principal. Ele quer continuidade e execução objetiva, mas **a implementação da plataforma ainda não foi aprovada**.

**Leia primeiro [STACK-LOCAL.md](STACK-LOCAL.md).** A direção oficial agora é React/TypeScript + Tauri 2, Rust restrito a integrações nativas, FastAPI e SQLite. A prova de conceito será local no Windows, sem VPS. Preserve rigorosamente o design do desktop audiovisual; não recuperar a navegação antiga do Storybook como referência principal. O plano está registrado para aprovação; não iniciar instalação ou implementação por causa do commit.

## Leia antes de agir

O layout audiovisual Avalonia foi incorporado à branch principal, preservando a stack local planejada. Leia [a referência visual](../layout-desktop.md) para a migração sem redesign. Isso não implementa Tauri/FastAPI nem integrações operacionais.

1. `AGENTS.md` e `docs/architecture.md` deste repositório.
2. [Visão atual](VISAO.md), [diagnóstico](DIAGNOSTICO.md) e [plano](PLANO.md).
3. [Memória da conversa](CONVERSA.md) para não reviver propostas substituídas.
4. Instruções próprias da fábrica e dos estudos antes de trabalhar neles.
5. [Arquitetura híbrida](ARQUITETURA-HIBRIDA.md) e [memória ativa](MEMORIA-ATIVA.md), acrescentadas a partir do resumo DOCX do usuário. VPS, armazenamento e integrações especializadas são intenções a validar. O primeiro teste pode continuar inteiramente no PC, sem contratar VPS.
6. [Contratos](CONTRATOS.md) e [validação](VALIDACAO.md): exemplos são sintéticos, contratos são rascunhos e cenários de testes não foram executados. Usar o modelo de relatório para documentar a inspeção real.

## O que o usuário escolheu

Hórus será uma plataforma audiovisual construída sobre Hermes Agent, sem fork inicial. Hermes é o motor de inteligência e orquestração. A fábrica Python continua independente e seu CLI permanece funcional sem agentes ou interface. Claude Code/Codex são ferramentas de desenvolvimento e supervisão, não serviços obrigatórios da operação final.

**Não duplicar a inteligência/orquestração do Hermes ou o motor da fábrica.** Na nova stack, FastAPI será responsável pelas regras e pelo estado técnico das tarefas, enquanto Hermes coordena agentes por interfaces externas. Não confundir supervisão persistente de subprocessos com criar outro agente autônomo.

A ordem inicial foi revista: o usuário autorizou o layout desktop e depois definiu uma prova de conceito da nova stack, com equivalência visual e sem redesign. O diagnóstico do Hermes instalado continua necessário antes de integrá-lo. Não presumir recursos do upstream disponíveis localmente.

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
