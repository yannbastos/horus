# Avaliação técnica do Piper TTS para pt-BR — HOR-131

Pesquisa inicial nas seções 1–8, realizada sem execução, complementada pela **prova isolada autorizada e medida na seção 9**. As fontes iniciais foram acessadas em **13/11/2026**; downloads, ambiente separado e resultados posteriores estão descritos em “Resultados da prova”. Nenhum áudio foi enviado a serviço externo.

Convenção: **[F]** fato lido na fonte citada; **[I]** inferência; **[N]** não verificado. Na pesquisa inicial, nada foi ouvido ou medido; números de terceiros não são medições do Hórus. A seção 9 registra fatos medidos localmente; a escuta humana permanece pendente.

Contexto: o piloto atual usa Microsoft Maria (SAPI) com `license=unverified` e `alignment_method=measured_sections` (ver [piloto-local.md](piloto-local.md)). O Piper seria um candidato a voz local com licença rastreável e, possivelmente, tempos por fonema.

## 1. Estado e governança

- **[F]** `rhasspy/piper` está **arquivado** desde 06/10/2025 (somente leitura); o README diz "Development has moved: https://github.com/OHF-Voice/piper1-gpl". Licença do repositório antigo: MIT. Sem releases listadas na página; último release de binários via API: `2023.11.14-2` (14/11/2023), com `piper_windows_amd64.zip` de 22.477.236 bytes. Fontes: <https://github.com/rhasspy/piper>, <https://api.github.com/repos/rhasspy/piper/releases/latest>.
- **[F]** O sucessor **`OHF-Voice/piper1-gpl`** (Open Home Foundation) é o fork ativo, licença **GPL-3.0**. A página afirma "The Open Home Foundation is looking for maintainers for Piper!" (contato voice@openhomefoundation.org): **não há mantenedor individual nomeado** e a própria fundação procura mantenedores. Fonte: <https://github.com/OHF-Voice/piper1-gpl>.
- **[F]** Versão atual: **piper-tts 1.8.0**, publicada em 04/09/2026 (PyPI e release GitHub). Cadência recente: v1.5.0 (17/07/2026), v1.6.0 (23/07), v1.6.1 (13/08), v1.7.0 (15/08), v1.8.0 (04/09). Fontes: <https://pypi.org/project/piper-tts/>, <https://api.github.com/repos/OHF-Voice/piper1-gpl/releases?per_page=5>.
- **[I]** Projeto ativo, mas com risco de continuidade (mantenção em busca de pessoas, sem última atividade posterior a 04/09/2026 verificada por mim). Fixar versão e hashes mitiga.

## 2. Licença do motor e dependências

- **[F]** O **motor atual (1.x) é GPL-3.0-or-later** (PyPI: "GPL-3.0-or-later"); o motor antigo arquivado era MIT. A mudança de MIT para GPL ocorreu porque o novo motor embute o espeak-ng ("embeds espeak-ng for phonemization" — README do piper1-gpl).
- **[F]** espeak-ng: texto de licença no `COPYING` do repositório é **GPL v3**. Fonte: <https://raw.githubusercontent.com/espeak-ng/espeak-ng/master/COPYING>.
- **[F]** onnxruntime: **MIT** (Microsoft). Fonte: <https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE>.
- **[N]** Não consegui ler a lista de dependências de instalação do wheel (a página PyPI só mostra extras: `train`, `dev`, `http`, `alignment`, `zh`, `ja`, `th`). Que `onnxruntime` é dependência é **[I]** (a documentação cita `onnxruntime-gpu` como alternativa para GPU). O alinhamento em memória exige o pacote `onnx` (ver §7).
- **Efeito sobre o instalador do Hórus [I, requer parecer jurídico]:**
  - Distribuir o wheel/DLLs do Piper 1.x ou um executável que os incorpore é *conveying* de obra GPL-3.0: exige texto da licença, aviso de copyright e **oferta/entrega do código-fonte correspondente** do Piper e do espeak-ng na versão distribuída.
  - Se o Hórus **importar** `piper` no mesmo processo Python (ou ligar `libpiper`), há risco real de a obra combinada ser tratada como derivada → copyleft sobre o Hórus. **Não recomendado.**
  - Execução como **processo separado**, comunicando por argumentos/JSON/arquivo WAV, é a abordagem normalmente aceita como "mera agregação" na leitura comum da GPL, mas a fronteira exata é questão jurídica, não técnica. Mesmo nesse caso, o instalador que *inclui* o Piper continua obrigado a cumprir a GPL para esse componente.
  - Alternativa de menor risco: **não embutir** o Piper no instalador; oferecer instalação opcional baixada pelo usuário, com hash fixado e aviso de licença (o Hórus não distribui o componente GPL). Ainda precisa de parecer.
  - Os binários MIT antigos (2023.11.14-2) usam piper-phonemize/espeak-ng; **[N]** a licença efetiva dos componentes embutidos naquele zip não foi verificada (o espeak-ng é GPL, então o "MIT" do repositório pode não se aplicar ao binário distribuído). Não usar como atalho para evitar a GPL sem análise.
