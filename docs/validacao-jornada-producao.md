# Validação da jornada de produção pela interface real — HOR-087 / HOR-054 / HOR-132

Data: 13/11/2026. Base: `main` em `3b2ffd9`. Issues: `horus-management` #75 (HOR-087) e #56 (HOR-054).
Escopo: encontrar problemas reais de usabilidade ao produzir um vídeo do Radar à decisão final, **contra o backend real**
(as telas anteriores foram validadas com respostas interceptadas). Este incremento **não corrige telas**: os achados
abaixo alimentam as correções que o Maestro distribuirá. Nada externo foi usado: Hermes simulado, dados fictícios,
banco temporário descartado ao final, sem rede, credenciais ou inferência real. `publishable=false` e `demo_only=true`
permaneceram em todas as telas.

## Como foi executado

- Backend real (`python -m horus_backend`) em porta livre, `HORUS_DATA_DIR` temporário, `HORUS_WORKFLOW_EXECUTOR=simulated`,
  `HORUS_RADAR_EXECUTOR=hermes_simulated`; frontend Vite em outra porta; Edge visível (`--headed`).
- Ferramentas já preparadas na máquina (nada baixado): fábrica `backend-factory-demo`, Whisper `small`, FFmpeg
  BtbN n8.1.3 com libass, Kokoro isolado (`pf_dora`) e SAPI Maria. Os caminhos seguem `docs/piloto-local.md`.
- Suporte: `frontend/scripts/e2e-backend.mjs` (sobe/derruba o backend) e `frontend/tests/e2e-production-journey.spec.ts`.
- Capturas em `artifacts/journey/*.png` (diretório ignorado pelo Git: ficam só na máquina que executou; refazem-se
  rodando o teste). Gravação de vídeo é opcional (`HORUS_E2E_VIDEO=1`) e exige `npx playwright install ffmpeg`,
  download que o teste nunca faz sozinho; nesta execução **não foi gravado vídeo**, só capturas.

### Reproduzir

```powershell
$env:HORUS_PILOT_FACTORY = "$env:TEMP/horus-m4/backend-factory-demo"
$env:HORUS_ALIGNMENT_MODEL = "$env:LOCALAPPDATA/Horus/models/whisper"
$env:HORUS_FFMPEG = "$env:LOCALAPPDATA/Horus/tools/ffmpeg/n8.1.3-35-gf1acb0a266/ffmpeg-n8.1.3-35-gf1acb0a266-win64-gpl-8.1/bin/ffmpeg.exe"
$env:HORUS_KOKORO_PYTHON = "$env:LOCALAPPDATA/Horus/tools/kokoro-proof/venv/Scripts/python.exe"   # opcional
$env:HORUS_KOKORO_MODEL_DIR = "$env:LOCALAPPDATA/Horus/tools/kokoro-proof/model"                 # opcional
node frontend/scripts/e2e-backend.mjs run --headed --reporter=list
```

Sem as três primeiras variáveis o script recusa subir; sem `HORUS_E2E_BACKEND_URL`/`HORUS_E2E_TOKEN` (que o script
define) o spec **pula** os dois testes (verificado rodando só este arquivo pelo `playwright test` padrão: 2 skipped; a suíte padrão completa não foi executada).
`HORUS_E2E_NO_OVERLAY=1` omite `HORUS_FFMPEG` (legenda embutida da fábrica). `HORUS_E2E_STRICT=1` transforma os
atritos J-13/J-14 em falha. O script traduz `HORUS_PILOT_FACTORY` para `FABRICA_HOME`, porque o backend só descobre
a fábrica por essa variável (ver J-17).

## Jornada percorrida e tempos

Fonte: `artifacts/journey/timings.json`, medido com `Date.now()` do Playwright em cada etapa (execução final, FFmpeg
com libass, 2 testes aprovados em 6,5 min). Esperas por polling da própria tela; não há estimativa. Tempo de 1 execução
nesta máquina, sem garantia para outras.

| Etapa (tela) | Tempo |
|---|---|
| Ajustes → conectar ao backend | 0,8 s |
| Radar → carregar demonstração | 0,3 s |
| Radar → iniciar análise (4 vídeos elegíveis) | 0,2 s |
| Produção → autorizar execução simulada até a proposta aparecer | 8,4 s (espera fixa do Hermes simulado) |
| Aprovar proposta / gerar roteiro / aprovar roteiro | 0,04 s / 0,2 s / 0,08 s |
| **Produção `local_pilot`, voz padrão Maria (SAPI)**, do clique ao "Execução técnica concluída" | **100,2 s** (clique→fim, 106,9 s com a troca de modo) |
| Prévia (vídeo carregado, SRT, WAV, linha do tempo de palavras) | 10,5 s (inclui rolagens) |
| QC | 3,1 s (leitura) |
| Licenças (registrar 1 verificação fictícia) | 7,2 s |
| Revisão: nota com timecode | 8,4 s |
| Decisão: aprovar por hash com ciência das pendências | 7,2 s |
| Central de Produção reflete a decisão | 2,1 s |
| **Produção `local_pilot`, voz Kokoro `pf_dora`**, do clique ao fim | **146,2 s** (149,9 s) |

