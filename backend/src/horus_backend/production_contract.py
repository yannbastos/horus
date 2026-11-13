"""Contrato puro de adaptação do roteiro M3 aprovado para um plano de produção técnica local (M4).

Sem rede, banco, disco ou fábrica: só transforma `ScriptDocument` em `ProductionPlan` determinístico. O dicionário
`roteiro` segue o formato de `fabrica.modelos.Roteiro` (validado contra o modelo real nos testes, quando a fábrica
está presente) sem copiar o schema da fábrica nem o perfil editorial do canal. Tudo é demonstração/teste:
o plano contém estimativas, não medições de fala. No modo local_pilot o worker precisa gerar TTS e medir WAV
antes de declarar narração disponível. Não há assets externos nem inferência sobre licença ou publicação.
"""
from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BeforeValidator, ConfigDict, Field, model_validator

from .hermes_contract.models import HexId, Id, Strict
from .script_contract import ScriptDocument, validate_script

PLAN_VERSION = 1
WORDS_PER_SECOND = 2.5          # ritmo de referência PT; não copia nem lê o perfil do canal
MIN_LINE_SECONDS, MAX_LINE_SECONDS = 1.5, 20.0
MAX_TOTAL_SECONDS = 600.0       # 30 seções * 20 s
EPSILON = 1e-6
SHA256 = Field(pattern=r"^[a-f0-9]{64}$")


def _exact(expected):
    """Literal compara por igualdade (`1 == True`, `1.0 == 1`, `0 == False`): exigir também o tipo exato."""
    def check(value):
        if type(value) is not type(expected) or value != expected:
            raise ValueError(f"deve ser exatamente {expected!r}.")
        return value
    return BeforeValidator(check)


ExactOne = Annotated[Literal[1], _exact(1)]
ExactTrue = Annotated[Literal[True], _exact(True)]
ExactFalse = Annotated[Literal[False], _exact(False)]


class _Plan(Strict):
    # Sem strip: ids/hash vindos do servidor devem estar exatos (o texto já chega aparado do ScriptDocument).
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False, strict=True)


class PlanLine(_Plan):
    """Linha no formato da fábrica (`LinhaRoteiro`); sem `visual_override`/`busca`: nenhum caminho nem fonte externa."""
    n: int = Field(ge=1, le=30)
    narracao: str = Field(min_length=1, max_length=8000)
    visual: str = Field(min_length=1, max_length=300)
    duracao_estimada: float = Field(gt=0, le=MAX_LINE_SECONDS, allow_inf_nan=False)


class PlanRoteiro(_Plan):
    titulo: str = Field(min_length=1, max_length=200)
    formato: Literal["short"] = "short"
    teste: ExactTrue = True
    linhas: list[PlanLine] = Field(min_length=3, max_length=30)


class PlanScene(_Plan):
    """Cena original gerada localmente, uma por seção do roteiro."""
    id: Id
    n: int = Field(ge=1, le=30)
    kind: Literal["hook", "body", "conclusion"]
    heading: str = Field(min_length=1, max_length=200)
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(gt=0, allow_inf_nan=False)
    duration: float = Field(gt=0, le=MAX_LINE_SECONDS, allow_inf_nan=False)
    source_ids: list[Id] = Field(max_length=50)
    visual_origin: Literal["original_local"] = "original_local"


class PlanAudio(_Plan):
    kind: Literal["fixture_tone", "local_tts"] = "fixture_tone"
    real_voice: ExactFalse = False
    disclosure: str = "Áudio de fixture local (tom): sem narração de voz real."


class PlanSubtitles(_Plan):
    kind: Literal["synthetic_srt"] = "synthetic_srt"
    speech_aligned: ExactFalse = False
    disclosure: str = "Legenda sintética por cena: não é alinhamento real de fala."


class PlanLicense(_Plan):
    publishable: ExactFalse = False
    external_assets: list[str] = Field(default_factory=list, max_length=0)
    basis: str = "Somente cenas originais locais e fixtures; licença/publicação nunca inferidas do render."


