"""Validação de qualidade e sincronização da evidência do piloto local (HOR-089 / HOR-097).

Duas responsabilidades separadas, ambas sem rede, sem subprocessos e sem bibliotecas novas:

* `validate_pilot_evidence(evidence)` é PURA: valida somente o MANIFESTO (`pilot-evidence.json`) já carregado como
  dict. Não abre arquivos; não prova que o MP4/WAV/PNG reais correspondem ao manifesto.
* `inspect_pilot_files(root, evidence)` é a inspeção FÍSICA, opcional e confinada a `root`: confere hash dos assets,
  duração/clipping/silêncio do WAV. Não inspeciona o MP4 (isso é o checklist em docs/qualidade-piloto.md).

Resultado comum: `{schema_version: 1, checks: [{id, status: pass|fail|not_checked, detail}], blocking_errors,
warnings, publishable: False}`. `publishable` é sempre False: licença da voz do Windows e evidência acústica
nunca são concluídas por este módulo.
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import sys
import wave
from array import array
from datetime import datetime
from pathlib import Path

SCHEMA_VERSION = 1
# Limites contra entradas imensas.
MAX_SCENES, MAX_SUBTITLES, MAX_ASSETS = 200, 2000, 500
MAX_SECONDS = 3600.0
MAX_DIMENSION, MAX_FRAMES = 16384, 10_000_000
MAX_TEXT, MAX_FIELD, MAX_PATH = 1000, 300, 260
# Tolerâncias (segundos), documentadas em docs/qualidade-piloto.md.
RENDERER_TAIL = 0.8             # FOLGA_FINAL_SEG de fabrica/render.py: vídeo = áudio medido + 0,8 s
TAIL_TOLERANCE = 0.15           # arredondamento de quadro/contêiner do MP4
TIME_EPS = 0.01                 # contiguidade de cenas e contenção de legendas (precisão de ms/quadro)
AUDIO_END_TOLERANCE = 0.05      # fim da última cena vs. duração medida do áudio
EXPECTED_FPS, EXPECTED_SIZE = 30, (1080, 1920)
# Inspeção física.
MAX_FILE_BYTES = 512 * 1024 * 1024
WAV_DURATION_TOLERANCE = 0.05
CLIP_FRACTION = 0.001           # >0,1% das amostras no fundo de escala => clipping
SILENCE_PEAK = 0.01             # pico < 1% do fundo de escala em toda a faixa => áudio mudo
EDGE_SILENCE_SECONDS = 1.5      # silêncio inicial/final acima disso gera aviso

_HEX = re.compile(r"[0-9a-f]{64}")
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_ORIGINS, _LICENSES = ("original_local", "system_voice"), ("original", "unverified")
_TOP = {"schema_version", "demo_only", "narration", "scenes", "subtitles", "assets", "video", "alignment_method"}
_CHECK_IDS = (
    "schema", "demo_flag", "alignment_method", "narration", "video", "assets_structure", "assets_paths",
    "assets_hashes", "scene_contiguity", "scene_assets", "subtitles_structure", "subtitles_timing",
    "duration_consistency", "provenance_licenses", "acoustic_evidence", "word_alignment", "physical_files",
    "publishability",
)


def _num(value) -> bool:
    """Número real finito (bool não conta; int/float aceitos, str nunca é coagida)."""
    return type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e12


def _seconds(value) -> bool:
    return _num(value) and 0 <= value <= MAX_SECONDS


def _int(value, maximum) -> bool:
    return type(value) is int and 0 < value <= maximum


def _text(value, limit) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value) <= limit and not _CONTROL.search(value)


def _short(value) -> str:
    """Valor arbitrário seguro para mensagens (sem conteúdo imenso nem controle)."""
    return _CONTROL.sub("?", repr(value)[:60])


def _safe_path(value) -> str | None:
    """None se o caminho é relativo e confinável; senão o motivo."""
    if not isinstance(value, str) or not value or len(value) > MAX_PATH:
        return "caminho ausente ou longo demais"
    if _CONTROL.search(value) or "\\" in value or ":" in value or value.startswith(("/", "~")):
        return "caminho absoluto, URL, unidade ou barra invertida"
    for part in value.split("/"):
        if part in ("", ".", "..") or part != part.rstrip(" ."):
            return "segmento vazio, '.', '..' ou terminado em ponto/espaço"
    return None


def _iso(value) -> bool:
    if not isinstance(value, str) or not 10 <= len(value) <= 40:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00") if value.endswith("Z") else value)
    except ValueError:
        return False
    return True


class _Report:
    def __init__(self):
        self.checks: dict[str, tuple[str, str]] = {}
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def done(self, check_id, errors=(), detail="ok", status="pass"):
        errors = list(errors)
        if errors:
            status, detail = "fail", errors[0] if len(errors) == 1 else f"{len(errors)} problemas; ver blocking_errors"
            self.errors.extend(f"{check_id}: {item}" for item in errors)
        self.checks[check_id] = (status, detail)

    def skip(self, check_id, detail):
        self.checks[check_id] = ("not_checked", detail)

    def warn(self, message):
        self.warnings.append(message)

    def result(self) -> dict:
        order = [i for i in _CHECK_IDS if i in self.checks] + [i for i in self.checks if i not in _CHECK_IDS]
        return {"schema_version": SCHEMA_VERSION,
                "checks": [{"id": i, "status": self.checks[i][0], "detail": self.checks[i][1]} for i in order],
                "blocking_errors": self.errors, "warnings": self.warnings, "publishable": False}


def _items(report, check_id, value, limit, label):
    if not isinstance(value, list) or not value:
        report.done(check_id, [f"{label} deve ser lista não vazia"])
        return None
    if len(value) > limit:
        report.done(check_id, [f"{label} excede o limite de {limit}"])
        return None
    return value


def _narration(report, node):
    errors = []
    if not isinstance(node, dict):
        return report.done("narration", ["narration deve ser objeto"]) or None
    if set(node) != {"kind", "engine", "voice", "duration_seconds", "sha256"}:
        errors.append("campos de narration devem ser exatamente kind, engine, voice, duration_seconds, sha256")
    if node.get("kind") != "local_tts" or node.get("engine") != "windows_sapi":
        errors.append("narration deve ser kind=local_tts e engine=windows_sapi")
    if not _text(node.get("voice"), MAX_FIELD):
        errors.append("voice deve ser texto não vazio")
    duration = node.get("duration_seconds")
    if not _seconds(duration) or duration <= 0:
        errors.append(f"duration_seconds deve ser número finito positivo (<= {MAX_SECONDS:g}): {_short(duration)}")
    if not (isinstance(node.get("sha256"), str) and _HEX.fullmatch(node["sha256"])):
        errors.append("sha256 deve ter 64 hex minúsculos")
    report.done("narration", errors)
    return None if errors else node


def _video(report, node):
    errors = []
    if not isinstance(node, dict):
        return report.done("video", ["video deve ser objeto"]) or None
    if set(node) != {"duration_seconds", "width", "height", "frames"}:
        errors.append("campos de video devem ser exatamente duration_seconds, width, height, frames")
    duration = node.get("duration_seconds")
    if not _seconds(duration) or duration <= 0:
        errors.append(f"duration_seconds inválido: {_short(duration)}")
    for name in ("width", "height"):
        if not _int(node.get(name), MAX_DIMENSION):
            errors.append(f"{name} deve ser inteiro positivo (<= {MAX_DIMENSION}): {_short(node.get(name))}")
    if not _int(node.get("frames"), MAX_FRAMES):
        errors.append(f"frames deve ser inteiro positivo: {_short(node.get('frames'))}")
    if not errors:
        fps = node["frames"] / node["duration_seconds"]
        if not 10 <= fps <= 120:
            errors.append(f"fps implícito fora de 10..120: {fps:.2f}")
        else:
            if abs(fps - EXPECTED_FPS) > 0.5:
                report.warn(f"video: fps implícito {fps:.2f} difere do padrão do renderer ({EXPECTED_FPS})")
            if (node["width"], node["height"]) != EXPECTED_SIZE:
                report.warn(f"video: resolução {node['width']}x{node['height']} difere de 1080x1920")
    report.done("video", errors)
    return None if errors else node


def _assets(report, node):
    items = _items(report, "assets_structure", node, MAX_ASSETS, "assets")
    if items is None:
        for check in ("assets_paths", "assets_hashes"):
            report.skip(check, "assets inválidos")
        return None
    errors, path_errors, hash_errors = [], [], []
    ids, paths = set(), set()
    for index, asset in enumerate(items):
        tag = f"assets[{index}]"
        if not isinstance(asset, dict) or set(asset) != {
                "id", "relative_path", "sha256", "origin", "license", "attribution", "generated_at"}:
            errors.append(f"{tag}: campos devem ser exatamente id, relative_path, sha256, origin, license, "
                          "attribution, generated_at")
            continue
        if not (isinstance(asset["id"], str) and _ID.fullmatch(asset["id"])):
            errors.append(f"{tag}: id inválido {_short(asset['id'])}")
        elif asset["id"] in ids:
            errors.append(f"{tag}: id repetido {asset['id']}")
        else:
            ids.add(asset["id"])
        if asset["origin"] not in _ORIGINS:
            errors.append(f"{tag}: origin deve ser {'|'.join(_ORIGINS)}")
        if asset["license"] not in _LICENSES:
            errors.append(f"{tag}: license deve ser {'|'.join(_LICENSES)}")
        if not _text(asset["attribution"], MAX_FIELD):
            errors.append(f"{tag}: attribution deve ser texto não vazio")
        if not _iso(asset["generated_at"]):
            errors.append(f"{tag}: generated_at deve ser ISO 8601")
        reason = _safe_path(asset["relative_path"])
        if reason:
            path_errors.append(f"{tag}: {reason}")
        elif asset["relative_path"].casefold() in paths:
            path_errors.append(f"{tag}: relative_path repetido {asset['relative_path']}")
        else:
            paths.add(asset["relative_path"].casefold())
        if not (isinstance(asset["sha256"], str) and _HEX.fullmatch(asset["sha256"])):
            hash_errors.append(f"{tag}: sha256 deve ter 64 hex minúsculos")
    report.done("assets_structure", errors)
    report.done("assets_paths", path_errors)
    report.done("assets_hashes", hash_errors)
    return None if errors or path_errors or hash_errors else items


def _scenes(report, node, assets, narration, video):
    items = _items(report, "scene_contiguity", node, MAX_SCENES, "scenes")
    if items is None:
        report.skip("scene_assets", "cenas inválidas")
        return None
    errors, ref_errors, ids, cursor = [], [], set(), 0.0
    valid = True
    for index, scene in enumerate(items):
        tag = f"scenes[{index}]"
        if not isinstance(scene, dict) or set(scene) != {"id", "start", "end", "asset_id"}:
            errors.append(f"{tag}: campos devem ser exatamente id, start, end, asset_id")
            valid = False
            continue
        if not (isinstance(scene["id"], str) and _ID.fullmatch(scene["id"])) or scene["id"] in ids:
            errors.append(f"{tag}: id inválido ou repetido {_short(scene['id'])}")
        else:
            ids.add(scene["id"])
        if not (_seconds(scene["start"]) and _seconds(scene["end"])):
            errors.append(f"{tag}: start/end devem ser números finitos em 0..{MAX_SECONDS:g}")
            valid = False
            continue
        if scene["end"] <= scene["start"]:
            errors.append(f"{tag}: end deve ser maior que start")
            valid = False
            continue
        if index == 0 and abs(scene["start"]) > TIME_EPS:
            errors.append(f"{tag}: a primeira cena deve começar em 0")
        elif index and scene["start"] - cursor > TIME_EPS:
            errors.append(f"{tag}: lacuna de {scene['start'] - cursor:.3f}s antes da cena")
        elif index and cursor - scene["start"] > TIME_EPS:
            errors.append(f"{tag}: sobreposição de {cursor - scene['start']:.3f}s com a cena anterior")
        cursor = scene["end"]
        if not isinstance(scene["asset_id"], str):
            ref_errors.append(f"{tag}: asset_id deve ser texto")
        elif assets is None:
            continue
        else:
            asset = next((a for a in assets if a["id"] == scene["asset_id"]), None)
            if asset is None:
                ref_errors.append(f"{tag}: asset_id {scene['asset_id']} não existe em assets")
            elif asset["origin"] != "original_local":
                ref_errors.append(f"{tag}: cena deve usar asset original_local, não {asset['origin']}")
    if valid and not errors and narration and abs(cursor - narration["duration_seconds"]) > AUDIO_END_TOLERANCE:
        limit_video = video and abs(cursor - video["duration_seconds"]) <= TAIL_TOLERANCE
        if not limit_video:
            errors.append(f"cenas terminam em {cursor:.3f}s, fora da duração medida do áudio "
                          f"({narration['duration_seconds']:.3f}s ± {AUDIO_END_TOLERANCE})")
    report.done("scene_contiguity", errors)
    if assets is None:
        report.skip("scene_assets", "assets inválidos")
    else:
        used = {s.get("asset_id") for s in items if isinstance(s, dict)}
        for asset in assets:
            if asset["origin"] == "original_local" and asset["id"] not in used:
                report.warn(f"asset {asset['id']} não é usado por nenhuma cena")
        report.done("scene_assets", ref_errors)
    return items if valid and not errors else None


def _subtitles(report, node, scenes, narration):
    items = _items(report, "subtitles_structure", node, MAX_SUBTITLES, "subtitles")
    if items is None:
        report.skip("subtitles_timing", "legendas inválidas")
        return
    errors = []
    for index, cue in enumerate(items):
        tag = f"subtitles[{index}]"
        if not isinstance(cue, dict) or set(cue) != {"start", "end", "text"}:
            errors.append(f"{tag}: campos devem ser exatamente start, end, text")
        elif not (_seconds(cue["start"]) and _seconds(cue["end"])) or cue["end"] <= cue["start"]:
            errors.append(f"{tag}: start/end devem ser finitos com end > start")
        elif not _text(cue["text"], MAX_TEXT) or "-->" in cue["text"]:
            errors.append(f"{tag}: text deve ser texto não vazio sem '-->' nem controles")
    report.done("subtitles_structure", errors)
    if errors:
        return report.skip("subtitles_timing", "legendas inválidas")
    problems, previous_end = [], 0.0
    speech_end = narration["duration_seconds"] if narration else None
    for index, cue in enumerate(items):
        tag = f"subtitles[{index}]"
        if index and previous_end - cue["start"] > TIME_EPS:
            problems.append(f"{tag}: sobrepõe a legenda anterior em {previous_end - cue['start']:.3f}s (ou fora de ordem)")
        previous_end = max(previous_end, cue["end"])
        if speech_end is not None and cue["end"] - speech_end > TIME_EPS:
            problems.append(f"{tag}: termina em {cue['end']:.3f}s, depois da fala medida ({speech_end:.3f}s)")
        if scenes is not None and not any(
                cue["start"] >= s["start"] - TIME_EPS and cue["end"] <= s["end"] + TIME_EPS for s in scenes):
            problems.append(f"{tag}: não cabe dentro de uma única cena (cruza segmentos)")
    if scenes is not None and not problems:
        for scene in scenes:
            if not any(c["start"] >= scene["start"] - TIME_EPS and c["end"] <= scene["end"] + TIME_EPS for c in items):
                report.warn(f"cena {scene['id']} sem legenda")
    if problems:
        report.done("subtitles_timing", problems)
    elif scenes is None:
        report.checks["subtitles_timing"] = ("pass", "ordem/sobreposição/fala ok; contenção em cenas não verificada")
        report.warn("subtitles_timing: cenas inválidas, contenção por segmento não verificada")
    else:
        report.done("subtitles_timing")


def _durations(report, narration, video):
    if not (narration and video):
        return report.skip("duration_consistency", "narration/video inválidos")
    tail = video["duration_seconds"] - narration["duration_seconds"]
    if abs(tail - RENDERER_TAIL) > TAIL_TOLERANCE:
        return report.done("duration_consistency", [
            f"vídeo ({video['duration_seconds']:.3f}s) - áudio ({narration['duration_seconds']:.3f}s) = {tail:.3f}s; "
            f"esperado {RENDERER_TAIL}s ± {TAIL_TOLERANCE}s (cauda do renderer)"])
    report.done("duration_consistency", detail=f"cauda {tail:.3f}s dentro de {RENDERER_TAIL}s ± {TAIL_TOLERANCE}s")


def _provenance(report, assets, narration):
    if assets is None:
        return report.skip("provenance_licenses", "assets inválidos")
    errors = []
    voices = [a for a in assets if a["origin"] == "system_voice"]
    if narration is not None:
        if not any(a["sha256"] == narration["sha256"] for a in voices):
            errors.append("narration.sha256 não corresponde a nenhum asset origin=system_voice")
    for asset in voices:
        if asset["license"] == "original":
            errors.append(f"asset {asset['id']}: voz do sistema não pode ser declarada license=original; "
                          "presença da voz no PC não prova licença comercial")
    unverified = [a["id"] for a in assets if a["license"] == "unverified"]
    if unverified:
        report.warn("licença não verificada (bloqueia publicação, não a demonstração local): " + ", ".join(unverified))
    if errors:
        return report.done("provenance_licenses", errors)
    if unverified:
        return report.skip("provenance_licenses", f"{len(unverified)} asset(s) com licença unverified")
    report.done("provenance_licenses", detail="proveniência registrada; licenças declaradas, sem verificação independente")


def validate_pilot_evidence(evidence: dict) -> dict:
    """Valida o manifesto `pilot-evidence.json` já carregado. Pura: nunca levanta, nunca toca disco/rede."""
    report = _Report()
    try:
        _validate(report, evidence)
    except Exception as exc:  # defesa final: uma entrada hostil nunca derruba o chamador
        report.done("schema", [f"validação interrompida por entrada inesperada ({type(exc).__name__})"])
    for check_id in _CHECK_IDS:
        report.checks.setdefault(check_id, ("not_checked", "não avaliado"))
    return report.result()


def _validate(report, evidence):
    if not isinstance(evidence, dict):
        return report.done("schema", ["evidência deve ser um objeto"])
    errors = []
    if set(evidence) != _TOP:
        missing, extra = sorted(_TOP - set(evidence)), sorted(map(str, set(evidence) - _TOP))[:5]
        errors.append(f"campos de topo inválidos (faltando: {missing}; extras: {extra})")
    if type(evidence.get("schema_version")) is not int or evidence.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version deve ser o inteiro {SCHEMA_VERSION} (bool/float/str recusados)")
    report.done("schema", errors)
    report.done("demo_flag", [] if evidence.get("demo_only") is True else ["demo_only deve ser exatamente true"])
    method = evidence.get("alignment_method")
    report.done("alignment_method", [] if method == "measured_sections" else ["alignment_method deve ser measured_sections"])
    narration = _narration(report, evidence.get("narration"))
    video = _video(report, evidence.get("video"))
    assets = _assets(report, evidence.get("assets"))
    scenes = _scenes(report, evidence.get("scenes"), assets, narration, video)
    _subtitles(report, evidence.get("subtitles"), scenes, narration)
    _durations(report, narration, video)
    _provenance(report, assets, narration)
    report.skip("acoustic_evidence", "sem inspeção acústica (silêncio/clipping/loudness): execute inspect_pilot_files")
    report.skip("word_alignment", "alinhamento por seções medidas; não há alinhamento por palavra (limitação conhecida)")
    report.skip("physical_files", "manifesto validado sem abrir arquivos; hash/WAV/MP4 reais não verificados")
    report.warn("alinhamento por palavra não verificado: legendas seguem seções medidas, não fala palavra a palavra")
    report.checks["publishability"] = ("not_checked", "publishable=false sempre: licença, voz e revisão humana pendentes")


# --------------------------------------------------------------------------- inspeção física (opcional)

def _is_link(path: Path) -> bool:
    """Symlink ou junction (Windows). Limite: só `root` e os componentes abaixo dele são verificados, não os pais de `root`."""
    return path.is_symlink() or os.path.isjunction(path)


def _confined(root: Path, relative: str):
    """Arquivo regular dentro de `root`, sem symlink/junction; retorna (Path|None, motivo)."""
    if _safe_path(relative):
        return None, "caminho inseguro"
    target = root.joinpath(*relative.split("/"))
    try:
        current = root
        for part in relative.split("/"):
            current = current / part
            if _is_link(current):
                return None, "symlink/junction recusado"
        resolved = target.resolve(strict=True)
        if root.resolve() not in resolved.parents or not resolved.is_file():
            return None, "fora do diretório confinado ou não é arquivo"
        if resolved.stat().st_size > MAX_FILE_BYTES:
            return None, "arquivo acima do limite de leitura"
    except OSError:
        return None, "arquivo ausente ou ilegível"
    return resolved, ""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_sha256(path: Path):
    try:
        return _sha256(path)
    except OSError:
        return None


def _wav_stats(path: Path):
    """(duração, pico 0..1, fração clipada, silêncio inicial, silêncio final) para PCM 16 bits; senão None."""
    with wave.open(str(path), "rb") as wav:
        rate, channels, width, total = wav.getframerate(), wav.getnchannels(), wav.getsampwidth(), wav.getnframes()
        if rate <= 0 or channels <= 0 or total <= 0:
            raise ValueError("WAV vazio")
        duration = total / rate
        if width != 2 or wav.getcomptype() != "NONE":
            return duration, None
        peak, clipped, count, lead, tail, heard = 0, 0, 0, None, 0, False
        done, read_bytes = 0, 0
        while True:
            raw = wav.readframes(rate)
            if not raw:
                break
            read_bytes += len(raw)
            data = array("h")
            data.frombytes(raw[: len(raw) - len(raw) % 2])
            if sys.byteorder == "big":
                data.byteswap()
            for i in range(0, len(data) - channels + 1, channels):
                level = max(abs(data[i + c]) for c in range(channels))
                peak, count = max(peak, level), count + 1
                clipped += level >= 32767
                if level >= SILENCE_PEAK * 32768:
                    heard = True
                    lead = done + i // channels if lead is None else lead
                    tail = 0
                else:
                    tail += 1
            done += len(data) // channels
        if read_bytes != total * channels * width or count != total:
            raise ValueError("WAV truncado: dados PCM lidos menores que o declarado no header")
        lead_s = (lead if lead is not None else count) / rate
        return duration, (peak / 32768, clipped / max(count, 1), lead_s, tail / rate if heard else duration)


def inspect_pilot_files(root, evidence: dict) -> dict:
    """Inspeção física confinada a `root` (leitura apenas): hash dos assets e acústica do WAV da narração.

    Parte do resultado de `validate_pilot_evidence`; um manifesto inválido interrompe a inspeção. Não abre o MP4.
    """
    result = validate_pilot_evidence(evidence)
    report = _Report()
    report.errors, report.warnings = list(result["blocking_errors"]), list(result["warnings"])
    report.checks = {c["id"]: (c["status"], c["detail"]) for c in result["checks"]}
    if result["blocking_errors"]:
        report.skip("physical_files", "manifesto inválido; arquivos não inspecionados")
        return report.result()
    root = Path(root)
    if not root.is_dir():
        report.done("physical_files", ["root não é um diretório"])
        return report.result()
    if _is_link(root):
        report.done("physical_files", ["root é symlink/junction; recusado"])
        return report.result()
    errors, voice_path = [], None
    for asset in evidence["assets"]:
        path, reason = _confined(root, asset["relative_path"])
        if path is None:
            errors.append(f"{asset['id']}: {reason}")
        elif (digest := _safe_sha256(path)) is None:
            errors.append(f"{asset['id']}: arquivo ilegível durante o hash")
        elif digest != asset["sha256"]:
            errors.append(f"{asset['id']}: sha256 do arquivo difere do manifesto")
        elif asset["origin"] == "system_voice" and asset["sha256"] == evidence["narration"]["sha256"]:
            voice_path = path
    report.done("physical_files", errors, detail="hash de todos os assets confere; MP4 não inspecionado")
    if voice_path is None:
        report.skip("acoustic_evidence", "WAV da narração indisponível")
        return report.result()
    try:
        duration, stats = _wav_stats(voice_path)
    except (wave.Error, ValueError, EOFError, OSError) as exc:
        report.done("acoustic_evidence", [f"WAV ilegível: {exc if isinstance(exc, ValueError) else type(exc).__name__}"])
        return report.result()
    problems = []
    if abs(duration - evidence["narration"]["duration_seconds"]) > WAV_DURATION_TOLERANCE:
        problems.append(f"WAV mede {duration:.3f}s; manifesto declara {evidence['narration']['duration_seconds']:.3f}s")
    if stats is None:
        report.skip("acoustic_evidence", "WAV não é PCM 16 bits: silêncio/clipping não verificados")
        report.errors.extend(f"acoustic_evidence: {p}" for p in problems)
        return report.result()
    peak, clipped, lead, tail = stats
    if peak < SILENCE_PEAK:
        problems.append(f"áudio praticamente mudo (pico {peak:.4f} do fundo de escala)")
    if clipped > CLIP_FRACTION:
        problems.append(f"clipping: {clipped:.2%} das amostras no fundo de escala")
    if lead > EDGE_SILENCE_SECONDS or tail > EDGE_SILENCE_SECONDS:
        report.warn(f"silêncio de borda longo (início {lead:.2f}s, fim {tail:.2f}s)")
    report.done("acoustic_evidence", problems,
                detail=f"duração, pico {peak:.2f}, clipping {clipped:.4%}; loudness e inteligibilidade não medidos")
    return report.result()
