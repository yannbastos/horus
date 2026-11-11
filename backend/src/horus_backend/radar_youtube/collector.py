from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
import json
import re
import time
import uuid

from .models import CollectionIssue, CollectionRequest, Dataset, PublicRecord
from .references import CHANNEL, VIDEO, channel_reference, video_id
from .state import BudgetExceeded, RadarState
from .transport import CollectionError

PARTS = {'videos': 'snippet,statistics,contentDetails', 'channels': 'snippet,statistics,contentDetails',
         'search': 'snippet', 'playlistItems': 'contentDetails'}
FIELDS = {
    'videos': 'items(id,snippet(title,channelId,channelTitle,publishedAt,defaultAudioLanguage,defaultLanguage,liveBroadcastContent),statistics(viewCount,likeCount,commentCount),contentDetails(duration))',
    'channels': 'items(id,snippet(title,publishedAt,defaultLanguage,country),statistics(viewCount,subscriberCount,hiddenSubscriberCount,videoCount),contentDetails/relatedPlaylists/uploads)',
    'search': 'nextPageToken,items/id', 'playlistItems': 'nextPageToken,items/contentDetails/videoId',
}
ALLOWED = {
    'snippet': {'title', 'channelId', 'channelTitle', 'publishedAt', 'defaultAudioLanguage', 'defaultLanguage', 'liveBroadcastContent', 'country'},
    'statistics': {'viewCount', 'likeCount', 'commentCount', 'subscriberCount', 'hiddenSubscriberCount', 'videoCount'},
}

def project(resource, value):
    if not isinstance(value, dict) or not isinstance(value.get('items'), list):
        raise CollectionError('invalid_response', 'Resposta não contém uma lista de recursos.')
    items = []
    for row in value['items']:
        if not isinstance(row, dict):
            raise CollectionError('invalid_response', 'Recurso inválido na resposta.')
        if resource == 'search':
            item = {'id': {k: v for k, v in row['id'].items() if k in {'videoId', 'channelId'}}} if isinstance(row.get('id'), dict) else {'id': {}}
        elif resource == 'playlistItems':
            details = row.get('contentDetails', {})
            item = {'contentDetails': {'videoId': details.get('videoId')}} if isinstance(details, dict) else {'contentDetails': {}}
        else:
            item = {'id': row.get('id')}
            for name, fields in ALLOWED.items():
                if isinstance(row.get(name), dict):
                    item[name] = {key: val for key, val in row[name].items() if key in fields}
            content = row.get('contentDetails', {})
            if isinstance(content, dict):
                if resource == 'videos':
                    item['contentDetails'] = {'duration': content.get('duration')}
                elif isinstance(content.get('relatedPlaylists'), dict):
                    item['contentDetails'] = {'relatedPlaylists': {'uploads': content['relatedPlaylists'].get('uploads')}}
        items.append(item)
    result = {'items': items}
    token = value.get('nextPageToken')
    if token is not None:
        if not isinstance(token, str) or len(token) > 2048:
            raise CollectionError('invalid_response', 'Token de paginação inválido.')
        result['nextPageToken'] = token
    return result

def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result if result.tzinfo else None
    except ValueError:
        return None

def number(value):
    if isinstance(value, bool) or not re.fullmatch(r'\d{1,20}', str(value)):
        return None
    result = int(value)
    return result if result <= 2**64 - 1 else None

def duration(value):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r'P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?', value)
    if not match or not any(item is not None for item in match.groups()):
        return None
    days, hours, minutes, seconds = (int(item or 0) for item in match.groups())
    return days * 86400 + hours * 3600 + minutes * 60 + seconds

