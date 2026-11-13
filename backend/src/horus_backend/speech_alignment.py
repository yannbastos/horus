"""Alinhamento acústico local da narração (HOR-054): `word-timings.json` com `source=forced_alignment`.

Método: o faster-whisper (CPU, offline, `word_timestamps=True`) reconhece a fala do WAV; as palavras reconhecidas são
alinhadas ao texto do roteiro por programação dinâmica (subsequência comum de maior pontuação), tolerante a
pontuação, caixa, acentos, hifens e números por extenso. Cada palavra do roteiro casada recebe o tempo medido pelo ASR.
Palavras sem correspondência recebem tempo **interpolado** entre âncoras medidas e são declaradas
`timing="interpolated"`: nunca aparecem como medidas. `speech_aligned` só é verdadeiro se a taxa de casamento atinge
`media_contracts.MIN_MATCH_RATE` e nenhum trecho interpolado contínuo passa de `MAX_INTERPOLATED_RUN_SECONDS`.

`align_script` é pura (sem disco, rede ou subprocesso). `run_alignment` executa o ASR em subprocesso possuído
(`processes.OwnedProcess`: Job Object, timeout, cancelável) sem rede; sem o extra `transcription` ou sem o modelo local
devolve `executed=False` com o motivo: nunca uma estimativa disfarçada de medição.
"""
from __future__ import annotations

import asyncio
import bisect
import concurrent.futures
import hashlib
import json
import math
import os
import re
import sys
import time
import unicodedata
import wave
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Mapping, Sequence

from . import media_contracts as mc

MATCH_WINDOW_SECONDS = 0.5      # palavra ASR só casa com token de uma seção se o ponto médio cair na seção ± isto
MIN_INTERPOLATED_WORD = 0.02    # largura mínima de palavra interpolada (s)
MIN_ROOM_PER_WORD = 0.03        # espaço mínimo por palavra para interpolar; senão âncoras vizinhas são rebaixadas
FUZZY_RATIO = 0.8               # similaridade mínima (difflib) para casar grafias próximas de palavras >= 4 letras
FUZZY_SCORE = 0.6               # pontuação de casamento aproximado (exato = 1.0)
MIN_ASR_WORD_SECONDS = 0.001
MAX_DP_CELLS = 6_000_000
ASR_ENGINE_DEFAULT = "faster-whisper"
RUN_TIMEOUT_SECONDS = 900.0
MODEL_NAMES = ("tiny", "base", "small", "medium", "large-v3-turbo")


# ------------------------------------------------------------------------------ normalização

_UNITS = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
          "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
_TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
_HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos",
             "oitocentos", "novecentos"]
_PIECE = re.compile(r"\d+(?:[.,]\d+)*|[^\W\d_]+")