Variação medida em outras execuções do mesmo fluxo (Maria): 94,2 s, 95,5 s, 101,7 s, 109 s (exploração manual) e
120,1 s; Kokoro 173 s na exploração manual (etapa Narração ≈ 88–92 s, depois alinhamento e render). As etapas internas
vêm do registro de eventos exibido na tela: `narration → align → subtitles → render → quality → review`.

Resultado final: os dois testes passaram. A jornada se completa, mas só porque o teste contorna J-01 (voz) e J-14
(painel de licença), e porque J-13 faz a verificação de licença ser pulada com libass. A variante `HORUS_E2E_NO_OVERLAY=1`
(2,6 min, 1 teste aprovado) registrou a verificação humana fictícia de `scene-1` ("Verificado (verified)").

### O que foi e não foi exercitado

- **Voz Maria:** produzida e identificada na interface ("windows_sapi · Microsoft Maria Desktop").
- **Voz Kokoro:** produzida e identificada ("kokoro (pf_dora)"), **mas escolhida por `PUT /v1/narration/preference`,
  não pela interface**, que não oferece esse controle (J-01).
- Vídeo gerado: **draft 540×960** (`short-rascunho.mp4`, ≈ 25,6 s). O preset final 1080×1920 não é alcançável pela interface (J-01).
- Não avaliados: naturalidade da voz, qualidade editorial, escuta humana, instalador, Linux, modo escuro, acessibilidade
  por leitor de tela. O roteiro vem do executor simulado e é genérico por construção.

## Achados priorizados

Gravidade: **bloqueia** (impede cumprir a etapa pela interface), **atrapalha** (cumpre, com confusão, atrito ou risco de
erro), **cosmético**. IDs `J-xx`; os marcados com ★ são também registrados como anotação pelo teste.

### Bloqueia

**J-01 ★ Não há seleção de voz, provedor nem qualidade na interface.** Tela: Produção › Produção técnica local.
Repro: abrir um roteiro aprovado; as únicas escolhas são "Modo de execução" e o botão. `grep -r "/v1/narration" frontend/src`
não encontra nada; a produção é enviada sem `narration` nem `render_quality`, logo usa a primeira voz SAPI e `draft`.
Para usar Kokoro foi preciso chamar a API. Captura: `05-producao-concluida.png`, `13-producao-kokoro.png`.
Sugestão: seletor "Voz" (lista de `GET /v1/narration/providers`, indisponíveis desabilitadas com o motivo) e seletor
"Qualidade (rascunho/final)" no cartão de disparo, enviando `narration` e `render_quality`.

**J-13 ★ Com a legenda por libass (`HORUS_FFMPEG`), a verificação humana de licença é impossível.** Tela: painel
"Verificação humana de licença por asset". Repro: produzir em `local_pilot` com `HORUS_FFMPEG`; abrir o painel:
"A API não devolveu proveniência efetiva…". `GET /v1/productions/{id}/license-reviews` devolve
`effective_provenance: null`. Causa verificada reproduzindo a validação: `asset-provenance.json` inclui a fonte
`fonts/ArchivoExpanded-SemiBold.ttf` (`assets[7]`), mas `_INPUTS` em `backend/src/horus_backend/license_reviews.py`
só aceita `scene-N.png`, `section-N.wav` e `fixture.wav`, então `validate_asset_provenance` falha com `asset_not_registered`.
Sem `HORUS_FFMPEG` o mesmo painel funciona. Efeito: o aviso "licenças não verificadas" nunca pode ser resolvido.
Captura: `09-licencas-indisponivel.png`. Sugestão: incluir `fonts/[^/]+\.(ttf|otf)` em `_INPUTS` (e teste de regressão
com a produção libass). Correção de backend: fora deste incremento.

### Atrapalha

**J-14 ★ O painel de licenças não atualiza quando a produção termina na própria tela.** Repro: iniciar a produção e
esperar o fim sem sair da tela; o painel mostra "indisponível". Só aparece depois de Central de Produção → "REVISAR
PRODUÇÃO" (remonta). Ocorreu em todas as execuções; "Atualizar produções" não resolve. `AssetProvenancePanel`
carrega uma vez ao montar (`useEffect([load])`) e não tem estado de carregamento nem recarga ao concluir o job. Texto
exibido é o mesmo de "sem proveniência", o que induz a achar que a produção falhou. Sugestão: recarregar quando o status
da produção virar `succeeded`, e mostrar "carregando" em vez da mensagem de ausência.

