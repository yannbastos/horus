"""Qualidade/sincronização do piloto: dados fictícios, sem rede, sem fábrica; disco só em tmp_path."""
import copy
import os
import hashlib
import math
import struct
import wave

import pytest

from horus_backend import pilot_quality
from horus_backend.pilot_quality import inspect_pilot_files, validate_pilot_evidence

H1, H2, H3 = 'a' * 64, 'b' * 64, 'c' * 64


def good():
    return {
        'schema_version': 1, 'demo_only': True, 'alignment_method': 'measured_sections',
        'narration': {'kind': 'local_tts', 'engine': 'windows_sapi', 'voice': 'Voz fictícia pt-BR',
                      'duration_seconds': 10.0, 'sha256': H1},
        'scenes': [{'id': 'c1', 'start': 0, 'end': 4.0, 'asset_id': 'png1'},
                   {'id': 'c2', 'start': 4.0, 'end': 10.0, 'asset_id': 'png2'}],
        'subtitles': [{'start': 0.2, 'end': 3.8, 'text': 'Primeira fala.'},
                      {'start': 4.1, 'end': 9.8, 'text': 'Segunda fala.'}],
        'assets': [
            {'id': 'png1', 'relative_path': 'assets/c1.png', 'sha256': H2, 'origin': 'original_local',
             'license': 'original', 'attribution': 'Gerado localmente', 'generated_at': '2026-11-13T10:00:00Z'},
            {'id': 'png2', 'relative_path': 'assets/c2.png', 'sha256': H3, 'origin': 'original_local',
             'license': 'original', 'attribution': 'Gerado localmente', 'generated_at': '2026-11-13T10:00:01+00:00'},
            {'id': 'voz', 'relative_path': 'audio/narracao.wav', 'sha256': H1, 'origin': 'system_voice',
             'license': 'unverified', 'attribution': 'Windows SAPI; licença comercial não verificada',
             'generated_at': '2026-11-13T10:00:02Z'}],
        'video': {'duration_seconds': 10.8, 'width': 1080, 'height': 1920, 'frames': 324},
    }


def run(mutate=None):
    evidence = good()
    if mutate:
        mutate(evidence)
    return validate_pilot_evidence(evidence)


def status(result, check_id):
    return next(c['status'] for c in result['checks'] if c['id'] == check_id)


def fails(result, check_id):
    assert status(result, check_id) == 'fail', result
    return [e for e in result['blocking_errors'] if e.startswith(check_id + ':')]


def test_positive_demo_has_no_blocking_errors_and_never_publishable():
    result = run()
    assert result['schema_version'] == 1 and result['publishable'] is False
    assert result['blocking_errors'] == []
    assert {c['status'] for c in result['checks']} <= {'pass', 'fail', 'not_checked'}
    for check_id in ('schema', 'demo_flag', 'narration', 'video', 'assets_paths', 'scene_contiguity',
                     'subtitles_timing', 'duration_consistency'):
        assert status(result, check_id) == 'pass', check_id
    # nada é aprovado automaticamente: licença, acústica, palavra, arquivos e publicação ficam pendentes
    for check_id in ('provenance_licenses', 'acoustic_evidence', 'word_alignment', 'physical_files', 'publishability'):
        assert status(result, check_id) == 'not_checked', check_id
    assert any('unverified' in w or 'licença' in w for w in result['warnings'])
    assert any('palavra' in w for w in result['warnings'])


def test_pure_inputs_not_mutated():
    evidence = good()
    snapshot = copy.deepcopy(evidence)
    validate_pilot_evidence(evidence)
    assert evidence == snapshot


@pytest.mark.parametrize('value', [None, [], 'x', 3, True])
def test_non_dict_never_raises(value):
    result = validate_pilot_evidence(value)
    assert result['blocking_errors'] and result['publishable'] is False


def test_scene_gap_and_overlap_and_first_start():
    assert fails(run(lambda e: e['scenes'][1].update(start=4.5)), 'scene_contiguity')[0].count('lacuna')
    assert 'sobreposição' in fails(run(lambda e: e['scenes'][1].update(start=3.5)), 'scene_contiguity')[0]
    assert 'primeira cena' in fails(run(lambda e: e['scenes'][0].update(start=0.5)), 'scene_contiguity')[0]
    assert fails(run(lambda e: e['scenes'][0].update(end=0)), 'scene_contiguity')


def test_scene_end_must_match_audio():
    assert fails(run(lambda e: e['scenes'][1].update(end=12.0)), 'scene_contiguity')
    assert run(lambda e: e['scenes'][1].update(end=10.8))['blocking_errors'] == []  # fim no vídeo (áudio+cauda): tolerado


