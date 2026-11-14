"""Alinhamento de legendas (HOR-118): casos extremos. ASR sintético; sem modelo real, sem rede."""
import random

import pytest

from horus_backend import media_contracts as mc
from horus_backend import speech_alignment as sa

SHA = "c" * 64
ENGINE = {"name": "windows_sapi", "voice": "Teste"}


def sections(*spans):
    return [{"section": n, "start": a, "end": b} for n, (a, b) in enumerate(spans, 1)]


def asr(*items):
    return [{"word": w, "start": a, "end": b} for w, a, b in items]


def align(script, words, secs, duration):
    return sa.align_with_report(script, words, sections=secs, narration_sha256=SHA, duration_seconds=duration, engine=ENGINE)


def assert_sane(document, duration):
    """Monotonia, sem sobreposição e tudo dentro de [0, duração do áudio]."""
    words = document["words"]
    previous_end = 0.0
    for word in words:
        assert 0.0 <= word["start"] < word["end"] <= duration + mc.TIME_EPS, word
        assert word["start"] >= previous_end - mc.TIME_EPS, word
        previous_end = word["end"]
    assert [w["index"] for w in words] == list(range(len(words)))
    assert document["alignment"]["interpolated_words"] == sum(w["timing"] == "interpolated" for w in words)


# ------------------------------------------------------------------------------ áudio sem fala / palavras não reconhecidas

def test_silent_audio_interpolates_everything_and_is_not_speech_aligned():
    document, report = align("um dois três\nquatro cinco", [], sections((0, 3), (3, 5)), 5.0)
    assert_sane(document, 5.0)
    assert {w["timing"] for w in document["words"]} == {"interpolated"}
    assert document["alignment"]["match_rate"] == 0.0 and report["speech_aligned"] is False


def test_unrecognized_words_are_interpolated_never_measured():
    heard = asr(("um", 0.2, 0.5), ("xxxx", 0.6, 0.9), ("tres", 1.6, 1.9))
    document, _ = align("um dois tres", heard, sections((0, 3)), 3.0)
    assert_sane(document, 3.0)
    assert [w["timing"] for w in document["words"]] == ["measured", "interpolated", "measured"]
    middle = document["words"][1]
    assert document["words"][0]["end"] <= middle["start"] and middle["end"] <= document["words"][2]["start"]


def test_interpolation_at_start_and_end_stays_inside_the_section():
    heard = asr(("dois", 1.0, 1.4), ("tres", 1.5, 1.9))
    document, _ = align("um dois tres quatro", heard, sections((0, 3)), 3.0)
    assert_sane(document, 3.0)
    first, last = document["words"][0], document["words"][-1]
    assert first["timing"] == last["timing"] == "interpolated"
    assert first["start"] >= 0.0 and first["end"] <= document["words"][1]["start"]
    assert last["start"] >= document["words"][2]["end"] and last["end"] <= 3.0


# ------------------------------------------------------------------------------ números, siglas, pontuação, repetição

def test_numbers_acronyms_and_punctuation_match_spoken_forms():
    script = 'Em 2026, o "IA" subiu 15% (R$ 1.200,50)!'
    spoken = "em dois mil e vinte e seis o ia subiu quinze por cento r cifrão".split()
    heard = [{"word": w, "start": round(0.1 + i * 0.3, 3), "end": round(0.1 + i * 0.3 + 0.25, 3)} for i, w in enumerate(spoken)]
    document, _ = align(script, heard, sections((0, 9)), 9.0)
    assert_sane(document, 9.0)
    by_text = {w["text"]: w["timing"] for w in document["words"]}
    assert by_text["2026,"] == "measured" and by_text["15%"] == "measured" and by_text['"IA"'] == "measured"


def test_expand_handles_odd_tokens_without_raising():
    for token in ("", "---", "%", "1.2.3", "1,2,3", "000", "999999999999999999999", "٣٤", "ÀÉÎ", "a-b-c", "3,"):
        assert isinstance(sa.expand(token), list)
    assert sa.expand("0,05") == ["zero", "virgula", "zero", "cinco"]
    assert sa.number_words(10 ** 9) is None and sa.number_words(-1) is None


def test_repeated_words_keep_order_and_timing_monotonic():
    script = "não não não vai não"
    heard = asr(("não", 0.1, 0.3), ("não", 0.4, 0.6), ("não", 0.7, 0.9), ("vai", 1.0, 1.3), ("não", 1.4, 1.7))
    document, report = align(script, heard, sections((0, 2)), 2.0)
    assert_sane(document, 2.0)
    assert [w["timing"] for w in document["words"]] == ["measured"] * 5 and report["speech_aligned"] is True
    assert [w["start"] for w in document["words"]] == sorted(w["start"] for w in document["words"])


def test_repeated_word_missing_in_asr_does_not_steal_the_next_occurrence():
    heard = asr(("sim", 0.1, 0.4), ("agora", 1.0, 1.4))
    document, _ = align("sim sim agora", heard, sections((0, 2)), 2.0)
    assert_sane(document, 2.0)
    assert [w["timing"] for w in document["words"]].count("measured") == 2
    assert document["words"][2]["start"] >= 1.0 - mc.TIME_EPS


# ------------------------------------------------------------------------------ seções vazias, de uma palavra, longas

def test_empty_middle_section_is_allowed():
    document, _ = align("um dois\n\ntres", [], sections((0, 2), (2, 3), (3, 5)), 5.0)
    assert_sane(document, 5.0)
    assert [w["section"] for w in document["words"]] == [1, 1, 3]


def test_one_word_section_gets_a_real_span():
    heard = asr(("oi", 0.1, 0.4))
    document, _ = align("oi\num dois", heard, sections((0, 1), (1, 3)), 3.0)
    assert_sane(document, 3.0)
    assert document["words"][0]["timing"] == "measured" and document["words"][0]["section"] == 1


