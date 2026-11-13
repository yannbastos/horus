"""Alinhamento acústico da narração (HOR-054): unidade com ASR sintético, contrato e ensaio real condicional."""
from __future__ import annotations

import copy
import json
import os
import re
import sys
from pathlib import Path

import pytest

from horus_backend import media_contracts as mc
from horus_backend import speech_alignment as sa

SHA = "a" * 64
ENGINE = {"name": "windows_sapi", "voice": "Voz de teste"}
SECTION_TEXTS = ["Olá, mundo! Este é o Hórus.", "Em 2026 temos 50% de chance, veja o guarda-chuva."]


def _script(texts=SECTION_TEXTS) -> str:
    return "\n".join(texts)


def _sections(texts=SECTION_TEXTS, length=6.0):
    return [{"section": n, "start": (n - 1) * length, "end": n * length} for n, _ in enumerate(texts, 1)]


def _asr_from_script(script: str, sections, spoken=None):
    """ASR perfeito sintético: cada palavra ocupa 0,3 s dentro da seção; `spoken` troca o que o ASR 'ouviu'."""
    words = []
    for number, text in enumerate(script.split("\n")):
        cursor = sections[number]["start"] + 0.2
        for token in text.split():
            heard = (spoken or {}).get(token, token)
            if heard is not None:
                words.append({"word": " " + heard, "start": round(cursor, 3), "end": round(cursor + 0.3, 3)})
            cursor += 0.35
    return words


def _align(script=None, asr=None, sections=None, duration=12.0, **kwargs):
    script = script or _script()
    sections = sections or _sections()
    return sa.align_with_report(script, asr if asr is not None else _asr_from_script(script, sections), sections=sections,
                                narration_sha256=SHA, duration_seconds=duration, engine=ENGINE, **kwargs)


def _verdict(document, script=None, sections=None, duration=12.0):
    return mc.validate_word_timings(document, narration_sha256=SHA, duration_seconds=duration,
                                    script_text=script or _script(), sections=sections or _sections())


def _timings(document):
    return [w["timing"] for w in document["words"]]


# ------------------------------------------------------------------------------ normalização

def test_number_words_pt_br():
    assert sa.number_words(0) == ["zero"]
    assert sa.number_words(21) == ["vinte", "e", "um"]
    assert sa.number_words(100) == ["cem"]
    assert sa.number_words(2026) == ["dois", "mil", "e", "vinte", "e", "seis"]
    assert sa.number_words(1_250_000) == ["um", "milhão", "duzentos", "e", "cinquenta", "mil"]
    assert sa.number_words(10**9) is None


def test_expand_ignores_punctuation_case_and_accents():
    assert sa.expand("Hórus,") == ["horus"]
    assert sa.expand("guarda-chuva.") == ["guarda", "chuva"]
    assert sa.expand("—") == []
    assert sa.expand("50%") == ["cinquenta", "por", "cento"]
    assert sa.expand("1.000") == ["mil"]
    assert sa.expand("2.500") == ["dois", "mil", "e", "quinhentos"]
    assert sa.expand("3,5") == ["tres", "virgula", "cinco"]


# ------------------------------------------------------------------------------ alinhamento

def test_perfect_match_is_measured_and_speech_aligned():
    document, report = _align(asr=_asr_from_script(_script(), _sections(), spoken={
        "2026": "dois mil e vinte e seis", "50%": "cinquenta por cento", "guarda-chuva.": "guarda-chuva"}))
    assert document["source"] == "forced_alignment"
    assert set(_timings(document)) == {"measured"}
    assert document["alignment"]["match_rate"] == 1.0 and document["alignment"]["longest_interpolated_seconds"] == 0.0
    verdict = _verdict(document)
    assert verdict["ok"] and verdict["speech_aligned"] and verdict["warnings"] == []
    assert report["speech_aligned"] is True and report["sections_with_measured_words"] == 2


def test_numbers_as_digits_in_asr_match_numbers_in_script():
    document, _ = _align()   # ASR devolve "2026" e "50%" iguais ao roteiro
    assert set(_timings(document)) == {"measured"}