def _below_100(n: int) -> list[str]:
    if n < 20:
        return [_UNITS[n]]
    return [_TENS[n // 10]] + (["e", _UNITS[n % 10]] if n % 10 else [])


def _below_1000(n: int) -> list[str]:
    if n == 100:
        return ["cem"]
    hundreds, rest = divmod(n, 100)
    words = [_HUNDREDS[hundreds]] if hundreds else []
    if rest:
        words += (["e"] if hundreds else []) + _below_100(rest)
    return words


def number_words(n: int) -> list[str] | None:
    """Número por extenso em pt-BR (0 <= n < 10^9) como lista de palavras; `None` fora do intervalo."""
    if not 0 <= n < 1_000_000_000:
        return None
    if n == 0:
        return ["zero"]
    millions, rest = divmod(n, 1_000_000)
    thousands, units = divmod(rest, 1000)
    parts: list[tuple[list[str], int]] = []
    if millions:
        parts.append((["um", "milhão"] if millions == 1 else _below_1000(millions) + ["milhões"], millions))
    if thousands:
        parts.append((["mil"] if thousands == 1 else _below_1000(thousands) + ["mil"], thousands))
    if units:
        parts.append((_below_1000(units), units))
    words = parts[0][0]
    for position, (part, value) in enumerate(parts[1:], 1):
        connector = ["e"] if position == len(parts) - 1 and (value < 100 or value % 100 == 0) else []
        words = words + connector + part
    return words


def _plain(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch) and ch.isalnum() and ch.isascii())


def _number_piece(piece: str) -> list[str]:
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", piece):
        piece = piece.replace(".", "")
    if piece.isdigit():
        return number_words(int(piece)) or [piece]
    whole, _, fraction = piece.replace(".", ",").partition(",")
    if not (whole.isdigit() and fraction.isdigit() and "," not in fraction):
        return [piece]
    words = number_words(int(whole)) or [whole]
    return words + ["vírgula"] + ["zero"] * (len(fraction) - len(fraction.lstrip("0"))) + (
        number_words(int(fraction)) or [fraction] if fraction.strip("0") else [])


def expand(token: str) -> list[str]:
    """Subpalavras normalizadas de um token: separa hifens, converte dígitos em extenso, remove acentos e pontuação."""
    found: list[str] = []
    for piece in _PIECE.findall(token):
        found.extend(_number_piece(piece) if piece[0].isdigit() else [piece])
    if "%" in token and any(p[0].isdigit() for p in _PIECE.findall(token)):
        found += ["por", "cento"]
    return [norm for word in found if (norm := _plain(word))]


# ------------------------------------------------------------------------------ palavras do ASR

def clean_asr_words(asr_words: Sequence[Mapping[str, Any]], duration_seconds: float) -> list[dict]:
    """Palavras ASR utilizáveis: texto, tempos finitos, `0 <= start < end <= duração`, em ordem, sem sobreposição.

    Descarta (nunca corrige por suposição) palavras com tempo inválido ou que regridem no tempo; sobreposição de até
    uma palavra para a seguinte é aparada no início.
    """
    kept: list[dict] = []
    for item in asr_words:
        if not isinstance(item, Mapping):
            continue
        text = item.get("word", item.get("text"))
        start, end = item.get("start"), item.get("end")
        if not isinstance(text, str) or not text.strip() or not all(type(v) in (int, float) and math.isfinite(v) for v in (start, end)):
            continue
        start, end = round(float(start), 3), round(min(float(end), duration_seconds), 3)
        if start < 0 or end - start < MIN_ASR_WORD_SECONDS or start >= duration_seconds:
            continue
        if kept:
            previous = kept[-1]
            if start < previous["start"] - mc.TIME_EPS:
                continue    # fora de ordem
            start = max(start, previous["end"])
            if end - start < MIN_ASR_WORD_SECONDS:
                continue
        kept.append({"text": text.strip(), "start": start, "end": end})
    return kept


# ------------------------------------------------------------------------------ casamento

def _similarity(a: str, b: str, cache: dict) -> float:
    if a == b:
        return 1.0
    if len(a) < 4 or len(b) < 4 or a[0] != b[0]:
        return 0.0
    key = (a, b)
    if key not in cache:
        cache[key] = FUZZY_SCORE if SequenceMatcher(None, a, b).ratio() >= FUZZY_RATIO else 0.0
    return cache[key]


def _match_subwords(script: list[tuple[str, int]], asr: list[tuple[str, int]], windows: list[tuple[float, float]],
                    centers: list[float]) -> dict[int, int]:
    """Pares (índice no script → índice no ASR) de maior pontuação, monótonos, respeitando a janela da seção."""
    n, m = len(script), len(asr)
    if (n + 1) * (m + 1) > MAX_DP_CELLS:
        raise ValueError("roteiro e reconhecimento grandes demais para o alinhamento local.")
    ranges = []
    for i in range(n):
        low, high = windows[i]
        ranges.append((bisect.bisect_left(centers, low), bisect.bisect_right(centers, high)))
    cache: dict = {}
    table = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        row, above = table[i], table[i - 1]
        low, high = ranges[i - 1]
        word = script[i - 1][0]
        for j in range(1, m + 1):
            best = above[j] if above[j] >= row[j - 1] else row[j - 1]
            if low < j <= high:
                score = _similarity(word, asr[j - 1][0], cache)
                if score and above[j - 1] + score > best:
                    best = above[j - 1] + score
            row[j] = best
    pairs: dict[int, int] = {}
    i, j = n, m
    while i > 0 and j > 0:
        here = table[i][j]
        if here == table[i - 1][j]:
            i -= 1
        elif here == table[i][j - 1]:
            j -= 1
        else:
            pairs[i - 1] = j - 1
            i, j = i - 1, j - 1
    return pairs


# ------------------------------------------------------------------------------ alinhamento (puro)

def align_script(script_text: str, asr_words: Sequence[Mapping[str, Any]], *, sections: Sequence[Mapping],
                 narration_sha256: str, duration_seconds: float, engine: Mapping[str, str],
                 asr_engine: str = ASR_ENGINE_DEFAULT) -> dict:
    """`word-timings.json` (source=forced_alignment) a partir do roteiro e das palavras reconhecidas.

    `script_text`: textos das seções unidos por `\\n` (uma linha por seção, na ordem de `sections`); os tokens são os
    separados por espaço, com `char_offset` nesse texto. `sections`: `[{section, start, end}]` medidos.
    `asr_words`: `[{word|text, start, end}]` do reconhecimento. `engine`: `{name, voice}` da síntese.
    Levanta `ValueError` para entrada inconsistente; o documento devolvido já passou por `validate_word_timings`.
    """
    return align_with_report(script_text, asr_words, sections=sections, narration_sha256=narration_sha256,
                             duration_seconds=duration_seconds, engine=engine, asr_engine=asr_engine)[0]


def align_with_report(script_text: str, asr_words: Sequence[Mapping[str, Any]], *, sections: Sequence[Mapping],
                      narration_sha256: str, duration_seconds: float, engine: Mapping[str, str],
                      asr_engine: str = ASR_ENGINE_DEFAULT) -> tuple[dict, dict]:
    """Como `align_script`, devolvendo também o relatório de diagnóstico (fora do contrato)."""
    bounds = _section_bounds(sections, script_text)
    tokens = [(m.start(), m.group()) for m in re.finditer(r"\S+", script_text)]
    if not tokens:
        raise ValueError("roteiro sem palavras.")
    line_starts = [m.end() for m in re.finditer("\n", script_text)]
    section_of = [bounds[bisect.bisect_right(line_starts, offset)] for offset, _ in tokens]   # (número, início, fim)

    asr = clean_asr_words(asr_words, duration_seconds)
    asr_subs = [(norm, k) for k, word in enumerate(asr) for norm in expand(word["text"])]
    script_subs = [(norm, t) for t, (_, text) in enumerate(tokens) for norm in expand(text)]
    centers = [(asr[k]["start"] + asr[k]["end"]) / 2 for _, k in asr_subs]
    windows = [(section_of[t][1] - MATCH_WINDOW_SECONDS, section_of[t][2] + MATCH_WINDOW_SECONDS) for _, t in script_subs]
    pairs = _match_subwords(script_subs, asr_subs, windows, centers) if script_subs and asr_subs else {}

    matched_subs: dict[int, list[int]] = {}
    for i, j in pairs.items():
        matched_subs.setdefault(script_subs[i][1], []).append(asr_subs[j][1])
    needed = {}
    for _, t in script_subs:
        needed[t] = needed.get(t, 0) + 1

    spans: list[tuple[float, float] | None] = [None] * len(tokens)
    clamped, max_clamp = 0, 0.0
    cursor = 0.0
    for t in range(len(tokens)):
        hits = matched_subs.get(t, [])
        if not needed.get(t) or len(hits) != needed[t]:
            continue
        start, end = asr[min(hits)]["start"], asr[max(hits)]["end"]
        _, low, high = section_of[t]
        new_start, new_end = max(start, low, cursor), min(end, high)
        if new_end - new_start < MIN_ASR_WORD_SECONDS:
            continue
        shift = (new_start - start) + (end - new_end)
        if shift > mc.TIME_EPS:
            clamped, max_clamp = clamped + 1, max(max_clamp, shift)
        spans[t] = (round(new_start, 3), round(new_end, 3))
        cursor = spans[t][1]

    measured = [span is not None for span in spans]
    _interpolate(tokens, section_of, spans, measured)

    words, interpolated = [], 0
    for index, ((offset, text), span, is_measured) in enumerate(zip(tokens, spans, measured)):
        interpolated += not is_measured
        words.append({"index": index, "text": text, "section": section_of[index][0], "start": span[0], "end": span[1],
                      "char_offset": offset, "char_length": len(text), "timing": "measured" if is_measured else "interpolated"})
    longest, run_start = 0.0, None
    for word in words:
        if word["timing"] == "interpolated":
            run_start = word["start"] if run_start is None else run_start
            longest = max(longest, word["end"] - run_start)
        else:
            run_start = None
    total = len(words)
    document = {"schema_version": 1, "narration_sha256": narration_sha256, "duration_seconds": duration_seconds,
                "source": "forced_alignment", "engine": dict(engine),
                "words": words, "alignment": {
                    "method": "asr_sequence_match", "asr_engine": asr_engine, "matched_words": total - interpolated,
                    "interpolated_words": interpolated, "match_rate": round((total - interpolated) / total, 4),
                    "longest_interpolated_seconds": round(longest, 3)}}
    verdict = mc.validate_word_timings(document, narration_sha256=narration_sha256, duration_seconds=duration_seconds,
                                       script_text=script_text,
                                       sections=[{"section": n, "start": s, "end": e} for n, s, e in bounds])
    if not verdict["ok"]:
        raise RuntimeError("alinhamento gerou documento inválido: " + "; ".join(
            f"{e['code']}@{e['path']}" for e in verdict["errors"][:4]))
    report = _report(verdict, words, bounds, len(asr), clamped, max_clamp)
    return verdict["value"], report


def _section_bounds(sections: Sequence[Mapping], script_text: str) -> list[tuple[int, float, float]]:
    bounds = []
    for position, item in enumerate(sections):
        if not (isinstance(item, Mapping) and type(item.get("section")) is int and mc._num(item.get("start"))
                and mc._num(item.get("end")) and 0 <= item["start"] < item["end"]):
            raise ValueError(f"seção medida inválida em sections[{position}].")
        bounds.append((item["section"], float(item["start"]), float(item["end"])))
    if not bounds:
        raise ValueError("seções medidas ausentes.")
    if any(b[0] <= a[0] or b[1] < a[2] - mc.SECTION_EPS for a, b in zip(bounds, bounds[1:])):
        raise ValueError("seções devem estar em ordem, sem repetição nem sobreposição.")
    if len(script_text.split("\n")) != len(bounds):
        raise ValueError("o roteiro deve ter uma linha por seção medida.")
    return bounds


def _interpolate(tokens, section_of, spans, measured) -> None:
    """Preenche `spans` das palavras não medidas dentro da seção, entre âncoras medidas (rebaixa vizinhas se faltar espaço)."""
    count = len(tokens)
    while True:
        index, problem = 0, None
        while index < count and problem is None:
            if measured[index]:
                index += 1
                continue
            first = index
            while index + 1 < count and not measured[index + 1] and section_of[index + 1][0] == section_of[first][0]:
                index += 1
            last = index
            index += 1
            _, sec_start, sec_end = section_of[first]
            left = spans[first - 1][1] if first > 0 and measured[first - 1] and section_of[first - 1][0] == section_of[first][0] else sec_start
            right = spans[last + 1][0] if last + 1 < count and measured[last + 1] and section_of[last + 1][0] == section_of[last][0] else sec_end
            left, right = max(left, sec_start), min(right, sec_end)
            if right - left >= (last - first + 1) * MIN_ROOM_PER_WORD:
                _spread(tokens, spans, first, last, left, right)
            else:
                problem = (first, last)
        if problem is None:
            return
        first, last = problem
        neighbours = [k for k in (first - 1, last + 1) if 0 <= k < count and measured[k]
                      and section_of[k][0] == section_of[first][0]]
        if not neighbours:
            raise ValueError("seção curta demais para o número de palavras do roteiro.")
        measured[neighbours[0]] = False
        spans[neighbours[0]] = None


def _spread(tokens, spans, first, last, left, right) -> None:
    n = last - first + 1
    weights = [len(tokens[k][1]) for k in range(first, last + 1)]
    free = (right - left) - n * MIN_INTERPOLATED_WORD
    total = sum(weights)
    cursor = left
    for position, k in enumerate(range(first, last + 1)):
        end = right if k == last else round(cursor + MIN_INTERPOLATED_WORD + free * weights[position] / total, 3)
        spans[k] = (round(cursor, 3), end)
        cursor = end


def _report(verdict: dict, words: list[dict], bounds, asr_count: int, clamped: int, max_clamp: float) -> dict:
    """Diagnóstico: taxa de casamento e desvio das palavras medidas em relação aos limites de cada seção."""
    first_gaps, last_gaps = [], []
    for number, start, end in bounds:
        own = [w for w in words if w["section"] == number and w["timing"] == "measured"]
        if own:
            first_gaps.append(abs(own[0]["start"] - start))
            last_gaps.append(abs(end - own[-1]["end"]))
    edges = first_gaps + last_gaps
    return {"asr_words_usable": asr_count, "words": len(words), "speech_aligned": verdict["speech_aligned"],
            "warnings": verdict["warnings"], **verdict["value"]["alignment"],
            "clamped_to_section": clamped, "max_clamp_seconds": round(max_clamp, 3),
            "section_edge_deviation_mean_seconds": round(sum(edges) / len(edges), 3) if edges else None,
            "section_edge_deviation_max_seconds": round(max(edges), 3) if edges else None,
            "sections_with_measured_words": len(first_gaps), "sections": len(bounds)}


# ------------------------------------------------------------------------------ runner isolado

def _not_run(reason: str, **extra) -> dict:
    return {"executed": False, "reason": reason, "document": None, "report": None, **extra}


def _wav_facts(wav: Path) -> tuple[str, float]:
    digest = hashlib.sha256()
    with wav.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    with wave.open(str(wav), "rb") as audio:
        return digest.hexdigest(), audio.getnframes() / audio.getframerate()


def resolve_model_path(model_dir: Path, model_name: str) -> Path | None:
    """Pasta CTranslate2 local (com `model.bin`) em `model_dir/<nome>` ou `model_dir/faster-whisper-<nome>`."""
    for candidate in (Path(model_dir) / model_name, Path(model_dir) / f"faster-whisper-{model_name}"):
        if (candidate / "model.bin").is_file():
            return candidate
    return None


async def run_alignment_async(wav: Path, script_text: str, *, sections: Sequence[Mapping], engine: Mapping[str, str],
                              model_dir: Path, model_name: str = "small", language: str = "pt",
                              timeout: float = RUN_TIMEOUT_SECONDS) -> dict:
    """Executa o ASR em subprocesso possuído (CPU, offline) e alinha ao roteiro.

    Devolve `{executed, reason, document, report, asr_seconds}`. `executed=False` (com `reason`) se o extra
    `transcription`, o modelo local ou o WAV estão ausentes, se o ASR falha ou estoura o tempo. Cancelar a tarefa
    encerra a árvore do subprocesso. Não há fallback estimado.
    """
    from importlib.util import find_spec
    from .processes import OwnedProcess

    if model_name not in MODEL_NAMES:
        return _not_run(f"modelo desconhecido: {model_name}")
    if find_spec("faster_whisper") is None:
        return _not_run("extra 'transcription' (faster-whisper) não instalado neste ambiente")
    model_path = resolve_model_path(model_dir, model_name)
    if model_path is None:
        return _not_run(f"modelo Whisper '{model_name}' não encontrado em {Path(model_dir)}")
    wav = Path(wav)
    try:
        sha, duration = await asyncio.to_thread(_wav_facts, wav)
    except (OSError, wave.Error, EOFError, ZeroDivisionError) as error:
        return _not_run(f"WAV da narração ilegível ({type(error).__name__})")
    env = {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
           "HF_HUB_DISABLE_SYMLINKS_WARNING": "1", "PYTHONIOENCODING": "utf-8"}
    command = [sys.executable, "-I", "-m", "horus_backend.speech_alignment", "--wav", str(wav),
               "--model-path", str(model_path), "--language", language]
    started = time.monotonic()
    try:
        owned = await OwnedProcess.start(command, env=env)
    except (OSError, NotImplementedError) as error:
        return _not_run(f"não foi possível iniciar o ASR ({type(error).__name__})")
    try:
        out, err = await asyncio.wait_for(owned.process.communicate(), timeout=timeout)
    except TimeoutError:
        return _not_run(f"timeout de {timeout:.0f}s no reconhecimento")
    finally:
        await owned.stop()      # idempotente; também cobre CancelledError
        owned.close()
    elapsed = round(time.monotonic() - started, 2)
    if owned.process.returncode != 0:
        tail = err.decode("utf-8", "replace").strip().splitlines()[-1:] or ["sem detalhe"]
        return _not_run(f"ASR falhou (código {owned.process.returncode}): {tail[0][:300]}", asr_seconds=elapsed)
    try:
        payload = json.loads(out.decode("utf-8"))
        asr_engine = f"faster-whisper {model_name} (CPU int8, offline)"
        document, report = align_with_report(
            script_text, payload["words"], sections=sections, narration_sha256=sha, duration_seconds=duration,
            engine=engine, asr_engine=asr_engine)
    except (ValueError, KeyError, TypeError, RuntimeError) as error:
        return _not_run(f"alinhamento não concluído: {type(error).__name__}: {error}", asr_seconds=elapsed)
    return {"executed": True, "reason": None, "document": document, "report": report, "asr_seconds": elapsed}


def run_alignment(wav: Path, script_text: str, *, sections: Sequence[Mapping], engine: Mapping[str, str],
                  model_dir: Path, model_name: str = "small", language: str = "pt",
                  timeout: float = RUN_TIMEOUT_SECONDS) -> dict:
    """Versão síncrona; segura dentro de um loop asyncio em execução (roda em thread própria)."""
    call = lambda: asyncio.run(run_alignment_async(  # noqa: E731
        wav, script_text, sections=sections, engine=engine, model_dir=model_dir, model_name=model_name,
        language=language, timeout=timeout))
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return call()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(call).result()


# ------------------------------------------------------------------------------ processo do ASR

def _asr_main(argv: list[str]) -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="horus-speech-alignment")
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--language", default="pt")
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(str(args.model_path), device="cpu", compute_type="int8", local_files_only=True)
        segments, info = model.transcribe(str(args.wav), language=args.language, word_timestamps=True)
        words = [{"word": w.word, "start": w.start, "end": w.end} for segment in segments for w in (segment.words or [])]
    except Exception as error:  # noqa: BLE001 - o motivo segue para quem chamou
        print(f"{type(error).__name__}: {error}", file=sys.stderr, flush=True)
        return 1
    print(json.dumps({"words": words, "duration": info.duration, "language": info.language}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(_asr_main(sys.argv[1:]))
