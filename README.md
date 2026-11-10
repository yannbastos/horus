# HORUS

> **Planejamento da evolução audiovisual:** leia [o contexto e a carta de continuidade](docs/planejamento/README.md). A direção escolhida integra Hermes Agent e a fábrica Python independente, sem fork inicial. Essa integração ainda não foi implementada; a descrição abaixo apresenta o aplicativo existente.

O HORUS é um aplicativo desktop de estudos e aprendizagem, gratuito e open source. Ele vai reunir técnicas de estudo, revisão e organização que funcionaram na prática para o seu idealizador, para que outras pessoas também possam usá-las.

## Objetivos

- Oferecer ferramentas de estudo simples e fáceis de usar.
- Manter os dados sob o controle do usuário, com respeito à privacidade.
- Evoluir aos poucos, a partir de necessidades reais de quem estuda.
- Manter código e documentação compreensíveis para futuros colaboradores.

Mais detalhes em [docs/vision.md](docs/vision.md).

## Estado atual

**Em desenvolvimento inicial.** A primeira funcionalidade real é a **Transcrição** de áudio e vídeo, trazida do antigo app Thot. As telas Início, Lista e Leitura continuam sendo exemplos com dados fictícios, usadas para avaliar o design. Em Ajustes, apenas a troca entre os temas claro e escuro funciona.

## Transcrição

Transcreve áudio e vídeo para texto, 100% offline, com [Whisper.net](https://github.com/sandrohanea/whisper.net).

1. Arraste arquivos (mp3, wav, m4a, mp4, mkv, ...) para a tela ou use **Selecionar arquivos**.
2. A fila é FIFO, com **até 20 arquivos incluindo o atual**. O primeiro da fila é o atual.
3. Escolha o modelo e o idioma (ou deixe a detecção automática) e clique em **Transcrever**.
4. Ao concluir, o app **para e mantém o resultado**. Revise, edite e use **Salvar .txt**. **Copiar** não libera a fila.
5. Só depois de salvar com sucesso, clique em **Próximo vídeo**. Editar o texto exige salvar novamente.

Em erro ou cancelamento, o arquivo atual e o texto parcial são preservados e **Transcrever** tenta de novo o mesmo arquivo. A fila existe apenas durante a sessão: salve o texto antes de fechar o app.

**YouTube:** cole o link de um vídeo e clique em **Baixar e adicionar à fila**. O vídeo entra no final da fila, sem substituir o resultado atual. Baixe apenas conteúdo que você tem autorização para salvar.

Dependências externas:

- **ffmpeg** no `PATH` ou na pasta do app (`winget install Gyan.FFmpeg`).
- Para o YouTube: **yt-dlp** e **Node.js 22+** (`winget install yt-dlp.yt-dlp` e `winget install OpenJS.NodeJS.LTS`). O app também procura o yt-dlp em `%LOCALAPPDATA%\Horus\tools`.

Os modelos são baixados na primeira vez para `%LOCALAPPDATA%\Horus\models`. Com GPU NVIDIA e CUDA 12, o runtime CUDA é usado automaticamente; senão, roda na CPU.

As próximas etapas estão em [docs/roadmap.md](docs/roadmap.md).

## Tecnologias

- C# e .NET 10
- [Avalonia UI](https://avaloniaui.net/) 12 para a interface desktop
- xUnit v3 e Avalonia Headless para os testes

## Pré-requisitos

- Windows 10 ou 11
- [SDK do .NET 10](https://dotnet.microsoft.com/download/dotnet/10.0)
- Git

## Instalação das ferramentas no Windows

Com permissão de administrador:

```powershell
winget install Microsoft.DotNet.SDK.10
winget install Git.Git
```

Sem permissão de administrador, instale o SDK na pasta do usuário com o script oficial:

```powershell
Invoke-WebRequest https://dot.net/v1/dotnet-install.ps1 -OutFile dotnet-install.ps1
.\dotnet-install.ps1 -Channel 10.0 -InstallDir "$env:USERPROFILE\.dotnet" -NoPath
```

Se já existir um `dotnet` em `C:\Program Files\dotnet`, ele tem prioridade no `PATH` e não enxerga esse SDK. Para corrigir isso, adicione esta linha ao seu perfil do PowerShell (`$PROFILE`):

```powershell
$env:PATH = "$env:USERPROFILE\.dotnet;$env:PATH"
```

Para conferir a instalação:

```powershell
dotnet --list-sdks
```

## Compilar e executar

Na raiz do repositório, usando o PowerShell:

```powershell
dotnet restore Horus.slnx
dotnet build Horus.slnx
dotnet run --project src/Horus
```

## Executar os testes

```powershell
dotnet test Horus.slnx --filter "Category!=Network"
```

Os testes não abrem janelas na tela, pois usam o modo headless do Avalonia. O teste de integração do YouTube baixa um vídeo público curto e exige internet, yt-dlp e Node.js:

```powershell
dotnet test Horus.slnx --filter "Category=Network"
```

## Suporte ao Linux

O foco atual é o Windows, e o Linux ainda não é suportado nem testado. O suporte está previsto para o futuro, com atenção especial ao Arch Linux. Por isso, o projeto usa tecnologias multiplataforma e evita APIs exclusivas do Windows.

## Contribuições

O projeto ainda está na fase de fundação e o processo de contribuição não foi formalizado. Até lá, sugestões e relatos de problemas são bem-vindos.

Antes de alterar o código, leia [AGENTS.md](AGENTS.md) e [docs/architecture.md](docs/architecture.md).

## Licença

A licença open source ainda não foi definida.

## Catálogo visual

O laboratório React/Storybook fica em um repositório separado: [horus-storybook](https://github.com/yannbastos/horus-storybook). Ele reúne componentes e telas para avaliar o design antes da adaptação ao C# e ao futuro site.

Na organização local, o catálogo está em `../HORUS Storybook`. Consulte o README daquele repositório para executar e verificar o catálogo. Ele é independente do aplicativo Avalonia e usa dados fictícios.
