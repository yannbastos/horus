# Migração local — primeira prova de conceito

Implementação iniciada após autorização do usuário em 2026-11-10. O Avalonia não foi removido. A transcrição Whisper, revisão e salvamento continuam nele; ainda não há equivalência funcional completa no React.

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

Fluxo: React → API FastAPI → fila SQLite → CLI `fabrica` existente. O frontend não executa comandos arbitrários nem contém regras da produção. Há uma tarefa técnica por vez. O backend funciona sem Tauri. Hermes, Radar, análise editorial, aprovações de roteiro e publicação não estão integrados nesta prova.

Operações expostas: consulta de perfil em JSON e render de rascunho `short`. Render exige projeto já preparado na fábrica; não gera roteiro, voz ou assets. Um render bem-sucedido não equivale a aprovação editorial, liberação de licenças ou conteúdo pronto para publicar.

## Preparação e execução

Pré-requisitos de desenvolvimento web: Node compatível com Vite 8, uv e Python 3.12. Dependências são isoladas e fixadas por `frontend/package-lock.json` e `backend/uv.lock`.

Na raiz do Hórus:

```powershell
uv sync --project backend --frozen --extra test --extra bundle --extra measure
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

Pendências para aceitar a prova completa: testar a instalação NSIS e diálogos nativos; executar render real com os materiais preparados e conferir cancelamento de sua árvore de processos; reproduzir vídeo no WebView2; medir RAM/CPU/inicialização do build desktop de produção e comparar telas nos tamanhos e temas previstos. As metas de 250 MB e três segundos ainda não são resultados comprovados. A transcrição só poderá substituir o Avalonia após migração e testes de equivalência específicos.
