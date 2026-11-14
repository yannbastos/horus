"""Posse e cancelamento dos subprocessos; nunca encerrar processos encontrados por nome."""
from __future__ import annotations

import asyncio
import ctypes
import os
import signal
import re
import time


def sanitized_tail(value, *, private=(), limit=8192):
    """Diagnóstico limitado; nunca persistir entradas de roteiro, tokens ou caminhos locais."""
    text = value.decode('utf-8', errors='replace') if isinstance(value, bytes) else str(value or '')
    for item in sorted((str(v) for v in private if v), key=len, reverse=True):
        text = text.replace(item, '[conteúdo omitido]')
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    text = re.sub(r'''(?i)\b(?:authorization["']?\s*[=:]\s*["']?(?:bearer\s+)?|bearer\s+|[\w-]*(?:api[_-]?key|token|secret|password)["']?\s*[=:]\s*["']?)[^\s,;"']+''', '[credencial omitida]', text)
    text = re.sub(r'''(?i)(?:[a-z]:[\\/]|\\\\|/(?=[\w.~-]))[^\r\n<>"']+''', '[caminho omitido]', text)
    # Tracebacks exibem linhas de código que podem conter entradas privadas.
    text = re.sub(r'(?m)^\s*(?:File |Traceback|\^|.*(?:"text"|"narration")\s*:).*$', '[conteúdo omitido]', text)
    text = ''.join(c for c in text if c in '\n\t' or ord(c) >= 32)
    return text.encode('utf-8')[-limit:].decode('utf-8', errors='ignore')


def failure_detail(code, stage, *, started=None, error=None, stderr=None, private=(), exit_code=None):
    return {'code': code, 'stage': stage, 'type': type(error).__name__ if error else 'ProcessError',
            'exit_code': exit_code if exit_code is not None else getattr(error, 'returncode', None),
            'duration_seconds': round(max(0, time.monotonic()-started), 3) if started is not None else None,
            'stderr_tail': sanitized_tail(stderr if stderr is not None else getattr(error, 'stderr', ''), private=private),
            'stderr_limit_bytes': 8192}


class ProductionFailure(ValueError):
    def __init__(self, code, stage, message, **diagnostic):
        self.detail = failure_detail(code, stage, **diagnostic)
        super().__init__(message)


class ProductionTimeout(TimeoutError):
    def __init__(self, code, stage, message, **diagnostic):
        self.detail = failure_detail(code, stage, **diagnostic)
        super().__init__(message)


class WindowsJob:
    def __init__(self, pid: int):
        from ctypes import wintypes as w

        class Basic(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", w.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", w.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", w.DWORD), ("SchedulingClass", w.DWORD)]

        class Io(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class Extended(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", Io),
                        ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = w.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        self.kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
        self.kernel.OpenProcess.restype = w.HANDLE
        self.kernel.CloseHandle.argtypes = [w.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = Extended()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        process = None
        try:
            if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise ctypes.WinError(ctypes.get_last_error())
            process = self.kernel.OpenProcess(0x0101, False, pid)  # SET_QUOTA | TERMINATE
            if not process or not self.kernel.AssignProcessToJobObject(self.handle, process):
                raise ctypes.WinError(ctypes.get_last_error())
        except BaseException:
            self.close()
            raise
        finally:
            if process:
                self.kernel.CloseHandle(process)

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class OwnedProcess:
    def __init__(self, process: asyncio.subprocess.Process, job: WindowsJob | None):
        self.process, self.job = process, job

    @classmethod
    async def start(cls, command: list[str], **kwargs):
        options = {"creationflags": 0x08000000} if os.name == "nt" else {"start_new_session": True}
        process = await asyncio.create_subprocess_exec(
            *command, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            limit=1024 * 1024, **options, **kwargs)
        try:
            return cls(process, WindowsJob(process.pid) if os.name == "nt" else None)
        except BaseException:
            if process.returncode is None:
                process.kill()
            await process.wait()
            raise

    async def stop(self):
        if self.job:
            self.job.close()
        elif os.name != 'nt':
            # O líder pode ter terminado deixando filhos no grupo que criamos.
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        try:
            await asyncio.wait_for(self.process.wait(), timeout=3)
        except TimeoutError:
            if os.name != "nt":
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            elif self.process.returncode is None:
                self.process.kill()
            await self.process.wait()
        if os.name != 'nt':
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def close(self):
        if self.job:
            self.job.close()
