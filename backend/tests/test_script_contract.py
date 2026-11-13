"""Contrato puro do roteiro simulado: offline, sem rede/DB."""
import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from horus_backend.hermes_contract.models import RunEnvelope
from horus_backend.script_contract import ScriptDocument, ScriptSection, validate_script

ROOT = Path(__file__).resolve().parents[2]
VALID = json.loads((Path(__file__).parent / 'fixtures/scripts/roteiro-valido.json').read_text(encoding='utf-8'))
ALLOWED = {'src_a', 'src_b'}


def doc(**changes):
    value = copy.deepcopy(VALID)
    value.update(changes)
    return value


def section(index, kind='body', **extra):
    return {'id': f's{index}', 'kind': kind, 'heading': 'h', 'narration': 'n', **extra}


def sections(count_body=1):
    return [section(0, 'hook'), *[section(i + 1) for i in range(count_body)], section(99, 'conclusion')]


def test_valid_fixture_returns_model_and_defaults():
    script = validate_script(VALID, ALLOWED)
    assert isinstance(script, ScriptDocument) and script.simulated is True and script.schema_version == 1
    minimal = {'title': 't', 'sections': sections()}
    assert validate_script(minimal, set()).sections[1].source_ids == []


def test_accepts_instance_and_returns_new_model():
    original = ScriptDocument.model_validate(VALID)
    assert validate_script(original, ALLOWED) is not original


def test_references_use_existing_snapshot_ids():
    envelope = RunEnvelope.model_validate_json(
        (ROOT / 'contracts/hermes/fixtures/envelope-ficticio.json').read_text(encoding='utf-8'))
    allowed = {item.source_id for item in envelope.dataset.items}
    value = doc(sections=[section(0, 'hook', source_ids=['D1']), section(1, source_ids=['D2', 'D3']),
                          section(2, 'conclusion')])
    assert validate_script(value, allowed).sections[1].source_ids == ['D2', 'D3']
    bad = doc(sections=[section(0, 'hook', source_ids=['D9']), section(1), section(2, 'conclusion')])
    with pytest.raises(ValueError, match='D9'):
        validate_script(bad, allowed)


@pytest.mark.parametrize('ref', ['src_x', 'https://example.com/a', 'http://x', 'src_A'])
def test_unknown_or_url_sources_rejected(ref):
    value = copy.deepcopy(VALID)
    value['sections'][1]['source_ids'] = [ref]
    with pytest.raises(ValueError):
        validate_script(value, ALLOWED)


def test_empty_allowed_set_rejects_any_reference_but_allows_none():
    with pytest.raises(ValueError):
        validate_script(VALID, set())
    value = copy.deepcopy(VALID)
    for item in value['sections']:
        item['source_ids'] = []
    assert validate_script(value, set())


@pytest.mark.parametrize('allowed', [['src_a'], 'src_a', None, {'src_a': 1}.keys()])
def test_allowed_must_be_a_set(allowed):
    with pytest.raises(ValueError):
        validate_script(VALID, allowed)


@pytest.mark.parametrize('value', [None, [], 'x', 1])
def test_document_must_be_object(value):
    with pytest.raises(ValueError):
        validate_script(value, ALLOWED)


@pytest.mark.parametrize('changes', [
    {'schema_version': 2}, {'schema_version': True}, {'schema_version': '1'}, {'schema_version': 1.0},
    {'simulated': False}, {'simulated': 1}, {'simulated': 'true'}, {'simulated': None},
    {'title': ''}, {'title': '   '}, {'title': 'x' * 201}, {'title': 5}, {'title': None},
    {'extra': 1}, {'sections': []}, {'sections': 'x'}, {'sections': None},
])
def test_document_fields_rejected(changes):
    with pytest.raises(ValueError):
        validate_script(doc(**changes), ALLOWED)


