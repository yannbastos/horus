using Avalonia.Controls;
using Avalonia.Interactivity;

namespace Horus.Views;

public partial class OverviewView : UserControl
{
    public event EventHandler? TranscriptionRequested;
    public event EventHandler? RadarRequested;

    public OverviewView() => InitializeComponent();

    private void RequestTranscription(object? sender, RoutedEventArgs e) =>
        TranscriptionRequested?.Invoke(this, EventArgs.Empty);

    private void RequestRadar(object? sender, RoutedEventArgs e) =>
        RadarRequested?.Invoke(this, EventArgs.Empty);
}
