"""Inventário e política de remoção dos backups de migração (`horus.backup-v<N>-<token>.sqlite3`).

Esses arquivos são cópias completas do banco operacional criadas antes de uma migração. Podem conter cópias do Radar
já redigidas no banco vivo, e a redação não os alcança. Este módulo só *lista* por padrão: a remoção real exige
`HORUS_BACKUP_RETENTION_DAYS` definida pelo operador **e** `dry_run=False`/`--apply`, e nenhum código do backend a
chama automaticamente. Os backups são abertos somente leitura (`immutable=1`: sem `-wal`/`-shm`, sem escrita).

Política (a ordem importa; a primeira regra aplicável decide):
1. versão do backup maior que o schema atual: mantido (criado por versão mais nova do Hórus);
2. backup mais recente (migração mais recente, entre as versões conhecidas) ou único: mantido sempre, mesmo vencido;
3. sem prazo configurado: mantido (remoção desligada);
4. mais novo que o prazo: mantido; do contrário: candidato à remoção.
Backups com cópias do Radar são sinalizados em qualquer caso; os mantidos pelas regras 1-3 e que contêm Radar
exigem decisão do operador.
"""
from __future__ import annotations

import logging
import json
import os
import re
import sqlite3
import sys
from contextlib import closing
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .migrations import SCHEMA_VERSION

ENV_RETENTION_DAYS = "HORUS_BACKUP_RETENTION_DAYS"
SIDECARS = ("-wal", "-shm", "-journal")
log = logging.getLogger(__name__)


@dataclass
class BackupEntry:
    name: str
    version: int
    size: int
    age_days: float
    radar_workflows: int | None  # None: ilegível ou sem tabela de workflows legível
    radar_unredacted: int | None
    action: str = "keep"  # keep | remove
    reason: str = ""
    path: Path = field(default=None, repr=False)

    def as_dict(self) -> dict:
        return {key: getattr(self, key) for key in ("name", "version", "size", "age_days", "radar_workflows",
                                                    "radar_unredacted", "action", "reason")}


@dataclass
class BackupReport:
    retention_days: int | None
    dry_run: bool
    entries: list[BackupEntry] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)

    @property
    def candidates(self) -> list[BackupEntry]:
        return [entry for entry in self.entries if entry.action == "remove"]

    @property
    def needs_operator_decision(self) -> list[str]:
        """Mantidos, mas com Radar não redigido: só o operador decide se e quando removê-los."""
        return [e.name for e in self.entries if e.action == "keep" and e.radar_unredacted]


def retention_days_from_env(environ=None) -> int | None:
    """Inteiro >= 1 ou None (desligado). Valor inválido também desliga: na dúvida, nada é removido."""
    value = (environ if environ is not None else os.environ).get(ENV_RETENTION_DAYS, "").strip()
    if not value:
        return None
    if not value.isdecimal() or int(value) < 1:
        log.warning("%s inválida; remoção de backups permanece desligada.", ENV_RETENTION_DAYS)
        return None
    return int(value)


def _pattern(database: Path) -> re.Pattern:
    return re.compile(rf"^{re.escape(database.stem)}\.backup-v(\d+)-[0-9a-f]{{32}}\.sqlite3$")


def _radar_counts(path: Path) -> tuple[int | None, int | None]:
    """Cópias do Radar (total, ainda não redigidas) no backup. Somente leitura; (None, None) se ilegível."""
    try:
        with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro&immutable=1", uri=True)) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workflows'").fetchone():
                return 0, 0
            return tuple(db.execute("""SELECT COUNT(*), COALESCE(SUM(json_extract(payload,'$.radar.redacted_at') IS NULL),0)
                FROM workflows WHERE json_extract(payload,'$.radar') IS NOT NULL""").fetchone())
    except sqlite3.Error:
        return None, None


def inventory(database: Path, *, clock=None) -> list[BackupEntry]:
    """Backups de migração ao lado do banco, do mais novo para o mais antigo. Nunca escreve."""
    now = (clock or (lambda: datetime.now(timezone.utc)))().timestamp()
    pattern, entries = _pattern(database), []
    for path in database.parent.iterdir() if database.parent.is_dir() else ():
        match = pattern.match(path.name)
        if not match or path.is_symlink() or not path.is_file():
            continue
        stat = path.stat()
        total, unredacted = _radar_counts(path)
        entries.append(BackupEntry(path.name, int(match.group(1)), stat.st_size, round(max(now - stat.st_mtime, 0) / 86400, 2),
                                   total, unredacted, path=path))
    return sorted(entries, key=lambda e: (e.path.stat().st_mtime_ns, e.name), reverse=True)


