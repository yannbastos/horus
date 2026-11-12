"""Hermes simulado para testes de contrato. Somente biblioteca padrão, somente 127.0.0.1.

Reproduz o formato conferido no código do Hermes 0.23.1 instalado:
- ``POST /v1/runs`` -> 202 ``{"run_id", "status", "replayed"}`` e cabeçalho ``Idempotency-Replayed``;
  mesma chave com outro corpo -> 409 ``idempotency_key_conflict``; chave inválida -> 400;
  limite de execuções simultâneas -> 429.
- ``GET /v1/runs/{id}``, ``GET /v1/runs/{id}/events`` (SSE com ``id:`` e ``data: {"event": ...}``),
  ``POST /v1/runs/{id}/stop`` (``stopping`` e depois ``cancelled``; 409 ``run_not_active``).
- Erros no envelope ``{"error": {"message", "type", "param", "code"}}``.

Simplificações (NÃO são comportamento comprovado do Hermes real):
- A execução é resolvida imediatamente na admissão, conforme o ``Scenario``; não há modelo.
- O fluxo de eventos devolve o histórico e fecha; o real mantém a conexão com keepalive.
- ``restart()`` modela a hipótese de que execuções sem chave somem e as com chave preservam o
  último status persistido sem progredir. O real não foi testado em reinício.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from collections import deque
from typing import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ACTIVE = {"queued", "running", "waiting_for_approval", "stopping"}
TERMINAL = {"completed", "failed", "cancelled", "interrupted"}


@dataclass
class Scenario:
    """Como a próxima execução admitida se comporta."""
    output: str | Callable[[dict], str] = ""   # pode derivar do corpo enviado (ex.: ecoar task_id)
    final_status: str = "completed"            # completed | failed | interrupted
    turn_exit_reason: str | None = None        # ex.: "max_iterations"
    hold: bool = False                         # fica em "running" até /stop
    request_approval: bool = False             # para em "waiting_for_approval"
    tools: tuple[str, ...] = ()                # nomes emitidos em tool.started/tool.completed
    usage: dict = field(default_factory=lambda: {
        "input_tokens": 1200, "output_tokens": 800, "total_tokens": 2000,
        "cache_read_tokens": 0, "cache_write_tokens": 0})


@dataclass
class Run:
    run_id: str
    keyed: bool
    status: str = "queued"
    events: list = field(default_factory=list)
    output: str | None = None
    error: str | None = None
    usage: dict | None = None
    body: dict = field(default_factory=dict)
    scenario: Scenario | None = None
    flags: dict = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)


class FakeHermes:
    def __init__(self, token: str = "test-hermes-key-0123456789abcdef", max_concurrent_runs: int = 1):
        self.token, self.max_concurrent_runs = token, max_concurrent_runs
        self.scenarios: deque[Scenario] = deque()
        self.default = Scenario(output="{}")
        self.runs: dict[str, Run] = {}
        self.idempotency: dict[str, tuple[str, str]] = {}  # chave -> (impressão do corpo, run_id)
        self.requests: list[dict] = []
        self.lock = threading.Lock()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()

    # --- comportamento -------------------------------------------------------------------

    def _event(self, run: Run, name: str, **fields):
        run.events.append({"event": name, "run_id": run.run_id, "timestamp": time.time(), **fields})

    def _admit(self, scenario: Scenario, keyed: bool, body: dict | None = None) -> Run:
        run = Run(run_id=f"run_{uuid.uuid4().hex}", keyed=keyed, body=body or {}, scenario=scenario)
        self._event(run, "run.queued")
        run.status = "running"
        self._event(run, "run.started")
        for tool in scenario.tools:
            self._event(run, "tool.started", tool_name=tool)
            self._event(run, "tool.completed", tool_name=tool)
        if scenario.request_approval:
            run.status = "waiting_for_approval"
            self._event(run, "approval.request", request_id="appr_1", command="terminal")
        elif not scenario.hold:
            self._finish(run, scenario)
        run.flags["scenario"] = scenario
        return run

    def _finish(self, run: Run, scenario: Scenario):
        run.usage = dict(scenario.usage)
        output = scenario.output(run.body) if callable(scenario.output) else scenario.output
        if scenario.final_status == "completed":
            run.status, run.output = "completed", output
            run.flags.update(completed=True, partial=False, interrupted=False)
            self._event(run, "message.started")
            self._event(run, "run.completed", output=output, usage=run.usage)
        elif scenario.final_status == "interrupted":
            run.status, run.error = "interrupted", "Execução interrompida."
            run.flags.update(completed=False, partial=True, interrupted=True)
            self._event(run, "run.interrupted", usage=run.usage)
        else:
            run.status, run.error = "failed", "A execução terminou sem concluir."
            run.flags.update(completed=False, partial=bool(scenario.turn_exit_reason), interrupted=False)
            if scenario.turn_exit_reason:
                run.flags["turn_exit_reason"] = scenario.turn_exit_reason
            run.output = scenario.output or None
            self._event(run, "run.failed", error=run.error, usage=run.usage, **(
                {"turn_exit_reason": scenario.turn_exit_reason} if scenario.turn_exit_reason else {}))

    def _status(self, run: Run) -> dict:
        body = {"run_id": run.run_id, "status": run.status, "created_at": run.created_at,
                "last_event": run.events[-1]["event"] if run.events else None}
        for name in ("output", "error", "usage"):
            if getattr(run, name) is not None:
                body[name] = getattr(run, name)
        body.update({k: v for k, v in run.flags.items() if k != "scenario"})
        return body

    def release(self, run_id: str):
        """Conclui uma execução retida conforme seu cenário (ex.: terminou enquanto o Hórus estava fora)."""
        with self.lock:
            run = self.runs[run_id]
            self._finish(run, run.scenario)

    def restart(self):
        """Hipótese de reinício do gateway: ver docstring do módulo."""
        with self.lock:
            self.runs = {k: v for k, v in self.runs.items() if v.keyed}
            for run in self.runs.values():
                run.flags.pop("scenario", None)  # não há mais quem conclua a execução

    # --- HTTP ----------------------------------------------------------------------------

    def _handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):  # silencioso nos testes
                pass

            def _json(self, status, body, headers=None):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(data)

            def _error(self, status, message, code, err_type="invalid_request_error"):
                self._json(status, {"error": {"message": message, "type": err_type, "param": None, "code": code}})

            def _authorized(self):
                if self.headers.get("Authorization") != f"Bearer {fake.token}":
                    self._error(401, "Invalid API key", "invalid_api_key", "authentication_error")
                    return False
                return True

            def _run(self, run_id):
                run = fake.runs.get(run_id)
                if run is None:
                    self._error(404, f"Run not found: {run_id}", "run_not_found")
                return run

            def do_GET(self):
                if not self._authorized():
                    return
                parts = self.path.split("?")[0].strip("/").split("/")
                with fake.lock:
                    if len(parts) == 3 and parts[:2] == ["v1", "runs"]:
                        run = self._run(parts[2])
                        if run:
                            self._json(200, fake._status(run))
                        return
                    if len(parts) == 4 and parts[:2] == ["v1", "runs"] and parts[3] == "events":
                        run = self._run(parts[2])
                        if not run:
                            return
                        frames = [b": open\n\n"] + [
                            f"id: {i}\ndata: {json.dumps(e, ensure_ascii=True)}\n\n".encode()
                            for i, e in enumerate(run.events, 1)]
                        if run.status in TERMINAL:
                            frames.append(b": stream closed\n\n")
                        data = b"".join(frames)
                        self.send_response(200)
                        self.send_header("Content-Type", "text/event-stream")
                        self.send_header("Cache-Control", "no-cache")
                        self.send_header("Content-Length", str(len(data)))
                        self.end_headers()
                        self.wfile.write(data)
                        return
                self._error(404, "Not found", "not_found")

            def do_POST(self):
                # Consumir o corpo antes de qualquer resposta (inclusive 401): no Windows, fechar com corpo
                # não lido pode abortar a conexão antes de o cliente ler a resposta. Sem parse antes de autenticar.
                try:
                    length = max(int(self.headers.get("Content-Length") or 0), 0)
                except ValueError:
                    length = 0
                raw = self.rfile.read(length)
                if not self._authorized():
                    return
                parts = self.path.strip("/").split("/")
                with fake.lock:
                    if parts == ["v1", "runs"]:
                        self._admit(raw)
                        return
                    if len(parts) == 4 and parts[:2] == ["v1", "runs"] and parts[3] == "stop":
                        run = self._run(parts[2])
                        if not run:
                            return
                        if run.status in TERMINAL:
                            self._json(200, fake._status(run))
                            return
                        if "scenario" not in run.flags:
                            self._error(409, f"Run is not active: {run.run_id}", "run_not_active")
                            return
                        run.status = "stopping"
                        fake._event(run, "run.stopping")
                        run.status = "cancelled"
                        run.flags.update(completed=False, partial=False, interrupted=True)
                        fake._event(run, "run.cancelled")
                        self._json(200, fake._status(run))
                        return
                self._error(404, "Not found", "not_found")

            def _admit(self, raw):
                try:
                    body = json.loads(raw or b"{}")
                except ValueError:
                    self._error(400, "Invalid JSON", None)
                    return
                if not isinstance(body, dict) or not body.get("input"):
                    self._error(400, "Missing 'input' field", "missing_input")
                    return
                key = self.headers.get("Idempotency-Key", "").strip()
                if len(key) > 255 or any(ord(ch) < 33 or ord(ch) > 126 for ch in key):
                    self._error(400, "Idempotency-Key must be 1-255 visible ASCII characters", "invalid_idempotency_key")
                    return
                fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
                if key and key in fake.idempotency:
                    known, run_id = fake.idempotency[key]
                    if known != fingerprint:
                        self._error(409, "Idempotency-Key was already used with a different request payload",
                                    "idempotency_key_conflict")
                        return
                    run = fake.runs.get(run_id)
                    status = run.status if run else "queued"
                    self._json(202, {"run_id": run_id, "status": status, "replayed": True},
                               {"Idempotency-Replayed": "true"})
                    return
                active = sum(1 for run in fake.runs.values() if run.status in ACTIVE)
                if fake.max_concurrent_runs > 0 and active >= fake.max_concurrent_runs:
                    self._error(429, "Too many concurrent runs", "rate_limit_exceeded", "rate_limit_error")
                    return
                fake.requests.append({"body": body, "idempotency_key": key or None})
                scenario = fake.scenarios.popleft() if fake.scenarios else fake.default
                run = fake._admit(scenario, keyed=bool(key), body=body)
                fake.runs[run.run_id] = run
                if key:
                    fake.idempotency[key] = (fingerprint, run.run_id)
                # Admissão responde "queued", como o Hermes real; o progresso aparece no status.
                self._json(202, {"run_id": run.run_id, "status": "queued", "replayed": False})

        return Handler
