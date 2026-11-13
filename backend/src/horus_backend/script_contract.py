"""Contrato puro do roteiro estruturado simulado (M3). Sem rede, banco ou estado.

Reutiliza `Id` e a base estrita dos contratos editoriais sem alterá-los. `source_ids` referenciam ids do snapshot
aprovado (`Dataset.items[].source_id`), nunca `source_artifact_ids` de proveniência nem URLs.
Consistência temporal, revisões e persistência pertencem ao serviço, não a este validador.
"""
from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from .hermes_contract.models import Id, Strict

MAX_SECTIONS, MIN_SECTIONS = 30, 3
MAX_NARRATION_TOTAL = 60_000
MAX_SOURCE_IDS = 50


class _StrictInput(Strict):
    """Sem coerção (ex.: `1`/`True`, número por texto) e sem campos extras."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)


class ScriptSection(_StrictInput):
    id: Id
    kind: Literal["hook", "body", "conclusion"]
    heading: str = Field(min_length=1, max_length=200)
    narration: str = Field(min_length=1, max_length=8000)
    source_ids: list[Id] = Field(default_factory=list, max_length=MAX_SOURCE_IDS)

    @model_validator(mode="after")
    def unique_sources(self):
        if len(set(self.source_ids)) != len(self.source_ids):
            raise ValueError("source_ids repetido na seção.")
        return self


class ScriptDocument(_StrictInput):
    schema_version: Literal[1] = 1
    simulated: Literal[True] = True
    title: str = Field(min_length=1, max_length=200)
    sections: list[ScriptSection] = Field(min_length=MIN_SECTIONS, max_length=MAX_SECTIONS)

    @field_validator("schema_version", "simulated", mode="before")
    @classmethod
    def exact_literals(cls, value, info):
        # Literal compara por igualdade: 1.0 e True seriam aceitos como 1; 1 como True.
        if info.field_name == "schema_version" and not (type(value) is int and value == 1):
            raise ValueError("schema_version deve ser o inteiro 1.")
        if info.field_name == "simulated" and value is not True:
            raise ValueError("simulated deve ser true.")
        return value

    @model_validator(mode="after")
    def structure(self):
        ids = [section.id for section in self.sections]
        if len(set(ids)) != len(ids):
            raise ValueError("id de seção repetido.")
        kinds = [section.kind for section in self.sections]
        if kinds.count("hook") != 1 or kinds[0] != "hook":
            raise ValueError("exatamente uma seção hook, na primeira posição.")
        if kinds.count("conclusion") != 1 or kinds[-1] != "conclusion":
            raise ValueError("exatamente uma seção conclusion, na última posição.")
        if "body" not in kinds:
            raise ValueError("ao menos uma seção body.")
        if sum(len(section.narration) for section in self.sections) > MAX_NARRATION_TOTAL:
            raise ValueError(f"narração total acima de {MAX_NARRATION_TOTAL} caracteres.")
        return self


def validate_script(document: dict | ScriptDocument, allowed_source_ids: set[str]) -> ScriptDocument:
    """Valida estrutura e referências; devolve um modelo novo. Levanta ValidationError/ValueError."""
    if isinstance(document, ScriptDocument):
        document = document.model_dump()  # revalida: instância pode ter sido alterada após a construção
    elif not isinstance(document, dict):
        raise ValueError("documento de roteiro deve ser um objeto.")
    if not isinstance(allowed_source_ids, (set, frozenset)):
        raise ValueError("allowed_source_ids deve ser um conjunto de ids.")
    script = ScriptDocument.model_validate(document)
    unknown = sorted({ref for section in script.sections for ref in section.source_ids} - set(allowed_source_ids))
    if unknown:
        raise ValueError(f"source_ids fora do snapshot permitido: {', '.join(unknown)}")
    return script
