# Arquitetura

Este documento descreve apenas o que está implementado hoje.

## Organização dos projetos

```text
src/Horus/              Aplicativo desktop
  Program.cs            Ponto de entrada e configuração do Avalonia
  App.axaml(.cs)        Tema da aplicação e criação da janela principal
  app.manifest          Declara compatibilidade com Windows 10 e 11
  Assets/Fonts/         Fontes embutidas e suas licenças
  Theme/                Cores, fontes e estilos visuais
  Services/             Transcrição (Whisper), conversão de áudio (ffmpeg) e download do YouTube (yt-dlp)
  ViewModels/           Dados e estado apresentados pelas telas
  Views/                Telas em AXAML
  Views/Examples/       Telas temporárias com dados fictícios para avaliar o design
tests/Horus.Tests/      Testes automatizados
docs/                   Documentação do projeto
Horus.slnx              Solução do .NET
Directory.Build.props   Configurações comuns: .NET 10, nullable e implicit usings
global.json             Versão mínima do SDK
```

## Responsabilidade dos componentes

| Componente | Responsabilidade |
| --- | --- |
| `Program` | Inicia o aplicativo e configura a plataforma e a fonte Inter |
| `App` | Carrega o tema Fluent e cria a `MainWindow` com seu ViewModel |
| `MainWindow` | Define o cabeçalho, a navegação, o rodapé e a área das telas |
| `Views/Examples`, `ExampleData` | Telas e dados fictícios, sem regras de negócio; devem ser removidos quando houver telas reais |
| `MainWindowViewModel` | Fornece o nome do aplicativo, a mensagem de status, os dados de exemplo e o `TranscriptionViewModel` |
| `TranscriptionView` | Tela de transcrição: arrastar e soltar, diálogos de arquivo, área de transferência e layout |
| `TranscriptionViewModel` | Fila de até 20 arquivos, transcrição, cancelamento, salvamento e download, sem depender da tela |
| `TranscriptionService` | Baixa o modelo Whisper uma vez e transcreve o áudio, informando progresso e trechos |
| `AudioConverter` | Converte qualquer mídia em WAV 16 kHz mono com ffmpeg, em arquivo temporário |
| `YouTubeDownloadService` | Valida links de um único vídeo e executa o yt-dlp com argumentos seguros |
| `ViewConverters` | Exibe nome e pasta de um caminho de arquivo |
| `Theme/Tokens.axaml` | Define as cores dos temas claro e escuro e as fontes |
| `Theme/Styles.axaml` | Aplica os tokens à janela, aos textos e aos botões |
| `MainWindowTests` | Abre a janela em modo headless e confere o conteúdo exibido |
| `ThemeTests` | Confere contraste, carregamento das fontes e troca de tema |
| `ExampleScreensTests` | Confere a navegação e a opção de tema das telas de exemplo |
| `TranscriptionViewModelTests` | Confere as regras da fila, do salvamento e do download com transcrições simuladas |
| `TranscriptionViewTests` | Abre a janela em modo headless e confere a tela de transcrição |
| `YouTubeDownloadTests`, `YouTubeIntegrationTests` | Validam links e argumentos do yt-dlp; o teste de integração (`Category=Network`) usa a internet |

## Frameworks e dependências

| Pacote | Uso |
| --- | --- |
| `Avalonia`, `Avalonia.Desktop` | Interface desktop multiplataforma |
| `Avalonia.Themes.Fluent` | Base dos controles, personalizada pelo tema do HORUS |
| `Avalonia.Fonts.Inter` | Fonte de texto consistente entre sistemas operacionais |
| `CommunityToolkit.Mvvm` | Propriedades observáveis e comandos da tela de transcrição |
| `Whisper.net`, `Whisper.net.Runtime`, `Whisper.net.Runtime.Cuda.Windows` | Transcrição local; o runtime CUDA é usado se houver GPU NVIDIA compatível |
| `xunit.v3`, `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk` | Execução dos testes |
| `Avalonia.Headless.XUnit` | Testes de interface sem abrir janelas na tela |

## Decisões técnicas

### Projeto único

Todo o código do aplicativo fica em `src/Horus`. O scaffold anterior tinha camadas Domain, Application e Infrastructure, mas elas estavam vazias e foram removidas. Ainda não há regras de negócio ou persistência que justifiquem essa separação. Novos projetos só devem surgir quando houver uma necessidade concreta.

### MVVM com CommunityToolkit.Mvvm

Views e ViewModels ficam separados porque esse é o padrão natural do Avalonia e permite testar a lógica sem depender da tela. A tela de transcrição tem estado e comandos, por isso usa o `CommunityToolkit.Mvvm`. As telas de exemplo continuam exibindo valores fixos.