def test_script_without_words_or_with_wrong_line_count_is_refused():
    with pytest.raises(ValueError):
        align("\n", [], sections((0, 1), (1, 2)), 2.0)
    with pytest.raises(ValueError):
        align("um\ndois\ntres", [], sections((0, 1), (1, 2)), 2.0)


def test_section_too_short_for_its_words_is_refused_not_invalid_output():
    with pytest.raises(ValueError):
        align(" ".join(["palavra"] * 50), [], sections((0, 0.5)), 0.5)


def test_very_long_script_is_refused_by_the_dp_cap_or_aligned_without_hanging():
    words = ["palavra"] * 1500
    document, _ = align(" ".join(words), [{"word": "palavra", "start": i * 0.2, "end": i * 0.2 + 0.15} for i in range(1500)],
                        sections((0, 400)), 400.0)
    assert_sane(document, 400.0)
    huge = ["w" + str(i) for i in range(2600)]
    with pytest.raises(ValueError):
        align(" ".join(huge), [{"word": w, "start": i * 0.01, "end": i * 0.01 + 0.005} for i, w in enumerate(huge)],
              sections((0, 60)), 60.0)


# ------------------------------------------------------------------------------ timings do ASR inválidos

def test_clean_asr_words_drops_invalid_non_monotonic_and_clips_to_duration():
    raw = [{"word": "a", "start": 0.0, "end": 0.5}, {"word": "b", "start": 0.4, "end": 0.9},     # sobreposição aparada
           {"word": "c", "start": 0.2, "end": 0.3},                                              # regride: descartada
           {"word": "d", "start": float("nan"), "end": 1.0}, {"word": "e", "start": 1.0, "end": 1.0},
           {"word": " ", "start": 1.0, "end": 1.2}, {"word": "f", "start": -1.0, "end": 0.5},
           {"word": "g", "start": 1.5, "end": 99.0}, {"word": "h", "start": 50.0, "end": 51.0}, "lixo", None,
           {"word": 7, "start": 1.0, "end": 2.0}, {"word": "i", "start": True, "end": 2.0}]
    kept = sa.clean_asr_words(raw, 2.0)
    assert [w["text"] for w in kept] == ["a", "b", "g"]
    assert kept[1]["start"] >= kept[0]["end"] and kept[-1]["end"] == 2.0


def test_non_monotonic_overlapping_asr_still_yields_a_valid_document():
    heard = asr(("tres", 2.0, 2.5), ("um", 0.1, 0.5), ("dois", 0.5, 0.4), ("dois", 0.45, 0.9), ("tres", 0.9, 1.2))
    document, _ = align("um dois tres", heard, sections((0, 3)), 3.0)
    assert_sane(document, 3.0)


def test_asr_beyond_audio_duration_is_clamped():
    heard = asr(("um", 0.1, 0.4), ("dois", 0.5, 7.0))
    document, _ = align("um dois", heard, sections((0, 2)), 2.0)
    assert_sane(document, 2.0)


def test_sections_ending_after_audio_or_slightly_overlapping_do_not_break_alignment():
    # Última seção termina 40 ms depois do áudio; a segunda começa 40 ms antes de a primeira terminar.
    document, _ = align("um dois\ntres quatro", [], sections((0, 3.0), (2.96, 6.04)), 6.0)
    assert_sane(document, 6.0)


# ------------------------------------------------------------------------------ propriedade (fuzz determinístico)

@pytest.mark.parametrize("seed", range(40))
def test_random_alignment_is_always_monotonic_bounded_and_valid(seed):
    rng = random.Random(seed)
    vocabulary = ["um", "dois", "três", "casa", "2026", "ONU", "não", "sim", "50%", "guarda-chuva", "Olá,", "fim."]
    lines = [" ".join(rng.choice(vocabulary) for _ in range(rng.randint(0, 9))) for _ in range(rng.randint(1, 4))]
    if not any(lines):
        lines[0] = "um"
    duration = round(sum(max(len(line.split()), 1) * rng.uniform(0.3, 0.6) for line in lines), 2)
    secs, cursor = [], 0.0
    for number, line in enumerate(lines, 1):
        length = max(len(line.split()), 1) * duration / max(sum(max(len(l.split()), 1) for l in lines), 1)
        secs.append({"section": number, "start": round(cursor, 3), "end": round(cursor + length, 3)})
        cursor += length
    secs[-1]["end"] = round(min(secs[-1]["end"] + rng.choice([0, 0.03, -0.01]), duration + 0.04), 3)
    heard = []
    for number, line in enumerate(lines):
        position = secs[number]["start"]
        for token in line.split():
            roll = rng.random()
            if roll < 0.25:
                position += rng.uniform(0.1, 0.3)
                continue
            start = round(position + rng.uniform(-0.05, 0.1), 3)
            heard.append({"word": token if roll < 0.9 else token[::-1], "start": start,
                          "end": round(start + rng.uniform(-0.05, 0.4), 3)})
            position += 0.3
    rng.shuffle(heard) if seed % 5 == 0 else None
    try:
        document, _ = align("\n".join(lines), heard, secs, duration)
    except ValueError:
        return          # recusa explícita (seção curta demais etc.) é aceitável; saída inválida ou RuntimeError, não
    assert_sane(document, duration)
    verdict = mc.validate_word_timings(document, narration_sha256=SHA, duration_seconds=duration,
                                       script_text="\n".join(lines),
                                       sections=[{"section": s["section"], "start": s["start"], "end": s["end"]} for s in secs])
    assert verdict["ok"], verdict["errors"][:3]
