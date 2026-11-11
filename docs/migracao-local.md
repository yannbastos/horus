# Migração local — primeira prova de conceito

> **Leitura por incremento — 2026-11-11:** este guia preserva procedimentos e a cronologia da migração. O estado consolidado e as pendências atuais estão em [ROADMAP](ROADMAP.md); stack e critérios em [ARCHITECTURE](ARCHITECTURE.md). Tamanhos, pendências e autorizações de seções anteriores pertencem ao incremento descrito, não são permissões permanentes ou resultados de toda a plataforma. A afirmação inicial de que o build não empacota Whisper foi superada pelo empacotamento de faster-whisper documentado na seção Transcrição; a entrada atual abre Visão geral em App.tsx, não Produção. O texto do antigo botão Avalonia é histórico; seu comando nativo permanece preservado.

**Validação posterior em 2026-11-10:** render real pelo backend, cancelamento da árvore Node/Chrome, preservação dos estados e seleção/reprodução de MP4 no desktop foram exercitados. Consulte [resultados, comandos e limites](validacao-local-2026-11-10.md). As pendências históricas abaixo devem ser lidas com essa atualização; instalação NSIS e equivalência completa da transcrição continuam pendentes.

Implementação iniciada após autorização do usuário em 2026-11-10. O Avalonia não foi removido e continua utilizável até a equivalência ser aceita. A ferramenta de Transcrição foi portada para React + backend (ver seção própria); o atalho para abrir o Avalonia saiu da tela, mas o comando nativo `open_legacy` continua no Tauri.

O posicionamento vigente é exclusivamente audiovisual. A interface e o catálogo visual usam mídia, roteiros, produção, canais e resultados como domínio; a entrada principal abre Produção. A antiga área Memória aparece como Histórico operacional, voltada a execuções e revisões. Telas e dados de demonstração da proposta anterior foram removidos do Avalonia. Documentos e capturas atuais refletem essa direção. A pré-release `v0.1.0-alpha.1` foi gerada antes desta revisão e não recebe alterações automaticamente.

## Estrutura e responsabilidades

```text
frontend/src/                 Interface React/TypeScript, temas e player
frontend/src/platform/        Diálogos e comandos exclusivos do desktop
frontend/src/services/        Cliente HTTP e eventos de tarefas
frontend/src-tauri/           Shell Tauri 2 e integração nativa mínima
frontend/scripts/             Empacotamento do backend
frontend/tests/               Verificações da interface no Edge
backend/src/horus_backend/    API, SQLite e executor sequencial
backend/tests/                Segurança, estados, processos e persistência
backend/smoke.py              Integração real e medição isolada do backend
src/Horus/                   Desktop Avalonia preservado
```

Fluxo: React → API FastAPI → fila SQLite → CLI `fabrica` existente. O frontend não executa comandos arbitrários nem contém regras da produção. Há uma tarefa técnica por vez. O backend funciona sem Tauri. O Hermes possui [diagnóstico de conexão autenticada](integracao-hermes.md); sua execução de agentes, Radar, análise editorial, aprovações de roteiro e publicação ainda não estão integrados nesta prova.

Operações expostas: consulta de perfil em JSON, render de rascunho `short`, transcrição local (`transcription.run`) e download de vídeo do YouTube (`youtube.download`). Render exige projeto já preparado na fábrica; não gera roteiro, voz ou assets. Um render bem-sucedido não equivale a aprovação editorial, liberação de licenças ou conteúdo pronto para publicar.

## Preparação e execução

Pré-requisitos de desenvolvimento web: Node compatível com Vite 8, uv e Python 3.12. Dependências são isoladas e fixadas por `frontend/package-lock.json` e `backend/uv.lock`.

Na raiz do Hórus:

```powershell
uv sync --project backend --frozen --extra test --extra bundle --extra measure --extra transcription
npm ci --prefix frontend --ignore-scripts --userconfig frontend/.npmrc
```

Prepare a fábrica independentemente, sem os extras de voz para esta consulta:

```powershell
uv sync --project CAMINHO_DA_FABRICA/scripts --frozen --no-default-groups
$env:FABRICA_HOME = 'CAMINHO_DA_FABRICA'
```

A descoberta automática procura um repositório irmão chamado `fabrica-canais`; fora dessa organização, configure `FABRICA_HOME`. A integração prefere o Python de `scripts/.venv` da fábrica. Não copia nem modifica seu código ou `perfil.yaml`.

