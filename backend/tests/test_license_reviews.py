import copy
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from test_workflows import settings, client_for
from test_production import script_for, start, finished
from horus_backend.media_contracts import apply_license_reviews, commercial_use_permitted, validate_asset_provenance, ProvenanceAsset
from horus_backend.migrations import migrate, MIGRATIONS

PREFIX = 'canais/demo/videos/fixture/'
LOCAL, STOCK = 'a' * 64, 'b' * 64


def provenance():
    unverified = {'id': None, 'name': None, 'url': None, 'commercial_use': 'unknown', 'attribution_required': None,
                  'verified_by': None, 'verified_at': None}
    return {'schema_version': 1, 'assets': [
        {'asset_id': 'scene-1', 'relative_path': PREFIX + 'scene-1.png', 'sha256': LOCAL, 'kind': 'image',
         'origin': 'original_local', 'source_url': None, 'author': None, 'license': dict(unverified),
         'status': 'unverified', 'notes': ''},
        {'asset_id': 'stock-1', 'relative_path': PREFIX + 'scene-2.png', 'sha256': STOCK, 'kind': 'image',
         'origin': 'stock_pexels', 'source_url': 'https://www.pexels.com/photo/1/', 'author': 'Autor',
         'license': {**unverified, 'id': 'pexels', 'name': 'Pexels', 'url': 'https://www.pexels.com/license/'},
         'status': 'unverified', 'notes': ''}]}


def body(**over):
    value = {'asset_id': 'scene-1', 'asset_sha256': LOCAL, 'decision': 'verified',
             'license': {'id': 'own', 'name': 'Obra própria', 'url': 'https://example.org/termos',
                         'commercial_use': 'allowed', 'attribution_required': False},
             'evidence': 'Termos conferidos pelo operador.', 'reviewed_by': 'human'}
    return value | over


@pytest.fixture
def production(settings):
    with client_for(settings) as client:
        record = finished(client, start(client, script_for(client)).json())
        root = settings.data_dir / 'productions' / record['id']
        root.mkdir(parents=True, exist_ok=True)
        text = json.dumps(provenance())
        (root / 'asset-provenance.json').write_text(text, encoding='utf-8')
        artifacts = [{'kind': 'manifest', 'relative_path': 'asset-provenance.json',
                      'sha256': hashlib.sha256(text.encode()).hexdigest()},
                     {'kind': 'image', 'relative_path': PREFIX + 'scene-1.png', 'sha256': LOCAL},
                     {'kind': 'image', 'relative_path': PREFIX + 'scene-2.png', 'sha256': STOCK}]
        with client.app.state.store.connect() as db:
            db.execute('UPDATE productions SET artifacts=? WHERE id=?', (json.dumps(artifacts), record['id']))
        yield client, record['id'], root


def post(client, pid, payload, key='k1'):
    return client.post(f'/v1/productions/{pid}/license-reviews', headers={'Idempotency-Key': key}, json=payload)


# --- função pura ---------------------------------------------------------------------------------------

def review(**over):
    return {'asset_id': 'scene-1', 'asset_sha256': LOCAL, 'decision': 'verified', 'reviewed_at': '2026-11-13T10:00:00+00:00',
            'license': body()['license']} | over


def test_apply_is_pure_and_applies_human_decision():
    original = provenance()
    snapshot = copy.deepcopy(original)
    effective = apply_license_reviews(original, [review()])
    assert original == snapshot
    asset = effective['assets'][0]
    assert asset['status'] == 'verified' and asset['license']['verified_by'] == 'human'
    assert asset['license']['verified_at'] == '2026-11-13T10:00:00+00:00'
    assert commercial_use_permitted(ProvenanceAsset.model_validate(asset))
    assert effective['assets'][1]['status'] == 'unverified'


def test_apply_latest_wins_rejected_clears_verification_and_hash_mismatch_ignored():
    rejected = review(decision='rejected', license={**body()['license'], 'commercial_use': 'restricted'})
    asset = apply_license_reviews(provenance(), [review(), rejected])['assets'][0]
    assert asset['status'] == 'rejected' and asset['license']['verified_by'] is None
    ignored = apply_license_reviews(provenance(), [review(asset_sha256='c' * 64)])
    assert ignored['assets'][0]['status'] == 'unverified'
    # decisão mais nova com hash divergente não anula a anterior válida
    kept = apply_license_reviews(provenance(), [review(), review(decision='rejected', asset_sha256='c' * 64)])
    assert kept['assets'][0]['status'] == 'verified'


def test_apply_rejects_invalid_provenance():
    with pytest.raises(ValueError):
        apply_license_reviews({'schema_version': 1, 'assets': 'x'}, [])


# --- API -----------------------------------------------------------------------------------------------

def test_requires_auth(production):
    client, pid, _ = production
    for call in (lambda h: client.get(f'/v1/productions/{pid}/license-reviews', headers=h),
                 lambda h: client.post(f'/v1/productions/{pid}/license-reviews', headers=h | {'Idempotency-Key': 'x'}, json=body())):
        assert call({'Authorization': 'Bearer errado'}).status_code == 401


