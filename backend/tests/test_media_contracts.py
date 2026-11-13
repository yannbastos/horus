"""Contratos de mídia: validação pura, negativos e sincronia dos JSON Schemas exportados."""
import json
import re
from pathlib import Path

import pytest

from horus_backend import media_contracts as mc

ROOT = Path(__file__).resolve().parents[2]
H1, H2, H3 = "a" * 64, "b" * 64, "c" * 64
TEXT = "Olá mundo. Isto é um teste."


def words_doc(**changes):
    words = []
    spans = [(0.0, 0.4, 1), (0.5, 1.0, 1), (1.2, 1.5, 2), (1.5, 1.7, 2), (1.8, 2.0, 2), (2.0, 2.6, 2)]
    for index, ((start, end, section), match) in enumerate(zip(spans, re.finditer(r"\S+", TEXT))):
        words.append({"index": index, "text": match.group(), "section": section, "start": start, "end": end,
                      "char_offset": match.start(), "char_length": len(match.group())})
    doc = {"schema_version": 1, "narration_sha256": H1, "duration_seconds": 2.6, "source": "tts_engine_events",
           "engine": {"name": "windows_sapi", "voice": "Maria"}, "words": words}
    doc.update(changes)
    return doc


SECTIONS = [{"section": 1, "start": 0.0, "end": 1.1}, {"section": 2, "start": 1.1, "end": 2.6}]
CTX = dict(narration_sha256=H1, duration_seconds=2.6, script_text=TEXT, sections=SECTIONS)


def codes(result):
    return {e["code"] for e in result["errors"]}


def _swap_sections(doc):
    doc["words"][1]["section"] = 2
    doc["words"][2]["section"] = 1


def test_word_timings_valid_and_aligned():
    result = mc.validate_word_timings(words_doc(), **CTX)
    assert result["ok"] and result["speech_aligned"] is True and result["publishable"] is False and not result["errors"]


def test_word_timings_without_context_never_aligned():
    result = mc.validate_word_timings(words_doc())
    assert result["ok"] and result["speech_aligned"] is False and "script_not_checked" in result["warnings"]


def test_estimated_never_aligned_even_with_full_context():
    result = mc.validate_word_timings(words_doc(source="estimated"), **CTX)
    assert result["ok"] and result["speech_aligned"] is False


@pytest.mark.parametrize("mutate,code", [
    (lambda d: d["words"][1].update(start=0.2, end=0.3), "word_overlap"),
    (lambda d: d["words"][2].update(start=0.1, end=0.15), "word_out_of_order"),
    (lambda d: d["words"][5].update(end=3.0), "word_beyond_duration"),
    (lambda d: d["words"][0].update(end=0.0), "word_span"),
    (lambda d: d["words"][3].update(index=9), "word_index"),
    (_swap_sections, "section_order"),
    (lambda d: d.update(extra=1), "schema_extra_forbidden"),
    (lambda d: d.update(publishable=True), "schema_extra_forbidden"),
    (lambda d: d.update(source="measured"), "schema_literal_error"),
])
def test_word_timings_negative(mutate, code):
    doc = words_doc()
    mutate(doc)
    result = mc.validate_word_timings(doc, **CTX)
    assert not result["ok"] and result["speech_aligned"] is False and code in codes(result), result["errors"]


def test_word_timings_hash_duration_script_and_sections_mismatch():
    assert "narration_hash_mismatch" in codes(mc.validate_word_timings(words_doc(), **{**CTX, "narration_sha256": H2}))
    assert "duration_mismatch" in codes(mc.validate_word_timings(words_doc(), **{**CTX, "duration_seconds": 5.0}))
    assert "words_missing" in codes(mc.validate_word_timings(words_doc(), **{**CTX, "script_text": TEXT + " extra"}))
    assert "words_extra" in codes(mc.validate_word_timings(words_doc(), **{**CTX, "script_text": "Olá mundo."}))
    assert "word_text_mismatch" in codes(
        mc.validate_word_timings(words_doc(), **{**CTX, "script_text": TEXT.replace("teste", "texto")}))
    narrow = [{"section": 1, "start": 0.0, "end": 0.6}, {"section": 2, "start": 1.1, "end": 2.6}]
    assert "word_outside_section" in codes(mc.validate_word_timings(words_doc(), **{**CTX, "sections": narrow}))
    assert "unknown_section" in codes(mc.validate_word_timings(words_doc(), **{**CTX, "sections": SECTIONS[:1]}))
    assert "invalid_sections" in codes(mc.validate_word_timings(words_doc(), **{**CTX, "sections": [{"section": 1}]}))


@pytest.mark.parametrize("garbage", [None, 3, "x", [], {}, {"words": 1}, float("nan")])
def test_validators_never_raise(garbage):
    assert mc.validate_word_timings(garbage)["ok"] is False
    assert mc.validate_quality_report(garbage)["ok"] is False
    assert mc.validate_asset_provenance(garbage)["ok"] is False
    assert mc.validate_word_timings(words_doc(), script_text=object(), sections=5)["ok"] is False


