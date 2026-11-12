"""Adaptação explícita do Radar ao contrato Hermes, sem completar métricas ausentes."""
import hashlib
import re
from datetime import timedelta

from pydantic import BaseModel, ConfigDict, Field
from .hermes_contract.models import ChannelProfile, Dataset, DatasetItem
from .radar_youtube.models import Dataset as RadarDataset, CollectionRequest, PublicRecord


class ChannelInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    channel_id: str = Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
    summary: str = Field(min_length=1, max_length=4000)


class RadarWorkflowRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    snapshot_id: str
    revision: int = Field(ge=1, strict=True)
    source_ids: list[str] | None = Field(default=None, max_length=50)
    objective: str = Field(min_length=1, max_length=4000)
    channel: ChannelInput


def eligibility(dataset):
    result = {}
    for item in dataset.records:
        if item.kind != 'youtube_video':
            continue
        reasons = []
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,31}', item.source_id):
            reasons.append('invalid_source_id')
        if not item.url.startswith('https://') or len(item.url) > 2048 or any(c.isspace() for c in item.url):
            reasons.append('invalid_url')
        if not (item.title or '').strip():
            reasons.append('missing_title')
        if not (item.channel_title or '').strip():
            reasons.append('missing_channel')
        if item.published_at is None:
            reasons.append('missing_published_at')
        result[item.source_id] = dict(eligible=not reasons, reasons=reasons)
    return result


def adapt(dataset, request):
    checks = eligibility(dataset)
    selected = request.source_ids
    if selected is not None and (len(selected)!=len(set(selected)) or any(i not in checks or not checks[i]['eligible'] for i in selected)):
        raise ValueError('source_ids desconhecido, duplicado ou inelegível.')
    included = selected if selected is not None else [k for k,v in checks.items() if v['eligible']][:50]
    if not included:
        raise ValueError('Nenhum item elegível para o workflow.')
    subscribers = {r.youtube_id:r.subscribers for r in dataset.records if r.kind=='youtube_channel'}
    records = {r.source_id:r for r in dataset.records}
    items = []
    for source_id in included:
        r = records[source_id]
        metrics = {k:getattr(r,k) for k in ('views','likes','comments','duration_seconds') if getattr(r,k) is not None}
        if subscribers.get(r.channel_id) is not None:
            metrics['channel_subscribers'] = subscribers[r.channel_id]
        items.append(DatasetItem(source_id=r.source_id, url=r.url, title=r.title.strip()[:300], channel=r.channel_title.strip()[:200],
            language=r.language[:16] if r.language else None, published_at=r.published_at, retrieved_at=r.retrieved_at, metrics=metrics))
    payload = Dataset(snapshot_id=dataset.snapshot_id, origin=dataset.origin, collected_at=dataset.collected_at, items=items)
    profile = ChannelProfile(**request.channel.model_dump(), revision_hash=hashlib.sha256(request.channel.summary.encode('utf-8')).hexdigest())
    radar = dict(snapshot_id=dataset.snapshot_id, revision=dataset.revision, origin=dataset.origin, expires_at=dataset.expires_at.isoformat().replace("+00:00", "Z"),
                 included=included, excluded=[dict(source_id=k,reasons=v['reasons']) for k,v in checks.items() if not v['eligible']])
    return payload, profile, radar


def summary(dataset):
    checks = eligibility(dataset)
    return dict(snapshot_id=dataset.snapshot_id, revision=dataset.revision, origin=dataset.origin, status=dataset.status,
        collected_at=dataset.collected_at.isoformat().replace("+00:00", "Z"), expires_at=dataset.expires_at.isoformat().replace("+00:00", "Z"), records=len(dataset.records),
        videos=len(checks), eligible_videos=sum(v['eligible'] for v in checks.values()), issues=len(dataset.issues))


def demo(snapshot_id, timestamp):
    expires = timestamp + timedelta(days=28)
    common = dict(retrieved_at=timestamp, expires_at=expires, origin='operator_fixture')
    records = [PublicRecord(**common, source_id='channel_demo', kind='youtube_channel', youtube_id='demo_channel',
        url='https://example.org/horus-demo/channel', endpoint='channels.list', title='[DEMONSTRAÇÃO] Canal fictício', subscribers=1234)]
    for i in range(5):
        records.append(PublicRecord(**common, source_id=f'video_demo_{i}', kind='youtube_video', youtube_id=f'demo_{i}',
            url=f'https://example.org/horus-demo/video/{i}', endpoint='videos.list', title=f'[DEMONSTRAÇÃO] Vídeo fictício {i}',
            channel_id='demo_channel', channel_title='[DEMONSTRAÇÃO] Canal fictício', published_at=timestamp-timedelta(days=i+1) if i<4 else None,
            views=100+i, likes=10+i, comments=None, duration_seconds=60+i, language='pt-BR'))
    return RadarDataset(snapshot_id=snapshot_id, revision=1, origin='operator_fixture', collected_at=timestamp, expires_at=expires,
        request=CollectionRequest(videos=['https://example.org/horus-demo']), status='complete', records=records)
