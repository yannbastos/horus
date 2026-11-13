"""Contrato puro do plano de produção: offline, sem fábrica em execução, sem disco além de leitura."""
import copy
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from horus_backend.production_contract import (
    MAX_LINE_SECONDS, MIN_LINE_SECONDS, ProductionPlan, build_production_plan, line_seconds, render_srt)
from horus_backend.script_contract import ScriptDocument

FIXTURES = Path(__file__).parent / 'fixtures'
SCRIPT = json.loads((FIXTURES / 'scripts/roteiro-valido.json').read_text(encoding='utf-8'))
ID, HASH = 'a' * 32, 'b' * 64
FACTORY_MODELS = Path(os.environ.get('HORUS_FABRICA_MODELOS', 'C:/00. Projetos/01. HORUS/fabrica-canais/scripts/fabrica/modelos.py'))


def script(sections=None, **changes):
    value = copy.deepcopy(SCRIPT)
    if sections is not None:
        value['sections'] = sections
    value.update(changes)
    return ScriptDocument.model_validate(value)


def build(document=None, **extra):
    values = dict(script_id=ID, script_version=1, script_content_hash=HASH)
    values.update(extra)
    return build_production_plan(document or script(), **values)


def test_render_quality_defaults_legacy_plans_to_draft_and_limits_final_to_pilot():
    legacy = build().model_dump(mode='json')
    legacy.pop('render_quality')
    assert ProductionPlan.model_validate(legacy).render_quality == 'draft'
    assert build(mode='local_pilot',render_quality='final').render_quality == 'final'
    for mode in ('simulated','local_demo'):
        with pytest.raises(ValidationError):
            build(mode=mode,render_quality='final')


def section(index, kind='body', narration='n', **extra):
    return {'id': f's{index}', 'kind': kind, 'heading': f'h{index}', 'narration': narration, **extra}


def sections(count_body=1, narration='palavra ' * 10):
    return [section(0, 'hook', narration), *[section(i + 1, narration=narration) for i in range(count_body)],
            section(99, 'conclusion', narration)]


def test_plan_is_deterministic_simulated_and_demo_only():
    plan = build()
    assert plan == build() and plan.mode == 'simulated' and plan.demo_only is True and plan.schema_version == 1
    assert plan.audio.real_voice is False and plan.subtitles.speech_aligned is False
    assert plan.license.publishable is False and plan.license.external_assets == []
    assert 'sem narração de voz real' in plan.audio.disclosure and 'não é alinhamento real' in plan.subtitles.disclosure
    assert plan.roteiro.formato == 'short' and plan.roteiro.teste is True
    assert plan.sources == ['src_a', 'src_b']  # ordem de primeira citação, sem repetição


def test_one_scene_per_section_contiguous_and_total_is_sum():
    plan = build(script(sections(3)))
    assert [scene.id for scene in plan.scenes] == ['s0', 's1', 's2', 's3', 's99']
    assert [scene.n for scene in plan.scenes] == [1, 2, 3, 4, 5] == [line.n for line in plan.roteiro.linhas]
    assert plan.scenes[0].start == 0
    for before, after in zip(plan.scenes, plan.scenes[1:]):
        assert after.start == before.end
    assert plan.total_duration == pytest.approx(sum(scene.duration for scene in plan.scenes))
    assert all(scene.visual_origin == 'original_local' for scene in plan.scenes)


def test_durations_are_clamped_and_finite():
    assert line_seconds('x') == MIN_LINE_SECONDS
    assert line_seconds('palavra ' * 10000) == MAX_LINE_SECONDS
    assert line_seconds('palavra ' * 5) == 2.0
    plan = build(script(sections(1, narration='palavra ' * 1000)))
    assert all(MIN_LINE_SECONDS <= scene.duration <= MAX_LINE_SECONDS for scene in plan.scenes)


def test_maximum_script_stays_within_total_limit():
    text = 'palavra ' * 249  # 30 seções de ~1992 caracteres cabem no teto M3 de 60000
    plan = build(script([section(0, 'hook', text), *[section(i + 1, narration=text) for i in range(28)],
                         section(99, 'conclusion', text)]))
    assert len(plan.scenes) == 30 and plan.total_duration <= 600


def test_mode_is_explicit_and_limited():
    assert build(mode='local_demo').mode == 'local_demo'
    pilot = build(mode='local_pilot')
    assert pilot.mode == 'local_pilot' and pilot.audio.kind == 'local_tts'
    assert not pilot.audio.real_voice and not pilot.license.publishable
    with pytest.raises(ValidationError):
        build(mode='real')