- **Licença dos pesos:** independente da do motor; ver §3.

## 3. Vozes pt-BR

Fonte: <https://huggingface.co/rhasspy/piper-voices/tree/main/pt/pt_BR> e arquivos `MODEL_CARD` e API de árvore de cada voz (todos acessados em 13/11/2026). Diretórios existentes: `cadu`, `edresson`, `faber`, `jeff`. Todos os `.onnx` têm ~63 MB (a pasta `pt_BR` inteira soma 253 MB).

| Voz | Qualidade | Taxa | `.onnx` (bytes) | SHA-256 (LFS oid) | Dataset | Licença do dataset **[F]** |
|---|---|---|---|---|---|---|
| `pt_BR-faber-medium` | medium | 22.050 Hz | 63.221.984 | `75e913eb…8ffc` | OHF-Voice/voice-datasets | **CC0** |
| `pt_BR-cadu-medium` | medium | 22.050 Hz | 63.221.984 | `d5a662e3…99de` | OHF-Voice/voice-datasets | **CC0** |
| `pt_BR-jeff-medium` | medium | 22.050 Hz | 63.221.984 | `82ddcdb0…94e1` | OHF-Voice/voice-datasets | **CC0** |
| `pt_BR-edresson-low` | low | 16.000 Hz | 63.104.526 | `de4cecee…cd84` | TTS-Portuguese-Corpus (Edresson) | **CC BY 4.0** (ajuste fino a partir da voz inglesa "Ryan" low) |

Hashes completos (do campo LFS `oid` da API; devem ser **recomparados após o download**):

- faber `75e913eb463db0b6ac7ddf68d3e4c9ac19ace36dc3b710a81039b448352b8ffc`
- cadu `d5a662e3f606d5a49dd29ba9ce90c304ae45dd9543f8b0c773bcb0de282499de`
- jeff `82ddcdb01a0342f078bd89ce2815eda27185818d15e15f06fb9a72ac3bce94e1`
- edresson `de4cecee38b30bb1a6378a337af605d59f0c377df702c6a6752870db8991cd84`

Datas de inclusão no catálogo (OHF-Voice/voice-datasets): faber 25/05/2023; cadu e jeff 26/04/2025. O repositório de datasets diz "licensed under CC0 (public domain)" e pede citação do repositório. Fonte: <https://github.com/OHF-Voice/voice-datasets>.

Observações:

- **[F]** O `VOICES.md` do Piper diz: "Piper is intended for personal use and text to speech research only" e "Some voices may have restrictive licenses ... review them carefully"; o `MODEL_CARD` de cada voz contém a licença. Fonte: <https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/docs/VOICES.md>. Essa frase de "uso pessoal" é aviso do projeto; **não** é a licença do dataset CC0, mas é um ponto de atenção para uso monetizado.
- **[F]** A página do voice-datasets **não menciona consentimento/termos dos locutores**. **[I]** CC0 do dataset reduz o risco de direitos autorais, mas não responde sobre direitos de personalidade/voz dos locutores nem sobre se o modelo treinado herda algo além da licença declarada. **[N]** Consentimento não verificado.
- **[N]** Os `MODEL_CARD`s lidos não indicam nome do locutor, gênero nem sotaque; não afirmar nada sobre eles. As páginas de `jeff` e `cadu` foram lidas via resumo automático; recomenda-se reler o texto cru dos 4 `MODEL_CARD`s no download.
- **Aceitáveis para vídeo publicado/monetizado [I]:** `faber`, `cadu`, `jeff` (CC0, sem atribuição obrigatória; citar o repositório é pedido, não condição legal). `edresson` (CC BY 4.0) é também permitido comercialmente, **com atribuição obrigatória** (créditos no vídeo/descrição) e qualidade *low* a 16 kHz — **não recomendada** como padrão. Tudo condicionado a: aceite humano da licença, registro do hash e do `MODEL_CARD` no manifesto, e à decisão do usuário sobre o risco de direitos de personalidade. Enquanto isso, `publishable=false` permanece.
- Não há voz pt-BR *high* no catálogo lido **[F]**.

## 4. Qualidade, naturalidade e inteligibilidade

- **[F]** Cada pasta de voz tem um diretório `samples/` com amostras oficiais; **não as ouvi**, não baixei e não afirmo nada sobre sua qualidade.
- **[F]** Não encontrei avaliação formal (MOS ou similar) específica para as vozes pt-BR do Piper. Um estudo de dezembro 2025 (arXiv, voz persa) não se aplica ao pt-BR.
- **[I]** Vozes *medium* de 22 kHz do Piper costumam ser inteligíveis, porém mais "planas" que TTS neural em nuvem; a prosódia em frases longas e o tratamento de siglas/números dependem do espeak-ng. Só a escuta confirma.