def record(resource, row, fetched):
    kind = 'youtube_video' if resource == 'videos' else 'youtube_channel'
    identifier = row['id']
    snippet, stats, content = row.get('snippet', {}), row.get('statistics', {}), row.get('contentDetails', {})
    values = {'title': snippet.get('title'), 'published_at': timestamp(snippet.get('publishedAt')),
              'language': snippet.get('defaultAudioLanguage') or snippet.get('defaultLanguage'), 'views': number(stats.get('viewCount'))}
    unavailable = {}
    if resource == 'videos':
        values.update(channel_id=snippet.get('channelId'), channel_title=snippet.get('channelTitle'),
                      duration_iso8601=content.get('duration'), duration_seconds=duration(content.get('duration')),
                      likes=number(stats.get('likeCount')), comments=number(stats.get('commentCount')),
                      live_status=snippet.get('liveBroadcastContent'))
        unavailable.update({'retention': 'not_public', 'ctr': 'not_public', 'revenue': 'not_public', 'dislikes': 'not_public'})
    else:
        hidden = stats.get('hiddenSubscriberCount') is True
        subscribers = None if hidden else number(stats.get('subscriberCount'))
        values.update(subscribers=subscribers, subscribers_rounded=True if subscribers is not None else None,
                      video_count=number(stats.get('videoCount')), country=snippet.get('country'),
                      uploads_playlist=content.get('relatedPlaylists', {}).get('uploads'))
        if hidden:
            unavailable['subscribers'] = 'not_public'
    for key, value in list(values.items()):
        if key not in {'published_at', 'views', 'duration_seconds', 'likes', 'comments', 'subscribers', 'video_count', 'subscribers_rounded'}:
            if not isinstance(value, str) or not value:
                values[key] = None
        if values[key] is None and key not in unavailable:
            unavailable[key] = 'not_returned_or_invalid'
    return PublicRecord(source_id=('video_' if resource == 'videos' else 'channel_') + identifier,
                        kind=kind, youtube_id=identifier, url='https://www.youtube.com/' + ('watch?v=' if resource == 'videos' else 'channel/') + identifier,
                        endpoint='videos.list' if resource == 'videos' else 'channels.list', retrieved_at=fetched,
                        expires_at=fetched + timedelta(days=28), unavailable=unavailable, **values)

