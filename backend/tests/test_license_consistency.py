"""Consistência e segurança dos registros de licença (HOR-118 / HOR-097 / HOR-055). Sem rede."""
import copy
import sqlite3
from datetime import datetime, timezone

import pytest

from test_workflows import settings, client_for  # noqa: F401  (fixture `settings` usada por `production`)
from test_license_reviews import LOCAL, PREFIX, STOCK, body, post, production, provenance, review  # noqa: F401
from horus_backend.asset_sources import (AssetSourceError, LocalLicensedSource, PexelsSource, to_provenance_asset,
                                         with_obtained_file)
from horus_backend.media_contracts import (apply_license_reviews, commercial_use_permitted, validate_asset_provenance,
                                           ProvenanceAsset)

NOW = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
HOSTILE_URLS = [
    "file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "http://example.org/termos",
    "ftp://example.org/termos", "https://user:senha@example.org/termos", "//example.org/termos", "example.org/termos",
    "https://example.org/a b", "https://example.org/\x00", "https://", "   ", "https://example.org/\u202etxt",
]


def effective(client, pid):
    return client.get(f"/v1/productions/{pid}/license-reviews").json()


# ------------------------------------------------------------------------------ API: entradas maliciosas

@pytest.mark.parametrize("url", HOSTILE_URLS)
def test_hostile_license_urls_are_never_stored(production, url):
    client, pid, _ = production
    payload = body()
    payload["license"]["url"] = url
    response = post(client, pid, payload, key="u")
    assert response.status_code in (409, 422), response.text
    assert effective(client, pid)["history"] == []


@pytest.mark.parametrize("field,value", [
    ("id", "obra\x00propria"), ("id", "ok\u202eevil"), ("name", "linha\nnova\x1b[31m"), ("name", "x\u2028y"),
    ("name", "\x85ctrl"), ("id", "   "), ("name", ""), ("id", "i" * 101), ("name", "n" * 201), ("url", "https://e.org/" + "a" * 2000),
])
def test_hostile_license_text_fields_are_422(production, field, value):
    client, pid, _ = production
    payload = body()
    payload["license"][field] = value
    assert post(client, pid, payload, key="t").status_code == 422
    assert effective(client, pid)["history"] == []


@pytest.mark.parametrize("evidence", ["a\u202eb", "a\u2029b", "a\x9fb", "a\x1bb", "a\rb", "\x00", "e" * 2001])
def test_hostile_evidence_is_422(production, evidence):
    client, pid, _ = production
    assert post(client, pid, body(evidence=evidence), key="e").status_code == 422


@pytest.mark.parametrize("asset_id", ["../scene-1", "..\\scene-1", "scene-1/../x", "/etc/passwd", "C:\\x", "scene 1", "", "a" * 65,
                                      "scene-1\x00", "-scene", ".hidden"])
def test_path_like_asset_ids_are_rejected(production, asset_id):
    client, pid, _ = production
    assert post(client, pid, body(asset_id=asset_id), key="p").status_code in (409, 422)


def test_multiline_evidence_with_newline_is_still_accepted(production):
    client, pid, _ = production
    assert post(client, pid, body(evidence="linha um\nlinha dois"), key="n").status_code == 201


def test_non_human_or_extra_authority_fields_are_refused(production):
    client, pid, _ = production
    for extra in ({"publishable": True}, {"status": "verified"}, {"verified_by": "human"}, {"seq": 1}):
        assert post(client, pid, body() | extra, key="x").status_code == 422
    assert post(client, pid, body(reviewed_by="agent"), key="y").status_code == 422


def test_review_of_unregistered_or_changed_asset_is_conflict(production):
    client, pid, _ = production
    assert post(client, pid, body(asset_id="fantasma"), key="a").status_code == 409
    assert post(client, pid, body(asset_sha256="d" * 64), key="b").status_code == 409
    assert effective(client, pid)["history"] == []


# ------------------------------------------------------------------------------ API: append-only e consistência

def test_history_is_a_linear_append_only_chain(production):
    client, pid, _ = production
    first = post(client, pid, body(), key="1").json()
    second = post(client, pid, body(decision="rejected"), key="2").json()
    third = post(client, pid, body(), key="3").json()
    other = post(client, pid, body(asset_id="stock-1", asset_sha256=STOCK, license=body()["license"] | {"url": "https://www.pexels.com/license/"}),
                 key="4").json()
    assert (first["supersedes"], second["supersedes"], third["supersedes"], other["supersedes"]) == (None, first["id"], second["id"], None)
    listing = effective(client, pid)
    assert [r["id"] for r in listing["history"]] == [first["id"], second["id"], third["id"], other["id"]]
    assert {r["asset_id"]: r["id"] for r in listing["current"]} == {"scene-1": third["id"], "stock-1": other["id"]}
    statuses = {a["asset_id"]: a["status"] for a in listing["effective_provenance"]["assets"]}
    assert statuses == {"scene-1": "verified", "stock-1": "verified"}


