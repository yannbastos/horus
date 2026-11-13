# Contratos de mídia e QC audiovisual (HOR-089 / HOR-097 / HOR-055)

Estado: **contratos (Fase 1), módulo de QC `av_quality.py` (Fase 2) e alinhamento acústico local `speech_alignment.py` (HOR-054) implementados e testados; o alinhamento ainda não está ligado ao worker de produção**; revisão por timecode e exposição na API **ainda não implementadas** (ver tabela). Tudo é demonstração (`demo_only=true`); nada aqui autoriza publicação, e `publishable` é sempre `false`.

Código: `backend/src/horus_backend/media_contracts.py`. Testes: `backend/tests/test_media_contracts.py`. JSON Schemas exportados: `contracts/media/*.schema.json` (regenerar com `backend/.venv/Scripts/python.exe contracts/media/generate_schemas.py`; um teste falha se divergirem dos modelos).

| Item | Estado |
|---|---|
| Modelos Pydantic estritos + `validate_word_timings/quality_report/asset_provenance` | Implementado e testado |
| JSON Schema exportado e teste de sincronia | Implementado |
| Alinhamento acústico (`speech_alignment.py`): `word-timings.json` com `source=forced_alignment` | Implementado e testado; ensaio real no WAV do piloto (ver seção 4); integração no worker: incremento separado |
| Módulo de QC (`av_quality.py`): `quality-report.json` a partir dos arquivos reais | Implementado; testes sintéticos e ensaio somente leitura na evidência real (ver seção QC) |
| `ProductionReviewRequest.notes`, `quality_report`/`speech_aligned`/`asset_provenance` no registro da produção | Planejado (outros arquivos) |
| Provedores Pexels/Pixabay | Somente valores de `origin` e regras; sem API, chave ou download |

## Convenções comuns

- Modelos com `extra=forbid`, `strict=True`, sem strip: `bool` não é número/versão, `str` não é coagida, campos desconhecidos (inclusive `publishable`) são erro. `schema_version` é exatamente o inteiro `1`.
- Tempos em segundos (`float`, finitos, precisão de ms, `<= 86400`) relativos ao início do WAV de narração concatenado.
- Hashes: 64 hex minúsculos. IDs: `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`. Datas: ISO 8601.
- Funções `validate_*` são puras (sem rede, disco ou subprocesso) e nunca levantam. Retorno: `{schema_version, ok, errors:[{code, path, message}], warnings:[str], publishable:false, value}`; `value` é o documento normalizado quando `ok`, senão `null`. `word-timings` acrescenta `speech_aligned`.
- Sem o contexto real para a validação cruzada, o resultado traz um aviso `*_not_checked` e nunca afirma alinhamento.

## 1. `word-timings.json`

`{schema_version, narration_sha256, duration_seconds, source, engine:{name, voice}, words:[{index, text, section, start, end, char_offset, char_length, timing?}], alignment?}`.

`source`: `tts_engine_events` (tempos informados pelo motor durante a síntese), `forced_alignment` (alinhamento acústico) ou `estimated` (heurística).

Regras internas: `index` = 0..N-1; `end > start`; palavras em ordem e sem sobreposição (tolerância 1 ms); `end <= duration_seconds`; `text` sem espaços e com `char_length == len(text)`; `char_offset` crescente sem sobrepor; `section` não regride.

Validação cruzada (`validate_word_timings(data, narration_sha256=, duration_seconds=, script_text=, sections=)`): hash do WAV registrado; duração medida (tolerância 50 ms); cobertura do roteiro (cada token separado por espaço, na ordem, mesmo texto e offset: `words_missing`, `words_extra`, `word_text_mismatch`); `sections=[{section,start,end}]` medidas (tolerância 50 ms; `unknown_section`, `word_outside_section`).

