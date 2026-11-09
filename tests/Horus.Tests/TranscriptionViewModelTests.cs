using Horus.ViewModels;

namespace Horus.Tests;

// Regras da fila de transcrição herdadas do app Thot.
public class TranscriptionViewModelTests
{
    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 1)]
    [InlineData(20, 20)]
    [InlineData(21, 20)]
    public void QueueIsBoundedIncludingCurrentAndPreservesOrder(int supplied, int accepted)
    {
        var vm = new TranscriptionViewModel();
        vm.EnqueueFiles(Enumerable.Range(0, supplied).Select(i => $"video-{i}.mp4"));
        Assert.Equal(accepted, vm.QueueCount);
        Assert.Equal(Enumerable.Range(0, accepted).Select(i => $"video-{i}.mp4"), vm.QueueFiles);
        Assert.Equal(accepted == 0 ? null : "video-0.mp4", vm.InputFile);
        Assert.Equal(accepted > 0, vm.TranscribeCommand.CanExecute(null));
        if (supplied > accepted) Assert.Contains("20", vm.Status);
    }

    [Fact]
    public async Task CompletionPausesAndSuccessfulSaveAllowsExplicitFifoAdvance()
    {
        var calls = new List<string>();
        var vm = new TranscriptionViewModel
        {
            RunTranscription = (file, _, _, _, _, segment, _) =>
            {
                calls.Add(file);
                segment("Texto de " + file);
                return Task.FromResult("Texto de " + file);
            }
        };
        vm.EnqueueFiles(["one.mp4", "two.wav", "three.mp3"]);
        await vm.TranscribeCommand.ExecuteAsync(null);
        Assert.Equal(["one.mp4"], calls);
        Assert.Equal("one.mp4", vm.InputFile);
        Assert.Contains("one.mp4", vm.Transcript);
        Assert.False(vm.TranscribeCommand.CanExecute(null));
        Assert.False(vm.NextCommand.CanExecute(null));
        await vm.NextCommand.ExecuteAsync(null); // guard even when invoked programmatically
        Assert.Equal(["one.mp4"], calls);
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".txt");
        try
        {
            vm.PickSavePath = _ => Task.FromResult<string?>(path);
            await vm.SaveCommand.ExecuteAsync(null);
            Assert.Equal(vm.Transcript, await File.ReadAllTextAsync(path, TestContext.Current.CancellationToken));
            Assert.True(vm.NextCommand.CanExecute(null));
            Assert.Equal(["one.mp4"], calls);
            await vm.NextCommand.ExecuteAsync(null);
            Assert.Equal(["one.mp4", "two.wav"], calls);
            Assert.Equal("two.wav", vm.InputFile);
            Assert.Equal(["two.wav", "three.mp3"], vm.QueueFiles);
            Assert.Contains("two.wav", vm.Transcript);
            Assert.False(vm.NextCommand.CanExecute(null));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task EditingAfterSaveRelocksNextEvenIfTextIsRestored()
    {
        var vm = new TranscriptionViewModel { RunTranscription = (_, _, _, _, _, _, _) => Task.FromResult("original") };
        vm.EnqueueFiles(["one.mp4", "two.mp4"]);
        await vm.TranscribeCommand.ExecuteAsync(null);
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".txt");
        try
        {
            vm.PickSavePath = _ => Task.FromResult<string?>(path);
            await vm.SaveCommand.ExecuteAsync(null);
            Assert.True(vm.NextCommand.CanExecute(null));
            vm.Transcript = "edited";
            Assert.False(vm.NextCommand.CanExecute(null));
            Assert.Contains("salvar novamente", vm.Status);
            vm.Transcript = "original";
            Assert.False(vm.NextCommand.CanExecute(null));
            await vm.NextCommand.ExecuteAsync(null);
            Assert.Equal("one.mp4", vm.InputFile);
        }
        finally { File.Delete(path); }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CanceledOrFailedSaveKeepsNextLocked(bool fail)
    {
        var vm = new TranscriptionViewModel { RunTranscription = (_, _, _, _, _, _, _) => Task.FromResult("texto") };
        vm.EnqueueFiles(["one", "two"]);
        await vm.TranscribeCommand.ExecuteAsync(null);
        vm.PickSavePath = _ => fail ? Task.FromResult<string?>(AppContext.BaseDirectory) : Task.FromResult<string?>(null);
        await vm.SaveCommand.ExecuteAsync(null);
        Assert.False(vm.NextCommand.CanExecute(null));
        Assert.Equal("texto", vm.Transcript);
        Assert.Equal("one", vm.InputFile);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailedOrCanceledAttemptPreservesPartialAndRetryKeepsSameCurrent(bool cancel)
    {
        var vm = new TranscriptionViewModel();
        vm.EnqueueFiles(["one", "two"]);
        vm.Transcript = "Texto anterior\n";
        vm.RunTranscription = (_, _, _, _, _, segment, _) =>
        {
            segment("parcial");
            return Task.FromException<string>(cancel ? new OperationCanceledException() : new IOException("falha"));
        };
        await vm.TranscribeCommand.ExecuteAsync(null);
        Assert.Equal("one", vm.InputFile);
        Assert.Contains("Texto anterior", vm.Transcript);
        Assert.Contains("parcial", vm.Transcript);
        Assert.True(vm.TranscribeCommand.CanExecute(null));
        Assert.False(vm.NextCommand.CanExecute(null));
        var preserved = vm.Transcript;
        vm.RunTranscription = (file, _, _, _, _, _, _) =>
        {
            Assert.Equal("one", file);
            Assert.Equal(preserved, vm.Transcript); // don't erase while retry starts
            return Task.FromResult("resultado completo");
        };
        await vm.TranscribeCommand.ExecuteAsync(null);
        Assert.Equal("resultado completo", vm.Transcript);
        Assert.Equal(2, vm.QueueCount);
        Assert.False(vm.NextCommand.CanExecute(null));
    }

    [Fact]
    public async Task CancelCommandKeepsPartialEvenIfRunnerReturnsNormally()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var vm = new TranscriptionViewModel
        {
            RunTranscription = async (_, _, _, _, _, segment, token) =>
            {
                segment("parcial");
                started.SetResult();
                await Task.Delay(Timeout.Infinite, token).ContinueWith(_ => { });
                return "";
            }
        };
        vm.EnqueueFiles(["one", "two"]);
        var attempt = vm.TranscribeCommand.ExecuteAsync(null);
        await started.Task;
        vm.CancelCommand.Execute(null);
        await attempt;
        Assert.Contains("parcial", vm.Transcript);
        Assert.Equal("one", vm.InputFile);
        Assert.True(vm.TranscribeCommand.CanExecute(null));
        Assert.False(vm.NextCommand.CanExecute(null));
    }

    [Fact]
    public async Task SaveDialogReservesCurrentAndEditingDuringSaveDoesNotUnlockNext()
    {
        var vm = new TranscriptionViewModel { RunTranscription = (_, _, _, _, _, _, _) => Task.FromResult("texto") };
        vm.EnqueueFiles(["one", "two"]);
        await vm.TranscribeCommand.ExecuteAsync(null);
        var picker = new TaskCompletionSource<string?>();
        vm.PickSavePath = _ => picker.Task;
        var saving = vm.SaveCommand.ExecuteAsync(null);
        Assert.True(vm.IsBusy);
        Assert.False(vm.NextCommand.CanExecute(null));
        vm.Transcript = "editado durante diálogo";
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".txt");
        try
        {
            picker.SetResult(path);
            await saving;
            Assert.False(vm.NextCommand.CanExecute(null));
            Assert.Equal("editado durante diálogo", vm.Transcript);
            Assert.False(vm.IsBusy);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public async Task BrowseAddsMultipleFilesInPickerOrderWithoutReplacingResult()
    {
        var vm = new TranscriptionViewModel { PickFiles = () => Task.FromResult<IReadOnlyList<string>>(["two", "three"]) };
        vm.SetInput("one");
        vm.Transcript = "não salvo";
        await vm.BrowseCommand.ExecuteAsync(null);
        Assert.Equal(["one", "two", "three"], vm.QueueFiles);
        Assert.Equal("one", vm.InputFile);
        Assert.Equal("não salvo", vm.Transcript);
    }

    [Fact]
    public async Task DownloadEnqueuesBehindUnsavedCurrent()
    {
        var vm = new TranscriptionViewModel
        {
            YouTubeUrl = "https://youtu.be/BaW_jenozKc",
            PickDownloadFolder = () => Task.FromResult<string?>("downloads"),
            RunDownload = (_, _, _, _) => Task.FromResult("downloaded.mp4")
        };
        vm.SetInput("one");
        vm.Transcript = "não salvo";
        await vm.DownloadVideoCommand.ExecuteAsync(null);
        Assert.Equal(["one", "downloaded.mp4"], vm.QueueFiles);
        Assert.Equal("one", vm.InputFile);
        Assert.Equal("não salvo", vm.Transcript);
        Assert.False(vm.NextCommand.CanExecute(null));
    }

    [Fact]
    public void FullQueueDisablesDownload()
    {
        var vm = new TranscriptionViewModel { YouTubeUrl = "https://youtu.be/BaW_jenozKc" };
        vm.EnqueueFiles(Enumerable.Repeat("one", 20));
        Assert.False(vm.DownloadVideoCommand.CanExecute(null));
    }

    [Fact]
    public async Task SilentSingleFileCanSaveEmptyTranscriptAndLaterEnqueueNext()
    {
        var vm = new TranscriptionViewModel { RunTranscription = (_, _, _, _, _, _, _) => Task.FromResult("") };
        vm.SetInput("silent.wav");
        await vm.TranscribeCommand.ExecuteAsync(null);
        Assert.True(vm.SaveCommand.CanExecute(null));
        Assert.False(vm.NextCommand.CanExecute(null));
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".txt");
        try
        {
            vm.PickSavePath = _ => Task.FromResult<string?>(path);
            await vm.SaveCommand.ExecuteAsync(null);
            Assert.True(File.Exists(path));
            Assert.Equal("", await File.ReadAllTextAsync(path, TestContext.Current.CancellationToken));
            Assert.Equal("silent.wav", vm.InputFile);
            Assert.False(vm.NextCommand.CanExecute(null));
            vm.SetInput("next.mp4");
            Assert.True(vm.NextCommand.CanExecute(null));
            await vm.NextCommand.ExecuteAsync(null);
            Assert.Equal("next.mp4", vm.InputFile);
            Assert.Equal(1, vm.QueueCount);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void AddingAnotherFileDoesNotReplaceCurrentInputOrText()
    {
        var vm = new TranscriptionViewModel();
        vm.SetInput("first.mp4");
        vm.Transcript = "Texto não salvo";
        vm.SetInput("second.wav");
        Assert.Equal("first.mp4", vm.InputFile);
        Assert.Equal("Texto não salvo", vm.Transcript);
    }

    [Fact]
    public async Task SavePickerFailurePreservesTranscriptAndReportsActionableError()
    {
        var vm = new TranscriptionViewModel
        {
            Transcript = "Texto que não deve ser perdido.",
            PickSavePath = _ => Task.FromException<string?>(new InvalidOperationException("Diálogo indisponível."))
        };
        var transcript = vm.Transcript;

        await vm.SaveCommand.ExecuteAsync(null);

        Assert.Equal(transcript, vm.Transcript);
        Assert.StartsWith("Erro ao salvar:", vm.Status);
        Assert.Contains("Diálogo indisponível.", vm.Status);
        Assert.Contains("tente novamente", vm.Status);
        Assert.True(vm.SaveCommand.CanExecute(null));
    }

    [Fact]
    public async Task SaveToDirectoryPreservesTranscriptAndReportsActionableError()
    {
        var vm = new TranscriptionViewModel
        {
            Transcript = "Texto que não deve ser perdido.",
            PickSavePath = _ => Task.FromResult<string?>(AppContext.BaseDirectory)
        };
        var transcript = vm.Transcript;

        await vm.SaveCommand.ExecuteAsync(null);

        Assert.Equal(transcript, vm.Transcript);
        Assert.StartsWith("Erro ao salvar:", vm.Status);
        Assert.Contains("Escolha outro local", vm.Status);
        Assert.True(vm.SaveCommand.CanExecute(null));
    }

    [Fact]
    public void DownloadRequiresValidUrlAndIdleState()
    {
        var vm = new TranscriptionViewModel();
        Assert.False(vm.DownloadVideoCommand.CanExecute(null));
        vm.YouTubeUrl = "https://youtu.be/BaW_jenozKc";
        Assert.True(vm.DownloadVideoCommand.CanExecute(null));
        vm.IsBusy = true;
        Assert.False(vm.DownloadVideoCommand.CanExecute(null));
    }

    [Fact]
    public async Task CompletionAndSaveDriveTheVisibleSteps()
    {
        var vm = new TranscriptionViewModel { RunTranscription = (_, _, _, _, _, _, _) => Task.FromResult("texto") };
        vm.EnqueueFiles(["C:/midia/aula.mp4", "two.mp4"]);
        Assert.Equal("aula.mp4", vm.CurrentFileName);
        Assert.False(vm.IsCompleted);
        await vm.TranscribeCommand.ExecuteAsync(null);
        Assert.True(vm.IsCompleted);
        Assert.False(vm.IsSaved);
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".txt");
        try
        {
            vm.PickSavePath = _ => Task.FromResult<string?>(path);
            await vm.SaveCommand.ExecuteAsync(null);
            Assert.True(vm.IsSaved);
            vm.Transcript = "editado";
            Assert.False(vm.IsSaved);
        }
        finally { File.Delete(path); }
    }
}