@pytest.mark.parametrize('bad', [math.nan, math.inf, -math.inf, True, '4.0', None, 1e300])
def test_scene_time_coercion_and_nonfinite(bad):
    assert fails(run(lambda e: e['scenes'][0].update(end=bad)), 'scene_contiguity')


@pytest.mark.parametrize('bad', [math.nan, math.inf, 0, -1, True, '10', None])
def test_narration_duration_strict(bad):
    assert fails(run(lambda e: e['narration'].update(duration_seconds=bad)), 'narration')


@pytest.mark.parametrize('field,bad', [('width', True), ('width', 1080.0), ('height', 0), ('frames', '324'),
                                       ('frames', False), ('duration_seconds', math.nan)])
def test_video_types_strict(field, bad):
    assert fails(run(lambda e: e['video'].update({field: bad})), 'video')


def test_implied_fps_range():
    assert fails(run(lambda e: e['video'].update(frames=5)), 'video')


def test_schema_version_and_flags_strict():
    for bad in (True, 1.0, '1', 2, None):
        assert fails(run(lambda e: e.update(schema_version=bad)), 'schema')
    for bad in (False, 1, 'true', None):
        assert fails(run(lambda e: e.update(demo_only=bad)), 'demo_flag')
    assert fails(run(lambda e: e.update(alignment_method='word')), 'alignment_method')
    assert fails(run(lambda e: e.update(extra=1)), 'schema')
    assert fails(run(lambda e: e.pop('video')), 'schema')


def test_duration_conflict_and_renderer_tail():
    assert 'cauda' in fails(run(lambda e: e['video'].update(duration_seconds=11.5, frames=345)), 'duration_consistency')[0]
    assert fails(run(lambda e: e['video'].update(duration_seconds=10.0, frames=300)), 'duration_consistency')
    ok = run(lambda e: e['video'].update(duration_seconds=10.9, frames=327))  # dentro de 0,8 ± 0,15
    assert status(ok, 'duration_consistency') == 'pass'


def test_subtitles_overlap_out_of_order_text_and_segments():
    assert any('sobrepõe' in m for m in fails(run(lambda e: e['subtitles'][1].update(start=3.0)), 'subtitles_timing'))
    result = run(lambda e: e['subtitles'].__setitem__(1, {'start': 3.0, 'end': 5.0, 'text': 'x'}))
    assert fails(result, 'subtitles_timing')  # sobrepõe e cruza segmentos
    assert any('cruza' in m for m in fails(result, 'subtitles_timing'))
    for text in ('', '   ', None, 5, 'a --> b'):
        assert fails(run(lambda e: e['subtitles'][0].update(text=text)), 'subtitles_structure')
    assert fails(run(lambda e: e['subtitles'][0].update(end=0.1)), 'subtitles_structure')
    assert fails(run(lambda e: e['subtitles'][0].update(start=math.nan)), 'subtitles_structure')
    assert fails(run(lambda e: e['subtitles'][1].update(end=10.5)), 'subtitles_timing')  # depois da fala medida


def test_missing_subtitle_for_scene_warns():
    result = run(lambda e: e['subtitles'].pop())
    assert not result['blocking_errors'] and any('sem legenda' in w for w in result['warnings'])


def test_assets_missing_and_unknown_references():
    assert fails(run(lambda e: e['scenes'][0].update(asset_id='nada')), 'scene_assets')
    assert fails(run(lambda e: e['scenes'][0].update(asset_id='voz')), 'scene_assets')  # voz não ilustra cena
    assert fails(run(lambda e: e['scenes'][0].update(asset_id=7)), 'scene_assets')
    assert fails(run(lambda e: e.update(assets=[])), 'assets_structure')
    assert fails(run(lambda e: e['assets'].pop(0)), 'scene_assets')


def test_duplicate_ids_and_paths():
    assert fails(run(lambda e: e['assets'][1].update(id='png1')), 'assets_structure')
    assert fails(run(lambda e: e['assets'][1].update(relative_path='ASSETS/C1.png')), 'assets_paths')
    assert fails(run(lambda e: e['scenes'][1].update(id='c1')), 'scene_contiguity')


@pytest.mark.parametrize('path', ['/etc/passwd', 'C:/x.png', 'C:\\x.png', '../x.png', 'a/../../x.png', 'a\\b.png',
                                  'http://e.com/x.png', 'file:///x.png', '~/x.png', 'a//b.png', './x.png', '', 'x.png.',
                                  'a\x00b.png', 'x' * 300, None, 5])