Para testar pelo navegador, inicie o backend em um terminal:

```powershell
$env:HORUS_API_TOKEN = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
& backend/.venv/Scripts/python.exe -m horus_backend --port 8765
```

Em outro terminal, `npm --prefix frontend run dev`. Abra `http://127.0.0.1:1420`, entre em Ajustes e conecte o backend com o token gerado no primeiro terminal. O token não deve ser versionado. No navegador ele permanece na memória da sessão. A Biblioteca também abre mídia local via seletor do navegador, sem upload; registro persistente por caminho e seleção de pastas pertencem ao desktop.

O desktop requer Rust stable, MSVC Build Tools com C++/Windows SDK e WebView2 no Windows. A instalação desse toolchain não faz parte da preparação web. Quando disponíveis:

```powershell
npm --prefix frontend run desktop:dev
npm --prefix frontend run desktop:build
```

O build empacota Python em diretório próprio via PyInstaller antes de gerar o instalador NSIS. Com os extras preparados, inclui as bibliotecas faster-whisper/CTranslate2/PyAV/yt-dlp; não inclui os modelos Whisper, fábrica, Hermes, executáveis FFmpeg/Node ou Remotion. Linux exige dependências Tauri da distribuição e validação específica; o instalador configurado inicialmente é Windows.

## Transcrição

Porte da ferramenta Avalonia, com as mesmas regras: fila de até 20 arquivos, um por vez; o primeiro da fila é o atual; ao concluir, só é possível avançar depois de salvar a versão atual do texto, e qualquer edição exige salvar novamente. Cancelamento e falha preservam o texto parcial; Transcrever tenta novamente o mesmo arquivo, acrescentando ao texto existente. Modelos (tiny, base, small, medium, large-v3-turbo) e idiomas (automático, pt, en, es) equivalem aos do Avalonia. A tela fica montada após a primeira visita, preservando fila e texto ao trocar de tela.

- Motor: `faster-whisper` (CTranslate2) no extra opcional `transcription`, executado em subprocesso pela fila de tarefas (`horus-backend transcribe`). A API não importa Whisper. Decodifica áudio com PyAV, sem exigir outro FFmpeg para transcrever. `HORUS_WHISPER_DEVICE` aceita `auto` (padrão), `cpu` e `cuda`; a política de fallback está descrita abaixo. CPU usa int8.
- Modelos são baixados do Hugging Face no primeiro uso para `HORUS_DATA_DIR/models`. Não são os mesmos arquivos ggml do Avalonia (`%LOCALAPPDATA%/Horus/models`); o primeiro uso baixa novamente.
- `av` fixado em `<14.3`: PyAV 15+ removeu um argumento usado pelo faster-whisper 1.2, e 14.3/14.4 não publicam wheel Windows.
- Download do YouTube: mesmos argumentos e validação de URL do Avalonia (vídeo único, HTTPS, sem credenciais), via módulo `yt_dlp` do extra ou `yt-dlp` no PATH. Com FFmpeg no PATH, baixa vídeo+áudio separados e mescla em MP4; sem ele, usa o melhor MP4 único.
- Salvar: no desktop, diálogo nativo (`dialog:allow-save`) e gravação atômica pelo backend (`POST /v1/transcriptions/save`, somente `.txt` em pasta existente). No navegador, baixa o `.txt` pelo próprio navegador. Copiar usa a área de transferência do WebView.
- Arrastar e soltar funciona somente no desktop (evento nativo do Tauri, que fornece caminhos). No navegador, informe o caminho local do arquivo e a pasta de destino do download.
- `GET /v1/transcription` informa somente a presença do motor, do downloader e do FFmpeg.

Verificado em 2026-11-10: testes do backend com subprocesso simulado (streaming de trechos, cancelamento com texto parcial, falha com motivo, download, salvamento e regra de URL); teste de interface com backend simulado (fila, salvar antes de avançar, edição após salvar, preservação entre telas, validação de URL); e uma transcrição real pela interface no navegador, com backend real e modelo `tiny` em CPU, de um WAV gerado por síntese de voz (~2 s após o modelo baixado). Com idioma automático, o `tiny` identificou incorretamente o idioma da voz sintética; com `en`, o texto saiu correto.

O empacotamento PyInstaller inclui `faster_whisper`, `ctranslate2`, `av`, `tokenizers` e `yt_dlp`; o backend empacotado (277 MB; instalador NSIS 80 MiB) transcreveu o mesmo WAV pelo subcomando `transcribe`.