def test_multiword_asr_for_one_script_number_spans_all_words():
    script, sections = "Ano 2026 agora", _sections(["Ano 2026 agora"], 6.0)
    asr = [{"word": "Ano", "start": 0.2, "end": 0.5}] + [
        {"word": w, "start": 0.6 + i * 0.3, "end": 0.85 + i * 0.3} for i, w in enumerate(
            ["dois", "mil", "e", "vinte", "e", "seis"])] + [{"word": "agora", "start": 2.6, "end": 3.0}]
    document, _ = _align(script, asr, sections, duration=6.0)
    number = document["words"][1]
    assert number["timing"] == "measured" and number["start"] == 0.6 and number["end"] == 2.35


def test_omitted_asr_word_is_interpolated_not_measured():
    script = _script()
    asr = _asr_from_script(script, _sections(), spoken={"mundo!": None})
    document, _ = _align(asr=asr)
    index = next(w["index"] for w in document["words"] if w["text"] == "mundo!")
    word = document["words"][index]
    assert word["timing"] == "interpolated"
    before, after = document["words"][index - 1], document["words"][index + 1]
    assert before["end"] <= word["start"] < word["end"] <= after["start"]
    assert document["alignment"]["interpolated_words"] == 1
    assert _verdict(document)["ok"]


def test_swapped_and_extra_asr_words():
    asr = _asr_from_script(_script(), _sections(), spoken={"mundo!": "mondo", "Este": "esse"})
    asr.insert(2, {"word": "hum", "start": 0.55, "end": 0.6})      # palavra extra
    asr.append({"word": "tchau", "start": 11.5, "end": 11.9})      # extra no fim
    document, _ = _align(asr=asr)
    by_text = {w["text"]: w for w in document["words"]}
    assert by_text["mundo!"]["timing"] == "measured"       # "mondo" ~ "mundo" (grafia próxima)
    assert by_text["Este"]["timing"] == "interpolated"     # "esse" é outra palavra (< 4 letras de similaridade)
    assert len(document["words"]) == len(_script().split())  # extras do ASR nunca entram no documento
    assert _verdict(document)["ok"]


def test_token_without_speakable_text_is_interpolated():
    script, sections = "alfa — beta", _sections(["alfa — beta"], 3.0)
    asr = [{"word": "alfa", "start": 0.2, "end": 0.6}, {"word": "beta", "start": 1.0, "end": 1.4}]
    document, _ = _align(script, asr, sections, duration=3.0)
    assert _timings(document) == ["measured", "interpolated", "measured"]
    assert 0.6 <= document["words"][1]["start"] < document["words"][1]["end"] <= 1.0


def test_below_threshold_is_valid_but_not_speech_aligned():
    document, report = _align(asr=[])
    assert set(_timings(document)) == {"interpolated"}
    assert document["alignment"]["match_rate"] == 0.0
    verdict = _verdict(document)
    assert verdict["ok"] and verdict["speech_aligned"] is False
    assert "alignment_below_threshold" in verdict["warnings"]
    assert report["speech_aligned"] is False


def test_long_interpolated_run_blocks_speech_aligned_even_with_high_match_rate():
    texts = [" ".join(f"palavra{n}" for n in range(60))]
    sections = _sections(texts, 60.0)
    asr = _asr_from_script(texts[0], sections)
    del asr[20:28]                       # 8 palavras seguidas (2,8 s) sem reconhecimento
    document, _ = _align(texts[0], asr, sections, duration=60.0)
    assert document["alignment"]["match_rate"] >= mc.MIN_MATCH_RATE
    assert document["alignment"]["longest_interpolated_seconds"] > mc.MAX_INTERPOLATED_RUN_SECONDS
    verdict = _verdict(document, texts[0], sections, 60.0)
    assert verdict["ok"] and not verdict["speech_aligned"] and "alignment_below_threshold" in verdict["warnings"]


