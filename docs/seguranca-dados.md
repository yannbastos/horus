# Segurança dos dados locais (SQLite operacional)

Escopo: o banco operacional `horus.sqlite3` (jobs, workflows, artefatos, aprovações, execuções cognitivas) e os backups de migração criados ao lado dele. O estado do Radar (`radar/radar-youtube.sqlite3`) já usa `secure_delete=ON` e tem limpeza própria. Nada aqui usa criptografia própria: são mecanismos consolidados do SQLite e recomendações para o sistema operacional.

## O que é garantido

| Mecanismo | Efeito | Onde |
|---|---|---|
| `PRAGMA secure_delete=ON` em **toda** conexão do banco operacional | Páginas e células liberadas por `DELETE`/`UPDATE` (inclusive páginas de *overflow* de valores grandes) são sobrescritas com zeros no momento em que são liberadas, também dentro das páginas ainda em uso | `Store.connect()` em `storage.py`. É um pragma **por conexão**; `migrations.py` abre a própria conexão (só migrações aditivas, sem remoção de dados) e não o define |
| `wal_checkpoint(TRUNCATE)` após a retenção | O banco roda em `journal_mode=WAL`. Os quadros antigos permanecem no `-wal` até um checkpoint, e mesmo um checkpoint comum (`PASSIVE`) copia para o `.sqlite3` sem esvaziar o `-wal`. `TRUNCATE` copia tudo e reduz o `-wal` a 0 byte | `Store.checkpoint()`; chamado por `run_retention` quando ao menos um workflow foi redigido |
| Checkpoint pendente é repetido | Leitor ativo, banco bloqueado ou erro **não** quebram o ciclo: o resultado fica no relatório e o ciclo seguinte (a cada 6 h) repete o checkpoint mesmo sem novas redações | `RetentionReport.checkpoint_pending`, `JobManager.checkpoint_pending` |
| Resultado exposto sem conteúdo | `status` (`ok`, `busy`, `error`), `wal_frames`, `checkpointed_frames`, `wal_bytes`, `freelist_pages`, `page_count` | `RetentionReport.checkpoint`; em `JobManager.retention_status["checkpoint"]` (→ `GET /v1/security/status`, `radar.automatic_cleanup.checkpoint`) |
| Inventário e *dry-run* dos backups de migração | Lista o que a política removeria e por quê, sinaliza backups com cópias do Radar; leitura estritamente somente leitura | `backups.py` |

Medições nos testes (`backend/tests/test_sqlite_hardening.py`; marcador único em ~60 KB–190 KB, páginas de 4 KiB):

| Cenário | Sem `secure_delete` | Com `secure_delete=ON` |
|---|---|---|
| `UPDATE` de valor grande por um curto + `TRUNCATE` | marcador permanece no `.sqlite3` (≈ 9 900 ocorrências em 46 páginas livres) | 0 ocorrências; 46 páginas livres **zeradas** |
| `DELETE` + `TRUNCATE` | idem | 0 |
| Ciclo de retenção em workflow Radar fictício (300 itens) | 886 ocorrências no `.sqlite3`, 31 de 66 páginas livres | 0 no `.sqlite3` e 0 no `-wal`; as mesmas 31 páginas livres, zeradas |
| Antes do checkpoint, `-wal` | 890 ocorrências (quadros originais) | 890 (o `secure_delete` não reescreve quadros antigos) |
| Depois de `PASSIVE` | 890 ocorrências ainda no `-wal` | idem |
| Depois de `TRUNCATE` | `-wal` com 0 byte | `-wal` com 0 byte |

Conclusão: `secure_delete` impede o resíduo **no arquivo principal**; o checkpoint `TRUNCATE` elimina o resíduo **no WAL**. Um sem o outro não basta. Fechar a última conexão do banco também faz o SQLite fazer checkpoint e apagar o `-wal`, mas o backend abre conexões curtas que podem se sobrepor entre threads e processos auxiliares, então não se deve depender disso.

## O que NÃO é garantido

