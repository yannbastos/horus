"""Regenera os JSON Schemas versionados a partir dos modelos. Uso:

    backend/.venv/Scripts/python.exe contracts/hermes/generate_schemas.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent.parent / 'backend' / 'src'))

from horus_backend.hermes_contract.models import SCHEMAS  # noqa: E402


def render(model) -> str:
    return json.dumps(model.model_json_schema(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    for name, model in SCHEMAS.items():
        (ROOT / "schemas" / name).write_text(render(model), encoding="utf-8", newline="\n")
        print(f"schemas/{name}")
