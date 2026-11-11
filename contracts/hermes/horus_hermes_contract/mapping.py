"""Mapeamento PROPOSTO entre estados de execução do Hermes e decisões do Hórus.

Estados e campos do Hermes conferidos no código instalado (0.23.1, gateway/platforms/
api_server_runs.py e api_server_run_idempotency.py). As decisões são proposta do Hórus.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

HERMES_ACTIVE = frozenset({"queued", "running", "waiting_for_approval", "stopping"})
HERMES_TERMINAL = frozenset({"completed", "failed", "cancelled", "interrupted"})
HERMES_STATUSES = HERMES_ACTIVE | HERMES_TERMINAL

Action = Literal[
    "wait",                    # execução ativa: continuar acompanhando
    "stop_policy_violation",   # Hermes pediu aprovação de ferramenta: o Hórus nunca aprova sozinho
    "validate_output",         # concluída: converter e validar o JSON
    "record_failed",           # terminou sem concluir (inclui limite de iterações)
    "record_cancelled",        # cancelamento confirmado pelo Hermes
    "record_interrupted",      # Hermes informou interrupção
    "resubmit_same_key",       # admissão sem resposta: repetir com a mesma chave e o mesmo corpo
    "mark_unknown",            # contato perdido após admissão: conciliar antes de qualquer nova tentativa
]


@dataclass(frozen=True)
class Observation:
    """O que o Hórus conseguiu observar sobre uma tentativa."""
    admitted: bool                      # recebeu 202 com run_id
    http_status: int | None = None      # resposta da última consulta (None = sem resposta/erro de rede)
    run_status: str | None = None       # campo ``status`` do Hermes, quando houve resposta


def decide(observation: Observation) -> Action:
    if not observation.admitted:
        # Sem 202: não se sabe se o Hermes registrou a execução. A chave torna o reenvio seguro.
        return "resubmit_same_key"
    if observation.http_status is None or observation.http_status == 404 or observation.http_status >= 500:
        # 404 após 202: execução sem chave perdida no reinício do gateway, ou expirada. Não presumir término.
        return "mark_unknown"
    status = observation.run_status
    if status not in HERMES_STATUSES:
        return "mark_unknown"
    if status == "waiting_for_approval":
        return "stop_policy_violation"
    if status in HERMES_ACTIVE:
        return "wait"
    return {"completed": "validate_output", "failed": "record_failed",
            "cancelled": "record_cancelled", "interrupted": "record_interrupted"}[status]


# Resultado da tentativa no Hórus (job_attempts.status) para cada ação final.
ATTEMPT_OUTCOME = {
    "validate_output": "succeeded",  # somente se a validação de evidências passar; senão "failed"
    "record_failed": "failed",
    "record_cancelled": "cancelled",
    "record_interrupted": "interrupted",
    "stop_policy_violation": "failed",
    "mark_unknown": "unknown",      # estado proposto: não existe hoje no núcleo de workflows
}


def idempotency_key(attempt_id: str, repair: int = 0) -> str:
    """Uma chave por tentativa; a correção de JSON inválido usa chave própria."""
    if repair not in (0, 1):
        raise ValueError("No máximo uma correção por tentativa.")
    key = f"horus-{attempt_id}" + (f"-repair-{repair}" if repair else "")
    if not 1 <= len(key) <= 255 or any(ord(ch) < 33 or ord(ch) > 126 for ch in key):
        raise ValueError("Chave fora do formato aceito pelo Hermes (1-255 ASCII visíveis).")
    return key


def may_retry_automatically(outcome: str) -> bool:
    """Execuções Hermes podem ser pagas: nenhuma nova tentativa sem ação explícita do operador."""
    return False


def may_repair(outcome: str, repairs_done: int, invalid_output: bool) -> bool:
    """Única exceção: uma correção de formato quando a execução concluiu com JSON inválido."""
    return outcome == "succeeded" and invalid_output and repairs_done == 0


def may_retry_after(outcome: str, reconciled: bool) -> bool:
    """Retry explícito só depois de conhecer o desfecho da tentativa anterior."""
    if outcome == "unknown":
        return reconciled
    return outcome in {"failed", "cancelled", "interrupted"}
