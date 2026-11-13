# Contrato do roteiro estruturado simulado (M3)

Módulo: `backend/src/horus_backend/script_contract.py`. Escopo das Issues [HOR-049](https://github.com/yannbastos/horus-management/issues/51) e [HOR-050](https://github.com/yannbastos/horus-management/issues/52). Estado em 12/11/2026: **contrato e validador puros implementados e testados**; persistência, API e revisão humana pertencem a outra frente e não estão descritas aqui como existentes. Nenhuma geração real, rede, provedor ou inferência.

## API do módulo

`ScriptSection`, `ScriptDocument` (Pydantic 2) e `validate_script(document: dict | ScriptDocument, allowed_source_ids: set[str]) -> ScriptDocument`. Sem rede, banco ou estado. Falhas levantam `pydantic.ValidationError` (subclasse de `ValueError`) ou `ValueError`.

| Campo | Regra |
|---|---|
| `schema_version` | inteiro exatamente `1` (padrão `1`); `True`, `1.0` e `"1"` recusados |
| `simulated` | exatamente `true` (padrão `true`); `1`, `"true"` e `false` recusados |
| `title` | 1..200 caracteres após remover espaços nas pontas |
| `sections` | 3..30 itens |
| `section.id` | mesmo tipo `Id` dos contratos editoriais (`^[A-Za-z][A-Za-z0-9_-]{0,31}$`), reutilizado sem alteração; único no documento (diferencia maiúsculas) |
| `section.kind` | `hook`, `body` ou `conclusion` |
| `section.heading` | 1..200 |
| `section.narration` | 1..8000; soma de todas as seções ≤ 60000 |
| `section.source_ids` | lista de `Id`, padrão `[]`, até 50, sem repetição |

Estrutura: exatamente uma seção `hook`, na primeira posição; exatamente uma `conclusion`, na última; ao menos uma `body`. Campos não previstos são recusados em todos os níveis. Strings têm espaços nas pontas removidos **antes** das validações (`" a1\n"` vira `"a1"`); um identificador só de espaços ou com quebra/NUL no meio é recusado. Não há coerção de tipos (modo estrito).

## Referências

`source_ids` referenciam `Dataset.items[].source_id` do snapshot aprovado, que o chamador extrai e entrega em `allowed_source_ids` (conjunto ou `frozenset`; lista, texto ou `None` são recusados). Qualquer id fora do conjunto é recusado, inclusive URLs, que não são ids válidos. `source_artifact_ids` (proveniência de artefatos) **não** são `source_ids`. Fontes vazias são permitidas: o texto criativo simulado não inventa evidência; o validador não busca nem cria fontes.

## Fora do validador

Persistência, versões, revisão humana, consistência temporal, concorrência e idempotência pertencem ao serviço. O validador revalida instâncias (`model_dump` e nova validação), de modo que um `ScriptDocument` alterado depois de criado não contorna as regras, e devolve sempre um modelo novo, sem alterar a entrada.

## Validação

```powershell
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_script_contract.py -q -p no:cacheprovider
```

Testes offline cobrem tipos, tamanhos nos limites (inclusive), ordem/cardinalidade, ids duplicados, referências existentes/desconhecidas/URLs, campos extras, coerção perigosa (`True`/`1.0` como versão, `1` como `simulated`), mutação pós-construção e entrada imutável. A fixture dedicada fica em `backend/tests/fixtures/scripts/roteiro-valido.json`; os ids de snapshot reais vêm de `contracts/hermes/fixtures/envelope-ficticio.json`.

## Limitações

- Não valida qualidade, coerência ou fidelidade do texto às fontes, apenas estrutura e referências.
- O contrato de ids do Hermes (`Id`, regex terminada em `$`) aceitaria uma quebra de linha final; aqui isso é neutralizado porque o espaço final é removido antes. Os contratos Hermes não foram alterados.
- Contagem de caracteres em pontos de código Unicode, não bytes.
