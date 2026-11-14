"""Uma instância de JobManager por banco, inclusive entre processos Windows."""
from __future__ import annotations

import os
from pathlib import Path


class WorkerLock:
    def __init__(self, database: Path):
        self.path = database.with_suffix(database.suffix + ".worker.lock")
        self.handle = None

    def acquire(self):
        if self.handle is not None:
            raise RuntimeError("Trava do executor já adquirida por esta instância.")
        handle = self.path.open("a+b")
        try:
            handle.seek(0)
            if not handle.read(1):
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            handle.close()
            raise RuntimeError("Outro backend já executa tarefas neste banco do Hórus.") from error
        self.handle = handle

    def close(self):
        if self.handle:
            handle = self.handle
            self.handle = None
            try:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            finally:
                handle.close()
