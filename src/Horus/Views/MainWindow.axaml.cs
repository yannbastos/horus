using Avalonia.Controls;

namespace Horus.Views;

public partial class MainWindow : Window
{
    public MainWindow() => InitializeComponent();

    private void OpenProduction(object? sender, EventArgs e) => NavProduction.IsChecked = true;

    private void OpenRadar(object? sender, EventArgs e) => NavRadar.IsChecked = true;
}
