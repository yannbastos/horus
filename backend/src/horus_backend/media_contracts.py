"""Contratos puros de mídia: `word-timings.json`, `quality-report.json` e `asset-provenance.json` (HOR-089/097/055).

Sem rede, banco, disco ou subprocesso. Os modelos Pydantic são estritos (`extra=forbid`, tipos exatos, sem coerção) e
as funções `validate_*` nunca levantam: devolvem `{ok, errors:[{code, path, message}], warnings, publishable:false,
value}`. A validação cruzada recebe os fatos reais (hash da narração, duração, texto, seções medidas, hash do vídeo,
artefatos registrados) por parâmetro; sem esse contexto o resultado nunca afirma alinhamento nem aprovação.

Regras que valem para todos os contratos: estimativa nunca aparece como medição; `commercial_use=unknown` nunca
equivale a permitido; nenhum documento pode declarar `publishable` (campo proibido por `extra=forbid`) e as
funções devolvem sempre `publishable=false`. Tempos em segundos relativos ao início do WAV de narração concatenado.
"""
from __future__ import annotations

import copy
import math
import re
from datetime import datetime
from typing import Annotated, Any, Literal, Mapping, Sequence
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from pydantic import BeforeValidator

SCHEMA_VERSION = 1
MAX_SECONDS = 86_400.0
TIME_EPS = 0.001            # precisão de ms dos tempos declarados
SECTION_EPS = 0.05          # jitter aceito entre palavra e limite de seção medida
DURATION_EPS = 0.05         # divergência aceita entre duração declarada e medida
MAX_WORDS = 20_000
MIN_MATCH_RATE = 0.85               # alinhamento acústico: fração mínima de palavras com tempo medido (speech_aligned)
MAX_INTERPOLATED_RUN_SECONDS = 2.0  # maior trecho contínuo de palavras interpoladas aceito (speech_aligned)
MAX_ERRORS = 50

_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
# Texto livre exibido ao operador: além dos controles ASCII, recusa controles C1, separadores de linha Unicode e
# marcas de direção bidirecional (U+202A..202E, U+2066..2069), que permitem esconder/inverter texto na interface.
UNSAFE_TEXT = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f  ‪-‮⁦-⁩]")
_ID = r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$"
SHA256 = Field(pattern=r"^[a-f0-9]{64}$")
_PRODUCTION_ID = Field(pattern=_ID)


def _exact_one(value):
    if type(value) is not int or value != 1:
        raise ValueError("deve ser exatamente 1.")
    return value


SchemaOne = Annotated[Literal[1], BeforeValidator(_exact_one)]
Seconds = Annotated[float, Field(ge=0, le=MAX_SECONDS, allow_inf_nan=False)]
Scalar = str | int | float | bool | None


class _Media(BaseModel):
    # Sem strip: ids, hashes e caminhos vindos do servidor devem estar exatos.
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False, strict=True)


def _iso(value: str) -> str:
    if not isinstance(value, str) or not 10 <= len(value) <= 40:
        raise ValueError("data ISO 8601 inválida.")
    try:
        datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError as error:
        raise ValueError("data ISO 8601 inválida.") from error
    return value


IsoDate = Annotated[str, BeforeValidator(_iso)]


def _safe_path(value: str) -> str | None:
    """None se o caminho é relativo e confinável; senão o motivo (mesma regra de `pilot_quality`)."""
    if not isinstance(value, str) or not value or len(value) > 260:
        return "caminho ausente ou longo demais"
    if _CONTROL.search(value) or "\\" in value or ":" in value or value.startswith(("/", "~")):
        return "caminho absoluto, URL, unidade ou barra invertida"
    for part in value.split("/"):
        if part in ("", ".", "..") or part != part.rstrip(" ."):
            return "segmento vazio, '.', '..' ou terminado em ponto/espaço"
    return None


def _issues_to_error(issues: list[tuple[str, str, str]]) -> None:
    if issues:
        raise ValueError("\n".join(f"{code}@{path}: {message}" for code, path, message in issues[:MAX_ERRORS]))