def test_rejection_after_verification_leaves_no_residual_approval(production):
    client, pid, _ = production
    post(client, pid, body(), key="1")
    post(client, pid, body(decision="rejected"), key="2")
    asset = effective(client, pid)["effective_provenance"]["assets"][0]
    assert asset["status"] == "rejected" and asset["license"]["verified_by"] is None and asset["license"]["verified_at"] is None
    assert ProvenanceAsset.model_validate(asset) and commercial_use_permitted(ProvenanceAsset.model_validate(asset)) is False


def test_idempotent_replay_creates_no_second_row_and_changed_body_conflicts(production):
    client, pid, _ = production
    first = post(client, pid, body(), key="same")
    replay = post(client, pid, body(), key="same")
    assert first.status_code == 201 and replay.status_code == 200 and replay.json()["id"] == first.json()["id"]
    assert post(client, pid, body(decision="rejected"), key="same").status_code == 409
    assert len(effective(client, pid)["history"]) == 1


def test_missing_idempotency_key_is_refused(production):
    client, pid, _ = production
    assert client.post(f"/v1/productions/{pid}/license-reviews", json=body()).status_code in (400, 422)


def test_database_triggers_block_tampering_with_any_column(production):
    client, pid, _ = production
    post(client, pid, body(), key="1")
    with client.app.state.store.connect() as db:
        for statement in ("UPDATE license_reviews SET evidence='x'", "UPDATE license_reviews SET reviewed_by='machine'",
                          "UPDATE license_reviews SET supersedes=NULL", "DELETE FROM license_reviews WHERE 1=1"):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(statement)
    assert len(effective(client, pid)["history"]) == 1


def test_review_never_alters_registered_provenance_or_publishability(production):
    client, pid, root = production
    before = (root / "asset-provenance.json").read_bytes()
    post(client, pid, body(), key="1")
    assert (root / "asset-provenance.json").read_bytes() == before
    assert effective(client, pid)["publishable"] is False


# ------------------------------------------------------------------------------ função pura: estados impossíveis

def test_apply_refuses_a_review_that_would_make_the_effective_document_invalid():
    bad_name = review(license={**body()["license"], "name": "x\x00y"})
    with pytest.raises(ValueError):
        apply_license_reviews(provenance(), [bad_name])
    bad_url = review(license={**body()["license"], "url": "javascript:alert(1)"})
    with pytest.raises(ValueError):
        apply_license_reviews(provenance(), [bad_url])


def test_apply_is_pure_and_uses_only_the_latest_review_with_matching_hash():
    doc = provenance()
    snapshot = copy.deepcopy(doc)
    stale = review(asset_sha256="e" * 64, decision="rejected")                  # hash antigo: ignorado
    result = apply_license_reviews(doc, [review(), stale])
    assert doc == snapshot and result["assets"][0]["status"] == "verified"
    assert apply_license_reviews(doc, [review(), review(decision="rejected")])["assets"][0]["status"] == "rejected"


def test_apply_never_marks_an_asset_not_reviewed():
    result = apply_license_reviews(provenance(), [review()])
    assert result["assets"][1]["status"] == "unverified" and result["assets"][1]["license"]["verified_by"] is None


# ------------------------------------------------------------------------------ contrato de proveniência

def asset(**over):
    base = copy.deepcopy(provenance()["assets"][0])
    base.update(over)
    return base


def verdict(*assets, artifacts=None):
    return validate_asset_provenance({"schema_version": 1, "assets": list(assets)}, artifacts=artifacts)


def codes(result):
    return {e["code"] for e in result["errors"]}