@pytest.mark.parametrize('extra', [
    {'script_id': 'A' * 32}, {'script_id': 'a' * 31}, {'script_id': 5}, {'script_id': None}, {'script_id': 'a' * 32 + '\n'},
    {'script_version': 0}, {'script_version': True}, {'script_version': '1'}, {'script_version': 1.0}, {'script_version': None},
    {'script_content_hash': 'B' * 64}, {'script_content_hash': 'b' * 63}, {'script_content_hash': True},
    {'script_content_hash': 'b' * 64 + '\n'}, {'script_content_hash': None},
])
def test_server_ids_and_hash_never_coerced(extra):
    with pytest.raises(ValueError):
        build(**extra)


def test_script_must_be_a_validated_model_and_is_revalidated():
    with pytest.raises(ValueError):
        build_production_plan(SCRIPT, script_id=ID, script_version=1, script_content_hash=HASH)
    document = script()
    document.sections[1].source_ids = ['src_a', 'src_a']  # mutação pós-construção
    with pytest.raises(ValueError):
        build(document)
    document = script()
    document.simulated = False
    with pytest.raises(ValueError):
        build(document)


def test_input_not_mutated():
    document = script()
    before = document.model_dump()
    build(document)
    assert document.model_dump() == before


def test_roteiro_has_no_paths_search_or_external_fields():
    plan = build()
    fields = set(plan.roteiro.linhas[0].model_dump())
    assert fields == {'n', 'narracao', 'visual', 'duracao_estimada'}
    with pytest.raises(ValidationError):
        ProductionPlan.model_validate({**plan.model_dump(), 'roteiro': {**plan.roteiro.model_dump(), 'linhas': [
            {**plan.roteiro.linhas[0].model_dump(), 'visual_override': '../x.png'}, *plan.model_dump()['roteiro']['linhas'][1:]]}})
    serialized = plan.model_dump_json()
    assert not re.search(r'https?://|file:|[A-Za-z]:[\\/]|\.\./', serialized)


def dump(plan=None):
    return (plan or build()).model_dump()


@pytest.mark.parametrize('mutate', [
    lambda d: d.update(demo_only=False),
    lambda d: d.update(schema_version=2),
    lambda d: d.update(extra=1),
    lambda d: d['license'].update(publishable=True),
    lambda d: d['license'].update(external_assets=['https://x']),
    lambda d: d['audio'].update(real_voice=True),
    lambda d: d['audio'].update(kind='elevenlabs'),
    lambda d: d['subtitles'].update(speech_aligned=True),
    lambda d: d['roteiro'].update(teste=False),
    lambda d: d['roteiro'].update(formato='longo'),
    lambda d: d.update(title='outro'),
    lambda d: d.update(total_duration=d['total_duration'] + 1),
    lambda d: d.update(total_duration=float('inf')),
    lambda d: d.update(total_duration=float('nan')),
    lambda d: d['scenes'][1].update(start=d['scenes'][1]['start'] + 0.5),
    lambda d: d['scenes'][1].update(end=d['scenes'][1]['end'] + 0.5),
    lambda d: d['scenes'][1].update(duration=-1),
    lambda d: d['scenes'][1].update(duration=0),
    lambda d: d['scenes'][1].update(duration=MAX_LINE_SECONDS + 1),
    lambda d: d['scenes'][1].update(visual_origin='stock'),
    lambda d: d['scenes'][1].update(n=9),
    lambda d: d['scenes'][1].update(id=d['scenes'][0]['id']),
    lambda d: d['scenes'][1].update(source_ids=['inventada']),
    lambda d: d['roteiro']['linhas'][1].update(duracao_estimada=9.0),
    lambda d: d['roteiro']['linhas'][1].update(n=7),
    lambda d: d['roteiro']['linhas'].pop(),
    lambda d: d['scenes'].reverse(),
    lambda d: d.update(sources=[]),
    lambda d: d.update(sources=list(reversed(d['sources']))),
])
def test_plan_rejects_incoherent_or_unsafe_documents(mutate):
    value = dump()
    mutate(value)
    with pytest.raises(ValueError):
        ProductionPlan.model_validate(value)