# ============================================================================================
# 1. word-timings.json
# ============================================================================================

WordSource = Literal["tts_engine_events", "forced_alignment", "estimated"]
WordTimingKind = Literal["measured", "interpolated"]


class WordEngine(_Media):
    name: str = Field(min_length=1, max_length=100)
    voice: str = Field(min_length=1, max_length=200)


class WordTiming(_Media):
    index: int = Field(ge=0, lt=MAX_WORDS)
    text: str = Field(min_length=1, max_length=200, pattern=r"^\S+$")
    section: int = Field(ge=1, le=1000)
    start: Seconds
    end: Seconds
    char_offset: int = Field(ge=0, le=10_000_000)
    char_length: int = Field(ge=1, le=200)
    # Só em forced_alignment: measured = tempo medido pelo ASR; interpolated = palavra sem correspondência, entre
    # âncoras medidas (nunca é medição). None = documento legado, governado por `source`.
    timing: WordTimingKind | None = None


class AlignmentSummary(_Media):
    """Resumo do alinhamento acústico; o validador recomputa tudo a partir das palavras."""
    method: Literal["asr_sequence_match"]
    asr_engine: str = Field(min_length=1, max_length=200)
    matched_words: int = Field(ge=0, lt=MAX_WORDS)
    interpolated_words: int = Field(ge=0, lt=MAX_WORDS)
    match_rate: float = Field(ge=0, le=1, allow_inf_nan=False)
    longest_interpolated_seconds: Seconds


class WordTimings(_Media):
    schema_version: SchemaOne = 1
    narration_sha256: str = SHA256
    duration_seconds: float = Field(gt=0, le=MAX_SECONDS, allow_inf_nan=False)
    source: WordSource
    engine: WordEngine
    words: list[WordTiming] = Field(min_length=1, max_length=MAX_WORDS)
    alignment: AlignmentSummary | None = None

    @model_validator(mode="after")
    def coherent(self):
        issues: list[tuple[str, str, str]] = []
        issues.extend(self._alignment_issues())
        previous = None
        for position, word in enumerate(self.words):
            where = f"words[{position}]"
            if word.index != position:
                issues.append(("word_index", where, "índices devem ser 0..N-1 em ordem."))
            if word.end <= word.start:
                issues.append(("word_span", where, "end deve ser maior que start."))
            if word.end > self.duration_seconds + TIME_EPS:
                issues.append(("word_beyond_duration", where, "palavra termina depois da duração da narração."))
            if len(word.text) != word.char_length:
                issues.append(("word_char_length", where, "char_length difere do tamanho de text."))
            if previous is not None:
                if word.start < previous.start - TIME_EPS:
                    issues.append(("word_out_of_order", where, "palavra começa antes da anterior."))
                elif word.start < previous.end - TIME_EPS:
                    issues.append(("word_overlap", where, "palavra sobrepõe a anterior."))
                if word.char_offset < previous.char_offset + previous.char_length:
                    issues.append(("word_char_order", where, "char_offset deve avançar sem sobrepor a palavra anterior."))
                if word.section < previous.section:
                    issues.append(("section_order", where, "seção não pode regredir."))
            previous = word
        _issues_to_error(issues)
        return self

    def _alignment_issues(self) -> list[tuple[str, str, str]]:
        if self.source != "forced_alignment":
            issues = []
            if self.alignment is not None:
                issues.append(("alignment_not_allowed", "alignment", "alignment só existe com source=forced_alignment."))
            if any(word.timing is not None for word in self.words):
                issues.append(("timing_not_allowed", "words", "timing por palavra só existe com source=forced_alignment."))
            return issues
        if self.alignment is None:
            return [("alignment_missing", "alignment", "forced_alignment exige o resumo alignment.")]
        if any(word.timing is None for word in self.words):
            return [("timing_missing", "words", "forced_alignment exige timing em todas as palavras.")]
        measured, interpolated, longest, run_start = 0, 0, 0.0, None
        for position, word in enumerate(self.words):
            if word.timing == "interpolated":
                interpolated += 1
                run_start = word.start if run_start is None else run_start
                longest = max(longest, word.end - run_start)
            else:
                measured += 1
                run_start = None
        found, summary = [], self.alignment
        if (summary.matched_words, summary.interpolated_words) != (measured, interpolated):
            found.append(("alignment_counts", "alignment", "contagens difere das palavras measured/interpolated."))
        if abs(summary.match_rate - measured / len(self.words)) > 0.0001:
            found.append(("alignment_match_rate", "alignment.match_rate", "match_rate difere de matched_words/total."))
        if abs(summary.longest_interpolated_seconds - longest) > TIME_EPS:
            found.append(("alignment_longest_run", "alignment.longest_interpolated_seconds",
                          "maior trecho interpolado difere do recomputado."))
        return found


