# Provedores de narração (HOR-132 / HOR-053)

Implementado em 13/11/2026: registro extensível `NarrationProvider` com status,
vozes, estimativa, prévia e síntese. Não depende do Hermes. A produção
`local_pilot` usa o provedor e a voz do pedido ou a preferência salva.

## Seleção na produção

`POST /v1/scripts/{id}/productions` aceita o campo opcional
`narration: {provider, voice_id}`, somente em `local_pilot`. A precedência é:
pedido explícito, `narration-preference.json` e primeira voz Windows SAPI pt-BR
instalada (o padrão anterior). Preferência existente inválida bloqueia o pedido;
voz/provedor indisponível bloqueia a produção com motivo, sem troca silenciosa.

O recibo canônico inclui a escolha efetiva: reutilizar a chave com outra voz,
provedor ou preferência efetiva retorna 409. A escolha fica em `plan.audio.provider`
e `plan.audio.voice_id`, sem migração de banco. Alterações posteriores dos Ajustes
não mudam o plano enfileirado. Recibos antigos sem seleção continuam recuperáveis
pelo pedido padrão sem preferência; planos antigos mantêm o helper SAPI anterior.

O worker chama `NarrationProvider.synthesize` uma vez por seção em um processo
possuído, com timeout global de síntese de 1200 s e encerramento da árvore por
cancelamento/timeout. Cada comando local do adaptador tem limite de 60 s.
SAPI reutiliza o helper COM existente; Piper usa seu executável separado. As cenas
continuam no helper Windows. Não há download, Hermes ou troca de renderer.

Seções WAV e WAV combinado registram engine, voz, identificador e origem:
`system_voice` para SAPI, `local_tts_model` para Piper. Modelos locais exigem
identificador, versão de conteúdo (`sha256:<hash>`) e SHA-256 dos pesos, conferido
antes/depois da síntese e entre seções. O manifesto de evidências guarda a
estrutura; `asset-provenance.json` mantém o mesmo conteúdo em `notes`, sem alterar
seu contrato. Licenças permanecem `unverified`, sem atribuição de direitos automática.

O QC aceita somente motores locais registrados, com origem e identidade coerentes;
campos inesperados, modelo sem hash ou Piper declarado `system_voice` reprovam.
Timestamps/flags do provedor não concedem `speech_aligned`: Whisper mede o WAV
combinado, seguido das mesmas legendas, QC e revisão humana. A disclosure existente
passa a citar engine e nome da voz efetivos; a interface não foi alterada.

Produção paga permanece **blocked**, inclusive com credencial e flag habilitadas:
o pedido não aceita autorização e o worker bloqueia antes de consultar credenciais
ou transmitir texto. A autorização interna preparada no adaptador continua vinculada
ao hash do texto, voz e custo estimado; habilitar uma autorização por produção
exigirá o fluxo humano referente ao roteiro integral e ao custo estimado integral.

## API local autenticada

Todas as rotas exigem o mesmo Bearer token local das demais rotas.

- `GET /v1/narration/providers`: registro, disponibilidade e licenças.
- `POST /v1/narration/estimate`: `{provider, voice_id, model_id?, text? , script_id?, script_version?}`.
  Exatamente uma fonte: texto ou roteiro aprovado com versão. Roteiro passa pela
  mesma verificação de aprovação, versão mais recente e integridade usada na produção.
  Caracteres são `len(texto)` (pontos Unicode); seções do roteiro são unidas com uma quebra de linha.
- `POST /v1/narration/preview`: `{provider, voice_id, text?}`. Texto de 1 a 300
  caracteres; ausência usa frase fictícia fixa. Retorna `{id,url,expires_in_seconds}`.
- `GET /v1/narration/previews/{id}`: WAV autenticado, uso único, apagado após envio,
  após cinco minutos sem consumo ou no encerramento normal da API. Diretório temporário
  privado ao pedido; não recebe caminho do cliente. Encerramento abrupto do SO pode
  deixar temporários para a limpeza do sistema.