Extensão compatível (HOR-054), campos opcionais: `words[].timing` (`measured` = tempo medido pelo ASR; `interpolated` = palavra sem correspondência acústica, com tempo distribuído entre âncoras medidas, nunca uma medição) e `alignment` = `{method:"asr_sequence_match", asr_engine, matched_words, interpolated_words, match_rate, longest_interpolated_seconds}`. Com `source=forced_alignment` ambos são obrigatórios e o validador **recomputa** contagens, `match_rate` e o maior trecho interpolado contínuo a partir das palavras (`alignment_counts`, `alignment_match_rate`, `alignment_longest_run`; `timing_missing`, `alignment_missing`). Com outra fonte são proibidos (`timing_not_allowed`, `alignment_not_allowed`). Documentos legados (`estimated`) continuam válidos e idênticos byte a byte no round-trip: o `value` devolvido omite campos `None` (`exclude_none`).

**`speech_aligned=true` somente se** o documento é válido, `source != estimated` e hash, duração, roteiro e seções foram fornecidos e conferem. Em `forced_alignment` exige-se também `match_rate >= 0,85` (`MIN_MATCH_RATE`) e maior trecho interpolado contínuo `<= 2,0 s` (`MAX_INTERPOLATED_RUN_SECONDS`); abaixo disso o documento é válido, com o aviso `alignment_below_threshold` e `speech_aligned=false`. Qualquer outro caso é `false`.

## 2. `quality-report.json`

`{schema_version, production_id, video_sha256, generated_at, tool:{name, version}, status, checks:[{id, category, status, method, measured, threshold, detail, timecode?:{start,end}}], blocking_errors, warnings}`.

- `category`: integrity|duration|audio|sync|subtitles|provenance|visual. `status` do check: pass|warn|fail|skipped. `method`: measured|declared|estimated (obrigatório).
- `measured`/`threshold`: objetos de escalares finitos (ou listas deles). Check `measured` não `skipped` **precisa** declarar `measured.source` (ferramenta/filtro), e a fonte não pode conter “estimat*”, “heurístic*” ou “declared” (`estimate_as_measured`).
- Coerência: `status` do relatório = `fail` se houver check fail; senão `warn`; senão `pass` se houver pass; senão `not_run` (inclui lista vazia ou só `skipped`). `blocking_errors` = ids dos checks fail, `warnings` = ids dos checks warn, ambos na ordem dos checks; ids únicos. Check indisponível é `skipped` com motivo em `detail`, nunca inventado.
- Cruzamento: `validate_quality_report(data, video_sha256=, production_id=, word_timings_source=)` — hash do MP4 aprovado; se o `word-timings` é `estimated`, check `sync` não pode ser `measured`.

## 3. `asset-provenance.json`

`{schema_version, assets:[{asset_id, relative_path, sha256, kind, origin, source_url, author, license:{id, name, url, commercial_use, attribution_required, verified_by, verified_at}, status, notes}]}`.