Não verificado: download real do YouTube, GPU/CUDA, modelos maiores, áudio longo, arquivos de vídeo, diálogos e arrastar no Tauri, e a instalação do NSIS. Rede corporativa com inspeção TLS pode bloquear o download dos modelos.

### Paridade funcional e dependências — etapas 1 e 2

O mesmo JobManager continua responsável por transcrição/download e workflows. A fila React mantém FIFO e limite de 20 inclusive o atual. Atualizações consecutivas do evento nativo de drop usam uma referência sincronizada da fila, evitando que um segundo drop sobrescreva o primeiro antes do próximo render. O seletor reserva o estado ocupado enquanto seu diálogo está aberto. Navegação preserva a tela; drops em outra área ou durante processamento são ignorados. Novos controles visuais ou mudanças de tokens/layout não foram introduzidos.

Testes de paridade exercitam o adaptador Tauri real com seu IPC simulado: seleção múltipla, drops consecutivos, limite/rejeição, texto não salvo, preservação entre telas, salvamento cancelado, erro no diálogo, permissão negada, edição que volta a bloquear Próximo, FIFO após salvar, resultado vazio de silêncio, copiar/erro de clipboard, erro do seletor e download atrás do arquivo atual. Backend também verifica `.txt` vazio e que cancelamento vence mesmo quando o subprocesso retorna sucesso. Esses testes não certificam os diálogos do Windows ou decodificação real de silêncio pelo Whisper.

`dependencies.py` centraliza descoberta leve, sem executar programas nem importar motores nativos na API. O diagnóstico em Ajustes informa presença de faster-whisper, CTranslate2, PyAV e yt-dlp; disponibilidade de FFmpeg, ffprobe, Node e downloader; e validade do modo CPU/CUDA configurado. A rota de capacidades usa as mesmas regras. Presença não valida versão, driver ou capacidade da GPU. A inspeção de GPU só ocorre no subprocesso quando uma transcrição é solicitada.

Ordem de descoberta de executáveis:

1. Variável específica do operador: `HORUS_FFMPEG`, `HORUS_FFPROBE`, `HORUS_NODE` ou `HORUS_YTDLP`, contendo caminho do arquivo. Se inválida, não escolhe outro binário silenciosamente.
2. Diretório configurado em `HORUS_TOOLS_DIR`.
3. Subpasta `tools/` ao lado do backend empacotado, se houver provisionamento pelo operador.
4. PATH do backend.

Não depende das pastas do Avalonia nem copia ferramentas da instalação antiga. yt-dlp Python tem preferência; um executável separado é alternativa quando o módulo não existe. Node/FFmpeg descobertos são passados por argumentos separados, sem shell. FFmpeg é opcional para transcrição via PyAV, mas permite mesclar os streams do download. Não são instalados automaticamente executáveis, modelos, drivers ou DLLs.

Política de dispositivo:

- `cpu`: usa CPU int8 e não consulta dispositivos CUDA.
- `auto`/`cuda`: consulta CTranslate2; GPU ausente ou erro na consulta seleciona CPU com aviso. Uma configuração diferente de auto/cpu/cuda falha com mensagem acionável.
- Falha reconhecida CUDA/cuDNN/cuBLAS, driver, DLL ou memória durante carga/início da inferência: faz no máximo uma alternativa CPU, dentro do mesmo job e antes de emitir texto. Erros de mídia/modelo/rede sem relação com GPU não acionam fallback.
- Após qualquer trecho de texto, falha GPU encerra com parcial preservado e instrução de nova tentativa explícita em CPU. Não reinicia o áudio automaticamente para evitar duplicação de segmentos.
- Status informa carga e execução em CPU/int8 ou CUDA/float16; a tela inclui o dispositivo na conclusão quando ele foi recebido ao vivo. O log persistido registra a mudança de dispositivo. Modelos continuam carregados somente no subprocesso da tarefa.

Limites: falhas nativas que abortam o processo sem lançar exceção Python não permitem fallback interno; permanecem falhas recuperáveis do job com checkpoints já confirmados. CUDA/cuDNN reais, qualidade de modelos, download externo e decodificação de formatos dependem de ensaios específicos. O fallback simulado não equivale à homologação de hardware.

