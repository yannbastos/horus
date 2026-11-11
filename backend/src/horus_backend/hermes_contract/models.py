"""Modelos versionados do pedido enviado ao Hermes e do resultado editorial esperado.

Pydantic v2 (já presente no ambiente do backend); os JSON Schemas em ../schemas são
gerados a partir destes modelos e um teste garante que não divergem.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from . import CONTRACT_VERSION

Id = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,31}$")]
HexId = Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]
Text = Annotated[str, Field(min_length=1, max_length=4000)]


def _https(value: str) -> str:
    if not value.startswith("https://") or any(ch.isspace() for ch in value):
        raise ValueError("Use uma URL HTTPS sem espaços.")
    return value


HttpsUrl = Annotated[str, Field(max_length=2048), AfterValidator(_https)]

# Somente métricas públicas. Retenção, receita, CTR e afins não existem nos dados de origem.
PublicMetric = Literal["views", "likes", "comments", "duration_seconds", "channel_subscribers"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# --- Pedido (Hórus -> Hermes) -------------------------------------------------------------

class DatasetItem(Strict):
    source_id: Id
    kind: Literal["youtube_video"] = "youtube_video"
    url: HttpsUrl
    title: Annotated[str, Field(min_length=1, max_length=300)]
    channel: Annotated[str, Field(min_length=1, max_length=200)]
    language: Annotated[str, Field(max_length=16)] | None = None
    published_at: datetime
    retrieved_at: datetime
    metrics: dict[PublicMetric, Annotated[int, Field(ge=0)]]


class Dataset(Strict):
    snapshot_id: Id
    origin: Literal["operator_fixture", "youtube_data_api"]
    collected_at: datetime
    items: list[DatasetItem] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def unique_sources(self):
        ids = [item.source_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("source_id repetido no dataset.")
        return self


class ChannelProfile(Strict):
    channel_id: Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")]
    revision_hash: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    summary: Text


class Market(Strict):
    source: Literal["international"] = "international"
    target_country: Literal["BR"] = "BR"
    target_language: Literal["pt-BR"] = "pt-BR"


class RunEnvelope(Strict):
    """Conteúdo serializado em ``input`` de ``POST /v1/runs``."""
    contract_version: Literal["1.0"] = CONTRACT_VERSION
    task_id: HexId
    attempt_id: HexId
    workflow_id: HexId
    revision: Annotated[int, Field(ge=1)]
    objective: Text
    channel_profile: ChannelProfile
    market: Market = Market()
    dataset: Dataset
    constraints: list[Text] = Field(default_factory=list, max_length=20)
    feedback: Annotated[str, Field(max_length=2000)] = ""


class HermesRunRequest(Strict):
    """Corpo HTTP de ``POST /v1/runs``. Campos conferidos no código do Hermes 0.23.1;
    não há campo para toolsets, skills ou formato de resposta por execução."""
    input: Annotated[str, Field(min_length=1)]
    instructions: Annotated[str, Field(min_length=1)]
    model: str | None = None
    provider: str | None = None
    model_options: dict[str, str | int | float | bool] | None = None
    session_id: str | None = None
    metadata: dict[str, str] | None = None


# --- Resultado (Hermes -> Hórus) ----------------------------------------------------------

class PlanStep(Strict):
    step: Text
    done: bool


class Source(Strict):
    id: Id
    kind: Literal["dataset", "web"]
    url: HttpsUrl
    title: Annotated[str, Field(max_length=300)] | None = None
    retrieved_at: datetime


class MetricRef(Strict):
    source_id: Id
    field: PublicMetric
    value: Annotated[int, Field(ge=0)]


class Fact(Strict):
    id: Id
    text: Text
    source_ids: list[Id] = Field(min_length=1, max_length=20)
    metric_refs: list[MetricRef] = Field(default_factory=list, max_length=20)


class Hypothesis(Strict):
    id: Id
    text: Text
    based_on: list[Id] = Field(min_length=1, max_length=20)
    confidence: Literal["low", "medium", "high"]
    how_to_test: Text


class Opportunity(Strict):
    id: Id
    summary: Text
    based_on: list[Id] = Field(min_length=1, max_length=20)
    br_fit_rationale: Text


class Recommendation(Strict):
    title_options: list[Annotated[str, Field(min_length=1, max_length=120)]] = Field(min_length=1, max_length=5)
    premise: Text
    angle: Text
    format: Literal["short", "long"]
    originality: Text
    differs_from: list[Id] = Field(min_length=1, max_length=20)
    risks: list[Text] = Field(default_factory=list, max_length=10)
    licensing_notes: Text


class MemoryProposal(Strict):
    text: Text
    evidence: list[Id] = Field(min_length=1, max_length=10)


class EditorialResult(Strict):
    contract_version: Literal["1.0"]
    task_id: HexId
    status: Literal["complete", "partial", "insufficient_data"]
    plan: list[PlanStep] = Field(max_length=20)
    sources: list[Source] = Field(max_length=60)
    facts: list[Fact] = Field(max_length=60)
    hypotheses: list[Hypothesis] = Field(max_length=30)
    opportunities: list[Opportunity] = Field(max_length=10)
    recommendation: Recommendation | None = None
    unknowns: list[Text] = Field(default_factory=list, max_length=30)
    memory_proposals: list[MemoryProposal] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def complete_requires_recommendation(self):
        if self.status == "complete" and (self.recommendation is None or not self.facts or not self.opportunities):
            raise ValueError("Resultado completo exige fatos, oportunidades e recomendação.")
        return self


SCHEMAS = {
    "run-envelope.v1.json": RunEnvelope,
    "run-request.v1.json": HermesRunRequest,
    "editorial-result.v1.json": EditorialResult,
}
