# Piloto audiovisual local — HOR-054 / HOR-056

## Meu primeiro vídeo com roteiro próprio — HOR-133

1. Em **Radar**, carregue a demonstração e use **Iniciar análise** com Hermes simulado. Em **Editorial**, autorize a execução simulada e aprove a proposta resultante. Isso não chama o Hermes real.
2. Na revisão de roteiro, use o editor manual quando disponível na sua versão: escreva título e 3 a 6 seções, com gancho, desenvolvimento e conclusão. Para 60 a 120 segundos, comece com cerca de 150 a 200 palavras; a duração final depende da voz. Aprove a versão escrita.
3. Em **Ajustes → Narração**, confira a disponibilidade e ouça uma prévia. Na produção, selecione `local_pilot`, voz `kokoro/pf_dora` ou Microsoft Maria e qualidade `final` (1080×1920). Quando a tela ainda não expuser uma opção, use o corpo da API abaixo.
4. Aguarde o MP4 e o QC. Na revisão da produção, assista, ouça, confira legendas e registre a verificação de licenças. Aprove pelo hash do vídeo; erros de QC exigem reconhecimento explícito. Aprovar o piloto mantém `demo_only=true` e `publishable=false`.

API local autenticada (cada POST exige uma `Idempotency-Key` nova; conserve-a para repetir o mesmo pedido):

```text
POST /v1/workflows/{workflow_id}/scripts
{"source":"manual","expected_revision":1,"proposal_artifact_id":"ID_DA_PROPOSTA_APROVADA","document":{"title":"Meu vídeo","sections":[{"id":"inicio","kind":"hook","heading":"Gancho","narration":"Seu texto de abertura."},{"id":"meio","kind":"body","heading":"Desenvolvimento","narration":"Seu desenvolvimento."},{"id":"fim","kind":"conclusion","heading":"Conclusão","narration":"Seu encerramento."}]}}
POST /v1/scripts/{script_id}/review
{"expected_version":1,"decision":"approve"}
POST /v1/scripts/{script_id}/productions
{"expected_version":1,"mode":"local_pilot","render_quality":"final","narration":{"provider":"kokoro","voice_id":"pf_dora"}}
GET /v1/productions/{production_id}
POST /v1/productions/{production_id}/review
{"decision":"approve","artifact_sha256":"SHA256_DO_MP4","acknowledge_quality_errors":true,"notes":[]}
```

Use revisão/versão/IDs retornados pela API. Para Maria, consulte `GET /v1/narration/providers` e informe `provider: "windows_sapi"` e o `voice_id` instalado. A verificação de licença é separada: `GET/POST /v1/productions/{production_id}/license-reviews`; cada decisão referencia `asset_id` e `asset_sha256`, termos e evidência, sem modificar o manifesto original. Nunca registre uma licença como verificada sem conferi-la. O reconhecimento de QC só é necessário quando `quality_acknowledgement_required=true`.

Ensaio reproduzível com texto fictício realista, números, sigla e frases longas, pelas APIs públicas (sem editar o banco). Requer os recursos locais já preparados abaixo e Kokoro; não baixa modelos:

```powershell
$env:HORUS_PILOT_FACTORY = "$env:TEMP/horus-m4/backend-factory-demo"
$env:HORUS_ALIGNMENT_MODEL = "$env:LOCALAPPDATA/Horus/models/whisper"
$env:HORUS_FFMPEG = "$env:LOCALAPPDATA/Horus/tools/ffmpeg/n8.1.3-35-gf1acb0a266/ffmpeg-n8.1.3-35-gf1acb0a266-win64-gpl-8.1/bin/ffmpeg.exe"
$env:HORUS_KOKORO_PYTHON = "$env:LOCALAPPDATA/Horus/tools/kokoro-proof/venv/Scripts/python.exe"
$env:HORUS_KOKORO_MODEL_DIR = "$env:LOCALAPPDATA/Horus/tools/kokoro-proof/model"
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_manual_script_flow.py -q -s --basetemp "$env:TEMP/hm-$([guid]::NewGuid().ToString('N').Substring(0,8))"
```

O teste registra `manual-flow-report.json` para cada voz, com tempos monotônicos, hashes, duração física, alinhamento e QC. A aprovação e a verificação de uma cena são fictícias de teste; não substituem escuta humana nem autorizam a licença da voz. O roteiro humano usa `origin=human`, `authored_by=human`, `simulated=false`; somente a proposta permanece simulada. A disponibilidade e os rótulos do editor dependem do incremento de interface; este ensaio valida a API, não a tela.

### Normalização da narração Kokoro

Com `HORUS_FFMPEG` configurado, o worker normaliza Kokoro em duas passagens `loudnorm` antes do alinhamento e do render: alvo −16 LUFS, teto −1,5 dBTP. O limitador pode usar ganho dinâmico; `narration-normalization.json` registra loudness antes/depois, ganho solicitado, ganho efetivo de loudness, método, SHA do FFmpeg e hashes dos WAVs. A quantidade de amostras e os limites das seções são preservados. Os WAVs originais e o intermediário normalizado ficam registrados como artefatos locais; o QC continua medindo o áudio final e usa os mesmos limiares. Sem FFmpeg explícito, não se presume normalização. Maria mantém seu áudio original. Se a fábrica terminar com erro, `render-failure.json` preserva o código de saída e os últimos 8192 bytes do diagnóstico local; o texto público do erro continua controlado.

### Evidências do ensaio manual — 13/11/2026

Roteiro fictício original em pt-BR com **193 palavras, 4 seções**, números (`2026`, `12`, `30`, `50%`), sigla `ONG` e frases longas. As duas execuções abaixo partiram do Radar/Hermes simulado, passaram pela autorização e aprovação da proposta, criação manual pública, aprovação do roteiro e render `final`; registraram uma licença fictícia de cena, aprovação fictícia do MP4 por hash e persistência após reinício. Nenhuma decisão do teste constitui aceite editorial ou licença real da voz.

| Medição | Kokoro `pf_dora` | Microsoft Maria |
|---|---:|---:|
| Narração WAV | 73,225 s | 111,123311 s |
| MP4 1080×1920 / 30 fps | 74,033333 s / 2221 frames | 111,933333 s / 3358 frames |
| Palavras casadas / interpoladas | 190 / 3 (98,45%) | 192 / 1 (99,48%) |
| Maior trecho interpolado | 1,02 s | 1,24 s |
| ASR | 207,45 s | 51,58 s |
| Render da fábrica / render com verificações | 310,015 / 384,515 s | 238,656 / 325,422 s |
| Sobreposição libass | 45,359 s | 57,969 s |
| Fluxo até aprovação pela API | 854,594 s | 418,688 s |
| LUFS medidos no MP4 | −16,56 | −23,85 |

Fonte: relógios monotônicos de `manual-flow-report.json`, `alignment-report.json`, `render/validation.json` e `caption-overlay.json`; duração física de WAV/ffprobe e loudness do QC. São medições desta máquina; houve outros ensaios concorrentes, especialmente no caso Kokoro. Não são estimativas nem benchmark de desempenho.

- Kokoro MP4 SHA-256: `e9ebd159d95e7595f22fb5aefe272afc2e92d0fbb2bd99d10f35c1918c32a670`; WAV: `7a9ade7f270247b07fc072a82f47f12b13569b77d5676908f430de134232978f`. Relatório em `%TEMP%/hmh-f06bd277/test_real_manual_script_to_fin0/manual-flow-report.json`, produção `154bcba89b344b21bb909f485b034b22`.
- Maria MP4 SHA-256: `d53b7a456635dc4138fcaede722266df02dc5fb24333909897ca5320833850ba`; WAV: `43493a8ab667ed0656371bb8208a46c3855c2088be264f8fb5dc1a7045ace7a8`. Relatório em `%TEMP%/hmr-d95d0354/test_real_manual_script_to_fin0/manual-flow-report.json`, produção `d97d525ad5a245fda807257fd4c85859`.

QC persistido: **warn somente por proveniência não verificada**, sem erros; loudness, integridade e sincronização passaram nas duas vozes. SRT versus palavras: desvio médio/máximo 0,000 s; os tempos interpolados continuam identificados como interpolados. Kokoro não casou “Vila Aurora queira”; Maria não casou “milagrosa,”. Os números e a sigla tiveram correspondência. Nenhum limiar foi alterado. O validador independente também retornou `blocking_errors=[]`; sua checagem estrutural com `forced_alignment` conserva um aviso legado de contenção não verificada, embora o QC físico confira a contenção por palavras. A normalização Kokoro mediu −26,81 → −16,52 LUFS no WAV, ganho efetivo de loudness de 10,29 dB; o original permanece preservado.