Validação das etapas 1/2 em 2026-11-11: **125 testes backend aprovados em 72,37 s**, incluindo os 101 anteriores e 24 casos novos; **29 testes Playwright aprovados em 50,8 s**, incluindo os 23 anteriores e seis casos agrupados de paridade; build TypeScript/Vite e `git diff --check` aprovados. Primeiro ensaio dos testes novos de interface precisou de esperas pelo término do diálogo/salvamento; a suíte completa passou após corrigir essas esperas. O backend recebeu nova execução completa depois de incluir o cancelamento com retorno de sucesso. Nenhum modelo, driver, ferramenta ou vídeo externo foi baixado; executores, dados e IPC desktop são simulados e os bancos/diretórios são temporários. Não houve build/instalação NSIS, inferência real, alteração do banco operacional, Avalonia, Hermes ou fábrica, commit ou push.

## Segurança, estado e recuperação

### Recuperação da transcrição — Fase 1

Transcrição mantém o mesmo JobManager e SQLite, sem migração adicional de schema. Cada segmento recebido é gravado integralmente em `jobs.result` (`text`, `partial`, `sequence`) na mesma transação do evento; a retenção de 2.000 logs não elimina esse checkpoint. Encerramento normal, timeout ou recuperação de um job em execução preserva o resultado já confirmado. Isso não recupera áudio ainda não processado nem segmentos que não chegaram ao backend. Retry direto de `transcription.run` por `/v1/jobs/{id}/retry` retorna 409 sem modificar resultado/tentativa; uma nova transcrição exige ação explícita na tela e cria outro job, preservando o anterior. Operações da fábrica mantêm seu contrato de retry.

A tela oferece **Tarefas recuperáveis**, com transcrições e downloads filtrados no backend antes da paginação: `GET /v1/transcription/jobs?offset=0`, até 100 por página. Abrir um item consulta e acompanha o job original; não executa novamente tarefas interrompidas ou downloads concluídos. Resultado interrompido pode ser revisado/salvo; uma nova transcrição continua exigindo ação explícita. Texto atual não salvo bloqueia abrir outro item.

O recibo de submissão (payload, chave de idempotência, ID quando conhecido e identidade da base) permanece no `localStorage` do frontend, sem token. Ele não é uma fila nem fonte oficial de estados. É salvo antes do POST; se a resposta se perder, **Retomar acompanhamento** repete o pedido com a mesma chave, recuperando o mesmo job na mesma base verificada. Com ID conhecido, usa somente GET. Reabrir não envia POST automaticamente. Se o pedido original nunca chegou ao servidor, a retomada explícita sem ID pode criar esse primeiro job local de transcrição/download.

O texto anterior não fica repetido dentro dos metadados: é armazenado uma vez em chave própria e referenciado pelo recibo. Atualizar ID/identidade não regrava o texto. A leitura reconhece o formato inline antigo sem apagá-lo; recibos carregados sem identidade da base exigem revisão/descarte explícito e recuperação pelo histórico, pois não é seguro adivinhar a base original. Falhas de leitura/escrita/remoção, inclusive cota, aparecem como **armazenamento local**, não conexão. Nenhum POST é enviado antes de persistir o recibo. Se a gravação do ID falhar após o POST, a chave anterior continua persistida e o ID fica em memória para reanexação.

`GET /health` informa `database_id`, impressão SHA-256 do caminho resolvido e identidade física do arquivo SQLite, sem novo schema ou escrita adicional no banco. Trocar/recriar/restaurar o arquivo pode mudar essa identidade; não é um identificador portátil de backup. O frontend verifica base, ID e payload antes de acompanhar/cancelar. Respostas 404/409, divergência, JSON inválido ou ausência do texto referenciado mantêm o recibo e oferecem **Descartar recibo inválido**, com confirmação. O descarte não cancela jobs nem apaga o SQLite; o texto anterior disponível é preservado na área de edição. Corrigir a conexão e recuperar o mesmo recibo válido também remove o bloqueio. Antes de nova submissão, conferir o histórico da base correta.

