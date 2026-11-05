using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Styling;
using Horus.ViewModels;
using Horus.Views;
using Horus.Views.Examples;

namespace Horus.Tests;

public class ExampleScreensTests
{
    [AvaloniaTheory]
    [InlineData("NavHome", "HomeView")]
    [InlineData("NavList", "ListView")]
    [InlineData("NavReading", "ReadingView")]
    [InlineData("NavSettings", "SettingsView")]
    public void Navigation_shows_only_the_selected_screen(string option, string screen)
    {
        var window = new MainWindow { DataContext = new MainWindowViewModel() };
        window.Show();

        window.GetControl<RadioButton>(option).IsChecked = true;

        foreach (var name in new[] { "HomeView", "ListView", "ReadingView", "SettingsView" })
        {
            Assert.Equal(name == screen, window.GetControl<UserControl>(name).IsVisible);
        }

        window.Close();
    }

    [AvaloniaTheory]
    [InlineData("ThemeLight", "Light")]
    [InlineData("ThemeDark", "Dark")]
    [InlineData("ThemeSystem", "Default")]
    public void Theme_option_changes_the_application_theme(string option, string expected)
    {
        var application = Application.Current!;
        var original = application.RequestedThemeVariant;
        var window = new MainWindow { DataContext = new MainWindowViewModel() };
        window.Show();

        try
        {
            var settings = window.GetControl<SettingsExampleView>("SettingsView");
            var alternative = option == "ThemeDark" ? "ThemeLight" : "ThemeDark";
            settings.GetControl<RadioButton>(alternative).IsChecked = true;

            settings.GetControl<RadioButton>(option).IsChecked = true;

            Assert.Equal(expected, application.RequestedThemeVariant?.Key.ToString());
        }
        finally
        {
            window.Close();
            application.RequestedThemeVariant = original;
        }
    }
}