def plan(database: Path, *, retention_days: int | None, clock=None, current_version: int = SCHEMA_VERSION) -> BackupReport:
    report = BackupReport(retention_days, dry_run=True, entries=inventory(database, clock=clock))
    newest = next((e for e in report.entries if e.version <= current_version), None)
    for entry in report.entries:
        if entry.version > current_version:
            entry.reason = f"versão v{entry.version} maior que o schema atual (v{current_version}); nunca removido"
        elif entry is newest:
            entry.reason = "único backup existente" if len(report.entries) == 1 else "backup da migração mais recente"
        elif retention_days is None:
            entry.reason = f"remoção desligada ({ENV_RETENTION_DAYS} não definida)"
        elif entry.age_days < retention_days:
            entry.reason = f"dentro do prazo de {retention_days} dias"
        else:
            entry.action, entry.reason = "remove", f"mais antigo que {retention_days} dias e não é o backup mais recente"
    return report


def remove_backups(database: Path, *, retention_days: int | None, dry_run: bool = True, clock=None,
                   current_version: int = SCHEMA_VERSION) -> BackupReport:
    """Aplica a política. Sem `retention_days` ou com `dry_run=True` nada é apagado."""
    report = plan(database, retention_days=retention_days, clock=clock, current_version=current_version)
    report.dry_run = dry_run or retention_days is None
    if report.dry_run:
        return report
    for entry in report.candidates:
        try:
            for suffix in ("", *SIDECARS):
                target = entry.path.with_name(entry.path.name + suffix)
                if target.exists() or target.is_symlink():
                    target.unlink()
            report.removed.append(entry.name)
        except OSError as error:
            report.errors.append({"backup": entry.name, "error": type(error).__name__})
    return report