def test_empty_listing_then_create_and_effective_view(production):
    client, pid, root = production
    empty = client.get(f'/v1/productions/{pid}/license-reviews').json()
    assert empty['current'] == [] and empty['history'] == [] and empty['publishable'] is False
    assert empty['effective_provenance']['assets'][0]['status'] == 'unverified'
    original = (root / 'asset-provenance.json').read_bytes()
    response = post(client, pid, body())
    assert response.status_code == 201, response.text
    created = response.json()
    assert created['decision'] == 'verified' and created['supersedes'] is None and created['reviewed_by'] == 'human'
    listing = client.get(f'/v1/productions/{pid}/license-reviews').json()
    assert [r['id'] for r in listing['current']] == [created['id']]
    assert listing['effective_provenance']['assets'][0]['status'] == 'verified'
    assert listing['publishable'] is False
    assert (root / 'asset-provenance.json').read_bytes() == original  # artefato registrado intocado
    assert client.get(f'/v1/productions/{pid}').json()['publishable'] is False


def test_idempotency_replay_and_conflict(production):
    client, pid, _ = production
    first = post(client, pid, body())
    again = post(client, pid, body())
    assert again.status_code == 200 and again.json()['id'] == first.json()['id']
    assert len(client.get(f'/v1/productions/{pid}/license-reviews').json()['history']) == 1
    assert post(client, pid, body(decision='rejected'), key='k1').status_code == 409
    assert client.post(f'/v1/productions/{pid}/license-reviews', json=body()).status_code == 422


def test_new_decision_supersedes_and_history_is_preserved(production):
    client, pid, _ = production
    first = post(client, pid, body()).json()
    second = post(client, pid, body(decision='rejected', evidence='Revisto: licença não cobre.'), key='k2').json()
    assert second['supersedes'] == first['id']
    listing = client.get(f'/v1/productions/{pid}/license-reviews').json()
    assert [r['id'] for r in listing['history']] == [first['id'], second['id']]
    assert [r['id'] for r in listing['current']] == [second['id']]
    assert listing['effective_provenance']['assets'][0]['status'] == 'rejected'


def test_conflicts_and_negative_cases(production):
    client, pid, _ = production
    assert post(client, pid, body(asset_id='nao-existe')).status_code == 409
    assert post(client, pid, body(asset_sha256='c' * 64)).status_code == 409
    unknown = body(); unknown['license']['commercial_use'] = 'unknown'
    assert post(client, pid, unknown).status_code == 409
    assert post(client, pid, body(decision='rejected', license=unknown['license']), key='rej').status_code == 201
    # stock exige https do host oficial
    stock = body(asset_id='stock-1', asset_sha256=STOCK)
    stock['license']['url'] = 'https://evil.example/license'
    assert post(client, pid, stock, key='s1').status_code == 409
    stock['license']['url'] = 'http://www.pexels.com/license/'
    assert post(client, pid, stock, key='s2').status_code == 409
    stock['license']['url'] = 'https://www.pexels.com/license/'
    assert post(client, pid, stock, key='s3').status_code == 201
    assert post(client, '0' * 32, body()).status_code == 404
    assert client.get(f'/v1/productions/{"0" * 32}/license-reviews').status_code == 404


@pytest.mark.parametrize('mutation', [
    lambda b: b.update(reviewed_by='system'), lambda b: b.update(decision='approved'), lambda b: b.update(evidence=''),
    lambda b: b.update(evidence='x' * 2001), lambda b: b.update(evidence='   '), lambda b: b.update(evidence='a\x00b'),
    lambda b: b.update(extra=1), lambda b: b.update(publishable=True), lambda b: b['license'].update(commercial_use='free'),
    lambda b: b['license'].update(attribution_required=None), lambda b: b['license'].update(attribution_required='no'),
    lambda b: b.update(asset_sha256='ABC'), lambda b: b.update(asset_id='../x'), lambda b: b.pop('license'),
])
def test_invalid_payloads_are_422_without_echo(production, mutation):
    client, pid, _ = production
    payload = body(evidence='segredo-evidencia')
    mutation(payload)
    response = post(client, pid, payload)
    assert response.status_code == 422 and 'segredo' not in response.text


def test_missing_or_tampered_provenance_is_conflict(production):
    client, pid, root = production
    (root / 'asset-provenance.json').write_text('{}', encoding='utf-8')  # hash registrado não confere
    assert post(client, pid, body()).status_code == 409
    listing = client.get(f'/v1/productions/{pid}/license-reviews').json()
    assert listing['effective_provenance'] is None and listing['history'] == []


def test_database_rejects_update_and_delete(production):
    client, pid, _ = production
    post(client, pid, body())
    with client.app.state.store.connect() as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE license_reviews SET decision='rejected'")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute('DELETE FROM license_reviews')


def test_approval_does_not_publish_or_change_artifacts(production):
    client, pid, _ = production
    before = client.get(f'/v1/productions/{pid}').json()['artifacts']
    post(client, pid, body())
    after = client.get(f'/v1/productions/{pid}').json()
    assert after['artifacts'] == before and after['publishable'] is False and after['demo_only'] is True