# --- quality-report -------------------------------------------------------------------------

def check(**changes):
    value = {"id": "audio_peak", "category": "audio", "status": "pass", "method": "measured",
             "measured": {"source": "ffmpeg_astats", "peak_db": -3.0}, "threshold": {"max_db": -1.0}, "detail": "ok"}
    value.update(changes)
    return value


def report(checks=None, **changes):
    checks = [check()] if checks is None else checks
    doc = {"schema_version": 1, "production_id": "prod1", "video_sha256": H1, "generated_at": "2026-11-13T10:00:00Z",
           "tool": {"name": "horus-av-quality", "version": "1"}, "status": "pass", "checks": checks,
           "blocking_errors": [c["id"] for c in checks if c["status"] == "fail"],
           "warnings": [c["id"] for c in checks if c["status"] == "warn"]}
    doc.update(changes)
    return doc


def test_quality_report_valid_and_cross_video():
    assert mc.validate_quality_report(report(), video_sha256=H1, production_id="prod1")["ok"]
    assert "video_hash_mismatch" in codes(mc.validate_quality_report(report(), video_sha256=H2))
    assert "production_mismatch" in codes(mc.validate_quality_report(report(), production_id="other"))


def test_quality_report_not_run_and_skipped():
    skipped = check(id="loudness", status="skipped", measured={}, detail="ffmpeg indisponível")
    assert mc.validate_quality_report(report([skipped], status="not_run"))["ok"]
    assert "status_mismatch" in codes(mc.validate_quality_report(report([skipped], status="pass")))
    assert "status_mismatch" in codes(mc.validate_quality_report(report([], status="pass")))


def test_estimate_marked_as_measured_rejected():
    for source in ("estimativa por palavras/s", "heuristic", "declared"):
        bad = check(measured={"source": source})
        assert "estimate_as_measured" in codes(mc.validate_quality_report(report([bad])))
    assert "measured_without_source" in codes(mc.validate_quality_report(report([check(measured={"peak_db": -3})])))
    sync = check(id="sync_words", category="sync")
    assert "estimate_as_measured" in codes(mc.validate_quality_report(report([sync]), word_timings_source="estimated"))
    ok = check(id="sync_words", category="sync", method="estimated", measured={"source": "heuristica"}, status="warn")
    assert mc.validate_quality_report(report([ok], status="warn"), word_timings_source="estimated")["ok"]


def _timecode_backwards(doc):
    doc["checks"][0]["timecode"] = {"start": 5, "end": 1}


@pytest.mark.parametrize("mutate,code", [
    (lambda d: d.update(blocking_errors=["audio_peak"]), "blocking_errors_mismatch"),
    (lambda d: d.update(warnings=["x"]), "warnings_mismatch"),
    (lambda d: d["checks"].append(check()), "check_id_duplicate"),
    (_timecode_backwards, "schema_value_error"),
    (lambda d: d["checks"][0].update(method="guess"), "schema_literal_error"),
    (lambda d: d["checks"][0]["measured"].update(peak_db=float("inf")), "non_finite"),
    (lambda d: d.update(generated_at="ontem"), "schema_value_error"),
    (lambda d: d.update(publishable=True), "schema_extra_forbidden"),
])
def test_quality_report_negative(mutate, code):
    doc = report()
    mutate(doc)
    result = mc.validate_quality_report(doc)
    assert code in codes(result), result["errors"]


def test_quality_report_failure_with_timecode():
    bad = check(id="clipping", status="fail", timecode={"start": 1.0, "end": 1.5})
    assert mc.validate_quality_report(report([check(), bad], status="fail"))["ok"]


# --- asset-provenance ----------------------------------------------------------------------

def lic(**changes):
    value = {"id": None, "name": None, "url": None, "commercial_use": "unknown", "attribution_required": None,
             "verified_by": None, "verified_at": None}
    value.update(changes)
    return value


def asset(**changes):
    value = {"asset_id": "img1", "relative_path": "assets/c1.png", "sha256": H1, "kind": "image", "origin": "original_local",
             "source_url": None, "author": None, "license": lic(), "status": "unverified", "notes": ""}
    value.update(changes)
    return value


def stock(**changes):
    value = asset(origin="stock_pexels", source_url="https://www.pexels.com/photo/1/", author="Fulano",
                  license=lic(id="pexels", name="Pexels License", url="https://www.pexels.com/license/",
                              commercial_use="allowed", attribution_required=False))
    value.update(changes)
    return value


def prov(*assets):
    return {"schema_version": 1, "assets": list(assets)}


