import os
from pathlib import Path
import shutil
import subprocess

import pytest


@pytest.mark.parametrize('strict,code', [('1', 2), ('0', 0)])
def test_real_journey_missing_environment_is_strict_only(strict, code):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node indisponível')
    root = Path(__file__).resolve().parents[2]
    env = {**os.environ, 'HORUS_E2E_STRICT': strict, 'HORUS_E2E_NO_OVERLAY': '0',
           'HORUS_PILOT_FACTORY': 'fixture', 'HORUS_ALIGNMENT_MODEL': 'fixture'}
    env.pop('HORUS_FFMPEG', None)
    result = subprocess.run([node, str(root / 'frontend/scripts/e2e-backend.mjs'), 'run'],
                            env=env, capture_output=True, text=True, encoding='utf-8', timeout=15)
    assert result.returncode == code
    assert 'Variáveis ausentes: HORUS_FFMPEG.' in result.stderr