# ============================================================================================
# 2. quality-report.json
# ============================================================================================

CheckStatus = Literal["pass", "warn", "fail", "skipped"]
ReportStatus = Literal["pass", "warn", "fail", "not_run"]
CheckCategory = Literal["integrity", "duration", "audio", "sync", "subtitles", "provenance", "visual"]
CheckMethod = Literal["measured", "declared", "estimated"]
CheckId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")]


class QualityTool(_Media):
    name: str = Field(min_length=1, max_length=100)
    version: str = Field(min_length=1, max_length=100)


class Timecode(_Media):
    start: Seconds
    end: Seconds

    @model_validator(mode="after")
    def ordered(self):
        if self.end < self.start:
            raise ValueError("end não pode ser menor que start.")
        return self


class QualityCheck(_Media):
    id: CheckId
    category: CheckCategory
    status: CheckStatus
    method: CheckMethod
    measured: dict[str, Scalar | list[Scalar]] = Field(default_factory=dict, max_length=50)
    threshold: dict[str, Scalar | list[Scalar]] = Field(default_factory=dict, max_length=50)
    detail: str = Field(min_length=1, max_length=2000)
    timecode: Timecode | None = None

    @model_validator(mode="after")
    def honest_method(self):
        issues: list[tuple[str, str, str]] = []
        for section in (self.measured, self.threshold):
            for key, value in section.items():
                for number in value if isinstance(value, list) else [value]:
                    if isinstance(number, float) and not math.isfinite(number):
                        issues.append(("non_finite", key, "números devem ser finitos."))
        if self.method == "measured" and self.status != "skipped":
            source = self.measured.get("source")
            if not isinstance(source, str) or not source.strip():
                issues.append(("measured_without_source", "measured.source", "medição precisa declarar a fonte (measured.source)."))
            elif re.search(r"estimat|heur[ií]stic|declared", source, re.IGNORECASE):
                issues.append(("estimate_as_measured", "measured.source", "estimativa/declaração marcada como medida."))
        if self.method == "estimated" and "source" in self.measured and self.status != "skipped" \
                and not isinstance(self.measured["source"], str):
            issues.append(("estimate_source", "measured.source", "fonte da estimativa deve ser texto."))
        _issues_to_error(issues)
        return self


def derive_report_status(checks: Sequence[QualityCheck]) -> str:
    statuses = {check.status for check in checks}
    if "fail" in statuses:
        return "fail"
    if "warn" in statuses:
        return "warn"
    return "pass" if "pass" in statuses else "not_run"


class QualityReport(_Media):
    schema_version: SchemaOne = 1
    production_id: str = _PRODUCTION_ID
    video_sha256: str = SHA256
    generated_at: IsoDate
    tool: QualityTool
    status: ReportStatus
    checks: list[QualityCheck] = Field(max_length=200)
    blocking_errors: list[CheckId] = Field(max_length=200)
    warnings: list[CheckId] = Field(max_length=200)

    @model_validator(mode="after")
    def coherent(self):
        issues: list[tuple[str, str, str]] = []
        ids = [check.id for check in self.checks]
        if len(set(ids)) != len(ids):
            issues.append(("check_id_duplicate", "checks", "ids de check devem ser únicos."))
        if self.status != derive_report_status(self.checks):
            issues.append(("status_mismatch", "status", f"status deve ser '{derive_report_status(self.checks)}' pelos checks."))
        if self.blocking_errors != [c.id for c in self.checks if c.status == "fail"]:
            issues.append(("blocking_errors_mismatch", "blocking_errors", "deve listar exatamente os checks fail, na ordem."))
        if self.warnings != [c.id for c in self.checks if c.status == "warn"]:
            issues.append(("warnings_mismatch", "warnings", "deve listar exatamente os checks warn, na ordem."))
        _issues_to_error(issues)
        return self