Conexões de controle têm timeout de 15 s. O NDJSON envia `{"kind":"keepalive"}` aproximadamente a cada 10 s de silêncio: é transporte, sem sequence, persistência, progresso ou efeito nos eventos oficiais. O frontend não o repassa aos callbacks de domínio nem avança o cursor. Frames válidos renovam o watchdog de 30 s e zeram o contador de falhas; tráfego inválido não renova esses limites. Até três falhas consecutivas reconectam ao mesmo ID/cursor, sem POST; eventos repetidos são ignorados. Ao esgotar o limite, consulta o snapshot e mantém nova submissão bloqueada enquanto o resultado continuar desconhecido. No desktop, **Ajustes → Reconectar backend** obtém novamente a conexão Tauri e pode relançar o backend se o processo anterior encerrou; não exige token manual.

Limites: recibos pertencem ao perfil/origem do WebView/navegador; não são transportados entre máquinas. Histórico continua recuperável no SQLite mesmo sem o recibo. A fila de arquivos ainda não submetidos e edições locais não salvas não foram transformadas em workspace persistente. Limpar o armazenamento do frontend remove o recibo de uma resposta desconhecida; não se deve reenviar como nova tarefa antes de conferir o histórico do banco correto. Resultados anteriores a esta correção não ganham retroativamente segmentos que já foram perdidos. Recuperação exige acesso ao mesmo banco; não troque `HORUS_DATA_DIR` para retomar uma tarefa.

Validação desta fase usa somente bancos temporários, subprocessos simulados e API/adaptador desktop simulados nos testes de interface. A instalação NSIS, falha abrupta do Windows com Whisper real, GPU e diálogos nativos continuam pendentes. O aplicativo não foi iniciado contra o banco operacional para validar esta fase; abrir uma instalação antiga com o backend atual ainda aplica a migração v1→v2 descrita no guia de workflows, portanto requer autorização específica antes do ensaio operacional.

Validação inicial em 2026-11-11: suíte backend com **94 testes aprovados** (89 anteriores e cinco novos), suíte Playwright com **10 testes aprovados** (cinco anteriores e cinco novos) e build TypeScript/Vite aprovado. Testes exercitam encerramento com parcial, recuperação idempotente, retenção de logs, histórico filtrado/paginado, rollback atômico, cursor de nova tentativa, resposta perdida com mesma chave após reload, recuperação pelo histórico, recusa 422 e reconexão desktop simulada. Os 22 testes do núcleo editorial continuam na suíte completa; isso não comprova operação nativa de Whisper/NSIS.

Revisão final: teste backend de tarefa simulada com **35 segundos reais sem eventos de negócio**, keepalive não persistido e reconexão por cursor. Teste frontend com **45 segundos virtuais** sem progresso e sem nova submissão; falhas separadas por frames válidos renovam o orçamento. Regressões abrangem recibos 404/409, payload/ID/base divergentes, JSON inválido, referência de texto ausente, recibo antigo sem base, confirmação de descarte, cota antes/depois do POST, texto anterior armazenado uma vez, retry bloqueado e timeout com parcial.

Resultado final desta revisão: **101 testes backend e 23 testes Playwright aprovados**, além de TypeScript/Vite e `git diff --check`. A suíte backend levou 71,08 s, incluindo a espera real de 35 s do teste silencioso. O runner Playwright encerrou com código zero após finalizar somente seu servidor Vite, cujo shutdown voltou a ficar preso. Nenhum teste abriu o banco operacional; leitura independente do cabeçalho confirmou versão 1 sem WAL. `contracts/hermes/` foi preservado por comparação de hashes; sem commit/push.

#### Custo dos checkpoints — medição, sem otimização

O checkpoint atual lê, concatena e serializa o texto integral a cada segmento, além de abrir conexão/transação, gravar evento e aplicar a retenção. Com segmentos de tamanho fixo, o volume de texto reprocessado cresce aproximadamente com N². Esse custo permanece intencionalmente sem refatoração nesta revisão.

Medição reproduzível, sem Whisper/rede e sem aceitar caminho de banco existente; cria e remove apenas seu próprio diretório temporário:

```powershell
& backend/.venv/Scripts/python.exe backend/measure_checkpoints.py --segments 500 2000 --characters 120
```

Ensaio desta sessão (Windows, SQLite 3.53.1; executado junto às suítes, não um benchmark isolado):

| Segmentos de 120 caracteres | Tempo total | CPU | Mediana por evento | p95 | Texto final | Texto regravado aproximado |
|---|---|---|---|---|---|---|
| 200 | 1,178 s | 0,906 s | 5,752 ms | 7,103 ms | 24.200 bytes | 2.432.100 bytes |
| 1.000 | 9,118 s | 6,906 s | 8,345 ms | 15,299 ms | 121.000 bytes | 60.560.500 bytes |

