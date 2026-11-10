from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path


def default_data_dir() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "Horus" / "workspace"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "horus"


def discover_factory() -> Path | None:
    configured = os.environ.get("FABRICA_HOME")
    if configured:
        return Path(configured).expanduser().resolve()
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "fabrica-canais"
        if (candidate / "scripts/pyproject.toml").is_file():
            return candidate
    return None


@dataclass(frozen=True)
class Settings:
    token: str
    data_dir: Path = field(default_factory=default_data_dir)
    factory_root: Path | None = field(default_factory=discover_factory)
    # Apenas configuração do operador/testes. Nunca aceitar executável vindo da API.
    factory_command: tuple[str, ...] | None = None
    origins: tuple[str, ...] = (
        "http://localhost:1420", "http://127.0.0.1:1420",
        "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost",
    )

    def command(self) -> tuple[str, ...] | None:
        if self.factory_command:
            return self.factory_command
        if self.factory_root:
            interpreter = self.factory_root / "scripts/.venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            if interpreter.is_file():
                return str(interpreter), "-m", "fabrica.cli"
        executable = shutil.which("fabrica")
        return (executable,) if executable else None