def test_out_of_order_and_invalid_asr_times_are_dropped():
    asr = _asr_from_script(_script(), _sections())
    asr[3] = {"word": "é", "start": 0.1, "end": 0.4}                         # regride no tempo
    asr[4] = {"word": "o", "start": float("nan"), "end": 2.0}                # tempo inválido
    asr[5] = {"word": "Hórus.", "start": 2.0, "end": 2.0}                    # duração zero
    document, _ = _align(asr=asr)
    assert _timings(document)[:6] == ["measured", "measured", "measured", "interpolated", "interpolated", "interpolated"]
    assert _verdict(document)["ok"]
    cleaned = sa.clean_asr_words(asr, 12.0)
    assert all(b["start"] >= a["end"] for a, b in zip(cleaned, cleaned[1:]))


def test_word_leaking_across_section_boundary_is_not_matched_to_other_section():
    texts, sections = ["alfa beta", "gama delta"], _sections(["alfa beta", "gama delta"], 3.0)
    asr = [{"word": "alfa", "start": 0.2, "end": 0.6}, {"word": "beta", "start": 0.7, "end": 1.1},
           {"word": "gama", "start": 3.1, "end": 3.5}, {"word": "delta", "start": 3.6, "end": 4.0}]
    document, _ = _align("\n".join(texts), asr, sections, duration=6.0)
    assert set(_timings(document)) == {"measured"}
    assert _verdict(document, "\n".join(texts), sections, 6.0)["speech_aligned"]


def test_word_slightly_outside_section_is_clamped_and_reported():
    texts, sections = ["alfa beta"], _sections(["alfa beta"], 3.0)
    asr = [{"word": "alfa", "start": 0.2, "end": 0.6}, {"word": "beta", "start": 2.8, "end": 3.2}]
    document, report = _align("alfa beta", asr, sections, duration=6.0)
    beta = document["words"][1]
    assert beta["timing"] == "measured" and beta["end"] == 3.0
    assert report["clamped_to_section"] == 1 and report["max_clamp_seconds"] == pytest.approx(0.2)


def test_neighbours_demoted_when_gap_is_too_small_for_interpolation():
    script, sections = "a b c d", _sections(["a b c d"], 4.0)
    asr = [{"word": "a", "start": 0.0, "end": 1.0}, {"word": "c", "start": 1.0, "end": 2.0},
           {"word": "d", "start": 2.0, "end": 4.0}]
    document, _ = _align(script, asr, sections, duration=4.0)
    assert _timings(document)[2:] == ["measured", "measured"] and "interpolated" in _timings(document)[:2]
    assert _verdict(document, script, sections, 4.0)["ok"]


def test_invalid_inputs_raise_value_error():
    with pytest.raises(ValueError):
        sa.align_script("a\nb", [], sections=_sections(["a"]), narration_sha256=SHA, duration_seconds=12.0, engine=ENGINE)
    with pytest.raises(ValueError):
        sa.align_script("a", [], sections=[{"section": 1, "start": 2, "end": 1}], narration_sha256=SHA,
                        duration_seconds=12.0, engine=ENGINE)
    with pytest.raises(ValueError):
        sa.align_script("   ", [], sections=_sections(["a"]), narration_sha256=SHA, duration_seconds=12.0, engine=ENGINE)


# ------------------------------------------------------------------------------ contrato

def _legacy_estimated() -> dict:
    script = "um dois\ntrês"
    words, offset = [], 0
    for number, text in enumerate(script.split("\n"), 1):
        for token in re.finditer(r"\S+", text):
            words.append({"index": len(words), "text": token.group(), "section": number, "start": len(words) + 0.0,
                          "end": len(words) + 0.9, "char_offset": offset + token.start(), "char_length": len(token.group())})
        offset += len(text) + 1
    return {"schema_version": 1, "narration_sha256": SHA, "duration_seconds": 3.0, "source": "estimated",
            "engine": ENGINE, "words": words}


def test_legacy_estimated_document_stays_valid_and_byte_stable():
    document = _legacy_estimated()
    verdict = mc.validate_word_timings(document, narration_sha256=SHA, duration_seconds=3.0, script_text="um dois\ntrês",
                                       sections=[{"section": 1, "start": 0, "end": 2}, {"section": 2, "start": 2, "end": 3}])
    assert verdict["ok"] and verdict["speech_aligned"] is False
    assert "timing" not in verdict["value"]["words"][0] and "alignment" not in verdict["value"]
    assert json.dumps(verdict["value"], ensure_ascii=False) == json.dumps(document, ensure_ascii=False)