def test_unsafe_paths(path):
    assert fails(run(lambda e: e['assets'][0].update(relative_path=path)), 'assets_paths')


@pytest.mark.parametrize('digest', ['A' * 64, 'a' * 63, 'a' * 64 + '\n', 'g' * 64, None, 5, ''])
def test_invalid_hashes(digest):
    assert fails(run(lambda e: e['assets'][0].update(sha256=digest)), 'assets_hashes')
    assert fails(run(lambda e: e['narration'].update(sha256=digest)), 'narration')


def test_asset_enums_attribution_and_timestamp():
    assert fails(run(lambda e: e['assets'][0].update(origin='stock')), 'assets_structure')
    assert fails(run(lambda e: e['assets'][0].update(license='cc0')), 'assets_structure')
    assert fails(run(lambda e: e['assets'][0].update(attribution='  ')), 'assets_structure')
    for bad in ('ontem', '2026-13-40T00:00:00Z', 5, None):
        assert fails(run(lambda e: e['assets'][0].update(generated_at=bad)), 'assets_structure')
    assert fails(run(lambda e: e['assets'][0].pop('license')), 'assets_structure')


def test_license_unverified_blocks_publication_not_demo():
    def all_unverified(e):
        for asset in e['assets']:
            asset['license'] = 'unverified'
    result = run(all_unverified)
    assert result['blocking_errors'] == [] and result['publishable'] is False
    assert status(result, 'provenance_licenses') == 'not_checked'
    assert 'png1' in ' '.join(result['warnings'])


def test_system_voice_cannot_claim_original_and_narration_must_reference_voice_asset():
    assert 'comercial' in fails(run(lambda e: e['assets'][2].update(license='original')), 'provenance_licenses')[0]
    assert fails(run(lambda e: e['narration'].update(sha256='d' * 64)), 'provenance_licenses')


def test_huge_inputs_are_bounded():
    result = run(lambda e: e.update(scenes=[{'id': f's{i}', 'start': i, 'end': i + 1, 'asset_id': 'png1'}
                                           for i in range(10_000)]))
    assert fails(result, 'scene_contiguity')
    assert fails(run(lambda e: e['subtitles'][0].update(text='x' * 100_000)), 'subtitles_structure')
    assert fails(run(lambda e: e.update(assets=[e['assets'][0]] * 10_000)), 'assets_structure')


# ----------------------------------------------------------------- inspeção física


def write_wav(path, samples, rate=8000):
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b''.join(struct.pack('<h', s) for s in samples))


def physical(tmp_path, samples, **narr):
    (tmp_path / 'audio').mkdir()
    (tmp_path / 'assets').mkdir()
    wav = tmp_path / 'audio/narracao.wav'
    write_wav(wav, samples)
    evidence = good()
    digest = hashlib.sha256(wav.read_bytes()).hexdigest()
    evidence['assets'][2]['sha256'] = evidence['narration']['sha256'] = digest
    for asset in evidence['assets'][:2]:
        file = tmp_path / asset['relative_path']
        file.write_bytes(b'png-ficticio-' + asset['id'].encode())
        asset['sha256'] = hashlib.sha256(file.read_bytes()).hexdigest()
    evidence['narration']['duration_seconds'] = len(samples) / 8000
    evidence['narration'].update(narr)
    evidence['video'].update(duration_seconds=round(len(samples) / 8000 + 0.8, 3), frames=round((len(samples) / 8000 + 0.8) * 30))
    evidence['scenes'][1]['end'] = len(samples) / 8000
    evidence['scenes'][0]['end'] = evidence['scenes'][1]['start'] = len(samples) / 16000
    evidence['subtitles'] = [{'start': 0.1, 'end': len(samples) / 16000 - 0.1, 'text': 'a'},
                             {'start': len(samples) / 16000 + 0.1, 'end': len(samples) / 8000 - 0.1, 'text': 'b'}]
    return evidence


def tone(seconds=2.0, amplitude=8000):
    return [int(amplitude * math.sin(i / 7)) for i in range(int(8000 * seconds))]


def test_inspect_ok_hash_and_acoustics(tmp_path):
    result = inspect_pilot_files(tmp_path, physical(tmp_path, tone()))
    assert result['blocking_errors'] == [], result
    assert status(result, 'physical_files') == 'pass' and status(result, 'acoustic_evidence') == 'pass'
    assert status(result, 'publishability') == 'not_checked' and result['publishable'] is False


