# Produção técnica local — M4 / HOR-052

Implementação backend na branch M4: roteiro M3 aprovado → JobManager → worker isolado → artefatos registrados → revisão humana. A migração aditiva v5→v6 cria `productions` e `production_receipts`, usando o mecanismo existente de backup transacional. O banco operacional não foi aberto nos ensaios. A integração frontend é entregue separadamente.

## API e estados

### Exportar um pacote local aprovado

Após a aprovação humana, `POST /v1/productions/{id}/export`, autenticado e com
`Idempotency-Key`, cria um ZIP em `exports/<produção>/<exportação>/package.zip`
dentro da pasta de dados. A API não recebe caminho de destino. Retorna 201 na
criação e 200 na repetição da mesma chave; `GET /v1/productions/{id}/exports`
lista os pacotes e `GET /v1/productions/{id}/exports/{export_id}/file` baixa o ZIP
pela conexão local autenticada. As respostas incluem caminho relativo, tamanho
e SHA-256 do pacote; não há upload ou publicação.

O pacote inclui vídeo aprovado, SRT, roteiro aprovado em JSON e texto, QC,
proveniência original e efetiva com histórico das revisões humanas de licença,
revisão do roteiro e da produção. `manifest.json` contém versões do Hórus/schema
e SHA-256/tamanho de cada arquivo de conteúdo (o manifesto não inclui seu próprio
hash; o hash do ZIP cobre o pacote inteiro). QC ausente em produção antiga é
identificado como `not_run`; proveniência ausente aparece como `null`, sem
inventar licença ou medição. O pacote preserva `publishable=false`.

Produção não aprovada ou sem vídeo/legendas registrados retorna 409, assim como
adulteração, links, caminhos inseguros ou roteiro/SRT com caminho absoluto/possível
credencial. Metadados de auditoria têm esses trechos omitidos na cópia exportada,
com `metadata_redacted` no manifesto; decisões e artefatos originais não são alterados.
Os artefatos registrados são conferidos antes de exportar; apenas
os arquivos selecionados entram no ZIP, sem logs, configurações ou ambiente.
O roteiro vem do recibo de aprovação correspondente à versão produzida.

Cada chave conserva um retrato das revisões daquele momento, inclusive após
reinício. Após nova revisão de licença, use outra chave para obter um novo pacote.
Uma tentativa interrompida não é sobrescrita: preserve-a e use outra chave.
Exportar é preparar arquivos para auditoria e publicação manual, não autorização
de uso comercial nem substituição da conferência humana de QC e licenças.

### Contrato existente de produção

Todas as rotas exigem a autenticação local existente. Os POSTs abaixo exigem `Idempotency-Key` (1–128 caracteres):

| Operação | Entrada / resposta |
|---|---|
| `POST /v1/scripts/{script_id}/productions` | `{expected_version: inteiro positivo, mode: "simulated" ou "local_demo"}`; 201 na criação, 200 no replay |
| `GET /v1/scripts/{script_id}/productions` | `{items: ProductionRecord[]}` |
| `GET /v1/productions/{id}` | Snapshot da produção, com status do job |
| `GET /v1/productions/{id}/artifacts/{artifact_id}` | Somente arquivo registrado, confinado e com hash/tamanho atuais |
| `POST /v1/productions/{id}/review` | `{decision: "approve" ou "reject", artifact_sha256: SHA-256}` |

Somente o roteiro mais recente do workflow pode iniciar produção. A aprovação M3 deve existir, e documento/versão/revisão devem corresponder ao recibo persistido daquela aprovação. A criação persiste atomicamente job, versão, hash do documento, revisão, plano e recibo idempotente. A execução confere novamente essas condições. A mesma chave com outra entrada retorna conflito; replays consultam o estado atual, sem criar outro job.

A operação interna enumerada é `production.run`; ela não aceita comandos, executáveis, fornecedores ou caminhos fornecidos pelo cliente. Usa a fila única do JobManager, a trava existente por banco e `OwnedProcess`. O status é lido da tabela de jobs; `stage` é checkpoint em `jobs.result` (`prepare`, `narration`, `scenes`, `subtitles`, `render`, `review`). Não há segundo scheduler ou porcentagem estimada.

`ProductionRecord` preserva os campos do contrato e acrescenta `error`, `demo_only: true`, `real_voice: false`, `speech_aligned: false`. `succeeded` significa conclusão técnica, sem aprovação final. A revisão exige job concluído, modo local real e hash atual do vídeo registrado; mantém `demo_only`. A API nunca chama `fabrica aprovar` nem cria seus marcadores.

Cancelamento usa `POST /v1/jobs/{job_id}/cancel`. `cancel_requested` só vira `cancelled` após terminar o subprocesso e sua árvore. No reinício, jobs em execução passam a `interrupted`, preservando a etapa. Retry direto de produção retorna 409: é necessário conciliar a saída anterior e criar uma nova produção explícita com outra chave. A rotina nunca apaga ou sobrescreve o diretório de uma tentativa anterior.

