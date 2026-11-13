# Qualidade e sincronização do piloto local (HOR-089 / HOR-097)

Escopo: validar a evidência de um piloto local com voz Windows SAPI pt-BR, PNG originais e SRT segmentado por áudio medido. Tudo é demonstração (`demo_only=true`); nada aqui autoriza publicação, upload ou conclusão de licença. Código: `backend/src/horus_backend/pilot_quality.py`; testes: `backend/tests/test_pilot_quality.py`.

## Implementado × pendente

| Item | Estado |
|---|---|
| `validate_pilot_evidence(evidence) -> dict` (pura, só manifesto) | Implementado e testado (dados fictícios) |
| `inspect_pilot_files(root, evidence)` (hash de assets, duração/pico/clipping/silêncio do WAV PCM 16 bits, confinada a `root`) | Implementado e testado com WAV sintético em `tmp_path` |
| Inspeção do MP4 real (dimensões, duração, frames, áudio, legendas queimadas) | **Pendente**: checklist abaixo, manual/após a entrega do Codex |
| Alinhamento por palavra | **Não implementado**; sinalizado como `not_checked` e aviso |
| Loudness (LUFS), inteligibilidade, qualidade da voz | **Não medidos** |
| Licença da voz do Windows / publicação | **Não concluída**; `publishable` é sempre `false` |
| Integração com API/worker/UI | Fora do escopo desta entrega |

Este módulo não cria renderer: reutiliza a premissa da fábrica original (somente leitura) de que o vídeo dura áudio medido + `FOLGA_FINAL_SEG = 0.8` (`fabrica/render.py`).

## Schema `pilot-evidence.json` (versão 1)

```json
{
  "schema_version": 1,
  "demo_only": true,
  "alignment_method": "measured_sections",
  "narration": {"kind": "local_tts", "engine": "windows_sapi", "voice": "…", "duration_seconds": 10.0, "sha256": "<64 hex minúsculos>"},
  "scenes": [{"id": "c1", "start": 0, "end": 4.0, "asset_id": "png1"}],
  "subtitles": [{"start": 0.2, "end": 3.8, "text": "…"}],
  "assets": [{"id": "png1", "relative_path": "assets/c1.png", "sha256": "…", "origin": "original_local|system_voice",
              "license": "original|unverified", "attribution": "…", "generated_at": "2026-11-13T10:00:00Z"}],
  "video": {"duration_seconds": 10.8, "width": 1080, "height": 1920, "frames": 324}
}
```

Campos extras ou ausentes em qualquer objeto são erro. Tipos estritos: `bool` não é número nem versão; `str` nunca é coagida; números devem ser finitos e `<= 3600 s`; `width/height/frames` são `int`. IDs: `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`, únicos. `relative_path`: relativo, sem `..`, `.`, barra invertida, `:` (URL/unidade), segmento vazio ou terminado em ponto/espaço; único sem diferenciar maiúsculas (Windows). `sha256`: 64 hex minúsculos. `generated_at`: ISO 8601. Limites: 200 cenas, 2000 legendas, 500 assets, texto de legenda `<= 1000` caracteres.

## Resultado

`{schema_version: 1, checks: [{id, status: pass|fail|not_checked, detail}], blocking_errors: [str], warnings: [str], publishable: false}`. A função nunca levanta exceção, não altera a entrada, não usa rede, subprocesso nem disco. `blocking_errors` tem o formato `"<check_id>: mensagem"`.

Checks: `schema`, `demo_flag`, `alignment_method`, `narration`, `video`, `assets_structure`, `assets_paths`, `assets_hashes`, `scene_contiguity`, `scene_assets`, `subtitles_structure`, `subtitles_timing`, `duration_consistency`, `provenance_licenses`, `acoustic_evidence`, `word_alignment`, `physical_files`, `publishability`.

Sempre `not_checked` na validação pura: `acoustic_evidence`, `word_alignment`, `physical_files`, `publishability`. `provenance_licenses` fica `not_checked` quando há qualquer licença `unverified` (a demonstração local continua válida; só a publicação é bloqueada). Um manifesto sem erros **não** significa que o piloto é bom, apenas consistente.

## Regras e tolerâncias

