import copy
import hashlib
import os
import socket
from datetime import datetime, timezone
from pathlib import Path

import pytest

from horus_backend.asset_sources import (AssetSourceError, FixtureTransport, LocalLicensedSource, PexelsSource,
                                         PixabaySource, build_provenance, to_provenance_asset, with_obtained_file)
from horus_backend.media_contracts import commercial_use_permitted, validate_asset_provenance, ProvenanceAsset

NOW = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

PEXELS_PHOTOS = {"page": 1, "per_page": 15, "total_results": 1, "photos": [{
    "id": 2014422, "width": 3024, "height": 3024, "url": "https://www.pexels.com/photo/brown-rocks-2014422/",
    "photographer": "Joey Farina", "photographer_url": "https://www.pexels.com/@joey", "photographer_id": 680589,
    "avg_color": "#978E82", "liked": False, "alt": "Rochas",
    "src": {"original": "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg",
            "large2x": "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?w=1260"}}]}

PEXELS_VIDEOS = {"page": 1, "per_page": 15, "total_results": 1, "videos": [{
    "id": 857251, "width": 1920, "height": 1080, "duration": 12, "url": "https://www.pexels.com/video/857251/",
    "user": {"id": 1, "name": "Autora", "url": "https://www.pexels.com/@autora"},
    "video_files": [{"id": 1, "quality": "sd", "file_type": "video/mp4", "width": 640, "height": 360,
                     "link": "https://videos.pexels.com/video-files/857251/sd.mp4"},
                    {"id": 2, "quality": "hd", "file_type": "video/mp4", "width": 1920, "height": 1080,
                     "link": "https://videos.pexels.com/video-files/857251/hd.mp4"}]}]}

PIXABAY_IMAGES = {"total": 1, "totalHits": 1, "hits": [{
    "id": 195893, "pageURL": "https://pixabay.com/photos/blossom-bloom-flower-195893/", "type": "photo",
    "tags": "blossom, bloom", "previewURL": "https://cdn.pixabay.com/photo/2013/10/15/preview.jpg",
    "largeImageURL": "https://pixabay.com/get/large_195893.jpg", "imageWidth": 4000, "imageHeight": 2250,
    "imageSize": 4731420, "user_id": 48777, "user": "Josch13"}]}

