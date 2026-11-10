# Diagnóstico preliminar — integração Hórus, Hermes e fábrica

Data: 2026-11-10. Método: leitura de arquivos locais e consulta web à documentação e ao código público. Nenhuma instalação do Hermes foi inspecionada nesta etapa. Não foram executados testes de integração nem chamadas pagas.

## Referências locais auditadas

| Repositório | Commit-base | Situação observada |
|---|---|---|
| horus | `adb6383` | C#/Avalonia/.NET 10, download YouTube e transcrição; testes de fila e interface |
| fabrica-canais | `51e6658` | CLI Python, perfis, ElevenLabs, stable-ts e render Remotion de short |
| estudos-videos-claude | `27c1269` | 13 fontes com transcrições, resumos e índices, sem timestamps |
| horus-storybook | `b03f90a` | Catálogo React/Storybook com dados demonstrativos |

Os diretórios locais foram reorganizados durante a conversa. Não transportar caminhos absolutos da máquina de preparação para a principal. As pastas locais de HORUS Web estavam vazias.

## Fábrica: capacidade encontrada e lacunas

| Capacidade | Estado | Evidência |
|---|---|---|
| Perfil e roteiro | Implementada | `scripts/fabrica/modelos.py`, `perfil.py`, YAML validado por Pydantic |
| Voz ElevenLabs | Implementada, não retestada | `voz.py`, `elevenlabs.py`; decisões mais recentes removem provedores locais |
| Conferência e alinhamento | Implementada, não retestada | `verificar.py`, `voz.py`; stable-ts/Whisper |
| Busca visual | Parcial | `visual.py`: fotografias Pexels/Pixabay, folha de candidatos e escolha |
| Render | Parcial | `render.py`: somente `Short9x16`; Remotion com imagem, movimento e legenda |
| Pacote | Parcial | `publicar.py`: vídeo, manifesto e créditos; não é upload |
| Mineração | Ausente | `minerar.validar()` lança `NaoImplementado` |
| Skills operacionais | Parcial | Encontrada `skills/fc-piloto/SKILL.md`, não o pipeline completo |
| Avisos Hermes | Parcial | `avisar.py` chama `hermes send`; entrega local não confirmada |
| Jobs, orçamento e aprovações por versão | Ausentes no motor auditado | Sem registro operacional central encontrado |
| Checklist final, SRT, metadados, thumbnail e longos | Incompletos/ausentes | Não presumir implementados pelos nomes do planejamento |

Os JSONs históricos de testes de voz são evidência de experimentos anteriores, não testes executados nesta auditoria. Não foi encontrada suíte de regressão da fábrica equivalente à do aplicativo.

## Bloqueios concretos a confirmar e corrigir após aprovação

1. `modelos.Asset.publicavel` tem padrão verdadeiro. `publicar.checar_licencas()` exige verificação explícita de licença apenas para narração. Não garante a regra de bloquear qualquer asset não verificado.
2. `visual_override` permite referenciar imagem sem assegurar correspondência com manifesto. O checklist deve conferir os arquivos realmente usados no render.
3. `elevenlabs.licenca()` pode recorrer ao plano informado no ambiente quando não confirma o plano real; isso pode liberar como comercial uma situação não verificada.
4. `publicar.empacotar()` apenas avisa sobre ausência de metadados/SRT/thumbnail; mesmo existentes, esses itens não são copiados. Não verifica aprovação de roteiro/final ou marca de teste.
5. Retentativas de voz podem gerar custo sem orçamento por job. Resultado remoto desconhecido após falha não deve ser repetido automaticamente.
6. `narracao.velocidade` existe no perfil, mas não é encaminhada pela geração examinada.
7. Perfil do Canal 01 e guias editoriais estão incompletos. Referências a caminhos de outra máquina existem na documentação antiga.
8. `perfil.pasta_canal()` e `pasta_video()` concatenam identificadores; antes de expor entradas a HTTP/MCP, exigir validação de identificadores e confinamento dos caminhos à raiz autorizada.

## Hermes: confirmado no upstream consultado

As referências abaixo apontam para documentação atual e branch `main`, não para um commit imutável. Não foi estabelecida a versão mínima de cada recurso. Registrar versão/commit real na máquina principal antes de escolher contratos.

| Mecanismo | Evidência | Aplicação candidata |
|---|---|---|
| Skills externas | [Skills System](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills), `skills.external_dirs` | Compartilhar skills versionadas fora do Hermes |
| MCP externo | [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp), [cliente no código](https://github.com/NousResearch/hermes-agent/blob/main/tools/mcp_tool.py) | Ferramentas específicas sem alterar core; stdio/HTTP conforme suporte |
| API do agente | [API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), [adaptador no código](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/api_server.py) | Hórus solicita análises e acompanha execuções |
| Execuções e controles | Mesma documentação da API: `/v1/runs`, interrupção, capabilities e resolução de aprovação | Avaliar reutilização antes de criar infraestrutura equivalente |
| Agendamento | [Cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron) | Pesquisa/relatórios recorrentes; verificar gateway e persistência |
| CLI de inspeção | [CLI Commands](https://hermes-agent.nousresearch.com/docs/reference/cli-commands) | Versão, ajuda, status e recursos da instalação |

Distinções fundamentais:

- API HTTP é a direção **Hórus → Hermes**; ferramentas MCP/CLI são **Hermes → Hórus/fábrica**.
- Skill é procedimento, não garantia de permissão ou persistência.
- Diretório externo de skills não é proteção contra escrita; a documentação permite atualização pelo agente conforme permissões. Revisar proteção dos documentos compartilhados.
- Aprovação de chamada de ferramenta não substitui a aprovação editorial vinculada ao roteiro.
- Interromper um turno do agente não comprova que ffmpeg, Remotion ou uma chamada externa foram cancelados. Testar propagação do cancelamento.
- Documentação recente descreve recursos que podem não existir na instalação antiga. Não atualizar automaticamente para resolver diferenças.

## Radar e políticas externas

Não implementar a partir de pressupostos históricos de cotas. O contrato antigo em `minerar.py` inclui custos que precisam ser reconferidos.

- `regionCode` não prova nacionalidade do criador; `relevanceLanguage` não garante idioma exclusivo: [search.list](https://developers.google.com/youtube/data/reference/rest/v3/search/list).
- Indicadores derivados e armazenamento histórico ampliado podem depender de aprovação do caso de uso: [guia de políticas](https://developers.google.com/youtube/terms/developer-policies-guide) e [métricas derivadas](https://developers.google.com/youtube/terms/derived-metrics-policy).
- Analytics de canais próprios exige autorização apropriada: [Channel Reports](https://developers.google.com/youtube/analytics/channel_reports).
- Licença de asset não garante monetização do canal: [políticas de monetização](https://support.google.com/youtube/answer/1311392).

Essas fontes foram consultadas na conversa; regras precisam ser reconferidas no momento da implementação. O MVP pode ter escopo reduzido se uma capacidade depender de autorização.

## Questões abertas na máquina principal

Versão do Hermes, método de instalação, Windows/WSL, perfil ativo, terminal backend, visibilidade do CLI da fábrica, provedor/modelo e limites de gasto, caminhos dos repositórios, configuração de skills, MCP/API, gateway, comportamento após reinício e limitações de dependências Python.

Nenhuma credencial precisa ser publicada para responder a essas questões.