@pytest.mark.parametrize('missing', ['title', 'sections'])
def test_required_document_fields(missing):
    value = doc()
    del value[missing]
    with pytest.raises(ValidationError):
        validate_script(value, ALLOWED)


def test_title_is_stripped_and_limit_inclusive():
    assert validate_script(doc(title='  ok  '), ALLOWED).title == 'ok'
    assert validate_script(doc(title='x' * 200), ALLOWED)


MANY = {'s' + str(i) for i in range(51)}


@pytest.mark.parametrize('field,bad', [
    ('id', ''), ('id', '1abc'), ('id', 'a' * 33), ('id', 'a b'), ('id', 'a/b'), ('id', 'á'), ('id', 3), ('id', 'a\nb'), ('id', 'a\x00'),
    ('kind', 'intro'), ('kind', ''), ('kind', 'HOOK'), ('kind', None),
    ('heading', ''), ('heading', ' '), ('heading', 'x' * 201), ('heading', 7),
    ('narration', ''), ('narration', '\n\t '), ('narration', 'x' * 8001), ('narration', ['a']),
    ('source_ids', 'src_a'), ('source_ids', None), ('source_ids', ['src_a', 'src_a']), ('source_ids', [1]),
    ('source_ids', sorted(MANY)),
])
def test_section_fields_rejected(field, bad):
    value = copy.deepcopy(VALID)
    value['sections'][1][field] = bad
    with pytest.raises(ValueError):
        validate_script(value, ALLOWED | MANY)


def test_surrounding_whitespace_is_stripped_before_id_validation():
    value = copy.deepcopy(VALID)
    value['sections'][1].update(id=' a1\n', source_ids=[' src_b\n'])
    script = validate_script(value, ALLOWED)
    assert script.sections[1].id == 'a1' and script.sections[1].source_ids == ['src_b']


def test_section_extra_and_missing_fields():
    value = copy.deepcopy(VALID)
    value['sections'][1]['extra'] = 'x'
    with pytest.raises(ValueError):
        validate_script(value, ALLOWED)
    value = copy.deepcopy(VALID)
    del value['sections'][1]['narration']
    with pytest.raises(ValidationError):
        validate_script(value, ALLOWED)


def test_section_limits_are_inclusive():
    value = copy.deepcopy(VALID)
    ids = ['s' + str(i) for i in range(50)]
    value['sections'][1].update(id='a' * 32, heading='h' * 200, narration='n' * 8000, source_ids=ids)
    assert validate_script(value, set(ids) | ALLOWED)


def test_section_count_limits():
    assert validate_script(doc(sections=sections(1)), ALLOWED)  # 3 seções
    assert validate_script(doc(sections=sections(28)), ALLOWED)  # 30 seções
    with pytest.raises(ValueError):
        validate_script(doc(sections=sections(29)), ALLOWED)  # 31
    with pytest.raises(ValueError):
        validate_script(doc(sections=sections(1)[:2]), ALLOWED)


@pytest.mark.parametrize('build', [
    lambda: [section(1), section(0, 'hook'), section(99, 'conclusion')],               # hook não primeiro
    lambda: [section(0, 'hook'), section(99, 'conclusion'), section(1)],               # conclusion não última
    lambda: [section(0, 'hook'), section(1, 'hook'), section(99, 'conclusion')],       # dois hooks
    lambda: [section(0, 'hook'), section(1, 'conclusion'), section(99, 'conclusion')],  # duas conclusions
    lambda: [section(0, 'hook'), section(1, 'conclusion'), section(2, 'body')],        # conclusion fora do fim
    lambda: [section(0, 'hook'), section(1, 'conclusion'), section(2, 'conclusion')],  # sem body
    lambda: [section(0), section(1), section(2)],                                      # sem hook/conclusion
])
def test_order_and_kind_cardinality(build):
    with pytest.raises(ValueError):
        validate_script(doc(sections=build()), ALLOWED)


