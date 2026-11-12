from __future__ import annotations

import os
import shutil
import sys
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


def discover_hermes() -> Path | None:
    configured = os.environ.get("HORUS_HERMES_EXECUTABLE")
    if configured:
        path = Path(configured).expanduser()
        return path if path.is_file() else None
    executable = shutil.which("hermes")
    if executable:
        return Path(executable)
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            path = Path(local) / "hermes/bin/hermes.exe"
            if path.is_file():
                return path
    return None


def hermes_connection_file() -> Path:
    return Path(os.environ.get("HORUS_HERMES_CONFIG", default_data_dir() / "integrations/hermes.json"))


def operator_limit(name: str) -> int | None:
    value = os.environ.get(name, "")
    return int(value) if value.isascii() and value.isdigit() and len(value) < 12 else None


def hermes_profile_dir() -> Path:
    from .security import profile_default
    return Path(os.environ.get("HORUS_HERMES_PROFILE", profile_default())).expanduser()


@dataclass(frozen=True)
class Settings:
    token: str
    data_dir: Path = field(default_factory=default_data_dir)
    factory_root: Path | None = field(default_factory=discover_factory)
    # Apenas configuração do operador/testes. Nunca aceitar executável vindo da API.
    factory_command: tuple[str, ...] | None = None
    # Somente testes substituem o subprocesso de transcrição/download.
    worker_command: tuple[str, ...] | None = None
    hermes_executable: Path | None = field(default_factory=discover_hermes)
    hermes_config: Path = field(default_factory=hermes_connection_file)
    # Executor dos novos workflows editoriais; definido pelo operador, nunca pelo payload da API.
    workflow_executor: str = field(default_factory=lambda: os.environ.get("HORUS_WORKFLOW_EXECUTOR", "simulated"))
    radar_executor: str = field(default_factory=lambda: os.environ.get("HORUS_RADAR_EXECUTOR", "hermes_simulated"))
    hermes_profile: Path = field(default_factory=hermes_profile_dir)
    max_tokens_per_run: int | None = field(default_factory=lambda: operator_limit("HORUS_MAX_TOKENS_PER_RUN"))
    max_tokens_per_day: int | None = field(default_factory=lambda: operator_limit("HORUS_MAX_TOKENS_PER_DAY"))
    hermes_poll_seconds: float = 2.0
    hermes_run_timeout: float = 900.0
    origins: tuple[str, ...] = (
        "http://localhost:1420", "http://127.0.0.1:1420",
        "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost",
    )

    def worker(self) -> tuple[str, ...]:
        if self.worker_command:
            return self.worker_command
        return (sys.executable,) if getattr(sys, "frozen", False) else (sys.executable, "-m", "horus_backend")

    def command(self) -> tuple[str, ...] | None:
        if self.factory_command:
            return self.factory_command
        if self.factory_root:
            interpreter = self.factory_root / "scripts/.venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            if interpreter.is_file():
                return str(interpreter), "-m", "fabrica.cli"
        executable = shutil.which("fabrica")
        return (executable,) if executable else None