O volume aproximado não representa escrita física do disco e não inclui overhead JSON/SQLite. O script verifica preservação integral e recuperação; suporta até 20.000 segmentos por caso. Comparar repetições isoladas com tamanho/duração representativos antes de escolher qualquer otimização; os resultados não medem throughput real de Whisper nem UI nativa.

Em uma repetição do Playwright, os dez casos terminaram com sucesso, mas o encerramento do servidor Vite de teste ficou preso. Somente o processo Vite identificado pela própria execução foi encerrado; o runner concluiu com código zero. Não foi encerrado o aplicativo/backend operacional. A configuração npm existente também emite aviso de `always-auth`; nenhuma configuração global foi alterada.

Em Ajustes, com o backend conectado, o diagnóstico local consulta `GET /v1/diagnostics` e mostra a presença do comando da fábrica, FFmpeg, ffprobe, Node e Hermes. A consulta não executa ferramentas, expõe caminhos ou credenciais, instala dependências nem verifica versões. Presença não certifica renderização, licenças ou integração Hermes. A atualização é manual, sem consulta periódica em repouso.

- API vinculada somente a `127.0.0.1`, com token aleatório e origens permitidas. O desktop escolhe porta livre e transmite as credenciais em memória.
- SQLite armazena tarefas, eventos e referências de mídia. `HORUS_DATA_DIR` permite escolher uma pasta no SSD; o padrão do backend independente é `%LOCALAPPDATA%/Horus/workspace`. O desktop usa seu diretório local pelo identificador Tauri. Para compartilhar dados entre os dois modos, configure o mesmo diretório e não execute dois backends simultaneamente sobre ele.
- Tarefas aguardando execução sobrevivem ao reinício. As que estavam executando passam a interrompidas e exigem nova tentativa explícita. Chaves de idempotência protegem contra submissão duplicada.
- Cancelamento encerra os processos pertencentes à tarefa; no Windows são usados Job Objects. O encerramento desktop solicita saída ao backend e possui fallback. EOF no canal de controle também encerra o backend gerenciado.
- Logs por tarefa são limitados; o frontend mantém os 500 eventos mais recentes. Não há percentual de progresso inventado.
- Mídias precisam ser registradas; reprodução utiliza URL assinada temporária e suporte HTTP Range. O servidor não disponibiliza uma pasta inteira. Codecs dependem do navegador/WebView2. URLs expiram em uma hora; reabra a Biblioteca para renová-las.
- `HORUS_PYTHON` permite selecionar o Python de desenvolvimento. `HORUS_LEGACY_APP` permite indicar o executável Avalonia no botão de transcrição; sem ele, tenta o build Debug existente. O instalador novo não inclui o desktop antigo.

## Design e validação

O React reutiliza os tokens do Storybook, Archivo Expanded, Inter, Geist Mono, cores, navegação lateral de 216 px, janela de referência 1320×840 e mínimo 1040×680. Mantém temas claro/escuro/sistema, cantos retos e o símbolo orbital. Não houve redesign autorizado. Capturas geradas pelos testes ficam em `frontend/test-results/` e devem ser comparadas com as referências Avalonia em `docs/previews/`.

```powershell
npm --prefix frontend run build
npm --prefix frontend test
& backend/.venv/Scripts/python.exe -m pytest backend/tests -q
& backend/.venv/Scripts/python.exe backend/smoke.py
node frontend/scripts/bundle-backend.mjs
& backend/.venv/Scripts/python.exe backend/smoke.py --packaged
```

Os testes de interface usam Edge instalado, sem baixar outro navegador. Os testes do backend usam um CLI simulado para exercitar falhas e cancelamento; `smoke.py` exige a fábrica real e consulta `canal01`, verifica persistência após reiniciar e encerramento por EOF. A medição desse script cobre apenas o backend e seus filhos, não o aplicativo desktop inteiro.

### Primeira validação nativa — Windows, 2026-11-10

