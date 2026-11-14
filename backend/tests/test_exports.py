import hashlib
from io import BytesIO
import json
from pathlib import PurePosixPath
from zipfile import ZipFile

import pytest

from test_workflows import settings, client_for
from test_production import script_for, start, finished
from test_license_reviews import body as license_body
from horus_backend.production import inspect_artifact


@pytest.fixture
def production(settings):
    with client_for(settings) as client:
        script = script_for(client)
        record = finished(client, start(client, script).json())
        root = settings.data_dir / 'productions' / record['id']
        (root / 'video.mp4').write_bytes(b'\x00\x00\x00\x18ftyp' + b'fixture-video')
        artifacts = record['artifacts'] + [inspect_artifact(root, 'video.mp4', 'video')]
        scene = next(a for a in artifacts if a['kind'] == 'scene')
        provenance = {'schema_version': 1, 'assets': [{
            'asset_id': ('scene-' if a['kind'] == 'scene' else 'audio-') + str(index),
            'relative_path': a['relative_path'], 'sha256': a['sha256'],
            'kind': 'image' if a['kind'] == 'scene' else 'audio', 'origin': 'original_local', 'source_url': None, 'author': None,
            'license': {'id': None, 'name': None, 'url': None, 'commercial_use': 'unknown',
                        'attribution_required': None, 'verified_by': None, 'verified_at': None},
            'status': 'unverified', 'notes': ''} for index, a in enumerate(
                [a for a in artifacts if a['kind'] in {'scene', 'audio'}], start=1)]}
        (root / 'asset-provenance.json').write_text(json.dumps(provenance), encoding='utf-8')
        artifacts.append(inspect_artifact(root, 'asset-provenance.json', 'manifest'))
        with client.app.state.store.connect() as db:
            db.execute("UPDATE productions SET mode='local_pilot', artifacts=? WHERE id=?",
                       (json.dumps(artifacts), record['id']))
        asset = next(a for a in provenance['assets'] if a['sha256'] == scene['sha256'])
        payload = license_body(asset_id=asset['asset_id'], asset_sha256=scene['sha256'])
        response = client.post(f"/v1/productions/{record['id']}/license-reviews",
                               headers={'Idempotency-Key': 'license'}, json=payload)
        assert response.status_code == 201, response.text
        # Segredo não registrado nunca entra no pacote.
        (root / 'private.env').write_text('TOKEN=' + settings.token, encoding='utf-8')
        yield client, record, root, settings


def approve(client, record):
    response = client.post(f"/v1/productions/{record['id']}/review", headers={'Idempotency-Key': 'approval'},
        json={'decision': 'approve', 'artifact_sha256': hashlib.sha256(b'\x00\x00\x00\x18ftypfixture-video').hexdigest(),
              'acknowledge_quality_errors': True})
    assert response.status_code == 200, response.text


def export(client, pid, key='export'):
    return client.post(f'/v1/productions/{pid}/export', headers={'Idempotency-Key': key})


def test_export_approved_package_hashes_and_effective_licenses(production):
    client, record, root, settings = production
    approve(client, record)
    response = export(client, record['id'])
    assert response.status_code == 201, response.text
    package = response.json()
    raw = (settings.data_dir / package['relative_path']).read_bytes()
    assert package['sha256'] == hashlib.sha256(raw).hexdigest()
    with ZipFile(BytesIO(raw)) as zipped:
        assert set(zipped.namelist()) == {'video.mp4', 'subtitles.srt', 'script.json', 'script.txt',
            'quality-report.json', 'licenses.json', 'review.json', 'manifest.json'}
        for name in zipped.namelist():
            assert not PurePosixPath(name).is_absolute() and '..' not in name and '\\' not in name
            assert settings.token.encode() not in zipped.read(name)
            assert str(settings.data_dir).encode() not in zipped.read(name)
        manifest = json.loads(zipped.read('manifest.json'))
        assert manifest['horus_version'] == '0.1.0'
        from horus_backend.migrations import SCHEMA_VERSION
        assert manifest['database_schema_version'] == SCHEMA_VERSION
        assert len(manifest['files']) == 7
        for item in manifest['files']:
            data = zipped.read(item['name'])
            assert hashlib.sha256(data).hexdigest() == item['sha256']
            assert len(data) == item['size_bytes']
        licenses = json.loads(zipped.read('licenses.json'))
        assert any(a['status'] == 'verified' for a in licenses['effective_provenance']['assets'])
        assert len(licenses['history']) == 1
        assert licenses['original_provenance']['assets'][0]['status'] == 'unverified'
        assert json.loads(zipped.read('quality-report.json'))['status'] == 'not_run'
        assert json.loads(zipped.read('review.json'))['production_review']['decision'] == 'approve'
    assert export(client, record['id']).status_code == 200
    assert export(client, record['id']).json() == package
    assert client.get(f"/v1/productions/{record['id']}/exports").json() == {'items': [package]}
    download = client.get(f"/v1/productions/{record['id']}/exports/{package['id']}/file")
    assert download.status_code == 200 and download.content == raw