- `origin`: original_local, system_voice, local_tts_model, stock_pexels, stock_pixabay, licensed_manual. Pexels/Pixabay são só rótulos de proveniência: nenhuma API, chave ou download.
- Assets externos (stock_*, licensed_manual) não rejeitados exigem `source_url`, `author` e licença (`id`, `name`, `url` dos termos). URLs: https, sem credenciais; stock_pexels/stock_pixabay exigem host `pexels.com`/`pixabay.com` (ou subdomínio).
- `status=verified` exige `verified_by="human"` + `verified_at`, `commercial_use != unknown` e `attribution_required` conhecido. `verified_by` e `verified_at` vêm juntos.
- `commercial_use=unknown` nunca equivale a permitido: `commercial_use_permitted(asset)` só é verdadeiro com `allowed` + `verified` + humano.
- `relative_path`: relativo e confinável (sem `..`, `.`, `\`, `:`, barra inicial, segmento vazio ou terminado em ponto/espaço); `asset_id` e caminho únicos (sem diferenciar maiúsculas).
- Cruzamento: `validate_asset_provenance(data, artifacts={relative_path: sha256})` — todo asset declarado deve estar registrado com o mesmo hash (`asset_not_registered`, `hash_mismatch`) e todo artefato de mídia registrado precisa de proveniência (`artifact_without_provenance`). Assets não `verified` geram o aviso `unverified_assets_block_publication`.

## 3.1 Revisão humana de licença por asset (HOR-097) — contrato da API

Estado: **contrato (Fase A); implementação na Fase B** (`license_reviews.py`, migração v8, rotas em `api.py`). O `asset-provenance.json` registrado **nunca é reescrito**: a decisão humana vive em tabela própria e é combinada em leitura.

**Rotas** (auth Bearer local como as demais; ambas sob `/v1/productions/{id}`):

- `GET /v1/productions/{id}/license-reviews` → `{production_id, current:[review], history:[review], publishable:false}`. `current` = decisão vigente por `asset_id` (a mais recente); `history` = todas, da mais antiga à mais nova (append-only). Produção inexistente: 404. Produção sem `asset-provenance.json` válido: listas vazias (o que já foi gravado continua visível).
- `POST /v1/productions/{id}/license-reviews`, cabeçalho `Idempotency-Key` (1..128, obrigatório), corpo estrito (`extra=forbid`):
  `{asset_id, asset_sha256, decision: "verified"|"rejected", license:{id, name, url, commercial_use: "allowed"|"restricted", attribution_required: bool}, evidence: str 1..2000, reviewed_by: "human"}`.
  Resposta `201` com a revisão criada (`200` na repetição idêntica da mesma chave): `{id, production_id, asset_id, asset_sha256, decision, license, evidence, reviewed_by:"human", reviewed_at, supersedes: <id|null>, idempotency_key_hash}`. `reviewed_at` é do servidor (UTC), nunca do cliente.

**Regras de validação**

- `asset_id` e `asset_sha256` precisam existir, juntos, no `asset-provenance.json` **registrado e validado** da produção (hash do arquivo conferido com o artefato registrado, `validate_asset_provenance` com os hashes de entrada). Asset ausente, hash divergente ou proveniência ausente/inválida: `409`.
- `commercial_use` aceita só `allowed|restricted`: `unknown` nunca é `verified` (e não é aceito no pedido); `attribution_required` é booleano obrigatório. `license.id/name/url` obrigatórios; `url` https, sem credenciais. Para `origin` `stock_pexels`/`stock_pixabay`, `license.url` deve ser https do host oficial (`pexels.com`/`pixabay.com` ou subdomínio).
- `decision=rejected` aceita `commercial_use=restricted|allowed`; é registro de que o uso foi recusado.
- `reviewed_by` só `"human"`; `evidence` sem controles (exceto quebra de linha/tab), 1..2000 caracteres após validação estrita. A evidência é texto do operador (ex.: link da página de termos, captura anotada); o sistema não a verifica por rede.
- Erros: `401` sem token; `404` produção inexistente; `409` asset/hash/proveniência, ou `Idempotency-Key` já usada com corpo diferente; `422` corpo inválido (sem eco do conteúdo).
- Idempotência: mesma chave + mesmo corpo → mesma revisão, sem novo registro; mesma chave + corpo diferente → `409`. Decisão nova (chave nova) para o mesmo asset **substitui a vigente** e grava `supersedes`; nada é apagado ou alterado (gatilhos SQLite recusam `UPDATE`/`DELETE`).
- Aprovar licença **não** altera `publishable=false`, não muda nenhum artefato registrado e não dispara publicação ou renderização.

**Visão combinada (função pura)** `apply_license_reviews(provenance, reviews) -> dict` em `media_contracts.py`: recebe o `asset-provenance.json` validado e a lista de revisões; devolve uma cópia (o original não é tocado) em que, para cada asset com decisão vigente cujo `asset_sha256` coincide, `status` = `verified`/`rejected`, `license` recebe os campos da decisão humana e `verified_by="human"`, `verified_at=reviewed_at` (só em `verified`; em `rejected` ficam `null`). Decisões cujo hash não coincide com o asset são ignoradas (nunca aplicadas por engano). O resultado é revalidado por `validate_asset_provenance`; `commercial_use_permitted` só é verdadeiro para `allowed` verificado por humano. O documento efetivo não é gravado em disco e não substitui o registrado por hash.

**Persistência (migração v8, aditiva)**: tabela `license_reviews(seq AUTOINCREMENT, id UNIQUE, production_id FK, asset_id, asset_sha256, decision CHECK, license JSON, evidence, reviewed_by CHECK, reviewed_at, supersedes, idempotency_key, request, UNIQUE(production_id, idempotency_key))`, índice por `(production_id, asset_id, seq)` e gatilhos de append-only.

## QC audiovisual (`av_quality.py`)

`run_quality(root, *, production_id, ffmpeg=None, ffprobe=None, video_relative=None, timeout=180) -> dict` devolve um `quality-report.json` válido (já passado por `validate_quality_report`; se o próprio QC gerasse algo inválido, levanta `RuntimeError`). `run_quality_async` é a versão cancelável (`Task.cancel()` encerra a árvore do FFmpeg); `run_quality` é segura dentro de um loop em execução. Somente leitura, sem rede; subprocessos pelo `processes.OwnedProcess` (Job Object) com timeout (check `skipped` com o motivo se estourar).

Entradas em `root`: `pilot-evidence.json`, assets de entrada, SRT ao lado da narração, MP4 em `**/render/short-rascunho.mp4` (ou `*.mp4` na raiz), e opcionais `word-timings.json`, `asset-provenance.json`, `plan.json` (texto do roteiro). Sem MP4, o relatório usa o hash sentinela `000…0` e o check `video_present` falha.

| Check | Categoria | Como é medido |
|---|---|---|
| `video_present`, `evidence_manifest` (declared), `asset_hashes` | integrity | sistema de arquivos; `validate_pilot_evidence`; sha256 de cada asset de entrada |
| `audio_clipping`, `audio_level`, `audio_silence` | audio | WAV da narração em Python puro (`pilot_quality.analyze_wav`): pico, RMS, clipping, silêncios ≥ 2 s internos / bordas > 1,5 s (com timecode) |
| `audio_loudness` | audio | FFmpeg do MP4: `ebur128` se o build tiver; senão análise do `loudnorm` (`source` declara qual). Faixa de aviso −26…−12 LUFS e true peak ≤ −1 dBTP: referência, não requisito do produto |
| `duration_narration`, `duration_video_audio` | duration | cabeçalho `wave` (concatenado e seções × cenas) e `ffprobe` (vídeo = narração + 0,8 s ± 0,15; faixas de áudio/vídeo presentes) |
| `subtitles_vs_sections` | subtitles | cues do SRT × cenas (seções medidas): ordem, sem sobreposição, dentro da cena |
| `script_coverage` | subtitles | palavras de `plan.json` presentes, em ordem, nas cues; `skipped` sem `plan.json` |
| `word_timings`, `subtitles_vs_words` | sync | `validate_word_timings` com hash, duração, roteiro e seções reais; desvio máximo/médio por cue. `skipped` com motivo se `word-timings.json` ausente; `method=estimated` se a fonte é `estimated` |
| `visual_black_frames`, `visual_freeze` | visual | miniaturas em cinza 64×112 a 10 fps extraídas pelo FFmpeg (scale+format+PNG via pipe) e analisadas em Python; preto = luma < 16 por ≥ 0,5 s; congelado = diferença média < 0,05 por ≥ 4 s (aviso: cena estática pode ser intencional) |
| `asset_provenance` | provenance | `asset-provenance.json` cruzado com os hashes; sem o arquivo, `declared` a partir do manifesto (aviso se houver licença não verificada) |

**Regra de proveniência:** o cruzamento cobre só os assets de **entrada** (PNGs de cena, WAVs de seção e narração concatenada). Saídas derivadas (MP4, `render/audio-review.wav`, quadros de inspeção) não exigem proveniência própria.

Limitações: o FFmpeg da sandbox da fábrica (build do Remotion) não tem `ebur128`, `blackdetect`, `freezedetect`, `fps` nem muxer `rawvideo`; por isso loudness usa `loudnorm` e a análise visual é feita em Python. Silêncio e clipping vêm do WAV de narração, não da mixagem final do MP4 (a loudness vem do MP4). Só WAV PCM 16 bits é analisado (outro formato → `skipped`). Inteligibilidade e qualidade da voz não são medidas. Um relatório sem falhas não significa vídeo bom nem publicável.

## 4. Alinhamento acústico local (`speech_alignment.py`, HOR-054)

A voz SAPI não emite eventos de palavra; o método mede a fala do WAV com o faster-whisper e alinha ao roteiro:

1. **ASR** (`run_alignment`/`run_alignment_async`): subprocesso possuído (`processes.OwnedProcess`: Job Object, timeout de 900 s, cancelável), CPU int8, `word_timestamps=True`, idioma `pt`, `local_files_only` e `HF_HUB_OFFLINE=1` (sem rede). Exige o extra `transcription` e um modelo CTranslate2 local em `<model_dir>/<nome>` ou `<model_dir>/faster-whisper-<nome>` (com `model.bin`); nada é baixado pelo código. Sem extra, modelo, WAV legível ou com falha/timeout do ASR, devolve `{executed:false, reason}` e nenhum documento: nunca uma estimativa disfarçada.
2. **Alinhamento** (`align_script`, função pura): subpalavras normalizadas (minúsculas, sem acentos nem pontuação, hifens separam, dígitos em extenso pt-BR: `2026` ↔ "dois mil e vinte e seis", `50%` ↔ "cinquenta por cento") alinhadas por programação dinâmica monótona (casamento exato 1,0; grafia próxima ≥ 0,8 de similaridade em palavras de ≥ 4 letras, 0,6). Uma palavra do ASR só casa com token de uma seção se seu ponto médio cai na seção ± 0,5 s. Um token do roteiro é `measured` se **todas** as suas subpalavras casaram; o tempo é o do ASR, aparado aos limites medidos da seção. Tokens sem subpalavra falada (ex.: "—") são `interpolated`.
3. **Palavras do ASR descartadas**: tempo inválido/não finito, duração < 1 ms, que regridem no tempo; sobreposição pequena é aparada no início.
4. **Interpolação**: tokens sem correspondência recebem tempo proporcional ao tamanho entre âncoras medidas da mesma seção (largura mínima 20 ms); se não houver espaço, âncoras vizinhas são rebaixadas a `interpolated` (nunca o contrário).
5. O roteiro é o texto das seções unidas por `
` (uma linha por seção medida, mesma convenção do piloto); o documento devolvido já passou por `validate_word_timings` com hash, duração, roteiro e seções. `align_with_report` devolve também o diagnóstico (taxa, aparos, desvio das bordas medidas em relação aos limites de seção).

QC: `subtitles_vs_words` calcula o desvio só com cues cujas palavras de borda são `measured` e informa quantas palavras/cues são interpoladas.

**Ensaio real (2026-11-13, somente leitura)**: narração do piloto (47,91 s, 77 palavras, voz SAPI Maria), modelo `Systran/faster-whisper-small`, CPU int8: 77/77 palavras casadas (taxa 1,0), 0 interpoladas, `speech_aligned=true`, 0 aparos, desvio das bordas medidas em relação aos limites de seção: médio 0,545 s, máximo 1,131 s (silêncio inicial/final de cada seção da síntese; as seções são limites de arquivo, não de fala), execução do ASR 9,7 s. Teste real condicional: `HORUS_WHISPER_MODEL_DIR`, `HORUS_ALIGNMENT_EVIDENCE` e `HORUS_ALIGNMENT_WAV`. Limitações: uma única narração curta e limpa de voz sintética; a taxa não generaliza para fala humana, ruído ou roteiros longos; precisão de tempo por palavra do Whisper é da ordem de décimos de segundo; não valida a pronúncia; integração no worker ainda não existe.

## Pendente / fora desta entrega

Itens 4 e 5 do esboço (notas por timecode em `ProductionReviewRequest`; `quality_report`, `speech_aligned` e `asset_provenance` em `GET /v1/productions/{id}`) pertencem a `production*.py`/`api.py`, de outros responsáveis. Os contratos acima são a API que esses módulos devem importar. 