class YouTubeCollector:
    def __init__(self, transport, state: RadarState, *, search_limit=10, details_limit=200, max_calls=20,
                 cache_hours=6, sleep=time.sleep):
        if not 1 <= search_limit <= 100 or not 1 <= details_limit <= 10000 or not 1 <= max_calls <= 100 or not 0 < cache_hours <= 24:
            raise ValueError('Limites locais inválidos.')
        self.transport, self.state, self.sleep = transport, state, sleep
        self.limits = {'search': search_limit, 'details': details_limit}
        self.max_calls, self.cache_hours = max_calls, cache_hours

    def _get(self, resource, params):
        params = {**params, 'part': PARTS[resource], 'fields': FIELDS[resource]}
        key = hashlib.sha256(json.dumps([resource, params], sort_keys=True).encode()).hexdigest()
        cached = None if self.force_refresh else self.state.cached(key)
        if cached:
            return cached
        bucket = 'search' if resource == 'search' else 'details'
        for attempt in range(2):
            if self.calls >= self.max_calls:
                raise BudgetExceeded('Limite de chamadas desta coleta atingido.')
            self.state.reserve(bucket, self.limits[bucket])
            self.calls += 1
            self.spent[bucket] += 1
            try:
                value = project(resource, self.transport.get(resource, params))
                fetched = self.state.clock()
                self.state.cache(key, value, fetched, self.cache_hours)
                return value, fetched
            except CollectionError as error:
                if error.quota:
                    self.state.block(bucket)
                if not error.retryable or attempt == 1 or error.quota:
                    raise
                self.sleep(1)
        raise AssertionError('unreachable')

    def _query(self, resource, params, references=()):
        if self.stopped:
            return None
        try:
            return self._get(resource, params)
        except (CollectionError, BudgetExceeded) as error:
            code = error.code if isinstance(error, CollectionError) else 'local_quota'
            self.issues.append(CollectionIssue(code=code, resource=resource, references=list(references),
                retryable=getattr(error, 'retryable', False), message=str(error)))
            if isinstance(error, BudgetExceeded) or getattr(error, 'quota', False) or code in {'http_400', 'http_401', 'http_403', 'network_disabled'}:
                self.stopped = True
            return None

    def _resources(self, resource, ids, records):
        pattern = VIDEO if resource == 'videos' else CHANNEL
        ids = list(dict.fromkeys(ids))
        for start in range(0, len(ids), 50):
            batch = ids[start:start + 50]
            response = self._query(resource, {'id': ','.join(sorted(batch))}, batch)
            if not response:
                continue
            payload, fetched = response
            returned = set()
            for row in payload['items']:
                identifier = row.get('id')
                if not isinstance(identifier, str) or not pattern.fullmatch(identifier) or identifier not in batch:
                    self.issues.append(CollectionIssue(code='unexpected_resource', resource=resource, message='Recurso retornado não corresponde ao pedido.'))
                    continue
                item = record(resource, row, fetched)
                records[item.source_id] = item
                returned.add(identifier)
            missing = set(batch) - returned
            if missing:
                self.state.invalidate('youtube_video' if resource == 'videos' else 'youtube_channel', missing)
                self.issues.append(CollectionIssue(code='not_returned', resource=resource, references=sorted(missing),
                    message='Recurso não retornado: pode estar removido, privado ou indisponível; causa não comprovada.'))

    def _pages(self, resource, params, pages):
        seen = set()
        for index in range(pages):
            response = self._query(resource, params)
            if not response:
                return
            payload, _ = response
            yield payload['items']
            token = payload.get('nextPageToken')
            if not token:
                return
            if token in seen:
                self.issues.append(CollectionIssue(code='pagination_loop', resource=resource, message='Token repetido; paginação interrompida.'))
                return
            seen.add(token)
            params = {**params, 'pageToken': token}
            if index == pages - 1:
                self.issues.append(CollectionIssue(code='pagination_limited', resource=resource, message='Há mais páginas; limite local respeitado.'))

    def collect(self, request: CollectionRequest, *, force_refresh=False, previous: Dataset | None = None):
        # Validar todas as referências antes de consumir cota ou abrir transporte.
        video_ids = [video_id(value) for value in request.videos]
        channel_refs = [channel_reference(value) for value in request.channels]
        if previous and previous.request != request:
            raise ValueError('Nova revisão exige o mesmo pedido; use outro snapshot para entradas diferentes.')
        self.calls, self.spent, self.issues, self.stopped = 0, {'search': 0, 'details': 0}, [], False
        self.force_refresh = force_refresh
        self.state.purge()
        channel_ids = [value for key, value in channel_refs if key == 'id']
        records = {}
        if request.search:
            search = request.search
            params = {'q': search.query, 'type': search.kind, 'order': search.order, 'maxResults': str(search.page_size)}
            for key, value in [('relevanceLanguage', search.language), ('regionCode', search.region),
                               ('publishedAfter', search.published_after), ('publishedBefore', search.published_before), ('videoDuration', search.duration)]:
                if value is not None:
                    params[key] = value.isoformat() if isinstance(value, datetime) else value
            for page in self._pages('search', params, search.pages):
                for row in page:
                    field, pattern, target = ('videoId', VIDEO, video_ids) if search.kind == 'video' else ('channelId', CHANNEL, channel_ids)
                    identifier = row['id'].get(field)
                    if isinstance(identifier, str) and pattern.fullmatch(identifier):
                        target.append(identifier)
        for key, value in dict.fromkeys(channel_refs):
            if key == 'id':
                continue
            response = self._query('channels', {key: value}, [value])
            if response:
                payload, fetched = response
                if not payload['items']:
                    self.issues.append(CollectionIssue(code='not_returned', resource='channels', references=[value], message='Handle/usuário não retornado.'))
                for row in payload['items']:
                    if isinstance(row.get('id'), str) and CHANNEL.fullmatch(row['id']):
                        item = record('channels', row, fetched)
                        records[item.source_id] = item
        self._resources('videos', video_ids, records)
        if request.enrich_channels:
            channel_ids.extend(item.channel_id for item in records.values() if item.channel_id and CHANNEL.fullmatch(item.channel_id))
        self._resources('channels', channel_ids, records)
        if request.upload_pages:
            extra_ids = []
            for item in list(records.values()):
                if item.kind == 'youtube_channel' and item.uploads_playlist:
                    for page in self._pages('playlistItems', {'playlistId': item.uploads_playlist, 'maxResults': '50'}, request.upload_pages):
                        extra_ids.extend(row['contentDetails']['videoId'] for row in page
                                         if isinstance(row['contentDetails'].get('videoId'), str) and VIDEO.fullmatch(row['contentDetails']['videoId']))
            known = {item.youtube_id for item in records.values() if item.kind == 'youtube_video'}
            self._resources('videos', [value for value in extra_ids if value not in known], records)
        collected = self.state.clock()
        dataset = Dataset(snapshot_id=previous.snapshot_id if previous else 'rad_' + uuid.uuid4().hex[:24],
                          revision=previous.revision + 1 if previous else 1, collected_at=collected,
                          expires_at=min([collected + timedelta(days=28), *[item.expires_at for item in records.values()]]),
                          request=request, status='partial' if self.issues and records else 'failed' if self.issues else 'complete',
                          records=list(records.values()), issues=self.issues, quota_spent=self.spent)
        self.state.save(dataset)
        return dataset

    def refresh(self, snapshot_id, revision):
        previous = self.state.load(snapshot_id, revision)
        return self.collect(previous.request, force_refresh=True, previous=previous)