@pytest.mark.parametrize('mutate', [
    lambda d: d.update(schema_version=True), lambda d: d.update(schema_version=1.0), lambda d: d.update(schema_version='1'),
    lambda d: d.update(demo_only=1), lambda d: d.update(demo_only='true'), lambda d: d.update(demo_only=1.0),
    lambda d: d['roteiro'].update(teste=1), lambda d: d['roteiro'].update(teste='true'),
    lambda d: d['audio'].update(real_voice=0), lambda d: d['audio'].update(real_voice=0.0), lambda d: d['audio'].update(real_voice=''),
    lambda d: d['subtitles'].update(speech_aligned=0), lambda d: d['subtitles'].update(speech_aligned=None),
    lambda d: d['license'].update(publishable=0), lambda d: d['license'].update(publishable='false'),
    lambda d: d['scenes'][0].update(n=True), lambda d: d['roteiro']['linhas'][0].update(n=True),
    lambda d: d.update(script_version=True),
])
def test_literal_flags_require_exact_types(mutate):
    """Literal compara por igualdade: 1/1.0/True e 0/False seriam equivalentes sem validação do tipo exato."""
    value = dump()
    mutate(value)
    with pytest.raises(ValueError):
        ProductionPlan.model_validate(value)


@pytest.mark.parametrize('origin', ['stock', 'external', 'https://example.com/a.png', 'original_local ', 1, True, None])
def test_scene_origin_cannot_become_external(origin):
    value = dump()
    value['scenes'][0]['visual_origin'] = origin
    with pytest.raises(ValueError):
        ProductionPlan.model_validate(value)
    scene = build().scenes[0]
    scene.visual_origin = 'stock'  # mutação pós-construção
    plan = build()
    plan.scenes[0].visual_origin = 'stock'
    with pytest.raises(ValueError):
        render_srt(plan)


def test_plan_json_round_trip():
    plan = build()
    assert ProductionPlan.model_validate_json(plan.model_dump_json()) == plan


def parse_srt(text):
    blocks = [b for b in text.strip().split('\n\n')]
    parsed = []
    for block in blocks:
        number, timing, *lines = block.split('\n')
        match = re.fullmatch(r'(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})', timing)
        assert match
        a, b = ([int(x) for x in match.groups()[i:i + 4]] for i in (0, 4))
        parsed.append((int(number), a[0] * 3600 + a[1] * 60 + a[2] + a[3] / 1000,
                       b[0] * 3600 + b[1] * 60 + b[2] + b[3] / 1000, lines))
    return parsed


def test_srt_is_consistent_with_scenes_and_single_line_cues():
    plan = build(script(sections(2)))
    cues = parse_srt(render_srt(plan))
    assert len(cues) == len(plan.scenes)
    for (number, start, end, lines), scene in zip(cues, plan.scenes):
        assert number == scene.n and start == pytest.approx(scene.start) and end == pytest.approx(scene.end)
        assert len(lines) == 1 and lines[0]
    assert cues[-1][2] == pytest.approx(plan.total_duration)


def test_srt_neutralizes_breaking_text_and_hour_overflow():
    hostile = 'linha um\n\nlinha --> dois\r\n\x00 três\u2028fim'
    plan = build(script(sections(1, narration=hostile)))
    text = render_srt(plan)
    cues = parse_srt(text)
    assert all(len(lines) == 1 for *_, lines in cues)
    assert text.count('-->') == len(plan.scenes) and '\x00' not in text and '\u2028' not in text


def test_srt_revalidates_mutated_plan():
    plan = build()
    plan.demo_only = False
    with pytest.raises(ValueError):
        render_srt(plan)


def _load_factory_models():
    if not FACTORY_MODELS.is_file():
        pytest.skip('fábrica não encontrada neste ambiente; compatibilidade com fabrica.modelos não verificada')
    sys.dont_write_bytecode = True  # a fábrica não pode ganhar __pycache__ nesta rodada
    spec = importlib.util.spec_from_file_location('fabrica_modelos_somente_leitura', FACTORY_MODELS)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(spec.name, None)
    return module


def test_roteiro_is_accepted_by_the_real_factory_model():
    models = _load_factory_models()
    plan = build(script(sections(3)))
    roteiro = models.Roteiro.model_validate(plan.roteiro.model_dump())
    assert roteiro.teste is True and roteiro.formato == 'short' and len(roteiro.linhas) == len(plan.scenes)
    assert [line.duracao_estimada for line in roteiro.linhas] == [scene.duration for scene in plan.scenes]


def test_factory_model_still_rejects_our_unsafe_additions():
    models = _load_factory_models()
    value = build().roteiro.model_dump()
    value['linhas'][0]['campo_extra'] = 1
    with pytest.raises(ValidationError):
        models.Roteiro.model_validate(value)
