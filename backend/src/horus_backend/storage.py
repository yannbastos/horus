from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .migrations import migrate


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        migrate(path)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def job(row):
        if row is None:
            return None
        item = dict(row)
        item["payload"] = json.loads(item["payload"])
        item["result"] = json.loads(item["result"]) if item["result"] else None
        item.pop("idempotency_key")
        return item

    def create_job(self, payload: dict, key: str) -> tuple[dict, bool]:
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM jobs WHERE idempotency_key=?", (key,)).fetchone()
            if existing:
                if existing["payload"] != encoded:
                    raise ValueError("A chave de idempotência já foi usada com outra entrada.")
                return self.job(existing), False
            job_id, timestamp = uuid.uuid4().hex, now()
            db.execute("INSERT INTO jobs(id,idempotency_key,payload,status,created_at,updated_at) VALUES(?,?,?,'queued',?,?)",
                       (job_id, key, encoded, timestamp, timestamp))
            return self.job(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()), True

    def get_job(self, job_id: str):
        with self.connect() as db:
            return self.job(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def list_jobs(self):
        with self.connect() as db:
            return [self.job(row) for row in db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100")]

    def queued_ids(self):
        with self.connect() as db:
            return [row[0] for row in db.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at")]

    def update(self, job_id: str, status: str, *, result=None, error=None, new_attempt=False):
        with self.connect() as db:
            db.execute("UPDATE jobs SET status=?,updated_at=?,result=?,error=?,attempt=attempt+? WHERE id=?",
                       (status, now(), json.dumps(result, ensure_ascii=False) if result is not None else None,
                        error, int(new_attempt), job_id))

    def event(self, job_id: str, kind: str, message: str):
        with self.connect() as db:
            db.execute("INSERT INTO events(job_id,kind,message,created_at) VALUES(?,?,?,?)",
                       (job_id, kind, message[:2000], now()))
            db.execute("DELETE FROM events WHERE job_id=? AND sequence NOT IN (SELECT sequence FROM events WHERE job_id=? ORDER BY sequence DESC LIMIT 2000)",
                       (job_id, job_id))

    def events(self, job_id: str, after: int):
        with self.connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT * FROM events WHERE job_id=? AND sequence>? ORDER BY sequence LIMIT 200", (job_id, after))]

    def recover(self):
        with self.connect() as db:
            rows = db.execute("SELECT id FROM jobs WHERE workflow_id IS NULL AND status IN ('running','cancel_requested')").fetchall()
        for row in rows:
            self.update(row["id"], "interrupted", error="Execução interrompida. Revise antes de tentar novamente.")
            self.event(row["id"], "state", "interrupted")

    def register_media(self, path: Path):
        stat = path.stat()
        with self.connect() as db:
            db.execute("INSERT INTO media VALUES(?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET size=excluded.size,modified_ns=excluded.modified_ns,created_at=excluded.created_at",
                       (uuid.uuid4().hex, str(path), path.name, stat.st_size, stat.st_mtime_ns, now()))
            return dict(db.execute("SELECT * FROM media WHERE path=?", (str(path),)).fetchone())

    def media(self, media_id: str):
        with self.connect() as db:
            row = db.execute("SELECT * FROM media WHERE id=?", (media_id,)).fetchone()
            return dict(row) if row else None

    def list_media(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM media ORDER BY created_at DESC LIMIT 100")]