Ensaios preliminares: o texto de 233 palavras passou com Kokoro, mas ultrapassou 120 s com Maria (131,162766 s); o exemplo foi encurtado, sem cortar áudio nem mudar o limite do teste. O ensaio Hermes simulado terminou com **1 failed, 5 passed em 2354,15 s**: Maria falhou no renderer sem diagnóstico disponível; após preservar stderr no worker, a repetição isolada acima passou (**1 passed em 419,42 s**), sem reocorrência. A causa da falha anterior permanece indeterminada. O ensaio editorial legado com 193 palavras também passou nas duas vozes (**5 passed em 1533,42 s**).

Validações focadas: `python -m pytest backend/tests/test_manual_script_flow.py backend/tests/test_local_pilot.py backend/tests/test_production.py backend/tests/test_scripts_manual.py backend/tests/test_narration_kokoro.py backend/tests/test_av_quality.py backend/tests/test_pilot_quality.py backend/tests/test_speech_alignment.py -q --tb=short`: **276 passed, 13 skipped em 73,95 s**. Normalização física, diagnósticos de falha e preservação dos originais têm testes. Uma passagem concorrente da suíte terminou com **1 failed, 1107 passed, 15 skipped em 397,86 s**, com falha em `test_radar_workflow.py::test_cancel` (`completed` em vez de `cancelled`); a repetição isolada passou (**1 passed em 2,14 s**), sem alterar o Radar/Hermes. Suíte completa final, sem renders concorrentes: `& backend/.venv/Scripts/python.exe -m pytest backend/tests -q --tb=short`: **1110 passed, 15 skipped, 1 warning em 485,99 s**. O aviso é do Pydantic no teste deliberado de tipo inválido (`simulated="false"`). Os skips incluem os ensaios reais opt-in, executados separadamente acima. `git diff --check` aprovado.

Limites: API e arquivos reais verificados; frontend, instalador, Linux, naturalidade vocal e aceite humano editorial não foram validados. Um frame foi inspecionado e estava legível, sem recorte aparente; isso não é inspeção integral nem escuta. `publishable=false` e `demo_only=true` permanecem.

### Auditoria de rede com renders simultâneos — HOR-133

O worker escolhe uma porta HTTP explícita pelo sistema operacional para cada render (`--port`), registrada em `render/validation.json`. Isso evita a disputa pelo início da faixa padrão 3000: o lock do seletor do Remotion instalado é apenas interno ao processo Node. A porta de teste é liberada antes de o Node escutar; se outro processo a ocupar nesse intervalo, o Remotion falha, sem reutilizar o servidor alheio. O proxy continua local, com porta atribuída pelo SO e bloqueio de destinos externos.

Cada browser possui manifesto e NetLog com PID do Node e UUID próprios, mesmo quando mais de um browser nasce na mesma produção. A auditoria valida todos os manifestos e logs, em vez de aceitar somente o último escritor. O PID efetivamente criado pelo `spawn` é registrado; o callback de saída do Node ou uma consulta de término do processo ao SO confirma o encerramento antes da leitura. No Windows, a consulta usa `OpenProcess(SYNCHRONIZE)`/`WaitForSingleObject`, sem encerrar processos nem mudar permissões.

Leitura aguarda até 5 s por arquivo para fechamento/flush e falhas transitórias de compartilhamento. Mantém a política anterior de aceitar somente a falta do sufixo estrutural `]}` quando todos os eventos armazenados são JSON íntegro; isso só ocorre ao fim da espera, após estabilização e término confirmado do browser, com `netlog_complete=false` explícito. Nunca elimina um registro parcial nem inventa eventos. NetLog ausente, evento cortado, esquema inválido, browser sem término confirmado ou TCP externo continuam impedindo a entrega. Essa auditoria de browser/Node não equivale a captura de rede de todo o sistema.

Falhas registram `audit_error: {code,type,message}` em `result.json` e no resultado do job, além de um evento `error` e do artefato `network-failure.json`. A mensagem inclui papel do arquivo e linha/coluna JSON ou errno/winerror, sem conteúdo bruto, caminhos privados, URLs ou tokens. Não se presumiu a causa exata da falha anterior da main, que não tinha esse diagnóstico.

Reprodução real concorrente (fábrica local já preparada, sem TTS/Whisper, dois `local_demo` de roteiro humano curto em bancos temporários independentes):

```powershell
$env:HORUS_PILOT_FACTORY = "$env:TEMP/horus-m4/backend-factory-demo"
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_production_network.py::test_real_concurrent_render_audits_are_isolated -q -s --tb=short --basetemp "$env:TEMP/hna-$([guid]::NewGuid().ToString('N').Substring(0,8))"
```

**1 passed em 157,98 s**, relatório `%TEMP%/hna-7531216b/test_real_concurrent_render_au0/concurrent-audit-report.json`: produções `4a71d2b53ce14d50b62898c6c5d1997a` e `c7996477e3474ca3a8cd7a71b76eeba5`, portas HTTP **63901 / 63900**, proxies **59099 / 59098**, **1586 / 1589 eventos**, logs distintos e nenhum TCP externo registrado. Ambos os browsers estavam terminados por confirmação do SO; os NetLogs ficaram honestamente `netlog_complete=false` por falta do sufixo JSON, sem perder registros. O primeiro ensaio falhou fechado (**1 failed em 84,68 s**) ao depender só do callback de saída do Node: os manifestos permaneceram `browser_closed=false` mesmo após término real. Isso motivou a confirmação pelo SO; nenhum critério foi afrouxado para passar.

Os testes também reproduzem NetLog ausente, JSON no meio de um evento, falha de compartilhamento seguida de flush, evento externo que chega depois de um prefixo aparentemente íntegro, múltiplos browsers e propagação da causa para job/evento. Após a correção do relógio capturado antes de uma leitura lenta, a repetição final passou: **1 passed, 1 warning em 170,55 s**, relatório `%TEMP%/hnf-bbd3a10d/test_real_concurrent_render_au0/concurrent-audit-report.json`; produções `e82df6442a2a4a8ca365895dc9d5a178` / `caf3b09b5a524cb99e8e3899971e755c`, portas HTTP **51885 / 51886**, proxies **51883 / 51884**, **1648 / 1626 eventos**, sem TCP externo. O aviso Pydantic sobre alias `request` foi registrado no ensaio concorrente e não provocou falha. Regressão final: `& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_production_network.py backend/tests/test_production.py -q --tb=short`: **65 passed, 4 skipped em 62,66 s**. Suíte completa final: `& backend/.venv/Scripts/python.exe -m pytest backend/tests -q --tb=short`: **1121 passed, 16 skipped, 1 warning em 267,36 s**. O aviso é o teste deliberado de tipo inválido do contrato de produção; os ensaios reais condicionais foram executados separadamente. `git diff --check` aprovado.

## Provedor e voz na produção — HOR-132, 13/11/2026

O pedido aceita `narration: {provider, voice_id}` opcional em `local_pilot`.
Exemplo: `{"expected_version":1,"mode":"local_pilot","narration":{"provider":"piper","voice_id":"pt_BR.onnx"}}`.
Sem seleção explícita, usa a preferência dos Ajustes; sem preferência, preserva
a primeira voz SAPI pt-BR instalada. A escolha efetiva é persistida no plano e
no recibo de idempotência; outra escolha com a mesma chave retorna 409.
Provedor/voz indisponível bloqueia a produção, sem substituir por SAPI ou por tom.

A síntese passa pelo registro de provedores, em processo possuído pelo worker,
por seção. Timeout e cancelamento encerram seus subprocessos. Piper exige binário
e modelos já preparados; nenhum download ocorre no job. Provedores pagos continuam
bloqueados antes de consultar o cofre ou enviar texto, independentemente de flags.
O campo de autorização não é exposto nesta API.

Cada WAV registra origem, engine e voz. Modelos locais registram versão e SHA-256
dos pesos; a licença continua não verificada. A disclosure cita o provedor e a voz
efetivos. Whisper, limites de QC e aprovação humana valem para todos os provedores;
nenhum resultado do adaptador substitui o alinhamento acústico. `demo_only=true`
e `publishable=false` permanecem. Detalhes em [narração](narracao-provedores.md).

