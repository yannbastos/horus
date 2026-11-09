using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Horus.ViewModels;
using Horus.Views;

namespace Horus.Tests;

public class TranscriptionViewTests
{
    [AvaloniaFact]
    public void Transcription_is_the_screen_shown_at_startup()
    {
        var window = new MainWindow { DataContext = new MainWindowViewModel() };
        window.Show();

        Assert.True(window.GetControl<TranscriptionView>("TranscriptionView").IsVisible);
        Assert.False(window.GetControl<UserControl>("HomeView").IsVisible);

        window.Close();
    }

    [AvaloniaFact]
    public void Screen_reflects_queue_and_current_file()
    {
        var viewModel = new MainWindowViewModel();
        var window = new MainWindow { DataContext = viewModel };
        window.Show();
        var view = window.GetControl<TranscriptionView>("TranscriptionView");

        Assert.Same(viewModel.Transcription, view.DataContext);
        Assert.Equal("0/20", view.GetControl<TextBlock>("QueueSummaryText").Text);
        Assert.False(view.GetControl<Button>("TranscribeButton").IsEffectivelyEnabled);

        viewModel.Transcription.EnqueueFiles(["aula-01.mp4", "aula-02.mp4"]);

        Assert.Equal("2/20", view.GetControl<TextBlock>("QueueSummaryText").Text);
        Assert.Equal("aula-01.mp4", view.GetControl<TextBlock>("CurrentFileText").Text);
        Assert.True(view.GetControl<Button>("TranscribeButton").IsEffectivelyEnabled);
        Assert.False(view.GetControl<Button>("NextButton").IsEffectivelyEnabled);

        window.Close();
    }

    [AvaloniaFact]
    public void Transcript_is_read_only_while_busy()
    {
        var viewModel = new MainWindowViewModel();
        var window = new MainWindow { DataContext = viewModel };
        window.Show();
        var transcript = window.GetControl<TranscriptionView>("TranscriptionView").GetControl<TextBox>("TranscriptBox");

        Assert.False(transcript.IsReadOnly);
        viewModel.Transcription.IsBusy = true;
        Assert.True(transcript.IsReadOnly);

        window.Close();
    }
}