A View injeta no ViewModel as funções que dependem da janela (diálogos de arquivo e área de transferência). Os testes substituem essas funções, a transcrição e o download por versões simuladas.

### Transcrição

Funcionalidade trazida do antigo app Thot, com as mesmas regras: a fila conta o arquivo atual no limite de 20, a conclusão pausa a fila e só o salvamento bem-sucedido da versão atual do texto libera **Próximo vídeo**. Uma revisão do texto é registrada antes do salvamento para que edições feitas durante o diálogo não liberem o avanço.

Os modelos ficam em `%LOCALAPPDATA%\Horus\models`. ffmpeg e yt-dlp são programas externos, procurados na pasta do app, no `PATH` e, no caso do yt-dlp, em `%LOCALAPPDATA%\Horus\tools`.

### Tema visual

A linguagem visual usa cantos retos, linhas finas, botões de alto contraste e três fontes: Archivo Expanded nos títulos, Inter nos textos e Geist Mono em rótulos curtos. Ela foi inspirada no estilo do [ArtCraft Launcher](https://github.com/storytold/craft-launcher), sem reutilizar sua marca, seus ícones ou seu código.

O tema acompanha a configuração clara ou escura do sistema. As telas devem usar `DynamicResource` com os tokens de `Theme/Tokens.axaml`, nunca cores fixas, para que a troca de tema funcione. Os textos devem ter contraste mínimo de 4,5:1, verificado pelos testes. Textos longos de estudo devem usar Inter, não fontes monoespaçadas.

Archivo e Geist Mono são embutidas em versões estáticas e distribuídas sob a SIL Open Font License, com as licenças em `Assets/Fonts`. O Inter vem do pacote `Avalonia.Fonts.Inter`.

### Bindings compilados

Os bindings são validados durante a compilação, o que transforma erros de nome em falhas de build em vez de erros silenciosos ao executar.

### Testes em modo headless

O teste abre a janela real e confere o que ela apresenta, sem depender de um ambiente gráfico. Isso também facilita a execução em integração contínua no futuro.

### .NET 10

É uma versão LTS, com suporte de longo prazo e compatível com Windows e Linux. O `global.json` exige o SDK 10 e aceita atualizações dentro dessa versão principal.

## Compatibilidade futura com Linux

- `Avalonia.Desktop` e `UsePlatformDetect()` selecionam a plataforma durante a execução.
- O código atual não usa WPF, Windows Forms nem APIs exclusivas do Windows.
- O `app.manifest` e o `OutputType` `WinExe` só têm efeito no Windows.
- O acesso a arquivos usa `Path.Combine` e `Environment.GetFolderPath`, sem caminhos fixos. ffmpeg e yt-dlp são procurados com o nome do executável de cada sistema.
- O runtime CUDA do Whisper é exclusivo do Windows; nas demais plataformas a transcrição usa a CPU.
- O aplicativo ainda não foi compilado nem executado no Linux.

### Composição visual HORUS

As telas de exemplo combinam a geometria reta e as divisórias do launcher com superfícies em tons de índigo e a composição gráfica inspirada no Hermes. A identidade é própria: um olho geométrico cercado por órbitas vetoriais, desenhado em AXAML, sem imagens, marcas ou código das referências.

A tela inicial apresenta uma faixa de abertura com essa ilustração. As órbitas executam uma animação de entrada de 2,4 segundos e depois ficam estáticas. Cards e botões usam transições curtas de cor ao passar o ponteiro. Não há animação contínua durante a leitura. Os temas claro e escuro continuam usando os mesmos tokens dinâmicos, com contraste dos textos verificado pelos testes existentes.

Essas telas continuam sendo exemplos com dados fictícios. A tela de transcrição usa a mesma linguagem visual: painel lateral rebaixado com fontes, opções e fila; etapas numeradas (transcrever, salvar, próximo) que se preenchem conforme o progresso; e uma área de leitura em Inter para o texto.

## Laboratório visual em React

O repositório separado [horus-storybook](https://github.com/yannbastos/horus-storybook), localizado em `../HORUS Storybook` na organização local, contém um projeto independente React + TypeScript + Vite com Storybook 10.6.5. Ele permite comparar fundamentos, componentes, movimento, telas de exemplo e uma composição exploratória para o futuro site. Não faz parte do executável Avalonia e não adiciona dependências ao projeto .NET.

O catálogo oferece temas claro, escuro e do sistema, fontes locais, controles de propriedades e o addon de acessibilidade. O protótipo usa dados fictícios; busca, filtros, navegação e controles são locais e não persistem dados. A composição de site é uma proposta visual, não um site publicado.

A paleta CSS inicial foi extraída dos tokens AXAML. Não há sincronização automática: decisões aprovadas no catálogo precisam ser adaptadas ao C#. Instruções e limitações estão no README do repositório `horus-storybook`.