### Protocolo curto de escuta cega (Maria × Piper)

Objetivo: decidir se Piper é pelo menos tão aceitável quanto a Maria para rascunho, e qual voz Piper.

1. **Material:** 5 trechos de 15–25 s do roteiro real do canal (um com números/datas, um com siglas/nomes próprios, um com frases longas, um curto/enfático, um informal). Mesmo texto para todas as vozes.
2. **Vozes:** Maria (SAPI), Piper faber, cadu, jeff (e, opcionalmente, edresson como referência baixa). Mesma taxa final (normalizar para 24 ou 48 kHz) e mesmo loudness (por exemplo −16 LUFS integrados, ou ao menos pico igual); sem música ou legenda.
3. **Cegagem:** outra pessoa (ou o Maestro) renomeia os arquivos com códigos aleatórios e guarda o mapa; ordem aleatória por trecho; o usuário não vê nomes nem hashes.
4. **Notas por trecho e voz (1–5):** inteligibilidade, naturalidade, pronúncia (erros anotados por palavra), ritmo/pausas, fadiga após 60 s. Pergunta final: "publicaria em um vídeo com seu nome?" (sim/talvez/não).
5. **Critério de aceite sugerido:** média de naturalidade ≥ Maria **e** zero erros de pronúncia graves em nomes/números do canal **e** "sim/talvez" em pelo menos 4 de 5 trechos. Registrar resultado, datas e o mapa de-cegagem em relatório datado.
6. A escuta humana é do usuário; nenhum agente deve declarar o resultado.

## 5. Windows

- **[F]** Wheel oficial **`piper_tts-1.8.0-cp39-abi3-win_amd64.whl` (34,1 MB)**; Python ≥ 3.9. O release v1.5.0 cita correções de build do `libpiper` no Windows (MSVC, MSYS2-GCC). Fontes: PyPI e releases acima.
- **[F]** O motor antigo MIT tinha `piper_windows_amd64.zip` (22,5 MB), arquivado, sem atualizações desde 2023.
- **Offline [I]:** a inferência usa arquivos locais (`PiperVoice.load` recebe o caminho do `.onnx`); o download de vozes é ação à parte (`python -m piper.download_voices`), que **não** deve ser usada em produção. Depois de instalado e com os modelos fixados, nada exige rede. Confirmar com NetLog/firewall no plano de prova. O espeak-ng-data está embutido no wheel (**[I]**, a confirmar na inspeção).
- **Desempenho em CPU [I, não medido por nós]:** fontes secundárias indicam RTF ≈ 0,1–0,2 em CPUs x86 modernas para vozes *medium* (ex.: 0,153 em i7-1255U, voz persa, arXiv dez/2025; ≈0,11 em laptop x86 via WASM; 0,192 em Pi 5). Para o roteiro de ~48 s do piloto isso seria da ordem de alguns segundos. **Qualquer número do Hórus deve ser medido** carregando o modelo uma vez (a CLI recarrega o modelo a cada chamada, o que distorce o tempo). Fonte da busca: resultados de pesquisa secundários de 13/11/2026; não são uma medição verificada.

## 6. Integração com a fábrica e o worker

Proposta **[I]**, compatível com a arquitetura existente (`OwnedProcess` + Job Object, helper SAPI isolado, texto por JSON UTF-8, nunca por shell):

1. Adapter `piper_worker` como **processo separado** (Python próprio ou executável) iniciado pelo worker sob `OwnedProcess`/Job Object, com timeout e cancelamento já usados pelo helper SAPI.
2. **Entrada:** JSON UTF-8 por stdin ou arquivo (seção, texto, `voice_id`, caminho do `.onnx` e `.onnx.json`, `SynthesisConfig`); **saída:** WAV PCM 16 bits mono por seção + JSON de resultado (hash, duração medida, taxa), validado pelo mesmo contrato do piloto. Sem interpolação de texto em linha de comando.
3. Ambiente isolado (venv/pasta própria, `PYTHONNOUSERSITE`, sem rede), caminhos relativos portáveis. O Hórus **não importa** `piper` (ver §2).
4. Metadados de voz: `origin=local_model`, `license` conforme `MODEL_CARD` **somente após aceite humano**, `model_sha256`, versão do motor, `narration_kind=local_tts`; `publishable=false` / `demo_only=true` inalterados.

**Supply chain:**