def _readonly(path: Path):
    """Sem sidecars criados nem WAL ignorado: exige arquivo estável/checkpointado."""
    if path.is_symlink() or not path.is_file():
        raise ValueError('Banco ausente ou link; escolha um arquivo SQLite regular.')
    for suffix in ('-wal', '-journal'):
        sidecar = path.with_name(path.name + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            raise ValueError('Há WAL/journal pendente; feche o aplicativo e conclua o checkpoint antes de verificar.')
    return sqlite3.connect(f'{path.resolve().as_uri()}?mode=ro&immutable=1', uri=True)


def _inspect(db) -> dict:
    integrity = [row[0] for row in db.execute('PRAGMA integrity_check')]
    version = db.execute('PRAGMA user_version').fetchone()[0]
    tables = {}
    if integrity == ['ok']:
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
            quoted = '"' + name.replace('"', '""') + '"'
            tables[name] = db.execute(f'SELECT COUNT(*) FROM {quoted}').fetchone()[0]
    return dict(ok=integrity == ['ok'], integrity_check=integrity, user_version=version, tables=tables)


def inspect_database(path: Path) -> dict:
    try:
        with closing(_readonly(path)) as db:
            return _inspect(db)
    except (OSError, ValueError, sqlite3.Error) as error:
        # Mensagens SQLite e caminhos privados não são propagados.
        detail = str(error) if isinstance(error, ValueError) else 'Banco ilegível ou corrompido; preserve o original e escolha outra cópia.'
        return dict(ok=False, integrity_check=[], user_version=None, tables={}, error=detail)


def verify(database: Path) -> dict:
    """Compara snapshots locais; diferenças de contagem não significam corrupção."""
    current = inspect_database(database)
    backups = []
    for entry in inventory(database):
        snapshot = inspect_database(entry.path)
        comparison = None
        if snapshot['ok'] and current['ok']:
            comparison = {name: {'backup': snapshot['tables'].get(name), 'current': current['tables'].get(name),
                                 'delta': current['tables'][name] - snapshot['tables'][name]
                                 if name in current['tables'] and name in snapshot['tables'] else None}
                          for name in sorted(snapshot['tables'].keys() | current['tables'].keys())}
        backups.append(dict(name=entry.name, **snapshot, comparison=comparison))
    return dict(ok=current['ok'] and all(b['ok'] for b in backups), current=current, backups=backups)


def restore(backup: Path, destination: Path) -> dict:
    """Copia SQLite íntegro para arquivo exclusivo; nunca migra ou altera a origem."""
    if destination.exists() or destination.is_symlink() or any(
            destination.with_name(destination.name + suffix).exists()
            or destination.with_name(destination.name + suffix).is_symlink() for suffix in SIDECARS):
        raise ValueError('Destino ou sidecar já existe; escolha um arquivo novo, nunca o banco operacional.')
    with closing(_readonly(backup)) as source:
        before = _inspect(source)
        if not before['ok']:
            raise ValueError('Backup sem integridade; nenhum destino foi criado.')
        # O_EXCL evita sobrescrever inclusive se outro processo criar o destino.
        with destination.open('xb'):
            pass
        with closing(sqlite3.connect(destination)) as target:
            source.backup(target)
            after = _inspect(target)
        if after != before:
            raise ValueError('A cópia não passou na verificação; preserve os arquivos e não use o destino.')
    return dict(ok=True, **{key: after[key] for key in ('integrity_check', 'user_version', 'tables')},
                instruction='Com o aplicativo fechado, guarde o horus.sqlite3 atual e seus sidecars juntos em uma pasta de segurança; copie manualmente o arquivo restaurado para horus.sqlite3 na pasta de dados configurada, sem misturar sidecars antigos. A abertura pelo Hórus pode migrar a cópia; confira os dados antes de qualquer troca definitiva.')


def verification_main(argv: list[str]) -> int:
    import argparse
    parser = argparse.ArgumentParser(description='Verificação e restauração local sem sobrescrita.')
    parser.add_argument('command', choices=('verify', 'restore'))
    parser.add_argument('database', type=Path)
    parser.add_argument('--to', type=Path)
    parser.add_argument('--json', action='store_true', help='Somente JSON, sem resumo textual.')
    args = parser.parse_args(argv)
    if (args.command == 'restore') != (args.to is not None):
        parser.error('restore exige --to; verify não aceita --to')
    try:
        report = verify(args.database) if args.command == 'verify' else restore(args.database, args.to)
    except (OSError, ValueError, sqlite3.Error) as error:
        report = dict(ok=False, error=str(error) if isinstance(error, ValueError)
                      else 'Operação recusada ou banco ilegível; nenhum arquivo existente foi sobrescrito.')
    if not args.json:
        print('Verificação concluída.' if report['ok'] else 'Verificação falhou; preserve os arquivos e confira os erros.')
        if args.command == 'verify':
            print(f"Backups encontrados: {len(report.get('backups', []))}; diferenças de contagem podem ser esperadas entre versões.")
        if report.get('instruction'):
            print(report['instruction'])
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['ok'] else 1


def main(argv: list[str]) -> int:
    """`python -m horus_backend.backups <banco> [--apply]`: lista (dry-run); remove só com `--apply` e a variável de ambiente."""
    if argv and argv[0] in {'verify', 'restore'}:
        return verification_main(argv)
    args = [arg for arg in argv if arg != "--apply"]
    if len(args) != 1:
        print("uso: python -m horus_backend.backups <caminho do horus.sqlite3> [--apply]", file=sys.stderr)
        return 2
    days = retention_days_from_env()
    apply = "--apply" in argv
    if apply and days is None:
        print(f"--apply ignorado: defina {ENV_RETENTION_DAYS} (inteiro >= 1).", file=sys.stderr)
    report = remove_backups(Path(args[0]), retention_days=days, dry_run=not apply)
    print(f"retention_days={days} dry_run={report.dry_run}")
    for entry in report.entries:
        radar = "?" if entry.radar_workflows is None else f"{entry.radar_workflows}/{entry.radar_unredacted}"
        print(f"{entry.action:6} {entry.name} v{entry.version} {entry.size}B {entry.age_days}d radar(total/não redigido)={radar} - {entry.reason}")
    for name in report.removed:
        print(f"removido {name}")
    for error in report.errors:
        print(f"erro {error['backup']}: {error['error']}", file=sys.stderr)
    return 1 if report.errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
