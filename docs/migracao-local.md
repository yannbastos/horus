# Migração local — primeira prova de conceito

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

O build empacota Python em diretório próprio via PyInstaller antes de gerar o instalador NSIS. Não empacota fábrica, Hermes, Whisper, FFmpeg ou Remotion. Linux exige dependências Tauri da distribuição e validação específica; o instalador configurado inicialmente é Windows.

## Transcrição

Porte da ferramenta Avalonia, com as mesmas regras: fila de até 20 arquivos, um por vez; o primeiro da fila é o atual; ao concluir, só é possível avançar depois de salvar a versão atual do texto, e qualquer edição exige salvar novamente. Cancelamento e falha preservam o texto parcial; Transcrever tenta novamente o mesmo arquivo, acrescentando ao texto existente. Modelos (tiny, base, small, medium, large-v3-turbo) e idiomas (automático, pt, en, es) equivalem aos do Avalonia. A tela fica montada após a primeira visita, preservando fila e texto ao trocar de tela.

- Motor: `faster-whisper` (CTranslate2) no extra opcional `transcription`, executado em subprocesso pela fila de tarefas (`horus-backend transcribe`). A API não importa Whisper. Decodifica áudio com PyAV, sem exigir FFmpeg. Usa CUDA quando o CTranslate2 detecta GPU; `HORUS_WHISPER_DEVICE` força `cpu` ou `cuda`. CPU usa int8.
- Modelos são baixados do Hugging Face no primeiro uso para `HORUS_DATA_DIR/models`. Não são os mesmos arquivos ggml do Avalonia (`%LOCALAPPDATA%/Horus/models`); o primeiro uso baixa novamente.
- `av` fixado em `<14.3`: PyAV 15+ removeu um argumento usado pelo faster-whisper 1.2, e 14.3/14.4 não publicam wheel Windows.
- Download do YouTube: mesmos argumentos e validação de URL do Avalonia (vídeo único, HTTPS, sem credenciais), via módulo `yt_dlp` do extra ou `yt-dlp` no PATH. Com FFmpeg no PATH, baixa vídeo+áudio separados e mescla em MP4; sem ele, usa o melhor MP4 único.
- Salvar: no desktop, diálogo nativo (`dialog:allow-save`) e gravação atômica pelo backend (`POST /v1/transcriptions/save`, somente `.txt` em pasta existente). No navegador, baixa o `.txt` pelo próprio navegador. Copiar usa a área de transferência do WebView.
- Arrastar e soltar funciona somente no desktop (evento nativo do Tauri, que fornece caminhos). No navegador, informe o caminho local do arquivo e a pasta de destino do download.
- `GET /v1/transcription` informa somente a presença do motor, do downloader e do FFmpeg.

Verificado em 2026-11-10: testes do backend com subprocesso simulado (streaming de trechos, cancelamento com texto parcial, falha com motivo, download, salvamento e regra de URL); teste de interface com backend simulado (fila, salvar antes de avançar, edição após salvar, preservação entre telas, validação de URL); e uma transcrição real pela interface no navegador, com backend real e modelo `tiny` em CPU, de um WAV gerado por síntese de voz (~2 s após o modelo baixado). Com idioma automático, o `tiny` identificou incorretamente o idioma da voz sintética; com `en`, o texto saiu correto.

Não verificado: download real do YouTube, GPU/CUDA, modelos maiores, áudio longo, arquivos de vídeo, diálogos e arrastar no Tauri, e transcrição no instalador. O empacotamento PyInstaller ainda não inclui `faster_whisper`, `ctranslate2`, `av` e `yt_dlp`; o backend empacotado informa motor ausente até esse ajuste e sua validação. Rede corporativa com inspeção TLS pode bloquear o download dos modelos.

## Segurança, estado e recuperação

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

Pendências para aceitar a prova completa: testar a instalação NSIS e diálogos nativos; executar render real com os materiais preparados e conferir cancelamento de sua árvore de processos; reproduzir vídeo no WebView2; medir RAM/CPU/inicialização do build desktop de produção e comparar telas nos tamanhos e temas previstos. As metas de 250 MB e três segundos ainda não são resultados comprovados. A transcrição React só poderá substituir definitivamente o Avalonia após validar os itens não verificados da seção Transcrição.