- Fixar versão (1.8.0) e **hash do wheel** e dos `.onnx`/`.onnx.json`; comparar com o `oid` LFS acima e registrar o SHA-256 calculado localmente. O hash do wheel **não foi lido** nesta pesquisa **[N]**; deve ser obtido da página de arquivos do PyPI/release e conferido por duas fontes.
- **[N]** Não verifiquei assinaturas (Sigstore/attestations/PGP) do wheel ou dos modelos; **[I]** modelos HF não têm assinatura própria além do hash. Preferir wheel baixado do release GitHub **e** do PyPI e comparar.
- `.onnx` é grafo de computação, não código Python (diferente de pickle), mas o runtime é nativo; manter onnxruntime/piper fixados e executar o worker com privilégios mínimos.
- Instalação com `--require-hashes`, `--no-deps` se for o caso, espelho local dos artefatos; nunca `download_voices` automático.

## 7. Tempos por palavra/fonema

- **[F]** No `voice.py` do piper1-gpl: `synthesize(text, syn_config=None, include_alignments=False)` produz, por sentença, um `AudioChunk` com `phonemes`, `phoneme_ids`, `phoneme_id_samples` (opcional) e `phoneme_alignments` (lista de `PhonemeAlignment(phoneme, phoneme_ids, num_samples)`). `phoneme_id_samples` vem de uma **segunda saída do modelo ONNX** multiplicada por `hop_length`; **só existe se o modelo expõe essa saída**. `PiperVoice.load(..., include_alignments=True)` aplica um *patch em memória* (`add_alignment_output`), que exige o pacote **`onnx`**; sem ele há apenas um aviso e **sem alinhamentos**. Se IDs não casarem, o alinhamento vira `None` (log em nível debug). Fonte: <https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/src/piper/voice.py>. O release v1.5.0 cita "Add in-memory patching for alignments". A documentação da API Python lida **não menciona** alinhamentos (<https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/docs/API_PYTHON.md>), ou seja, é recurso pouco documentado.
- **[I]** Com durações por fonema em amostras, é possível somar por palavra (agrupando fonemas entre espaços/limites de palavra do espeak) e obter tempos de início/fim por palavra, deslocando pelo offset acumulado das sentenças e pausas entre chunks.
- **Confiabilidade para `word-timings.json` com `source=tts_engine_events` [I]:**
  - São durações **previstas pelo modelo** (preditor de duração do VITS), não eventos de playback; coincidem com o áudio gerado quando o patch expõe o mesmo valor usado na síntese, mas isso **não foi verificado**.
  - Risco: fonemas de pontuação/pausa, `noise_w_scale` (variação estocástica) e `length_scale` afetam; normalização de texto do espeak (números, siglas) altera a segmentação, dificultando casar com palavras do roteiro; falha silenciosa quando `onnx` não está instalado ou os IDs não casam.
  - Só deve usar `source=tts_engine_events` se um teste mostrar que **soma das durações = duração do WAV** (tolerância curta) e que as palavras reconstruídas = tokens do roteiro; caso contrário rotular como `derived_phoneme_durations`/estimativa e manter alinhamento forçado como verificação.
  - **Alinhamento forçado** (extra `alignment` do pacote, **[N]** não investigado o que faz; ou outra ferramenta separada) continua necessário como validação independente e para a Maria/SAPI. O contrato `word-timings.json` não existe no código atual do repositório (busca por `word-timings` e `tts_engine_events`: sem ocorrências) — é proposta de contrato futura.

## 8. Recomendação, bloqueios e plano de prova

**Recomendação:** **prosseguir apenas com uma prova isolada**, não integrar ainda. O Piper (fork `piper1-gpl` 1.8.0) é tecnicamente plausível no Windows (wheel oficial, offline, CPU) e tem vozes pt-BR CC0, mas há bloqueios de licença do motor e de qualidade desconhecida (não ouvida).

**Bloqueios:**

1. **GPL-3.0 do motor** e do espeak-ng: decisão sobre distribuição no instalador (embutir x instalação opcional pelo usuário), com parecer jurídico. Sem embutir no instalador até decidir.
2. Qualidade/naturalidade **não ouvida**: depende da escuta cega (§4).
3. Consentimento/direitos de personalidade dos locutores **não verificado**; CC0 do dataset é o único termo lido.
4. Alinhamento por fonema dependente de patch (`onnx`) e **não validado**.
5. Mantenção do projeto em busca de mantenedores; sem assinatura de artefatos verificada.

**Decisões para o usuário:**

- Aceita a GPL do Piper como componente **opcional, baixado pelo usuário** (recomendado) ou quer embutir no instalador (exige parecer e cumprimento GPL)?
- Qual critério mínimo de qualidade (§4) e quem faz a escuta?
- Aceita o risco residual de direitos de personalidade das vozes CC0 para vídeo monetizado, ou exige consentimento documentado?
- Autoriza a prova abaixo (download e execução de código de terceiros, ainda que offline)?

