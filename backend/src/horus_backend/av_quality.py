"""QC audiovisual de uma produção: gera `quality-report.json` (contrato em `media_contracts`) a partir dos arquivos reais.

Somente leitura, sem rede e sem instalar nada. FFmpeg/ffprobe vêm por parâmetro (os já preparados na sandbox da
fábrica); sem eles os checks que dependem deles ficam `skipped` com o motivo, nunca inventados. Cada subprocesso
tem timeout e é de posse de `processes.OwnedProcess` (Job Object no Windows): cancelar a tarefa mata a árvore.

API para o worker: `run_quality(...)` (síncrona) e `run_quality_async(...)` (cancelável por `Task.cancel()`).

Layout esperado em `root` (o da produção `local_pilot`): `pilot-evidence.json` (manifesto), assets de ENTRADA
(PNGs de cena, WAVs de seção, narração concatenada), SRT ao lado da narração, MP4 em `**/render/short-rascunho.mp4`
(ou `video_relative`), opcionais `word-timings.json`, `asset-provenance.json` e `plan.json`. Proveniência cruza só os
assets de entrada; MP4, `render/audio-review.wav` e quadros de inspeção são saídas derivadas.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import json
import math
import re
import struct
import wave
import zlib
from difflib import SequenceMatcher
from datetime import datetime, timezone
from pathlib import Path

from . import media_contracts as mc
from .pilot_quality import (CLIP_FRACTION, EDGE_SILENCE_SECONDS, RENDERER_TAIL, SILENCE_PEAK, TAIL_TOLERANCE,
                            WAV_DURATION_TOLERANCE, _confined, _safe_sha256, analyze_wav, validate_pilot_evidence)
from .processes import OwnedProcess

TOOL = {"name": "horus-av-quality", "version": "1"}
NO_VIDEO_HASH = "0" * 64        # sentinela: relatório sem MP4 localizado (check `video_present` falha)
SUBPROCESS_TIMEOUT = 180.0
LONG_SILENCE_SECONDS = 2.0      # silêncio interno acima disso gera aviso
LUFS_TARGET = -16.0              # alvo sugerido na orientação do aviso; não altera a faixa nem o limiar
LUFS_RANGE = (-26.0, -12.0)     # faixa de aviso para fala; referência de plataforma, não requisito do produto
TRUE_PEAK_MAX = -1.0            # dBTP
SUBTITLE_TOLERANCE = 0.05       # cue dentro da cena medida
SYNC_WARN, SYNC_FAIL = 0.30, 1.00   # desvio cue x palavras (s)
COVERAGE_WARN, COVERAGE_FAIL = 0.98, 0.90
BLACK_FAIL_SECONDS = 2.0
FPS_TOLERANCE = 0.5            # mesma tolerância de fps do manifesto (`pilot_quality`)
COVERAGE_LOOKAHEAD = 40         # janela do casamento guloso (só para textos enormes)
COVERAGE_EXACT_CELLS = 4_000_000  # acima disso (palavras do roteiro x legendas) usa o guloso com janela
_SRT_TIME = re.compile(r"(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})")


def _db(value: float) -> float | None:
    return round(20 * math.log10(value), 2) if value > 0 else None


def _check(check_id, category, status, method, detail, measured=None, threshold=None, timecode=None) -> dict:
    item = {"id": check_id, "category": category, "status": status, "method": method,
            "measured": measured or {}, "threshold": threshold or {}, "detail": detail}
    if timecode:
        item["timecode"] = {"start": round(max(timecode[0], 0.0), 3), "end": round(max(timecode[1], timecode[0]), 3)}
    return item


def _skip(check_id, category, reason) -> dict:
    return _check(check_id, category, "skipped", "measured", reason)


def _round(value, digits=3):
    return None if value is None else round(float(value), digits)


# ------------------------------------------------------------------------------ subprocessos

async def _run(command: list[str], timeout: float, binary: bool = False):
    """(returncode, stdout, stderr) ou (None, '', motivo) em timeout/erro; cancelamento mata a árvore e propaga."""
    try:
        owned = await OwnedProcess.start(command)
    except (OSError, NotImplementedError) as error:
        return None, b"" if binary else "", f"não foi possível iniciar o processo ({type(error).__name__})"
    try:
        out, err = await asyncio.wait_for(owned.process.communicate(), timeout=timeout)
        return owned.process.returncode, (out if binary else out.decode("utf-8", "replace")), err.decode("utf-8", "replace")
    except TimeoutError:
        return None, b"" if binary else "", f"timeout de {timeout:.0f}s"
    finally:
        await owned.stop()   # idempotente; também cobre CancelledError
        owned.close()


def _usable(tool: Path | None) -> bool:
    return tool is not None and Path(tool).is_file()


PROBE_REJECTED = "MP4 ilegível ou truncado (rejeitado pelo ffprobe)"


async def _probe(ffprobe: Path | None, video: Path, timeout: float):
    """(dict, "") ou (None, motivo). Motivo iniciado por `PROBE_REJECTED` = o ffprobe rodou e recusou o arquivo."""
    if not _usable(ffprobe):
        return None, "ffprobe indisponível"
    code, out, err = await _run([str(ffprobe), "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
                                 str(video)], timeout)
    if code is None:        # timeout/falha ao iniciar: não é veredito sobre o arquivo
        return None, f"ffprobe falhou: {err.strip()[:200]}"
    if code != 0:
        return None, f"{PROBE_REJECTED}: {err.strip()[:200] or code}"
    try:
        probed = json.loads(out)
    except ValueError:
        return None, f"{PROBE_REJECTED}: saída do ffprobe inválida"
    if not isinstance(probed, dict):
        return None, f"{PROBE_REJECTED}: saída do ffprobe inválida"
    return probed, ""


def _num(text):
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


# ------------------------------------------------------------------------------ SRT

def parse_srt(text: str) -> list[dict] | None:
    """Cues `[{start, end, text}]`; `None` se o arquivo tem bloco malformado."""
    cues = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n").strip()):
        lines = [line for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        index = next((i for i, line in enumerate(lines[:2]) if _SRT_TIME.search(line)), None)
        if index is None:
            return None
        g = [int(x) for x in _SRT_TIME.search(lines[index]).groups()]
        start, end = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000, g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        cues.append({"start": start, "end": end, "text": " ".join(lines[index + 1:])})
    return cues


# ------------------------------------------------------------------------------ contexto da produção

class _Context:
    def __init__(self, root: Path):
        self.root = root
        self.evidence = None
        self.evidence_error = None
        self.narration = None       # Path do WAV concatenado
        self.narration_sha = None
        self.inputs: dict[str, str] = {}   # relative_path -> sha256 real (assets de ENTRADA)
        self.hash_errors: list[str] = []
        self.section_wavs: dict[int, Path] = {}
        self.word_source: str | None = None   # `source` declarado em word-timings.json (None se ausente)
        self.wav_error: str | None = None     # WAV da narração presente mas ilegível/truncado

    def read_json(self, relative: str):
        path, reason = _confined(self.root, relative)
        if path is None:
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            return False        # presente mas ilegível


def _load(ctx: _Context) -> None:
    ctx.evidence = ctx.read_json("pilot-evidence.json")
    if not isinstance(ctx.evidence, dict):
        ctx.evidence_error = "pilot-evidence.json ausente ou ilegível"
        ctx.evidence = None
        return
    verdict = validate_pilot_evidence(ctx.evidence, word_timings=ctx.read_json("word-timings.json"))
    if verdict["blocking_errors"]:
        ctx.evidence_error = "manifesto inválido: " + "; ".join(verdict["blocking_errors"][:3])
        # Uma falha temporal das cues não invalida os hashes/caminhos estruturais:
        # mantenha a falha no relatório e meça a causa contra o áudio real.
        if any(not error.startswith('subtitles_timing:') for error in verdict['blocking_errors']):
            return
    narration_sha = ctx.evidence["narration"]["sha256"]
    for asset in ctx.evidence["assets"]:
        path, reason = _confined(ctx.root, asset["relative_path"])
        if path is None:
            ctx.hash_errors.append(f"{asset['id']}: {reason}")
            continue
        digest = _safe_sha256(path)
        ctx.inputs[asset["relative_path"]] = digest or ""
        if digest != asset["sha256"]:
            ctx.hash_errors.append(f"{asset['id']}: sha256 difere do manifesto")
        if asset['sha256'] == narration_sha and asset['origin'] in {'system_voice','local_tts_model'}:
            ctx.narration, ctx.narration_sha = path, asset["relative_path"]
        match = re.fullmatch(r"section-(\d+)", asset["id"])
        if match:
            ctx.section_wavs[int(match.group(1))] = path


def _find_video(root: Path, explicit: str | None):
    candidates = [explicit] if explicit else []
    if not explicit:
        for found in sorted(root.glob("**/render/short-rascunho.mp4")) + sorted(root.glob("**/render/short.mp4")) + sorted(root.glob("*.mp4")):
            try:
                candidates.append(found.relative_to(root).as_posix())
            except ValueError:
                continue
    for relative in candidates:
        path, _ = _confined(root, relative)
        if path is not None:
            return path
    return None


def _find_srt(ctx: _Context):
    if ctx.narration is None:
        return None
    sibling = ctx.narration.with_name("fixture.srt")
    options = [sibling] if sibling.is_file() else sorted(ctx.narration.parent.glob("*.srt"))
    for option in options:
        try:
            path, _ = _confined(ctx.root, option.relative_to(ctx.root).as_posix())
        except ValueError:
            continue
        if path is not None:
            return path
    return None


# ------------------------------------------------------------------------------ checks (arquivos)

def _check_integrity(ctx: _Context, video: Path | None) -> list[dict]:
    checks = []
    checks.append(_check("video_present", "integrity", "pass" if video else "fail", "measured",
                         "MP4 localizado e confinado à produção." if video else "MP4 da produção não encontrado.",
                         {"source": "filesystem"}))
    if ctx.evidence_error:
        checks.append(_check("evidence_manifest", "integrity", "fail", "declared", ctx.evidence_error,
                             {"source": "pilot_quality.validate_pilot_evidence"}))
        return checks
    checks.append(_check("evidence_manifest", "integrity", "pass", "declared", "Manifesto consistente (não prova os arquivos).",
                         {"source": "pilot_quality.validate_pilot_evidence"}))
    checks.append(_check("asset_hashes", "integrity", "fail" if ctx.hash_errors else "pass", "measured",
                         "; ".join(ctx.hash_errors[:5]) if ctx.hash_errors else f"sha256 de {len(ctx.inputs)} assets de entrada confere.",
                         {"source": "sha256_file", "assets": len(ctx.inputs), "mismatches": len(ctx.hash_errors)}))
    return checks


def _wav(path: Path | None, **kwargs):
    """(estatísticas, motivo, corrompido). `corrompido=True`: o arquivo existe mas não pôde ser lido até o fim."""
    if path is None:
        return None, "WAV da narração indisponível", False
    try:
        return analyze_wav(path, **kwargs), "", False
    except (wave.Error, ValueError, EOFError, OSError) as error:
        return None, f"WAV ilegível: {error if isinstance(error, ValueError) else type(error).__name__}", True


def _check_audio_file(ctx: _Context) -> tuple[list[dict], dict | None]:
    stats, reason, corrupt = _wav(ctx.narration)
    ids = ("audio_clipping", "audio_level", "audio_silence")
    if stats is None and corrupt:
        # Narração truncada/corrompida não é "não medido": o áudio entregue está quebrado e o relatório deve falhar.
        ctx.wav_error = reason
        return [_skip("audio_clipping", "audio", reason),
                _check("audio_level", "audio", "fail", "measured", reason + "; a narração não pôde ser medida até o fim.",
                       {"source": "wav_pcm16_python"}),
                _skip("audio_silence", "audio", reason)], None
    if stats is None:
        return [_skip(i, "audio", reason or "WAV não é PCM 16 bits: não analisado") for i in ids], None
    source = "wav_pcm16_python"
    checks = []
    clipped = stats["clipped_fraction"]
    checks.append(_check("audio_clipping", "audio", "fail" if clipped > CLIP_FRACTION else "pass", "measured",
                         f"{stats['clipped_samples']} amostras no fundo de escala ({clipped:.4%}).",
                         {"source": source, "peak_dbfs": _db(stats["peak"]), "clipped_fraction": round(clipped, 6)},
                         {"max_clipped_fraction": CLIP_FRACTION}))
    mute = stats["peak"] < SILENCE_PEAK
    checks.append(_check("audio_level", "audio", "fail" if mute else "pass", "measured",
                         "Áudio praticamente mudo." if mute else "Pico e RMS da narração medidos.",
                         {"source": source, "peak_dbfs": _db(stats["peak"]), "rms_dbfs": _db(stats["rms"])},
                         {"min_peak_fraction": SILENCE_PEAK}))
    duration, silences = stats["duration"], stats["silences"]
    edge = [s for s in silences if (s[0] == 0 and s[1] > EDGE_SILENCE_SECONDS) or (abs(s[1] - duration) < 0.05 and s[1] - s[0] > EDGE_SILENCE_SECONDS)]
    inner = [s for s in silences if s[1] - s[0] >= LONG_SILENCE_SECONDS and s not in edge]
    worst = max(inner + edge, key=lambda s: s[1] - s[0], default=None)
    status = "warn" if inner or edge else "pass"
    checks.append(_check("audio_silence", "audio", status, "measured",
                         f"{len(inner)} silêncio(s) interno(s) e {len(edge)} de borda acima do limite." if status == "warn"
                         else "Sem silêncio longo.",
                         {"source": source, "longest_seconds": _round(worst[1] - worst[0]) if worst else 0.0,
                          "internal_count": len(inner), "edge_count": len(edge)},
                         {"internal_max_seconds": LONG_SILENCE_SECONDS, "edge_max_seconds": EDGE_SILENCE_SECONDS},
                         timecode=worst))
    return checks, stats


def _check_durations(ctx: _Context, stats: dict | None, probe: dict | None, probe_reason: str) -> list[dict]:
    checks = []
    if ctx.evidence is not None and stats is None and ctx.wav_error:
        return [_check("duration_narration", "duration", "fail", "measured", ctx.wav_error + "; duração não conferida.",
                       {"source": "wave_header"}),
                _skip("duration_video_audio", "duration", "narração ilegível; comparação com o MP4 impossível")]
    if ctx.evidence is None or stats is None:
        return [_skip("duration_narration", "duration", "narração ou manifesto indisponível"),
                _skip("duration_video_audio", "duration", "narração ou manifesto indisponível")]
    declared = ctx.evidence["narration"]["duration_seconds"]
    problems, sections = [], []
    if abs(stats["duration"] - declared) > WAV_DURATION_TOLERANCE:
        problems.append(f"WAV mede {stats['duration']:.3f}s; manifesto declara {declared:.3f}s")
    for n, scene in enumerate(ctx.evidence["scenes"], 1):
        wav_path = ctx.section_wavs.get(n)
        if wav_path is None:
            continue
        try:
            with wave.open(str(wav_path), "rb") as handle:
                length = handle.getnframes() / handle.getframerate()
        except (wave.Error, EOFError, OSError, ZeroDivisionError):
            problems.append(f"seção {n}: WAV ilegível")
            continue
        sections.append(length)
        if abs(length - (scene["end"] - scene["start"])) > WAV_DURATION_TOLERANCE:
            problems.append(f"seção {n}: WAV mede {length:.3f}s; cena declara {scene['end'] - scene['start']:.3f}s")
    checks.append(_check("duration_narration", "duration", "fail" if problems else "pass", "measured",
                         "; ".join(problems[:4]) if problems else "Duração do WAV concatenado e das seções confere com o manifesto.",
                         {"source": "wave_header", "narration_seconds": _round(stats["duration"]),
                          "declared_seconds": _round(declared), "sections_measured": len(sections)},
                         {"tolerance_seconds": WAV_DURATION_TOLERANCE}))
    if probe is None:
        if probe_reason.startswith(PROBE_REJECTED):
            checks.append(_check("duration_video_audio", "duration", "fail", "measured", probe_reason,
                                 {"source": "ffprobe"}))
        else:
            checks.append(_skip("duration_video_audio", "duration", probe_reason or "ffprobe indisponível"))
        return checks
    fmt = _num(probe.get("format", {}).get("duration"))
    audio = next((s for s in probe.get("streams", []) if s.get("codec_type") == "audio"), None)
    video_s = next((s for s in probe.get("streams", []) if s.get("codec_type") == "video"), None)
    issues = []
    if fmt is None:
        issues.append("duração do contêiner não medida")
    else:
        tail = fmt - stats["duration"]
        if abs(tail - RENDERER_TAIL) > TAIL_TOLERANCE:
            issues.append(f"vídeo − narração = {tail:.3f}s; esperado {RENDERER_TAIL}s ± {TAIL_TOLERANCE}s")
    if audio is None:
        issues.append("MP4 sem faixa de áudio")
    else:
        audio_seconds = _num(audio.get("duration"))
        # A faixa de áudio do MP4 precisa conter a narração inteira; mais curta que isso é áudio cortado.
        if audio_seconds is not None and stats["duration"] - audio_seconds > TAIL_TOLERANCE:
            issues.append(f"faixa de áudio do MP4 mede {audio_seconds:.3f}s; narração tem {stats['duration']:.3f}s (áudio cortado)")
    if video_s is None:
        issues.append("MP4 sem faixa de vídeo")
    declared_video = ctx.evidence["video"]["duration_seconds"]
    if fmt is not None and abs(fmt - declared_video) > TAIL_TOLERANCE:
        issues.append(f"MP4 mede {fmt:.3f}s; manifesto declara {declared_video:.3f}s")
    measured = {"source": "ffprobe", "video_seconds": _round(fmt), "narration_seconds": _round(stats["duration"]),
                "tail_seconds": _round(fmt - stats["duration"]) if fmt is not None else None,
                "audio_stream_seconds": _round(_num(audio.get("duration"))) if audio else None}
    checks.append(_check("duration_video_audio", "duration", "fail" if issues else "pass", "measured",
                         "; ".join(issues) if issues else "Vídeo = narração medida + cauda do renderer.",
                         measured, {"expected_tail_seconds": RENDERER_TAIL, "tolerance_seconds": TAIL_TOLERANCE}))
    if video_s is not None:
        format_check = _video_format(ctx.evidence["video"], video_s)
        if format_check:
            checks.append(format_check)
    return checks


def _fps(stream: dict) -> float | None:
    for key in ("avg_frame_rate", "r_frame_rate"):
        text = stream.get(key)
        if isinstance(text, str) and "/" in text:
            numerator, _, denominator = text.partition("/")
            top, bottom = _num(numerator), _num(denominator)
            if top is not None and bottom:
                return top / bottom
        elif (value := _num(text)) is not None:
            return value
    return None


def _video_format(declared: dict, stream: dict) -> dict | None:
    """Resolução e fps do MP4 real contra o declarado no manifesto (o piloto mede o manifesto no próprio MP4)."""
    width, height, fps = stream.get("width"), stream.get("height"), _fps(stream)
    if type(width) is not int or type(height) is not int:
        return None         # ffprobe sem dimensões: nada a afirmar
    problems = []
    if (width, height) != (declared["width"], declared["height"]):
        problems.append(f"MP4 mede {width}x{height}; manifesto declara {declared['width']}x{declared['height']}")
    declared_fps = declared["frames"] / declared["duration_seconds"]
    if fps is not None and abs(fps - declared_fps) > FPS_TOLERANCE:
        problems.append(f"MP4 mede {fps:.2f} fps; manifesto declara {declared_fps:.2f} fps")
    return _check("video_format", "duration", "fail" if problems else "pass", "measured",
                  "; ".join(problems) if problems else "Resolução e fps do MP4 conferem com o manifesto.",
                  {"source": "ffprobe", "width": width, "height": height, "fps": _round(fps, 2),
                   "declared_width": declared["width"], "declared_height": declared["height"],
                   "declared_fps": _round(declared_fps, 2)},
                  {"fps_tolerance": FPS_TOLERANCE})


def _check_sync(ctx: _Context, stats: dict | None, srt: Path | None) -> list[dict]:
    plan = ctx.read_json("plan.json")
    script_tokens = None
    if isinstance(plan, dict):
        try:
            script_tokens = " ".join(line["narracao"] for line in plan["roteiro"]["linhas"]).split()
        except (KeyError, TypeError):
            script_tokens = None
    cues, reason = None, "SRT não encontrado ao lado da narração"
    if srt is not None:
        try:
            cues = parse_srt(srt.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeDecodeError):
            cues = None
        reason = "SRT ilegível ou malformado"
    checks = []
    if not cues or ctx.evidence is None:
        checks.append(_skip("subtitles_vs_sections", "subtitles", reason if not cues else "manifesto indisponível"))
        checks.append(_skip("script_coverage", "subtitles", reason if not cues else "manifesto indisponível"))
    else:
        if ctx.evidence.get('alignment_method') == 'forced_alignment':
            from .pilot_quality import caption_holds
            raw_words = ctx.read_json('word-timings.json')
            hold = caption_holds(cues, raw_words.get('words', []) if isinstance(raw_words, dict) else [],
                                 ctx.evidence['video']['duration_seconds'], ctx.evidence['scenes'])
            checks.append(_check('subtitles_vs_sections', 'subtitles', 'fail' if hold['errors'] else 'pass',
                'measured', '; '.join(hold['errors'][:4]) or 'Contenção por palavras com manutenção visual declarada.',
                {'source':'srt_vs_measured_words+factory_caption_hold', **hold}))
        else:
            checks.append(_cues_vs_sections(cues, ctx.evidence["scenes"]))
        checks.append(_coverage(cues, script_tokens))
    checks.extend(_word_checks(ctx, stats, cues, script_tokens))
    return checks


def _cues_vs_sections(cues: list[dict], scenes: list[dict]) -> dict:
    problems, worst, previous_end = [], None, 0.0
    for n, cue in enumerate(cues, 1):
        middle = (cue["start"] + cue["end"]) / 2
        scene = next((s for s in scenes if s["start"] <= middle < s["end"]), None)
        if cue["end"] <= cue["start"]:
            problems.append(f"cue {n}: end <= start")
        elif cue["start"] < previous_end - SUBTITLE_TOLERANCE:
            problems.append(f"cue {n}: sobrepõe o anterior")
        elif scene is None or cue["start"] < scene["start"] - SUBTITLE_TOLERANCE or cue["end"] > scene["end"] + SUBTITLE_TOLERANCE:
            problems.append(f"cue {n}: fora da cena/seção medida")
        if problems and worst is None:
            worst = (cue["start"], cue["end"])
        previous_end = cue["end"]
    last = scenes[-1]["end"]
    tail_gap = last - cues[-1]["end"]
    return _check("subtitles_vs_sections", "subtitles", "fail" if problems else "pass", "measured",
                  "; ".join(problems[:4]) if problems else "Todas as cues dentro das seções medidas, em ordem, sem sobreposição.",
                  {"source": "srt_parse+wav_section_durations", "cues": len(cues), "problems": len(problems),
                   "last_cue_gap_to_speech_end_seconds": _round(tail_gap)},
                  {"tolerance_seconds": SUBTITLE_TOLERANCE}, timecode=worst)


def _ordered_hits(script: list[str], subs: list[str]) -> int:
    """Palavras do roteiro presentes, em ordem, nas legendas (subsequência comum).

    Casamento por blocos (difflib): uma palavra ausente que reaparece mais adiante não arrasta o resto do roteiro,
    como acontecia no casamento guloso. Textos enormes usam o guloso com janela, para limitar o custo.
    """
    if len(script) * len(subs) <= COVERAGE_EXACT_CELLS:
        matcher = SequenceMatcher(None, script, subs, autojunk=False)
        return sum(block.size for block in matcher.get_matching_blocks())
    i = hit = 0
    for token in script:
        j, limit = i, min(len(subs), i + COVERAGE_LOOKAHEAD)
        while j < limit and subs[j] != token:
            j += 1
        if j < limit:
            hit, i = hit + 1, j + 1
    return hit


def _coverage(cues: list[dict], script_tokens: list[str] | None) -> dict:
    if not script_tokens:
        return _skip("script_coverage", "subtitles", "plan.json (texto do roteiro) ausente na produção")
    norm = lambda t: re.sub(r"\W+", "", t.casefold())  # noqa: E731
    subs = [norm(t) for cue in cues for t in cue["text"].split()]
    script = [norm(t) for t in script_tokens if norm(t)]
    subs = [t for t in subs if t]
    if not script:
        return _skip("script_coverage", "subtitles", "roteiro sem palavras comparáveis (só pontuação)")
    hit = _ordered_hits(script, subs)
    ratio = hit / len(script) if script else 0.0
    status = "pass" if ratio >= COVERAGE_WARN else "warn" if ratio >= COVERAGE_FAIL else "fail"
    return _check("script_coverage", "subtitles", status, "measured",
                  f"{hit}/{len(script)} palavras do roteiro aparecem, em ordem, nas legendas.",
                  {"source": "srt_vs_plan_text", "coverage": round(ratio, 4), "script_words": len(script)},
                  {"warn_below": COVERAGE_WARN, "fail_below": COVERAGE_FAIL})


def _alignment_reason(report) -> str | None:
    """Motivo registrado pelo piloto (`alignment-report.json`) para a fala não estar alinhada; nunca inventa um."""
    if not isinstance(report, dict):
        return None
    reason = report.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        return None
    prefix = "alinhamento acústico não executado: " if report.get("executed") is False else "alinhamento acústico abaixo do critério: "
    return prefix + reason.strip()[:300]


def _word_checks(ctx: _Context, stats, cues, script_tokens) -> list[dict]:
    raw = ctx.read_json("word-timings.json")
    declared = raw.get("source") if isinstance(raw, dict) else None
    ctx.word_source = declared if isinstance(declared, str) else None
    method = "estimated" if ctx.word_source == "estimated" else "measured"   # vale também para documento inválido
    if raw is None:
        why = "word-timings.json ausente; sincronia por palavra não medida"
        return [_skip("word_timings", "sync", why), _skip("subtitles_vs_words", "sync", why)]
    if ctx.evidence is None or stats is None:
        why = "narração ou manifesto indisponível para validar word-timings"
        return [_skip("word_timings", "sync", why), _skip("subtitles_vs_words", "sync", why)]
    sections = [{"section": n, "start": s["start"], "end": s["end"]} for n, s in enumerate(ctx.evidence["scenes"], 1)]
    verdict = mc.validate_word_timings(
        raw, narration_sha256=ctx.evidence["narration"]["sha256"], duration_seconds=stats["duration"],
        script_text=" ".join(script_tokens) if script_tokens else None, sections=sections)
    if not verdict["ok"]:
        return [_check("word_timings", "sync", "fail", method, "; ".join(
            f"{e['code']}@{e['path']}" for e in verdict["errors"][:4]),
            {"source": "media_contracts.validate_word_timings", "errors": len(verdict["errors"])}),
            _skip("subtitles_vs_words", "sync", "word-timings inválido")]
    value = verdict["value"]
    method = "estimated" if value["source"] == "estimated" else "measured"
    detail = f"fonte {value['source']}; speech_aligned={verdict['speech_aligned']}"
    if verdict["warnings"]:
        detail += "; contexto parcial: " + ", ".join(verdict["warnings"])
    if not verdict["speech_aligned"] and (why := _alignment_reason(ctx.read_json("alignment-report.json"))):
        detail += "; " + why
    checks = [_check("word_timings", "sync", "pass" if verdict["speech_aligned"] else "warn", method, detail,
                     {"source": "media_contracts.validate_word_timings", "timing_source": value["source"],
                      "speech_aligned": verdict["speech_aligned"], "words": len(value["words"])})]
    if not cues:
        checks.append(_skip("subtitles_vs_words", "sync", "SRT indisponível"))
        return checks
    checks.append(_cues_vs_words(cues, value["words"], method, value["source"]))
    return checks


def _cues_vs_words(cues, words, method, timing_source) -> dict:
    # Palavras `interpolated` (forced_alignment sem correspondência acústica) não são medição: o desvio só usa cues
    # cujas palavras de borda são medidas; as demais são contadas e informadas.
    deviations, unmatched, position, worst = [], 0, 0, (0.0, None)
    interpolated_words = sum(1 for w in words if w.get("timing") == "interpolated")
    unmeasured_cues = 0
    for n, cue in enumerate(cues):
        tokens = cue["text"].split()
        chunk = words[position:position + len(tokens)]
        if not tokens or len(chunk) != len(tokens) or [w["text"] for w in chunk] != tokens:
            unmatched += 1
            continue
        position += len(tokens)
        if chunk[0].get("timing") == "interpolated" or chunk[-1].get("timing") == "interpolated":
            unmeasured_cues += 1
            continue
        deviation = max(abs(cue["start"] - chunk[0]["start"]), abs(cue["end"] - chunk[-1]["end"]))
        deviations.append(deviation)
        if deviation > worst[0]:
            worst = (deviation, (cue["start"], cue["end"]))
    extra = {"interpolated_words": interpolated_words, "cues_edge_interpolated": unmeasured_cues} if interpolated_words else {}
    if not deviations:
        if unmeasured_cues and not unmatched:
            return _check("subtitles_vs_words", "sync", "warn", method,
                          f"nenhuma cue com palavras de borda medidas ({unmeasured_cues} com borda interpolada; {interpolated_words} palavras interpoladas).",
                          {"source": f"srt_vs_word_timings:{timing_source}", "unmatched_cues": 0, **extra})
        return _check("subtitles_vs_words", "sync", "fail", method, f"nenhuma cue casou com as palavras ({unmatched} sem correspondência).",
                      {"source": f"srt_vs_word_timings:{timing_source}", "unmatched_cues": unmatched})
    maximum, mean = max(deviations), sum(deviations) / len(deviations)
    status = "fail" if maximum > SYNC_FAIL or unmatched else "warn" if maximum > SYNC_WARN else "pass"
    return _check("subtitles_vs_words", "sync", status, method,
                  f"desvio máximo {maximum:.3f}s, médio {mean:.3f}s em {len(deviations)} cues"
                  + (f"; {unmatched} cues sem correspondência" if unmatched else "")
                  + (f"; {unmeasured_cues} cues com borda interpolada fora do desvio ({interpolated_words} palavras interpoladas)"
                     if interpolated_words else "")
                  + ("; word-timings estimado: não é medição de fala" if method == "estimated" else ""),
                  {"source": f"srt_vs_word_timings:{timing_source}", "max_deviation_seconds": _round(maximum),
                   "mean_deviation_seconds": _round(mean), "cues_matched": len(deviations), "unmatched_cues": unmatched,
                   **extra},
                  {"warn_seconds": SYNC_WARN, "fail_seconds": SYNC_FAIL}, timecode=worst[1])


def _check_provenance(ctx: _Context) -> dict:
    if ctx.evidence is None:
        return _skip("asset_provenance", "provenance", "manifesto indisponível")
    raw = ctx.read_json("asset-provenance.json")
    if raw is None:
        unverified = [a["id"] for a in ctx.evidence["assets"] if a["license"] != "original"]
        status = "warn" if unverified else "pass"
        return _check("asset_provenance", "provenance", status, "declared",
                      "asset-provenance.json ausente; licenças vêm só do manifesto declarado"
                      + (f" ({len(unverified)} sem licença verificada)." if unverified else "."),
                      {"source": "pilot-evidence.assets", "inputs": len(ctx.inputs), "unverified": len(unverified)})
    registered = {path: digest for path, digest in ctx.inputs.items() if digest}
    return provenance_check(raw, registered)


def provenance_check(provenance: dict, artifacts: dict) -> dict:
    """Mesmo check para a proveniência registrada ou sua visão efetiva em leitura."""
    verdict = mc.validate_asset_provenance(provenance, artifacts=artifacts)
    if not verdict["ok"]:
        return _check("asset_provenance", "provenance", "fail", "measured",
                      "; ".join(f"{e['code']}@{e['path']}" for e in verdict["errors"][:4]),
                      {"source": "media_contracts.validate_asset_provenance", "errors": len(verdict["errors"])})
    unverified = "unverified_assets_block_publication" in verdict["warnings"]
    return _check("asset_provenance", "provenance", "warn" if unverified else "pass", "measured",
                  "Proveniência cruza com os hashes dos assets de entrada; há assets não verificados por humano."
                  if unverified else "Proveniência verificada e cruzada com os hashes de entrada.",
                  {"source": "media_contracts.validate_asset_provenance", "assets": len(verdict["value"]["assets"])})


# ------------------------------------------------------------------------------ checks (FFmpeg)

async def _loudness(ffmpeg: Path, video: Path, timeout: float) -> dict:
    """Loudness integrada: `ebur128` se o build tiver o filtro; senão a análise do `loudnorm` (mesma norma BS.1770)."""
    base = [str(ffmpeg), "-hide_banner", "-nostats", "-i", str(video), "-vn", "-af"]
    tail = ["-c:a", "pcm_s16le", "-f", "null", "-"]
    code, _, err = await _run(base + ["ebur128=peak=true:framelog=quiet"] + tail, timeout)
    lufs = peak = lra = None
    if code == 0:
        summary = err.rsplit("Summary:", 1)[-1]
        found = re.search(r"I:\s+(-?inf|-?[\d.]+)\s+LUFS", summary)
        if found:
            lufs, source = found.group(1), "ffmpeg_ebur128"
            peak = (re.search(r"Peak:\s+(-?inf|-?[\d.]+)\s+dBFS", summary) or [None, None])[1]
            lra = (re.search(r"LRA:\s+([\d.]+)\s+LU", summary) or [None, None])[1]
    if lufs is None and ("No such filter" in err or code == 0):
        code, _, err = await _run(base + ["loudnorm=print_format=json"] + tail, timeout)
        found = re.search(r'"input_i"\s*:\s*"(-?inf|-?[\d.]+)"', err) if code == 0 else None
        if found:
            lufs, source = found.group(1), "ffmpeg_loudnorm_analysis"
            peak = (re.search(r'"input_tp"\s*:\s*"(-?inf|-?[\d.]+)"', err) or [None, None])[1]
            lra = (re.search(r'"input_lra"\s*:\s*"([\d.]+)"', err) or [None, None])[1]
    if lufs is None:
        return _skip("audio_loudness", "audio", "FFmpeg sem filtro de loudness utilizável (ebur128/loudnorm): "
                     + (err.strip()[-120:] or "sem saída"))
    return _loudness_check(_num(lufs), _num(peak), _num(lra), source)


def _loudness_check(value, true_peak, lra, source) -> dict:
    problems = []
    if value is None:
        problems.append("áudio sem energia mensurável (-inf LUFS)")
    elif not LUFS_RANGE[0] <= value <= LUFS_RANGE[1]:
        direction = "aumente o ganho" if value < LUFS_RANGE[0] else "reduza o ganho"
        problems.append(f"loudness integrada {value:.1f} LUFS fora de {LUFS_RANGE[0]:.0f}..{LUFS_RANGE[1]:.0f}; "
                        f"{direction} e normalize a narração para cerca de {LUFS_TARGET:.0f} LUFS antes de renderizar")
    if true_peak is not None and true_peak > TRUE_PEAK_MAX:
        problems.append(f"true peak {true_peak:.1f} dBTP acima de {TRUE_PEAK_MAX:.0f}; reduza o ganho ou aplique limitador de pico")
    return _check("audio_loudness", "audio", "warn" if problems else "pass", "measured",
                  "; ".join(problems) if problems else "Loudness integrada e true peak dentro da faixa de referência.",
                  {"source": source, "integrated_lufs": value, "true_peak_dbtp": true_peak, "lra_lu": lra},
                  {"integrated_lufs_range": list(LUFS_RANGE), "true_peak_max_dbtp": TRUE_PEAK_MAX})


ANALYSIS_FPS, THUMB_W, THUMB_H = 10, 64, 112
BLACK_LUMA, FREEZE_DIFF, FREEZE_MIN_SECONDS, BLACK_MIN_SECONDS = 16.0, 0.05, 4.0, 0.5


def _intervals(flags: list[bool], minimum: float) -> list[tuple[float, float]]:
    runs, start = [], None
    for index, flag in enumerate(flags + [False]):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            if (index - start) / ANALYSIS_FPS >= minimum:
                runs.append((start / ANALYSIS_FPS, index / ANALYSIS_FPS))
            start = None
    return runs


def _gray_pngs(data: bytes) -> list[bytes]:
    """Decodifica PNGs 8 bits em tons de cinza concatenados (saída `image2pipe`); lista vazia se algo não confere."""
    signature, frames, position = bytes([0x89]) + b"PNG" + bytes([13, 10, 26, 10]), [], 0
    try:
        while position < len(data):
            if data[position:position + 8] != signature:
                return []
            position += 8
            idat, width = bytearray(), 0
            while True:
                length, kind = struct.unpack(">I4s", data[position:position + 8])
                body = data[position + 8:position + 8 + length]
                position += 12 + length
                if kind == b"IHDR":
                    width, height, depth, color, _c, _f, interlace = struct.unpack(">IIBBBBB", body)
                    if (width, height, depth, color, interlace) != (THUMB_W, THUMB_H, 8, 0, 0):
                        return []
                elif kind == b"IDAT":
                    idat += body
                elif kind == b"IEND":
                    break
            raw = zlib.decompress(bytes(idat))
            if len(raw) != (THUMB_W + 1) * THUMB_H:
                return []
            rows, previous = [], bytearray(THUMB_W)
            for y in range(THUMB_H):
                ftype, line = raw[y * (THUMB_W + 1)], bytearray(raw[y * (THUMB_W + 1) + 1:(y + 1) * (THUMB_W + 1)])
                for x in range(THUMB_W):
                    a = line[x - 1] if x else 0
                    b, c = previous[x], previous[x - 1] if x else 0
                    if ftype == 1:
                        line[x] = (line[x] + a) & 255
                    elif ftype == 2:
                        line[x] = (line[x] + b) & 255
                    elif ftype == 3:
                        line[x] = (line[x] + (a + b) // 2) & 255
                    elif ftype == 4:
                        p = a + b - c
                        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                        line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
                    elif ftype != 0:
                        return []
                rows.append(bytes(line))
                previous = line
            frames.append(b"".join(rows))
    except (struct.error, zlib.error, ValueError):
        return []
    return frames


async def _visual(ffmpeg: Path, video: Path, timeout: float) -> list[dict]:
    """Quadros pretos/congelados por miniaturas em tons de cinza (scale+format+rawvideo do próprio FFmpeg, 10 fps)."""
    why = None
    code, raw, err = await _run([str(ffmpeg), "-hide_banner", "-loglevel", "error", "-i", str(video), "-an", "-vf",
                                 f"scale={THUMB_W}:{THUMB_H},format=gray", "-r", str(ANALYSIS_FPS), "-c:v", "png",
                                 "-f", "image2pipe", "-"], timeout, binary=True)
    size = THUMB_W * THUMB_H
    frames = _gray_pngs(raw) if code == 0 else []
    if not frames:
        why = "extração de quadros falhou: " + (err.strip()[-120:] or "sem quadros")
        return [_skip("visual_black_frames", "visual", why), _skip("visual_freeze", "visual", why)]
    means = [sum(frame) / size for frame in frames]
    diffs = [None] + [sum(abs(a - b) for a, b in zip(frames[i], frames[i - 1])) / size for i in range(1, len(frames))]
    black = _intervals([m < BLACK_LUMA for m in means], BLACK_MIN_SECONDS)
    freeze = _intervals([d is not None and d < FREEZE_DIFF for d in diffs], FREEZE_MIN_SECONDS)
    total = sum(b - a for a, b in black)
    source = f"ffmpeg_gray_png_{THUMB_W}x{THUMB_H}_{ANALYSIS_FPS}fps+python"
    return [
        _check("visual_black_frames", "visual", "fail" if total > BLACK_FAIL_SECONDS else "warn" if black else "pass",
               "measured", f"{len(black)} trecho(s) preto(s), {total:.2f}s no total." if black else "Sem quadros pretos de 0,5s ou mais.",
               {"source": source, "frames_analyzed": len(frames), "intervals": len(black), "total_seconds": _round(total)},
               {"luma_below": BLACK_LUMA, "min_duration_seconds": BLACK_MIN_SECONDS, "fail_total_seconds": BLACK_FAIL_SECONDS},
               timecode=black[0] if black else None),
        _check("visual_freeze", "visual", "warn" if freeze else "pass", "measured",
               f"{len(freeze)} trecho(s) sem mudança visual por 4s ou mais (cena estática pode ser intencional)." if freeze
               else "Sem trecho congelado por 4s ou mais.",
               {"source": source, "frames_analyzed": len(frames), "intervals": len(freeze)},
               {"max_mean_abs_diff": FREEZE_DIFF, "min_duration_seconds": FREEZE_MIN_SECONDS},
               timecode=freeze[0] if freeze else None)]


async def _check_ffmpeg(ffmpeg: Path | None, video: Path | None, timeout: float) -> list[dict]:
    ids = [("audio_loudness", "audio"), ("visual_black_frames", "visual"), ("visual_freeze", "visual")]
    if video is None:
        return [_skip(i, c, "MP4 ausente") for i, c in ids]
    if not _usable(ffmpeg):
        return [_skip(i, c, "ffmpeg indisponível; não medido") for i, c in ids]
    return [await _loudness(Path(ffmpeg), video, timeout)] + await _visual(Path(ffmpeg), video, timeout)


# ------------------------------------------------------------------------------ orquestração

async def run_quality_async(root: Path, *, production_id: str, ffmpeg: Path | None = None, ffprobe: Path | None = None,
                            video_relative: str | None = None, timeout: float = SUBPROCESS_TIMEOUT) -> dict:
    """Relatório válido (`media_contracts.QualityReport`). Cancelar a tarefa mata os subprocessos do FFmpeg."""
    root = Path(root)
    ctx = _Context(root)
    video = _find_video(root, video_relative) if root.is_dir() else None
    await asyncio.to_thread(_load, ctx)
    video_sha = (await asyncio.to_thread(_safe_sha256, video) if video else None) or NO_VIDEO_HASH
    checks = _check_integrity(ctx, video)
    probe, probe_reason = await _probe(ffprobe, video, timeout) if video else (None, "MP4 ausente")
    audio_checks, stats = await asyncio.to_thread(_check_audio_file, ctx)
    checks += audio_checks
    checks += await asyncio.to_thread(_check_durations, ctx, stats, probe, probe_reason)
    srt = await asyncio.to_thread(_find_srt, ctx)
    checks += await asyncio.to_thread(_check_sync, ctx, stats, srt)
    checks.append(await asyncio.to_thread(_check_provenance, ctx))
    checks += await _check_ffmpeg(ffmpeg, video, timeout)
    report = {"schema_version": 1, "production_id": production_id, "video_sha256": video_sha,
              "generated_at": datetime.now(timezone.utc).isoformat(), "tool": TOOL,
              "status": mc.derive_report_status([mc.QualityCheck.model_validate(c) for c in checks]),
              "checks": checks, "blocking_errors": [c["id"] for c in checks if c["status"] == "fail"],
              "warnings": [c["id"] for c in checks if c["status"] == "warn"]}
    verdict = mc.validate_quality_report(report, video_sha256=video_sha, production_id=production_id,
                                         word_timings_source=ctx.word_source)
    if not verdict["ok"]:   # bug do próprio QC: nunca devolver relatório inválido como se fosse válido
        raise RuntimeError("quality-report gerado viola o contrato: " + "; ".join(e["code"] for e in verdict["errors"][:5]))
    return verdict["value"]


def run_quality(root: Path, *, production_id: str, ffmpeg: Path | None = None, ffprobe: Path | None = None,
                video_relative: str | None = None, timeout: float = SUBPROCESS_TIMEOUT) -> dict:
    """Versão síncrona; segura dentro de um loop asyncio em execução (roda em thread própria)."""
    call = lambda: asyncio.run(run_quality_async(  # noqa: E731
        root, production_id=production_id, ffmpeg=ffmpeg, ffprobe=ffprobe, video_relative=video_relative, timeout=timeout))
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return call()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(call).result()