PIXABAY_VIDEOS = {"total": 1, "totalHits": 1, "hits": [{
    "id": 125, "pageURL": "https://pixabay.com/videos/flowers-125/", "type": "film", "duration": 10,
    "videos": {"large": {"url": "https://cdn.pixabay.com/video/large.mp4", "width": 1920, "height": 1080, "size": 1},
              "tiny": {"url": "https://cdn.pixabay.com/video/tiny.mp4", "width": 640, "height": 360, "size": 1}},
    "user_id": 1, "user": "Autor"}]}


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Falha se qualquer teste tentar abrir conexão."""
    def blocked(*args, **kwargs):
        raise AssertionError("tentativa de abrir socket")
    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)


def valid(document):
    result = validate_asset_provenance(document)
    assert result["ok"], result["errors"]
    return result["value"]


# ------------------------------------------------------------------ Pexels

def test_pexels_image_to_unverified_provenance():
    parsed = PexelsSource().parse_response(PEXELS_PHOTOS, kind="image", queried_at=NOW)
    assert not parsed.rejected
    c = parsed.candidates[0]
    assert (c.origin, c.source_id, c.author, c.width, c.queried_at) == ("stock_pexels", "2014422", "Joey Farina", 3024, "2026-11-13T12:00:00Z")
    assert c.download_url.startswith("https://images.pexels.com/") and c.sha256 is None
    with pytest.raises(AssetSourceError) as error:  # sem arquivo, sem proveniência
        to_provenance_asset(c)
    assert error.value.code == "file_not_obtained"
    asset = to_provenance_asset(with_obtained_file(c, relative_path="rochas.jpg", sha256="c" * 64))
    doc = valid({"schema_version": 1, "assets": [asset]})
    got = doc["assets"][0]
    assert got["status"] == "unverified" and got["license"]["commercial_use"] == "unknown"
    assert got["license"]["verified_by"] is None and got["source_url"] == c.source_url
    assert "2026-11-13" in got["notes"] and "sem alteração" in got["notes"]
    assert not commercial_use_permitted(ProvenanceAsset.model_validate(got))


def test_pexels_video_picks_widest_file():
    c = PexelsSource().parse_response(PEXELS_VIDEOS, kind="video", queried_at=NOW).candidates[0]
    assert c.kind == "video" and c.download_url.endswith("hd.mp4") and c.duration_seconds == 12.0 and c.author == "Autora"


def test_search_uses_injected_fixture_transport_without_credentials():
    transport = FixtureTransport({"https://api.pexels.com/v1/search": PEXELS_PHOTOS})
    parsed = PexelsSource(transport).search("rochas", kind="image", queried_at=NOW)
    assert len(parsed.candidates) == 1
    request = transport.requests[0]
    assert set(request.params) == {"query", "per_page"} and "key" not in str(request).lower()
    with pytest.raises(AssetSourceError) as error:
        PexelsSource().search("x", kind="image", queried_at=NOW)
    assert error.value.code == "no_transport"


@pytest.mark.parametrize("mutate,code", [
    (lambda p: p.update(url="https://evil.example/photo/1/"), "host_not_official"),
    (lambda p: p.update(url="https://pexels.com.evil.example/photo/1/"), "host_not_official"),
    (lambda p: p.update(url="http://www.pexels.com/photo/1/"), "insecure_url"),
    (lambda p: p.update(url="https://user:pw@www.pexels.com/photo/1/"), "credential_in_url"),
    (lambda p: p["src"].update(original="https://images.pexels.com/a.jpg?api_key=abc"), "credential_in_url"),
    (lambda p: p["src"].update(original="https://cdn.evil.example/a.jpg"), "host_not_official"),
    (lambda p: p.pop("photographer"), "missing_author"),
    (lambda p: p.update(photographer="  "), "missing_author"),
    (lambda p: p.update(photographer_url="https://evil.example/@x"), "host_not_official"),
    (lambda p: p.pop("id"), "missing_id"),
])
def test_pexels_rejects_bad_items(mutate, code):
    payload = copy.deepcopy(PEXELS_PHOTOS)
    mutate(payload["photos"][0])
    parsed = PexelsSource().parse_response(payload, kind="image", queried_at=NOW)
    assert parsed.candidates == () and parsed.rejected[0]["code"] == code


def test_one_bad_item_does_not_drop_the_good_ones():
    payload = copy.deepcopy(PEXELS_PHOTOS)
    bad = copy.deepcopy(payload["photos"][0]); bad["id"] = 2; bad["photographer"] = ""
    payload["photos"].insert(0, bad)
    parsed = PexelsSource().parse_response(payload, kind="image", queried_at=NOW)
    assert [c.source_id for c in parsed.candidates] == ["2014422"] and parsed.rejected[0]["index"] == 0


@pytest.mark.parametrize("payload", [[], {"photos": "x"}, {}])
def test_malformed_response_is_an_error(payload):
    with pytest.raises(AssetSourceError) as error:
        PexelsSource().parse_response(payload, kind="image", queried_at=NOW)
    assert error.value.code == "invalid_response"


def test_naive_query_date_is_refused():
    with pytest.raises(AssetSourceError) as error:
        PexelsSource().parse_response(PEXELS_PHOTOS, kind="image", queried_at=datetime(2026, 11, 13))
    assert error.value.code == "invalid_date"


# ------------------------------------------------------------------ Pixabay

def test_pixabay_image_and_video():
    c = PixabaySource().parse_response(PIXABAY_IMAGES, kind="image", queried_at=NOW).candidates[0]
    assert (c.origin, c.author, c.width, c.height) == ("stock_pixabay", "Josch13", 4000, 2250)
    assert c.author_url == "https://pixabay.com/users/Josch13-48777/" and c.commercial_use == "unknown"
    doc = valid({"schema_version": 1, "assets": [to_provenance_asset(with_obtained_file(c, relative_path="a.jpg", sha256="d" * 64))]})
    assert doc["assets"][0]["asset_id"] == "pixabay-195893" and doc["assets"][0]["status"] == "unverified"
    v = PixabaySource().parse_response(PIXABAY_VIDEOS, kind="video", queried_at=NOW).candidates[0]
    assert v.download_url.endswith("large.mp4") and v.duration_seconds == 10.0


@pytest.mark.parametrize("mutate,code", [
    (lambda h: h.update(pageURL="https://example.com/photos/1/"), "host_not_official"),
    (lambda h: h.update(pageURL="http://pixabay.com/photos/1/"), "insecure_url"),
    (lambda h: h.update(largeImageURL="https://pixabay.com/get/x.jpg?key=12345-secret"), "credential_in_url"),
    (lambda h: h.update(largeImageURL="https://u:p@pixabay.com/get/x.jpg"), "credential_in_url"),
    (lambda h: h.pop("user"), "missing_author"),
])
def test_pixabay_rejects_bad_items(mutate, code):
    payload = copy.deepcopy(PIXABAY_IMAGES)
    mutate(payload["hits"][0])
    parsed = PixabaySource().parse_response(payload, kind="image", queried_at=NOW)
    assert parsed.candidates == () and parsed.rejected[0]["code"] == code


def test_unknown_license_is_never_treated_as_allowed():
    for source, payload in ((PexelsSource(), PEXELS_PHOTOS), (PixabaySource(), PIXABAY_IMAGES)):
        c = source.parse_response(payload, kind="image", queried_at=NOW).candidates[0]
        assert c.commercial_use != "allowed" and c.status == "unverified" and c.attribution_required is None
        assert c.terms_restrictions


def test_stock_sources_cannot_obtain_files():
    c = PexelsSource().parse_response(PEXELS_PHOTOS, kind="image", queried_at=NOW).candidates[0]
    for source in (PexelsSource(), PixabaySource()):
        with pytest.raises(AssetSourceError) as error:
            source.obtain(c)
        assert error.value.code == "download_not_enabled"


def test_contract_rejects_provenance_with_wrong_host():
    c = PexelsSource().parse_response(PEXELS_PHOTOS, kind="image", queried_at=NOW).candidates[0]
    from dataclasses import replace
    forged = replace(with_obtained_file(c, relative_path="a.jpg", sha256="c" * 64), source_url="https://evil.example/x")
    with pytest.raises(AssetSourceError) as error:
        to_provenance_asset(forged)
    assert error.value.code == "contract_rejected" and "invalid_url" in str(error.value)


def test_duplicate_ids_are_refused_in_document():
    c = with_obtained_file(PexelsSource().parse_response(PEXELS_PHOTOS, kind="image", queried_at=NOW).candidates[0],
                           relative_path="a.jpg", sha256="c" * 64)
    with pytest.raises(AssetSourceError) as error:
        build_provenance([c, c])
    assert error.value.code == "contract_rejected"


# ------------------------------------------------------------------ Local

def declaration(**over):
    base = dict(kind="image", author="Fotógrafa Local", source_url="https://example.com/loja/foto-1",
                license_id="contrato-2026-01", license_name="Contrato de licença comercial",
                license_url="https://example.com/termos", commercial_use="unknown",
                attribution_required=None, queried_at=NOW)
    base.update(over)
    return base


@pytest.fixture
def library(tmp_path):
    folder = tmp_path / "library"
    folder.mkdir()
    return folder


def write(path: Path, data: bytes = PNG) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def test_local_import_copies_hashes_and_keeps_original(tmp_path, library):
    original = write(tmp_path / "inbox" / "Foto Bonita!.png")
    before = (original.read_bytes(), original.stat().st_mtime_ns)
    c = LocalLicensedSource(library).import_file(original, **declaration())
    sha = hashlib.sha256(PNG).hexdigest()
    assert c.sha256 == sha and c.size_bytes == len(PNG) and c.origin == "licensed_manual"
    assert c.relative_path == f"{sha[:12]}-Foto_Bonita.png" and (library / c.relative_path).read_bytes() == PNG
    assert (original.read_bytes(), original.stat().st_mtime_ns) == before
    assert not list(library.glob(".import-*"))
    doc = valid({"schema_version": 1, "assets": [to_provenance_asset(c)]})
    assert doc["assets"][0]["status"] == "unverified" and doc["assets"][0]["asset_id"] == f"local-{sha[:12]}"
    # reimportar o mesmo conteúdo é idempotente
    again = LocalLicensedSource(library).import_file(original, **declaration())
    assert again.relative_path == c.relative_path


@pytest.mark.parametrize("over,code", [
    (dict(author=""), "missing_author"),
    (dict(license_id=" "), "missing_license"),
    (dict(license_url="http://example.com/termos"), "insecure_url"),
    (dict(source_url="https://u:p@example.com/x"), "credential_in_url"),
    (dict(commercial_use="yes"), "invalid_license"),
    (dict(kind="document"), "unsupported_kind"),
])
def test_local_declaration_negatives(tmp_path, library, over, code):
    with pytest.raises(AssetSourceError) as error:
        LocalLicensedSource(library).import_file(write(tmp_path / "a.png"), **declaration(**over))
    assert error.value.code == code and not list(library.iterdir())


def test_local_path_traversal_and_relative_refused(tmp_path, library):
    write(tmp_path / "secret.png")
    source = LocalLicensedSource(library)
    for raw in (str(tmp_path / "inbox" / ".." / "secret.png"), "secret.png", str(tmp_path) + "\\..\\secret.png"):
        with pytest.raises(AssetSourceError) as error:
            source.import_file(raw, **declaration())
        assert error.value.code == "unsafe_path"
    assert not list(library.iterdir())


def test_local_symlink_refused(tmp_path, library):
    real = write(tmp_path / "real.png")
    link = tmp_path / "link.png"
    try:
        os.symlink(real, link)
    except (OSError, NotImplementedError):
        pytest.skip("sem permissão para criar links simbólicos")
    with pytest.raises(AssetSourceError) as error:
        LocalLicensedSource(library).import_file(link, **declaration())
    assert error.value.code == "symlink_not_allowed"
    folder_link = tmp_path / "dirlink"
    os.symlink(real.parent, folder_link, target_is_directory=True)
    with pytest.raises(AssetSourceError) as error:
        LocalLicensedSource(library).import_file(folder_link / "real.png", **declaration())
    assert error.value.code == "symlink_not_allowed"


def test_local_oversize_wrong_type_and_signature(tmp_path, library):
    source = LocalLicensedSource(library, max_bytes={"image": 100})
    big = write(tmp_path / "big.png", PNG + b"\x00" * 100)
    with pytest.raises(AssetSourceError) as error:
        source.import_file(big, **declaration())
    assert error.value.code == "size_not_allowed"
    empty = write(tmp_path / "empty.png", b"")
    with pytest.raises(AssetSourceError) as error:
        source.import_file(empty, **declaration())
    assert error.value.code == "size_not_allowed"
    exe = write(tmp_path / "x.exe", b"MZ" + b"\x00" * 10)
    with pytest.raises(AssetSourceError) as error:
        source.import_file(exe, **declaration())
    assert error.value.code == "unsupported_type"
    fake = write(tmp_path / "fake.png", b"MZ" + b"\x00" * 10)
    with pytest.raises(AssetSourceError) as error:
        source.import_file(fake, **declaration())
    assert error.value.code == "signature_mismatch"
    with pytest.raises(AssetSourceError) as error:
        source.import_file(tmp_path, **declaration())
    assert error.value.code == "not_a_file"
    with pytest.raises(AssetSourceError) as error:
        source.import_file(tmp_path / "missing.png", **declaration())
    assert error.value.code == "not_found"
    assert not list(library.iterdir())


def test_local_invalid_library_and_conflict(tmp_path):
    with pytest.raises(AssetSourceError) as error:
        LocalLicensedSource(tmp_path / "nope").import_file(write(tmp_path / "a.png"), **declaration())
    assert error.value.code == "invalid_library"
    library = tmp_path / "lib"; library.mkdir()
    original = write(tmp_path / "a.png")
    c = LocalLicensedSource(library).import_file(original, **declaration())
    (library / c.relative_path).write_bytes(b"adulterado")
    with pytest.raises(AssetSourceError) as error:
        LocalLicensedSource(library).import_file(original, **declaration())
    assert error.value.code == "target_conflict" and not list(library.glob(".import-*"))


def test_local_source_has_no_search():
    with pytest.raises(AssetSourceError):
        LocalLicensedSource(Path(".")).search("x", kind="image", queried_at=NOW)


# ------------------------------------------------------------------ Sem rede

def test_whole_flow_never_opens_a_socket(tmp_path, library):
    """O autouse `no_network` falha o teste se qualquer connect for chamado; aqui o fluxo completo roda sob ele."""
    transport = FixtureTransport({"https://pixabay.com/api/": PIXABAY_IMAGES})
    c = PixabaySource(transport).search("flor", kind="image", queried_at=NOW).candidates[0]
    stock = to_provenance_asset(with_obtained_file(c, relative_path="flor.jpg", sha256="e" * 64))
    local = to_provenance_asset(LocalLicensedSource(library).import_file(write(tmp_path / "l.png"), **declaration()))
    doc = build_provenance([with_obtained_file(c, relative_path="flor.jpg", sha256="e" * 64),
                            LocalLicensedSource(library).import_file(tmp_path / "l.png", **declaration())])
    assert [a["status"] for a in doc["assets"]] == ["unverified", "unverified"] and stock and local
    with pytest.raises(AssertionError):  # a guarda realmente bloqueia
        socket.socket().connect(("127.0.0.1", 9))


def test_package_has_no_network_imports():
    package = Path(__file__).resolve().parents[1] / "src" / "horus_backend" / "asset_sources"
    forbidden = ("import socket", "import requests", "import httpx", "import urllib.request", "from urllib.request",
                 "http.client", "aiohttp", "os.environ", "getenv")
    for file in package.glob("*.py"):
        text = file.read_text(encoding="utf-8")
        assert not [item for item in forbidden if item in text], file.name


@pytest.mark.skipif(os.name != "nt", reason="junção é do Windows")
def test_local_junction_refused(tmp_path, library):
    import subprocess
    real = write(tmp_path / "real" / "a.png")
    junction = tmp_path / "junction"
    subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(real.parent)], check=True, capture_output=True)
    try:
        with pytest.raises(AssetSourceError) as error:
            LocalLicensedSource(library).import_file(junction / "a.png", **declaration())
        assert error.value.code == "symlink_not_allowed"
    finally:
        os.rmdir(junction)  # remove só a junção, nunca o destino
