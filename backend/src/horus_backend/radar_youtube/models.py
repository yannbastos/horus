"""Contratos isolados do Radar; não dependem de jobs ou de contratos Hermes."""
from __future__ import annotations

from typing import Literal
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')

class SearchRequest(Strict):
    query: str = Field(min_length=1, max_length=300)
    kind: Literal['video', 'channel'] = 'video'
    language: str | None = Field(default=None, pattern=r'^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$')
    region: str | None = Field(default=None, pattern=r'^[A-Z]{2}$')
    published_after: AwareDatetime | None = None
    published_before: AwareDatetime | None = None
    order: Literal['relevance', 'date', 'viewCount'] = 'relevance'
    duration: Literal['any', 'short', 'medium', 'long'] | None = None
    pages: int = Field(default=1, ge=1, le=5)
    page_size: int = Field(default=25, ge=1, le=50)

    @model_validator(mode='after')
    def filters(self):
        if not self.query.strip():
            raise ValueError('Informe uma palavra-chave.')
        if self.kind == 'channel' and self.duration is not None:
            raise ValueError('Filtro de duração só se aplica a vídeos.')
        if self.published_after and self.published_before and self.published_after >= self.published_before:
            raise ValueError('Período inválido.')
        return self

class CollectionRequest(Strict):
    videos: list[str] = Field(default_factory=list, max_length=50)
    channels: list[str] = Field(default_factory=list, max_length=50)
    search: SearchRequest | None = None
    enrich_channels: bool = True
    upload_pages: int = Field(default=0, ge=0, le=2)

    @model_validator(mode='after')
    def has_input(self):
        if not self.videos and not self.channels and not self.search:
            raise ValueError('Informe referências ou pesquisa por palavras-chave.')
        return self

class PublicRecord(Strict):
    source_id: str
    kind: Literal['youtube_video', 'youtube_channel']
    youtube_id: str
    url: str
    retrieved_at: AwareDatetime
    expires_at: AwareDatetime
    origin: Literal['youtube_data_api'] = 'youtube_data_api'
    endpoint: Literal['videos.list', 'channels.list']
    title: str | None = None
    channel_id: str | None = None
    channel_title: str | None = None
    published_at: AwareDatetime | None = None
    duration_iso8601: str | None = None
    duration_seconds: int | None = Field(default=None, ge=0)
    language: str | None = None
    country: str | None = None
    views: int | None = Field(default=None, ge=0)
    likes: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)
    subscribers: int | None = Field(default=None, ge=0)
    subscribers_rounded: bool | None = None
    video_count: int | None = Field(default=None, ge=0)
    uploads_playlist: str | None = None
    live_status: str | None = None
    unavailable: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode='after')
    def retention(self):
        from datetime import timedelta
        if not self.retrieved_at < self.expires_at <= self.retrieved_at + timedelta(days=28):
            raise ValueError('Retenção de fonte deve ser de no máximo 28 dias.')
        return self

class CollectionIssue(Strict):
    code: str
    resource: str
    references: list[str] = Field(default_factory=list)
    retryable: bool = False
    # Ausente da listagem não distingue exclusão, privacidade ou indisponibilidade regional.
    message: str

class Dataset(Strict):
    schema_version: Literal['radar.youtube.v1'] = 'radar.youtube.v1'
    snapshot_id: str
    revision: int = Field(ge=1)
    origin: Literal['youtube_data_api'] = 'youtube_data_api'
    collected_at: AwareDatetime
    expires_at: AwareDatetime
    request: CollectionRequest
    status: Literal['complete', 'partial', 'failed']
    records: list[PublicRecord]
    issues: list[CollectionIssue] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=lambda: [
        'Amostra limitada; não representa todos os vídeos/canais ou o mercado brasileiro.',
        'País indica disponibilidade; idioma é relevância, não garantia de idioma exclusivo.',
        'Retenção, CTR, receita e audiência privada não foram coletadas nem estimadas.',
        'Contagem de inscritos pode ser arredondada. Duração não comprova que um vídeo é Short.',
        'Não há inferência causal nem autorização automática para produção/publicação.',
    ])
    quota_spent: dict[str, int] = Field(default_factory=dict)

    @model_validator(mode='after')
    def consistent(self):
        from datetime import timedelta
        ids = [item.source_id for item in self.records]
        if len(ids) != len(set(ids)) or self.expires_at <= self.collected_at:
            raise ValueError('Dataset duplicado ou expirado na coleta.')
        if any(item.expires_at < self.expires_at for item in self.records):
            raise ValueError('Dataset não pode estender a retenção de suas fontes.')
        if self.expires_at > self.collected_at + timedelta(days=28) or any(item.retrieved_at > self.collected_at for item in self.records):
            raise ValueError('Retenção ou horário de origem incompatível.')
        return self

class MetricsPermission(Strict):
    approved: bool = False
    approval_reference: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def evidence(self):
        if self.approved and not (self.approval_reference or '').strip():
            raise ValueError('Registre a referência da aprovação do caso de uso pelo YouTube.')
        return self