- **Páginas livres antigas.** `secure_delete` só vale para o que for liberado *depois* que o pragma está ativo. Bancos que já passaram por redações/remoções com a versão anterior têm resíduo na lista de páginas livres que o novo comportamento **não limpa** (teste: o marcador continua no arquivo após ligar `secure_delete` e rodar a retenção; somem só com `VACUUM`). Ver *VACUUM* abaixo.
- **SSD, TRIM e *wear leveling*.** Sobrescrever com zeros no nível do SQLite não garante que a célula flash física antiga tenha sido apagada: o controlador pode gravar o novo conteúdo em outro bloco e manter o antigo até reciclá-lo. O mesmo vale para sistemas de arquivos com cópia-na-escrita. Só criptografia de disco torna esse resíduo inútil.
- **Backups de migração** (`horus.backup-v<N>-<token>.sqlite3`). São cópias completas feitas pela API de *backup* do SQLite antes de cada migração; **copiam inclusive páginas livres** do banco de origem e não são alcançados pela redação nem pelo checkpoint. Um backup feito de um banco que já tinha cópias do Radar mantém essas cópias, em texto, por tempo indefinido. A remoção está **desligada por padrão** (ver política abaixo).
- **Cópias fora do banco:** sombra/pontos de restauração e histórico de arquivos do Windows, OneDrive e qualquer pasta sincronizada ou com backup (Hórus com `data_dir` dentro delas), exportações feitas pelo operador, arquivos temporários, `pagefile.sys`/hibernação, logs de processos externos e a cópia mantida pelo **Hermes real** (sessões, memória, logs). A redação do Hórus não alcança nenhuma delas.
- **Dados em memória e processos em execução**, e arquivos copiados por terceiros enquanto os dados ainda existiam.
- O `-shm` não contém dados das linhas, mas faz parte do conjunto de arquivos do banco.

## Recomendações ao operador (fora do código)

1. **BitLocker** (ou equivalente) no volume que contém a pasta de dados do Hórus. É a medida que cobre SSD, páginas livres antigas, backups, arquivos temporários e hibernação. Sem ela, as garantias acima são de melhor esforço.
2. Manter a pasta de dados **fora** de OneDrive/pastas sincronizadas e fora de rotinas de backup que retenham versões antigas; revisar a proteção do sistema (pontos de restauração) para esse volume.
3. Tratar exportações e a pasta do Hermes real como dados sujeitos à mesma política.
4. Executar, **uma vez**, a limpeza de resíduo antigo descrita em *VACUUM* se o banco já guardou dados do Radar antes desta versão.

## Páginas livres, `auto_vacuum` e `VACUUM` (investigação e recomendação)

| Opção | Comportamento medido | Recomendação |
|---|---|---|
| `secure_delete=ON` | Zera o que é liberado. Custo pequeno de escrita extra (as páginas zeradas passam pelo WAL: 46 páginas = 197 KB num teste de 190 KB). Não toca resíduo anterior | **Aplicado** |
| `auto_vacuum=FULL` | Devolve páginas livres ao sistema de arquivos a cada *commit* (arquivo de 200 704 → 12 288 bytes), mas **sem** `secure_delete` restos do valor antigo continuam dentro das páginas ainda em uso (92 ocorrências no teste). Só se aplica a bancos novos ou depois de um `VACUUM`; muda o formato do arquivo | **Não aplicado.** Reduz tamanho, não substitui `secure_delete` |
| `VACUUM` | Reescreve o banco inteiro: elimina por completo o resíduo antigo da lista de páginas livres (marcador 9 947 → 0). Exige o **dobro do espaço** (no modo WAL o `-wal` cresce até ≈ o tamanho do banco: 41,3 MB de WAL para um banco de 41,1 MB, que terminou com 20,5 MB), segura o bloqueio de escrita durante toda a operação (≈ 0,24 s para 41 MB nos testes; cresce linearmente) e deve ser seguido de `wal_checkpoint(TRUNCATE)`. Não altera backups já existentes | **Não automático.** Execução manual, uma vez, com o backend parado e espaço livre ≥ 2× o banco, após ligar `secure_delete`; depois `PRAGMA wal_checkpoint(TRUNCATE)` |
| `VACUUM INTO 'novo.sqlite3'` | Gera uma cópia compacta, sem páginas livres e sem alterar o original; útil para criar um backup limpo | Alternativa para exportar/arquivar sem resíduo |

Decisão do idealizador pendente: executar (ou não) o `VACUUM` único nos bancos que já contêm dados do Radar redigidos antes desta versão. O backend não o executa por conta própria.

## Backups de migração: política

Os backups `horus.backup-v<versão>-<token>.sqlite3` ficam na pasta do banco. `backups.py` oferece inventário e política; **nada é removido automaticamente** e o ciclo de retenção nunca os acessa.

- **Inventário:** nome, versão de origem, tamanho, idade, e, abrindo o backup somente leitura (`mode=ro&immutable=1`, sem criar `-wal`/`-shm`), `json_extract(payload,'$.radar')` para contar workflows com cópia do Radar (total e ainda não redigidos). Backup ilegível mostra `?`.
- **Regras, na ordem:**
  1. versão do backup **maior** que o schema atual: mantido sempre;
  2. o backup da migração **mais recente** (ou o único): mantido sempre, mesmo vencido;
  3. sem prazo configurado: tudo mantido;
  4. mais novo que `N` dias: mantido; mais antigo: candidato à remoção.
