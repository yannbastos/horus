"""Regressões offline: nenhuma credencial ou conexão real é utilizada."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from io import BytesIO
import json
import socket
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError

import pytest
from pydantic import ValidationError

from horus_backend.radar_youtube.collector import YouTubeCollector, duration, number
from horus_backend.radar_youtube.models import CollectionRequest, SearchRequest, Dataset, MetricsPermission
from horus_backend.radar_youtube.references import video_id, channel_reference
from horus_backend.radar_youtube.state import RadarState, BudgetExceeded
from horus_backend.radar_youtube.transport import GoogleTransport, CollectionError, NoRedirect
from horus_backend.radar_youtube.indicators import opportunity_indicators

VIDEO = 'aaaaaaaaaaa'
CHANNEL = 'UC' + 'a' * 22


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError('Rede real proibida neste teste')
    monkeypatch.setattr(socket, 'create_connection', refuse)


@pytest.fixture
def state(tmp_path):
    now = [datetime(2026, 11, 11, tzinfo=timezone.utc)]
    result = RadarState(tmp_path / 'radar-youtube.sqlite3', clock=lambda: now[0])
    result.advance = lambda **kwargs: now.__setitem__(0, now[0] + timedelta(**kwargs))
    return result


def video(identifier=VIDEO, views='10', **kwargs):
    return {'id': identifier, 'snippet': {'title': 'Referência', 'channelId': CHANNEL,
        'channelTitle': 'Canal', 'publishedAt': '2026-10-01T00:00:00Z', 'liveBroadcastContent': 'none'},
        'contentDetails': {'duration': 'PT1M30S'}, 'statistics': {'viewCount': views, **kwargs}}


def channel():
    return {'id': CHANNEL, 'snippet': {'title': 'Canal'},
        'statistics': {'subscriberCount': '1200', 'hiddenSubscriberCount': False},
        'contentDetails': {'relatedPlaylists': {'uploads': 'UU' + 'a' * 22}}}


class Fake:
    def __init__(self, handler):
        self.handler, self.calls = handler, []

    def get(self, resource, params):
        self.calls.append((resource, deepcopy(params)))
        return deepcopy(self.handler(resource, params))


def collector(state, rows=None, **kwargs):
    fake = Fake(lambda resource, params: {'items': rows if resource == 'videos' else [channel()]})
    return YouTubeCollector(fake, state, sleep=lambda _: None, **kwargs), fake


@pytest.mark.parametrize('reference', [VIDEO, 'https://youtu.be/' + VIDEO,
    'https://www.youtube.com/watch?v=' + VIDEO, 'https://youtube.com/shorts/' + VIDEO,
    'https://youtube.com/live/' + VIDEO])
def test_video_references(reference):
    assert video_id(reference) == VIDEO


@pytest.mark.parametrize('reference', ['http://youtu.be/' + VIDEO, 'https://evil.test/' + VIDEO,
    'https://youtube.com/watch?v=' + VIDEO + '&v=bbbbbbbbbbb', 'https://user@youtube.com/watch?v=' + VIDEO])
def test_unsafe_references(reference, state):
    engine, fake = collector(state, [video()])
    with pytest.raises(ValueError):
        engine.collect(CollectionRequest(videos=[reference]))
    assert not fake.calls


@pytest.mark.parametrize(('reference', 'expected'), [
    (CHANNEL, ('id', CHANNEL)), ('https://youtube.com/channel/' + CHANNEL, ('id', CHANNEL)),
    ('https://youtube.com/@example/videos', ('forHandle', '@example')),
    ('https://youtube.com/user/example', ('forUsername', 'example'))])
def test_channel_references(reference, expected):
    assert channel_reference(reference) == expected


@pytest.mark.parametrize('kwargs', [{'query': ' '}, {'query': 'q', 'pages': 6},
    {'query': 'q', 'kind': 'channel', 'duration': 'short'},
    {'query': 'q', 'region': 'br'}, {'query': 'q', 'published_after': '2026-01-01'}])
def test_invalid_search(kwargs):
    with pytest.raises(ValidationError):
        SearchRequest(**kwargs)


def test_public_fields_missing_zero_and_hidden(state):
    rows = [video(views='0', likeCount='0')]
    engine, fake = collector(state, rows)
    result = engine.collect(CollectionRequest(videos=[VIDEO]))
    item = result.records[0]
    assert result.status == 'complete'
    assert item.views == item.likes == 0 and item.comments is None
    assert item.duration_seconds == 90 and item.published_at.tzinfo
    assert item.unavailable['comments'] == 'not_returned_or_invalid'
    assert item.unavailable['retention'] == 'not_public'
    assert result.records[1].subscribers_rounded is True
    assert Dataset.model_validate_json(result.model_dump_json()) == result
    assert [resource for resource, _ in fake.calls] == ['videos', 'channels']


def test_hidden_subscribers(state):
    row = channel()
    row['statistics']['hiddenSubscriberCount'] = True
    fake = Fake(lambda *_: {'items': [row]})
    item = YouTubeCollector(fake, state).collect(CollectionRequest(channels=[CHANNEL])).records[0]
    assert item.subscribers is None and item.unavailable['subscribers'] == 'not_public'


@pytest.mark.parametrize(('value', 'expected'), [('PT0S', 0), ('P1DT2H3M4S', 93784),
    ('P', None), ('invalid', None), (None, None)])
def test_duration(value, expected):
    assert duration(value) == expected


@pytest.mark.parametrize('value', [-1, True, 'nan', '1.5', 2**64, None])
def test_invalid_counts(value):
    assert number(value) is None


def test_keyword_discovery_pagination_and_cache(state):
    second = 'bbbbbbbbbbb'
    def reply(resource, params):
        if resource == 'search':
            assert params['relevanceLanguage'] == 'es' and params['regionCode'] == 'BR'
            assert params['publishedAfter'].startswith('2026-01-01')
            return {'items': [{'id': {'videoId': second if 'pageToken' in params else VIDEO}}],
                    **({} if 'pageToken' in params else {'nextPageToken': 'next'})}
        return {'items': [video(identifier) for identifier in params['id'].split(',')]}
    fake = Fake(reply)
    engine = YouTubeCollector(fake, state)
    request = CollectionRequest(search=SearchRequest(query='astronomia', language='es', region='BR',
        pages=2, published_after='2026-01-01T00:00:00Z'), enrich_channels=False)
    result = engine.collect(request)
    assert len(result.records) == 2 and result.quota_spent == {'search': 2, 'details': 1}
    again = engine.collect(request)
    assert len(fake.calls) == 3 and again.quota_spent == {'search': 0, 'details': 0}
    assert again.records[0].retrieved_at == result.records[0].retrieved_at


def test_channels_and_upload_discovery(state):
    def reply(resource, params):
        return {'items': {'search': [{'id': {'channelId': CHANNEL}}], 'channels': [channel()],
            'playlistItems': [{'contentDetails': {'videoId': VIDEO}}], 'videos': [video()]}[resource]}
    fake = Fake(reply)
    result = YouTubeCollector(fake, state).collect(CollectionRequest(
        search=SearchRequest(query='natureza', kind='channel'), upload_pages=1))
    assert len(result.records) == 2
    assert [resource for resource, _ in fake.calls] == ['search', 'channels', 'playlistItems', 'videos']


@pytest.mark.parametrize(('pages', 'code'), [(1, 'pagination_limited'), (3, 'pagination_loop')])
def test_pagination_bounds(state, pages, code):
    fake = Fake(lambda *_: {'items': [], 'nextPageToken': 'same'})
    result = YouTubeCollector(fake, state).collect(CollectionRequest(search=SearchRequest(query='q', pages=pages)))
    assert result.issues[0].code == code and len(fake.calls) <= 2


def test_missing_resource_refresh_invalidates_old_copy(state):
    engine, fake = collector(state, [video()])
    original = engine.collect(CollectionRequest(videos=[VIDEO], enrich_channels=False))
    fake.handler = lambda *_: {'items': []}
    refreshed = engine.refresh(original.snapshot_id, 1)
    assert refreshed.revision == 2 and refreshed.status == 'failed'
    assert refreshed.issues[0].code == 'not_returned'
    with pytest.raises(KeyError):
        state.load(original.snapshot_id, 1)


def test_retry_charged_and_bounded(state):
    def fail(*_):
        raise CollectionError('transport', 'Falhou', retryable=True)
    fake = Fake(fail)
    result = YouTubeCollector(fake, state, sleep=lambda _: None).collect(CollectionRequest(videos=[VIDEO]))
    assert len(fake.calls) == 2 and result.quota_spent['details'] == 2
    assert result.status == 'failed' and result.issues[0].retryable


def test_upstream_quota_blocks_later_collections(state):
    def fail(*_):
        raise CollectionError('upstream_quota', 'Cota', quota=True)
    fake = Fake(fail)
    engine = YouTubeCollector(fake, state)
    request = CollectionRequest(videos=[VIDEO])
    assert engine.collect(request).issues[0].code == 'upstream_quota'
    assert engine.collect(request).issues[0].code == 'local_quota'
    assert len(fake.calls) == 1


def test_quota_atomic_persistent_and_separate(state):
    def reserve(_):
        try:
            RadarState(state.path, clock=state.clock).reserve('search', 2)
            return True
        except BudgetExceeded:
            return False
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(reserve, range(8))) == 2
    state.reserve('details', 1)
    with pytest.raises(BudgetExceeded):
        state.reserve('search', 2)
    state.advance(hours=26)
    state.reserve('search', 2)


def test_per_collection_budget(state):
    engine, fake = collector(state, [video()], max_calls=1)
    result = engine.collect(CollectionRequest(videos=[VIDEO]))
    assert result.status == 'partial' and result.issues[0].code == 'local_quota'
    assert len(fake.calls) == 1


def test_cache_projection_expiry_and_dataset_revisions(state):
    row = video()
    row['statistics']['privateMetric'] = 'secret'
    row['snippet']['description'] = 'not needed'
    engine, fake = collector(state, [row])
    request = CollectionRequest(videos=[VIDEO], enrich_channels=False)
    first = engine.collect(request)
    with state.connect() as db:
        payload = db.execute('SELECT payload FROM radar_cache').fetchone()[0]
        assert 'privateMetric' not in payload and 'description' not in payload
    with pytest.raises(sqlite3.IntegrityError):
        state.save(first)
    state.advance(hours=7)
    newer = engine.refresh(first.snapshot_id, 1)
    assert newer.revision == 2 and newer.records[0].retrieved_at > first.records[0].retrieved_at
    state.advance(days=29)
    with pytest.raises(KeyError):
        state.load(first.snapshot_id, 2)
    with state.connect() as db:
        assert db.execute('SELECT COUNT(*) FROM radar_cache').fetchone()[0] == 0


def test_refuses_operational_database(tmp_path):
    with pytest.raises(ValueError):
        RadarState(tmp_path / 'operational.sqlite3')
    path = tmp_path / 'radar-youtube.sqlite3'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE jobs(id TEXT)')
    with pytest.raises(ValueError):
        RadarState(path)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == [('jobs',)]


def test_indicators_require_permission_and_exclude_self(state):
    rows = [video(str(index).zfill(11), views='1000' if index == 0 else '10') for index in range(6)]
    engine, _ = collector(state, rows)
    dataset = engine.collect(CollectionRequest(videos=[row['id'] for row in rows], enrich_channels=False))
    blocked = opportunity_indicators(dataset, clock=state.clock)
    assert blocked['status'] == 'blocked_policy' and blocked['metrics'] == []
    with pytest.raises(ValidationError):
        MetricsPermission(approved=True)
    report = opportunity_indicators(dataset, MetricsPermission(approved=True, approval_reference='mock-only'), clock=state.clock)
    candidate = report['metrics'][0]
    assert candidate['ratio_to_sample_median'] == 100 and candidate['peer_count'] == 5
    assert candidate['source_id'] not in candidate['peer_source_ids'] and candidate['possible_outlier']
    state.advance(days=29)
    with pytest.raises(ValueError):
        opportunity_indicators(dataset, clock=state.clock)


def test_zero_baseline_is_not_outlier(state):
    rows = [video(str(index).zfill(11), views='100' if index == 0 else '0') for index in range(6)]
    engine, _ = collector(state, rows)
    dataset = engine.collect(CollectionRequest(videos=[row['id'] for row in rows], enrich_channels=False))
    report = opportunity_indicators(dataset, MetricsPermission(approved=True, approval_reference='mock'), clock=state.clock)
    assert not any(row['source_id'] == dataset.records[0].source_id for row in report['metrics'])


def test_transport_default_offline():
    with pytest.raises(CollectionError, match='Rede desabilitada'):
        GoogleTransport('mock-key').get('videos', {})
    assert NoRedirect().redirect_request(None, None, None, None, None, None) is None


@pytest.mark.parametrize(('status', 'reason', 'code', 'retry'), [
    (403, 'quotaExceeded', 'upstream_quota', False), (403, 'forbidden', 'http_403', False),
    (404, 'notFound', 'http_404', False), (429, 'rateLimitExceeded', 'rate_limit', True),
    (503, 'backendError', 'http_503', True)])
def test_transport_http_errors_sanitized(monkeypatch, status, reason, code, retry):
    from horus_backend.radar_youtube import transport
    class Opener:
        def open(self, *args, **kwargs):
            raise HTTPError('https://example/?key=mock-sensitive', status, 'secret', {},
                BytesIO(json.dumps({'error': {'errors': [{'reason': reason}]}}).encode()))
    monkeypatch.setattr(transport, 'build_opener', lambda *_: Opener())
    with pytest.raises(CollectionError) as caught:
        GoogleTransport('mock-sensitive', allow_network=True).get('videos', {})
    assert caught.value.code == code and caught.value.retryable == retry
    assert 'mock-sensitive' not in str(caught.value)


def test_malformed_response_becomes_dataset_issue(state):
    fake = Fake(lambda *_: {'unexpected': []})
    result = YouTubeCollector(fake, state).collect(CollectionRequest(videos=[VIDEO]))
    assert result.status == 'failed' and result.issues[0].code == 'invalid_response'


def test_detail_batches_at_most_fifty_and_deduplicates(state):
    identifiers = [str(index).zfill(11) for index in range(51)]
    def reply(resource, params):
        if resource == 'search':
            ids = identifiers[50:] + [identifiers[0]] if 'pageToken' in params else identifiers[:50]
            return {'items': [{'id': {'videoId': identifier}} for identifier in ids],
                    **({} if 'pageToken' in params else {'nextPageToken': 'next'})}
        batch = params['id'].split(',')
        assert len(batch) <= 50
        return {'items': [video(identifier) for identifier in batch]}
    fake = Fake(reply)
    dataset = YouTubeCollector(fake, state).collect(CollectionRequest(
        search=SearchRequest(query='q', pages=2, page_size=50), enrich_channels=False))
    assert len(dataset.records) == 51 and dataset.quota_spent == {'search': 2, 'details': 2}


def test_sample_requires_enough_comparable_peers(state):
    rows = [video(str(index).zfill(11)) for index in range(6)]
    rows[-1]['snippet']['liveBroadcastContent'] = 'live'
    engine, _ = collector(state, rows)
    dataset = engine.collect(CollectionRequest(videos=[row['id'] for row in rows], enrich_channels=False))
    report = opportunity_indicators(dataset, MetricsPermission(approved=True, approval_reference='mock'), clock=state.clock)
    assert report['metrics'] == []


def test_cached_source_does_not_renew_dataset_retention(state):
    engine, _ = collector(state, [video()])
    request = CollectionRequest(videos=[VIDEO], enrich_channels=False)
    original = engine.collect(request)
    state.advance(hours=1)
    cached = engine.collect(request)
    assert cached.collected_at > original.collected_at
    assert cached.expires_at == original.expires_at


def test_cli_requires_opt_in_before_creating_state(tmp_path, monkeypatch):
    from horus_backend.radar_youtube.__main__ import main
    monkeypatch.delenv('YOUTUBE_API_KEY', raising=False)
    with pytest.raises(SystemExit) as caught:
        main(['--request', str(tmp_path / 'missing.json'), '--state-dir', str(tmp_path / 'state')])
    assert caught.value.code == 2 and not (tmp_path / 'state').exists()


@pytest.mark.parametrize(('payload', 'code'), [(b'not-json', 'invalid_response'),
    (b'[]', 'invalid_response'), (b'x' * 2_000_001, 'response_too_large')])
def test_transport_invalid_or_oversized_response(monkeypatch, payload, code):
    from horus_backend.radar_youtube import transport
    class Opener:
        def open(self, *args, **kwargs):
            return BytesIO(payload)
    monkeypatch.setattr(transport, 'build_opener', lambda *_: Opener())
    with pytest.raises(CollectionError) as caught:
        GoogleTransport('mock', allow_network=True).get('videos', {})
    assert caught.value.code == code


@pytest.mark.parametrize('resource', ['https://evil.test/', 'captions', '../videos'])
def test_transport_restricts_resources(resource):
    with pytest.raises(ValueError):
        GoogleTransport('mock', allow_network=True).get(resource, {})


def test_transport_never_accepts_key_in_persisted_parameters():
    with pytest.raises(ValueError):
        GoogleTransport('mock', allow_network=True).get('videos', {'key': 'not-allowed'})


def test_explicit_handle_lookup_without_search(state):
    fake = Fake(lambda *_: {'items': [channel()]})
    result = YouTubeCollector(fake, state).collect(CollectionRequest(channels=['@example']))
    assert result.records[0].youtube_id == CHANNEL
    assert fake.calls[0][1]['forHandle'] == '@example' and len(fake.calls) == 1