class ProductionPlan(_Plan):
    schema_version: ExactOne = 1
    mode: Literal["simulated", "local_demo", "local_pilot"] = "simulated"
    render_quality: Literal["draft", "final"] = "draft"
    demo_only: ExactTrue = True
    script_id: HexId
    script_version: int = Field(ge=1, le=1_000_000)
    script_content_hash: str = SHA256
    title: str = Field(min_length=1, max_length=200)
    roteiro: PlanRoteiro
    scenes: list[PlanScene] = Field(min_length=3, max_length=30)
    total_duration: float = Field(gt=0, le=MAX_TOTAL_SECONDS, allow_inf_nan=False)
    sources: list[Id] = Field(max_length=1500)  # ids do snapshot M3, na ordem de primeira citação
    audio: PlanAudio = Field(default_factory=PlanAudio)
    subtitles: PlanSubtitles = Field(default_factory=PlanSubtitles)
    license: PlanLicense = Field(default_factory=PlanLicense)

    @model_validator(mode="after")
    def coherent(self):
        if (self.audio.kind == "local_tts") != (self.mode == "local_pilot"):
            raise ValueError("tipo de áudio planejado incompatível com modo.")
        if self.render_quality == "final" and self.mode != "local_pilot":
            raise ValueError("render final requer local_pilot.")
        lines, scenes = self.roteiro.linhas, self.scenes
        if self.title != self.roteiro.titulo or len(lines) != len(scenes):
            raise ValueError("roteiro e cenas incoerentes.")
        cursor = 0.0
        for index, (line, scene) in enumerate(zip(lines, scenes), start=1):
            if line.n != index or scene.n != index:
                raise ValueError("linhas e cenas devem ser numeradas 1..N em ordem.")
            if abs(line.duracao_estimada - scene.duration) > EPSILON:
                raise ValueError("duração da cena difere da linha do roteiro.")
            if abs(scene.start - cursor) > EPSILON or abs(scene.end - (scene.start + scene.duration)) > EPSILON:
                raise ValueError("cenas devem ser contíguas, sem lacuna nem sobreposição.")
            cursor = scene.end
        if abs(self.total_duration - cursor) > EPSILON:
            raise ValueError("duração total difere da soma das cenas.")
        if len({scene.id for scene in scenes}) != len(scenes):
            raise ValueError("id de cena repetido.")
        cited = list(dict.fromkeys(ref for scene in scenes for ref in scene.source_ids))
        if self.sources != cited:
            raise ValueError("sources deve listar exatamente os ids citados, na ordem de primeira citação.")
        return self


def line_seconds(narration: str) -> float:
    words = len(narration.split())
    return round(min(max(words / WORDS_PER_SECOND, MIN_LINE_SECONDS), MAX_LINE_SECONDS), 3)


def build_production_plan(script: ScriptDocument, *, script_id: str, script_version: int,
                          script_content_hash: str, mode: Literal["simulated", "local_demo", "local_pilot"] = "simulated",
                          render_quality: Literal["draft", "final"] = "draft") -> ProductionPlan:
    """Plano determinístico: mesma entrada, mesmo plano. `script_id`/versão/hash vêm do servidor.

    Levanta `ValidationError`/`ValueError` para roteiro inválido ou metadados fora do formato (sem coerção).
    """
    if not isinstance(script, ScriptDocument):
        raise ValueError("script deve ser um ScriptDocument.")
    document = validate_script(script, {ref for item in script.sections for ref in item.source_ids})
    lines, scenes, cursor = [], [], 0.0
    for index, section in enumerate(document.sections, start=1):
        seconds = line_seconds(section.narration)
        lines.append(PlanLine(n=index, narracao=section.narration, visual=f"Cena original gerada localmente: {section.heading}"[:300],
                              duracao_estimada=seconds))
        end = round(cursor + seconds, 3)
        scenes.append(PlanScene(id=section.id, n=index, kind=section.kind, heading=section.heading, start=cursor, end=end,
                                duration=seconds, source_ids=list(section.source_ids)))
        cursor = end
    return ProductionPlan(
        mode=mode, render_quality=render_quality, script_id=script_id, script_version=script_version, script_content_hash=script_content_hash,
        title=document.title, roteiro=PlanRoteiro(titulo=document.title, linhas=lines), scenes=scenes,
        audio=PlanAudio(kind="local_tts", disclosure="TTS local solicitado; voz e duração só confirmadas após WAV medido; licença não verificada.") if mode == "local_pilot" else PlanAudio(),
        total_duration=cursor, sources=list(dict.fromkeys(ref for scene in scenes for ref in scene.source_ids)))


def _timestamp(seconds: float) -> str:
    total = int(round(seconds * 1000))
    hours, rest = divmod(total, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    return f"{hours:02d}:{minutes:02d}:{rest // 1000:02d},{rest % 1000:03d}"


def render_srt(plan: ProductionPlan) -> str:
    """SRT sintético por cena (texto da narração em uma linha). Não representa alinhamento real de fala."""
    plan = ProductionPlan.model_validate(plan.model_dump())  # revalida instância possivelmente alterada
    blocks = []
    for scene, line in zip(plan.scenes, plan.roteiro.linhas):
        text = re.sub(r"[\x00-\x1f\x7f  ]+", " ", line.narracao)
        text = re.sub(r"\s+", " ", text).replace("-->", "->").strip()
        blocks.append(f"{scene.n}\n{_timestamp(scene.start)} --> {_timestamp(scene.end)}\n{text}\n")
    return "\n".join(blocks)