# --- migração v7 -> v8 -----------------------------------------------------------------------------------

def seed_v7(settings, monkeypatch):
    with monkeypatch.context() as old:
        old.setattr('horus_backend.migrations.SCHEMA_VERSION', 7)
        with client_for(settings) as client:
            record = finished(client, start(client, script_for(client)).json())
            with client.app.state.store.connect() as db:
                tables = {t: [tuple(r) for r in db.execute(f'SELECT * FROM {t} ORDER BY 1')]
                          for t in ('jobs', 'productions', 'production_receipts', 'scripts', 'workflows')}
                path = Path(db.execute('PRAGMA database_list').fetchone()[2])
    return path, tables, record


def test_migration_v8_preserves_data_is_idempotent_and_adds_only_table(settings, monkeypatch):
    path, tables, record = seed_v7(settings, monkeypatch)
    for _ in range(2):
        migrate(path)
        with sqlite3.connect(path) as db:
            db.execute('PRAGMA foreign_keys=ON')
            assert db.execute('PRAGMA user_version').fetchone()[0] == 9
            for name, rows in tables.items():
                # v9 acrescenta scripts.origin (HOR-133); os valores anteriores permanecem intactos.
                assert [tuple(r)[:len(rows[0])] if rows else tuple(r) for r in db.execute(f'SELECT * FROM {name} ORDER BY 1')] == rows
            assert db.execute('PRAGMA foreign_key_check').fetchall() == []
            assert db.execute('SELECT COUNT(*) FROM license_reviews').fetchone()[0] == 0
            with pytest.raises(sqlite3.IntegrityError):  # FK de produção
                db.execute("""INSERT INTO license_reviews(id,production_id,asset_id,asset_sha256,decision,license,evidence,
                    reviewed_by,reviewed_at,idempotency_key,request) VALUES('x','nope','a','b','verified','{}','e','human','t','k','r')""")
            db.rollback()
    assert len(list(path.parent.glob(path.stem + '.backup-v7-*.sqlite3'))) == 1
    with client_for(settings) as client:
        assert client.get(f'/v1/productions/{record["id"]}/license-reviews').status_code == 200


def test_migration_v8_failure_rolls_back(settings, monkeypatch):
    path, tables, _ = seed_v7(settings, monkeypatch)
    monkeypatch.setitem(MIGRATIONS, 8, (*MIGRATIONS[8], 'INSERT INTO missing_table VALUES(1)'))
    with pytest.raises(sqlite3.OperationalError):
        migrate(path)
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 7
        assert not db.execute("SELECT name FROM sqlite_master WHERE name LIKE 'license_reviews%'").fetchall()
        assert [tuple(r) for r in db.execute('SELECT * FROM productions ORDER BY 1')] == tables['productions']


def test_font_input_registered_by_libass_overlay_is_accepted(production):
    """J-13: a fonte copiada para fonts/ pela legenda libass faz parte das entradas; sem ela a proveniência some."""
    client, pid, root = production
    font = PREFIX + 'fonts/ArchivoExpanded-SemiBold.ttf'
    data = provenance()
    ofl = {'id': 'OFL-1.1', 'name': 'SIL Open Font License 1.1', 'url': 'https://openfontlicense.org/open-font-license-official-text/',
           'commercial_use': 'unknown', 'attribution_required': None, 'verified_by': None, 'verified_at': None}
    data['assets'].append({'asset_id': 'subtitle-font', 'relative_path': font, 'sha256': 'c' * 64, 'kind': 'font',
                           'origin': 'licensed_manual', 'source_url': 'https://github.com/Omnibus-Type/Archivo',
                           'author': 'Omnibus-Type', 'license': ofl, 'status': 'unverified', 'notes': ''})
    text = json.dumps(data)
    (root / 'asset-provenance.json').write_text(text, encoding='utf-8')
    with client.app.state.store.connect() as db:
        artifacts = json.loads(db.execute('SELECT artifacts FROM productions WHERE id=?', (pid,)).fetchone()['artifacts'])
        artifacts[0]['sha256'] = hashlib.sha256(text.encode()).hexdigest()
        artifacts.append({'kind': 'font', 'relative_path': font, 'sha256': 'c' * 64})
        db.execute('UPDATE productions SET artifacts=? WHERE id=?', (json.dumps(artifacts), pid))
    listing = client.get(f'/v1/productions/{pid}/license-reviews').json()
    assert listing['effective_provenance'] is not None
    assert 'subtitle-font' in [a['asset_id'] for a in listing['effective_provenance']['assets']]
    # saída derivada continua fora das entradas
    assert not _inputs().fullmatch(PREFIX + 'short-rascunho.mp4')
    assert not _inputs().fullmatch(PREFIX + 'fonts/../x.ttf')


def _inputs():
    from horus_backend.media_contracts import PILOT_INPUT_PATH
    return PILOT_INPUT_PATH
