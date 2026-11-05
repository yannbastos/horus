# HORUS

O HORUS é um aplicativo desktop de estudos e aprendizagem, gratuito e open source. Ele vai reunir técnicas de estudo, revisão e organização que funcionaram na prática para o seu idealizador, para que outras pessoas também possam usá-las.

## Objetivos

- Oferecer ferramentas de estudo simples e fáceis de usar.
- Manter os dados sob o controle do usuário, com respeito à privacidade.
- Evoluir aos poucos, a partir de necessidades reais de quem estuda.
- Manter código e documentação compreensíveis para futuros colaboradores.

Mais detalhes em [docs/vision.md](docs/vision.md).

## Estado atual

**Em desenvolvimento inicial.** Hoje o aplicativo abre uma janela com o nome HORUS e um aviso de que está em desenvolvimento, nos temas claro e escuro conforme o sistema. Ainda não há nenhuma funcionalidade de estudo.

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
dotnet test Horus.slnx
```

Os testes não abrem janelas na tela, pois usam o modo headless do Avalonia.

## Suporte ao Linux

O foco atual é o Windows, e o Linux ainda não é suportado nem testado. O suporte está previsto para o futuro, com atenção especial ao Arch Linux. Por isso, o projeto usa tecnologias multiplataforma e evita APIs exclusivas do Windows.

## Contribuições

O projeto ainda está na fase de fundação e o processo de contribuição não foi formalizado. Até lá, sugestões e relatos de problemas são bem-vindos.

Antes de alterar o código, leia [AGENTS.md](AGENTS.md) e [docs/architecture.md](docs/architecture.md).

## Licença

A licença open source ainda não foi definida.