def test_duplicate_section_ids_rejected_case_sensitive():
    value = sections(2)
    value[2]['id'] = value[1]['id']
    with pytest.raises(ValueError, match='repetido'):
        validate_script(doc(sections=value), ALLOWED)
    value[2]['id'] = value[1]['id'].upper()
    assert validate_script(doc(sections=value), ALLOWED)


def build_total(total):
    body = [section(i + 1, narration='n' * 8000) for i in range(7)]
    last = total - 8000 * 7 - 1
    return [section(0, 'hook', narration='n'), *body, section(99, 'conclusion', narration='n' * last)]


def test_total_narration_limit_inclusive():
    assert validate_script(doc(sections=build_total(60000)), ALLOWED)
    with pytest.raises(ValueError, match='narração total'):
        validate_script(doc(sections=build_total(60001)), ALLOWED)


def test_total_counts_stripped_text():
    value = build_total(60000)
    value[-1]['narration'] = '  ' + value[-1]['narration'] + '  '
    assert validate_script(doc(sections=value), ALLOWED)


def test_model_instances_cannot_bypass_validation():
    script = ScriptDocument.model_validate(VALID)
    script.sections[1].source_ids = ['src_x']  # mutação pós-construção
    with pytest.raises(ValueError):
        validate_script(script, ALLOWED)
    script = ScriptDocument.model_validate(VALID)
    script.simulated = False
    with pytest.raises(ValueError):
        validate_script(script, ALLOWED)


def test_input_is_not_mutated_and_result_is_detached():
    original = copy.deepcopy(VALID)
    script = validate_script(original, ALLOWED)
    assert original == VALID
    script.sections[1].source_ids.append('src_b')
    assert original == VALID


def test_section_model_is_exported_and_strict_on_its_own():
    with pytest.raises(ValidationError):
        ScriptSection(id='a', kind='body', heading='h', narration='n', source_ids=['x'], extra=1)
    assert ScriptSection(id='a', kind='body', heading='h', narration='n').source_ids == []


def test_json_round_trip_is_stable_and_strict_json_input_works():
    script = validate_script(VALID, ALLOWED)
    dumped = script.model_dump_json()
    assert validate_script(json.loads(dumped), ALLOWED) == script
    assert ScriptDocument.model_validate_json(dumped) == script
    assert json.loads(dumped) == VALID


def test_unicode_counts_code_points_and_keeps_text():
    value = copy.deepcopy(VALID)
    value['sections'][1]['narration'] = '\U0001F600' * 8000
    assert validate_script(value, ALLOWED).sections[1].narration == '\U0001F600' * 8000
    value['sections'][1]['narration'] = '\U0001F600' * 8001
    with pytest.raises(ValueError):
        validate_script(value, ALLOWED)


@pytest.mark.parametrize('bad', [float('nan'), float('inf'), b'x', object(), {'a': 1}])
def test_non_string_values_in_text_fields_rejected(bad):
    value = copy.deepcopy(VALID)
    value['sections'][1]['narration'] = bad
    with pytest.raises(ValueError):
        validate_script(value, ALLOWED)


def test_allowed_set_with_non_string_members_does_not_admit_other_values():
    value = copy.deepcopy(VALID)
    value['sections'][1]['source_ids'] = ['src_a']
    assert validate_script(value, frozenset({'src_a', 5}))
    value['sections'][1]['source_ids'] = ['5']
    with pytest.raises(ValueError):
        validate_script(value, {5})


def test_unknown_reference_error_lists_only_ids_not_narration():
    value = copy.deepcopy(VALID)
    value['sections'][1]['narration'] = 'TEXTO-SENSIVEL-ORIGINAL'
    value['sections'][1]['source_ids'] = ['src_x']
    with pytest.raises(ValueError) as error:
        validate_script(value, ALLOWED)
    assert 'src_x' in str(error.value) and 'TEXTO-SENSIVEL' not in str(error.value)
