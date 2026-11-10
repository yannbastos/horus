# Validação local — 10 de novembro de 2026

Validação da frente Hórus, sobre a base `051ef26`. A fábrica foi usada como dependência externa, sem alterações neste trabalho. Os resultados abaixo não certificam aprovação editorial, licenças ou publicação.

## Resultados observados

| Verificação | Resultado |
|---|---|
| Backend | 65 testes passaram, incluindo segurança, fila, persistência, transcrição simulada e diagnóstico Hermes |
| Frontend | TypeScript e build Vite passaram |
| Interface no Edge | 4 testes passaram; execução final encerrou com código zero |
| CLI real | Consulta de `canal01` passou; histórico preservado após reinício; encerramento por EOF passou |
| Backend empacotado | `smoke.py --packaged` passou com CLI real, reinício, histórico e saída por EOF |
| Render real | CLI Python → Remotion → Node/Chrome → MP4, solicitado pela API FastAPI em processo de teste |
| Cancelamento real | Segunda execução cancelada após iniciar Chrome; os 8 processos observados da árvore encerraram |
| Recuperação | Estados `succeeded` e `cancelled` preservados após recriar o aplicativo FastAPI com o mesmo SQLite |
| Diálogo nativo | Seleção de MP4 no diálogo Windows registrou o arquivo na Biblioteca do Tauri release |
| Reprodução nativa | MP4 aberto no WebView2; reprodução avançou de 0 para 13 segundos |

O render demorou **64,83 segundos**, com saída de **4.751.408 bytes**. Inspeção com PyAV confirmou H.264/AAC, **540 × 960, 30 fps e 32,747 segundos**, com decodificação de frame bem-sucedida. Trata-se do preset de rascunho, que usa metade da resolução final.

## Fixture e preservação

`backend/smoke_render.py` cria uma pasta única em `artifacts/`, copia código da fábrica, perfil, roteiro, alinhamento, manifesto e imagens do experimento antigo e gera um WAV de silêncio com a duração do alinhamento. Não copia `.env`, chama ElevenLabs, busca assets ou envia avisos. Usa o Python e as dependências Remotion já instalados, incluindo o navegador local. A junction `remotion/node_modules` referencia as dependências existentes; não remover recursivamente seu destino ao limpar a fixture.

Esse teste comprova execução técnica, cancelamento e persistência. Não avalia voz, sincronização perceptiva ou qualidade editorial. Não representa um vídeo aprovado para publicação. A segunda execução usa a mesma saída de rascunho; o script preserva também `render-completed.mp4` antes de cancelar a segunda tentativa.

Relatório da execução observada: `artifacts/render-validation-f73623fa3d/report.json`. Esse relatório e as mídias permanecem locais, ignorados pelo Git. A cópia de preservação foi adicionada ao script após essa primeira execução; o MP4 original continuou reproduzível após o cancelamento observado.

## Medição do desktop de produção

Executável release, sem Vite, no Windows 11 build 26300, 16 processadores lógicos e 23,7 GiB de RAM. Foram feitas 20 aberturas e fechamentos normais com SQLite separado e perfil WebView2 isolado. O cache de arquivos do sistema estava aquecido; o perfil WebView foi criado na primeira abertura e reutilizado. O build release existente foi medido; não houve recompilação do Tauri neste incremento.

| Métrica | Resultado |
|---|---|
| Backend com socket em escuta, mediana de 20 aberturas | 1,0075 s |
| Faixa até o backend escutar | 0,812–1,531 s |
| Janela nativa visível | 0,062–0,079 s; mede somente o shell |
| Repouso amostrado | 60,02 s após 5 s de estabilização |
| CPU da árvore, em um núcleo | 0,391% |
| CPU normalizada pelos 16 processadores lógicos | 0,024% |
| Soma de RSS | 444,8 MiB |
| Soma do compromisso privado | 212,5 MiB |
| Processos remanescentes após os 20 fechamentos | Nenhum dos processos observados |

A árvore amostrada incluiu Hórus, backend, conhost e seis processos WebView2. RSS somado conta páginas compartilhadas mais de uma vez; compromisso privado não equivale a memória física exclusiva. **A meta de 250 MB de RAM não está comprovada.** Também não foi medido o instante da primeira tela utilizável, portanto não se certifica a meta de três segundos com base no aparecimento da janela ou no socket.

Uma primeira medição sem isolamento do perfil WebView não incluiu os processos do navegador e foi descartada para avaliar o desktop completo. O script passou a exigir WebView2 na árvore e na amostra de repouso. Relatório válido: `artifacts/desktop-measure-36b8dc8f7c/report.json`; a descrição do método no script foi posteriormente detalhada para explicitar a criação do perfil na primeira execução. Os números deste documento vêm da amostra completa.

## Reproduzir

Na pasta `backend/`, com os ambientes existentes preparados:

```powershell
& .venv/Scripts/python.exe -m pytest tests -q --tb=short
& .venv/Scripts/python.exe smoke.py
& .venv/Scripts/python.exe smoke.py --packaged
& .venv/Scripts/python.exe smoke_render.py
& .venv/Scripts/python.exe measure_desktop.py --runs 20 --idle-seconds 60
```

Na pasta `frontend/`:

```powershell
npm.cmd run build
npm.cmd test
```

Os scripts de render e medição atuais são de validação **Windows**. O render requer FastAPI TestClient/HTTPX e psutil do ambiente de desenvolvimento. A medição requer o build Tauri release com backend ao lado do executável.

## Limites e ambiente de execução

A primeira execução de pytest no sandbox falhou ao criar diretórios temporários por falta de permissão. Fora do sandbox, os 65 testes passaram. Os quatro casos Playwright passaram também no sandbox, mas o encerramento do servidor Vite ficou preso; a árvore daquela execução foi encerrada e a suíte foi repetida fora do sandbox, passando com saída normal. Não foi alterada a política de execução do PowerShell; `npm.cmd` evita a seleção de `npm.ps1` bloqueado.

Continuam pendentes: instalação pelo NSIS; seleção de pasta, salvamento e arrastar arquivos nativos; busca temporal manual no player; recuperação após falha abrupta durante render real; YouTube real; transcrição longa/GPU/modelos maiores; comparação visual completa com Avalonia. O render e seu cancelamento foram exercitados pela API real em TestClient, não por um clique na tela Produção nem pelo backend empacotado.

Na janela desktop já aberta nesta máquina, Ajustes informou CLI Hermes localizado e conexão não configurada. Isso é uma observação da configuração dessa sessão; não foi executada inferência nem modificada a configuração privada.