@pytest.mark.parametrize("change,code", [
    ({"status": "verified"}, "verified_without_human"),
    ({"status": "verified", "license": {**provenance()["assets"][0]["license"], "verified_by": "human",
                                          "verified_at": "2026-11-13T10:00:00Z"}}, "verified_unknown_commercial"),
    ({"license": {**provenance()["assets"][0]["license"], "verified_by": "human"}}, "verification_incomplete"),
    ({"relative_path": "../fora.png"}, "unsafe_path"), ({"relative_path": "/abs/x.png"}, "unsafe_path"),
    ({"relative_path": "a\\b.png"}, "unsafe_path"), ({"relative_path": "C:/x.png"}, "unsafe_path"),
    ({"relative_path": "a/./b.png"}, "unsafe_path"), ({"relative_path": "a/b.png."}, "unsafe_path"),
    ({"relative_path": "a\x00b.png"}, "unsafe_path"), ({"relative_path": "~/x.png"}, "unsafe_path"),
    ({"source_url": "file:///etc/passwd"}, "invalid_url"), ({"source_url": "javascript:alert(1)"}, "invalid_url"),
    ({"author": "x\x00y"}, "unsafe_text"), ({"author": "x\u202ey"}, "unsafe_text"), ({"notes": "x\x1b[2J"}, "unsafe_text"),
    ({"notes": "n" * 2001}, "schema_string_too_long"), ({"sha256": "G" * 64}, "schema_string_pattern_mismatch"),
    ({"asset_id": "../x"}, "schema_string_pattern_mismatch"), ({"publishable": True}, "schema_extra_forbidden"),
])
def test_contract_rejects_impossible_or_hostile_asset(change, code):
    result = verdict(asset(**change))
    assert not result["ok"] and code in codes(result), result["errors"]


def test_contract_license_text_hostile_values_are_rejected():
    for field, value in (("name", "x\x00"), ("id", "x\u202e")):
        doc = asset()
        doc["license"][field] = value
        assert "unsafe_text" in codes(verdict(doc))


def test_contract_external_asset_requires_source_author_and_license_unless_rejected():
    external = asset(origin="stock_pexels", source_url=None, author=None)
    assert {"missing_source_url", "missing_author", "missing_license"} <= codes(verdict(external))
    assert verdict(asset(origin="stock_pexels", source_url=None, author=None, status="rejected"))["ok"]
    wrong_host = asset(origin="stock_pexels", source_url="https://evil.example/photo/1", author="A",
                       license={**asset()["license"], "id": "p", "name": "P", "url": "https://www.pexels.com/license/"})
    assert "invalid_url" in codes(verdict(wrong_host))


def test_contract_duplicates_are_case_insensitive():
    twin = asset(asset_id="scene-2", relative_path=PREFIX.upper() + "SCENE-1.PNG")
    result = verdict(asset(relative_path=PREFIX + "scene-1.png"), twin)
    assert "duplicate_relative_path" in codes(result)
    assert "duplicate_asset_id" in codes(verdict(asset(), asset(relative_path=PREFIX + "outro.png")))


def test_provenance_must_reference_existing_registered_assets():
    registered = {PREFIX + "scene-1.png": LOCAL}
    assert verdict(asset(), artifacts=registered)["ok"]
    assert "asset_not_registered" in codes(verdict(asset(), artifacts={}))
    assert "hash_mismatch" in codes(verdict(asset(), artifacts={PREFIX + "scene-1.png": "f" * 64}))
    assert "artifact_without_provenance" in codes(verdict(asset(), artifacts=registered | {PREFIX + "extra.png": "1" * 64}))
    assert verdict(asset(), artifacts={(PREFIX + "scene-1.png").upper(): LOCAL})["ok"]      # caixa não escapa do cruzamento


def test_unverified_unknown_and_restricted_are_never_commercially_permitted():
    base = ProvenanceAsset.model_validate(asset())
    assert commercial_use_permitted(base) is False
    verified = asset(status="verified", license={**asset()["license"], "commercial_use": "restricted", "attribution_required": False,
                                                 "verified_by": "human", "verified_at": "2026-11-13T10:00:00Z"})
    assert commercial_use_permitted(ProvenanceAsset.model_validate(verified)) is False
    verified["license"]["commercial_use"] = "allowed"
    assert commercial_use_permitted(ProvenanceAsset.model_validate(verified)) is True


def test_hostile_provenance_documents_never_raise():
    for hostile in (None, [], "x", 1, {"schema_version": True, "assets": []}, {"schema_version": 1, "assets": "x"},
                    {"schema_version": 1, "assets": [None]}, {"schema_version": 1, "assets": [{}] * 3}):
        result = validate_asset_provenance(hostile)
        assert result["ok"] is False and result["publishable"] is False


# ------------------------------------------------------------------------------ asset_sources

def pexels_candidate():
    return PexelsSource().parse_response(
        {"photos": [{"id": 1, "width": 10, "height": 10, "url": "https://www.pexels.com/photo/1/", "photographer": "Autor",
                     "src": {"original": "https://images.pexels.com/photos/1/a.jpeg"}}]}, kind="image", queried_at=NOW).candidates[0]


