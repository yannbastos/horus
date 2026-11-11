# Plano de aplicação na máquina principal

> **Classificação documental — 2026-11-11:** Plano anterior preservado para dependências e critérios. [ROADMAP](../ROADMAP.md) define a ordem atual; [ARCHITECTURE](../ARCHITECTURE.md) já resolve stack, operação local e fronteiras. VPS–PC e consolidação de repositórios não estão autorizadas. A lista final de decisões abertas deve ser lida à luz dessas resoluções; não constitui ordem para reabri-las.

> **Atualização de direção:** [STACK-LOCAL.md](STACK-LOCAL.md) define a stack e a prova de conceito atuais. A primeira etapa é local, sem VPS e sem redesign. As fases e hipóteses abaixo são planejamento anterior; aplicar somente o que for compatível com essa decisão mais recente.

Estado: proposta executável, não autorização de implementação. Leia `VISAO.md` e `DIAGNOSTICO.md`.

Preparação ampliada pelo resumo DOCX: [arquitetura híbrida](ARQUITETURA-HIBRIDA.md), [contratos](CONTRATOS.md), [registros operacionais](MEMORIA-ATIVA.md) e [cenários de validação/relatório](VALIDACAO.md). A intenção VPS–PC não torna uma VPS pré-requisito para o diagnóstico ou a primeira consulta local.

## Primeira sessão: somente diagnóstico

1. Localizar os quatro repositórios e registrar branch, commit e alterações locais. Estes documentos foram publicados na branch `docs/planejamento-horus-hermes-2026-11-10`; conferir sua disponibilidade antes de trocar de branch. Nunca descartar alterações locais.
2. Ler instruções de cada repositório. Não imprimir `.env`, tokens, cookies ou configuração completa com segredos.
3. Inspecionar ferramentas existentes, sem instalar ou atualizar:

```powershell
Get-Command hermes, fabrica, uv, node, ffmpeg -ErrorAction SilentlyContinue |
    Select-Object Name, Source
hermes --version
hermes --help
hermes status
fabrica --help
fabrica perfil mostrar --canal canal01 --formato json
```

Os comandos do Hermes são os documentados no upstream consultado. Se algum não existir, registrar a diferença; não iniciar reparos. Inspecionar a implementação local antes de executar comandos de diagnóstico desconhecidos. Não usar `doctor --fix`, `setup.ps1`, instaladores, `uv run` que prepare ambiente ou atualização automática nesta sessão.

4. Identificar instalação nativa/WSL, perfil ativo e configuração efetiva; consultar apenas campos necessários e mascarar segredos. Registrar versão/commit e confrontar com documentação correspondente.
5. Confirmar o ambiente em que o terminal do Hermes executa: PATH, diretório, interpretador e acesso aos arquivos. Um comando funcionar no PowerShell do operador não prova que funciona dentro do agente.
6. Verificar no código/ajuda local os contratos de skills, MCP, API, cron, acompanhamento e cancelamento disponíveis. Não ativar serviços ou alterar configuração durante o diagnóstico.
7. Entregar matriz de compatibilidade, bloqueios, mudanças propostas, diff de configuração futuro e critérios de teste. Pedir aprovação para o incremento concreto.

## Primeiro teste, somente após aprovação

Tarefa: Hermes consulta `fabrica perfil mostrar --canal canal01 --formato json` e devolve relatório fiel, distinguindo configurações e pendências.

- Não chamar ElevenLabs, buscar assets, renderizar ou enviar Telegram.
- O modelo do Hermes pode ter custo; acordar limite antes do teste.
- `fc-piloto` não é o teste correto sem adaptação: envia uma mensagem externa.
- Começar com CLI/skill se suficiente. Adicionar adaptador MCP só quando demonstrar utilidade.
- Conferir código de saída, stdout estruturado, stderr, Unicode, caminhos com espaços e falha simulada do comando.
- Aceite: resultado rastreável, erro explícito, arquivos intactos, sem ações externas além da inferência autorizada.

## Roadmap

Esforço relativo: P pequeno, M médio, G grande. Não são prazos. Todo teste de rede, inferência ou serviço pago requer escopo e orçamento acordados.

