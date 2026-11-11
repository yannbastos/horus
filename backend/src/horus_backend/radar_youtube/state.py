"""Cache/cota/datasets do coletor isolado. Nunca abre o SQLite operacional."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3

from .models import Dataset

def utcnow():
    return datetime.now(timezone.utc)

class BudgetExceeded(RuntimeError):
    pass

class RadarState:
    def __init__(self, path: Path, *, clock=utcnow):
        path = Path(path)
        if path.name != 'radar-youtube.sqlite3' or path.is_symlink():
            raise ValueError('Use somente um arquivo dedicado radar-youtube.sqlite3, sem symlink.')
        self.path, self.clock = path, clock
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if tables - {'radar_cache', 'radar_usage', 'radar_blocks', 'radar_datasets'}:
                raise ValueError('Arquivo contém outro banco; recusa de alteração.')
            db.execute('CREATE TABLE IF NOT EXISTS radar_cache(key TEXT PRIMARY KEY, fetched TEXT NOT NULL, expires REAL NOT NULL, payload TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS radar_usage(id TEXT PRIMARY KEY, at REAL NOT NULL, bucket TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS radar_blocks(bucket TEXT PRIMARY KEY, until REAL NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS radar_datasets(id TEXT NOT NULL, revision INTEGER NOT NULL, expires REAL NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,revision))')
        self.purge()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.execute('PRAGMA secure_delete=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def purge(self):
        now = self.clock().timestamp()
        with self.connect() as db:
            db.execute('DELETE FROM radar_cache WHERE expires<=?', (now,))
            db.execute('DELETE FROM radar_datasets WHERE expires<=?', (now,))
            db.execute('DELETE FROM radar_usage WHERE at<=?', (now - 26 * 3600,))
            db.execute('DELETE FROM radar_blocks WHERE until<=?', (now,))

    def cached(self, key):
        self.purge()
        with self.connect() as db:
            row = db.execute('SELECT payload,fetched FROM radar_cache WHERE key=?', (key,)).fetchone()
        return (json.loads(row[0]), datetime.fromisoformat(row[1])) if row else None

    def cache(self, key, payload, fetched, hours):
        if not 0 < hours <= 24:
            raise ValueError('Cache deve durar até 24 horas.')
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO radar_cache VALUES(?,?,?,?)',
                       (key, fetched.isoformat(), (fetched + timedelta(hours=hours)).timestamp(), json.dumps(payload, ensure_ascii=False)))

    def reserve(self, bucket, limit):
        """Janela móvel conservadora de 26h; não presume regras DST nem reinicia por processo."""
        import uuid
        self.purge()
        now = self.clock().timestamp()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM radar_blocks WHERE bucket=? AND until>?', (bucket, now)).fetchone():
                raise BudgetExceeded('Cota bloqueada após recusa do servidor; aguarde a janela local.')
            used = db.execute('SELECT COUNT(*) FROM radar_usage WHERE bucket=? AND at>?', (bucket, now - 26 * 3600)).fetchone()[0]
            if used >= limit:
                raise BudgetExceeded('Limite local da janela móvel de 26h atingido.')
            db.execute('INSERT INTO radar_usage VALUES(?,?,?)', (uuid.uuid4().hex, now, bucket))

    def block(self, bucket):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO radar_blocks VALUES(?,?)',
                       (bucket, (self.clock() + timedelta(hours=26)).timestamp()))

    def invalidate(self, kind, identifiers):
        """Remove cópias gerenciadas antigas quando a consulta atual não retorna um recurso."""
        with self.connect() as db:
            for key, payload in db.execute('SELECT key,payload FROM radar_cache').fetchall():
                if any(item.get('id') in identifiers for item in json.loads(payload).get('items', [])):
                    db.execute('DELETE FROM radar_cache WHERE key=?', (key,))
            for identifier, revision, payload in db.execute('SELECT id,revision,payload FROM radar_datasets').fetchall():
                if any(item['kind'] == kind and item['youtube_id'] in identifiers for item in json.loads(payload)['records']):
                    db.execute('DELETE FROM radar_datasets WHERE id=? AND revision=?', (identifier, revision))

    def save(self, dataset: Dataset):
        if dataset.expires_at <= self.clock():
            raise ValueError('Não é permitido salvar dataset expirado.')
        with self.connect() as db:
            db.execute('INSERT INTO radar_datasets VALUES(?,?,?,?)',
                       (dataset.snapshot_id, dataset.revision, dataset.expires_at.timestamp(), dataset.model_dump_json()))

    def load(self, snapshot_id, revision):
        self.purge()
        with self.connect() as db:
            row = db.execute('SELECT payload FROM radar_datasets WHERE id=? AND revision=?', (snapshot_id, revision)).fetchone()
        if not row:
            raise KeyError('Dataset ausente ou expirado.')
        return Dataset.model_validate_json(row[0])
