"""Validação de evidências do resultado editorial, executada pelo Hórus e nunca delegada ao Hermes."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from pydantic import ValidationError

from .models import EditorialResult, RunEnvelope

# Métricas privadas ou inexistentes nos dados públicos. Aceitas apenas em ``unknowns``,
# onde servem justamente para declarar a ausência.
FORBIDDEN = re.compile(
    r"\b(reten[cç][aã]o|retention|receita|revenue|faturamento|rpm|cpm|ctr|"
    r"click[- ]?through|monetiza[cç][aã]o|monetization|watch ?time|tempo de exibi[cç][aã]o)\b",
    re.IGNORECASE)
# Números grandes no texto precisam existir no snapshot (heurística contra métricas inventadas).
LARGE_NUMBER = re.compile(r"(?<![\w.,])\d{1,3}(?:[.,\s]\d{3})+(?![\w.,]\d)|(?<![\w.,])\d{4,}(?![\w.,]\d)")
FENCE = re.compile(r"^\s*```(?:json)?\s*\n(.*)\n\s*```\s*$", re.DOTALL)


@dataclass(frozen=True)
class Issue:
    code: str
    path: str
    message: str


class OutputError(ValueError):
    """Texto final do Hermes não é um único objeto JSON."""


def parse_output(text: str) -> dict:
    """Aceita somente um objeto JSON, opcionalmente dentro de um bloco ```json."""
    if not isinstance(text, str) or not text.strip():
        raise OutputError("Resposta vazia.")
    match = FENCE.match(text)
    body = match.group(1) if match else text
    try:
        value = json.loads(body)
    except json.JSONDecodeError as error:
        raise OutputError(f"JSON inválido: {error.msg} (posição {error.pos}).") from error
    if not isinstance(value, dict):
        raise OutputError("A resposta precisa ser um objeto JSON.")
    return value


def _numbers(text: str) -> set[int]:
    found = set()
    for token in LARGE_NUMBER.findall(text):
        digits = re.sub(r"\D", "", token)
        value = int(digits)
        if not 1900 <= value <= 2100:  # anos não são métricas
            found.add(value)
    return found


def validate_result(raw: dict, envelope: RunEnvelope) -> tuple[EditorialResult | None, list[Issue]]:
    """Retorna o resultado tipado somente quando não há nenhum problema."""
    try:
        result = EditorialResult.model_validate(raw)
    except ValidationError as error:
        return None, [Issue("schema", ".".join(map(str, item["loc"])) or "$", item["msg"]) for item in error.errors()]

    issues: list[Issue] = []
    add = lambda code, path, message: issues.append(Issue(code, path, message))  # noqa: E731
    dataset = {item.source_id: item for item in envelope.dataset.items}

    if result.task_id != envelope.task_id:
        add("task_mismatch", "task_id", "Resultado pertence a outra tarefa.")

    seen: set[str] = set()
    for section in ("sources", "facts", "hypotheses", "opportunities"):
        for index, item in enumerate(getattr(result, section)):
            if item.id in seen:
                add("duplicate_id", f"{section}.{index}.id", f"Identificador repetido: {item.id}.")
            seen.add(item.id)

    sources = {source.id: source for source in result.sources}
    for index, source in enumerate(result.sources):
        if source.kind == "dataset":
            original = dataset.get(source.id)
            if original is None:
                add("unknown_dataset_source", f"sources.{index}", f"{source.id} não existe no snapshot.")
            elif original.url != source.url:
                add("source_url_mismatch", f"sources.{index}.url", f"URL diferente da registrada para {source.id}.")

    facts = {fact.id for fact in result.facts}
    hypotheses = {hypothesis.id for hypothesis in result.hypotheses}
    snapshot_values = {value for item in dataset.values() for value in item.metrics.values()}

    for index, fact in enumerate(result.facts):
        for source_id in fact.source_ids:
            if source_id not in sources:
                add("unknown_reference", f"facts.{index}.source_ids", f"Fonte inexistente: {source_id}.")
        for ref_index, ref in enumerate(fact.metric_refs):
            path = f"facts.{index}.metric_refs.{ref_index}"
            item = dataset.get(ref.source_id)
            if item is None or sources.get(ref.source_id) is None or sources[ref.source_id].kind != "dataset":
                add("metric_without_dataset_source", path, f"Métrica precisa citar uma fonte do snapshot: {ref.source_id}.")
            elif ref.field not in item.metrics:
                add("metric_unavailable", path, f"{ref.field} não existe para {ref.source_id}.")
            elif item.metrics[ref.field] != ref.value:
                add("metric_mismatch", path, f"{ref.field} de {ref.source_id} é {item.metrics[ref.field]}, não {ref.value}.")

    for index, hypothesis in enumerate(result.hypotheses):
        for ref in hypothesis.based_on:
            if ref not in facts:
                add("unknown_reference", f"hypotheses.{index}.based_on", f"Hipótese deve citar fatos: {ref}.")
    for index, opportunity in enumerate(result.opportunities):
        for ref in opportunity.based_on:
            if ref not in facts and ref not in hypotheses:
                add("unknown_reference", f"opportunities.{index}.based_on", f"Referência inexistente: {ref}.")
    if result.recommendation:
        for ref in result.recommendation.differs_from:
            if ref not in sources:
                add("unknown_reference", "recommendation.differs_from", f"Fonte inexistente: {ref}.")
    for index, proposal in enumerate(result.memory_proposals):
        for ref in proposal.evidence:
            if ref not in facts:
                add("unknown_reference", f"memory_proposals.{index}.evidence", f"Evidência deve ser um fato: {ref}.")

    for path, text in _texts(result):
        if FORBIDDEN.search(text):
            add("forbidden_metric", path, "Métrica privada ou indisponível citada como dado.")
        for number in _numbers(text) - snapshot_values:
            add("unverified_number", path, f"{number} não corresponde a nenhuma métrica do snapshot.")

    return (result if not issues else None), issues


def _texts(result: EditorialResult):
    """Campos livres sujeitos às regras de métricas; ``unknowns`` fica de fora de propósito."""
    for index, step in enumerate(result.plan):
        yield f"plan.{index}.step", step.step
    for index, fact in enumerate(result.facts):
        yield f"facts.{index}.text", fact.text
    for index, item in enumerate(result.hypotheses):
        yield f"hypotheses.{index}.text", item.text
        yield f"hypotheses.{index}.how_to_test", item.how_to_test
    for index, item in enumerate(result.opportunities):
        yield f"opportunities.{index}.summary", item.summary
        yield f"opportunities.{index}.br_fit_rationale", item.br_fit_rationale
    if result.recommendation:
        rec = result.recommendation
        for index, title in enumerate(rec.title_options):
            yield f"recommendation.title_options.{index}", title
        for name in ("premise", "angle", "originality", "licensing_notes"):
            yield f"recommendation.{name}", getattr(rec, name)
        for index, risk in enumerate(rec.risks):
            yield f"recommendation.risks.{index}", risk
    for index, item in enumerate(result.memory_proposals):
        yield f"memory_proposals.{index}.text", item.text