# ============================================================================================
# 3. asset-provenance.json
# ============================================================================================

AssetKind = Literal["image", "video", "audio", "voice", "music", "font"]
AssetOrigin = Literal["original_local", "system_voice", "local_tts_model", "stock_pexels", "stock_pixabay", "licensed_manual"]
CommercialUse = Literal["allowed", "restricted", "unknown"]
AssetStatus = Literal["verified", "unverified", "rejected"]
EXTERNAL_ORIGINS = ("stock_pexels", "stock_pixabay", "licensed_manual")
# Entradas registradas do piloto local (cenas, áudios e a fonte da legenda libass); nunca saídas derivadas.
PILOT_INPUT_PATH = re.compile(
    r"canais/demo/videos/fixture/(?:scene-\d+\.png|section-\d+\.wav|fixture\.wav|fonts/[A-Za-z0-9_-]+\.ttf)")
STOCK_HOSTS = {"stock_pexels": "pexels.com", "stock_pixabay": "pixabay.com"}


class AssetLicense(_Media):
    id: str | None = Field(default=None, min_length=1, max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    url: str | None = Field(default=None, min_length=1, max_length=2000)
    commercial_use: CommercialUse
    attribution_required: bool | None
    verified_by: Literal["human"] | None
    verified_at: IsoDate | None


class ProvenanceAsset(_Media):
    asset_id: str = Field(pattern=_ID)
    relative_path: str = Field(min_length=1, max_length=260)
    sha256: str = SHA256
    kind: AssetKind
    origin: AssetOrigin
    source_url: str | None = Field(default=None, min_length=1, max_length=2000)
    author: str | None = Field(default=None, min_length=1, max_length=300)
    license: AssetLicense
    status: AssetStatus
    notes: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def coherent(self):
        issues: list[tuple[str, str, str]] = []
        reason = _safe_path(self.relative_path)
        if reason:
            issues.append(("unsafe_path", "relative_path", reason))
        lic = self.license
        for field, text in (("author", self.author), ("notes", self.notes), ("license.id", lic.id),
                            ("license.name", lic.name)):
            if text is not None and UNSAFE_TEXT.search(text):
                issues.append(("unsafe_text", field, "texto com caracteres de controle ou de direção."))
        if (lic.verified_by is None) != (lic.verified_at is None):
            issues.append(("verification_incomplete", "license", "verified_by e verified_at devem vir juntos."))
        external = self.origin in EXTERNAL_ORIGINS
        if external and self.status != "rejected":
            if not self.source_url:
                issues.append(("missing_source_url", "source_url", "asset externo exige URL de origem."))
            if not self.author:
                issues.append(("missing_author", "author", "asset externo exige autor."))
            if not (lic.id and lic.name and lic.url):
                issues.append(("missing_license", "license", "asset externo exige licença (id, nome e URL dos termos)."))
        for field, url in (("source_url", self.source_url), ("license.url", lic.url)):
            if url is not None and (problem := _url_problem(url, STOCK_HOSTS.get(self.origin) if field == "source_url" else None)):
                issues.append(("invalid_url", field, problem))
        if self.status == "verified":
            if lic.verified_by != "human":
                issues.append(("verified_without_human", "license.verified_by", "verified exige verificação humana registrada."))
            if lic.commercial_use == "unknown":
                issues.append(("verified_unknown_commercial", "license.commercial_use", "commercial_use desconhecido não pode ser verified."))
            if lic.attribution_required is None:
                issues.append(("verified_unknown_attribution", "license.attribution_required", "verified exige saber se há atribuição."))
        _issues_to_error(issues)
        return self


class AssetProvenance(_Media):
    schema_version: SchemaOne = 1
    assets: list[ProvenanceAsset] = Field(max_length=500)

    @model_validator(mode="after")
    def unique(self):
        issues: list[tuple[str, str, str]] = []
        for label, values in (("asset_id", [a.asset_id for a in self.assets]),
                              ("relative_path", [a.relative_path.lower() for a in self.assets])):
            if len(set(values)) != len(values):
                issues.append(("duplicate_" + label, "assets", f"{label} repetido (caminhos sem diferenciar maiúsculas)."))
        _issues_to_error(issues)
        return self


def _url_problem(url: str, host: str | None) -> str | None:
    if UNSAFE_TEXT.search(url) or any(ch.isspace() for ch in url):
        return "URL com espaço, controle ou marca de direção."
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
    except ValueError:
        return "URL inválida."
    if parts.scheme != "https" or not hostname or parts.username or parts.password:
        return "URL deve ser https, com host e sem credenciais."
    if host and hostname != host and not hostname.endswith("." + host):
        return f"URL deve pertencer a {host}."
    return None


def commercial_use_permitted(asset: ProvenanceAsset) -> bool:
    """Somente `allowed` verificado por humano permite uso comercial; `unknown`/`restricted`/não verificado nunca."""
    lic = asset.license
    return asset.status == "verified" and lic.commercial_use == "allowed" and lic.verified_by == "human"


def apply_license_reviews(provenance: Mapping, reviews: Sequence[Mapping]) -> dict:
    """Visão efetiva do `asset-provenance.json` com as decisões humanas de licença (HOR-097). Função pura.

    `reviews` vem da mais antiga para a mais nova; vale a última por `asset_id` cujo `asset_sha256` coincide com o do
    asset (decisão com hash diferente é ignorada). O original não é alterado e o resultado é revalidado;
    `ValueError` se o documento original ou o efetivo for inválido.
    """
    first = validate_asset_provenance(provenance)
    if not first["ok"]:
        raise ValueError("asset-provenance inválido.")
    effective = copy.deepcopy(first["value"])
    for asset in effective["assets"]:
        review = next((r for r in reversed(reviews) if r["asset_id"] == asset["asset_id"]
                       and r["asset_sha256"] == asset["sha256"]), None)
        if review is None:
            continue
        human = review["decision"] == "verified"
        asset["status"] = review["decision"]
        asset["license"] = {**asset["license"], **{k: review["license"][k] for k in
                            ("id", "name", "url", "commercial_use", "attribution_required")},
                            "verified_by": "human" if human else None,
                            "verified_at": review["reviewed_at"] if human else None}
    second = validate_asset_provenance(effective)
    if not second["ok"]:
        raise ValueError("asset-provenance efetivo inválido.")
    return second["value"]


# ============================================================================================
# Funções de validação (nunca levantam)
# ============================================================================================

def _result(errors: list[dict], warnings: list[str], value: BaseModel | None, *, exclude_none: bool = False,
            **extra) -> dict:
    dumped = value.model_dump(mode="json", exclude_none=exclude_none) if value is not None and not errors else None
    return {"schema_version": SCHEMA_VERSION, "ok": not errors, "errors": errors[:MAX_ERRORS], "warnings": warnings,
            "publishable": False, "value": dumped, **extra}


def _error(code: str, path: str, message: str) -> dict:
    return {"code": code, "path": path, "message": _CONTROL.sub("?", message)[:500]}


def _schema_errors(error: ValidationError) -> list[dict]:
    found = []
    for item in error.errors(include_url=False, include_input=False):
        path = ".".join(str(part) for part in item["loc"])
        message = str(item["msg"]).removeprefix("Value error, ")
        coded = [line for line in message.split("\n") if re.match(r"^[a-z_]+@[^:]*: ", line)]
        if coded:
            for line in coded:
                head, _, text = line.partition(": ")
                code, _, sub = head.partition("@")
                found.append(_error(code, ".".join(filter(None, [path, sub])), text))
        else:
            found.append(_error("schema_" + item["type"], path, message))
    return found


def _parse(model: type[BaseModel], data: Any) -> tuple[BaseModel | None, list[dict]]:
    try:
        return model.model_validate(data), []
    except ValidationError as error:
        return None, _schema_errors(error)
    except Exception as error:  # noqa: BLE001 - contrato: validação pura nunca levanta
        return None, [_error("internal_error", "", f"{type(error).__name__}")]


def _num(value) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def validate_word_timings(data: Any, *, narration_sha256: str | None = None, duration_seconds: float | None = None,
                          script_text: str | None = None, sections: Sequence[Mapping] | None = None) -> dict:
    """Valida `word-timings.json` e, com o contexto real, cruza com narração, roteiro e seções medidas.

    `sections`: `[{section, start, end}]` medidos (segundos, mesma base do WAV concatenado). `speech_aligned` só é
    verdadeiro com documento válido, fonte != estimated e TODO o contexto (hash, roteiro, seções) fornecido e coerente.
    """
    try:
        return _validate_word_timings(data, narration_sha256, duration_seconds, script_text, sections)
    except Exception as error:  # noqa: BLE001
        return _result([_error("internal_error", "", type(error).__name__)], [], None, speech_aligned=False)


def _validate_word_timings(data, narration_sha256, duration_seconds, script_text, sections) -> dict:
    model, errors = _parse(WordTimings, data)
    warnings: list[str] = []
    if model is None:
        return _result(errors, warnings, None, speech_aligned=False)
    if narration_sha256 is None:
        warnings.append("narration_hash_not_checked")
    elif narration_sha256 != model.narration_sha256:
        errors.append(_error("narration_hash_mismatch", "narration_sha256", "hash difere do WAV de narração registrado."))
    if duration_seconds is None:
        warnings.append("duration_not_checked")
    elif not _num(duration_seconds) or abs(duration_seconds - model.duration_seconds) > DURATION_EPS:
        errors.append(_error("duration_mismatch", "duration_seconds", "duração difere da duração medida do WAV."))
    if script_text is None:
        warnings.append("script_not_checked")
    else:
        errors.extend(_cover_script(model, script_text))
    if sections is None:
        warnings.append("sections_not_checked")
    else:
        errors.extend(_check_sections(model, sections))
    if model.source == "estimated":
        warnings.append("estimated_source_not_speech_aligned")
    if model.source == "forced_alignment" and model.alignment is not None and not errors:
        if (model.alignment.match_rate < MIN_MATCH_RATE
                or model.alignment.longest_interpolated_seconds > MAX_INTERPOLATED_RUN_SECONDS):
            warnings.append("alignment_below_threshold")
    aligned = (not errors and not warnings and model.source != "estimated")
    # exclude_none: o documento só ganha `timing`/`alignment` quando forced_alignment os declara (legado idêntico).
    return _result(errors, warnings, model, exclude_none=True, speech_aligned=aligned)


def _cover_script(model: WordTimings, script_text: str) -> list[dict]:
    tokens = [(m.start(), m.group()) for m in re.finditer(r"\S+", script_text)]
    errors: list[dict] = []
    if len(model.words) < len(tokens):
        errors.append(_error("words_missing", "words", f"faltam {len(tokens) - len(model.words)} palavras do roteiro."))
    elif len(model.words) > len(tokens):
        errors.append(_error("words_extra", "words", f"{len(model.words) - len(tokens)} palavras além do roteiro."))
    for position, (word, (offset, text)) in enumerate(zip(model.words, tokens)):
        if word.text != text or word.char_offset != offset:
            errors.append(_error("word_text_mismatch", f"words[{position}]", "palavra ou posição difere do roteiro."))
            if len(errors) >= MAX_ERRORS:
                break
    return errors


def _check_sections(model: WordTimings, sections: Sequence[Mapping]) -> list[dict]:
    bounds: dict[int, tuple[float, float]] = {}
    for position, item in enumerate(sections):
        ok = (isinstance(item, Mapping) and type(item.get("section")) is int and _num(item.get("start"))
              and _num(item.get("end")) and 0 <= item["start"] < item["end"] and item["section"] not in bounds)
        if not ok:
            return [_error("invalid_sections", f"sections[{position}]", "seção medida inválida ou repetida.")]
        bounds[item["section"]] = (float(item["start"]), float(item["end"]))
    errors = []
    for position, word in enumerate(model.words):
        span = bounds.get(word.section)
        if span is None:
            errors.append(_error("unknown_section", f"words[{position}].section", "seção sem medição."))
        elif word.start < span[0] - SECTION_EPS or word.end > span[1] + SECTION_EPS:
            errors.append(_error("word_outside_section", f"words[{position}]", "palavra fora dos limites medidos da seção."))
        if len(errors) >= MAX_ERRORS:
            break
    return errors


def validate_quality_report(data: Any, *, video_sha256: str | None = None, production_id: str | None = None,
                            word_timings_source: str | None = None) -> dict:
    """Valida `quality-report.json`; com `video_sha256` real cruza o relatório com o MP4 aprovado.

    `word_timings_source`: fonte do `word-timings.json` validado; se `estimated`, checks `sync` não podem ser `measured`.
    """
    try:
        model, errors = _parse(QualityReport, data)
        warnings: list[str] = []
        if model is None:
            return _result(errors, warnings, None)
        if video_sha256 is None:
            warnings.append("video_hash_not_checked")
        elif video_sha256 != model.video_sha256:
            errors.append(_error("video_hash_mismatch", "video_sha256", "relatório pertence a outro vídeo."))
        if production_id is not None and production_id != model.production_id:
            errors.append(_error("production_mismatch", "production_id", "relatório pertence a outra produção."))
        if word_timings_source == "estimated":
            for position, check in enumerate(model.checks):
                if check.category == "sync" and check.method == "measured" and check.status != "skipped":
                    errors.append(_error("estimate_as_measured", f"checks[{position}]",
                                         "sincronia baseada em word-timings estimados não pode ser medida."))
        return _result(errors, warnings, model)
    except Exception as error:  # noqa: BLE001
        return _result([_error("internal_error", "", type(error).__name__)], [], None)


def validate_asset_provenance(data: Any, *, artifacts: Mapping[str, str] | None = None) -> dict:
    """Valida `asset-provenance.json`; com `artifacts` ({relative_path: sha256} registrados) cruza caminhos e hashes.

    Todo asset declarado precisa estar registrado com o mesmo hash, e todo artefato de mídia registrado precisa ter
    proveniência. Para checar só os declarados passe o mapa já filtrado aos artefatos de mídia.
    """
    try:
        model, errors = _parse(AssetProvenance, data)
        warnings: list[str] = []
        if model is None:
            return _result(errors, warnings, None)
        if artifacts is None:
            warnings.append("artifacts_not_checked")
        else:
            registered = {str(path).lower(): (str(path), sha) for path, sha in artifacts.items()}
            declared = set()
            for position, asset in enumerate(model.assets):
                key = asset.relative_path.lower()
                declared.add(key)
                found = registered.get(key)
                where = f"assets[{position}]"
                if found is None:
                    errors.append(_error("asset_not_registered", where, "asset não está entre os artefatos registrados."))
                elif found[1] != asset.sha256:
                    errors.append(_error("hash_mismatch", where, "sha256 difere do artefato registrado."))
            for key, (path, _sha) in registered.items():
                if key not in declared:
                    errors.append(_error("artifact_without_provenance", path, "artefato registrado sem proveniência."))
        unverified = [a.asset_id for a in model.assets if a.status != "verified"]
        if unverified:
            warnings.append("unverified_assets_block_publication")
        return _result(errors, warnings, model)
    except Exception as error:  # noqa: BLE001
        return _result([_error("internal_error", "", type(error).__name__)], [], None)


SCHEMAS: dict[str, type[BaseModel]] = {
    "word-timings.schema.json": WordTimings,
    "quality-report.schema.json": QualityReport,
    "asset-provenance.schema.json": AssetProvenance,
}