def test_inspect_detects_hash_tamper_missing_and_traversal(tmp_path):
    evidence = physical(tmp_path, tone())
    (tmp_path / 'assets/c1.png').write_bytes(b'alterado')
    assert 'sha256' in ' '.join(fails(inspect_pilot_files(tmp_path, evidence), 'physical_files'))
    (tmp_path / 'assets/c2.png').unlink()
    assert any('ausente' in e for e in fails(inspect_pilot_files(tmp_path, evidence), 'physical_files'))
    evidence['assets'][0]['relative_path'] = '../fora.png'
    result = inspect_pilot_files(tmp_path, evidence)
    assert status(result, 'physical_files') == 'not_checked' and result['blocking_errors']


def test_inspect_clipping_silence_and_duration_mismatch(tmp_path):
    clipped = [32767 if i % 2 else -32768 for i in range(16000)]
    assert any('clipping' in e for e in fails(inspect_pilot_files(tmp_path, physical(tmp_path, clipped)), 'acoustic_evidence'))


def test_inspect_silent_and_duration(tmp_path):
    assert any('mudo' in e for e in fails(inspect_pilot_files(tmp_path, physical(tmp_path, [0] * 16000)), 'acoustic_evidence'))


def test_inspect_declared_duration_conflict(tmp_path):
    evidence = physical(tmp_path, tone())
    evidence['narration']['duration_seconds'] = 2.5
    evidence['video'].update(duration_seconds=3.3, frames=99)
    evidence['scenes'][1]['end'] = 2.5
    evidence['subtitles'][1]['end'] = 2.4
    assert any('WAV mede' in e for e in fails(inspect_pilot_files(tmp_path, evidence), 'acoustic_evidence'))


def test_inspect_symlink_refused(tmp_path):
    evidence = physical(tmp_path, tone())
    target = tmp_path / 'assets/c1.png'
    real = tmp_path / 'assets/real.png'
    target.rename(real)
    try:
        target.symlink_to(real)
    except OSError:
        pytest.skip('symlink indisponível sem privilégio')
    assert any('symlink' in e for e in fails(inspect_pilot_files(tmp_path, evidence), 'physical_files'))


def rehash(tmp_path, evidence):
    wav = tmp_path / 'audio/narracao.wav'
    evidence['assets'][2]['sha256'] = evidence['narration']['sha256'] = hashlib.sha256(wav.read_bytes()).hexdigest()


def test_inspect_truncated_wav_with_intact_header_and_fresh_hash(tmp_path):
    evidence = physical(tmp_path, tone(2.0))
    wav = tmp_path / 'audio/narracao.wav'
    wav.write_bytes(wav.read_bytes()[:-6000])  # header ainda declara 16000 frames
    rehash(tmp_path, evidence)
    result = inspect_pilot_files(tmp_path, evidence)
    assert status(result, 'physical_files') == 'pass'  # hash confere; truncamento é pego na acústica
    assert any('truncado' in e for e in fails(result, 'acoustic_evidence'))


def test_wav_stats_stereo_edges_counted_per_frame(tmp_path):
    rate, path = 8000, tmp_path / 's.wav'
    frames = [(0, 0)] * rate + [(int(8000 * math.sin(i / 7)), 5000) for i in range(rate)] + [(0, 0)] * (rate // 2)
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b''.join(struct.pack('<hh', *f) for f in frames))
    duration, (peak, clipped, lead, tail) = pilot_quality._wav_stats(path)
    assert duration == pytest.approx(2.5)
    assert lead == pytest.approx(1.0, abs=0.01) and tail == pytest.approx(0.5, abs=0.01)
    assert clipped == 0 and 0.2 < peak < 0.3


def test_inspect_refuses_root_symlink_or_junction_by_stub(tmp_path, monkeypatch):
    evidence = physical(tmp_path, tone())
    monkeypatch.setattr(pilot_quality.os.path, 'isjunction', lambda p: os.fspath(p) == os.fspath(tmp_path))
    assert any('root' in e for e in fails(inspect_pilot_files(tmp_path, evidence), 'physical_files'))


def test_inspect_refuses_junction_in_path_by_stub(tmp_path, monkeypatch):
    evidence = physical(tmp_path, tone())
    monkeypatch.setattr(pilot_quality.os.path, 'isjunction', lambda p: os.fspath(p).endswith('assets'))
    assert any('junction' in e for e in fails(inspect_pilot_files(tmp_path, evidence), 'physical_files'))


def test_inspect_oserror_during_hash_is_physical_failure(tmp_path, monkeypatch):
    evidence = physical(tmp_path, tone())

    def boom(path):
        raise PermissionError('negado')
    monkeypatch.setattr(pilot_quality, '_sha256', boom)
    result = inspect_pilot_files(tmp_path, evidence)  # não levanta
    assert any('ilegível' in e for e in fails(result, 'physical_files'))