**Plano de prova (somente após autorização; ambiente isolado novo, fora do repositório e dos dados do operador):**

| Item | Origem | Tamanho | Verificação |
|---|---|---|---|
| `piper_tts-1.8.0-cp39-abi3-win_amd64.whl` | release GitHub `OHF-Voice/piper1-gpl` v1.8.0 e PyPI | 34,1 MB | comparar SHA-256 das duas origens; guardar; licença GPL-3.0-or-later |
| `pt_BR-faber-medium.onnx` + `.onnx.json` + `MODEL_CARD` | `huggingface.co/rhasspy/piper-voices` (`pt/pt_BR/faber/medium`) | 63.221.984 + 5.466 + 456 bytes | SHA-256 do `.onnx` = `75e913eb…8ffc`; licença CC0 |
| `pt_BR-cadu-medium.*` | idem (`cadu/medium`) | 63.221.984 + 5.465 + 420 | `d5a662e3…99de`; CC0 |
| `pt_BR-jeff-medium.*` | idem (`jeff/medium`) | 63.221.984 + 5.465 + 420 | `82ddcdb0…94e1`; CC0 |
| `pt_BR-edresson-low.*` (opcional, referência) | idem (`edresson/low`) | 63.104.526 + 4.168 + 283 | `de4cecee…cd84`; CC BY 4.0 |
| pacote `onnx` (só para alinhamento) | PyPI | **[N]** | hash; avaliar separado |

Etapas: (1) criar venv novo, instalar com `--require-hashes` sem rede após o download; (2) bloquear rede (firewall/NetLog) e sintetizar o roteiro fictício Jardim Aurora por processo separado; (3) medir RTF carregando o modelo uma vez (anotar CPU, versão, fonte da medição); (4) conferir WAV (taxa, PCM, duração, hash); (5) testar `include_alignments=True`: soma das durações × duração do WAV e reconstrução das palavras; (6) escuta cega do usuário; (7) relatório com hashes, licenças e resultados; só então decidir integração (issue separada).

Este documento não concede licença, não altera `publishable=false` nem `demo_only=true` e não substitui parecer jurídico nem aprovação humana.

## 9. Resultados da prova

**Medições locais de 13/11/2026; prova isolada autorizada.** Esta seção complementa a pesquisa acima. Piper não foi integrado ao Hórus, ao worker, à fábrica ou ao instalador; Microsoft Maria permanece a voz vigente. `publishable=false` e `demo_only=true` permanecem. Não houve escuta humana nem aprovação de voz.

### Ambiente, entrada e rastreabilidade

- Ambiente novo: `%LOCALAPPDATA%\Horus\tools\piper-proof\venv`, Python 3.12.16; wheels, modelos, scripts e resultados fora do repositório. Nenhuma dependência Piper instalada no backend ou globalmente.
- CPU: Intel Core i7-13620H, 10 núcleos / 16 processadores lógicos (`Get-CimInstance Win32_Processor`); Windows, somente `CPUExecutionProvider`, sem CUDA. Fonte dos tempos: `time.perf_counter()` no processo de síntese; não são estimativas.
- Versões fixadas: `flatbuffers==25.12.19`, `ml_dtypes==0.6.0`, `numpy==2.5.4`, `onnx==1.23.2`, `onnxruntime==1.32.0`, `packaging==26.3`, `pathvalidate==3.3.1`, `piper-tts==1.8.0`, `protobuf==7.36.2`, `typing_extensions==4.16.0`.
- FFmpeg já disponível no ensaio, sem instalação: `ffmpeg version n7.1 Copyright (c) 2000-2024 the FFmpeg developers`.
- A pasta de aprovação não contém `plan.json`. O coordenador indicou, somente para leitura, o plano do ensaio da main: `C:/Users/yannf/AppData/Local/Temp/horus-pilot-main-qc-114914/test_real_local_pilot_render_r0/data/productions/e8ea0b951c2746f1b9d9f1a7b38af4f6/plan.json`. Foram usados exclusivamente os três `roteiro.linhas[].narracao`, sem reconstrução por legendas. Tamanho: 2.229 bytes; SHA-256 medido: `7c906e894d9fadf1395f1b4ec8ed5acc1ed5f87ae955bb248e6d49d77cdbc73b` (a mensagem do coordenador omitia o último dígito).
- Comparação Maria: `section-1.wav` a `section-3.wav` da pasta aprovada `integracao-conjunta/aprovacao/canais/demo/videos/fixture/`. Todos os arquivos da aprovação tiveram hashes comparados antes/depois do QC e permaneceram intactos. Não foi refeita síntese Maria; seu tempo de geração/RTF não foi medido.

### Artefatos e instalação

