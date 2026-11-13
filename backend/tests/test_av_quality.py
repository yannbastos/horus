"""QC audiovisual: WAV/SRT sintéticos gerados no teste; sem rede, sem FFmpeg obrigatório."""
import asyncio
import hashlib
import json
import math
import os
import struct
import sys
import wave
from pathlib import Path

import pytest

from horus_backend import av_quality as qc
from horus_backend import media_contracts as mc

RATE = 22050
SECTION_TEXT = ["um dois tres quatro cinco seis", "sete oito nove dez onze doze", "treze catorze quinze dezesseis dezessete dezoito"]


def tone(seconds, amplitude=0.3, silence=0.0):
    frames = []
    for i in range(int(seconds * RATE)):
        frames.append(0 if i / RATE < silence else int(32767 * amplitude * math.sin(2 * math.pi * 220 * i / RATE)))
    return struct.pack(f"<{len(frames)}h", *frames)


def write_wav(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(data)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def stamp(value):
    ms = round(value * 1000)
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def build(tmp_path, *, sections=None, srt_shift=0.0, tail=0.8, plan=True, words=None):
    """Produção sintética no layout do piloto local. `sections`: bytes PCM por seção."""
    root = tmp_path / "prod"
    folder = root / "canais/demo/videos/fixture"
    sections = sections or [tone(2.0), tone(2.0), tone(2.0)]
    scenes, cues, cursor, assets, all_pcm = [], [], 0.0, [], b""
    for n, (pcm, text) in enumerate(zip(sections, SECTION_TEXT), 1):
        write_wav(folder / f"section-{n}.wav", pcm)
        (folder / f"scene-{n}.png").write_bytes(b"png" + bytes([n]))
        duration = len(pcm) / 2 / RATE
        scenes.append({"id": f"c{n}", "start": cursor, "end": cursor + duration, "asset_id": f"scene-{n}"})
        tokens = text.split()
        for i in range(0, len(tokens), 3):
            part = tokens[i:i + 3]
            a = cursor + duration * i / len(tokens)
            b = cursor + duration * (i + len(part)) / len(tokens)
            cues.append((a + srt_shift, b + srt_shift, " ".join(part)))
        cursor += duration
        all_pcm += pcm
    write_wav(folder / "fixture.wav", all_pcm)
    (folder / "fixture.srt").write_text("\n".join(f"{i}\n{stamp(a)} --> {stamp(b)}\n{t}\n" for i, (a, b, t) in enumerate(cues, 1)),
                                        encoding="utf-8")
    video = root / "canais/demo/videos/fixture/render/short-rascunho.mp4"
    video.parent.mkdir(parents=True, exist_ok=True)
    video.write_bytes(b"not-a-real-mp4")
    rel = lambda p: Path(p).relative_to(root).as_posix()  # noqa: E731
    for n in range(1, 4):
        assets.append({"id": f"scene-{n}", "relative_path": rel(folder / f"scene-{n}.png"), "sha256": sha(folder / f"scene-{n}.png"),
                       "origin": "original_local", "license": "original", "attribution": "Cena original local.",
                       "generated_at": "2026-11-13T10:00:00Z"})
        assets.append({"id": f"section-{n}", "relative_path": rel(folder / f"section-{n}.wav"), "sha256": sha(folder / f"section-{n}.wav"),
                       "origin": "system_voice", "license": "unverified", "attribution": "Voz SAPI local.",
                       "generated_at": "2026-11-13T10:00:00Z"})
    assets.append({"id": "narration", "relative_path": rel(folder / "fixture.wav"), "sha256": sha(folder / "fixture.wav"),
                   "origin": "system_voice", "license": "unverified", "attribution": "Voz SAPI local.",
                   "generated_at": "2026-11-13T10:00:00Z"})
    evidence = {"schema_version": 1, "demo_only": True, "alignment_method": "measured_sections",
                "narration": {"kind": "local_tts", "engine": "windows_sapi", "voice": "Maria", "duration_seconds": cursor,
                              "sha256": sha(folder / "fixture.wav")},
                "scenes": scenes, "subtitles": [{"start": a - srt_shift, "end": b - srt_shift, "text": t} for a, b, t in cues], "assets": assets,
                "video": {"duration_seconds": cursor + tail, "width": 540, "height": 960, "frames": round((cursor + tail) * 30)}}
    (root / "pilot-evidence.json").write_text(json.dumps(evidence), encoding="utf-8")
    if plan:
        lines = [{"n": n, "narracao": t, "visual": "v", "duracao_estimada": 2.0} for n, t in enumerate(SECTION_TEXT, 1)]
        (root / "plan.json").write_text(json.dumps({"roteiro": {"linhas": lines}}), encoding="utf-8")
    if words is not None:
        (root / "word-timings.json").write_text(json.dumps(words(scenes, cursor, sha(folder / "fixture.wav"))), encoding="utf-8")
    return root, evidence


def word_doc(source="tts_engine_events", shift=0.0):
    def make(scenes, duration, narration_sha):
        out, index, offset = [], 0, 0
        text = " ".join(SECTION_TEXT)
        for n, (scene, section) in enumerate(zip(scenes, SECTION_TEXT), 1):
            tokens = section.split()
            length = scene["end"] - scene["start"]
            for i, token in enumerate(tokens):
                start = scene["start"] + length * i / len(tokens) + shift
                end = scene["start"] + length * (i + 1) / len(tokens) + shift - 0.001
                position = text.index(token, offset)
                out.append({"index": index, "text": token, "section": n, "start": start, "end": min(end, duration),
                            "char_offset": position, "char_length": len(token)})
                index, offset = index + 1, position + len(token)
        return {"schema_version": 1, "narration_sha256": narration_sha, "duration_seconds": duration, "source": source,
                "engine": {"name": "windows_sapi", "voice": "Maria"}, "words": out}
    return make


def run(root, **kwargs):
    report = qc.run_quality(root, production_id="prod1", ffmpeg=None, ffprobe=None, **kwargs)
    assert mc.validate_quality_report(report, production_id="prod1")["ok"]
    return report, {c["id"]: c for c in report["checks"]}


def test_happy_path_is_valid_without_ffmpeg(tmp_path):
    root, _ = build(tmp_path)
    report, checks = run(root)
    assert report["status"] == "warn" and report["blocking_errors"] == []
    assert report["video_sha256"] == sha(root / "canais/demo/videos/fixture/render/short-rascunho.mp4")
    assert checks["asset_hashes"]["status"] == "pass" and checks["audio_clipping"]["status"] == "pass"
    assert checks["subtitles_vs_sections"]["status"] == "pass" and checks["script_coverage"]["status"] == "pass"
    assert checks["asset_provenance"]["status"] == "warn" and checks["asset_provenance"]["method"] == "declared"
    for skipped in ("duration_video_audio", "audio_loudness", "visual_black_frames", "visual_freeze", "word_timings", "subtitles_vs_words"):
        assert checks[skipped]["status"] == "skipped" and checks[skipped]["detail"]
    assert all(c["method"] != "measured" or c["status"] == "skipped" or c["measured"].get("source") for c in report["checks"])


@pytest.mark.parametrize('broken',[False,True])
def test_local_model_uses_same_physical_qc_and_requires_provenance(tmp_path,broken):
    root, evidence = build(tmp_path)
    synthesis = {'engine':'piper','voice':'Modelo fictício','voice_id':'pt.onnx',
                 'origin':'local_tts_model',
                 'model':{'id':'pt.onnx','version':'1','sha256':'a'*64}}
    evidence['narration'].update(synthesis)
    for asset in evidence['assets']:
        if asset['origin'] == 'system_voice':
            asset.update(origin='local_tts_model',narration=synthesis.copy())
    if broken:
        evidence['narration']['model'].pop('sha256')
    (root/'pilot-evidence.json').write_text(json.dumps(evidence),encoding='utf-8')
    report, checks = run(root)
    assert checks['evidence_manifest']['status'] == ('fail' if broken else 'pass')
    if not broken:
        assert report['blocking_errors'] == []
        assert checks['audio_clipping']['status'] == 'pass'
        assert checks['duration_narration']['method'] == 'measured'


def test_clipping_fails_with_timecode_free_counts(tmp_path):
    loud = struct.pack("<%dh" % (2 * RATE), *([32767, -32768] * RATE))
    root, _ = build(tmp_path, sections=[tone(2.0), loud, tone(2.0)])
    report, checks = run(root)
    assert checks["audio_clipping"]["status"] == "fail" and "audio_clipping" in report["blocking_errors"] and report["status"] == "fail"


def test_mute_audio_fails(tmp_path):
    root, _ = build(tmp_path, sections=[tone(2.0, 0.0001)] * 3)
    _, checks = run(root)
    assert checks["audio_level"]["status"] == "fail"


def test_long_silence_warns_with_timecode(tmp_path):
    root, _ = build(tmp_path, sections=[tone(2.0), tone(6.0, silence=3.5), tone(2.0)])
    _, checks = run(root)
    silence = checks["audio_silence"]
    assert silence["status"] == "warn" and silence["measured"]["longest_seconds"] >= 3.0
    assert abs(silence["timecode"]["start"] - 2.0) < 0.05 and abs(silence["timecode"]["end"] - 5.5) < 0.05


def test_wrong_hash_fails(tmp_path):
    root, _ = build(tmp_path)
    (root / "canais/demo/videos/fixture/scene-2.png").write_bytes(b"tampered")
    report, checks = run(root)
    assert checks["asset_hashes"]["status"] == "fail" and "scene-2" in checks["asset_hashes"]["detail"]
    assert "asset_hashes" in report["blocking_errors"]


def test_subtitles_out_of_section_fail(tmp_path):
    root, _ = build(tmp_path, srt_shift=1.2)
    _, checks = run(root)
    assert checks["subtitles_vs_sections"]["status"] == "fail" and checks["subtitles_vs_sections"]["timecode"]


def test_declared_duration_divergence_fails(tmp_path):
    root, evidence = build(tmp_path, tail=2.0)
    _, checks = run(root)
    assert checks["evidence_manifest"]["status"] == "fail" and "duration_consistency" in checks["evidence_manifest"]["detail"]
    assert checks["duration_narration"]["status"] == "skipped" or checks["duration_narration"]["status"] == "pass"


def test_section_wav_diverging_from_scene_fails(tmp_path):
    root, evidence = build(tmp_path)
    folder = root / "canais/demo/videos/fixture"
    write_wav(folder / "section-1.wav", tone(2.5))                 # diverge da cena e do hash
    _, checks = run(root)
    assert checks["asset_hashes"]["status"] == "fail" and checks["duration_narration"]["status"] == "fail"


def test_word_timings_absent_skips_but_sections_measured(tmp_path):
    root, _ = build(tmp_path)
    _, checks = run(root)
    assert "ausente" in checks["subtitles_vs_words"]["detail"]
    assert checks["subtitles_vs_sections"]["method"] == "measured" and checks["subtitles_vs_sections"]["status"] == "pass"


def test_word_timings_measured_sync_pass_and_desync_fail(tmp_path):
    root, _ = build(tmp_path, words=word_doc())
    _, checks = run(root)
    assert checks["word_timings"]["status"] == "pass" and checks["subtitles_vs_words"]["status"] == "pass"
    assert checks["subtitles_vs_words"]["measured"]["max_deviation_seconds"] < 0.05
    root2, _ = build(tmp_path / "b", words=word_doc(shift=0.5))
    _, checks2 = run(root2)
    # deslocar 0,5 s empurra palavras para fora da seção ou gera desvio acima de 0,3 s: nunca passa
    assert checks2["word_timings"]["status"] == "fail" or checks2["subtitles_vs_words"]["status"] in ("warn", "fail")


def test_estimated_word_timings_never_measured(tmp_path):
    root, _ = build(tmp_path, words=word_doc(source="estimated"))
    _, checks = run(root)
    assert checks["word_timings"]["status"] == "warn"
    assert checks["subtitles_vs_words"]["method"] == "estimated" and "não é medição" in checks["subtitles_vs_words"]["detail"]


def test_provenance_only_inputs_and_hashes(tmp_path):
    root, evidence = build(tmp_path)
    assets = [{"asset_id": a["id"], "relative_path": a["relative_path"], "sha256": a["sha256"],
               "kind": "image" if a["id"].startswith("scene") else "voice", "origin": a["origin"], "source_url": None,
               "author": None, "license": {"id": None, "name": None, "url": None, "commercial_use": "unknown",
                                          "attribution_required": None, "verified_by": None, "verified_at": None},
               "status": "unverified", "notes": ""} for a in evidence["assets"]]
    (root / "asset-provenance.json").write_text(json.dumps({"schema_version": 1, "assets": assets}), encoding="utf-8")
    _, checks = run(root)   # MP4 e derivados NÃO exigem proveniência própria
    assert checks["asset_provenance"]["status"] == "warn" and checks["asset_provenance"]["method"] == "measured"
    assets[0]["sha256"] = "f" * 64
    (root / "asset-provenance.json").write_text(json.dumps({"schema_version": 1, "assets": assets}), encoding="utf-8")
    report, checks = run(root)
    assert checks["asset_provenance"]["status"] == "fail" and "hash_mismatch" in checks["asset_provenance"]["detail"]


def test_missing_video_and_missing_root_never_raise(tmp_path):
    root, _ = build(tmp_path)
    (root / "canais/demo/videos/fixture/render/short-rascunho.mp4").unlink()
    report, checks = run(root)
    assert checks["video_present"]["status"] == "fail" and report["video_sha256"] == qc.NO_VIDEO_HASH
    report, checks = run(tmp_path / "nao-existe")
    assert report["status"] == "fail" and checks["evidence_manifest"]["status"] == "fail"


def test_unusable_ffmpeg_path_is_skipped_not_invented(tmp_path):
    root, _ = build(tmp_path)
    report = qc.run_quality(root, production_id="p", ffmpeg=tmp_path / "no-ffmpeg.exe", ffprobe=tmp_path / "no-ffprobe.exe")
    checks = {c["id"]: c for c in report["checks"]}
    assert checks["audio_loudness"]["status"] == "skipped" and checks["duration_video_audio"]["status"] == "skipped"


def test_run_quality_inside_running_loop(tmp_path):
    root, _ = build(tmp_path)

    async def caller():
        return qc.run_quality(root, production_id="p")
    assert asyncio.run(caller())["schema_version"] == 1


def test_parse_srt_rejects_malformed():
    assert qc.parse_srt("1\n00:00:00,000 --> 00:00:01,000\nolá\n") == [{"start": 0.0, "end": 1.0, "text": "olá"}]
    assert qc.parse_srt("1\nsem tempo\ntexto\n") is None


def test_subprocess_timeout_and_cancellation():
    async def scenario():
        code, _, reason = await qc._run([sys.executable, "-c", "import time; time.sleep(30)"], 0.5)
        assert code is None and "timeout" in reason
        task = asyncio.create_task(qc._run([sys.executable, "-c", "import time; time.sleep(30)"], 30))
        await asyncio.sleep(0.5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(scenario())


REAL = Path("C:/00. Projetos/01. HORUS/relatorios/PILOTO-LOCAL-2026-11-13/integracao-conjunta/aprovacao")
FFMPEG_DIR = Path(os.environ.get("TEMP", "")) / "horus-m4/backend-factory-demo/remotion/node_modules/@remotion/compositor-win32-x64-msvc"


@pytest.mark.skipif(not (REAL / "pilot-evidence.json").is_file() or not (FFMPEG_DIR / "ffmpeg.exe").is_file(),
                    reason="evidência real e FFmpeg da sandbox ausentes")
def test_real_evidence_read_only():
    before = {p: p.stat().st_mtime_ns for p in REAL.rglob("*") if p.is_file()}
    report = qc.run_quality(REAL, production_id="ensaio", ffmpeg=FFMPEG_DIR / "ffmpeg.exe", ffprobe=FFMPEG_DIR / "ffprobe.exe")
    checks = {c["id"]: c for c in report["checks"]}
    assert report["blocking_errors"] == [] and checks["duration_video_audio"]["status"] == "pass"
    assert checks["audio_loudness"]["method"] == "measured" and checks["visual_black_frames"]["status"] == "pass"
    assert {p: p.stat().st_mtime_ns for p in REAL.rglob("*") if p.is_file()} == before


def test_analyze_wav_measures_peak_rms_clipping_and_silence(tmp_path):
    path = tmp_path / "a.wav"
    write_wav(path, tone(1.0, 0.5) + tone(2.0, 0.0) + struct.pack("<4h", 32767, -32768, 32767, 0))
    from horus_backend.pilot_quality import analyze_wav
    stats = analyze_wav(path)
    assert abs(stats["duration"] - 3.0) < 0.01 and stats["peak"] == 1.0 and stats["clipped_samples"] == 3
    assert len(stats["silences"]) == 1 and abs(stats["silences"][0][0] - 1.0) < 0.05
    assert abs(stats["silences"][0][1] - stats["duration"]) < 0.05


def test_estimated_word_timings_report_is_coherent_in_every_word_check(tmp_path):
    root, _ = build(tmp_path, words=word_doc(source="estimated"))
    report = qc.run_quality(root, production_id="prod1")
    checks = {c["id"]: c for c in report["checks"]}
    assert checks["word_timings"]["method"] == "estimated" and checks["subtitles_vs_words"]["method"] == "estimated"
    assert mc.validate_quality_report(report, production_id="prod1", word_timings_source="estimated")["ok"]
    # mesmo relatório rotulado como medido contradiz a fonte estimada e deve ser rejeitado
    forged = json.loads(json.dumps(report))
    for check in forged["checks"]:
        if check["category"] == "sync":
            check["method"] = "measured"
    assert "estimate_as_measured" in {e["code"] for e in mc.validate_quality_report(forged, word_timings_source="estimated")["errors"]}


def test_invalid_estimated_word_timings_fail_check_keeps_estimated_method(tmp_path):
    def broken(scenes, duration, narration_sha):
        doc = word_doc(source="estimated")(scenes, duration, narration_sha)
        doc["words"][1]["start"] = 0.0          # sobrepõe a palavra anterior
        return doc
    root, _ = build(tmp_path, words=broken)
    report = qc.run_quality(root, production_id="prod1")
    check = next(c for c in report["checks"] if c["id"] == "word_timings")
    assert check["status"] == "fail" and check["method"] == "estimated"
    assert mc.validate_quality_report(report, word_timings_source="estimated")["ok"]


def test_unaligned_word_timings_expose_alignment_reason(tmp_path):
    """J-12: o QC diz POR QUE a fala não foi alinhada, não só 'contexto parcial'."""
    root, _ = build(tmp_path, words=word_doc(source="estimated"))
    (root / "alignment-report.json").write_text(json.dumps(
        {"executed": False, "reason": "o roteiro deve ter uma linha por seção medida.", "report": None}), encoding="utf-8")
    _, checks = run(root)
    assert "alinhamento acústico não executado: o roteiro deve ter uma linha por seção medida." in checks["word_timings"]["detail"]
    (root / "alignment-report.json").write_text(json.dumps(
        {"executed": True, "reason": "taxa de casamento 0.5 abaixo do mínimo 0.85", "report": {}}), encoding="utf-8")
    _, checks = run(root)
    assert "taxa de casamento 0.5 abaixo do mínimo 0.85" in checks["word_timings"]["detail"]