## Modos e arquivos

`simulated` gera plano JSON, cenas PNG de fixture, WAV de tom local, manifesto e SRT sintético, sem MP4. Esses arquivos são demonstrações; não existe narração de voz real, alinhamento de fala, asset externo ou licença publicável. Esse modo não admite revisão final como vídeo real.

`local_demo` prepara as mesmas fixtures e tenta a composição `Short9x16` do renderer real da fábrica. Reutiliza `fabrica.modelos`, `montar_props`/`renderizar`, alinhamento e registro de insumos. O SRT por cena vem do contrato puro Hórus, é entregue separadamente e não é queimado como legenda de fala; `palavras` do alinhamento está vazio. Cenas são cores sólidas originais. O áudio é tom; não há TTS. A finalidade é verificar a cadeia técnica, não qualidade editorial.

Dados ficam em `HORUS_DATA_DIR/productions/{id}`. O `FABRICA_HOME` do subprocesso de render aponta para esse diretório isolado. Somente código, locks e dependências Remotion são copiados da raiz preparada; não são copiados perfis, canais, `.env`, credenciais ou biblioteca do operador. Não são criados links/junctions. A fábrica original permanece independente e intacta.

A resposta de arquivo resolve ID registrado, rejeita caminhos absolutos/traversal/links/junctions, verifica extensão/conteúdo básico, tamanho e SHA-256 antes de servir. Arquivos não registrados não são expostos. O renderer só libera vídeo depois de validar duração, frames decodificados, extração de frame e hash com os codecs locais. URLs `file://` não são usadas.

## Preparação separada do runtime

Nenhuma API/job/teste instala dependências, baixa browser/modelos ou atualiza ferramentas. Configure `FABRICA_HOME` para uma cópia de ferramentas preparada em sandbox, contendo:

- `scripts/fabrica`, `scripts/pyproject.toml`, `scripts/uv.lock` e `scripts/.venv`;
- `remotion/src`, `package.json`, `package-lock.json`, `tsconfig.json` e `node_modules`;
- Node/npx existentes, Edge instalado no Windows e FFmpeg/ffprobe existentes no PATH ou fornecidos pelo pacote `@remotion/compositor-*` do lock.

A preparação autorizada nesta sessão copiou somente esses fontes/locks da fábrica e executou, na sandbox:

```powershell
uv sync --project "$demoRoot/scripts" --frozen --offline
npm.cmd --prefix "$demoRoot/remotion" ci --offline --no-audit --no-fund
```

Os caches não continham Pillow 13.0.0 e zod 4.5.4; as tentativas offline falharam sem instalação completa. A preparação separada autorizada repetiu os comandos pelos mesmos locks sem `--offline`, com downloads públicos. Foram instalados 23 pacotes Python e 254 npm, incluindo Remotion 4.0.538, React 19.3.1 e seu compositor com FFmpeg/ffprobe; nenhum codec global ou browser foi instalado. Não foi executado `setup.ps1`, nem voz/alinhamento de modelo/inferência. npm informou postinstall esbuild não aprovado; o render real funcionou com os executáveis já distribuídos no lock. Não foram alteradas políticas ou permissões para isso.

Se faltar Python/fábrica/Remotion/browser/codec, o job termina `blocked`, com lista acionável. As fixtures já produzidas permanecem registradas. Falhas de render/auditoria terminam sem liberar vídeo para revisão; erros não expõem logs brutos ou segredos.

## Rede no runtime

O wrapper usa `npm_config_offline=true` e browser explícito, evitando download implícito. O worker inicia um proxy de negação em loopback/porta efêmera próprio da produção. Um preload Node limita conexões Node a loopback e acrescenta ao browser da produção proxy local de negação, bypass somente loopback, DNS externo `NOTFOUND`, QUIC desabilitado e NetLog. Nada modifica o browser/sessão do usuário, a fonte Remotion, firewall ou configuração global.

