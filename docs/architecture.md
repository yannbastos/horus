# Arquitetura

Este documento descreve apenas o que está implementado hoje.

## Organização dos projetos

```text
src/Horus/              Aplicativo desktop
  Program.cs            Ponto de entrada e configuração do Avalonia
  App.axaml(.cs)        Tema da aplicação e criação da janela principal
  app.manifest          Declara compatibilidade com Windows 10 e 11
  ViewModels/           Dados e estado apresentados pelas telas
  Views/                Telas em AXAML
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
| `MainWindow` | Define o layout da janela principal |
| `MainWindowViewModel` | Fornece o nome do aplicativo e a mensagem de status |
| `MainWindowTests` | Abre a janela em modo headless e confere o conteúdo exibido |

## Frameworks e dependências

| Pacote | Uso |
| --- | --- |
| `Avalonia`, `Avalonia.Desktop` | Interface desktop multiplataforma |
| `Avalonia.Themes.Fluent` | Tema visual, com modos claro e escuro conforme o sistema |
| `Avalonia.Fonts.Inter` | Fonte consistente entre sistemas operacionais |
| `xunit.v3`, `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk` | Execução dos testes |
| `Avalonia.Headless.XUnit` | Testes de interface sem abrir janelas na tela |

## Decisões técnicas

### Projeto único

Todo o código do aplicativo fica em `src/Horus`. O scaffold anterior tinha camadas Domain, Application e Infrastructure, mas elas estavam vazias e foram removidas. Ainda não há regras de negócio ou persistência que justifiquem essa separação. Novos projetos só devem surgir quando houver uma necessidade concreta.

### MVVM sem biblioteca

Views e ViewModels ficam separados porque esse é o padrão natural do Avalonia e permite testar a lógica sem depender da tela. Como a tela atual só exibe valores fixos, não há necessidade de `INotifyPropertyChanged` nem de comandos. Uma biblioteca como o `CommunityToolkit.Mvvm` pode ser avaliada quando surgir a primeira tela com estado.

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
- O código atual não acessa o sistema de arquivos. Quando isso mudar, use `Path.Combine` e `Environment.GetFolderPath`, nunca caminhos fixos.
- O aplicativo ainda não foi compilado nem executado no Linux.
