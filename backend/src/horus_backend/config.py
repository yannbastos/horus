from __future__ import annotations

import os
import re
import shutil
import sys
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path


def default_data_dir() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "Horus" / "workspace"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "horus"


def discover_factory() -> Path | None:
    # FABRICA_HOME é a variável oficial; HORUS_PILOT_FACTORY (usada pelos ensaios e testes) é aceita como alias e só
    # vale quando FABRICA_HOME está ausente ou vazia.
    configured = os.environ.get("FABRICA_HOME") or os.environ.get("HORUS_PILOT_FACTORY")
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


def operator_limit(name: str, default: int) -> int | None:
    value = os.environ.get(name)
    if value is None:
        return default
    return int(value) if value.isascii() and value.isdigit() and len(value) < 12 and int(value) > 0 else None


def positive_decimal(value) -> Decimal | None:
    """Configuração monetária exata e limitada; vazio/inválido nunca usa o padrão."""
    if not isinstance(value, (str, Decimal, int)) or isinstance(value, bool):
        return None
    raw = format(value, 'f') if isinstance(value, Decimal) and value.is_finite() else str(value)
    if len(raw) > 40 or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', raw):
        return None
    amount = Decimal(raw)
    return amount if 0 < amount <= Decimal('1000000000000') and amount.as_tuple().exponent >= -12 else None


def operator_decimal(name: str, default: str | None = None) -> Decimal | None:
    return positive_decimal(os.environ.get(name, default))


def hermes_profile_dir() -> Path:
    from .security import profile_default
    return Path(os.environ.get("HORUS_HERMES_PROFILE", profile_default())).expanduser()


def frontend_origins() -> tuple[str, ...]:
    origins = (
        "http://localhost:1420", "http://127.0.0.1:1420",
        "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost",
    )
    extra = os.environ.get("HORUS_FRONTEND_ORIGIN")
    if extra is not None:
        match = re.fullmatch(r"http://(?:127\.0\.0\.1|localhost):([0-9]{1,5})", extra)
        if not match or not 1 <= int(match[1]) <= 65535:
            raise ValueError("HORUS_FRONTEND_ORIGIN deve ser http://127.0.0.1:porta ou http://localhost:porta (1..65535)")
        origins += (extra,)
    return origins


@dataclass(frozen=True)
class Settings:
    token: str
    data_dir: Path = field(default_factory=default_data_dir)
    factory_root: Path | None = field(default_factory=discover_factory)
    # Pasta de modelos preparada pelo operador; nunca baixar durante produção.
    alignment_model: Path | None = field(default_factory=lambda: (
        Path(os.environ["HORUS_ALIGNMENT_MODEL"]).expanduser() if os.environ.get("HORUS_ALIGNMENT_MODEL") else None))
    # Ferramenta/fonte locais preparadas fora do job; sem instalação ou PATH global.
    ffmpeg: Path | None = field(default_factory=lambda: Path(os.environ["HORUS_FFMPEG"]).expanduser() if os.environ.get("HORUS_FFMPEG") else None)
    subtitle_font: Path | None = field(default_factory=lambda: Path(os.environ["HORUS_SUBTITLE_FONT"]).expanduser() if os.environ.get("HORUS_SUBTITLE_FONT") else None)
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
    max_tokens_per_run: int | None = field(default_factory=lambda: operator_limit("HORUS_MAX_TOKENS_PER_RUN", 16384))
    max_tokens_per_day: int | None = field(default_factory=lambda: operator_limit("HORUS_MAX_TOKENS_PER_DAY", 32768))
    max_runs_per_day: int | None = field(default_factory=lambda: operator_limit("HORUS_MAX_RUNS_PER_DAY", 2))
    budget_total_usd: Decimal | None = field(default_factory=lambda: operator_decimal("HORUS_BUDGET_TOTAL_USD", "5"))
    budget_daily_usd: Decimal | None = field(default_factory=lambda: operator_decimal("HORUS_BUDGET_DAILY_USD", "1"))
    price_input_usd_per_mtok: Decimal | None = field(default_factory=lambda: operator_decimal("HORUS_PRICE_INPUT_USD_PER_MTOK"))
    price_output_usd_per_mtok: Decimal | None = field(default_factory=lambda: operator_decimal("HORUS_PRICE_OUTPUT_USD_PER_MTOK"))
    narration_paid_enabled: bool = field(default_factory=lambda: os.environ.get("HORUS_NARRATION_PAID_ENABLED") == "1")
    elevenlabs_price_per_1k_chars: Decimal | None = field(default_factory=lambda: operator_decimal("HORUS_ELEVENLABS_PRICE_PER_1K_CHARS"))
    elevenlabs_currency: str | None = field(default_factory=lambda: os.environ.get("HORUS_ELEVENLABS_CURRENCY"))
    piper_executable: Path | None = field(default_factory=lambda: Path(os.environ["HORUS_PIPER_EXECUTABLE"]).expanduser() if os.environ.get("HORUS_PIPER_EXECUTABLE") else None)
    piper_models: Path | None = field(default_factory=lambda: Path(os.environ["HORUS_PIPER_MODELS"]).expanduser() if os.environ.get("HORUS_PIPER_MODELS") else None)
    kokoro_python: Path | None = field(default_factory=lambda: Path(os.environ["HORUS_KOKORO_PYTHON"]).expanduser() if os.environ.get("HORUS_KOKORO_PYTHON") else None)
    kokoro_model_dir: Path | None = field(default_factory=lambda: Path(os.environ["HORUS_KOKORO_MODEL_DIR"]).expanduser() if os.environ.get("HORUS_KOKORO_MODEL_DIR") else None)
    hermes_poll_seconds: float = 2.0
    hermes_run_timeout: float = 900.0
    origins: tuple[str, ...] = field(default_factory=frontend_origins)

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
