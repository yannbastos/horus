"""Migrações locais transacionais. Não abrir o banco operacional durante testes."""
from __future__ import annotations

import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

SCHEMA_VERSION = 6
MIGRATIONS = {
    1: (
        """CREATE TABLE jobs (
            id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL,
            payload TEXT NOT NULL, status TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0, result TEXT, error TEXT)""",
        """CREATE TABLE events (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL REFERENCES jobs(id), kind TEXT NOT NULL,
            message TEXT NOT NULL, created_at TEXT NOT NULL)""",
        "CREATE INDEX events_job ON events(job_id, sequence)",
        """CREATE TABLE media (
            id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
            size INTEGER NOT NULL, modified_ns INTEGER NOT NULL, created_at TEXT NOT NULL)""",
    ),
    2: (
        """CREATE TABLE workflows (
            id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL,
            payload TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
            status TEXT NOT NULL CHECK(status IN ('queued','running','awaiting_approval',
                'approved','rejected','cancel_requested','cancelled','interrupted','failed')),
            feedback TEXT NOT NULL DEFAULT '', current_artifact_id TEXT REFERENCES artifacts(id),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
        "ALTER TABLE jobs ADD COLUMN workflow_id TEXT REFERENCES workflows(id)",
        "ALTER TABLE jobs ADD COLUMN workflow_revision INTEGER",
        "ALTER TABLE jobs ADD COLUMN step_key TEXT",
        "ALTER TABLE jobs ADD COLUMN step_index INTEGER",
        "ALTER TABLE jobs ADD COLUMN depends_on TEXT REFERENCES jobs(id)",
        "CREATE UNIQUE INDEX workflow_steps ON jobs(workflow_id, workflow_revision, step_key)",
        """CREATE TABLE job_attempts (
            id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
            number INTEGER NOT NULL CHECK(number > 0),
            status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted','cancelled')),
            executor TEXT NOT NULL, input_hash TEXT NOT NULL, input_artifacts TEXT NOT NULL,
            started_at TEXT NOT NULL, finished_at TEXT, result TEXT, error TEXT,
            UNIQUE(job_id, number))""",
        """CREATE TABLE artifacts (
            id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id),
            revision INTEGER NOT NULL, stage TEXT NOT NULL,
            job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
            attempt_id TEXT NOT NULL REFERENCES job_attempts(id),
            schema_version INTEGER NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL, UNIQUE(workflow_id, revision, stage))""",
        """CREATE TABLE approvals (
            id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id),
            revision INTEGER NOT NULL, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
            decision TEXT NOT NULL CHECK(decision IN ('approve','reject','request_changes')),
            feedback TEXT NOT NULL, operator_id TEXT NOT NULL, scope TEXT NOT NULL,
            idempotency_key TEXT NOT NULL, request TEXT NOT NULL, created_at TEXT NOT NULL,
            UNIQUE(workflow_id, idempotency_key))""",
        """CREATE TABLE workflow_events (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            workflow_id TEXT NOT NULL REFERENCES workflows(id), revision INTEGER NOT NULL,
            kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)""",
        "CREATE INDEX workflow_event_cursor ON workflow_events(workflow_id, sequence)",
    ),
    # Executor cognitivo externo: somente acréscimos, sem reconstruir tabelas existentes.
    3: (
        """ALTER TABLE workflows ADD COLUMN executor TEXT NOT NULL DEFAULT 'simulated'
            CHECK(executor IN ('simulated','hermes'))""",
        """CREATE TABLE cognitive_runs (
            id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
            attempt_id TEXT NOT NULL REFERENCES job_attempts(id),
            provider TEXT NOT NULL CHECK(provider IN ('hermes')),
            idempotency_key TEXT NOT NULL UNIQUE, request TEXT NOT NULL, request_hash TEXT NOT NULL,
            external_ref TEXT,
            status TEXT NOT NULL CHECK(status IN ('submitting','admitted','completed','failed',
                'cancelled','interrupted','unknown','policy_violation','invalid_output')),
            remote_status TEXT, usage TEXT, error TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
        "CREATE INDEX cognitive_runs_job ON cognitive_runs(job_id, created_at)",
        """CREATE TABLE authorizations (
            id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id),
            revision INTEGER NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id),
            input_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
            scope TEXT NOT NULL CHECK(scope IN ('cognitive_run')),
            max_runs INTEGER NOT NULL CHECK(max_runs = 1),
            operator_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request TEXT NOT NULL,
            consumed_attempt_id TEXT REFERENCES job_attempts(id), created_at TEXT NOT NULL,
            UNIQUE(workflow_id, idempotency_key))""",
    ),
    4: (
        """ALTER TABLE workflows ADD COLUMN cognitive_client TEXT NOT NULL DEFAULT 'live'
            CHECK(cognitive_client IN ('live','simulated'))""",
    ),
    5: (
        """CREATE TABLE scripts (
            id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id),
            workflow_revision INTEGER NOT NULL, proposal_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
            proposal_content_hash TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
            status TEXT NOT NULL CHECK(status IN ('awaiting_review','approved','rejected','changes_requested')),
            document TEXT NOT NULL, created_at TEXT NOT NULL, review TEXT,
            UNIQUE(workflow_id, version))""",
        """CREATE TABLE script_receipts (
            scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, request TEXT NOT NULL,
            response TEXT NOT NULL, PRIMARY KEY(scope, idempotency_key))""",
    ),
    6: (
        """CREATE TABLE productions (
            id TEXT PRIMARY KEY, script_id TEXT NOT NULL REFERENCES scripts(id),
            script_version INTEGER NOT NULL, script_content_hash TEXT NOT NULL,
            script_review TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
            mode TEXT NOT NULL CHECK(mode IN ('simulated','local_demo')),
            plan TEXT NOT NULL, artifacts TEXT NOT NULL DEFAULT '[]', review TEXT,
            created_at TEXT NOT NULL)""",
        """CREATE TABLE production_receipts (
            scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, request TEXT NOT NULL,
            production_id TEXT NOT NULL REFERENCES productions(id),
            PRIMARY KEY(scope,idempotency_key))""",
    ),
}


def migrate(path: Path):
    db = sqlite3.connect(path, timeout=5)
    try:
        if db.execute("PRAGMA user_version").fetchone()[0] > SCHEMA_VERSION:
            raise RuntimeError("Banco criado por uma versão mais recente do Hórus. Migração recusada.")
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("BEGIN IMMEDIATE")
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError("Versão de banco incompatível.")
        if version == 0 and db.execute("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").fetchone():
            raise RuntimeError("Banco sem versão e com tabelas existentes. Revisão manual necessária.")
        if 0 < version < SCHEMA_VERSION:
            # Outra conexão lê a versão anterior enquanto BEGIN IMMEDIATE impede novos escritores.
            # backup() na própria conexão com transação de escrita poderia bloquear.
            backup = path.with_name(f"{path.stem}.backup-v{version}-{uuid.uuid4().hex}.sqlite3")
            with closing(sqlite3.connect(path)) as source, closing(sqlite3.connect(backup)) as target:
                source.backup(target)
        for target_version in range(version + 1, SCHEMA_VERSION + 1):
            # Não usar executescript(): ele pode encerrar a transação implicitamente.
            for statement in MIGRATIONS[target_version]:
                db.execute(statement)
            db.execute(f"PRAGMA user_version={target_version}")
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
