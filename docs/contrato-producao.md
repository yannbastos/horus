# Contrato do plano de produção técnica local (M4)

Módulo: `backend/src/horus_backend/production_contract.py`. Issues [HOR-052](https://github.com/yannbastos/horus-management/issues/54) e [HOR-089](https://github.com/yannbastos/horus-management/issues/77). Estado em 12/11/2026: **adaptação pura e validada implementada**; serviço, API, worker, renderização e revisão pertencem a outras frentes e não são descritos aqui como existentes. O módulo não acessa rede, banco, disco nem a fábrica; não executa Remotion, voz, busca ou publicação.

## API

`build_production_plan(script: ScriptDocument, *, script_id, script_version, script_content_hash, mode="simulated") -> ProductionPlan` e `render_srt(plan) -> str`. `mode` é um acréscimo opcional compatível com a assinatura combinada (`simulated` por padrão; `local_demo` aceito). Falhas: `ValidationError`/`ValueError`.

Flags fixas (`schema_version`, `demo_only`, `roteiro.teste`, `audio.real_voice`, `subtitles.speech_aligned`, `license.publishable`) exigem o tipo exato: `Literal` compara por igualdade e aceitaria `1`/`1.0`/`True` e `0`/`False` como equivalentes, então há validação adicional (`1`, `0`, `1.0`, `"true"` recusados). `visual_origin` só aceita `original_local`; não há valor de fonte externa e qualquer outro é recusado, inclusive após mutação (`render_srt` revalida).

Entradas de servidor, sem coerção e sem remoção de espaços: `script_id` 32 hex minúsculos; `script_version` inteiro ≥ 1 (`True`, `1.0` e `"1"` recusados); `script_content_hash` SHA-256 com 64 hex minúsculos. O roteiro é revalidado com `validate_script` (instância alterada depois de criada não passa) e a entrada não é modificada.

## ProductionPlan

| Campo | Conteúdo |
|---|---|
| `schema_version` | `1` |
| `mode` | `simulated` (padrão) ou `local_demo` |
| `demo_only` | sempre `true` |
| `roteiro` | formato de `fabrica.modelos.Roteiro`: `titulo`, `formato: "short"`, `teste: true`, `linhas[{n, narracao, visual, duracao_estimada}]` (1..N). Sem `visual_override`, `busca`, caminhos nem URLs |
| `scenes` | uma cena original local por seção (`id`, `n`, `kind`, `heading`, `start`, `end`, `duration`, `source_ids`, `visual_origin: "original_local"`) |
| `total_duration` | soma das cenas, ≤ 600 s |
| `sources` | ids de fonte do snapshot M3, na ordem de primeira citação, sem repetição |
| `audio` | `fixture_tone`, `real_voice: false`, aviso de que não há voz real |
| `subtitles` | `synthetic_srt`, `speech_aligned: false`, aviso de que não é alinhamento de fala |
| `license` | `publishable: false`, `external_assets: []` |

**Durações:** `palavras / 2,5` por segundo, limitado a 1,5–20 s por cena e arredondado a 3 casas, de forma determinística. O ritmo é uma constante de referência; o perfil editorial do canal não é lido, copiado nem sobrescrito. As cenas são contíguas e sem lacuna; a validação recusa cena/linha divergentes, total diferente da soma, tempos não finitos, ids repetidos e `sources` inconsistente. O plano **não** valida arquivos, caminhos físicos nem asset algum: isso pertence ao serviço.

**Proveniência:** `source_ids` apenas repassam as referências do roteiro aprovado; nada aqui prova licença, direito de uso ou publicabilidade, e isso nunca é inferido do sucesso de uma renderização. Não há assets externos nem biblioteca do operador.

**SRT:** `render_srt` gera uma legenda sintética por cena, usando o texto da narração em uma linha (quebras, controles e `-->` neutralizados) e os tempos das cenas. Não é alinhamento real de fala; manifesto, motor e UI devem manter o aviso de demonstração/teste e de ausência de voz real.

## Responsabilidade do serviço

Este módulo valida **coerência interna do plano**, não a identidade do que foi aprovado. O serviço deve conferir, com os dados persistidos, que `script_id`, versão e `script_content_hash` correspondem ao roteiro aprovado mais recente e que o plano gravado ainda deriva desse roteiro (por exemplo, reconstruindo-o com `build_production_plan` e comparando). Um plano com cenas e linhas coerentes entre si, mas com hash ou id falsos, **não é detectado aqui**: o hash é apenas formatado (64 hex), não verificado.

## Duração sintética e truncamento

A duração da cena é estimada pela contagem de palavras e **truncada em 20 s por cena** (mínimo 1,5 s). Narrações muito longas deixam de refletir o tempo real de leitura: uma cena com mais de 50 palavras é cortada em 20 s e o texto excedente não cabe nesse intervalo; o SRT mostra o texto inteiro dentro da janela da cena. O áudio é um tom de fixture e a duração é sintética: **não representa fala real nem tempo de voz gravada**.

## Compatibilidade com a fábrica

Os testes carregam, somente para leitura, `fabrica/modelos.py` da fábrica existente (caminho padrão local ou `HORUS_FABRICA_MODELOS`) sem gravar bytecode, e comprovam que `plan.roteiro` é aceito por `Roteiro` e que o modelo real continua recusando campos extras. Se o arquivo não existir, esses dois testes são ignorados e a limitação aparece no resultado. A fábrica não foi alterada (`git status` limpo, sem `__pycache__`). Alinhamento, manifesto de assets e renderer da fábrica **não** são cobertos por este módulo.

## Validação

```powershell
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_production_contract.py -q -p no:cacheprovider
```

Cobertura: determinismo, uma cena por seção, contiguidade e soma, limites de duração, roteiro máximo, ids/hash/versão sem coerção, revalidação de instâncias mutadas, ausência de caminhos/URLs, mutações do plano recusadas (inclusive flags `Literal` com tipos não exatos e origem visual externa), ida e volta em JSON, SRT coerente com as cenas e texto hostil, e compatibilidade com o modelo real.

## Limitações

- Estimativa de duração é heurística por contagem de palavras, não medida de áudio.
- O teto de 600 s decorre de 30 seções × 20 s; um "short" real pode exigir limite menor, a decidir na política de produção.
- Mensagens de `ValidationError` do Pydantic repetem trechos do valor recusado; o serviço não deve devolver `str(erro)` ao cliente.