def test_export_auth_and_approval_required(production):
    client, record, root, settings = production
    pid = record['id']
    assert client.post(f'/v1/productions/{pid}/export', headers={'Authorization': 'Bearer wrong', 'Idempotency-Key': 'x'}).status_code == 401
    assert client.get(f'/v1/productions/{pid}/exports', headers={'Authorization': 'Bearer wrong'}).status_code == 401
    assert client.post(f'/v1/productions/{pid}/export').status_code == 422
    assert export(client, pid).status_code == 409
    assert not (settings.data_dir / 'exports').exists()
    assert client.get(f'/v1/productions/{pid}/exports').json() == {'items': []}


@pytest.mark.parametrize('change', ['hash', 'missing', 'traversal', 'absolute', 'symlink', 'export_symlink'])
def test_export_refuses_tampering_and_unsafe_paths(production, change, monkeypatch, tmp_path):
    client, record, root, settings = production
    approve(client, record)
    video = root / 'video.mp4'
    if change == 'hash':
        video.write_bytes(b'\x00\x00\x00\x18ftypTAMPERED')
    elif change == 'missing':
        video.unlink()
    elif change in {'traversal', 'absolute'}:
        with client.app.state.store.connect() as db:
            artifacts = json.loads(db.execute('SELECT artifacts FROM productions WHERE id=?', (record['id'],)).fetchone()[0])
            next(a for a in artifacts if a['kind'] == 'video')['relative_path'] = '../video.mp4' if change == 'traversal' else str(tmp_path / 'video.mp4')
            db.execute('UPDATE productions SET artifacts=? WHERE id=?', (json.dumps(artifacts), record['id']))
    else:
        # Simula também em Windows sem privilégio de criar links.
        from pathlib import Path
        original = Path.is_symlink
        target = video if change == 'symlink' else settings.data_dir / 'exports'
        monkeypatch.setattr(Path, 'is_symlink', lambda p: p == target or original(p))
    assert export(client, record['id']).status_code == 409
    assert not list(settings.data_dir.glob('exports/**/*.zip'))


def test_export_refuses_production_without_registered_video(production):
    client, record, root, settings = production
    approve(client, record)
    with client.app.state.store.connect() as db:
        artifacts = json.loads(db.execute('SELECT artifacts FROM productions WHERE id=?', (record['id'],)).fetchone()[0])
        db.execute('UPDATE productions SET artifacts=? WHERE id=?',
            (json.dumps([a for a in artifacts if a['kind'] != 'video']), record['id']))
    assert export(client, record['id']).status_code == 409


def test_export_survives_restart_and_key_scopes(production):
    client, record, root, settings = production
    approve(client, record)
    first = export(client, record['id']).json()
    second = export(client, record['id'], 'another').json()
    assert first['id'] != second['id']
    # Nova instância do serviço consulta os recibos no próprio ZIP.
    from horus_backend.exports import ExportService
    service = ExportService(client.app.state.manager.productions)
    assert service.create(record['id'], 'export') == (first, False)
    assert len(service.list(record['id'])['items']) == 2


def test_export_includes_registered_quality_report(production):
    client, record, root, settings = production
    from horus_backend.av_quality import provenance_check
    provenance = json.loads((root / 'asset-provenance.json').read_text())
    inputs = {a['relative_path']: a['sha256'] for a in provenance['assets']}
    report = {'schema_version': 1, 'production_id': record['id'],
        'video_sha256': hashlib.sha256((root / 'video.mp4').read_bytes()).hexdigest(),
        'generated_at': '2026-11-14T00:00:00+00:00', 'tool': {'name': 'fixture', 'version': '1'},
        'status': 'warn', 'checks': [provenance_check(provenance, inputs)],
        'blocking_errors': [], 'warnings': ['asset_provenance']}
    (root / 'quality-report.json').write_text(json.dumps(report), encoding='utf-8')
    with client.app.state.store.connect() as db:
        artifacts = json.loads(db.execute('SELECT artifacts FROM productions WHERE id=?', (record['id'],)).fetchone()[0])
        artifacts.append(inspect_artifact(root, 'quality-report.json', 'manifest'))
        db.execute('UPDATE productions SET artifacts=? WHERE id=?', (json.dumps(artifacts), record['id']))
    approve(client, record)
    response = export(client, record['id'])
    assert response.status_code == 201, response.text
    with ZipFile(settings.data_dir / response.json()['relative_path']) as zipped:
        exported = json.loads(zipped.read('quality-report.json'))
    assert exported['tool']['name'] == 'fixture'
    assert exported['video_sha256'] == report['video_sha256']
    assert exported['status'] == 'warn'