def test_provenance_valid_local_and_verified_stock():
    verified = stock(status="verified", asset_id="s1", relative_path="assets/s1.jpg")
    verified["license"].update(verified_by="human", verified_at="2026-11-13T10:00:00Z")
    result = mc.validate_asset_provenance(prov(asset(), verified))
    assert result["ok"], result["errors"]
    assert "unverified_assets_block_publication" in result["warnings"]
    assert result["publishable"] is False
    model = mc.AssetProvenance.model_validate(prov(verified))
    assert mc.commercial_use_permitted(model.assets[0]) is True
    assert mc.commercial_use_permitted(mc.AssetProvenance.model_validate(prov(stock())).assets[0]) is False


def _license_id_none(a):
    a["license"]["id"] = None


def _license_url_none(a):
    a["license"]["url"] = None


def _verified_by_only(a):
    a["license"]["verified_by"] = "human"


@pytest.mark.parametrize("mutate,code", [
    (lambda a: a.update(source_url=None), "missing_source_url"),
    (lambda a: a.update(author=None), "missing_author"),
    (_license_id_none, "missing_license"),
    (_license_url_none, "missing_license"),
    (lambda a: a.update(source_url="https://evil.example/pexels.com"), "invalid_url"),
    (lambda a: a.update(source_url="http://www.pexels.com/x"), "invalid_url"),
    (lambda a: a.update(source_url="https://user:pw@pexels.com/x"), "invalid_url"),
    (lambda a: a.update(status="verified"), "verified_without_human"),
    (lambda a: a.update(relative_path="../x.png"), "unsafe_path"),
    (_verified_by_only, "verification_incomplete"),
])
def test_provenance_stock_negative(mutate, code):
    item = stock()
    mutate(item)
    result = mc.validate_asset_provenance(prov(item))
    assert code in codes(result), result["errors"]


def test_pixabay_host_enforced():
    assert "invalid_url" in codes(mc.validate_asset_provenance(prov(stock(origin="stock_pixabay"))))


def test_unknown_commercial_use_never_verified_or_permitted():
    item = stock(status="verified")
    item["license"].update(commercial_use="unknown", verified_by="human", verified_at="2026-11-13T10:00:00Z")
    assert "verified_unknown_commercial" in codes(mc.validate_asset_provenance(prov(item)))
    unknown = stock()
    unknown["license"]["commercial_use"] = "unknown"
    model = mc.AssetProvenance.model_validate(prov(unknown))
    assert mc.commercial_use_permitted(model.assets[0]) is False


@pytest.mark.parametrize("path", ["/abs.png", "C:/x.png", "a\\b.png", "a//b.png", "./a.png", "a/../b.png", "~/a.png",
                                  "a/b.", "http://x/y.png", "a/\x00.png"])
def test_unsafe_paths(path):
    assert "unsafe_path" in codes(mc.validate_asset_provenance(prov(asset(relative_path=path))))


def test_publishable_true_rejected_everywhere():
    for validate, doc in ((mc.validate_asset_provenance, prov(asset())), (mc.validate_quality_report, report()),
                          (mc.validate_word_timings, words_doc())):
        assert validate(doc)["ok"]
        assert "schema_extra_forbidden" in codes(validate({**doc, "publishable": True}))
    assert "schema_extra_forbidden" in codes(mc.validate_asset_provenance(prov(asset(publishable=True))))


def test_provenance_duplicates_and_cross_artifacts():
    dup = prov(asset(), asset(asset_id="img2", relative_path="Assets/C1.png"))
    assert "duplicate_relative_path" in codes(mc.validate_asset_provenance(dup))
    doc = prov(asset())
    registered = {"assets/c1.png": H1}
    assert mc.validate_asset_provenance(doc, artifacts=registered)["ok"]
    assert "hash_mismatch" in codes(mc.validate_asset_provenance(doc, artifacts={"assets/c1.png": H2}))
    assert "asset_not_registered" in codes(mc.validate_asset_provenance(doc, artifacts={}))
    assert "artifact_without_provenance" in codes(
        mc.validate_asset_provenance(doc, artifacts={**registered, "assets/z.png": H3}))


def test_no_type_coercion():
    assert not mc.validate_asset_provenance({"schema_version": "1", "assets": []})["ok"]
    assert not mc.validate_asset_provenance({"schema_version": True, "assets": []})["ok"]
    assert not mc.validate_word_timings(words_doc(duration_seconds="2.6"))["ok"]
    assert not mc.validate_word_timings(words_doc(duration_seconds=True))["ok"]
    doc = prov(asset())
    doc["assets"][0]["license"]["attribution_required"] = "false"
    assert not mc.validate_asset_provenance(doc)["ok"]


# --- JSON Schemas exportados ---------------------------------------------------------------

@pytest.mark.parametrize("name", sorted(mc.SCHEMAS))
def test_exported_schema_in_sync(name):
    path = ROOT / "contracts" / "media" / name
    expected = json.dumps(mc.SCHEMAS[name].model_json_schema(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    assert path.read_text(encoding="utf-8") == expected, "rode contracts/media/generate_schemas.py"
