# Avaliação comparativa de vozes pt-BR — HOR-132

Pesquisa **documental** nas seções 1–5, acessos em **13/11/2026**. Nessas seções, nada foi baixado, instalado, executado, ouvido nem enviado a serviço externo; a **seção 6** registra a prova local, isolada e medida do Kokoro, feita depois e única parte com execução; nenhuma conta ou API paga foi usada; nenhum texto do projeto saiu do computador. Isto não é parecer jurídico nem concede licença; `publishable=false` e `demo_only=true` permanecem.

Convenção: **[F]** fato lido na fonte citada; **[I]** inferência; **[N]** não verificado. As páginas foram lidas por uma ferramenta de leitura que devolve resumo automático, não o texto cru: antes de qualquer decisão contratual ou de compra, reler a fonte original (termos, preços e licenças mudam). Nenhum número aqui é medição do Hórus.

Contexto: o usuário não aprovou a naturalidade da Microsoft Maria (SAPI) nem do Piper (ver [avaliacao-piper.md](avaliacao-piper.md)). Objetivo: salto claro de naturalidade na narração.

## 1. ElevenLabs (`eleven_v4` e `eleven_multilingual_v2`)

### 1.1 Modelos

Fonte: <https://elevenlabs.io/docs/overview/models> (13/11/2026).

| Item | `eleven_v4` | `eleven_multilingual_v2` |
|---|---|---|
| Posicionamento **[F]** | "most emotive, high quality" — flagship atual | "previous generation"; ainda listado; descrito como o mais estável para longa duração |
| Idiomas **[F]** | 90+, inclui `pt` | 29, inclui português (Brasil e Portugal) |
| Limite por requisição **[F]** | 10.000 caracteres (~10 min) | 10.000 caracteres (~10 min) |
| Latência **[F]** | não informada (só Flash/Turbo têm número) | sem número; "maior latência e custo por caractere que Flash" |
| Qualidade/naturalidade pt-BR | **[N]** nenhuma avaliação independente pt-BR lida; "mais emotivo" é alegação do fornecedor | **[N]** idem; a doc só diz que normaliza números melhor que Flash v2.5 |

### 1.2 Controle

Fonte: <https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices>.

- **[F]** Velocidade (ambos): 0,7–1,2, padrão 1,0; extremos podem afetar a qualidade.
- **[F]** `eleven_v4`: **audio tags** (`[whispers]`, `[excited]`, `[curious]`, `[sighs]` etc.; algumas inconsistentes entre vozes; tag pode ser lida como efeito sonoro); reticências geram pausa, maiúsculas enfatizam; **IPA entre barras** para pronúncia; **sem SSML `<break>`**.
- **[F]** `eleven_multilingual_v2`: sem tags de fonema; usar alias/regrafia/dicionários de pronúncia (Studio e API); normalização de números ativa por padrão.
- **[F]** Parâmetros da API (`voice_settings`): `stability` (padrão 0,5), `similarity_boost` (0,75), `style` (0), `speed` (1), `use_speaker_boost` (aumenta latência); `seed` (0–4294967295, determinismo apenas "best effort"); `previous_text` para continuidade; `language_code` **não** é suportado em `multilingual_v2`. Fonte: <https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps>.
- **[N]** A doc de boas práticas lida não explica o efeito de stability/style por modelo, nem traz orientação pt-BR.

### 1.3 Timestamps por caractere

- **[F]** `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps` devolve `audio_base64` + `alignment` (texto original) e `normalized_alignment` (texto normalizado), cada um com `characters`, `character_start_times_seconds`, `character_end_times_seconds`. Fonte: página acima.
- **[F]** Pela página lida, a restrição de modelo é apenas "o modelo deve suportar TTS"; **[N]** não verificado se `eleven_v4` devolve alinhamento idêntico ao v2 em pt-BR (testar com chave autorizada).
- **[I]** Tempos por caractere permitem derivar palavras por tokenização, contornando o problema lexical do Piper (alinhamento fonêmico sem palavras). Os tempos vêm do serviço, não de playback: validar soma × duração do WAV.
- **[F]** Formatos: MP3 192 kbps exige Creator+; PCM/WAV 44,1 kHz exige Pro+. O PCM 24 kHz usado hoje não aparece como restrito na página lida **[N]**.

### 1.4 Preço e planos

Fonte: <https://elevenlabs.io/pricing/api> (13/11/2026).

- **[F]** API, por 1.000 caracteres: v4 **US$ 0,08**; v2 Multilingual **US$ 0,08**; Flash/Turbo e v4 Turbo US$ 0,04. A página diz que a API é cobrada em dólares, não em créditos.
- **[F]** Planos mensais (caracteres v4 incluídos): Free 10.000; Starter US$ 6 (75.000; 1º mês US$ 1); Creator US$ 22 (275.000); Pro US$ 99 (1.238.000).
- **[I]** Roteiro de ~48 s (≈ 800 caracteres): ~US$ 0,06 por geração na tarifa de API; um vídeo de 8 min (~7.000 caracteres) ~US$ 0,56 por geração completa, antes de regenerações. Estimativa aritmética, não cobrança real.
- **[N]** Relação plano mensal × tarifa de API (se a chave de API consome a cota do plano ou é pay-as-you-go) não ficou clara na página lida.

### 1.5 Licença comercial

