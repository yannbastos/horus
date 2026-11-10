# Memória da conversa de planejamento

Registro preparado em 2026-11-10 a pedido do usuário para transferir contexto pelo GitHub. **É uma síntese, não uma transcrição literal ou exportação integral do chat.** Preserva decisões e limites úteis; omite metadados privados e detalhes desnecessários do ambiente.

## Sequência e mudanças de direção

1. O usuário pediu `git pull origin master` no HORUS App. A atualização foi fast-forward de `439b6f4` para `adb6383`. Depois pediu para iniciar o app. Naquela sessão ele foi compilado com o SDK instalado na pasta do usuário e iniciado. Isso não comprova configuração da outra máquina nem testes de integração futuros.
2. O usuário pediu análise de HORUS, fabrica-canais e estudos-videos-claude. A leitura mostrou complementaridade entre interface/transcrição, motor de produção e base de conhecimento. O Storybook apareceu como referência visual adicional.
3. O usuário propôs unir as ideias em um produto com orquestração. O assistente sugeriu inicialmente Avalonia/C# com Python/Remotion e depois núcleo Python/web. **Essas alternativas não foram a decisão final.**
4. O usuário apresentou o prompt “Fábrica de Conteúdo 2.0”, exigindo auditoria e planejamento, sem implementar. Incluía Radar, análise IA, produção em lote, web, memória e expansão. A auditoria identificou lacunas de licenciamento, pacote, aprovações, orçamento e mineração.
5. O usuário esclareceu a arquitetura escolhida: **Hórus como plataforma de inteligência audiovisual sobre Hermes Agent, sem fork inicial; fábrica independente; integrações externas preferidas.** Essa decisão substitui as propostas anteriores de criar o orquestrador completo do zero.
6. O usuário definiu módulos: Radar; análise audiovisual; planejamento editorial; produção; canais; analytics/aprendizagem; memória operacional. Publicação manual inicialmente, originalidade e aprovação humana preservadas.
7. Foi acordado que a primeira entrega deve ser diagnóstico Hermes–fábrica, não interface nova. Avaliar estado oficial de jobs, controles e recuperação sem duplicar capacidades já oferecidas pelo Hermes.
8. O usuário informou estar fora da máquina principal e que não pode baixar Hermes nesta máquina. Pediu organizar a aplicação futura. O assistente propôs inspeção documental remota e roteiro local posterior.
9. O usuário forneceu `https://github.com/NousResearch/hermes-agent.git`. A pesquisa via web encontrou skills externas, MCP, API HTTP e cron documentados. A instalação real e a versão compatível continuam desconhecidas.
10. Por fim, o usuário autorizou subir o material disponível ao GitHub e escrever cartas para o Codex ter contexto, inclusive o conteúdo útil deste chat. A preparação publica documentação nos remotos existentes, preservando código e mídia.

## Pontos do prompt original que continuam válidos

- Modularidade, baixo acoplamento e reaproveitamento do CLI.
- Perfil editorial em YAML; conhecimento durável em Markdown/Git.
- Orçamentos, rastreabilidade, recuperação e proteção contra duplicações.
- Separar fatos observáveis, alegações de autores e hipóteses da IA.
- Sem retenção privada de concorrentes ou promessa de receita.
- Um canal e um render; longos/cortes precisam de validação própria antes do segundo canal.
- Não presumir recursos de API ou extensão sem verificar.

## Correções e limites importantes

- A separação antiga “Hermes apenas tarefas recorrentes, Claude produz tudo” foi ampliada: Hermes será o agente principal e poderá coordenar produção por interfaces autorizadas quando validado.
- “Fábrica executa roteiro, legendas e checklist” descreve o destino pretendido; nem tudo está implementado.
- A documentação antiga tem caminhos de outra máquina e mistura fases de validação da fábrica com fases da plataforma. Interpretar pelo contexto, sem renumerar históricos.
- O upstream consultado é mutável. Conferir versão e contratos na máquina principal antes de implementar API/MCP/cron.
- O upload de contexto não autoriza chamadas pagas ou implementação automática na próxima sessão.

## Continuação — documento de memória ativa e preparação remota

11. O usuário forneceu `Horus_Resumo_Arquitetura_Memoria_Ativa.docx`. O texto acrescenta intenção de Hermes em VPS, produção no PC, armazenamento local e memória ativa. Também menciona Claude/Codex/Antigravity e Epidemic Sound como possibilidades a investigar. O arquivo não comprova contratação, instalação ou integração. Seu texto foi preservado em [fontes](fontes/RESUMO-ARQUITETURA-MEMORIA-ATIVA.md), com hash de origem.
12. O assistente apontou que relatos de licenças e skills funcionais precisam ser confrontados com as lacunas reais já auditadas; propôs preparar arquitetura híbrida, contratos, memória, custos e cenários de falha sem instalar serviços.
13. O usuário autorizou iniciar essa preparação e fazer commits e pushes progressivos nos projetos. O incremento em andamento é documental e não modifica Hermes, motor da fábrica, fontes de estudo ou interface.

## Pergunta operacional que guia a retomada

Qual é o menor caminho comprovado para o Hermes instalado consultar e, futuramente, operar a fábrica independente, mantendo aprovações, licenças, custos e resultados rastreáveis, sem modificar o core do Hermes?

As evidências estão em `DIAGNOSTICO.md`; a próxima ação está em `PLANO.md` e `CARTA-AO-CODEX.md`.