Os testes unitários isolam `HORUS_FFMPEG`, `HORUS_ALIGNMENT_MODEL`,
`HORUS_SUBTITLE_FONT` e `HORUS_PILOT_FACTORY` quando essas configurações não são o
objeto do teste. A seleção de cues cobre explicitamente libass (fim acústico)
e regra da fábrica (com manutenção), com/sem alinhamento válido. Ensaios reais
continuam opt-in e preservam as variáveis fornecidas pelo operador.

### Configuração da fábrica e causas de bloqueio (J-17)

- A fábrica é descoberta por `FABRICA_HOME`. `HORUS_PILOT_FACTORY` (a variável dos ensaios e testes) é aceita como
  alias e só vale quando `FABRICA_HOME` está ausente ou vazia; `FABRICA_HOME` tem precedência.
- Cada pré-condição reporta a própria causa: fábrica não configurada (cita `FABRICA_HOME`), Python da fábrica,
  Remotion, browser, `ffmpeg` e `ffprobe` aparecem separados; `HORUS_FFMPEG` ou `HORUS_SUBTITLE_FONT` inexistentes
  bloqueiam com o nome da variável; um erro de sistema ou timeout inesperado informa o tipo do erro, sem atribuí-lo
  à voz SAPI nem expor caminhos.

### Alinhamento do roteiro e seu motivo (J-12)

O texto de cada seção tem espaços e quebras de linha internos normalizados (`speech_alignment.join_script`) antes
do alinhamento e da validação, de modo que uma `
` dentro da narração não impeça o alinhamento; os limiares não
mudaram. Quando o alinhamento não é executado ou fica abaixo do critério, `alignment-report.json` registra o
`reason` e o check `word_timings` do QC o repete no `detail`.

### Loudness fora da faixa (J-22)

O aviso de loudness continua com a faixa de -26 a -12 LUFS; o `detail` agora orienta aumentar ou reduzir o ganho e
normalizar a narração para cerca de -16 LUFS (alvo sugerido, não limiar).

### Ensaio SAPI pelo registro

Ensaio em basetemp novo `%TEMP%/hn-459ac077`, produção
`0221edbf445e47eeb2b0296d41c8025b`: **1 passed em 129,03 s**, incluindo
cancelamento durante síntese, render final, revisão fictícia e reinício.
Executado com `HORUS_PILOT_FACTORY`, `HORUS_ALIGNMENT_MODEL`, `HORUS_FFMPEG`
e `HORUS_PILOT_QUALITY=final`, usando os recursos já preparados descritos abaixo.

Engine `windows_sapi`, voz **Microsoft Maria Desktop - Portuguese(Brazil)**;
o plano e a evidência registram o token SAPI efetivo. WAV combinado: **47,912925 s**,
SHA-256 `2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a`.
MP4: **1080×1920, 30 fps, 1462 frames, 48,733333 s**, SHA-256
`0098ba2d7dc5e6f9d14b4af554a5593b4267ea967d2080d1327329f15df0709b`.
Whisper mediu **77/77 palavras casadas**, zero interpoladas, em **6,34 s**.
QC **warn**, `blocking_errors=[]`; único aviso: licença/proveniência não verificada.
As 27 cues tiveram desvio máximo/médio de **0,000 s** contra os tempos medidos.

Fonte dos tempos: relógios monotônicos em `alignment-report.json` e
`render/validation.json`: fábrica **96,343 s**, sobreposição **5,109 s**,
render com verificações **107,812 s**. O teste não avalia naturalidade nem constitui
aceite humano da voz. Piper nesta integração foi coberto por mocks e contratos;
não foi executada síntese Piper real, serviço pago, frontend ou pacote instalado.

Artefatos preservados sob `%TEMP%/hn-459ac077/test_real_local_pilot_render_r0/data/productions/0221edbf445e47eeb2b0296d41c8025b/`.
Os dois primeiros ensaios falharam antes da entrega: descoberta de configuração
global no ambiente mínimo e import indireto de `keyring` no Python independente
da fábrica; ambos foram corrigidos e o segundo recebeu regressão sem site-packages.

### Verificações deste incremento

- Suíte completa durante a implementação, sem as quatro variáveis operacionais:
  `python -m pytest backend/tests -q --tb=short`: **1047 passed, 10 skipped**, 148,59 s.
- Suíte completa com as quatro variáveis definidas para caminhos fictícios:
  **1049 passed, 8 skipped, 2 deselected**, 152,61 s. Os dois ensaios opt-in de
  `test_local_pilot.py` foram excluídos por seus IDs `tests/test_local_pilot.py::test_real_sapi_owned_process_cancels_without_finishing`
  e `tests/test_local_pilot.py::test_real_local_pilot_render_review_and_restart` via
  `--deselect`; o ensaio real final foi executado separadamente com caminhos válidos.
- Regressão afetada (piloto, produção, contrato, narração, QC, alinhamento e mídia):
  **405 passed, 8 skipped**, 30,15 s; última confirmação dos módulos de piloto,
  produção e síntese: **107 passed, 6 skipped**, 23,86 s.
- Após isolar também as variáveis de Piper/provedor pago nos testes, narração e
  produção: **85 passed, 3 skipped**, 23,89 s. `git diff --check` aprovado.

Todos os comandos usaram `backend/.venv/Scripts/python.exe`. Os testes novos cobrem
preferência, escolha explícita, padrão SAPI, recibo antigo, 409 por escolha diferente,
indisponibilidade sem fallback, bloqueio pago sem consulta ao cofre, timeout e
cancelamento com processo real temporário, modelo alterado durante síntese,
proveniência negativa e regressões simulated/local_demo. Nenhum limiar de QC mudou.

## Legenda medida e preset final — 13/11/2026

O pedido de produção aceita `render_quality: "draft" | "final"`. O padrão permanece `draft` (540×960); `final` (1080×1920) é aceito somente em `local_pilot`. A opção fica no plano JSON persistido, sem migração de banco; planos e recibos antigos continuam interpretados como `draft`. Exemplo de corpo para `POST /v1/scripts/{id}/productions`: `{"expected_version":1,"mode":"local_pilot","render_quality":"final"}`. A seleção ainda não foi acrescentada à interface.

As cenas PNG são geradas na resolução escolhida. Regiões, fontes e bounds são recalculados proporcionalmente e conferidos durante a geração para os quatro sentidos do Ken Burns. O preset final existente da fábrica usa H.264 CRF 20, AAC 192 kb/s, 30 fps, sem `scale=0.5`, e produz `render/short.mp4`; draft mantém `render/short-rascunho.mp4`, CRF 30 e AAC 128 kb/s.

Com `Settings.ffmpeg` / `HORUS_FFMPEG` configurado para um executável local com `subtitles`/libass, o Hórus fornece `palavras=[]` nas props da composição. A fonte da fábrica e o `alinhamento.json` medido permanecem intactos. Depois aplica o `fixture.srt` por libass: grupos de até três palavras da mesma seção, início da primeira e fim da última palavra medidos, arredondados a milissegundos. Não prolonga o grupo até a próxima fala; a rasterização tem a quantização própria de libass e dos frames de 30 fps. Sem alinhamento válido, as cues continuam estimadas por seção e `speech_aligned=false`.

Há somente uma reencodificação de vídeo após a fábrica (CRF 20 final / 30 draft), com `-c:a copy`. O worker compara resolução, fps, número de frames, duração e os hashes/tempos de todos os pacotes AAC antes e depois; divergência bloqueia a entrega. `render/caption-overlay.json` e `render/validation.json` registram método, SRT, fonte, alinhamento, hashes intermediário/final e tempos monotônicos. O MP4 sem legenda é preservado localmente para auditoria, sem ser registrado como vídeo de revisão. `short.insumos.json` passa a apontar para o hash final, com os dados da sobreposição. As extrações `subtitles-compare-1.png` a `-3.png` documentam três instantes para inspeção visual.

Sem `HORUS_FFMPEG`, permanece a legenda embutida e seu QC temporal honesto, inclusive a falha conhecida nas pausas. Executável explicitamente configurado mas ausente ou sem libass bloqueia a produção; nenhum job baixa dependências. A verificação de filtros (30 s) e a sobreposição (1800 s) usam `OwnedProcess`, ambiente mínimo e encerramento em timeout/cancelamento; continuam dentro da árvore possuída do worker, cujo limite é 3600 s.

### Ferramenta e fonte preparadas separadamente

