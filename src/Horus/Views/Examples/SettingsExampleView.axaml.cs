using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Styling;

namespace Horus.Views.Examples;

public partial class SettingsExampleView : UserControl
{
    public SettingsExampleView() => InitializeComponent();

    private void OnThemeOptionChanged(object? sender, RoutedEventArgs e)
    {
        if (sender is not RadioButton { IsChecked: true } option || Application.Current is not { } application)
        {
            return;
        }

        application.RequestedThemeVariant = option.Name switch
        {
            nameof(ThemeLight) => ThemeVariant.Light,
            nameof(ThemeDark) => ThemeVariant.Dark,
            _ => ThemeVariant.Default,
        };
    }
}