- **[F]** Termos de uso (<https://elevenlabs.io/terms-of-use>, Seção 1(c)): usuários **gratuitos só para uso não comercial**; assinantes pagos podem usar comercialmente, respeitando a Prohibited Use Policy. A página lida não traz exigência de atribuição (o texto no código atual menciona atribuição no plano gratuito: **[N]** não confirmado nos termos lidos; a página de ajuda de publicação devolveu 403).
- **[F]** O usuário mantém direitos sobre Input/Output (§4(c)), mas concede à ElevenLabs licença perpétua, irrevogável, sublicenciável para usar o conteúdo para prestar e melhorar os serviços e desenvolver novos produtos (§4(d)). **[F]** Saídas semelhantes podem ser geradas para outros usuários (§10).
- **[F]** A página de preços só afirma licenciamento comercial para Music; para TTS ela não se pronuncia. O quadro de planos abaixo vem dos termos (§1(c)), não da tabela de preços.
- **[I]** O código atual (`licenca_detalhada`) já trata free como não comercial e só libera quando a API devolve tier pago ativo — compatível com os termos lidos. A lista `_PAGOS` inclui `starter`; **[N]** confirmar que todos os tiers pagos têm direito comercial na versão vigente dos termos.

### 1.6 Vozes pt-BR e clonagem

Fonte: <https://elevenlabs.io/docs/overview/capabilities/voices>.

- **[F]** Instant Voice Cloning (poucos minutos de áudio, "na maioria dos planos"); Professional Voice Cloning exige **Creator+** e usa verificação "voice captcha" (a voz deve ser do próprio solicitante).
- **[F]** Termos §4(b)/(g): só enviar a própria voz ou voz que se tem autorização para compartilhar; o usuário declara ter todos os direitos. A ElevenLabs diz que não comercializa a voz isoladamente sem permissão (§4(d)).
- **[F]** Voice Library: donos definem seus termos e recebem recompensas quando assinantes pagos usam suas vozes; vozes da Library **não** estão disponíveis na API para o plano gratuito. **[N]** a disponibilidade de vozes pt-BR e os termos comerciais por voz não constam dessa página; o código usa `GET /v1/shared-voices` com filtro `pt-br`.
- **[I]** Voice Design (já no código) evita voz de terceiro e dispensa consentimento de pessoa real; a voz resultante é da conta.

### 1.7 Retenção de dados

Fonte: <https://elevenlabs.io/docs/developers/resources/zero-retention-mode>.

- **[F]** Retenção padrão de texto e áudio, conforme a Política de Privacidade; apagar via API remove áudio/texto, mas logs de depuração/moderação podem reter; backups até 30 dias.
- **[F]** Zero Retention Mode (`enable_logging=false`) é para clientes **Enterprise**; também indisponível stitching por histórico.
- **[F]** A página não diz se entradas/saídas treinam modelos próprios; os termos (§4(d)) permitem usar o conteúdo para "desenvolver novos produtos". **[I]** Enviar roteiro inédito equivale a ceder esse texto ao serviço; isso é **transmissão externa** e exige autorização do usuário (§6).

### 1.8 O que `fabrica-canais/scripts/fabrica/elevenlabs.py` já implementa (leitura)

Lido no repositório irmão `fabrica-canais` (não alterado). **[F, código]**:

- `MODELO_PADRAO = "eleven_v4"`; `gerar()` chama `POST /v1/text-to-speech/{voz}` com `output_format=pcm_24000` e grava WAV PCM 16 bits mono 24 kHz; texto inteiro numa chamada; rejeita resposta < 0,5 s.
- **Não usa** `/with-timestamps`, `voice_settings`, `seed`, `previous_text`, `language_code` nem blocos de texto (um roteiro > 10.000 caracteres falharia).
- Licença vem de `GET /v1/user/subscription` (`tier`, `status`); `.env` nunca libera; falha de leitura ⇒ não publicável; free ⇒ não comercial.
- Voice Library (`/v1/shared-voices`, `/v1/voices/add/...`) e Voice Design (`/v1/text-to-voice/design`) implementados.
- **Lacunas para o Hórus [I]:** (1) trocar para `/with-timestamps` e gravar `alignment` como `word-timings` (derivado, `source` honesto); (2) expor `voice_settings`/`seed`; (3) dividir texto por seção ou ≤ 10.000 caracteres usando `previous_text`; (4) registrar `model_id`, `voice_id`, tier e data no manifesto; (5) política de retenção.

### 1.9 Riscos ElevenLabs

Texto e áudio saem do computador (retenção padrão); dependência de preço/termos de terceiro e de conectividade; licença comercial só em plano pago (áudio feito no free permanece não comercial); voz de terceiro exige consentimento/termos da Library; `eleven_v4` é recente e pouco avaliado em pt-BR por fontes independentes **[N]**.

## 2. Modelos locais

### 2.1 F5-TTS e fine-tunes pt-BR

- **[F]** Código **MIT**; pesos pré-treinados **CC-BY-NC** "devido ao Emilia" (dataset in-the-wild). Fontes: <https://github.com/SWivid/F5-TTS>, <https://huggingface.co/SWivid/F5-TTS> (metadado `cc-by-nc-4.0`; checkpoints F5TTS_v1_Base, F5TTS_Base, E2TTS_Base).
- **[F]** Fine-tune pt-BR mais citado: **`firstpixel/F5-TTS-pt-br`**: licença `cc-by-nc-4.0` (herdada da base); "teste preliminar", só português; dados: Common Voice (~3.500 locutores) + um conjunto "facebook" não descrito; rodadas de ~183–448 h (a própria página tem números diferentes por rodada); sem MOS/WER, amostras só em Vocaroo; pede números por extenso (num2words), texto minúsculo, linhas curtas (texto longo "deriva"), referência de 5–9 s. Fonte: <https://huggingface.co/firstpixel/F5-TTS-pt-br>.
- **[F, busca]** Checkpoint "Paraíba" (dissertação 2026) parte do firstpixel, também CC-BY-NC-4.0; `ModelsLab/F5-tts-brazilian` sem metadado de licença. Fonte: busca web e <https://huggingface.co/acidente/fala_pb_checkpoints> (resumo de busca; **[N]** página não lida diretamente).
- **Conclusão:** **nenhum F5-TTS pt-BR encontrado permite uso comercial**. Pesos NC ⇒ proibido em vídeo monetizado; serve no máximo para pesquisa/escuta interna. Treinar um modelo pt-BR comercial do zero exigiria dados permissivos e GPU de treino (fora de escopo, **[N]**).
- **Clonagem por referência:** exige áudio de uma voz; usar só voz própria ou com consentimento documentado. Os dados do fine-tune (Common Voice é CC0 segundo o projeto Mozilla **[N]** não verificado aqui) não resolvem a licença NC dos pesos.
- **Hardware [F/N]:** a página oficial não informa VRAM nem Windows. Único número: RTF 0,1467 em PyTorch offline numa **GPU L20** (16 NFE, F5-TTS Base) — **não** transponível à RTX 3050 6 GB. **[I]** o modelo (~335 M parâmetros) deve caber em 6 GB em FP16, mas **[N]** nenhuma medição em RTX 3050 ou CPU foi encontrada; em CPU esperar bem mais lento que tempo real. Requer Python ≥ 3.10, PyTorch/CUDA e FFmpeg.
- **Timestamps:** nenhum nativo **[I]** (exige alinhador externo).

### 2.2 Alternativas

| Motor | Licença (código / pesos) | Uso comercial | pt-BR | Observações com fonte |
|---|---|---|---|---|
| **Kokoro-82M** | Apache-2.0 (pesos) **[F]** | **Permitido** pela licença **[F]**; a licença dos dados de treino **[N]** | **pf_dora, pm_alex, pm_santa** (`lang_code='p'`, espeak-ng `pt-br`) **[F]**; VOICES.md avisa que idiomas não-ingleses podem ter suporte "ausente ou fraco" por G2P/dados | 82 M parâmetros; sem clonagem; VRAM/RTF **[N]**; **[I]** leve o bastante para CPU. Fonte: <https://huggingface.co/hexgrad/Kokoro-82M> |
| **Chatterbox** (Resemble AI) | **MIT** (repositório) **[F]** | MIT no repo; licença de V3/pacotes de idioma **[N]** (ler cada card) | Multilingual V3 (23+ idiomas incl. `pt`) e pacotes dedicados pt-BR/pt-PT **[F]** | Marca d'água PerTh em todo áudio **[F]**; clonagem por referência (consentimento); **projeto "aposentado, sem suporte" desde ago/2026 e arquivado sob MIT [F]**; ~3,5 GB VRAM só TTS no model card da NVIDIA, ~4 GB em teste de terceiro **[F, secundário]**; relatos anedóticos de artefatos **[N]**. Fonte: <https://raw.githubusercontent.com/resemble-ai/chatterbox/master/README.md> |
| Fine-tune comunitário `gorack/Chatterbox-TTS-Portuguese` | MIT (declarado) | Dados de treino (BRSpeech-TTS, portuguese-tts) com **licença não verificada [N]** | pt | Cópia de outro repositório, 0 curtidas, sem métricas/amostras **[F]**. Fonte: <https://huggingface.co/gorack/Chatterbox-TTS-Portuguese> |
| **XTTS-v2** (Coqui) | Pesos **CPML** | **NÃO** — CPML é não comercial **[F, resumo de busca]**; empresa encerrada (dez/2023–jan/2024), sem licença paga **[F, secundário]** | pt **[F]** | Evitar para uso monetizado. Fontes: <https://huggingface.co/coqui/XTTS-v2>, busca web (`coqui.ai/cpml` retornou 404) |
| **Fish/OpenAudio S1-mini** | Pesos **CC-BY-NC-SA-4.0** | **NÃO** (NC); S1 completo é proprietário | pt entre 13 idiomas **[F]** | Fonte: <https://huggingface.co/fishaudio/openaudio-s1-mini>. Licença do código **[N]** |
| **Piper** (já avaliado) | Motor GPL-3.0; vozes pt-BR CC0 | Sim, com ressalvas da GPL | faber/cadu/jeff | Já reprovado por naturalidade; ver [avaliacao-piper.md](avaliacao-piper.md) |
| **StyleTTS2** | **[N]** não pesquisado | **[N]** | **[N]** sem voz pt-BR conhecida nesta pesquisa | Não avaliado; sem base documental |

Observações: "MIT/Apache" no repositório não garante que os **dados** de treino permitam uso comercial; para pesos derivados (fine-tunes) a licença efetiva é a mais restritiva da cadeia. Nada disso foi auditado juridicamente.

## 3. Tabela comparativa

"Naturalidade" = apenas evidência lida. **Nada foi ouvido** por mim.

| Opção | Naturalidade (evidência) | pt-BR nativo | Licença motor / pesos | Uso comercial | Custo | Hardware | Offline | Timestamps | Riscos |
|---|---|---|---|---|---|---|---|---|---|
| ElevenLabs v4 | Alegação do fornecedor ("mais emotivo"); sem avaliação independente pt-BR lida | Suporte declarado (`pt`) | Serviço proprietário | Só plano pago (termos §1(c)) | US$ 0,08/1k caracteres (API); plano Starter US$ 6/mês | Nenhum local | Não | Sim, por caractere | Texto sai do PC; retenção padrão; termos/preço; consentimento de voz da Library |
| ElevenLabs multilingual_v2 | Idem; "mais estável" em longa duração (fornecedor) | Sim (29 idiomas) | idem | idem | US$ 0,08/1k | idem | Não | Sim (mesmo endpoint) | idem; modelo "geração anterior" |
| F5-TTS + pt-br fine-tune | Sem MOS/WER; "teste preliminar" | Sim (fine-tune) | MIT / **CC-BY-NC** | **Não** | Grátis | GPU CUDA; 6 GB provável, não medido | Sim | Não nativo | Licença NC; deriva em texto longo; clonagem exige consentimento |
| Kokoro-82M | Alegação "qualidade comparável a modelos maiores"; aviso de suporte fraco em não-inglês | Sim (3 vozes) | Apache-2.0 | Sim (licença do peso) | Grátis | Leve (82 M); medir | Sim | Não **[N]** | G2P pt-BR fraco (espeak-ng); poucas vozes; sem clonagem |
| Chatterbox Multilingual V3 / pt-BR | Sem avaliação pt-BR lida | Sim (pacote pt-BR) | MIT (repo); pesos **[N]** | Provável, confirmar card | Grátis | ~3,5–4 GB VRAM (terceiros) | Sim | Não | Projeto aposentado; marca d'água; clonagem; artefatos anedóticos |
| XTTS-v2 | Sem dado lido | pt | CPML | **Não** | Grátis | GPU | Sim | Não | Empresa encerrada |
| Fish/OpenAudio S1-mini | Sem dado lido | pt | CC-BY-NC-SA | **Não** | Grátis | **[N]** | Sim | **[N]** | NC |
| Piper faber/cadu/jeff | Reprovado pelo usuário | Sim | GPL-3.0 / CC0 | Sim (GPL do motor) | Grátis | CPU, RTF 0,03–0,10 medido | Sim | Fonemas (sem palavras) | GPL; qualidade |
| Microsoft Maria (SAPI) | Reprovada pelo usuário | Sim | proprietária / `unverified` | **Não verificado** | Incluída no Windows | CPU | Sim | Seções medidas | Licença não verificada |

## 4. Recomendação

**(a) Melhor opção paga:** **ElevenLabs `eleven_multilingual_v2` e `eleven_v4`, comparados às cegas**, em plano pago (Starter basta para a prova). É a única opção da lista com pt-BR declarado, controle de ritmo/ênfase (v4: tags, IPA), timestamps por caractere e licença comercial documentada. Para narração longa e estável, começar a prova pelo `multilingual_v2` e usar o v4 onde expressividade importar **[I]**; não há evidência lida que dê vencedor. Pré-requisito de custo: o custo por vídeo é de poucos dólares na tarifa de API **[I]**.

**(b) Melhor local com uso comercial:** **Kokoro-82M** (Apache-2.0, vozes pt-BR `pf_dora`, `pm_alex`, `pm_santa`) como primeira candidata a testar, por licença limpa e custo computacional baixo; **Chatterbox pt-BR** como segunda candidata, **apenas se** o card dos pesos confirmar licença permissiva e o usuário aceitar um projeto sem manutenção. **[I]** A expectativa para Kokoro é qualidade intermediária entre Piper e nuvem, pelo próprio aviso do projeto sobre G2P; só a escuta decide. F5-TTS, XTTS e Fish ficam **excluídos para publicação** (NC).

**(c) Prova de escuta cega — 5 trechos** (todos com o mesmo texto para todas as vozes; sem música; mesmo loudness, ex.: −17 LUFS, pico ≤ −1 dBTP; 48 kHz; nomes de arquivo aleatórios, mapa guardado por outra pessoa/Maestro):

1. **Números:** datas, valores monetários, percentuais, ordinais (ex.: "em 12 de março de 2026, R$ 1.250,50, 3,5%").
2. **Siglas e nomes próprios:** CPF, PIX, ONU, IBGE, nome do canal, nomes estrangeiros comuns.
3. **Frases longas:** 2–3 períodos com orações subordinadas (~35–50 palavras).
4. **Ênfase:** frase curta com contraste ("Não foi um erro. Foi uma decisão.").
5. **Informal:** trecho conversacional com gírias e perguntas retóricas.

Vozes: Maria (referência baixa), Piper (referência baixa, opcional), ElevenLabs v2, ElevenLabs v4, Kokoro (3 vozes), Chatterbox pt-BR (se licença confirmada); nos pagos, parâmetros fixos e registrados (`stability`, `style`, `speed`, `seed`).

Critérios (nota 1–5 por trecho): naturalidade, pronúncia (erros anotados por palavra), ritmo e pausas, ênfase adequada, ausência de artefatos (cortes, respiração estranha, sotaque estrangeiro), fadiga após 60 s contínuos (concatenar os 5 trechos). Pergunta final por voz: "publicaria em vídeo com seu nome?" (sim/talvez/não). Aceite sugerido: naturalidade média **claramente acima da Maria** (≥ +1,0), **zero erro grave** em números e siglas, "sim/talvez" em ≥ 4/5 trechos, nenhum artefato grave. Registrar mapa de-cegagem, versões, parâmetros, hashes e datas em relatório datado; a escuta e o veredito são do usuário.

**(d) O que exige autorização do usuário** (nada disso foi feito):

- Criar conta, assinar plano pago e fornecer/usar a chave de API da ElevenLabs (gasto) e gerar áudio na nuvem.
- Enviar texto do projeto (mesmo roteiro fictício) à ElevenLabs: retenção padrão e licença de uso do conteúdo (§1.7); zero retenção é Enterprise.
- Baixar modelos/pacotes de terceiros (Kokoro, Chatterbox, pesos) e executar código de terceiros, mesmo offline, em ambiente isolado com hash.
- Qualquer clonagem de voz (consentimento documentado do dono da voz) e uso de vozes da Voice Library com termos comerciais próprios.
- Aceitar licenças (Apache-2.0 do Kokoro; MIT/dados do Chatterbox) e, se houver distribuição, parecer jurídico sobre dados de treino; decidir não usar pesos NC em nada publicável.
- Alterar o código da fábrica (`/with-timestamps`, `voice_settings`) ou contratos de timing: é incremento separado, após a escolha de voz.

## 5. Limites desta pesquisa

- Fontes lidas por resumo automático; sem texto cru de termos e cards.
- Nenhuma amostra de áudio foi ouvida; nenhuma alegação de naturalidade foi verificada.
- Não verificados: qualidade pt-BR de `eleven_v4`; atribuição no plano free; direitos comerciais de todos os tiers; licença dos pesos Chatterbox V3/pt-BR e dos datasets BRSpeech/portuguese-tts; VRAM/RTF em RTX 3050 6 GB e na CPU do usuário para F5/Kokoro/Chatterbox; StyleTTS2.
- Páginas retornaram erro e não foram lidas: help.elevenlabs.io (403), `ResembleAI/chatterbox-multilingual` (401), `coqui.ai/cpml` (404).

## 6. Prova do Kokoro-82M (medições locais de 13/11/2026)

Prova isolada e autorizada. O Kokoro **não** foi integrado ao Hórus, ao worker, à fábrica ou ao instalador; a Microsoft Maria segue a voz vigente. `publishable=false` e `demo_only=true` permanecem. **Ninguém ouviu os áudios**: não há veredito de naturalidade e nenhuma voz foi aprovada; as seções 2–4 continuam sendo hipótese. Os fatos abaixo são medidos, salvo marca **[N]**. Scripts, JSON e manifesto ficam fora do Git, em `relatorios/PILOTO-LOCAL-2026-11-13/escuta-vozes/evidencias-reservadas/` (a pasta revela a chave da escuta cega: reservada ao avaliador).

### 6.1 Ambiente e artefatos

- Ambiente novo: `%LOCALAPPDATA%\Horus\tools\kokoro-proof\venv` (Python 3.12.16, ~6,7 GB em disco) e `model/` (314 MiB). Nada no venv do backend, global ou no instalador; nenhum driver ou configuração global alterados.
- Instalação: `uv pip install --require-hashes -r requirements-hashed.txt` (saída de `uv pip compile --generate-hashes`; todos os wheels transitivos com SHA-256 fixado). Principais: `kokoro==0.9.4` (wheel 32.592 B, `a129dc63…efd`), `misaki==0.9.4` (3.617.774 B, `90e2eeb1…a15f`), `espeakng-loader==0.2.4` (wheel win_amd64, 9.437.292 B, `41f1e08a…d7abd7`), `phonemizer-fork==3.3.2` (82.700 B, `97305c76…4b74`), `torch==2.8.0+cu126` (2.915.418.348 B, `f6c79eac…338e4c`, de `download.pytorch.org/whl/cu126`), `numpy==2.5.4`, `transformers==5.23.0`, `huggingface-hub==2.4.0`, `spacy==3.8.18` (exigido por `misaki[en]`, não usado em pt-BR). Lista completa com hashes: `artifact-manifest.json` e `requirements-hashed.txt`.
- Pesos: `huggingface.co/hexgrad/Kokoro-82M`, revisão fixada `f3ff3571791e39611d31c381e3a41a3af07b4987`. SHA-256 conferido com o OID LFS publicado:

| Arquivo | Bytes | SHA-256 |
|---|---:|---|
| `kokoro-v1_0.pth` | 327212226 | `496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4` |
| `voices/pf_dora.pt` | 523425 | `07e4ff987c5d5a8c3995efd15cc4f0db7c4c15e881b198d8ab7f67ecf51f5eb7` |
| `voices/pm_alex.pt` | 523425 | `cf0ba8c573c2480fc54123683a35cf1e2ae130428e441eb91f9149bdb188a526` |
| `voices/pm_santa.pt` | 523430 | `d42103169c5c872abbafb9129133af7e942bb9d272c3cc3b95c203e7d7198c29` |
| `config.json` | 2351 | `5abb01e2403b072bf03d04fde160443e209d7a0dad49a423be15196b9b43c17f` |
| `README.md` (card, guardado) | 6348 | `91dcabced89db6f109b8786642f50402d3ee87450e8189589b6f85520e7f4d78` |
| `VOICES.md` (guardado) | 7625 | `ec7e4941ad7e194af61e3455928528a9ff5360c7c505e412efab27d6a69ea106` |

- Licenças (lidas no card e nos metadados; não é parecer jurídico): pesos Apache-2.0 (metadado `apache-2.0`; o repositório não tem arquivo `LICENSE`: a URL devolveu "Entry not found"); `kokoro` e `misaki` Apache-2.0. **espeak-ng é GPL-3.0** e `phonemizer-fork` é GPLv3+ (metadado do wheel). Não houve instalador separado: o pacote `espeakng-loader` já embute `espeak-ng.dll` (419.328 B, `646d387a…e258`) e a pasta `espeak-ng-data` (121 itens), por usuário e sem administrador. Esse componente GPL roda **dentro do processo Python do Kokoro** (DLL carregada em processo); a fronteira de processo é o próprio processo de síntese, separado do backend, que só trocaria arquivos WAV. **[N]** Se isso basta para isolar a GPL numa futura distribuição exige parecer jurídico; hoje nada é distribuído.
- Card: o treino usou áudio "permissivo/não protegido", incluindo **áudio sintético gerado por TTS fechados** de grandes provedores, e dois conjuntos CC BY (Koniwa `tnc` <1 h, CC BY 3.0; SIWIS <11 h, CC BY 4.0, com exigência de atribuição). **[N]** Não verificado se isso impõe atribuição ou risco aos áudios gerados; o card não traz consentimento de personalidade para `pf_dora`, `pm_alex`, `pm_santa`. O `VOICES.md` repete o aviso de G2P fraco para não inglês e de fraqueza em frases com menos de 10–20 tokens.
- Hardware: Intel Core i7-13620H (10 núcleos/16 lógicos; PyTorch usou 10 threads) e RTX 3050 6 GB Laptop (driver 621.24; CUDA via wheel cu126, sem instalar o toolkit nem mexer no driver).

### 6.2 Síntese isolada e rede

Um processo Python próprio por dispositivo (`synthesize.py cpu|cuda`, `python -I`) carregou o modelo uma vez e usou `KPipeline(lang_code='p')` com `speed=1.0` e a voz por caminho `.pt` local. Entrada: os três `roteiro.linhas[].narracao` do mesmo `plan.json` da prova do Piper, lido somente leitura (SHA-256 conferido: `7c906e894d9fadf1395f1b4ec8ed5acc1ed5f87ae955bb248e6d49d77cdbc73b`), mais 6 frases fictícias (`texts.json`): T1 números/data/valor/percentual; T2 siglas e nome de canal; T3 frase longa (37 palavras); T4 ênfase ("Não foi um erro. Foi uma decisão."); T5 informal; T6 primeira frase do roteiro. Cada voz sintetizou 9 textos por dispositivo (54 WAVs). Cada texto saiu em **um** chunk (42–247 fonemas; o limite do modelo é 510).

**Rede:** `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, proxies removidos e, antes de importar, uma guarda que registra e recusa `socket.connect`, `connect_ex` e `getaddrinfo`. Resultado: **zero tentativas** nas duas execuções. **Escopo:** guarda em processo Python; não é bloqueio nem auditoria de rede do SO e não vê chamadas nativas (PyTorch/CUDA/espeak). Sem firewall, ETW ou NetLog. Todos os downloads ocorreram antes.

### 6.3 Desempenho (esta execução; sem repetição estatística)

RTF = segundos de `list(pipe(texto))` (G2P + inferência + `cuda.synchronize` na GPU) ÷ duração do áudio; exclui a carga do modelo (CPU 1,12 s; GPU 1,19 s) e a gravação do WAV. Houve uma síntese de aquecimento descartada por voz antes de medir (diferente da prova do Piper, sem aquecimento).

| Voz | CPU, 3 seções: síntese / áudio / RTF | GPU, 3 seções: síntese / áudio / RTF | RTF por texto (CPU; GPU) |
|---|---|---|---|
| pf_dora | 9,362 s / 31,225 s / **0,300** | 1,146 s / 31,225 s / **0,037** | 0,295–0,412; 0,033–0,048 |
| pm_alex | 9,642 s / 31,500 s / **0,306** | 1,061 s / 31,500 s / **0,034** | 0,296–0,442; 0,033–0,050 |
| pm_santa | 11,221 s / 32,000 s / **0,351** | 1,113 s / 32,000 s / **0,035** | 0,337–0,444; 0,036–0,048 |

(Os RTFs maiores são dos textos mais curtos, p. ex. T4 com 2,2 s.) Maria: o RTF da síntese do piloto não foi medido. Para os 6 textos de teste, `System.Speech` (mesma voz SAPI `TTS_MS_PT-BR_MARIA_11.0`, 22.050 Hz/16 bits/mono) levou 0,195 s no total para 61,2 s de áudio (RTF ≈ 0,003; `Stopwatch` em volta de `Speak`, um processo, sem repetição). Ou seja, a Maria é bem mais rápida de gerar, e o Kokoro (CPU ~0,3; GPU ~0,035) é mais rápido que tempo real nos dois casos. É comparação de geração, não de qualidade. VRAM de pico **[N]** (não medida). Piper (seção 9 de `avaliacao-piper.md`): RTF 0,03–0,10 em CPU.

### 6.4 Formato, qualidade medida e comparação com a Maria

Todos os WAVs do Kokoro: PCM 16 bits, mono, **24.000 Hz** (a Maria do piloto: 22.050 Hz). Duração, pico e clipping por `pilot_quality.analyze_wav`; LUFS integrado e true peak por `av_quality._loudness` (FFmpeg n7.1 do Remotion, fallback `loudnorm`). Resultados da CPU (as sínteses na GPU têm as mesmas durações em amostras, mas **hashes diferentes**: 0 de 27 idênticos; CPU e GPU não são bit a bit iguais; ver `qc_align.json`):

| Voz/seção | Duração (s) | Síntese (s) | RTF | Pico PCM | Clipados | LUFS-I | dBTP | SHA-256 do WAV (CPU) |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| pf_dora/1 | 10.2250 | 3.0181 | 0.2952 | 0.689880 | 0 | -27.08 | -3.19 | `a85ba7f5d4ea3b6dd37b8b551f0d42efd14ca70654cbea117a321f1e0c26b7d6` |
| pf_dora/2 | 10.4750 | 3.1553 | 0.3012 | 0.574799 | 0 | -26.79 | -4.73 | `dab2bb1c5a2807afe4ed36a18cb2157d89230689221ffd4dc51b5d6cdaae542e` |
| pf_dora/3 | 10.5250 | 3.1882 | 0.3029 | 0.659210 | 0 | -26.76 | -3.62 | `908dd84ca26812164c7770d85a89313725bda842430f2fd53ceec809fbab9a86` |
| pm_alex/1 | 10.4750 | 3.0951 | 0.2955 | 0.472565 | 0 | -26.56 | -6.25 | `fcf9412b275b29bb642b69689f5ec05cb163ca28e98fc3bef62f22b090ec7aa8` |
| pm_alex/2 | 10.5750 | 3.3311 | 0.3150 | 0.509369 | 0 | -26.34 | -5.86 | `c26b8b10f1f5b367217c4d7005f8ebbfbced308c0eaddbf26cc7f67aa8bc0991` |
| pm_alex/3 | 10.4500 | 3.2159 | 0.3077 | 0.487854 | 0 | -26.46 | -6.08 | `e63c782a22dcc54545765eb0d3498e4541c2b85c9f568354b49da980fa5e0308` |
| pm_santa/1 | 10.5250 | 3.6460 | 0.3464 | 0.482422 | 0 | -26.32 | -6.33 | `227f4b4b6346e502c9bfbb543df8a95f64ef7b64630b7ed52effa2f8522b4d95` |
| pm_santa/2 | 10.8000 | 3.8210 | 0.3538 | 0.554932 | 0 | -26.07 | -5.12 | `46a64b10c7198108c24b00df6f736f64acc0a95f05e021c520e7c0c9540e6950` |
| pm_santa/3 | 10.6750 | 3.7537 | 0.3516 | 0.486511 | 0 | -26.12 | -6.15 | `074ffd5c495d4491a72de954f910d9a11a9a87729eb657e05c9f1299e073bf4b` |

Hashes dos demais WAVs (CPU e GPU): `synthesis-cpu.json` e `synthesis-cuda.json`. Nos 54 WAVs não há amostra clipada; pico PCM máximo 0,690 (a saída flutuante do modelo nunca passou de 0,69, sem normalização). Kokoro: −25,68 a −27,08 LUFS e true peak de −8,22 a −3,19 dBTP; Maria do piloto: −23,32 a −24,40 LUFS (true peak −4,49 a −6,00). O Kokoro sai ~2–3 LU mais baixo que a Maria; é só nível, não qualidade.

**Duração do mesmo roteiro (3 seções):** pf_dora 31,225 s, pm_alex 31,500 s, pm_santa 32,000 s, contra **47,913 s** da Maria (Piper: ~30–32 s). Nos 6 textos de teste a Maria soma 61,22 s e o Kokoro 39,70–40,30 s. Isso mede ritmo/andamento nas configurações padrão, **não** naturalidade nem inteligibilidade.

### 6.5 Alinhamento (indício de inteligibilidade; não é MOS)

`speech_alignment.run_alignment` (faster-whisper `small`, CPU int8, offline, pasta `%LOCALAPPDATA%\Horus\models\whisper`) sobre as três seções concatenadas por voz (sem pausas inseridas), com seções medidas pelas durações. Mesmo procedimento na Maria (`section-1..3.wav` da aprovação, cujos hashes permaneceram intactos).

| Narração | Palavras | Casadas | Interpoladas | match_rate | Maior trecho interpolado | `speech_aligned` |
|---|---:|---:|---:|---:|---:|---|
| Kokoro pf_dora | 77 | 77 | 0 | 1,000 | 0 s | sim |
| Kokoro pm_alex | 77 | 77 | 0 | 1,000 | 0 s | sim |
| Kokoro pm_santa | 77 | 77 | 0 | 1,000 | 0 s | sim |
| Maria | 77 | 77 | 0 | 1,000 | 0 s | sim |

No roteiro do piloto o Whisper reconheceu **todas** as palavras das quatro narrações, na posição certa; esse roteiro é simples, sem números nem siglas. Nos 6 textos de teste (107 palavras): pf_dora 104 casadas/3 interpoladas (0,972), pm_alex 104/3 (0,972), pm_santa 102/5 (0,953), Maria 105/2 (0,981). As interpoladas em todas as vozes, Maria incluída, são `R$`, `1.250,50,` e `3,5%`: discordância de normalização numérica entre ASR e roteiro, **não** prova de erro de pronúncia. Só **pm_santa** acrescentou duas, `a` (T1) e `PIX` (T2): possível sinal de articulação pior, mas é um ponto isolado numa execução e o ASR é tolerante. As quatro narrações receberam `alignment_below_threshold` (o validador exige mais cobertura do que os textos com números permitem). Limites: o ASR mede reconhecibilidade, **não** pronúncia correta nem naturalidade (o Whisper pode "corrigir" uma fala torta); uma só passada; WER por palavra não calculado.

### 6.6 Material de escuta cega e verificações

- `relatorios/PILOTO-LOCAL-2026-11-13/escuta-vozes/`: `audios/` com **24 WAV** (6 trechos × Maria + 3 vozes Kokoro, mesmo texto), `README.md` (protocolo), `CHAVE-RESERVADA-NAO-ABRIR.json` e `evidencias-reservadas/`. Códigos aleatórios criptográficos e ordem embaralhada por trecho.
- Todos: PCM 16 bits mono 48 kHz, sem metadados, −17 LUFS integrados (desvio medido ≤ 0,02 LU), true peak ≤ −1 dBTP (−1,43 a −2,34), zero amostras clipadas, verificados com `analyze_wav` e `_loudness`. Método: `loudnorm` de duas passagens linear (−16/−1,5) + atenuação a −17. O `loudnorm` do FFmpeg do Remotion estourou o pico nos 3 trechos T4 do Kokoro (2,2 s) e, neles, usei ganho + limitador de pico por amostra com antecipação de 5 ms (limite −1,5 dBFS; implementação própria em numpy, porque esse build não tem `alimiter`), iterado até −17 LUFS. O limitador altera levemente a dinâmica desses 3 áudios; a Maria T4 seguiu o caminho `loudnorm`. **Registrado, não escondido.**
- **Falha da prova anterior, só mitigada:** as durações **não** são comparáveis. Em cada trecho a Maria dura 1,3–1,9× mais que o Kokoro (T1 14,2 s vs 8,7; T2 7,2 vs 5,5; T3 17,8 vs 12,4; T4 4,3 vs 2,2; T5 9,6 vs 5,3; T6 8,2 vs 5,8) e, entre as três vozes Kokoro, a diferença é ≤ 0,2 s no mesmo trecho. Preferi trechos curtos, mas não distorci o áudio (esticar/comprimir mudaria a naturalidade). O README da escuta avisa explicitamente que a duração denuncia uma das versões, sem apontar qual.
- Regressão: `& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_pilot_quality.py backend/tests/test_av_quality.py backend/tests/test_speech_alignment.py -q` → **119 passed, 2 skipped** (7,42 s). Nenhum arquivo de código do repositório foi alterado; as funções existentes foram apenas importadas pelos scripts de QC, que rodaram fora do Git.

### 6.7 Conclusão técnica e pendências

- **Funciona em pt-BR no Windows, offline e por usuário**, com 3 vozes, em CPU (RTF ~0,30–0,35) e na GPU de 6 GB (RTF ~0,035); pt-BR é nativo (`lang_code='p'`), sem treino. Pesos Apache-2.0; o espeak-ng embutido é GPL (ver 6.1).
- Nada nesta prova mede naturalidade, pronúncia correta de números/siglas, ênfase ou fadiga: só a escuta decide. O ASR sugere boa reconhecibilidade em texto simples. Não há tempos por palavra nativos (exigiria o alinhador existente).
- **Pendente:** escuta humana cega (`escuta-vozes/`), parecer jurídico sobre a GPL do espeak-ng e sobre a procedência dos dados de treino (sintético de TTS fechado, CC BY), medição de VRAM, repetição estatística do RTF, e a decisão sobre integração (incremento separado, só se a escuta aprovar).

## Fontes (acessadas em 13/11/2026)

- <https://elevenlabs.io/docs/overview/models>, <https://elevenlabs.io/pricing/api>, <https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps>
- <https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices>, <https://elevenlabs.io/docs/overview/capabilities/voices>, <https://elevenlabs.io/docs/developers/resources/zero-retention-mode>, <https://elevenlabs.io/terms-of-use>
- `fabrica-canais/scripts/fabrica/elevenlabs.py` (leitura local)
- <https://github.com/SWivid/F5-TTS>, <https://huggingface.co/SWivid/F5-TTS>, <https://huggingface.co/firstpixel/F5-TTS-pt-br>, <https://huggingface.co/acidente/fala_pb_checkpoints> (busca)
- <https://huggingface.co/hexgrad/Kokoro-82M> (revisão `f3ff3571…`) e `VOICES.md`; <https://pypi.org/project/kokoro/0.9.4/>; <https://download.pytorch.org/whl/cu126/>
- <https://raw.githubusercontent.com/resemble-ai/chatterbox/master/README.md>, <https://huggingface.co/ResembleAI/chatterbox>, <https://huggingface.co/gorack/Chatterbox-TTS-Portuguese>, busca web sobre VRAM (NVIDIA model card e terceiros)
- <https://huggingface.co/coqui/XTTS-v2> e busca web sobre CPML/encerramento da Coqui
- <https://huggingface.co/fishaudio/openaudio-s1-mini>
- [avaliacao-piper.md](avaliacao-piper.md)