def test_candidate_needs_file_and_is_always_unverified():
    candidate = pexels_candidate()
    with pytest.raises(AssetSourceError) as error:
        to_provenance_asset(candidate)
    assert error.value.code == "file_not_obtained"
    entry = to_provenance_asset(with_obtained_file(candidate, relative_path=PREFIX + "pexels.png", sha256="a" * 64))
    assert entry["status"] == "unverified" and entry["license"]["verified_by"] is None
    assert commercial_use_permitted(ProvenanceAsset.model_validate(entry)) is False


@pytest.mark.parametrize("path", ["../x.png", "/etc/x.png", "a\\b.png", "C:/x.png", "a/../../x.png", "x\x00.png", "~/x.png"])
def test_obtained_file_path_traversal_is_rejected_by_the_contract(path):
    candidate = with_obtained_file(pexels_candidate(), relative_path=path, sha256="a" * 64)
    with pytest.raises(AssetSourceError):
        to_provenance_asset(candidate)


@pytest.mark.parametrize("digest", ["", "A" * 64, "a" * 63, "g" * 64, "../" * 21 + "a"])
def test_obtained_file_requires_lowercase_sha256(digest):
    with pytest.raises(AssetSourceError) as error:
        with_obtained_file(pexels_candidate(), relative_path=PREFIX + "p.png", sha256=digest)
    assert error.value.code == "invalid_hash"


def test_stock_item_with_control_characters_in_author_is_rejected_not_registered():
    payload = {"photos": [{"id": 2, "width": 10, "height": 10, "url": "https://www.pexels.com/photo/2/", "photographer": "Au\x00tor",
                           "src": {"original": "https://images.pexels.com/photos/2/a.jpeg"}}]}
    candidate = PexelsSource().parse_response(payload, kind="image", queried_at=NOW).candidates[0]
    with pytest.raises(AssetSourceError) as error:
        to_provenance_asset(with_obtained_file(candidate, relative_path=PREFIX + "a.png", sha256="b" * 64))
    assert error.value.code == "contract_rejected"


@pytest.mark.parametrize("url", ["file:///x", "javascript:alert(1)", "data:text/plain,x", "http://example.org/t",
                                 "https://u:p@example.org/t", "https://example.org/t?api_key=1", "https://exa mple.org/", "https://example.org/‮txt", ""])
def test_local_declaration_rejects_hostile_urls(tmp_path, url):
    source = LocalLicensedSource(tmp_path)
    for field in ("source_url", "license_url"):
        arguments = dict(kind="image", author="Autor", source_url="https://example.org/obra", license_id="cc0",
                         license_name="CC0", license_url="https://example.org/cc0", commercial_use="allowed",
                         attribution_required=False, queried_at=NOW)
        arguments[field] = url
        with pytest.raises(AssetSourceError):
            source.declare(**arguments)


def test_local_declaration_with_control_characters_never_reaches_provenance(tmp_path):
    source = LocalLicensedSource(tmp_path / "lib")
    (tmp_path / "lib").mkdir()
    origin = tmp_path / "foto.png"
    origin.write_bytes(PNG)
    candidate = source.import_file(origin, kind="image", author="Autor\x1b[31m", source_url="https://example.org/obra",
                                   license_id="cc0", license_name="CC0", license_url="https://example.org/cc0",
                                   commercial_use="allowed", attribution_required=False, queried_at=NOW)
    with pytest.raises(AssetSourceError) as error:
        to_provenance_asset(candidate)
    assert error.value.code == "contract_rejected"


def test_local_import_rejects_traversal_and_wrong_content(tmp_path):
    library = tmp_path / "lib"
    library.mkdir()
    source = LocalLicensedSource(library)
    declaration = dict(kind="image", author="Autor", source_url="https://example.org/obra", license_id="cc0", license_name="CC0",
                       license_url="https://example.org/cc0", commercial_use="allowed", attribution_required=False, queried_at=NOW)
    with pytest.raises(AssetSourceError) as error:
        source.import_file(str(tmp_path / "a" / ".." / "foto.png"), **declaration)
    assert error.value.code == "unsafe_path"
    with pytest.raises(AssetSourceError) as error:
        source.import_file("relativo.png", **declaration)
    assert error.value.code == "unsafe_path"
    fake = tmp_path / "falso.png"
    fake.write_bytes(b"MZ\x90\x00 isto e um executavel")
    with pytest.raises(AssetSourceError) as error:
        source.import_file(fake, **declaration)
    assert error.value.code == "signature_mismatch"
    assert list(library.iterdir()) == []            # nada sobra na biblioteca depois da recusa
