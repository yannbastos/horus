# Hórus

**Plataforma de inteligência audiovisual em desenvolvimento.**

Pesquisar referências, compreender conteúdos e transformar conhecimento em histórias originais. O Hórus está sendo construído para reunir pesquisa audiovisual, planejamento editorial, produção assistida por IA e acompanhamento de canais em um único espaço.

O projeto começa pela operação de um canal no YouTube. A expansão para outros canais e formatos virá depois da validação do fluxo, da qualidade e dos custos.

[Visão do produto](docs/vision.md) · [Roadmap](docs/roadmap.md) · [Arquitetura atual](docs/architecture.md) · [Planejamento técnico](docs/planejamento/README.md)

**Direção da migração:** React/TypeScript + Tauri 2, Rust apenas para integrações nativas, Python/FastAPI e SQLite. A primeira prova será local no Windows, sem VPS e sem redesign. O desktop implementado continua em C#/Avalonia; consulte [o plano de migração](docs/planejamento/STACK-LOCAL.md) antes de iniciar alterações.

## O que já funciona

O aplicativo desktop atual usa **C#/.NET e Avalonia**. Ele permite importar áudio e vídeo, baixar um vídeo do YouTube, transcrever localmente com Whisper, revisar o texto e salvar o resultado. Há temas claro, escuro e do sistema e testes automatizados de interface e comportamento.

| Capacidade | Situação |
|---|---|
| Download e transcrição de áudio/vídeo | Implementados no desktop; exigem as ferramentas descritas abaixo |
| Fila de transcrição, edição e salvamento | Implementados; a fila não persiste ao fechar o app |
| Layout desktop audiovisual | Primeira versão disponível na [branch de layout](https://github.com/yannbastos/horus/tree/feat/layout-desktop-audiovisual), ainda separada da principal |
| Radar, análise editorial e memória operacional | Planejados; sem integração operacional no desktop |
| Integração com Hermes e fábrica Python | Planejada; diagnóstico da instalação real ainda pendente |
| Publicação automática e múltiplos canais | Evolução futura; publicação inicialmente manual |

As telas antigas de Início, Lista e Leitura na branch principal são exemplos com dados fictícios. Não representam uma operação audiovisual conectada. Em Ajustes, a troca de tema funciona; os demais controles são demonstrações.

## Prévia do desktop audiovisual

![Prévia do layout audiovisual do Hórus em tema escuro](https://raw.githubusercontent.com/yannbastos/horus/feat/layout-desktop-audiovisual/docs/previews/desktop-dark.png)

Captura do aplicativo Avalonia na branch `feat/layout-desktop-audiovisual`. A prévia reorganiza a navegação e preserva a transcrição; os demais módulos aparecem como em preparação. [Capturas e limites do layout](https://github.com/yannbastos/horus/blob/feat/layout-desktop-audiovisual/docs/layout-desktop.md).

## Para onde o Hórus está evoluindo

- **Radar:** descobrir e organizar oportunidades a partir de dados e fontes acessíveis.
- **Análise audiovisual:** estudar narrativa, ganchos, títulos, thumbnails e formatos, separando observação de hipótese.
- **Planejamento editorial:** desenvolver ideias originais, briefings e roteiros sujeitos à aprovação.
- **Produção:** acompanhar a fábrica de vídeos, revisões e arquivos finais.
- **Canais e resultados:** reunir perfis editoriais, custos, métricas autorizadas e experimentos.
- **Memória operacional:** preservar decisões e aprendizados validados, com origem rastreável.

Esses módulos descrevem a direção do produto, não funcionalidades prontas. O sistema deve preservar aprovação humana, verificação de licenças e controle de custos.

## Como os projetos se conectam

| Componente | Papel |
|---|---|
| **Hórus — este repositório** | Aplicativo e referência central do produto e do planejamento |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Motor de inteligência e orquestração previsto, por integração externa e sem fork inicial |
| [Fábrica de canais](https://github.com/yannbastos/fabrica-canais) | Motor independente Python/CLI e Remotion; não exige o desktop para funcionar |
| [Estudos de vídeos](https://github.com/yannbastos/estudos-videos-claude) | Base inicial de fontes, transcrições e resumos |
| [Laboratório visual](https://github.com/yannbastos/horus-storybook) | Componentes e referências de interface em React/Storybook |

A primeira etapa será inteiramente local, sem VPS. A stack de destino foi definida, mas os componentes atuais serão preservados até a migração incremental ser aprovada e validada. Consulte [o planejamento de integração](docs/planejamento/README.md).

## Transcrição

O processamento da transcrição é local, com [Whisper.net](https://github.com/sandrohanea/whisper.net). O primeiro download do modelo e a obtenção de vídeos do YouTube exigem internet.

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

Os modelos são baixados na primeira vez para `%LOCALAPPDATA%\Horus\models`. A execução usa CPU ou runtime CUDA conforme os recursos e a configuração do ambiente.

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