| Fase/tarefa | Dependências e módulos | Esforço/risco | Aceite e verificação |
|---|---|---|---|
| 0A Diagnóstico local | Instalação Hermes e quatro repos | P; diferenças de versão | Matriz com versão, ambiente, contratos e bloqueios; nenhuma mudança operacional |
| 0B Consolidar fábrica | `modelos`, `publicar`, `visual`, `voz`, Canal 01 | M; liberação indevida/custos | Licença não verificada, override não registrado, teste e falta de aprovação bloqueados; testes de regressão |
| 0C Pacote completo e primeiro Short | 0B; checklist, legendas, metadados, thumb | M; qualidade | Pacote contém itens exigidos; revisão humana; render e áudio conferidos; registro de custo |
| 0D Validar 5–10 Shorts | 0C e decisões editoriais | M; tempo e repetibilidade | Qualidade aceita e tempo/custo compatíveis com rotina, sem usar views como prova da fábrica |
| 1A Radar: permissões e coleta | Políticas API, `minerar`, cliente YouTube | M; cota e dados | Validação de candidatos, paginação, dados ausentes e limites testados com fixtures |
| 1B Radar: descoberta e relatório | 1A, persistência necessária | M; amostragem | Candidatos reais, origem/data e limites claros; cálculos/históricos apenas quando permitidos |
| 2 Integração Hermes | 0A; CLI/skills, depois MCP/API se necessário | M; compatibilidade | Teste de leitura aprovado, relatório e falhas rastreáveis, sem fork |
| 3 Análise e planejamento | 1 e 2 | M; alucinação/cópia | Briefing com fontes, observações separadas de hipóteses e aprovação por versão |
| 4 Produção gerenciada | 0B–0D, 2 e 3 | G; duplicação/cobrança | Fila persistente, um render, retomada, orçamento, invalidação de dependências; testes de interrupção |
| 5 Interface | Contratos validados da fase 4 | G; escopo | Consultar oportunidades, produções e aprovações sem duplicar motor; testes de fluxos |
| 6 Analytics e histórico operacional | Canais próprios autorizados, execuções rastreadas | M; conclusões frágeis | Custos por tentativa, experimentos, dados ausentes/revogação tratados e memória revisável |
| 7 Automação avançada | Shorts e longos do Canal 01 validados | G; ampliação prematura | Agendamentos sem duplicação; isolamento por canal; publicação automática requer aprovação separada |

Antes do segundo canal, criar uma tarefa explícita para longo e cortes: composição 16:9, narração em blocos se necessária, legendas, cortes com ganchos, revisão de sincronismo, tempo e custo. Essa capacidade não existe hoje.

## Modelo operacional proposto, a confrontar com Hermes

Separar etapa (briefing, roteiro, voz, alinhamento, assets, render, checklist, pacote) de estado (pendente, executando, aguardando aprovação, pausado, bloqueado, falhou, concluído, cancelado).

Reutilizar acompanhamento e agendamento do Hermes quando compatíveis. Guardar apenas o estado de domínio necessário no Hórus/fábrica; não usar histórico de conversa como única prova de aprovação ou cobrança. Definir explicitamente um único dono de cada estado para evitar dois orquestradores concorrentes.

Proposta de registros: ID de produção, execução/tentativa, entradas e suas versões, artefatos, aprovações, eventos, custos e resultado externo conhecido/desconhecido. Considerar SQLite sem introduzir fila distribuída.

Interromper um agente não equivale a encerrar subprocessos. Testar pausa entre etapas, cancelamento real, reinício, disputa de dois executores e retorno de chamada paga interrompida. Não prometer execução exatamente uma vez em APIs externas.

## Caminhos críticos

- Primeiro vídeo: Canal 01 → pauta/roteiro aprovados → voz conferida/alinhada → assets verificados → render → checklist → revisão → pacote → postagem manual. Não depende de Radar ou dashboard.
- Radar: permissões → candidatos conhecidos → descoberta → cache/armazenamento permitido → relatório e classificação autorizada.
- Integração: diagnóstico da versão → chamada de leitura → resultado/erro estruturado → aprovação da evolução. Não depende de fork.

## Decisões ainda necessárias

Stack e interface final; destino do Avalonia; repositório principal e eventual consolidação; versão-alvo do Hermes; contratos e local do estado oficial; orçamento de inferência/produção; definição editorial do Canal 01. Não tratar essas decisões como aprovadas pelo simples upload deste plano.