No ensaio foi instalado, sem alterar PATH global, o build GPL BtbN **n8.1.3-35-gf1acb0a266 win64-gpl-8.1**, release fixada `autobuild-2026-11-13-12-43`. A release consultada não oferecia n7.x. Arquivo: **194055132 bytes**, SHA-256 **`096d0596ba87ee534c6357797dc68882e714b53aac76859fca4be9c012a6a91c`**, conferido contra o checksum publicado antes da extração. [Arquivo oficial](https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-13-12-43/ffmpeg-n8.1.3-35-gf1acb0a266-win64-gpl-8.1.zip), [checksums publicados](https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-13-12-43/checksums.sha256). Uso local como ferramenta separada GPL; não foi incluído em instalador nem distribuído.

O FFmpeg do lock Remotion permanece instalado para render/probe/QC; não contém `subtitles`, `ass` ou `drawtext`. O executável completo é usado explicitamente para a sobreposição. Caminho local: `%LOCALAPPDATA%/Horus/tools/ffmpeg/n8.1.3-35-gf1acb0a266/ffmpeg-n8.1.3-35-gf1acb0a266-win64-gpl-8.1/bin/ffmpeg.exe`.

SHA-256 do executável extraído: `486aeb53e82512f81319b228eeefb14376dd85413f6f753a4e166b59502ed943` (o checksum publicado refere-se ao ZIP). Os filtros `ass`, `subtitles` e `drawtext` foram confirmados pela listagem do binário preparado.

