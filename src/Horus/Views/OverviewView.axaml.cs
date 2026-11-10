using Avalonia.Controls;
using Avalonia.Interactivity;

namespace Horus.Views;

public partial class OverviewView : UserControl
{
    public event EventHandler? ProductionRequested;
    public event EventHandler? RadarRequested;

    public OverviewView() => InitializeComponent();

    private void RequestProduction(object? sender, RoutedEventArgs e) =>
        ProductionRequested?.Invoke(this, EventArgs.Empty);

    private void RequestRadar(object? sender, RoutedEventArgs e) =>
        RadarRequested?.Invoke(this, EventArgs.Empty);
}