- `PUT /v1/narration/providers/elevenlabs/credential`: `{key: "..."}`; retorna apenas
  `{configured:true}`. `DELETE` remove e retorna `{configured:false}`.
- `GET/PUT /v1/narration/preference`: `{provider,voice_id}` em
  `narration-preference.json` no workspace; gravação atômica, sem migração.
  PUT exige provedor e voz existentes no registro local. Sem preferência retorna valores nulos.

A credencial fica no cofre do SO por `keyring` (Windows Credential Manager no
Windows), isolada por caminho de workspace. Não há fallback para arquivo nem
criptografia própria. Backend indisponível produz erro genérico. Gravar chave não
habilita chamadas pagas. A dependência é de runtime porque as rotas de credencial
fazem parte da API padrão; versões, fontes e hashes estão em `backend/uv.lock`.

## Motores locais

**Windows SAPI:** enumera vozes instaladas e sintetiza em processo Python separado,
reutilizando o wrapper COM de `local_pilot_windows.py`. Cada voz
mantém licença comercial `unknown`: disponibilidade no Windows não comprova direitos.
O processo recebe texto por stdin JSON, como BSTR literal, sem interpretar SSML.

**Piper:** configurar `HORUS_PIPER_EXECUTABLE` (binário ou entrypoint `piper` do venv)
e `HORUS_PIPER_MODELS` (pasta local de arquivos `.onnx` acompanhados de `.onnx.json`).
Sem instalação/configuração utilizável: `not_installed`. Não há downloads.
O executável roda separado, preservando a fronteira GPL. Licenças e idiomas dos
modelos ainda exigem verificação (`unknown` / `und`); não se infere licença comercial.

## ElevenLabs e segurança de gastos

Não existe transporte HTTP real neste incremento. O transporte é injetável para
ensaios controlados; os testes usam mocks com guarda contra conexões de rede.
Descoberta e estimativa não consultam assinatura, vozes ou créditos na rede.
Licença é `unknown`; créditos são `not_checked` na estimativa e `mock` nos ensaios.

Preço somente de `HORUS_ELEVENLABS_PRICE_PER_1K_CHARS` (decimal positivo) junto com
`HORUS_ELEVENLABS_CURRENCY` (código de três letras); ausente/inválido retorna
`amount:null`, `currency:null`, `source:unknown`. Não é medição de cobrança.
O parâmetro model_id é reservado e não seleciona preço por modelo neste incremento.

A síntese paga interna exige simultaneamente credencial, flag explícita do operador
`HORUS_NARRATION_PAID_ENABLED=1` e autorização por pedido vinculada ao hash do texto,
voz e custo estimado exibido/confirmado. Não há rota para conceder essa autorização;
prévia paga na API sempre retorna `403 {code:paid_provider_not_authorized}`.
Mesmo com todas as condições, sem transporte injetado nenhuma chamada acontece.

Decisão do Maestro: a futura habilitação real depende de autorização do usuário e
usará adaptador por subprocesso da fábrica para reaproveitar `licenca_detalhada`,
sem duplicar regras de plano. A chave virá do cofre somente no ambiente do processo;
a saída deverá ser sanitizada, sem corpo remoto bruto ou credenciais. Não foi
implementado esse adaptador, o fluxo humano de autorização nem o registro financeiro
por geração (HOR-073).

Nenhum provedor declara alinhamento acústico. `speech_aligned=false`,
`publishable=false` e `demo_only=true` permanecem; timestamps nativos são somente
capacidade declarada e não substituem Whisper, QC ou revisão humana.

## Verificação

`& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_narration.py -q`

Inclui cofre em memória, credenciais sem eco em respostas/validação/logs, erros
sanitizados, combinações dos três gates, erros mock 401/cota/timeout, estimativa,
preferência e ciclo de vida da prévia. SAPI real é condicional ao Windows e às vozes
instaladas; não há teste de Piper real sem instalação configurada nem serviço pago.