O wheel de 34.119.688 bytes foi baixado independentemente do [release oficial v1.8.0](https://github.com/OHF-Voice/piper1-gpl/releases/tag/v1.8.0) e do [PyPI 1.8.0](https://pypi.org/project/piper-tts/1.8.0/). Ambos deram SHA-256 `5da9bfdb05dfe15da3536859d422e605483ffa6d2b3ec2c5b9593bae6b5aa6a4`; o hash também coincide com os metadados das origens. Todos os dez wheels tiveram SHA-256 confrontado com o JSON público da versão no PyPI antes da instalação. Instalação local: `uv pip install --python <venv>/Scripts/python.exe --no-index --find-links <wheels> --require-hashes -r <requirements-hashed.txt>`.

Modelos conferidos com os hashes completos da seção 3 e os OIDs LFS do Hugging Face; configurações e cards também preservados com tamanho e hash:

| Artefato | Bytes | SHA-256 local |
|---|---:|---|
| `models/faber/pt_BR-faber-medium.onnx` | 63221984 | `75e913eb463db0b6ac7ddf68d3e4c9ac19ace36dc3b710a81039b448352b8ffc` |
| `models/faber/pt_BR-faber-medium.onnx.json` | 5466 | `fa8a8fecb01ae198bc416381e368d3206f85bad1449a0f11e1f6a9edf85a32f1` |
| `models/faber/MODEL_CARD` | 456 | `a99caaa7e04fea58294ba4dea46a7ba07fa1f7902c6dff65b6ea2be0e98c5132` |
| `models/cadu/pt_BR-cadu-medium.onnx` | 63221984 | `d5a662e3f606d5a49dd29ba9ce90c304ae45dd9543f8b0c773bcb0de282499de` |
| `models/cadu/pt_BR-cadu-medium.onnx.json` | 5465 | `9fa837b7c1237ea5978bcd7be38c130798e8faa064f754873bb4ce5fc498bd88` |
| `models/cadu/MODEL_CARD` | 420 | `ccd97b4369f50e6fba3a4fb730643ef2675f87b43c5d22298404c58f8204a375` |
| `models/jeff/pt_BR-jeff-medium.onnx` | 63221984 | `82ddcdb01a0342f078bd89ce2815eda27185818d15e15f06fb9a72ac3bce94e1` |
| `models/jeff/pt_BR-jeff-medium.onnx.json` | 5465 | `078ea4e42a680ca3cb662a8929237c32e2c0d581f5363f2f55f09bc266497bf6` |
| `models/jeff/MODEL_CARD` | 420 | `a81ea309434fe2fa23ed89c8ae270bc8aa40908b14e182fae54c021cc368f7a8` |

Os três `MODEL_CARD`s crus declaram CC0 para o dataset. O card de faber cita Cori Samuel como voz do modelo-base inglês, não como identificação do locutor pt-BR; cadu e jeff citam base rdh/nl_BE. Nenhum consentimento de personalidade foi verificado. O wheel inclui `espeak-ng-data`; assinaturas/attestations não foram verificadas. Manifesto completo com URLs, versões, bytes e hashes de todos os wheels/modelos/cards: `escuta-piper/evidencias-reservadas/artifact-manifest.json`.

### Síntese, CPU e qualidade medida

Um processo Python separado do backend carregou cada modelo uma vez com `use_cuda=False` e `include_alignments=True`, sintetizando uma vez por voz/seção (9 WAVs). `SynthesisConfig` padrão: `normalize_audio=True`, `volume=1`, escalas herdadas do modelo (`length_scale=1`, `noise_scale=0.5`, `noise_w=0.333`). RTF = segundos de `list(voice.synthesize(...))` / duração PCM; exclui carga, serialização WAV e QC, inclui fonemização, inferência e construção de alinhamentos. Sem aquecimento, afinidade ou repetição estatística; a primeira seção de faber inclui a inicialização compartilhada do fonemizador. Os números representam esta execução, com o patch de alinhamento ativo.

| Voz | Carga (s) | Síntese total (s) | Áudio total (s) | RTF total |
|---|---:|---:|---:|---:|
| faber | 1.7311 | 1.6202 | 29.9421 | 0.0541 |
| cadu | 0.6840 | 1.0657 | 31.9390 | 0.0334 |
| jeff | 0.7690 | 1.0649 | 30.3369 | 0.0351 |

Todos os originais são WAV PCM 16 bits, mono, 22.050 Hz. Duração, pico e amostras no extremo do PCM vêm de `pilot_quality.analyze_wav`; LUFS integrados e true peak vêm de `av_quality._loudness` com o filtro `loudnorm` do FFmpeg (o fallback existente, pois `ebur128` não pôde ser usado neste build). A contagem de clipping abaixo é a definição do analisador (`>=32767` ou `<=-32768`), não um diagnóstico auditivo de distorção. A normalização padrão do Piper encosta no fundo de escala, com true peak até +0,13 dBTP; isso exige margem no áudio de escuta.

| Voz/seção | Duração (s) | Síntese (s) | RTF | Pico PCM | Amostras no extremo | LUFS-I | dBTP |
|---|---:|---:|---:|---:|---:|---:|---:|
| Maria/1 | 14.8714 | não medido | não medido | 0.593689 | 0 | -23.32 | -4.49 |
| faber/1 | 9.3344 | 0.9207 | 0.0986 | 0.999969 | 1 | -15.33 | 0.13 |
| cadu/1 | 9.8569 | 0.3068 | 0.0311 | 0.999969 | 2 | -17.97 | -0.00 |
| jeff/1 | 9.9614 | 0.4259 | 0.0428 | 0.999969 | 0 | -20.30 | 0.00 |
| Maria/2 | 16.4144 | não medido | não medido | 0.574707 | 0 | -23.99 | -4.81 |
| faber/2 | 10.4490 | 0.3553 | 0.0340 | 0.999969 | 2 | -14.82 | 0.07 |
| cadu/2 | 11.0527 | 0.3263 | 0.0295 | 0.999969 | 3 | -18.80 | 0.08 |
| jeff/2 | 10.2632 | 0.3628 | 0.0354 | 0.999969 | 1 | -19.61 | 0.03 |
| Maria/3 | 16.6272 | não medido | não medido | 0.499847 | 0 | -24.40 | -6.00 |
| faber/3 | 10.1587 | 0.3442 | 0.0339 | 0.999969 | 3 | -15.51 | 0.08 |
| cadu/3 | 11.0295 | 0.4325 | 0.0392 | 0.999969 | 3 | -17.87 | 0.01 |
| jeff/3 | 10.1123 | 0.2761 | 0.0273 | 0.999969 | 1 | -18.80 | 0.08 |

SHA-256 dos WAVs originais (o manifesto de QC também registra tamanho, formato, RMS, fração de clipping e intervalos de silêncio):

| Voz/seção | SHA-256 WAV |
|---|---|
| Maria/1 | `a242cb549dbb7f35a2643c94c1d7be59225bc33aba513754da3af2fec5a3bd1b` |
| faber/1 | `ac3b2b0acf4ae637b346d828c7ed45808fca3a254c88b5d9e336ec3d66327dbd` |
| cadu/1 | `a1eb238e79de20ce408d985f554111a00d056a25a40b9b192080edea9200fae6` |
| jeff/1 | `0956bc90bd582dbac67a5b089c60afab5c7f4572ea4a95143651dce8e65bb6a6` |
| Maria/2 | `5d0361f1049795aa78ebb84c8630577ffa6f7ad6172b9e1b67b0941aa81be023` |
| faber/2 | `c41904cbadbccba6af09159bf41856b615b58d2db090a3008e62e957171f6a2a` |
| cadu/2 | `22f4057b7848d075eb8fef3e4f8f3884512f567f18516b37fd614b8581618ab8` |
| jeff/2 | `0396442f2b02d15b16bc627230a416b12caccbb8956f325b5f42b1eed87fc700` |
| Maria/3 | `70176a894ce4fd841a25ef1d985fae982ddac135ba5e625b1e881cadc9038c42` |
| faber/3 | `958b039d99da64b7b65f81c3d45114b534b8c9a6c7878ef631209b26cc520523` |
| cadu/3 | `4a070928bc217ea2c60042155c460ff470256de3ead4bd280b25ddfb6fcc6442` |
| jeff/3 | `3da615395c8ff7618766678b75bafdbfe49ca012eb18ab91e6585d018a0caea8` |

Maria totaliza 47,9129 s; Piper, cerca de 30–32 s para o mesmo texto. Essa diferença mede duração/ritmo nesta configuração; não demonstra maior naturalidade, inteligibilidade ou qualidade. Nenhuma dessas propriedades foi julgada automaticamente.

### Rede e limite da evidência offline

Todos os downloads ocorreram antes da síntese. O processo definiu `HF_HUB_OFFLINE=1`, removeu variáveis de proxy e instalou, antes de importar Piper, uma guarda que registra e recusa `socket.socket.connect`, `connect_ex` e `getaddrinfo`. Resultado observado: **zero tentativas** nas nove sínteses e na verificação adicional de fonemização. Não houve alteração de firewall nem uso de administrador. **É guarda em processo Python, não bloqueio/auditoria de rede do SO ou de chamadas nativas do ONNX/espeak.** Não foi feita captura ETW/NetLog. Portanto, o comportamento com recursos locais foi validado dentro desse escopo; ausência absoluta de tráfego nativo não foi comprovada.

### Alinhamentos e reconstrução de palavras

O pacote `onnx==1.23.2` permitiu o patch em memória. Todos os chunks das nove sínteses retornaram `phoneme_id_samples` e `phoneme_alignments`. A soma por ID e por fonema coincide exatamente com as amostras do WAV, sem tolerância necessária:

| Voz | Seção 1: WAV = alinhamento (amostras) | Seção 2 | Seção 3 |
|---|---:|---:|---:|
| faber | 205824 | 230400 | 224000 |
| cadu | 217344 | 243712 | 243200 |
| jeff | 219648 | 226304 | 222976 |

Os espaços nos fonemas produziram 24, 25 e 28 grupos nas três seções, igual à quantidade de tokens do roteiro, para todas as vozes. Isso permite uma associação posicional candidata neste texto, mas não comprova identidade lexical: a API não retorna palavras ortográficas, e copiar os tokens por índice seria assumir a reconstrução. Uma prova adicional comparou cada grupo em contexto com a fonemização independente do token do roteiro, ignorando pontuação e marcas de acento: houve correspondência em **16/24, 17/25 e 23/28**, respectivamente. Exemplos de divergência contextual: “Jardim”, “moradores”, “um”; elas não são, por si, erros de pronúncia. Os pares completos estão em `word-mapping-probe.json`.

**Conclusão técnica:** a soma temporal por fonema passou; a reconstrução lexical não foi validada. Este incremento não fornece evidência suficiente para `source=tts_engine_events` por palavra. Tratar a saída como `derived_phoneme_durations`, com mapeamento lexical e verificação independente ainda necessários; não foi implementado contrato nem alinhador forçado.

### Material de escuta e verificações

- Pasta local: `C:\00. Projetos\01. HORUS\relatorios\PILOTO-LOCAL-2026-11-13\escuta-piper\`. `audios/` contém 12 WAVs (três trechos × quatro vozes), nomes com códigos aleatórios criptográficos; o README contém o protocolo. Mapa e hashes ficam separados em `CHAVE-RESERVADA-NAO-ABRIR.json`; o usuário deve abrir somente `audios/` até registrar as notas.
- Todos os arquivos de escuta foram reamostrados para PCM 16 bits mono/48 kHz, sem metadados de voz. Duas passagens `loudnorm`, seguidas de atenuação para o mesmo loudness medido de **−17 LUFS-I (±0,03 LU)**; true peak **≤ −1 dBTP** e **zero amostras clipadas**, verificados novamente pelos analisadores existentes. Originais preservados; duração/pausas naturais não foram comprimidas. Cegagem não elimina pistas perceptivas da voz ou duração.
- Limitação do protocolo: só há três seções, sem números/datas/siglas, com Piper em 9–11 s e Maria em 15–17 s. Não existem cinco trechos das categorias de §4, nem 60 s contínuos por voz. O README apresenta isso como triagem; o aceite em 4/5 trechos e fadiga contínua continuam pendentes.
- Regressão: `& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_pilot_quality.py backend/tests/test_av_quality.py -q` → **95 passed, 1 skipped** (symlink indisponível sem privilégio). Nenhum teste removido/alterado; sem testes de rede ou inferência externa.
- Verificação externa final: `& backend/.venv/Scripts/python.exe <piper-proof>/equalize_verify.py` → 12 WAVs com LUFS/pico/clipping nos limites acima. `synthesize.py` e `word_mapping_probe.py` rodaram somente no novo venv do Piper; o QC usou o venv preexistente do backend apenas para importar os analisadores, sem Piper e sem instalar dependências nele.
- Evidências completas e scripts fora do repo: `escuta-piper/evidencias-reservadas/` (`synthesis.json`, `quality.json`, `word-mapping-probe.json`, manifesto de artefatos, requisitos com hashes, CPU e cards). Esses arquivos revelam a chave: reservar ao avaliador até o fim da escuta.

**Pendente:** escuta humana, extensão para o protocolo completo, mapeamento lexical robusto/validação independente, avaliação jurídica do motor/distribuição e direitos de personalidade. Não se decidiu adoção, integração, publicação ou substituição da Maria.

## Fontes (acessadas em 13/11/2026)

- <https://github.com/rhasspy/piper> e <https://api.github.com/repos/rhasspy/piper/releases/latest>
- <https://github.com/OHF-Voice/piper1-gpl>, <https://api.github.com/repos/OHF-Voice/piper1-gpl/releases?per_page=5>
- <https://pypi.org/project/piper-tts/>
- <https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/src/piper/voice.py>, `docs/API_PYTHON.md`, `docs/VOICES.md`
- <https://huggingface.co/rhasspy/piper-voices/tree/main/pt/pt_BR> (+ `MODEL_CARD` e API de árvore de cada voz)
- <https://github.com/OHF-Voice/voice-datasets>
- <https://raw.githubusercontent.com/espeak-ng/espeak-ng/master/COPYING>, <https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE>
- Busca web sobre RTF (fontes secundárias; ver §5)
