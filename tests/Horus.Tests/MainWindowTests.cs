using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Horus.ViewModels;
using Horus.Views;

namespace Horus.Tests;

public class MainWindowTests
{
    [AvaloniaFact]
    public void Opens_showing_app_name_and_development_status()
    {
        var window = new MainWindow { DataContext = new MainWindowViewModel() };

        window.Show();

        Assert.Equal("HORUS", window.Title);
        Assert.Equal("HORUS", window.GetControl<TextBlock>("AppNameText").Text);
        Assert.Equal(
            "Aplicativo em desenvolvimento",
            window.GetControl<TextBlock>("StatusMessageText").Text);
    }
}