| Regra | Tolerância |
|---|---|
| Cenas: primeira em 0, contíguas, `end > start` | 0,01 s |
| Fim da última cena ≈ duração medida do áudio (ou ≈ duração do vídeo, que inclui a cauda) | 0,05 s (áudio) / 0,15 s (vídeo) |
| Vídeo − áudio = cauda do renderer | 0,8 s ± 0,15 s |
| Legendas: em ordem, sem sobreposição, terminam até o fim da fala medida, cada uma dentro de uma única cena | 0,01 s |
| fps implícito (`frames/duration`) | 10–120; aviso se ≠ 30 (±0,5); aviso se resolução ≠ 1080×1920 |
| Cena sem legenda, asset original sem uso | aviso |
| Cena aponta para asset inexistente ou `system_voice` | erro |
| `narration.sha256` deve coincidir com um asset `system_voice` | erro |
| Asset `system_voice` com `license=original` | erro: presença da voz no PC não prova licença comercial |

## Inspeção física opcional (`inspect_pilot_files`)

Reaproveita a validação do manifesto (manifesto inválido → `physical_files` `not_checked`). Lê só dentro de `root`, recusa `root` symlink/junction, symlink/junction em qualquer componente do caminho (`os.path.isjunction` no Windows), caminhos fora do diretório e arquivos `> 512 MiB`. Limites da proteção: pais do próprio `root` não são verificados, e há uma janela entre a verificação e a leitura (não é defesa contra troca concorrente). `OSError` durante o hash vira falha em `physical_files`. Confere o SHA-256 de cada asset e, no WAV da narração (módulo `wave`, PCM 16 bits): duração vs. manifesto (±0,05 s), WAV truncado (bytes/frames PCM efetivamente lidos devem igualar o declarado no header; um arquivo truncado com hash recalculado passa em `physical_files` mas reprova em `acoustic_evidence`), áudio mudo (pico `< 1%`), clipping (`> 0,1%` das amostras no fundo de escala); silêncio de borda `> 1,5 s` (contado por frame, correto em estéreo) gera aviso. WAV de outro formato deixa `acoustic_evidence` como `not_checked`. **Não abre o MP4.** Loudness e inteligibilidade continuam sem medição.

## Checklist executável para o MP4 real do Codex (pendente)

Execute com `$V` = MP4 e `$E` = `pilot-evidence.json` da mesma entrega; use somente arquivos locais.

1. Manifesto: `backend/.venv/Scripts/python.exe -c "import json,sys;from horus_backend.pilot_quality import inspect_pilot_files as i;r=i(sys.argv[1],json.load(open(sys.argv[2],encoding='utf-8')));print(json.dumps(r,ensure_ascii=False,indent=1))" <pasta-da-entrega> $E` (com `PYTHONPATH=backend/src`). Esperado: `blocking_errors` vazio, `physical_files` e `acoustic_evidence` `pass`, `publishable=false`.
2. Contêiner: `ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,nb_frames,r_frame_rate,duration -of json $V` (ffprobe local, se disponível). Conferir 1080×1920, ~30 fps, `duration` do vídeo = `video.duration_seconds` (±0,15 s), `nb_frames` = `video.frames` (±2), stream de áudio presente.
3. Cauda: duração do MP4 − `narration.duration_seconds` ≈ 0,8 s.
4. Amostragem visual: extrair quadros no início de cada cena (`ffmpeg -ss <start+0.1> -i $V -frames:v 1 c<N>.png`, saída em pasta temporária) e conferir que a imagem corresponde ao PNG do `asset_id` da cena e que a troca ocorre perto de `scene.start` (±1 quadro).
5. Legendas: assistir cada fronteira de cena; a legenda aparece dentro da fala, nunca cruza a troca de cena nem sobrepõe a seguinte. Texto sem corte nem estouro da área segura.
6. Áudio: ouvir a narração inteira (voz pt-BR, sem cortes, sem estalos); confirmar que não há silêncio longo inicial/final nem distorção. Loudness (opcional): `ffmpeg -i $V -af ebur128 -f null -`.
7. Registro de proveniência: cada PNG original e a voz SAPI constam em `assets` com `license=unverified` (a voz) e atribuição; nenhuma afirmação de licença comercial.
8. Publicação: permanece bloqueada. Revisão humana decide; este checklist não a substitui.

Anotar cada passo como executado, aprovado, reprovado ou não executado; um passo não executado não conta como aprovação.
