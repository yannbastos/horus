"""QC audiovisual (HOR-118): casos de borda e testes negativos. Sem rede; ffprobe/ffmpeg substituídos por respostas fixas."""
import json
import struct
import wave

import pytest

import test_av_quality as base
from horus_backend import av_quality as qc
from horus_backend import media_contracts as mc
from horus_backend import pilot_quality as pq

RATE = base.RATE
FOLDER = "canais/demo/videos/fixture/"


def narration_seconds(evidence):
    return evidence["narration"]["duration_seconds"]


def fake_probe(monkeypatch, result):
    async def probe(ffprobe, video, timeout):
        return result
    monkeypatch.setattr(qc, "_probe", probe)


def probe_doc(evidence, *, audio=True, video=True, audio_seconds=None, width=None, height=None, fps="30/1", container=None):
    narration = narration_seconds(evidence)
    declared = evidence["video"]
    streams = []
    if video:
        stream = {"codec_type": "video", "avg_frame_rate": fps}
        stream["width"] = declared["width"] if width is None else width
        stream["height"] = declared["height"] if height is None else height
        streams.append(stream)
    if audio:
        streams.append({"codec_type": "audio", "duration": str(narration if audio_seconds is None else audio_seconds)})
    fmt = declared["duration_seconds"] if container is None else container
    return {"format": {"duration": str(fmt)}, "streams": streams}


def run_with_probe(root, monkeypatch, result):
    fake_probe(monkeypatch, result)
    report = qc.run_quality(root, production_id="prod1", ffmpeg=None, ffprobe=None)
    assert mc.validate_quality_report(report, production_id="prod1")["ok"]
    return report, {c["id"]: c for c in report["checks"]}


def retarget_narration(root, evidence, data):
    """Troca o WAV concatenado e refaz hash no manifesto, como se o arquivo defeituoso tivesse sido o registrado."""
    wav = root / FOLDER / "fixture.wav"
    wav.write_bytes(data)
    digest = base.sha(wav)
    evidence["narration"]["sha256"] = digest
    for asset in evidence["assets"]:
        if asset["id"] == "narration":
            asset["sha256"] = digest
    (root / "pilot-evidence.json").write_text(json.dumps(evidence), encoding="utf-8")


# ------------------------------------------------------------------------------ arquivo truncado / ilegível