- Rust/Cargo 1.99.1, alvo `stable-x86_64-pc-windows-msvc`, Build Tools 2022 com C++ e Windows SDK; WebView2 já presente.
- `npm --prefix frontend run desktop:build` passou e gerou `frontend/src-tauri/target/release/horus-desktop.exe` e o instalador NSIS `bundle/nsis/HORUS_0.1.0_x64-setup.exe` (15,41 MiB). O instalador foi gerado, mas sua instalação ainda não foi testada.
- Corrigida a feature `Win32_System_Threading` do `windows-sys`, necessária à estrutura de limites dos Job Objects. `Cargo.lock` registra as versões resolvidas para o aplicativo.
- Executável release aberto com interface React carregada e indicação de backend conectado. Backend Python empacotado iniciou automaticamente, com escuta em `127.0.0.1` e porta dinâmica.
- Consulta de `canal01` acionada na tela Canais concluiu pelo CLI real e exibiu logs e resultado. O perfil ainda aponta campos editoriais não definidos e documentos ausentes; esta consulta não valida prontidão para produzir/publicar.
- Fechamento normal da janela encerrou o aplicativo e o backend observado; uma nova abertura reconectou automaticamente. Cancelamento de uma árvore de render real continua pendente.

O executável de desenvolvimento fica acompanhado de `backend/` no diretório release; não distribua somente o `.exe`. Os artefatos de build permanecem ignorados pelo Git. O instalador ainda não é uma release publicada.

### Validação nativa da transcrição — Windows, 2026-11-11

Build release da árvore de trabalho sobre `067aba0` (alterações ainda sem commit): `horus-desktop.exe` SHA-256 `7e54fd376d05ed1f…`, backend empacotado `bf1589830b421b31…`, instalador NSIS `330440576f99930d…` (80,09 MiB). Executado com `HORUS_DATA_DIR` e `WEBVIEW2_USER_DATA_FOLDER` em pasta descartável; o banco e o perfil WebView2 operacionais não foram abertos para escrita (hash, horários e `user_version=1` conferidos antes e depois). Modelo `tiny` baixado somente para a pasta isolada. Mídia: fala sintética do Windows convertida localmente com PyAV.