Nenhuma fonte OFL foi encontrada na sandbox da fábrica. Usa-se a fonte aberta já presente em `frontend/public/fonts/ArchivoExpanded-SemiBold.ttf` (somente leitura, copiada para a produção), da Omnibus-Type / The Archivo Project Authors. SHA-256 **`477294342b225706dc0e52f2eaa0e2da2114ca38fb3131bf34466abbc9cdf9a0`**; licença declarada [SIL OFL 1.1](https://openfontlicense.org/open-font-license-official-text/), origem [Archivo](https://github.com/Omnibus-Type/Archivo), texto local `frontend/public/fonts/OFL-Archivo.txt`. A fonte consta como `kind=font`, `origin=licensed_manual`, `license.id=OFL-1.1`, `status=unverified` e licença legada `unverified`, sem presumir revisão humana. `Settings.subtitle_font` / `HORUS_SUBTITLE_FONT` permite apontar para esse arquivo preparado. Na ausência da fonte local, o fallback é Arial Black do Windows (`ariblk.ttf`), com termos Microsoft declarados e uso comercial desconhecido. Não há download de fonte no job. O estilo é próximo ao da fábrica (texto claro, contorno escuro, região segura), sem identidade visual idêntica nem destaque amarelo por palavra.

```powershell
$env:HORUS_PILOT_FACTORY = "$env:TEMP/horus-m4/backend-factory-demo"
$env:HORUS_ALIGNMENT_MODEL = "$env:LOCALAPPDATA/Horus/models/whisper"
$env:HORUS_FFMPEG = "$env:LOCALAPPDATA/Horus/tools/ffmpeg/n8.1.3-35-gf1acb0a266/ffmpeg-n8.1.3-35-gf1acb0a266-win64-gpl-8.1/bin/ffmpeg.exe"
$env:HORUS_PILOT_QUALITY = 'final' # somente o ensaio: no produto, escolha no pedido
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_local_pilot.py::test_real_local_pilot_render_review_and_restart -q -s --basetemp "$env:TEMP/hf-$([guid]::NewGuid().ToString('N').Substring(0,8))"
```

### Evidência do ensaio final

Basetemp novo `%TEMP%/hf-a3b39ef7`, produção `a907a32699a74f529ae220ba30933218`: **1 passed em 154,96 s** (teste integral com cancelamento de produção anterior, render, revisão fictícia `reject` e reinício). MP4 **1080×1920 / 30 fps / 1462 frames / 48,733333 s**, H.264/AAC, SHA-256 **`0098ba2d7dc5e6f9d14b4af554a5593b4267ea967d2080d1327329f15df0709b`**. Intermediário: `469b25aac44acfac3c94513c4a8d4c22355346de5746f5d20acd47d2de244dbe`.

Medições por `time.monotonic` em `validation.json`: fábrica **101,828 s**, sobreposição **6,828 s**, render + verificações/extrações **116,703 s**. ASR: **8,75 s**, **77/77 palavras casadas**, nenhuma interpolada. São medições desta máquina/execução, sem garantia de tempo para outros roteiros.

QC completo persistido: **`warn`**, **`blocking_errors=[]`**. `subtitles_vs_words`: **pass / measured**, média e máximo **0,000 s**, 27 cues casadas, nenhuma sem correspondência. Contenção `subtitles_vs_sections`: **pass / measured**, manutenção máxima **0,000 s**; cobertura **77/77**. Integridade, hashes dos 8 assets (incluindo fonte), clipping, nível, silêncio, duração, LUFS/true peak, quadros pretos e congelamento passaram; o único aviso foi proveniência ainda não verificada por humano. Não há aviso de resolução no `validate_pilot_evidence` para 1080×1920. Os três PNGs extraídos foram inspecionados visualmente: legenda legível e sem recorte. Essa inspeção não equivale a escuta ou aceite humano.

Artefatos preservados localmente em `%TEMP%/hf-a3b39ef7/test_real_local_pilot_render_r0/data/productions/a907a32699a74f529ae220ba30933218/`, incluindo `quality-report.json`, `pilot-evidence.json` e `canais/demo/videos/fixture/render/short.mp4`. Nenhum upload, serviço pago ou inferência Hermes. `publishable=false`, `demo_only=true` e revisão humana permanecem. Não foram ensaiados frontend, instalador, Linux nem voz humana.

Auditoria física adicional em `%TEMP%/hf-a3b39ef7/audit-caption-visibility.json`: frames RGB decodificados da região de legenda `(0,1190,1080,400)`, comparados com o intermediário sem texto. Antes da maior pausa (12,57 s), 19459 pixels claros adicionais; no centro da pausa de 1,18 s (14,33 s), **zero**; na fala seguinte (15,61 s), 12483. O intermediário teve zero nos três pontos. São três amostras físicas, não uma medição exaustiva de todos os frames; complementam o QC de SRT contra palavras medidas.

Regressão dos módulos afetados e contratos relacionados, sem ferramentas reais habilitadas: `& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_local_pilot.py backend/tests/test_production.py backend/tests/test_production_contract.py backend/tests/test_speech_alignment.py backend/tests/test_av_quality.py backend/tests/test_pilot_quality.py backend/tests/test_media_contracts.py -q`: **349 passed, 8 skipped em 24,69 s**. Os skips são condicionais de fábrica/MP4 real não configurados nessa invocação; ensaios reais são registrados separadamente. Inclui os dois tamanhos de PNG, bounds contínuos do Ken Burns, geração GDI, compatibilidade do plano legado, validação/idempotência de qualidade, término em timeout/cancelamento e ambiente mínimo da ferramenta.

O fallback `draft` também foi ensaiado sem `HORUS_FFMPEG`, com alinhamento configurado, em basetemp novo `%TEMP%/hd-0e539f8d`: **2 passed em 113,01 s**, incluindo hash da fonte da fábrica. MP4 **540×960 / 48,733333 s**, SHA-256 `f086094a563f2425ef4a2f04de47a33190d6a5bce43928e06c8a26c272600828`, produção `94911fba750a4194b308e214f83d4d04`. O teste confirmou **QC fail esperado**, desvio máximo **1,193 s** e médio **0,191 s**, sem afrouxar limiares para o fallback; a aprovação continua exigindo ciência explícita dos erros. O teste aprovado confirma esse comportamento, não a qualidade editorial do fallback.

Repetição final com o código de `b7aaad236456426d3154d2fa7111ac5e328a07db` e asserções adicionais do aviso de resolução: **2 passed em 139,10 s**, incluindo detecção de deriva da fábrica. Basetemp novo `%TEMP%/hf-0f9f9bfe`, produção `43975ca29778409bbf219c1e7e48b2bd`; MP4 com o **mesmo SHA-256 `0098ba2d7dc5e6f9d14b4af554a5593b4267ea967d2080d1327329f15df0709b`**, 1080×1920 e 48,733333 s. Fábrica **96,828 s**, sobreposição **11,906 s**, render + verificações/extrações **117,125 s**, ASR **7,56 s**. QC novamente `warn`, sem bloqueios, único aviso `asset_provenance`; sincronização e contenção aprovadas por medição. O SHA da fonte `LegendaPalavra.tsx` continuou `aa4688a4affa70d607ae246ebaf47fe01dae102c604ad050fa87d886b4d04e2c`.

## Histórico anterior / fallback sem libass

As seções seguintes preservam evidências anteriores. A regra de permanência da fábrica descrita abaixo continua aplicável quando `HORUS_FFMPEG` não está configurado; a sobreposição acima corrige esse limite sem modificar a fábrica.

## Alinhamento acústico no worker — 13/11/2026

Configure explicitamente `Settings.alignment_model` ou `HORUS_ALIGNMENT_MODEL` com a pasta que contém `small/model.bin` ou `faster-whisper-small/model.bin` (CTranslate2). O worker usa `small`, CPU int8 e idioma `pt`, com timeout de 900 segundos. Prepare o extra separadamente: `uv sync --project backend --frozen --extra test --extra transcription`. O worker nunca baixa o modelo.

```powershell
$env:HORUS_ALIGNMENT_MODEL = "$env:LOCALAPPDATA/Horus/models/whisper"
$env:HORUS_PILOT_FACTORY = "$env:TEMP/horus-m4/backend-factory-demo"
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_local_pilot.py::test_real_local_pilot_render_review_and_restart backend/tests/test_local_pilot.py::test_factory_caption_rule_has_not_drifted -q -s --basetemp "$env:TEMP/horus-alignment-$([guid]::NewGuid().ToString('N'))"
```

O estágio `align` ocorre depois da concatenação/medição dos WAVs e antes do render. O ASR usa `OwnedProcess`, ambiente mínimo sem tokens, `.env` ou perfis, e flags offline obrigatórias. Cancelar a produção encerra sua árvore, inclusive ASR. `alignment-report.json` registra execução, motivo da indisponibilidade, duração do ASR e diagnóstico; nenhuma ausência é apresentada como medição. O modelo local conferido tem SHA-256 `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671` (`model.bin`).

Sem configuração, modelo, extra ou execução bem-sucedida, preserva `source=estimated`, `alignment_method=measured_sections`, `speech_aligned=false`. Abaixo do limiar do validador, registra o documento `forced_alignment` com cada palavra `measured` ou `interpolated` e seu diagnóstico, mas mantém legendas heurísticas por seção e `speech_aligned=false`. Só um contrato válido com contexto físico completo habilita palavras medidas no `alinhamento.json` da fábrica e `alignment_method=forced_alignment`.

**Regra do renderer independente:** o SRT reproduz `remotion/src/componentes/LegendaPalavra.tsx`, SHA-256 `aa4688a4affa70d607ae246ebaf47fe01dae102c604ad050fa87d886b4d04e2c`, da sandbox da fábrica. Agrupa até três palavras da mesma seção; cada grupo começa no primeiro frame de 30 fps em que sua primeira palavra já começou, permanece até o próximo grupo e só o último desaparece no primeiro frame depois de `fim + 0,6 s`. O SRT representa esses intervalos semiabertos, arredondados a milissegundos. O teste de deriva confere o hash quando `HORUS_PILOT_FACTORY` está disponível. Nenhum código da fábrica é alterado.

**Limite conhecido:** a fábrica mantém o grupo durante pausas e trocas de seção, potencialmente por mais de 0,6 s até o próximo grupo. Não há como suprimir essa manutenção usando somente seu contrato atual. O QC mede o desvio real de SRT contra bordas de palavras medidas, sem subtrair a manutenção, e informa `measured.hold_seconds`. A contenção permite até 0,6 s mais um frame, limitada pela próxima cue e duração do vídeo; início antecipado, sobreposição ou invasão da fala da seção seguinte reprovam. Persistência além desse limite continua falha visível no QC. Aceitar cues explícitas na fábrica depende de decisão futura do usuário; este incremento não certifica respeito integral às pausas.

As evidências históricas abaixo descrevem o fallback anterior. `publishable=false`, `demo_only=true`, voz com licença não verificada e revisão humana permanecem obrigatórios.

### Ensaio do worker com alinhamento

Ensaio final em basetemp novo `%TEMP%/ha-730e9d94`: **2 passed**, 90,23 s (render/revisão/reinício e detecção de deriva). Produção `a17da94f2ead4e97b9fc9168d1148b2f`: **77/77 palavras casadas**, **0 interpoladas**, `speech_aligned=true`, ASR **6,34 s** por relógio monotônico do subprocesso. A primeira repetição também casou 77/77 em 9,50 s; tempo depende do aquecimento do ambiente.

MP4 H.264/AAC de **540×960**, **48,733333 s**, SHA-256 `0995a295f2572548bbfabeb8540566d634fea05d1a5012b700d9c6f58ac77d68`. Narração completa **47,912925 s**. Os 27 grupos do SRT reproduzem a regra visual da fábrica. `subtitles_vs_words`: **measured**, desvio médio **0,191 s**, máximo **1,193 s**, 27 cues casadas, 0 sem correspondência. O desvio vem da permanência visual até o próximo grupo, não de tempos estimados.

**QC final: fail**, com `evidence_manifest`, `subtitles_vs_sections` e `subtitles_vs_words` em `blocking_errors`; manutenção máxima **1,193 s**, acima dos 0,6 s declarados. A falha temporal não impede medir WAV, hashes e sincronização. O teste verifica explicitamente essa falha, exige a confirmação adicional para aprovação e registra revisão fictícia `reject`. Não houve escuta ou aceite humano novo, nem ensaio de frontend. Corrigir a permanência do renderer depende da evolução autorizada do contrato da fábrica; a Issue permanece aberta.

Artefatos locais preservados em `%TEMP%/ha-730e9d94/test_real_local_pilot_render_r0/data/productions/a17da94f2ead4e97b9fc9168d1148b2f/`, incluindo `alignment-report.json`, `word-timings.json`, `quality-report.json`, `pilot-evidence.json` e `canais/demo/videos/fixture/render/short-rascunho.mp4`. Nenhum upload foi realizado.

Regressão dos módulos afetados: `pytest backend/tests/test_local_pilot.py backend/tests/test_production.py backend/tests/test_production_contract.py backend/tests/test_speech_alignment.py backend/tests/test_av_quality.py backend/tests/test_pilot_quality.py backend/tests/test_media_contracts.py -q` pelo Python do venv: **340 passed, 8 skipped**, 21,69 s. Inclui regressões simulated/local_demo, fallback, limiar, ambiente sem vazamento, flags offline, cancelamento da árvore em `align`, contenção negativa e medição apesar da falha temporal. As duas revisões condicionais com MP4 real mais os dois casos de fallback foram executadas separadamente com `HORUS_TEST_REAL_VIDEO`: **4 passed**, 1,47 s. Não foi executada a suíte completa de backend, frontend ou .NET neste incremento.

O modo explícito `local_pilot` acrescenta narração sintética offline em pt-BR à produção técnica existente. Reutiliza o roteiro M3 aprovado, JobManager, armazenamento e renderer da fábrica. `simulated` e `local_demo` continuam disponíveis; o tom do M4 nunca substitui uma voz indisponível.

## Pré-requisitos e fronteiras

- Windows com voz SAPI Desktop pt-BR instalada, como Microsoft Maria. Outros sistemas ou ausência de voz compatível bloqueiam o piloto explicitamente; nenhum modelo é baixado.
- Backend instalado pelo lock em ambiente próprio: `uv sync --project backend --frozen --extra test`.
- Sandbox independente da fábrica já preparada, com Python, Remotion, Node, FFmpeg/ffprobe e browser local. Na máquina do ensaio: `$env:TEMP/horus-m4/backend-factory-demo`. A fábrica original é somente leitura e não recebe alterações.
- Configurar `Settings.factory_root` / `FABRICA_HOME` para a sandbox, nunca para dados operacionais. O worker copia código/dependências Remotion para a saída exclusiva da produção, sem mídia ou perfis do operador.
- Não há upload, geração paga, inferência Hermes, stock ou URLs no piloto. Guard de Node, proxy local e NetLog do browser são preservados; não equivalem a sandbox global de SO ou captura integral de rede.

A tentativa inicial de helper PowerShell foi recusada pela política local de execução de scripts. Ela foi substituída, com autorização explícita do Maestro, por `local_pilot_windows.py`: APIs SAPI/COM e GDI nativas via `ctypes`, sem dependências novas, flags bypass, `-Command` ou alteração de políticas. O helper usa COM em processo, valida HRESULT e libera referências/arquivos. O texto entra por JSON UTF-8 e BSTR com `SVSFIsNotXML`, nunca é interpolado em código ou comando shell.

## Fluxo e honestidade dos tempos

1. Aprovar a versão M3 mais recente. O serviço revalida recibo persistido, documento, hash e plano antes de iniciar.
2. Enviar `POST /v1/scripts/{id}/productions` com autenticação, `Idempotency-Key` e `{"expected_version":1,"mode":"local_pilot"}`. Aprovação não inicia produção automaticamente.
3. O helper isolado seleciona voz pt-BR, sintetiza cada seção integralmente em WAV PCM mono de 16 bits e desenha PNGs informativos originais com título, resumo e aviso de voz sintética/licença. O resumo visual contém até 32 palavras; a narração mantém o texto completo. Controles incompatíveis com SAPI são recusados.
4. O worker mede frames/taxa dos WAVs e concatena sem cortar a fala para caber na estimativa do plano. Limite medido: 600 segundos; exceder bloqueia e exige revisão explícita do roteiro. Geração tem timeout de 1.200 segundos, dentro do limite de uma hora da produção.
5. Cenas são contíguas pelos limites medidos das seções. O SRT usa grupos de até três palavras distribuídos proporcionalmente dentro de cada seção. Os mesmos tempos alimentam o componente de legendas existente da fábrica, com legendas visíveis no MP4.
6. O renderer original produz H.264/AAC, com 0,8 s de folga final. `ffprobe -count_frames` decodifica/conta quadros de vídeo e áudio, verifica duração e presença da faixa AAC. O FFmpeg do lock extrai PNGs e WAV de revisão a partir do MP4.
7. Só após o vídeo real e sua auditoria de rede é escrito `pilot-evidence.json`. O serviço registra hashes/artefatos e mantém revisão humana por hash do MP4. Aprovar a revisão não concede licença ou publica.

`alignment_method=measured_sections` significa limites reais por seção e segmentação interna heurística. **Não é alinhamento por palavra**; o destaque animado do componente existente é estimado. `speech_aligned=false` e `real_voice=false` permanecem explícitos, pois não é voz humana/clonada.

### Investigação de eventos de palavra — 13/11/2026

O ensaio local de captura por `ctypes` produziu WAVs válidos, mas não retornou eventos em `ISpEventSource::GetEvents`. Foram tentadas a voz Automation e uma instância independente de `ISpVoice` nativa, com `SetInterest` após `SetOutput`, interesses de palavra/fim de fluxo nos dois argumentos (incluindo `SPFEI_FLAGCHECK`), notificação Win32 e síntese assíncrona com drenagem durante `WaitUntilDone`. Um ciclo adicional autorizado usou `ISpStream` nativo, PCM mono 16 bits/22050 Hz e `BindToFile`, também sem fronteiras retornadas. Isso evidencia uma limitação da captura ensaiada, não prova que toda voz SAPI seja incapaz de emitir eventos.

O protótipo foi retirado: permanece o helper funcional anterior, sem novas dependências, PowerShell, downloads ou mudança de políticas. Não é gerado `word-timings.json` com fonte `tts_engine_events` sem eventos reais. O fallback permanece `measured_sections` e `speech_aligned=false`; o desvio legenda × palavra não foi medido. Alinhamento acústico dependeria de ferramenta/modelo local e autorização de seu custo, não implementados neste incremento.

### Notas da revisão por timecode

`POST /v1/productions/{id}/review` aceita `notes` opcional, uma lista de até 200 objetos `{"at_seconds":2.125,"text":"Conferir esta legenda"}`. O tempo deve ser finito e não negativo, e o texto deve ter de 1 a 2000 caracteres. As notas são persistidas no JSON `review` existente, sem migração, junto à decisão vinculada ao SHA-256 do MP4. Repetir a mesma chave com notas diferentes é conflito; recibos antigos sem notas continuam válidos. Notas não alteram a exigência de revisão humana nem autorizam publicação.

Ensaio real deste ajuste: **1 passed**, 79,13 s, basetemp novo `%TEMP%/horus-word-fallback-ec70913512924029be5dfe91f6d0bf5c`. MP4 de **48,733333 s**, SHA-256 `30ab612eba3e7345e9b3cae3620b672aed985aa4199473fa8416d7a79647c0b2`, roteiro com **77 palavras**. Confirmados cancelamento/nova produção, revisão com nota em 2,125 s, repetição idempotente, conflito ao alterar a nota e igualdade do registro após reinício. Desvio legenda × palavra **não medido**; não houve inspeção visual ou escuta humana nova. O hash coincidir com o ensaio anterior decorre dos insumos/render determinísticos, não de reutilização da pasta de produção.

## Resposta e artefatos

Os endpoints e tipos de artefato existentes são preservados. A resposta acrescenta:

| Campo | Valor confirmado |
|---|---|
| `narration_kind` | `local_tts` após resultado medido; `fixture_tone` nos modos antigos; `null` antes de confirmação |
| `narration_disclosure` | descrição da narração efetivamente gerada; `null` enquanto não confirmada |
| `alignment_method` | `measured_sections` após piloto validado; `null` nos demais casos |
| `quality_report` | conteúdo do `quality-report.json` registrado, com contrato/hash válidos, ou `null` |
| `asset_provenance` | conteúdo validado do registro de proveniência dos insumos, ou `null` |
| `speech_aligned` | derivado do contrato de palavras e seu contexto físico; `false` no fallback estimado |
| `quality_acknowledgement_required` | no piloto, `true` quando o QC falha ou está ausente, inválido ou `not_run` |
| `publishable` | sempre `false` |

`demo_only=true` é permanente neste incremento. Voz SAPI é `origin=system_voice`, `license=unverified`; nenhuma licença de voz ou aceite humano é presumido. As cenas locais são `original_local/original`.

Principais arquivos registrados: plano aprovado com estimativas (`plan.json`), WAV por seção, WAV concatenado (`fixture.wav`, nome legado), PNGs e seus bounds/fontes/quebras medidos (`scene-N.layout.json`), SRT, manifesto da fábrica, alinhamento medido, `pilot-measurements.json`, `narration-signal.json`, `network-summary.json`, MP4, recibo de insumos, `render/validation.json`, `render/audio-review.wav`, frames de inspeção e `pilot-evidence.json`. O manifesto final segue exatamente o schema combinado: oito campos de topo, sem extras; hash do vídeo fica no registro de artefatos/validation, não em `video` do manifesto.

Os relatórios `narration-signal.json` medem energia e concentração espectral em 220 Hz, rejeitando silêncio ou o tom M4. O relatório em `render/` verifica o áudio extraído do MP4. Isso não reconhece palavras, não atesta inteligibilidade/loudness e não substitui escuta humana. Após `pilot-evidence.json`, o worker executa `av_quality.run_quality` com os executáveis FFmpeg/ffprobe já resolvidos na sandbox e registra `quality-report.json`, `word-timings.json` e `asset-provenance.json` com SHA-256. Os [contratos de mídia](contratos-midia.md) definem as validações cruzadas. Checks indisponíveis permanecem `skipped`; dados estimados nunca contam como sincronização de fala medida.

O fallback gera `word-timings.json` com `source=estimated`, cobertura/offsets do roteiro completo e os tempos proporcionais já usados nas legendas. Isso serve para auditar a heurística, sem promover seu resultado a alinhamento real. A proveniência cobre somente PNGs de entrada, WAVs de seção e WAV concatenado; MP4/frames/WAV de revisão são derivados. Todos os insumos permanecem `unverified`, com uso comercial desconhecido e sem verificação humana presumida.

Uma produção tecnicamente concluída continua `succeeded` mesmo com QC `fail`, preservando artefatos e relatório. `reject` permanece possível. `approve` exige `acknowledge_quality_errors=true` quando `quality_acknowledgement_required=true`, além do SHA-256 correto do MP4; essa confirmação é persistida no JSON `review` e faz parte da idempotência. No piloto, relatório ausente/inválido/`not_run` também exige confirmação. Os modos legados mantêm sua regra anterior. Nenhuma confirmação torna `publishable` verdadeiro ou dispara publicação.

## Persistência, migração e cancelamento

Schema **v7**, migração transacional v6→v7: amplia somente o CHECK de `productions.mode` para aceitar `local_pilot`. SQLite exige reconstruir a tabela; produções e recibos são copiados na mesma transação, com IDs, valores, índices de unicidade e FKs preservados. O mecanismo existente cria backup v6 antes da atualização. Falha faz rollback do schema, dados e versão; reabertura não repete a migração.

Worker e helper SAPI têm posse explícita por `OwnedProcess`; no Windows os subprocessos pertencem a Job Objects. Cancelar encerra a árvore pertencente à produção. Saída já existente nunca é reutilizada, e a API não oferece retry direto da produção. Após interrupção/cancelamento, conciliar artefatos e criar outra produção com nova chave. Recibos idempotentes continuam devolvendo o mesmo ID para a mesma submissão.

O estágio `quality` roda dentro do mesmo worker já possuído, após render/evidência; os subprocessos de QC também usam `OwnedProcess`. O cancelamento encerra a árvore desse worker durante o QC. Reabrir o backend não executa novamente uma produção já concluída; produções interrompidas continuam exigindo conciliação e nova submissão explícita. Os testes de posse usam um subprocesso de QC controlado, não simulam aceite editorial ou audição humana.

## Evidência de QC no worker — 13/11/2026

Contratos e QC integrados da branch `yannbastos/feat-hor-089-media-contracts`, incluindo a correção `d49d892` que mantém `method=estimated` quando a fonte de palavras é estimada. Nenhum arquivo de implementação do QC foi alterado pela integração do worker.

- Backend completo: **869 passed, 7 skipped**, 133,55 s. Testes focados de produção/contratos de artefato: **44 passed, 3 skipped**, 15,62 s; verificação adicional das duas variantes de revisão com MP4 real: **2 passed**, 1,33 s. Aviso existente de depreciação Starlette/httpx; nenhuma dependência atualizada.
- Ensaio real com `HORUS_PILOT_FACTORY=%TEMP%/horus-m4/backend-factory-demo` e basetemp novo: **14 passed**, 90,68 s. Saída preservada: `%TEMP%/horus-qc-final-2a39d58e05ef4a6bb0d4c30d36c9f7ff/test_real_local_pilot_render_r0/data/productions/933c546d97534b5cae921b18a40ab2b2`.
- MP4: **48,733333 s** de vídeo, **47,912925 s** de narração; SHA-256 `30ab612eba3e7345e9b3cae3620b672aed985aa4199473fa8416d7a79647c0b2`. Cobertura de legendas: **77/77 palavras**, em **27 cues**, nas três seções medidas.
- `quality-report.json`: **warn**, `blocking_errors=[]`, avisos `word_timings` e `asset_provenance`. Loudness por FFmpeg: **−23,95 LUFS**, true peak **−7,57 dBTP**, LRA **3,2 LU**. Hashes dos sete insumos conferem; clipping de 0%; nenhum silêncio longo. Análise visual automatizada: 489 quadros reduzidos, sem preto ≥0,5 s ou congelamento ≥4 s; isso não substitui inspeção visual humana.
- Desvio SRT × palavras **estimadas**: máximo/médio **0,000 s**, `method=estimated`. Desvio legenda × palavra falada **não medido**; `speech_aligned=false`, `alignment_method=measured_sections`. Não houve nova escuta humana nem aceite de licença/publicação.
- SHA-256: `quality-report.json` = `80a9d33122d823e2e5818e3f35466ee68e1ba606b29b96250b524dcbee64b496`; `word-timings.json` = `8b8e528a394f55c860f0eda3d9c9441b629659989a6e24d3ec7ef90cacb61f30`; `asset-provenance.json` = `cd8c0ed8dc6b00adcb89c54a653a70e5446ed0100f49a91e7a9b2bf599bb588c`.

Os testes incluem confirmação adicional para QC reprovado/ausente/inválido/não executado, hashes/produção/vídeo divergentes, rejeição sem confirmação, persistência de notas/aceite após reinício, idempotência e encerramento da árvore no estágio `quality`. A revisão fictícia do ensaio real é `reject`; não constitui decisão editorial do operador. Frontend não foi alterado nem ensaiado neste worktree.

## Repetição em diretórios fictícios isolados

```powershell
# Testes de contrato, migração, falhas e regressão de produção, sem render real:
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_local_pilot.py backend/tests/test_production.py backend/tests/test_production_contract.py -q

# Ensaio real explícito: diretório NOVO; não reutilizar basetemp contendo evidências a preservar.
$env:HORUS_PILOT_FACTORY = "$env:TEMP/horus-m4/backend-factory-demo"
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_local_pilot.py::test_real_local_pilot_render_review_and_restart -q -s --basetemp "$env:TEMP/horus-pilot-ensaio-novo"
Remove-Item Env:HORUS_PILOT_FACTORY
```

O ensaio usa exclusivamente dados fictícios, grava o conteúdo antes da aprovação M3 de teste e passa pela API real em `TestClient`, sem abrir porta. Imprime `REAL_PILOT_MP4` e `REAL_PILOT_EVIDENCE`, verifica download autenticado, hashes, idempotência, revisão com hash incorreto/correto e reabertura persistida. A decisão `reject` é um recibo fictício do teste, não revisão editorial do operador. Para ensaio UI conjunto, portas reservadas: backend 8781/frontend 1471.

## Limites de validação

A produção local ainda é demonstração não publicável. Inspeção visual, escuta humana, QC conjunto Sonnet/UI e aceite de licenças devem ser relatados separadamente. Nenhum build, mock, teste acústico ou manifesto isolado certifica vídeo editorial completo ou licença de publicação. O PNG informativo usa fontes do sistema; textos fora do formato curto podem exigir revisão de legibilidade. O suporte deste helper foi projetado para Windows; outros sistemas falham explicitamente.

## Evidência inicial — 13/11/2026 (antes do ajuste visual)

- Regressão completa do backend: **680 passed, 5 skipped**, 114,23 s. Ensaios reais condicionais são executados separadamente; permanece um aviso de depreciação FastAPI/Starlette/httpx do ambiente travado.
- `test_local_pilot.py` com sandbox explícita: **10 passed**, 92,45 s. Inclui migração v6 com produções/recibos, preservação de IDs/FKs/índices, reabertura idempotente, rollback após reconstrução, rejeição de silêncio/tom, falha SAPI sem fallback, cancelamento do helper real, cancelamento de produção, nova produção, download autenticado, revisão por hash e reinício.
- Roteiro fictício Jardim Aurora: plano estimava **30,8 s**, mas a fala completa medida tem **47,912925 s**. Nenhuma seção foi cortada para caber na estimativa; a concatenação de todas as legendas reproduz o texto integral aprovado.
- MP4 H.264/AAC real de **540×960**, **1.462 quadros**, **48,733333 s**; faixa AAC **48,747 s**, **2.285 quadros de áudio decodificados**. SHA-256 do vídeo: `84edb912a002f21968e63d748b4c4952bfe39be78f6e80002d0d58774d93abc3`.
- Microsoft Maria Desktop pt-BR; SHA-256 do WAV concatenado: `2fc4667c7fb878d946f116b688ea7c94c90077d778e55affb27150c3e57bfa4a`. No WAV extraído do MP4, a concentração de energia em 220 Hz foi **0,009784** e RMS relativo **0,047966**: não corresponde ao tom M4. Isso não atesta palavras, loudness ou escuta humana.
- Frame extraído do meio do MP4 inspecionado visualmente: cena informativa e legenda embutida legíveis, com aviso de voz sintética/licença. Essa amostra foi insuficiente: a inspeção posterior do Sonnet encontrou recorte do PNG em quadros tardios pelo Ken Burns, corrigido e validado no ensaio abaixo. É o preset de rascunho existente, não exportação editorial em 1080×1920.
- Contrato e inspeção física do módulo Sonnet executados por leitura isolada, sem copiar/importar como dependência do produto: **nenhum blocking_error**; hashes, duração e WAV aprovados; pico 0,59 e clipping 0,0000%. Permanecem warnings de resolução de rascunho, licença `unverified` e ausência de alinhamento por palavra. A integração QC/UI ainda pertence ao ensaio conjunto do Maestro.
- NetLog parcial: destinos TCP observados somente em loopback; hosts externos aparecem em eventos de URL do Edge, sem destino TCP externo registrado. Nenhuma alegação de auditoria global de rede.

Saída preservada do ensaio final (local, temporária):

```text
%TEMP%/hp4/test_real_local_pilot_render_r0/data/productions/21d54a30e7114126974812801283520c/
  pilot-evidence.json
  canais/demo/videos/fixture/render/short-rascunho.mp4
  canais/demo/videos/fixture/render/audio-review.wav
  canais/demo/videos/fixture/render/subtitles-frame.png
%TEMP%/hp4/qc-contract-report.json
```

O relatório QC registra o SHA-256 do módulo externo ensaiado: `80a73901cfeac23e4e59850b345f14fb26cefd0ae609cfe1ec80b388b5c452f2`. Licença/aceite editorial humano permanecem pendentes; `publishable=false` não foi alterado. Nenhum dado operacional, publicação ou upload de mídia foi usado.

## Correção visual e evidência final — 13/11/2026

O QC físico posterior identificou que o Ken Burns original (`scale` de 1 até 1,15 e `translate` de até 3%, aplicado dentro do scale) recortava textos/acento/aviso dos PNGs antigos nos quadros tardios. A fábrica e o efeito foram preservados. A geração local agora reserva áreas internas calculadas para as quatro direções, mede larguras com `GetTextExtentPoint32W`, quebra palavras/caracteres e reduz fonte até o mínimo definido. Se todo o texto não couber, bloqueia explicitamente em vez de recortá-lo. O resumo visual continua sendo o excerto declarado de até 32 palavras; nada foi cortado da fala.

Título/corpo/acento ficam acima de y=1220 após a transformação máxima; o aviso completo fica a partir de y=1620, separado da área das legendas existentes (termina em y=1596 nesta composição). Os testes percorrem 101 posições do movimento nas quatro direções, conferem limites e reserva de legendas, preservação de caracteres/acentos e os bounds medidos de um PNG real pelo GDI. Cada cena registra sua medição em `scene-N.layout.json`.

Código final validado:

- Backend completo: **683 passed, 5 skipped**, 120,18 s; mesmo aviso de depreciação do ambiente travado.
- Ensaio real com sandbox, incluindo regressões novas: **13 passed**, 89,49 s. Foi renderizada **uma nova fixture MP4**, em nova produção/saída exclusiva, sem sobrescrever `hp4` ou seus IDs/artefatos.
- Novo MP4: **540×960, 48,733333 s, 1.462 quadros**, SHA-256 `30ab612eba3e7345e9b3cae3620b672aed985aa4199473fa8416d7a79647c0b2`. A resolução permanece a de rascunho, sem trocar para full HD para mascarar o recorte.
- Capturas extraídas e vistas do início/fim de todas as cenas: quadros **2/445**, **448/938**, **941/1461**. Títulos, corpo, acento e aviso completos dentro da imagem; rodapé separado das legendas, inclusive no fim do movimento.
- Checagem dos dois cortes por diferenças de pixels entre quadros vizinhos na região acima das legendas: maior mudança nos quadros **446 (14,866667 s)** e **939 (31,3 s)**, coerentes com os limites medidos arredondados a 30 fps. As diferenças de média RGB nos cortes foram 14,245 e 14,677, contra no máximo 0,739 nos vizinhos analisados; isso verifica a troca de cena, não alinhamento de palavras.
- QC final Sonnet (`ab168f4`) carregado somente para ensaio de contrato/arquivos: **blocking_errors=[]** em ambos. Licença, alinhamento por palavra, loudness, escuta humana e aceite editorial continuam pendentes; `demo_only=true`/`publishable=false` permanecem inalterados.

Novos caminhos locais preservados:

```text
%TEMP%/hp-safe-1/test_real_local_pilot_render_r0/data/productions/db624632be554eb088d852d0035f455c/
  pilot-evidence.json
  canais/demo/videos/fixture/render/short-rascunho.mp4
  canais/demo/videos/fixture/render/audio-review.wav
  canais/demo/videos/fixture/scene-1.layout.json (e cenas 2/3)
%TEMP%/hp-safe-1/visual-qa/
  frame-0002.png / frame-0445.png
  frame-0448.png / frame-0938.png
  frame-0941.png / frame-1461.png
  report.json
%TEMP%/hp-safe-1/inspect-render.py
```

O script de auditoria usa FFmpeg e Pillow já instalados pelos locks na sandbox da fábrica, somente para extrair/analisar o MP4 local. Não integra um segundo renderer nem copia o módulo QC ao backend. O relatório registra hash do módulo QC ensaiado e os valores observados; as capturas são artefatos externos de auditoria, sem alterar o registro da produção concluída.

## Configuração opcional do Kokoro (HOR-132)

O ambiente isolado da prova pode ser usado em prévias e na produção, sem instalar
Kokoro no backend. Prepare os arquivos fora da produção conforme a seção 6 de
[avaliação de vozes](avaliacao-vozes.md); o adaptador nunca baixa nada.

```powershell
$env:HORUS_KOKORO_PYTHON = "$env:LOCALAPPDATA/Horus/tools/kokoro-proof/venv/Scripts/python.exe"
$env:HORUS_KOKORO_MODEL_DIR = "$env:LOCALAPPDATA/Horus/tools/kokoro-proof/model"
$env:HORUS_PILOT_FACTORY = "$env:TEMP/horus-m4/backend-factory-demo"
$env:HORUS_ALIGNMENT_MODEL = "$env:LOCALAPPDATA/Horus/models/whisper"
$env:HORUS_FFMPEG = "$env:LOCALAPPDATA/Horus/tools/ffmpeg/n8.1.3-35-gf1acb0a266/ffmpeg-n8.1.3-35-gf1acb0a266-win64-gpl-8.1/bin/ffmpeg.exe"
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_narration_kokoro.py -k real -q -s --basetemp "$env:TEMP/horus-kokoro-$([guid]::NewGuid().ToString('N'))"
```

Reinicie o backend após configurar. Em Ajustes/Narração, selecione Kokoro e uma
voz (`pf_dora`, `pm_alex`, `pm_santa`), gere a prévia e salve a preferência.
A seleção explícita na API é `narration:{provider:"kokoro",voice_id:"pf_dora"}`.
Sem configuração o motor fica `not_installed`; hash divergente bloqueia com motivo.
Pesos Apache-2.0, mas uso comercial permanece `unknown` e proveniência `unverified`
por causa das dúvidas sobre dados de treino (TTS proprietários/CC BY).
A síntese é em processo separado; veja [limites e proveniência](narracao-provedores.md#kokoro-local-opcional).
Os testes reais geram somente artefatos locais fictícios e não aprovam/publicam o vídeo.

### Evidência do incremento (13/11/2026)

Comandos e resultados medidos neste worktree:

- `& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_narration.py backend/tests/test_narration_production.py backend/tests/test_narration_kokoro.py backend/tests/test_production.py backend/tests/test_pilot_quality.py backend/tests/test_av_quality.py backend/tests/test_speech_alignment.py -q`: **230 passed, 7 skipped**, 31,85 s (ensaios condicionais sem variáveis).
- Após a última asserção do registro: os três arquivos `test_narration*.py` acima: **54 passed, 2 skipped**, 3,24 s.
- Com as cinco variáveis explícitas da configuração acima, `-m pytest backend/tests/test_narration_kokoro.py -q -s --basetemp <pasta nova>`: **13 passed**, 101,37 s, incluindo prévia real e produção real `local_pilot`, voz `pf_dora`, versão final do adaptador.

Prévia SHA-256: `d11096a4568cbd0345be8e3ff7fa5b4b3e059b7381c7d0d437374c719705419a`.
Produção em `%TEMP%/horus-kokoro-final-a7cf91bc3ee24cb796733dd7d6280fca/test_real_kokoro_local_pilot0/data/productions/de073c38c00c41059d23026f23ebd24f`.
Whisper: **77 palavras casadas, 0 interpoladas**, alinhamento real habilitado.
QC: **warn**; proveniência não verificada por humano e loudness abaixo da faixa configurada.
MP4 SHA-256: `d8456a3e313d4320c7a0d2f54fdf749f550284afbd73637f003675dd83f72b36`.
Não houve aprovação/publicação. Áudio e vídeo não são bit a bit determinísticos entre execuções.

Limites: não houve escuta/homologação humana, teste visual da UI, auditoria nativa
ou de rede do SO, ensaio real de produção com as outras duas vozes, nem teste de
fallback CPU neste incremento. A guarda Python de rede não cobre chamadas nativas.
Nenhuma dependência foi instalada e o ambiente/modelos Kokoro permaneceram somente leitura.
