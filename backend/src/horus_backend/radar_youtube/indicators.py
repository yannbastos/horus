"""Análise determinística opcional. Sem aprovação, não calcula métricas derivadas."""
from statistics import median

from .models import Dataset, MetricsPermission
from .state import utcnow

def opportunity_indicators(dataset: Dataset, permission: MetricsPermission | None = None, *,
                           minimum_peers=5, threshold=3.0, clock=utcnow):
    if dataset.expires_at <= clock():
        raise ValueError('Dataset expirado: colete novamente antes de analisar.')
    if not 3 <= minimum_peers <= 100 or not 1 < threshold <= 1000:
        raise ValueError('Configuração de amostra/limiar inválida.')
    videos = [item for item in dataset.records if item.kind == 'youtube_video']
    # Apenas ordenação de valores brutos; None não é zero e não entra na ordenação.
    ordered = sorted((item for item in videos if item.views is not None), key=lambda item: (-item.views, item.youtube_id))
    report = {'schema_version': 'radar.indicators.v1', 'snapshot_id': dataset.snapshot_id, 'revision': dataset.revision,
              'expires_at': dataset.expires_at.isoformat(),
              'raw_view_order': [item.source_id for item in ordered], 'metrics': [],
              'status': 'blocked_policy', 'limitation': 'Não estima causalidade, retenção, CTR, receita ou sucesso futuro.'}
    if not permission or not permission.approved:
        report['reason'] = 'Métricas derivadas dependem de aprovação do caso de uso; cálculo não executado.'
        return report
    report.update(status='available', approval_reference=permission.approval_reference)
    for candidate in ordered:
        if not candidate.channel_id or candidate.duration_seconds is None or candidate.live_status in {'live', 'upcoming'}:
            continue
        peers = [item for item in videos if item.youtube_id != candidate.youtube_id
                 and item.channel_id == candidate.channel_id and item.views is not None
                 and item.duration_seconds is not None
                 and (item.duration_seconds <= 180) == (candidate.duration_seconds <= 180)
                 and item.live_status not in {'live', 'upcoming'}]
        if len(peers) < minimum_peers:
            continue
        baseline = median(item.views for item in peers)
        if baseline <= 0:
            continue
        ratio = candidate.views / baseline
        report['metrics'].append({'source_id': candidate.source_id, 'origin': 'horus_derived_not_youtube_metric',
            'method': 'views / median(views of other sampled videos in same channel and duration band)',
            'ratio_to_sample_median': ratio, 'peer_source_ids': [item.source_id for item in peers],
            'peer_count': len(peers), 'sample_median_views': baseline, 'possible_outlier': ratio >= threshold,
            'limitations': 'Amostra incompleta; idades diferentes; duração não comprova Shorts; correlação não implica causalidade.'})
    return report