- **Backups com Radar** são sinalizados; o mantido por 1–3 com Radar não redigido fica em `needs_operator_decision`: o prazo de 28 dias do Radar já pode ter passado, e só o operador decide remover ou arquivar (por exemplo, apagar o backup mais recente depois de confirmar que a migração foi bem-sucedida).
- **Remoção real:** só com `HORUS_BACKUP_RETENTION_DAYS=<inteiro ≥ 1>` definida **e** chamada explícita (`remove_backups(..., dry_run=False)` ou `--apply`). Valor ausente, vazio, não numérico ou `< 1` mantém tudo. Apaga também `-wal`/`-shm`/`-journal` do backup removido; erro em um arquivo (por exemplo, em uso) é registrado e os demais seguem.
- **Uso pelo operador:**

  ```powershell
  # lista e justifica (dry-run); não altera nada
  & backend/.venv/Scripts/python.exe -m horus_backend.backups "$env:LOCALAPPDATA/Horus/horus.sqlite3"
  # remoção, somente com prazo explícito e --apply
  $env:HORUS_BACKUP_RETENTION_DAYS = "30"
  & backend/.venv/Scripts/python.exe -m horus_backend.backups "$env:LOCALAPPDATA/Horus/horus.sqlite3" --apply
  ```

  Confirme o caminho real da pasta de dados antes de executar. Os testes usam apenas `tmp_path`.

## Validação

`backend/tests/test_sqlite_hardening.py` cobre: `secure_delete` em toda conexão; marcador ausente dos bytes do `.sqlite3` e do `-wal` após retenção + checkpoint; controle sem `secure_delete` (marcador permanece); `UPDATE`/`DELETE` de valores com *overflow*; `-wal` antes/depois de `PASSIVE`/`TRUNCATE`; checkpoint com leitor ativo (`busy`, ciclo íntegro, repetição no ciclo seguinte); erro de checkpoint; `dry_run` sem checkpoint; `integrity_check`/`foreign_key_check` e contagens de linhas; reabertura após falha no meio da redação e recuperação de cópia dos arquivos com transação aberta; resíduo anterior exigindo `VACUUM`; `auto_vacuum`; custo do `VACUUM`; inventário, *dry-run* e remoção de backups (incluindo preservação do último/único e dos de versão futura). Todos em `tmp_path`, com dados fictícios e relógio injetado. Isso valida o comportamento do SQLite neste ambiente; não prova apagamento físico em SSD.

## Autenticação de endpoints e rede local (HOR-127)

`backend/tests/test_endpoint_auth.py` percorre todas as rotas registradas (`app.routes`, inclusive routers incluídos) e exige 401 sem token ou com token errado; uma rota nova sem autenticação faz o teste falhar, e rota que não seja HTTP comum também (revisão obrigatória).

- **Única rota sem Bearer:** `GET /v1/media/{id}/stream`, autorizada por ticket HMAC (token local, id da mídia e expiração), porque o elemento de vídeo não envia cabeçalhos. `/health` e `/v1/security/status` exigem token; não há `/docs` nem OpenAPI.
- **Rede:** o servidor escuta somente em `127.0.0.1` (testado com o processo real e com os endereços de LAN do computador). `Host` precisa ser `127.0.0.1` ou `localhost` (com porta opcional), contra DNS rebinding; `Origin` precisa estar na lista fixa (mais uma origem loopback opcional por variável de ambiente); CORS nunca devolve `*`.
- **Token:** mínimo de 24 caracteres, comparado com `secrets.compare_digest` sobre bytes (também o ticket). Correções desta revisão: cabeçalho/ticket não ASCII respondia HTTP 500 (agora 401) e `Host` com `usuario@` era aceito (agora 403); `GET` de mídia recusa arquivo trocado por link simbólico depois do registro.
- **Mídia e artefatos:** ids de mídia são buscados no banco (sem caminho); o registro resolve links e exige extensão audiovisual; pasta ignora links e subpastas; artefatos de produção passam por `confined` (sem `..`, absoluto, `\`, `:` nem links).
- **Limitações conhecidas:** (1) **limite de corpo implementado** (`body_limit.py`, ASGI interno à autenticação): padrão 2 MiB, contado em bytes reais em streaming (inclusive chunked e `Content-Length` mentiroso), resposta 413 em pt-BR sem executar o manipulador; tetos maiores só onde o modelo já admite texto grande: `POST /v1/transcriptions/save` 64 MiB (20.000.000 caracteres × até 3 bytes UTF-8) e `/v1/narration/*` 4 MiB (1.000.000 caracteres). Corpo sem token continua 401 sem ser lido. Limite restante: o corpo aceito (até o teto da rota) ainda é lido inteiro em memória para validar; (2) o token vive em variável de ambiente do processo e no cabeçalho; qualquer processo do mesmo usuário que o conheça é confiável; (3) neste ambiente Windows os testes com `symlink` real foram pulados (sem privilégio); a recusa é coberta por stub e pela análise de `confined`; (4) `Host` ausente (HTTP/1.0) cai no endereço da conexão.
