"""HOR-129: invariantes do checklist pré-inferência que nenhum outro teste fixa. Offline, sem Hermes real."""
from decimal import Decimal
import json

import pytest

from horus_backend.config import Settings
from horus_backend.security import harden_profile, security_status

NAMES = ('HORUS_WORKFLOW_EXECUTOR', 'HORUS_RADAR_EXECUTOR', 'HORUS_MAX_TOKENS_PER_RUN', 'HORUS_MAX_TOKENS_PER_DAY',
         'HORUS_MAX_RUNS_PER_DAY', 'HORUS_BUDGET_TOTAL_USD', 'HORUS_BUDGET_DAILY_USD',
         'HORUS_PRICE_INPUT_USD_PER_MTOK', 'HORUS_PRICE_OUTPUT_USD_PER_MTOK')


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in NAMES:
        monkeypatch.delenv(name, raising=False)


def settings(tmp_path, **extra):
    values = dict(token='pre-inference-sessao-ficticia-0123456789', data_dir=tmp_path / 'data', factory_root=None,
                  hermes_executable=None, hermes_profile=tmp_path / 'perfil-ausente',
                  hermes_config=tmp_path / 'conexao-ausente.json')
    return Settings(**{**values, **extra})


def test_default_installation_is_simulated_and_refuses_real_execution(tmp_path):
    config = settings(tmp_path)
    assert (config.workflow_executor, config.radar_executor) == ('simulated', 'hermes_simulated')
    report = security_status(config)
    codes = {item['code'] for item in report['blockers']}
    assert report['real_execution_allowed'] is False
    assert {'profile_unverifiable', 'connection_not_configured', 'pricing_missing'} <= codes
    assert report['processing']['local_only'] is True
    assert report['hermes']['cost_limits']['pricing_configured'] is False


def test_local_gate_open_is_not_pre_inference_approval(tmp_path):
    """Gate local aberto não prova isolamento de SO, corte remoto, auditoria nem modo privado.

    Se algum destes passar a ser implementado e refletido no status, atualizar este teste e o checklist.
    """
    profile = tmp_path / 'perfil-fixture'
    harden_profile(profile)
    connection = tmp_path / 'conexao.json'
    connection.write_text(json.dumps({'base_url': 'http://127.0.0.1:8643', 'token': 'chave-ficticia-0123456789012345'}))
    config = settings(tmp_path, hermes_profile=profile, hermes_config=connection,
                      price_input_usd_per_mtok=Decimal('1'), price_output_usd_per_mtok=Decimal('2'))
    report = security_status(config)
    assert report['blockers'] == [] and report['real_execution_allowed'] is True
    assert report['hermes']['network_isolation']['enforced'] is False
    assert report['audit']['available'] is False
    assert report['private_mode']['available'] is False