def test_truncated_narration_wav_fails_instead_of_skipping(tmp_path):
    root, evidence = base.build(tmp_path)
    original = (root / FOLDER / "fixture.wav").read_bytes()
    retarget_narration(root, evidence, original[: len(original) // 2])
    report, checks = base.run(root)
    assert report["status"] == "fail"
    assert checks["audio_level"]["status"] == "fail" and "truncado" in checks["audio_level"]["detail"]
    assert checks["duration_narration"]["status"] == "fail"
    assert "audio_level" in report["blocking_errors"]


def test_garbage_narration_wav_fails(tmp_path):
    root, evidence = base.build(tmp_path)
    retarget_narration(root, evidence, b"isto nao e um wav")
    report, checks = base.run(root)
    assert report["status"] == "fail" and checks["audio_level"]["status"] == "fail"


def test_non_pcm16_narration_stays_skipped_with_reason(tmp_path):
    root, evidence = base.build(tmp_path)
    path = root / FOLDER / "fixture.wav"
    with wave.open(str(path), "wb") as handle:           # PCM 8 bits: legível, mas fora do que o QC mede
        handle.setnchannels(1)
        handle.setsampwidth(1)
        handle.setframerate(RATE)
        handle.writeframes(b"\x80" * int(RATE * 6))
    retarget_narration(root, evidence, path.read_bytes())
    _, checks = base.run(root)
    assert checks["audio_level"]["status"] == "skipped" and "PCM" in checks["audio_level"]["detail"]


def test_ffprobe_rejecting_the_mp4_fails_the_duration_check(tmp_path, monkeypatch):
    root, _ = base.build(tmp_path)
    report, checks = run_with_probe(root, monkeypatch, (None, f"{qc.PROBE_REJECTED}: moov atom not found"))
    assert checks["duration_video_audio"]["status"] == "fail" and "moov" in checks["duration_video_audio"]["detail"]
    assert report["status"] == "fail"


def test_ffprobe_timeout_is_not_a_verdict_on_the_file(tmp_path, monkeypatch):
    root, _ = base.build(tmp_path)
    _, checks = run_with_probe(root, monkeypatch, (None, "ffprobe falhou: timeout de 180s"))
    assert checks["duration_video_audio"]["status"] == "skipped"


# ------------------------------------------------------------------------------ vídeo x áudio x manifesto

def test_probe_consistent_with_manifest_passes(tmp_path, monkeypatch):
    root, evidence = base.build(tmp_path)
    _, checks = run_with_probe(root, monkeypatch, (probe_doc(evidence), ""))
    assert checks["duration_video_audio"]["status"] == "pass" and checks["video_format"]["status"] == "pass"


def test_mp4_without_audio_track_fails(tmp_path, monkeypatch):
    root, evidence = base.build(tmp_path)
    _, checks = run_with_probe(root, monkeypatch, (probe_doc(evidence, audio=False), ""))
    assert checks["duration_video_audio"]["status"] == "fail" and "sem faixa de áudio" in checks["duration_video_audio"]["detail"]


def test_mp4_without_video_track_fails(tmp_path, monkeypatch):
    root, evidence = base.build(tmp_path)
    _, checks = run_with_probe(root, monkeypatch, (probe_doc(evidence, video=False), ""))
    assert checks["duration_video_audio"]["status"] == "fail" and "sem faixa de vídeo" in checks["duration_video_audio"]["detail"]
    assert "video_format" not in checks


def test_audio_track_shorter_than_narration_fails_even_when_container_is_right(tmp_path, monkeypatch):
    root, evidence = base.build(tmp_path)
    _, checks = run_with_probe(root, monkeypatch, (probe_doc(evidence, audio_seconds=narration_seconds(evidence) - 1.0), ""))
    assert checks["duration_video_audio"]["status"] == "fail" and "áudio cortado" in checks["duration_video_audio"]["detail"]


def test_audio_track_padded_to_video_length_is_accepted(tmp_path, monkeypatch):
    root, evidence = base.build(tmp_path)
    padded = evidence["video"]["duration_seconds"]
    _, checks = run_with_probe(root, monkeypatch, (probe_doc(evidence, audio_seconds=padded), ""))
    assert checks["duration_video_audio"]["status"] == "pass"


@pytest.mark.parametrize("container,expected", [(6.9, "pass"), (6.7, "pass"), (7.0, "fail"), (6.0, "fail")])
def test_container_tail_tolerance_boundary(tmp_path, monkeypatch, container, expected):
    root, evidence = base.build(tmp_path)       # manifesto declara 6,0 s de fala + 0,8 s de cauda = 6,8 s
    _, checks = run_with_probe(root, monkeypatch, (probe_doc(evidence, container=container), ""))
    assert checks["duration_video_audio"]["status"] == expected


def test_wrong_resolution_or_fps_fails_video_format(tmp_path, monkeypatch):
    root, evidence = base.build(tmp_path)
    _, checks = run_with_probe(root, monkeypatch, (probe_doc(evidence, width=1080, height=1920), ""))
    assert checks["video_format"]["status"] == "fail" and "1080x1920" in checks["video_format"]["detail"]
    _, checks = run_with_probe(root, monkeypatch, (probe_doc(evidence, fps="24/1"), ""))
    assert checks["video_format"]["status"] == "fail" and "fps" in checks["video_format"]["detail"]
    _, checks = run_with_probe(root, monkeypatch, (probe_doc(evidence, fps="30000/1001"), ""))
    assert checks["video_format"]["status"] == "pass"           # 29,97 fps está dentro da tolerância


def test_video_format_without_dimensions_is_not_invented(tmp_path, monkeypatch):
    root, evidence = base.build(tmp_path)
    doc = probe_doc(evidence)
    del doc["streams"][0]["width"], doc["streams"][0]["height"]
    _, checks = run_with_probe(root, monkeypatch, (doc, ""))
    assert "video_format" not in checks


# ------------------------------------------------------------------------------ áudio: silêncio, clipping, loudness

def pcm(values):
    return struct.pack(f"<{len(values)}h", *values)


def test_leading_silence_above_limit_warns_as_edge(tmp_path):
    root, _ = base.build(tmp_path, sections=[base.tone(2.0, silence=1.8), base.tone(2.0), base.tone(2.0)])
    _, checks = base.run(root)
    assert checks["audio_silence"]["status"] == "warn" and checks["audio_silence"]["measured"]["edge_count"] == 1


def test_trailing_silence_above_limit_warns_as_edge(tmp_path):
    tail = base.tone(0.5) + pcm([0] * int(RATE * 1.6))
    root, _ = base.build(tmp_path, sections=[base.tone(2.0), base.tone(2.0), tail])
    _, checks = base.run(root)
    assert checks["audio_silence"]["status"] == "warn" and checks["audio_silence"]["measured"]["edge_count"] == 1


def test_edge_silence_below_limit_does_not_warn(tmp_path):
    root, _ = base.build(tmp_path, sections=[base.tone(2.0, silence=1.2), base.tone(2.0), base.tone(2.0)])
    _, checks = base.run(root)
    assert checks["audio_silence"]["status"] == "pass"


def test_clipping_threshold_is_strictly_greater_than_fraction(tmp_path):
    total = int(RATE * 2.0)
    allowed = int(pq.CLIP_FRACTION * total * 3)            # 3 seções de 2 s: limite sobre as amostras do WAV concatenado

    def section(clipped):
        return pcm([32767] * clipped + [3000] * (total - clipped))

    root, _ = base.build(tmp_path / "a", sections=[section(allowed), base.tone(2.0), base.tone(2.0)])
    assert base.run(root)[1]["audio_clipping"]["status"] == "pass"
    root, _ = base.build(tmp_path / "b", sections=[section(allowed + 20), base.tone(2.0), base.tone(2.0)])
    assert base.run(root)[1]["audio_clipping"]["status"] == "fail"


def test_negative_full_scale_counts_as_clipping(tmp_path):
    total = int(RATE * 2.0)
    loud = pcm([-32768] * 1000 + [3000] * (total - 1000))
    root, _ = base.build(tmp_path, sections=[loud, base.tone(2.0), base.tone(2.0)])
    assert base.run(root)[1]["audio_clipping"]["status"] == "fail"


@pytest.mark.parametrize("lufs,peak,status", [
    (-26.0, -1.0, "pass"), (-12.0, -1.0, "pass"), (-26.1, -1.0, "warn"), (-11.9, -1.0, "warn"),
    (-16.0, -0.9, "warn"), (-16.0, None, "pass"), (None, None, "warn")])
def test_loudness_thresholds_are_inclusive_and_never_move(lufs, peak, status):
    assert qc._loudness_check(lufs, peak, None, "ffmpeg_ebur128")["status"] == status
    assert qc.LUFS_RANGE == (-26.0, -12.0) and qc.TRUE_PEAK_MAX == -1.0


def test_num_rejects_inf_nan_and_text():
    assert qc._num("-inf") is None and qc._num("nan") is None and qc._num("x") is None and qc._num(None) is None
    assert qc._num("-23.5") == -23.5


# ------------------------------------------------------------------------------ legendas

def srt(*blocks):
    return "\n".join(f"{i}\n{a} --> {b}\n{t}\n" for i, (a, b, t) in enumerate(blocks, 1))


def test_parse_srt_accepts_crlf_dot_millis_and_multiline_text():
    text = srt(("00:00:01.000", "00:00:02,500", "linha um\nlinha dois")).replace("\n", "\r\n")
    cues = qc.parse_srt(text)
    assert cues == [{"start": 1.0, "end": 2.5, "text": "linha um linha dois"}]


@pytest.mark.parametrize("text", ["1\nsem tempo\ntexto\n", "1\n00:00:01,000 --> \ntexto\n", "texto solto"])
def test_parse_srt_rejects_blocks_without_timing(text):
    assert qc.parse_srt(text) is None


def test_cue_with_empty_text_never_crashes_the_word_check(tmp_path):
    root, _ = base.build(tmp_path, words=base.word_doc())
    path = root / FOLDER / "fixture.srt"
    path.write_text(path.read_text(encoding="utf-8") + "\n99\n00:00:05,000 --> 00:00:05,500\n", encoding="utf-8")
    report, checks = base.run(root)
    assert checks["subtitles_vs_words"]["status"] == "fail"
    assert report["status"] == "fail"


def cue(start, end, text="oi"):
    return {"start": start, "end": end, "text": text}


SCENES = [{"id": "c1", "start": 0.0, "end": 2.0}, {"id": "c2", "start": 2.0, "end": 4.0}]


@pytest.mark.parametrize("cues,status", [
    ([cue(0.0, 1.0), cue(2.0, 3.0)], "pass"),
    ([cue(1.0, 1.0)], "fail"),                                 # duração zero
    ([cue(1.0, 0.5)], "fail"),                                 # fim antes do início
    ([cue(0.0, 1.5), cue(1.0, 2.0)], "fail"),                  # sobreposição
    ([cue(0.0, 1.0), cue(3.5, 4.5)], "fail"),                  # passa do fim da última cena
    ([cue(1.5, 2.5)], "fail"),                                 # cruza duas cenas
    ([cue(1.0, 2.04)], "pass"),                                # dentro da tolerância de 50 ms
])
def test_cues_vs_sections_cases(cues, status):
    assert qc._cues_vs_sections(cues, SCENES)["status"] == status


def test_coverage_is_not_dragged_by_a_dropped_word_that_reappears_later():
    script = "a b de d e f g h i j".split()
    shown = [cue(0, 1, "a b d e f g h i j de")]
    result = qc._coverage(shown, script)
    assert result["measured"]["coverage"] == 0.9 and result["status"] == "warn"    # 9/10: a palavra perdida é sinalizada, sem arrasto


def test_coverage_thresholds_do_not_move():
    assert (qc.COVERAGE_WARN, qc.COVERAGE_FAIL) == (0.98, 0.90) and (qc.SYNC_WARN, qc.SYNC_FAIL) == (0.30, 1.00)


def test_coverage_ignores_punctuation_and_case_and_skips_empty_script():
    assert qc._coverage([cue(0, 1, "OLÁ, mundo!")], ["olá", "mundo"])["status"] == "pass"
    assert qc._coverage([cue(0, 1, "oi")], ["—", "..."])["status"] == "skipped"


def test_coverage_huge_text_uses_windowed_fallback_without_hanging():
    words = [f"w{i}" for i in range(4000)]
    result = qc._coverage([cue(0, 1, " ".join(words))], words)
    assert result["status"] == "pass"


# ------------------------------------------------------------------------------ manifesto (pilot_quality)

def valid_evidence(tmp_path):
    return base.build(tmp_path)[1]


@pytest.mark.parametrize("mutate,expected", [
    (lambda e: e["video"].update(duration_seconds=float("inf")), "video"),
    (lambda e: e["video"].update(frames=True), "video"),
    (lambda e: e["video"].update(width=10 ** 9), "video"),
    (lambda e: e["video"].update(frames=10_000_000, duration_seconds=1.0), "video"),      # fps implícito absurdo
    (lambda e: e["scenes"][1].update(start=e["scenes"][1]["start"] + 0.5), "scene_contiguity"),   # lacuna
    (lambda e: e["scenes"][1].update(start=e["scenes"][1]["start"] - 0.5), "scene_contiguity"),   # sobreposição
    (lambda e: e["narration"].update(duration_seconds=float("nan")), "narration"),
    (lambda e: e["assets"][0].update(relative_path="../fora.png"), "assets_paths"),
    (lambda e: e["assets"][0].update(relative_path="C:/Windows/x.png"), "assets_paths"),
    (lambda e: e["assets"][0].update(relative_path="canais\\demo\\x.png"), "assets_paths"),
    (lambda e: e["assets"][0].update(sha256="Z" * 64), "assets_hashes"),
    (lambda e: e["assets"][0].update(attribution="x\x00y"), "assets_structure"),
    (lambda e: e["subtitles"][0].update(text="a --> b"), "subtitles_structure"),
    (lambda e: e["subtitles"].append(dict(e["subtitles"][-1], start=0.0, end=100.0)), "subtitles_timing"),
])
def test_invalid_manifests_are_blocked(tmp_path, mutate, expected):
    evidence = valid_evidence(tmp_path)
    mutate(evidence)
    verdict = pq.validate_pilot_evidence(evidence)
    failing = {c["id"] for c in verdict["checks"] if c["status"] == "fail"}
    assert expected in failing and verdict["publishable"] is False


def test_hostile_manifest_shapes_never_raise():
    for hostile in (None, [], "x", 3, {"schema_version": 1}, {"narration": []}):
        assert pq.validate_pilot_evidence(hostile)["publishable"] is False


def test_analyze_wav_rejects_truncated_and_reports_stereo(tmp_path):
    path = tmp_path / "t.wav"
    base.write_wav(path, base.tone(1.0))
    path.write_bytes(path.read_bytes()[:-2000])
    with pytest.raises(ValueError):
        pq.analyze_wav(path)
    stereo = tmp_path / "s.wav"
    with wave.open(str(stereo), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(pcm([0, 20000] * RATE))        # só o canal direito soa: o pico considera todos os canais
    stats = pq.analyze_wav(stereo)
    assert stats["channels"] == 2 and stats["peak"] > 0.5 and stats["silences"] == []


def test_gray_png_decoder_rejects_garbage():
    assert qc._gray_pngs(b"") == [] and qc._gray_pngs(b"lixo" * 10) == []
    assert qc._gray_pngs(bytes([0x89]) + b"PNG\r\n\x1a\n" + b"\x00\x00") == []
