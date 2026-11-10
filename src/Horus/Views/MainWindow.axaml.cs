using Avalonia.Controls;

namespace Horus.Views;

public partial class MainWindow : Window
{
    public MainWindow() => InitializeComponent();

    private void OpenTranscription(object? sender, EventArgs e) => NavTranscription.IsChecked = true;

    private void OpenRadar(object? sender, EventArgs e) => NavRadar.IsChecked = true;
}
