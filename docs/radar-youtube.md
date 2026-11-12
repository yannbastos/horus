# Núcleo isolado do Radar YouTube

Estado em 12/11/2026: coletor validado com respostas simuladas e integração local com WorkflowService implementada no backend. A API oferece listagem, detalhe, demonstração fictícia e criação de workflow; veja [workflows editoriais](workflows-editoriais.md#radar-e-hermes-em-processo-m1). Nenhuma chamada real ao YouTube/Hermes, chave real ou migração operacional foi executada. A mineração da fábrica permanece independente.

## Interfaces e responsabilidades

Código: `backend/src/horus_backend/radar_youtube/`. Usa somente biblioteca padrão e Pydantic já disponível no backend, sem novas dependências.

- `CollectionRequest`: até 50 vídeos e 50 canais, pesquisa opcional, enriquecimento dos canais dos vídeos e até duas páginas opcionais de uploads por canal.
- `SearchRequest`: palavra-chave, tipo `video`/`channel`, `language`, `region`, período com timezone, ordem e duração quando aplicável. Entre uma e cinco páginas, até 50 resultados por página.
- `YouTubeCollector(transport, state).collect(request) -> Dataset`: execução síncrona, limitada e independente. Crie uma instância por invocação; a instância mantém contexto da coleta e não deve ser compartilhada entre threads.
- `transport.get(resource, params) -> dict`: ponto de substituição por fixtures. `GoogleTransport` implementa GET HTTPS somente em `search`, `videos`, `channels` e `playlistItems`; rede desligada por padrão, timeout de 15 segundos, sem redirecionamentos, respostas até 2 MB e erros sanitizados.
- `RadarState`: cache, contabilidade local e versões de datasets em arquivo **exclusivo** `radar-youtube.sqlite3`. Recusa outro nome, symlink de arquivo e bancos com tabelas desconhecidas. Não importa Store, JobManager, migrações ou configuração operacional.
- `opportunity_indicators(dataset, permission)`: relatório separado, sem alterar os dados da API.

Não existe segundo executor. O armazenamento isolado é de dados coletados/cache, não de jobs, aprovações ou workflow. O adapter `radar_workflow.py` consome revisões já persistidas; as novas rotas não acionam o coletor nem fazem pesquisa de rede.

IDs de vídeo, URLs HTTPS `watch`, `youtu.be`, `shorts`, `live`, `embed`, IDs de canal, `@handle` e URLs `channel`, `@handle`, `user` são aceitos. `/c/` não é resolvido por scraping. URLs externas, com credenciais, portas ou identificadores ambíguos são rejeitadas antes do transporte.

## Contrato de saída

`Dataset` tem `schema_version=radar.youtube.v1`, `snapshot_id`, `revision`, origem, pedido original, `collected_at`, `expires_at`, `status`, `records`, `issues`, limitações e consumo local separado em `search`/`details`.

Cada `PublicRecord` contém ID estável, tipo, URL canônica, endpoint de origem, horário de consulta e expiração. Campos públicos normalizados: título, canal, publicação, idioma informado, duração ISO/segundos, visualizações, likes e comentários; canais incluem inscritos, indicação de arredondamento, total de vídeos, país informado e playlist de uploads. Campos ausentes/inválidos são `null`, acompanhados de `unavailable`. Zero não é ausência. Inscritos ocultos permanecem indisponíveis. Retenção, CTR, dislikes privados e receita não são consultados nem inventados.

`complete` significa consulta concluída dentro da amostra solicitada, não cobertura integral do YouTube. `partial` contém dados e avisos/falhas; `failed` contém problemas e nenhum registro. Pesquisa vazia sem erro é válida. Limites de paginação produzem aviso. Ausência de um ID não distingue vídeo privado, removido ou outra indisponibilidade.

`refresh(snapshot_id, revision)` consulta novamente ignorando cache e salva revisão seguinte do mesmo pedido. Versões não podem ser sobrescritas. Nova pesquisa deve gerar outro snapshot. Falta de um recurso em consulta atual invalida cópias antigas gerenciadas que o referenciem; o histórico bruto não é imortal. Coletas e refreshes são serializados globalmente por arquivo de estado, inclusive entre processos, usando transação exclusiva em um SQLite auxiliar `radar-youtube.refresh-lock.sqlite3`, sem tabelas e sem mudança no schema de saída ou no estado existente. A trava global simplifica a proteção de cache, invalidação e revisões; pedidos diferentes também aguardam. A transação do estado não fica aberta durante HTTP, e reservas continuam atômicas em transações próprias. O sistema operacional libera a trava se o processo terminar; não apagar/substituir o arquivo auxiliar durante uso. Não há garantia de execução exatamente uma vez após crash entre HTTP e persistência. Chamadas repetidas de `refresh(id, revisão)` retornam o sucessor já salvo, inclusive quando a origem foi invalidada; para outra atualização, informar a revisão retornada. `collect(..., force_refresh=True)` sem revisão de origem continua sendo uma nova coleta explícita, que ignora cache.

Os modelos Pydantic também disponibilizam `model_json_schema()` para gerar contratos JSON sem dependência dos contratos Hermes.

## Limites, cache e retenção

A [tabela oficial de cotas](https://developers.google.com/youtube/data/determine_quota_cost), atualizada em 10/11/2026 e consultada em 11/11/2026, informa 100 chamadas diárias de `search.list` em bucket próprio, custo de uma unidade por chamada, e 10.000 unidades para os demais endpoints combinados. `videos.list`, `channels.list` e `playlistItems.list` custam uma unidade. Isso difere da regra histórica de 100 unidades por busca. Confirme sempre os limites efetivos do projeto no Google Cloud antes do uso real.

Padrões locais deliberadamente menores: 10 pesquisas e 200 consultas de detalhes por janela móvel de **26 horas**, máximo de 20 chamadas por coleta. A janela conservadora não reproduz o contador do Google nem seu reset à meia-noite do Pacífico; evita depender de tzdata adicional no Windows e cobre dias de 25 horas. Não contabiliza aplicações externas que compartilhem o mesmo projeto. Compartilhe o mesmo arquivo dedicado entre consumidores do Radar; criar vários arquivos não amplia a cota do Google.

Reservas são atômicas no SQLite, persistem entre processos e são feitas antes de cada tentativa, inclusive falhas. Não são devolvidas. Erros transitórios permitem uma única retentativa com espera de um segundo, respeitando todos os limites. Recusa de cota bloqueia o bucket local por 26 horas. Erros de autenticação/configuração interrompem a coleta; não há fallback para scraping. Paginação repetida é interrompida. IDs são deduplicados e consultas de detalhes agrupadas em até 50.

Cache padrão de seis horas, configurável até 24 horas, com projeção dos campos necessários. Cache hit não consome reserva, não renova o horário de origem nem prolonga a retenção do registro. Estatísticas podem estar desatualizadas; sempre exibir `retrieved_at`.

As [políticas de armazenamento, seção III.E.4](https://developers.google.com/youtube/terms/developer-policies) limitam o armazenamento de dados públicos não autorizados a 30 dias sem exclusão/atualização, conforme o tipo. Este núcleo adota **28 dias** para datasets e fontes, sem presumir direitos especiais. Um dataset vence junto com sua fonte mais antiga. O cache vence antes. `purge()` é a limpeza explícita, idempotente e transacional: remove cache e datasets com expiração menor ou igual ao relógio atual, reservas fora da janela de 26 horas e bloqueios vencidos. Inicialização, coleta e acessos também a executam, com `secure_delete` no SQLite gerenciado. Cada revisão tem TTL próprio: uma revisão ainda válida permanece mesmo quando outra expira; nenhuma revisão é removida só por existir sucessora. Não há referências persistidas ou pins no núcleo isolado: referências externas não prolongam os 28 dias nem impedem a invalidação documentada de recurso ausente. A futura integração deve tratar referências expiradas explicitamente, sem conservar conteúdo bruto além do TTL.

**Limitação operacional:** não há processo de limpeza em segundo plano enquanto o programa estiver fechado. Antes de coleta contínua/produção, integrar limpeza periódica ao JobManager existente e definir exclusão de exports, cópias, backups e relatórios. O TTL não garante apagamento de cópias externas nem autoriza versionar dados da API no Git. Não copiar este SQLite para o banco operacional. Testes usam somente diretórios temporários.

## Indicadores e políticas de análise

Sem permissão adicional, o relatório apenas ordena visualizações brutas conhecidas. O cálculo de outliers retorna `blocked_policy` por padrão. A [política de métricas derivadas](https://developers.google.com/youtube/terms/derived-metrics-policy) condiciona scores/razões adicionais à aceitação do aditamento e ao caso de uso aplicável; o [guia de conformidade](https://developers.google.com/youtube/terms/developer-policies-guide) exige aprovação específica para recursos ampliados de analytics. Implementar uma fórmula não comprova autorização para utilizá-la.

Após validação humana dessa autorização, `MetricsPermission(approved=True, approval_reference=...)` permite calcular `views / mediana(views dos outros vídeos amostrados do mesmo canal e faixa de duração)`. Exige pelo menos cinco pares por padrão, exclui o próprio vídeo, lives e estreias futuras e não divide por zero. Limiar padrão: razão de pelo menos três. A referência é declaração do operador, **não verificação automática do Google** e não pode ser fornecida por um agente para ampliar suas próprias permissões.

O resultado distingue `horus_derived_not_youtube_metric`, explicita fórmula, pares utilizados, mediana e limitações e herda a expiração do dataset. Não é baseline histórico completo: idades e amostras diferem, duração até 180 segundos não comprova Shorts, correlação não indica causa e um outlier não garante oportunidade comercial. Não calcula velocidade, saturação brasileira ou causalidade. Essas capacidades exigem validação própria e revisão de políticas antes de implementação. Não utilizar os dados coletados para treinamento de modelos sem avaliação específica dos termos.

Segundo a [referência de pesquisa](https://developers.google.com/youtube/data/reference/rest/v3/search/list), `regionCode` indica disponibilidade no país, não nacionalidade do criador; `relevanceLanguage` favorece relevância, sem excluir outros idiomas. O país do canal é informação opcional declarada. A [referência de vídeos](https://developers.google.com/youtube/data/reference/rest/v3/videos) define os contadores vigentes; não comparar séries de visualizações atravessando mudanças de definição sem anotá-las.

## Configuração e utilização futura

Para uso real posterior: habilitar YouTube Data API v3 em projeto próprio do Google Cloud, criar chave restrita à API e ao ambiente aplicável, verificar políticas, orçamento/cotas e disponibilizar `YOUTUBE_API_KEY` somente no ambiente local. Não salvar chaves em JSON de pesquisa, argumentos, logs ou Git. Não foi lida nem configurada nenhuma chave nesta entrega.

Exemplo de pedido, sem executar rede:

```json
{"search":{"query":"space discoveries","kind":"video","language":"en","region":"BR","published_after":"2026-10-01T00:00:00Z","pages":1,"page_size":25},"enrich_channels":true,"upload_pages":0}
```

Entrada manual preparada, **não executada nesta entrega**; requer autorização de coleta real e backend instalado/venv ativo:

```powershell
python -m horus_backend.radar_youtube --request pedido.json --state-dir <diretorio-exclusivo> --allow-network
```

Sem `--allow-network`, o comando falha antes de ler chave/pedido ou criar estado. A saída JSON pode conter dados sujeitos ao TTL; sua guarda e limpeza ficam sob responsabilidade do chamador.

## Integração posterior com Hermes

O backend deverá selecionar dataset não expirado e uma revisão explícita, validar contrato, conservar os estados oficiais no WorkflowService e fornecer somente os dados necessários ao executor. Este módulo não permite que o agente escreva aprovações ou estados.

Mapeamento a revisar após consolidação do Claude: vídeos para `DatasetItem` do contrato Hermes, `source_id`, título/canal/URL, horários e métricas públicas não nulas. Os IDs gerados cabem no limite atual de 32 caracteres. O contrato atual aceita até 50 itens e exige certos campos que a API pode omitir: filtrar/registrar ausência ou revisar o adaptador, sem inventar valores. Canais, `expires_at`, revisões, indisponibilidade e proveniência por endpoint precisam de tratamento explícito. Não enviar o dataset inteiro por conversão implícita; o contrato existente não é idêntico. Nenhum adaptador Hermes foi criado nesta entrega.

Cancelamento implementado: `collect(..., cancel=evento.is_set)` e `refresh(..., cancel=evento.is_set)` aceitam uma função consultada antes da aquisição da trava, durante a espera, entre páginas/endpoints/tentativas e antes de salvar. Quando sinalizada, lançam `CollectionCancelled` (exportada pelo pacote), sem salvar revisão parcial ou completa daquela execução. Reservas já feitas não são devolvidas; respostas válidas recebidas podem permanecer em cache, e invalidações de recursos ausentes já confirmadas continuam válidas. A revisão anterior permanece salvo a política de invalidação/expiração. Não há interrupção do GET em curso: a espera continua sujeita ao timeout do transporte (padrão de 15 segundos); o callback também não interrompe a espera de um segundo antes da retentativa. O chamador deve manter o sinal ativo até receber a exceção; a checagem final não torna cancelamento e commit uma operação atômica.

Antes de automação ainda faltam: integrar cancelamento e chamadas periódicas de `purge()` ao ciclo do executor existente, registrar consumo de aplicações externas compartilhando o projeto e avaliar uso de dados por provedores de IA. Serialização, cancelamento cooperativo e limpeza explícita estão implementados no núcleo, sem scheduler adicional.

## Validação offline

```powershell
& backend/.venv/Scripts/python.exe -m pytest backend/tests/radar_youtube -q
```

A suíte bloqueia criação de conexões reais e usa transportes simulados, diretórios temporários e relógio controlado. Cobre descoberta, filtros, IDs/URLs, paginação, dados ausentes/ocultos, falhas HTTP, cotas persistentes/concorrentes, cache, expiração, versões, serialização entre threads/processos, cancelamento antes/durante coleta e espera pela trava, limpeza idempotente e bloqueio de indicadores. Não comprova credenciais, aceitação dos parâmetros pelo projeto real ou conformidade operacional de uma futura instalação. Resultados específicos desta entrega são apresentados na consolidação; não valida alterações simultâneas do Claude.

## Integração local M1 e demonstração

`GET /v1/radar/datasets` lista somente a última revisão ainda válida de cada snapshot (até 100, mais recentes primeiro); `GET /v1/radar/datasets/{snapshot_id}/{revision}` retorna o dataset completo e a elegibilidade por vídeo. As rotas são autenticadas pelo token local existente. O arquivo dedicado fica em `<data_dir>/radar/radar-youtube.sqlite3`.

`POST /v1/radar/datasets/demo`, com `Idempotency-Key`, cria cinco vídeos e um canal fictícios: títulos `[DEMONSTRAÇÃO]`, URLs `example.org/horus-demo`, origem `operator_fixture`, TTL de 28 dias e um vídeo sem publicação para demonstrar exclusão. Mesma chave recupera o dataset enquanto ele estiver retido; após expurgo, a demonstração pode ser recriada com novo horário. O coletor continua produzindo exclusivamente `youtube_data_api`; `operator_fixture` é uma origem aditiva para dados fornecidos pelo operador.

`POST /v1/workflows/radar` adapta somente vídeos elegíveis, sem inventar métricas, e utiliza por padrão Hermes em processo. Não há aprovação automática: autorizar a análise e aprovar/rejeitar a proposta são ações separadas. Dados expirados retornam 404 na consulta/criação; autorização após expiração retorna 409. A cópia congelada no banco operacional ainda não tem expurgo de retenção: isso bloqueia dados reais em M2 até implementação e validação da limpeza, inclusive de cópias/backups.
