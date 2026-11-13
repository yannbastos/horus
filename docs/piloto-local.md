# Piloto audiovisual local — HOR-054

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
| `publishable` | sempre `false` |

`demo_only=true` é permanente neste incremento. Voz SAPI é `origin=system_voice`, `license=unverified`; nenhuma licença de voz ou aceite humano é presumido. As cenas locais são `original_local/original`.

Principais arquivos registrados: plano aprovado com estimativas (`plan.json`), WAV por seção, WAV concatenado (`fixture.wav`, nome legado), PNGs e seus bounds/fontes/quebras medidos (`scene-N.layout.json`), SRT, manifesto da fábrica, alinhamento medido, `pilot-measurements.json`, `narration-signal.json`, `network-summary.json`, MP4, recibo de insumos, `render/validation.json`, `render/audio-review.wav`, frames de inspeção e `pilot-evidence.json`. O manifesto final segue exatamente o schema combinado: oito campos de topo, sem extras; hash do vídeo fica no registro de artefatos/validation, não em `video` do manifesto.

Os relatórios `narration-signal.json` medem energia e concentração espectral em 220 Hz, rejeitando silêncio ou o tom M4. O relatório em `render/` verifica o áudio extraído do MP4. Isso não reconhece palavras, não atesta inteligibilidade/loudness e não substitui escuta humana. A verificação de qualidade do Sonnet é independente; este incremento não importa um módulo ausente nem declara QC conjunto concluído.

## Persistência, migração e cancelamento

Schema **v7**, migração transacional v6→v7: amplia somente o CHECK de `productions.mode` para aceitar `local_pilot`. SQLite exige reconstruir a tabela; produções e recibos são copiados na mesma transação, com IDs, valores, índices de unicidade e FKs preservados. O mecanismo existente cria backup v6 antes da atualização. Falha faz rollback do schema, dados e versão; reabertura não repete a migração.

Worker e helper SAPI têm posse explícita por `OwnedProcess`; no Windows os subprocessos pertencem a Job Objects. Cancelar encerra a árvore pertencente à produção. Saída já existente nunca é reutilizada, e a API não oferece retry direto da produção. Após interrupção/cancelamento, conciliar artefatos e criar outra produção com nova chave. Recibos idempotentes continuam devolvendo o mesmo ID para a mesma submissão.

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