A interface foi conduzida no aplicativo real por Playwright conectado ao WebView2 via CDP em loopback (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`), sem IPC ou backend simulados. Diálogos do Windows foram preenchidos por mensagens Win32: o diálogo moderno de salvar ignora `WM_SETTEXT`/UI Automation e exige digitação por `WM_CHAR`.

| Verificação nativa | Resultado |
|---|---|
| Inicialização com backend empacotado | Conectado automaticamente; mediana de 1,08 s até o backend escutar (5 aberturas, `measure_desktop.py`); repouso de 20 s com 0,1% da CPU da máquina e 236 MiB de compromisso privado somado |
| Diagnóstico em Ajustes | Whisper, CTranslate2, PyAV e yt-dlp localizados no backend empacotado; FFmpeg/ffprobe ausentes, sem impedir transcrição |
| Seleção múltipla no diálogo do Windows | Três arquivos na ordem escolhida; 22 arquivos resultaram em 20/20 e aviso de 2 recusados |
| Transcrição real, CPU int8, `tiny` | MP3 e WebM concluídos com texto correto, progresso 100% e dispositivo informado |
| Formatos pelo backend empacotado | MP3, M4A, FLAC, OGG/Vorbis, Opus, MP4, MKV, WebM e MOV transcritos; silêncio em pt sem texto |
| Dispositivo | `HORUS_WHISPER_DEVICE=cuda` sem GPU recaiu para CPU com aviso; valor inválido gerou erro claro |
| Edição e cópia | Texto editado com acentos copiado para a área de transferência do Windows sem alteração |
| Salvamento nativo | Cancelar o diálogo mantém o texto e Próximo travado; arquivo `transcrição-ação.txt` gravado em UTF-8 idêntico ao texto; editar depois de salvar trava Próximo |
| FIFO | Próximo vídeo iniciou o segundo arquivo automaticamente após salvar |
| Cancelamento | Parcial de 7 linhas preservado na tela e no banco; nova tentativa acrescenta ao parcial |
| Fechar a janela durante a transcrição | App, backend e subprocesso de transcrição encerrados sem processos remanescentes; job `interrupted` com checkpoint de 75 linhas |
| Reabertura | Recibo persistido no perfil WebView2; nenhuma requisição a `/v1/jobs` antes de **Retomar acompanhamento**; ao retomar, parcial e motivo exibidos sem nova execução |
| Biblioteca | WebM e MP3 selecionados no diálogo, registrados e reproduzidos no WebView2 por URL assinada; busca temporal funcionou |
| Instalador (inspeção sem instalar) | Modo por usuário em `%LOCALAPPDATA%\HORUS`; 549 arquivos, incluindo motor de transcrição; desinstalação apaga dados somente com a opção explícita, desmarcada por padrão |

Corrigido nesta validação: ao reabrir com recibo pendente, Modelo e Idioma voltavam para Small/Automático; um novo Transcrever usaria outro modelo sem aviso. A tela agora restaura as opções da tarefa original (teste de regressão em `frontend/tests/transcription-receipt-settings.spec.ts`).

Observações do instalador: marcar "excluir dados" na desinstalação remove `%LOCALAPPDATA%\com.horus.audiovisual` inteiro, incluindo o banco operacional e o perfil WebView2. A pasta de instalação `%LOCALAPPDATA%\HORUS` coincide, sem diferenciar maiúsculas, com `%LOCALAPPDATA%\Horus`, onde ficam a conexão Hermes e os modelos do Avalonia; a desinstalação remove apenas os arquivos instalados e pastas vazias.

Não validado nesta etapa: arrastar e soltar nativo (exige gesto real do usuário), instalação/atualização/desinstalação NSIS, GPU NVIDIA com e sem cuDNN, download real do YouTube, modelos maiores, áudio real longo e equivalência de qualidade com o Avalonia.

### Homologação do pacote — Windows, 2026-11-11

Instalador final `HORUS_0.1.0_x64-setup.exe` (80,09 MiB, SHA-256 `9ee29f5e96b9b774…`), gerado a partir de `60c1b01` com as correções de interface desta etapa. O conteúdo do instalador foi extraído com 7-Zip para uma pasta descartável, sem gravar registro ou atalhos, e executado com ambiente mínimo: PATH restrito às pastas do Windows, sem Python, .NET, venv, `HORUS_PYTHON` ou `FABRICA_HOME`. Somente `horus-desktop.exe` e `horus-backend.exe` da pasta extraída foram executados; o SDK .NET nem está disponível no PATH do sistema.

| Verificação | Resultado |
|---|---|
| Fluxo nativo completo | Repetido no pacote final: seleção múltipla, transcrição CPU, cópia, salvar/cancelar salvamento, FIFO, cancelamento, nova tentativa e Biblioteca |
| Formatos no backend do instalador, sem FFmpeg | MP3, M4A, FLAC, OGG, Opus, MP4, MKV, WebM e MOV transcritos (1,6–1,7 s cada com `tiny`) |
| Falha abrupta do backend durante transcrição | Processo encerrado à força; subprocesso de transcrição encerrado pelo Job Object; interface indicou a perda; **Reconectar backend** relançou o backend; job `interrupted` com checkpoint de 85 linhas retomado, mantendo modelo e idioma |
| Migração v1 → v2 | Banco v1 fictício com o schema de `051ef26`: migrado ao abrir, cópia `horus.backup-v1-*.sqlite3` com os 4 jobs originais, job `running` recuperado como `interrupted`, histórico, resultado antigo e mídia registrada no v1 funcionando na interface |
| Encerramento | Sem processos remanescentes após fechamentos normais, durante transcrição e após a falha abrupta |

Corrigido nesta etapa: o histórico exibia estados em inglês (`failed`, `interrupted`) e abrir um resultado já concluído mostrava "Concluído em 00:00", como se tivesse acabado de executar; agora usa rótulos em português e informa "Transcrição recuperada do histórico". Testes de regressão em `frontend/tests/transcription-receipt-settings.spec.ts`.

Limitação conhecida do Whisper: silêncio puro com idioma inglês pode gerar um trecho inventado; em português não gerou texto. Não há gravação de voz humana nesta máquina; o ensaio usou fala sintética do Windows.

Pendências que exigem ambiente ou participação: instalação/atualização/desinstalação pelo NSIS em conta Windows ou VM de teste (a instalação grava atalhos e chaves no perfil do usuário); arrastar e soltar real; GPU NVIDIA; download real do YouTube; comparação de qualidade com gravação real nos dois aplicativos.

Pendências para aceitar a prova completa: testar a instalação NSIS e diálogos nativos; executar render real com os materiais preparados e conferir cancelamento de sua árvore de processos; reproduzir vídeo no WebView2; medir RAM/CPU/inicialização do build desktop de produção e comparar telas nos tamanhos e temas previstos. As metas de 250 MB e três segundos ainda não são resultados comprovados. A transcrição React só poderá substituir definitivamente o Avalonia após validar os itens não verificados da seção Transcrição.