Flags e semântica foram conferidas na fonte instalada do Remotion (`open-browser.js`, `BrowserRunner.js`, `options/browser-executable.js`) e na documentação primária de [proxy Chromium](https://www.chromium.org/developers/design-documents/network-settings/), [resolução DNS](https://www.chromium.org/developers/design-documents/network-stack/socks-proxy/) e [NetLog](https://www.chromium.org/for-testers/providing-network-details/). `network-summary.json` registra somente hosts e destinos TCP, sem headers, cookies ou payloads. NetLog bruto fica local, fora do catálogo servido pela API.

No ensaio instrumentado, o browser tentou URLs de background `edge.microsoft.com` e `www.bing.com`, além dos assets em `localhost`. Nos 1.589 eventos recuperados, os únicos destinos de conexão TCP foram `127.0.0.1:3000` e `[::1]:3000`; nenhum destino TCP externo foi registrado. O proxy não recebeu requisições externas nesse intervalo. O NetLog ficou sem sufixo no encerramento do renderer (`netlog_complete: false`), e o parser preservou apenas eventos completos. Isso é evidência observada e bloqueio de rede do browser/Node dessa execução; não é auditoria integral do sistema, nem prova de ausência de todo protocolo/tráfego do computador. Preparação com downloads foi anterior e separada.

## Evidência local — 12/11/2026 (BRT)

Sandbox de ferramentas: `%TEMP%/horus-m4/backend-factory-demo`. Ensaio inicial preservado em `%TEMP%/horus-m4/backend-demo-evidence`; ensaio com guard e NetLog em `%TEMP%/horus-m4/backend-demo-guard-final`:

- roteiro M3 fictício curto semeado antes da aprovação de teste via API, em banco isolado;
- produção `b47c56ad22fc402bad801c989a8dcc9f`, `local_demo`, `succeeded`, `stage=review`, `review=null`;
- MP4 real `data/productions/{id}/canais/demo/videos/fixture/render/short-rascunho.mp4`: 96.902 bytes, 540×960, 5,300 s, 159 frames;
- SHA-256 `fcc16926bead178deb83a22d88c981ed296e6e3f50c7814778459d4528d774a4`;
- `render/validation.json`, `render/frame.png`, `render/short-rascunho.insumos.json`, `network-summary.json` e `production.json` preservados; frame visualizado e coerente com fixture de cor sólida;
- nenhuma aprovação final humana foi registrada; nenhuma publicação, upload, aviso ou chamada de provedor ocorreu.

O teste inicial do guard Node revelou que `net.connect` passa argumentos normalizados como array; o guard foi corrigido e a regressão usa um método original substituído por stub, impedindo tráfego mesmo se o bloqueio regredir. No primeiro teste negativo, a chamada alcançou o método original com o endereço de documentação `203.0.113.1:443` antes do encerramento do processo; não foi capturado tráfego dessa tentativa, portanto não se afirma ausência de saída nela. O ensaio real final foi repetido com esse guard corrigido e manteve o mesmo hash de vídeo. A matriz final também cobre porta como string no acesso direto a `Socket.connect`, corrigida para ter a mesma restrição: 20 combinações externas IPv4/IPv6 foram recusadas e 30 de loopback permitidas exclusivamente por stub, em `net.connect`, `createConnection`, `Socket.connect`, opções, porta numérica/string e forma normalizada; nenhum render foi repetido por essa matriz.

Um primeiro ensaio instrumentado foi corretamente impedido de liberar o vídeo porque o parser classificava eventos finais de TCP sem endereço como destino desconhecido. O parser foi corrigido para contar destinos apenas em eventos com endereço; há regressão cobrindo isso e destinos externos.

## Verificação e limites

```powershell
& backend/.venv/Scripts/python.exe -m pytest backend/tests/test_production.py -q
# Opcional: exercício da revisão com vídeo REAL já preparado (sem render/download):
$env:HORUS_TEST_REAL_VIDEO = '<MP4 real da sandbox>'
& backend/.venv/Scripts/python.exe -m pytest backend/tests -q
```

Suíte específica final: **14 aprovados, 1 pulado** (symlink sem privilégio), incluindo revisão com MP4 real preparado.

Testes cobrem aprovação/hash/snapshot, revalidação no início, payload estrito, concorrência/idempotência, simulado sem vídeo, dependências ausentes, cancelamento de processo filho real, logs sanitizados, reinício, confinamento/integridade, revisão por hash e guard de rede. O teste de symlink depende do privilégio local e pode ser pulado; o de revisão positiva exige `HORUS_TEST_REAL_VIDEO`, sem gerar vídeo falso. Suíte backend completa: **589 aprovados, 2 pulados, 1 aviso em 97,40 s**, com `HORUS_TEST_REAL_VIDEO` apontando para o MP4 real isolado; `git diff --check` aprovado. Os dois skips são criação de symlink indisponível nesta conta Windows, em `test_production.py` e `test_security_profile.py`. Após ampliar/corrigir a matriz final do guard, a suíte específica foi repetida: **14 aprovados, 1 pulado em 7,31 s**. O aviso é a depreciação existente de httpx no TestClient da versão instalada de Starlette. Houve falhas intermediárias no teste de codec (o FFmpeg distribuído não oferece filtros/formatos de geração genérica) e no guard Node; foram corrigidas usando MP4 real preparado e bloqueio de argumentos normalizados. Builds/frontend/UI/Avalonia não foram executados nesta tarefa; essas validações ficam fora desta entrega backend.

Limites: preparação de ferramentas e cópia de `node_modules` por produção consomem disco; não há limpeza automática nem publicação. O suporte validado é Windows/Edge, sem homologação Linux; backend frozen é bloqueado explicitamente até homologação do empacotamento deste novo worker. O backend não inclui provedores de voz, inferência, ativos externos nem autorização financeira. A integração frontend e a revisão humana efetiva do resultado seguem pendentes nesta entrega backend.
