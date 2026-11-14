# Revisão do QC, legendas e licenças — 14/11/2026 (HOR-118; relacionados HOR-089 e HOR-097)

Escopo: `av_quality.py`, `pilot_quality.py`, `media_contracts.py`, `speech_alignment.py`, `license_reviews.py`, `asset_sources/`. Nenhum limiar foi alterado (constantes protegidas por teste). Todas as mudanças são aditivas: rotas, formatos, códigos de erro e estados existentes continuam válidos. Evidência: `backend/tests/test_qc_edge_cases.py`, `test_alignment_edge_cases.py`, `test_license_consistency.py`. Sem FFmpeg/Whisper reais: o ffprobe foi substituído por respostas fixas, então o comportamento contra um MP4 real não foi exercitado nesta revisão.

## Corrigidos

| # | Achado | Tipo | Severidade | Correção |
|---|---|---|---|---|
| 1 | Narração WAV truncada/corrompida (hash coerente com o manifesto) virava `skipped` em `audio_*` e `duration_narration`; o relatório saía `warn` | falso negativo | alta | `audio_level` e `duration_narration` passam a `fail` com o motivo. WAV que não é PCM 16 bits segue `skipped` (legível, só não medido) |
| 2 | MP4 truncado/ilegível: `ffprobe` com código ≠ 0 virava `skipped` em `duration_video_audio` | falso negativo | alta | `fail` quando o ffprobe rodou e recusou o arquivo; ferramenta ausente, timeout ou falha ao iniciar continuam `skipped` |
| 3 | Cue com texto vazio no SRT causava `IndexError` em `subtitles_vs_words` (derrubava o QC inteiro) | falha/falso negativo | alta | cue sem palavras conta como sem correspondência (`fail`) |
| 4 | Faixa de áudio do MP4 mais curta que a narração, com contêiner na duração certa, passava | falso negativo | média | `fail` se a faixa mede menos que a narração − 0,15 s (a faixa pode ser mais longa: preenchida até o vídeo) |
| 5 | Resolução/fps do MP4 real não eram comparados ao manifesto (o manifesto é medido no MP4 pelo piloto) | falso negativo | média | novo check aditivo `video_format` (resolução igual; fps ± 0,5). Não é emitido se o ffprobe não trouxer dimensões. Não exige 1080×1920: rascunhos menores são legítimos |
| 6 | `script_coverage` guloso: palavra do roteiro ausente nas legendas que reaparecia adiante arrastava o restante e gerava cobertura baixa (0,3 em vez de 0,9) | falso positivo | média | subsequência por blocos (`difflib`); textos enormes usam o guloso com janela de 40 palavras. Roteiro só de pontuação: `skipped` em vez de `0/0` |
| 7 | Alinhamento: seção terminando após a duração do áudio (≤ 50 ms) ou sobreposta à anterior (≤ 50 ms) produzia palavras interpoladas fora de limite e `RuntimeError` (alinhamento perdido) | falso positivo | média | limites efetivos por seção: ≤ duração do áudio e ≥ fim da seção anterior; fuzz de 40 sementes confirma monotonia e limites |
| 8 | Texto livre da proveniência e da revisão (`author`, `notes`, `license.id/name`, URLs) aceitava caracteres de controle C1, U+2028/2029 e marcas bidi (U+202E etc.) | segurança | média | `UNSAFE_TEXT` no contrato (`unsafe_text`), em `ReviewLicense`/`evidence` (422), em `_url_problem` e `asset_sources.base.check_url` |
| 9 | `create` de revisão não verificava se a decisão geraria uma visão efetiva inválida (estado impossível seria gravado e `effective_provenance` viraria `null`) | consistência | baixa | ensaio com `apply_license_reviews` antes do INSERT; falha → 409 existente |

## Verificados sem defeito (cobertos por teste)

Silêncio de borda (início/fim) e interno; clipping no limite (estritamente maior) e em −32768; limites de loudness/true peak inclusivos; `-inf`/`nan`; cauda do renderer (0,8 ± 0,15); vídeo sem faixa de áudio ou de vídeo; cues fora da cena, sobrepostas, invertidas; manifesto com NaN/inf/bool/dimensões absurdas/lacunas/caminhos `..`, `C:`, `\`; alinhamento com números, siglas, pontuação, repetições, seção vazia/de uma palavra, áudio sem fala, ASR fora de ordem/sobreposto/além da duração; revisões append-only (triggers, cadeia `supersedes`, idempotência); URLs `file:`/`javascript:`/`data:`/http/credenciais; path traversal em `asset_id`, `relative_path` e importação local; assinatura de arquivo falsa.

## Não corrigidos (decisão ou fora do escopo)

| Achado | Tipo | Severidade | Motivo |
|---|---|---|---|
| O QC (`asset_provenance`) lê o `asset-provenance.json` registrado, não a visão efetiva com as revisões humanas; após revisar, o check continua `warn` | falso positivo | média | exige acesso ao banco/`api.py`/`production*.py` (fora dos meus arquivos). Sugestão: o chamador passar a visão efetiva (`apply_license_reviews`) ao QC |
| A aprovação da produção não exige revisão de licença prévia | lacuna de política | média | `production.py` fora do escopo; decisão de produto (o piloto é `demo_only`, nunca publicável) |
| `reviewed_by="human"` é declaração do cliente; a API não distingue humano de agente | limitação | média | depende de identidade de usuário, inexistente hoje |
| Cota do alinhamento: ~2 400 palavras no roteiro (6 M células) → `executed=false` com motivo | limitação | baixa | recusa explícita e diagnosticável; vídeos curtos não chegam perto. Mudar a cota é decisão de custo/CPU |
| Preto = luma média < 16: cena muito escura legítima ≥ 0,5 s gera aviso; preto puro depende de o FFmpeg normalizar a faixa de cor | falso positivo/negativo | baixa | sem FFmpeg real aqui, não há como provar o caso; limiar mantido. Validar com um render real antes de qualquer ajuste |
| Silêncio de borda entre 1,0 e 1,5 s não avisa; áudio quase mudo com um pico isolado passa em `audio_level` | falso negativo | baixa | limiares documentados; mudar exige critério de produto e amostras reais |
| `fixture.srt` é o nome fixo preferido pelo QC (há fallback para qualquer `*.srt` ao lado da narração) | acoplamento | baixa | contrato do piloto local; fora do escopo |
