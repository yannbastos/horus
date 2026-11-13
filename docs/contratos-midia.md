# Contratos de mídia e QC audiovisual (HOR-089 / HOR-097 / HOR-055)

Estado: **contratos implementados e testados (Fase 1)**; módulo de QC que produz `quality-report.json`, revisão por timecode e exposição na API **ainda não implementados** (ver tabela). Tudo é demonstração (`demo_only=true`); nada aqui autoriza publicação, e `publishable` é sempre `false`.

Código: `backend/src/horus_backend/media_contracts.py`. Testes: `backend/tests/test_media_contracts.py`. JSON Schemas exportados: `contracts/media/*.schema.json` (regenerar com `backend/.venv/Scripts/python.exe contracts/media/generate_schemas.py`; um teste falha se divergirem dos modelos).

| Item | Estado |
|---|---|
| Modelos Pydantic estritos + `validate_word_timings/quality_report/asset_provenance` | Implementado e testado |
| JSON Schema exportado e teste de sincronia | Implementado |
| Módulo de QC (`av_quality.py`), `quality-report.json` gerado de arquivos reais | Planejado (Fase 2) |
| `ProductionReviewRequest.notes`, `quality_report`/`speech_aligned`/`asset_provenance` no registro da produção | Planejado (outros arquivos) |
| Provedores Pexels/Pixabay | Somente valores de `origin` e regras; sem API, chave ou download |

## Convenções comuns

- Modelos com `extra=forbid`, `strict=True`, sem strip: `bool` não é número/versão, `str` não é coagida, campos desconhecidos (inclusive `publishable`) são erro. `schema_version` é exatamente o inteiro `1`.
- Tempos em segundos (`float`, finitos, precisão de ms, `<= 86400`) relativos ao início do WAV de narração concatenado.
- Hashes: 64 hex minúsculos. IDs: `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`. Datas: ISO 8601.
- Funções `validate_*` são puras (sem rede, disco ou subprocesso) e nunca levantam. Retorno: `{schema_version, ok, errors:[{code, path, message}], warnings:[str], publishable:false, value}`; `value` é o documento normalizado quando `ok`, senão `null`. `word-timings` acrescenta `speech_aligned`.
- Sem o contexto real para a validação cruzada, o resultado traz um aviso `*_not_checked` e nunca afirma alinhamento.

## 1. `word-timings.json`

`{schema_version, narration_sha256, duration_seconds, source, engine:{name, voice}, words:[{index, text, section, start, end, char_offset, char_length}]}`.

`source`: `tts_engine_events` (tempos informados pelo motor durante a síntese), `forced_alignment` (alinhamento acústico) ou `estimated` (heurística).

Regras internas: `index` = 0..N-1; `end > start`; palavras em ordem e sem sobreposição (tolerância 1 ms); `end <= duration_seconds`; `text` sem espaços e com `char_length == len(text)`; `char_offset` crescente sem sobrepor; `section` não regride.

Validação cruzada (`validate_word_timings(data, narration_sha256=, duration_seconds=, script_text=, sections=)`): hash do WAV registrado; duração medida (tolerância 50 ms); cobertura do roteiro (cada token separado por espaço, na ordem, mesmo texto e offset: `words_missing`, `words_extra`, `word_text_mismatch`); `sections=[{section,start,end}]` medidas (tolerância 50 ms; `unknown_section`, `word_outside_section`).

**`speech_aligned=true` somente se** o documento é válido, `source != estimated` e hash, duração, roteiro e seções foram fornecidos e conferem. Qualquer outro caso é `false`.

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

## Pendente / fora desta entrega

Itens 4 e 5 do esboço (notas por timecode em `ProductionReviewRequest`; `quality_report`, `speech_aligned` e `asset_provenance` em `GET /v1/productions/{id}`) pertencem a `production*.py`/`api.py`, de outros responsáveis. Os contratos acima são a API que esses módulos devem importar. Não foram validados contra WAV/MP4 reais; a Fase 2 fará isso.