def test_forced_alignment_requires_timing_and_alignment_and_estimated_forbids_them():
    document, _ = _align()
    missing_summary = {k: v for k, v in document.items() if k != "alignment"}
    assert "alignment_missing" in {e["code"] for e in mc.validate_word_timings(missing_summary)["errors"]}
    no_timing = copy.deepcopy(document)
    del no_timing["words"][0]["timing"]
    assert "timing_missing" in {e["code"] for e in mc.validate_word_timings(no_timing)["errors"]}
    legacy = _legacy_estimated()
    legacy["words"][0]["timing"] = "measured"
    assert "timing_not_allowed" in {e["code"] for e in mc.validate_word_timings(legacy)["errors"]}
    legacy = _legacy_estimated()
    legacy["alignment"] = document["alignment"]
    assert "alignment_not_allowed" in {e["code"] for e in mc.validate_word_timings(legacy)["errors"]}


def test_validator_recomputes_alignment_summary():
    document, _ = _align(asr=_asr_from_script(_script(), _sections(), spoken={"mundo!": None}))
    for field, value, code in (("matched_words", 99, "alignment_counts"), ("match_rate", 1.0, "alignment_match_rate"),
                               ("longest_interpolated_seconds", 3.0, "alignment_longest_run")):
        forged = copy.deepcopy(document)
        forged["alignment"][field] = value
        assert code in {e["code"] for e in mc.validate_word_timings(forged)["errors"]}, field
    forged = copy.deepcopy(document)
    next(w for w in forged["words"] if w["timing"] == "interpolated")["timing"] = "measured"
    assert not mc.validate_word_timings(forged)["ok"]    # medir uma palavra interpolada quebra as contagens


def test_committed_schema_lists_new_fields():
    schema = json.loads((Path(__file__).resolve().parents[2] / "contracts/media/word-timings.schema.json").read_text("utf-8"))
    assert "alignment" in schema["properties"]
    assert "timing" in schema["$defs"]["WordTiming"]["properties"]


# ------------------------------------------------------------------------------ runner

def test_run_alignment_reports_not_executed_without_model(tmp_path):
    result = sa.run_alignment(tmp_path / "x.wav", "a", sections=_sections(["a"]), engine=ENGINE, model_dir=tmp_path / "vazio")
    assert result["executed"] is False and result["document"] is None and result["reason"]


def test_run_alignment_rejects_unknown_model(tmp_path):
    result = sa.run_alignment(tmp_path / "x.wav", "a", sections=_sections(["a"]), engine=ENGINE, model_dir=tmp_path,
                              model_name="gigante")
    assert result["executed"] is False and "desconhecido" in result["reason"]


def test_run_alignment_reports_missing_wav(tmp_path):
    (tmp_path / "small").mkdir()
    (tmp_path / "small" / "model.bin").write_bytes(b"x")
    pytest.importorskip("faster_whisper")
    result = sa.run_alignment(tmp_path / "ausente.wav", "a", sections=_sections(["a"]), engine=ENGINE, model_dir=tmp_path)
    assert result["executed"] is False and "WAV" in result["reason"]


def test_run_alignment_failure_of_asr_process_is_explicit(tmp_path):
    pytest.importorskip("faster_whisper")
    import wave
    wav = tmp_path / "n.wav"
    with wave.open(str(wav), "wb") as handle:
        handle.setnchannels(1), handle.setsampwidth(2), handle.setframerate(16000)
        handle.writeframes(b"\0\0" * 16000)
    (tmp_path / "small").mkdir()
    (tmp_path / "small" / "model.bin").write_bytes(b"nao e um modelo")   # modelo corrompido
    result = sa.run_alignment(wav, "a", sections=_sections(["a"], 1.0), engine=ENGINE, model_dir=tmp_path, timeout=120)
    assert result["executed"] is False and "ASR falhou" in result["reason"] and result["document"] is None


# ------------------------------------------------------------------------------ ensaio real (condicional)

