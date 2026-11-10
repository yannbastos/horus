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

Pendências para aceitar a prova completa: compilar e abrir o Tauri; conferir diálogos e fechamento da árvore de processos no executável; executar render real com os materiais preparados; reproduzir vídeo no WebView2; medir RAM/CPU/inicialização do build desktop de produção e comparar telas com Avalonia. As metas de 250 MB e três segundos ainda não são resultados comprovados. A transcrição só poderá substituir o Avalonia após migração e testes de equivalência específicos.
