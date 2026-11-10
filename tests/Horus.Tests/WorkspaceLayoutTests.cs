using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.Media.Imaging;
using Avalonia.Styling;
using Horus.ViewModels;
using Horus.Views;

namespace Horus.Tests;

public class WorkspaceLayoutTests
{
    [AvaloniaTheory]
    [InlineData("OpenTranscriptionButton", "TranscriptionView")]
    [InlineData("OpenRadarButton", "RadarView")]
    public void Overview_actions_open_the_corresponding_section(string buttonName, string screenName)
    {
        var window = new MainWindow { DataContext = new MainWindowViewModel() };
        window.Show();
        try
        {
            window.GetControl<OverviewView>("HomeView").GetControl<Button>(buttonName)
                .RaiseEvent(new RoutedEventArgs(Button.ClickEvent));

            Assert.True(window.GetControl<UserControl>(screenName).IsVisible);
            Assert.False(window.GetControl<OverviewView>("HomeView").IsVisible);
        }
        finally { window.Close(); }
    }

    [AvaloniaFact]
    public void Navigating_between_sections_preserves_the_transcription_workspace()
    {
        var model = new MainWindowViewModel();
        model.Transcription.EnqueueFiles(["referencia.mp4"]);
        model.Transcription.Transcript = "Texto em revisão.";
        var window = new MainWindow { DataContext = model };
        window.Show();
        try
        {
            window.GetControl<RadioButton>("NavTranscription").IsChecked = true;
            window.GetControl<RadioButton>("NavProduction").IsChecked = true;
            window.GetControl<RadioButton>("NavTranscription").IsChecked = true;

            Assert.Same(model.Transcription, window.GetControl<TranscriptionView>("TranscriptionView").DataContext);
            Assert.Equal("referencia.mp4", model.Transcription.InputFile);
            Assert.Equal("Texto em revisão.", model.Transcription.Transcript);
            Assert.Single(model.Transcription.QueueFiles);
        }
        finally { window.Close(); }
    }

    [AvaloniaTheory]
    [InlineData(1040, 680, "Dark")]
    [InlineData(1040, 680, "Light")]
    [InlineData(1320, 840, "Dark")]
    [InlineData(1320, 840, "Light")]
    public void Overview_keeps_primary_action_inside_the_window(int width, int height, string theme)
    {
        var application = Application.Current!;
        var originalTheme = application.RequestedThemeVariant;
        var window = new MainWindow { DataContext = new MainWindowViewModel(), Width = width, Height = height };
        try
        {
            application.RequestedThemeVariant = theme == "Dark" ? ThemeVariant.Dark : ThemeVariant.Light;
            window.Show();
            window.UpdateLayout();
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();

            var button = window.GetControl<OverviewView>("HomeView").GetControl<Button>("OpenTranscriptionButton");
            var position = button.TranslatePoint(new Point(), window);
            Assert.NotNull(position);
            Assert.True(button.Bounds.Width > 0);
            Assert.InRange(position.Value.X, 0, window.ClientSize.Width - button.Bounds.Width);
            Assert.InRange(position.Value.Y, 0, window.ClientSize.Height - button.Bounds.Height);

            // Exportação opcional para inspeção visual, fora dos arquivos versionados.
            var previewDirectory = Environment.GetEnvironmentVariable("HORUS_LAYOUT_PREVIEW_DIR");
            if (!string.IsNullOrWhiteSpace(previewDirectory))
            {
                Directory.CreateDirectory(previewDirectory);
                using var frame = window.CaptureRenderedFrame();
                Assert.NotNull(frame);
                frame.Save(Path.Combine(previewDirectory, $"overview-{theme.ToLowerInvariant()}-{width}.png"), PngBitmapEncoderOptions.Default);
            }
        }
        finally
        {
            window.Close();
            application.RequestedThemeVariant = originalTheme;
        }
    }
}