def test_concurrent_idempotent_exports_create_only_one_package(production):
    from concurrent.futures import ThreadPoolExecutor
    client, record, root, settings = production
    approve(client, record)
    with ThreadPoolExecutor(max_workers=3) as pool:
        responses = list(pool.map(lambda _: export(client, record['id']), range(3)))
    assert sorted(r.status_code for r in responses) == [200, 200, 201]
    assert len({r.json()['id'] for r in responses}) == 1
    assert len(list(settings.data_dir.glob('exports/**/*.zip'))) == 1


def test_corrupt_package_is_not_replayed_or_downloaded(production):
    client, record, root, settings = production
    approve(client, record)
    package = export(client, record['id']).json()
    path = settings.data_dir / package['relative_path']
    path.write_bytes(b'corrupt zip')
    assert export(client, record['id']).status_code == 409
    assert client.get(f"/v1/productions/{record['id']}/exports/{package['id']}/file").status_code == 409
    assert path.read_bytes() == b'corrupt zip'


def test_interrupted_export_does_not_overwrite_or_block_listing(production):
    client, record, root, settings = production
    approve(client, record)
    export_id = hashlib.sha256(f"{record['id']}:export".encode()).hexdigest()
    partial = settings.data_dir / 'exports' / record['id'] / export_id
    partial.mkdir(parents=True)
    (partial / 'partial-fixture').write_bytes(b'incomplete')
    assert export(client, record['id']).status_code == 409
    assert client.get(f"/v1/productions/{record['id']}/exports").json() == {'items': []}
    assert export(client, record['id'], 'new-key').status_code == 201
    assert (partial / 'partial-fixture').read_bytes() == b'incomplete'


@pytest.mark.parametrize('sensitive', ['Bearer FAKE_SECRET', '/home/operator/private.txt', 'C:\\Users\\operator\\private.txt'])
def test_sensitive_audit_notes_are_redacted_and_disclosed(production, sensitive):
    client, record, root, settings = production
    approve(client, record)
    with client.app.state.store.connect() as db:
        review = json.loads(db.execute('SELECT review FROM productions WHERE id=?', (record['id'],)).fetchone()[0])
        review['notes'] = [{'at_seconds': 1.0, 'text': sensitive}]
        db.execute('UPDATE productions SET review=? WHERE id=?', (json.dumps(review), record['id']))
    response = export(client, record['id'])
    assert response.status_code == 201, response.text
    with ZipFile(settings.data_dir / response.json()['relative_path']) as zipped:
        assert json.loads(zipped.read('manifest.json'))['metadata_redacted'] is True
        notes = json.loads(zipped.read('review.json'))['production_review']['notes']
        assert sensitive not in notes[0]['text']


def test_font_source_path_in_provenance_does_not_block_export(production):
    client, record, root, settings = production
    provenance = json.loads((root / 'asset-provenance.json').read_text())
    provenance['assets'][0]['notes'] = 'Arquivo local: C:/Users/operator/font.ttf; sem licença presumida.'
    provenance['assets'][1]['notes'] = json.dumps({'voice_id': r'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech\Tokens\Maria'})
    (root / 'asset-provenance.json').write_text(json.dumps(provenance), encoding='utf-8')
    with client.app.state.store.connect() as db:
        artifacts = json.loads(db.execute('SELECT artifacts FROM productions WHERE id=?', (record['id'],)).fetchone()[0])
        artifacts = [inspect_artifact(root, a['relative_path'], a['kind']) for a in artifacts]
        db.execute('UPDATE productions SET artifacts=? WHERE id=?', (json.dumps(artifacts), record['id']))
    approve(client, record)
    response = export(client, record['id'])
    assert response.status_code == 201, response.text
    with ZipFile(settings.data_dir / response.json()['relative_path']) as zipped:
        value = json.loads(zipped.read('licenses.json'))
        assert value['original_provenance']['assets'][0]['notes'] == 'Arquivo local: [caminho omitido]; sem licença presumida.'
        assert json.loads(zipped.read('manifest.json'))['metadata_redacted'] is True


@pytest.mark.parametrize('sensitive', ['Bearer FAKE_SECRET', '/home/operator/private.txt', 'C:\\Users\\operator\\private.txt'])
def test_sensitive_subtitles_are_refused_without_silent_change(production, sensitive):
    client, record, root, settings = production
    approve(client, record)
    with client.app.state.store.connect() as db:
        artifacts = json.loads(db.execute('SELECT artifacts FROM productions WHERE id=?', (record['id'],)).fetchone()[0])
        subtitles = next(a for a in artifacts if a['kind'] == 'subtitles')
        path = root / subtitles['relative_path']
        path.write_text('1\n00:00:00,000 --> 00:00:01,000\n' + sensitive, encoding='utf-8')
        artifacts = [inspect_artifact(root, a['relative_path'], a['kind']) for a in artifacts]
        db.execute('UPDATE productions SET artifacts=? WHERE id=?', (json.dumps(artifacts), record['id']))
    assert export(client, record['id']).status_code == 409