**J-12 ★ Alinhamento acústico falha para o roteiro simulado e a linha do tempo de palavras fica "estimada".**
Repro: qualquer produção a partir do roteiro v1 simulado. `alignment-report.json`: `executed:false`, "o roteiro deve ter
uma linha por seção medida". A seção 2 tem `\n` na narração ("…pesquisa própria.\nAjustes da revisão anterior:").
Consequências visíveis: QC `warn` em `word_timings`, "SEM MEDIÇÃO ACÚSTICA (estimado)", bordas tracejadas. A tela
só diz "contexto parcial: estimated_source_not_speech_aligned"; o motivo real (quebra de linha) não aparece.
Captura: `07-linha-do-tempo-palavras.png`. Sugestão: normalizar espaços/quebras da narração antes do alinhamento ou
da contagem de linhas, e exibir `alignment-report.reason` quando `executed:false`.

**J-16 Produção Kokoro é rotulada como voz SAPI no resumo de licenças.** Repro: produzir com `pf_dora`. Em
"MANIFESTO DO PILOTO E LICENÇAS": "5 asset(s) system_voice (license: unverified — voz SAPI não comprova licença
comercial…)", enquanto a tabela de licenças mostra "Modelo TTS local (local_tts_model)" e o resumo de narração diz
"kokoro (pf_dora)". Informação inconsistente em uma tela de direitos. Sem captura dedicada. Sugestão: texto por
`origin`, não fixo em SAPI.

**J-17 Bloqueio com causa errada e variável de fábrica inconsistente.** (a) Com `HORUS_FFMPEG` apontando para arquivo
inexistente, a produção bloqueia com "Piloto local indisponivel: confirme Windows SAPI pt-BR e WAV PCM valido; nenhum tom
substitui voz." O erro real era `FileNotFoundError` do FFmpeg, engolido por `except (OSError, TimeoutError)` em
`production_worker.py`. Reproduzido por engano na primeira tentativa (caminho com barras perdidas) e depois confirmado
chamando `local_pilot.prepare` diretamente. (b) `docs/piloto-local.md` e o brief mandam definir `HORUS_PILOT_FACTORY`,
mas essa é a variável dos ensaios; o backend usa `FABRICA_HOME`. Sem ela, o Render bloqueia com "Prepare separadamente… Python da
fábrica em scripts/.venv; Remotion…" sem apontar a variável. Sugestão: mensagem distinta para FFmpeg/ASR/OSError
genérico e nota de `FABRICA_HOME` na documentação e no texto do bloqueio.

**J-10 Esperas longas sem feedback de progresso.** Produção Maria ≈ 100 s e Kokoro ≈ 146 s: a tela mostra só o rótulo da
etapa (e "Em execução"), sem tempo decorrido, barra ou estimativa; a etapa Narração do Kokoro ficou ≈ 88–92 s parada, e
o render ≈ 75 s. A etapa interna aparece como `align` em inglês, entre rótulos traduzidos. Sugestão: tempo decorrido e
"etapa 2 de 7"; traduzir `align` ("Alinhando fala"); aviso "Kokoro pode levar mais de 1 min na primeira seção".

**J-11 A tela de produção é uma única rolagem muito longa e estreita; a prévia não aparece onde se clica.** Os painéis
(detalhes, 36 artefatos em tabela, QC, licenças, linha do tempo, notas, decisão) estão aninhados em uma coluna de
≈ 600 px dentro de uma janela de 1320 px (`07-linha-do-tempo-palavras.png`). Em `06-previa.png`, logo após clicar em
"Prévia de vídeo (MP4)", o player não está na área visível; para usar o vídeo e a nota por timecode é preciso rolar
entre painéis distantes. "Capturar tempo atual do player" exige o vídeo fora da tela. Sugestão: tabela de artefatos
recolhida por padrão, prévia fixada (sticky) ao lado de linha do tempo/notas, e rolagem automática ao player.

**J-18 O modo volta a "Simulado" e o botão muda de rótulo.** O seletor "Modo de execução" abre em "Simulado" a cada
visita (inclusive ao abrir uma produção já concluída em `local_pilot`), e o botão passa de "Iniciar produção simulada"
para "Iniciar piloto local com narração". Para o fluxo real é sempre preciso trocar o modo; quem não trocar gera
fixtures sem vídeo. Sugestão: lembrar o último modo ou destacar o piloto como recomendado.

