# Avaliação comparativa de vozes pt-BR — HOR-132

Pesquisa **somente documental**, acessos em **13/11/2026**. Nada foi baixado, instalado, executado, ouvido nem enviado a serviço externo; nenhuma conta ou API paga foi usada; nenhum texto do projeto saiu do computador. Isto não é parecer jurídico nem concede licença; `publishable=false` e `demo_only=true` permanecem.

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

## Fontes (acessadas em 13/11/2026)

- <https://elevenlabs.io/docs/overview/models>, <https://elevenlabs.io/pricing/api>, <https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps>
- <https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices>, <https://elevenlabs.io/docs/overview/capabilities/voices>, <https://elevenlabs.io/docs/developers/resources/zero-retention-mode>, <https://elevenlabs.io/terms-of-use>
- `fabrica-canais/scripts/fabrica/elevenlabs.py` (leitura local)
- <https://github.com/SWivid/F5-TTS>, <https://huggingface.co/SWivid/F5-TTS>, <https://huggingface.co/firstpixel/F5-TTS-pt-br>, <https://huggingface.co/acidente/fala_pb_checkpoints> (busca)
- <https://huggingface.co/hexgrad/Kokoro-82M> e `VOICES.md`
- <https://raw.githubusercontent.com/resemble-ai/chatterbox/master/README.md>, <https://huggingface.co/ResembleAI/chatterbox>, <https://huggingface.co/gorack/Chatterbox-TTS-Portuguese>, busca web sobre VRAM (NVIDIA model card e terceiros)
- <https://huggingface.co/coqui/XTTS-v2> e busca web sobre CPML/encerramento da Coqui
- <https://huggingface.co/fishaudio/openaudio-s1-mini>
- [avaliacao-piper.md](avaliacao-piper.md)