def _real_inputs():
    """Somente leitura: pasta dos modelos, pilot-evidence.json do piloto e o WAV de narração dele."""
    models, evidence, wav = (os.environ.get(k) for k in
                             ("HORUS_WHISPER_MODEL_DIR", "HORUS_ALIGNMENT_EVIDENCE", "HORUS_ALIGNMENT_WAV"))
    return (Path(models), Path(evidence), Path(wav)) if models and evidence and wav else None


@pytest.mark.skipif(_real_inputs() is None, reason="defina HORUS_WHISPER_MODEL_DIR, HORUS_ALIGNMENT_EVIDENCE e HORUS_ALIGNMENT_WAV")
def test_real_pilot_narration_alignment():
    pytest.importorskip("faster_whisper")
    models, evidence_file, wav = _real_inputs()
    name = os.environ.get("HORUS_WHISPER_MODEL_NAME", "small")
    if sa.resolve_model_path(models, name) is None:
        pytest.skip(f"modelo {name} ausente em {models}")
    evidence = json.loads(evidence_file.read_text("utf-8"))
    assert sa._wav_facts(wav)[0] == evidence["narration"]["sha256"]
    sections = [{"section": n, "start": s["start"], "end": s["end"]} for n, s in enumerate(evidence["scenes"], 1)]
    # O texto do roteiro de cada seção é a concatenação das cues de legenda dentro da cena (mesmos tokens do roteiro).
    texts = [" ".join(c["text"] for c in evidence["subtitles"] if s["start"] - 1e-6 <= c["start"] < s["end"] - 1e-6)
             for s in sections]
    result = sa.run_alignment(wav, "\n".join(texts), sections=sections, engine={
        "name": evidence["narration"]["engine"], "voice": evidence["narration"]["voice"]}, model_dir=models, model_name=name)
    assert result["executed"], result["reason"]
    assert mc.validate_word_timings(result["document"])["ok"]
    print(json.dumps(result["report"], ensure_ascii=False), "asr_seconds", result["asr_seconds"], file=sys.stderr)


# ------------------------------------------------------------------------------ QC: palavras interpoladas

def test_qc_subtitle_deviation_ignores_interpolated_edges_and_reports_them():
    from horus_backend import av_quality
    words = [{"text": "a", "start": 0.0, "end": 0.5, "timing": "measured"},
             {"text": "b", "start": 0.5, "end": 1.0, "timing": "interpolated"},
             {"text": "c", "start": 1.0, "end": 1.5, "timing": "measured"},
             {"text": "d", "start": 1.5, "end": 2.0, "timing": "measured"}]
    cues = [{"start": 0.0, "end": 1.0, "text": "a b"}, {"start": 1.0, "end": 2.3, "text": "c d"}]
    check = av_quality._cues_vs_words(cues, words, "measured", "forced_alignment")
    assert check["measured"]["cues_matched"] == 1 and check["measured"]["cues_edge_interpolated"] == 1
    assert check["measured"]["interpolated_words"] == 1
    assert check["measured"]["max_deviation_seconds"] == pytest.approx(0.3)   # só a cue "c d"; a cue "a b" não entra
    assert "interpolad" in check["detail"]


# ------------------------------------------------------------------------------ J-12: quebras de linha na seção

def test_join_script_flattens_inner_line_breaks_so_alignment_runs():
    texts = ["Primeira seção.", "Segunda  seção com pesquisa própria.\nAjustes da revisão anterior: nenhum.", "Fim."]
    sections = _sections(texts, 4.0)
    with pytest.raises(ValueError, match="uma linha por seção"):
        sa.align_with_report("\n".join(texts), [], sections=sections, narration_sha256=SHA, duration_seconds=12.0, engine=ENGINE)
    script = sa.join_script(texts)
    assert len(script.split("\n")) == len(texts) and "  " not in script
    document, report = _align(script, sections=sections, duration=12.0)
    assert _verdict(document, script, sections, 12.0)["speech_aligned"] is True


def test_join_script_is_identity_for_clean_text():
    assert sa.join_script(SECTION_TEXTS) == _script()