**J-15 ★ Após recarregar a página, a análise precisa ser reaberta.** No teste Kokoro (reconectar e abrir Produção), o
cartão de disparo não aparece até clicar em "Revisão 1 …" na lista de análises recentes, cujo rótulo é o id truncado
`613e40f5703c…` sem título. Sugestão: abrir a análise mais recente por padrão e rotular a lista com o título da proposta.

**J-20 Licenças: um asset por vez.** São 8 assets e cada verificação exige abrir o formulário, preencher id/nome/URL/
uso comercial/evidência e confirmar duas vezes; não há aplicar-a-vários para as 3 cenas originais nem para as 5 faixas
de voz. Registrar as 8 levaria ≈ 8 × 7 s no melhor caso (medido 7,2 s para um). Sugestão: "aplicar a assets da mesma
origem", mantendo o registro append-only por asset.

### Cosmético

- **J-03 ★ Radar → Produção sem atalho.** Após "ANÁLISE INICIADA COM SUCESSO", o texto manda "acompanhar… na página
  Produção" sem botão; é preciso usar o menu lateral. Captura `02-analise-iniciada.png`.
- **J-04** O fluxo mostra "Na fila" enquanto a etapa "Análise" aguarda autorização explícita (`03-proposta.png`).
- **J-05** A proposta simulada sugere "Vídeo Longo" para um pedido de vídeo curto e título genérico "Uma perspectiva
  autoral para explorar"; a Central lista o vídeo por esse título (`12-central.png`).
- **J-07 ★** Roteiro simulado termina o desenvolvimento com "Ajustes da revisão anterior:" sem conteúdo
  (`04-roteiro.png`); origina J-12.
- **J-08 Termos internos sem explicação:** `publishable: false`, `real_voice`, `demo_only`, `speech_aligned`,
  `measured_sections`, `windows_sapi`, `local_pilot` (na Central: "roteiro v1 · local_pilot"), `asset-provenance.json`,
  `pilot-evidence.json`, "Contrato 2/3", SHA-256 de 64 caracteres em tabelas, e logs `estado: queued` / `stage: align`.
  Sugestão: rótulos em português e termos técnicos em tooltip/"detalhes".
- **J-21** O histórico de licença exibe data ISO em UTC (`2026-11-13T21:52:17.446256+00:00`), enquanto o resto usa
  data local (`13/11/2026, 18:52`).
- **J-22** QC do Kokoro avisa "loudness integrada -26.6 LUFS fora de -26..-12" sem dizer o que fazer.
- **J-23** Em Ajustes › Ambiente local, "NÃO LOCALIZADO" não distingue ferramenta ausente de caminho configurado
  inválido (visto ao errar `HORUS_FFMPEG`).

### Pontos que funcionaram bem

Aprovação por hash exige ciência explícita das pendências (botão desabilitado antes), a verificação de licença pede
confirmação permanente, o resumo de narração identifica motor e voz reais, a Central reflete a decisão ("Aprovada na
revisão (demonstração; não publicável) · Sem ação pendente"), e os bloqueios nunca substituem a voz por tom.

## Sugestões de correção pequenas (ordem sugerida)

1. `license_reviews._INPUTS` aceitar fontes (J-13) — uma linha + teste.
2. Recarregar `AssetProvenancePanel` ao concluir a produção e mostrar "carregando" (J-14).
3. Normalizar quebras de linha antes do alinhamento e mostrar o motivo (J-12/J-07).
4. Seletor de voz/qualidade no cartão de disparo (J-01) — a maior correção, depende da API já existente.
5. Texto de bloqueio por causa real e nota sobre `FABRICA_HOME` (J-17).
6. Progresso/tempo decorrido e tradução de `align` (J-10); lembrar o modo (J-18); atalho Radar→Produção (J-03).

## Verificações e limites

- `node frontend/scripts/e2e-backend.mjs run --headed --reporter=list`: **2 passed (6,5 min)**.
- `HORUS_E2E_NO_OVERLAY=1 … run --headed -g Radar`: **1 passed (2,6 min)**, com verificação de licença registrada.
- Spec sem as variáveis: **2 skipped**; script sem as três variáveis: recusa com mensagem.
- Não executados: `npm --prefix frontend run build`, suíte Playwright padrão completa e pytest (nenhum código de produto
  foi alterado). O teste não valida naturalidade, escuta humana nem conteúdo editorial.
- Falhas intermediárias do próprio teste (seletores estritos, busca "concluída" que casou com o histórico, gravação de vídeo
  sem ffmpeg do Playwright) foram corrigidas no spec; nenhuma exigiu mudança de produto.
