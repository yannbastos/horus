using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Text;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Horus.Services;
using Whisper.net.Ggml;

namespace Horus.ViewModels;

public sealed record ModelOption(GgmlType Type, string Label)
{
    public override string ToString() => Label;
}

public sealed record LanguageOption(string Code, string Label)
{
    public override string ToString() => Label;
}

public delegate Task<string> TranscriptionRunner(string file, GgmlType model, string language,
    IProgress<string> status, IProgress<double> progress, Action<string> segment, CancellationToken token);

/// <summary>
/// Fila de transcrição: até 20 arquivos (incluindo o atual), processados um por vez.
/// Ao concluir, o app pausa; só depois de salvar a versão atual do texto é possível avançar.
/// </summary>
public sealed partial class TranscriptionViewModel : ObservableObject
{
    public const int MaxQueue = 20;

    private readonly ObservableCollection<string> _queue = [];
    private CancellationTokenSource? _cts;
    private long _transcriptRevision;

    public TranscriptionViewModel()
    {
        QueueFiles = new(_queue);
        SelectedModel = Models[2];
        SelectedLanguage = Languages[0];
        if (AudioConverter.FindFfmpeg() is null)
            Status = "ffmpeg não encontrado. Instale com: winget install Gyan.FFmpeg";
    }

    public IReadOnlyList<ModelOption> Models { get; } =
    [
        new(GgmlType.Tiny, "Tiny · ~75 MB · mais rápido"),
        new(GgmlType.Base, "Base · ~142 MB"),
        new(GgmlType.Small, "Small · ~466 MB · equilíbrio"),
        new(GgmlType.Medium, "Medium · ~1,5 GB"),
        new(GgmlType.LargeV3Turbo, "Large v3 Turbo · ~1,6 GB · melhor qualidade"),
    ];

    public IReadOnlyList<LanguageOption> Languages { get; } =
    [
        new("auto", "Detectar automaticamente"),
        new("pt", "Português"),
        new("en", "Inglês"),
        new("es", "Espanhol"),
    ];

    /// <summary>Injetados pela View (diálogos e área de transferência dependem da janela).</summary>
    public Func<Task<IReadOnlyList<string>>>? PickFiles { get; set; }
    public Func<Task<string?>>? PickDownloadFolder { get; set; }
    public Func<string, Task<string?>>? PickSavePath { get; set; }
    public Func<string, Task>? CopyToClipboard { get; set; }

    public TranscriptionRunner RunTranscription { get; set; } = TranscriptionService.TranscribeAsync;

    public Func<string, string, IProgress<string>, CancellationToken, Task<string>> RunDownload { get; set; }
        = YouTubeDownloadService.DownloadAsync;

    [ObservableProperty] public partial ModelOption SelectedModel { get; set; }
    [ObservableProperty] public partial LanguageOption SelectedLanguage { get; set; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(DownloadVideoCommand))]
    public partial string YouTubeUrl { get; set; } = "";

    [ObservableProperty] public partial bool IsDownloading { get; set; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(TranscribeCommand))]
    [NotifyPropertyChangedFor(nameof(CurrentFileName), nameof(HasInput))]
    public partial string? InputFile { get; set; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(TranscribeCommand), nameof(CancelCommand), nameof(NextCommand),
        nameof(SaveCommand), nameof(DownloadVideoCommand), nameof(BrowseCommand))]
    [NotifyPropertyChangedFor(nameof(IsIdle))]
    public partial bool IsBusy { get; set; }

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    public partial string Transcript { get; set; } = "";

    [ObservableProperty] public partial string Status { get; set; } = "Adicione um arquivo de áudio ou vídeo para começar.";
    [ObservableProperty] public partial double Progress { get; set; }

    /// <summary>A transcrição do arquivo atual terminou com sucesso.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(TranscribeCommand), nameof(NextCommand), nameof(SaveCommand))]
    public partial bool IsCompleted { get; private set; }

    /// <summary>A versão atual do texto foi salva com sucesso.</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(NextCommand))]
    public partial bool IsSaved { get; private set; }

    public bool IsIdle => !IsBusy;
    public bool HasInput => !string.IsNullOrEmpty(InputFile);
    public string CurrentFileName => HasInput ? Path.GetFileName(InputFile!) : "Nenhum arquivo";

    public ReadOnlyObservableCollection<string> QueueFiles { get; }
    public int QueueCount => _queue.Count;
    public bool HasQueue => _queue.Count > 0;
    public string QueueSummary => $"{QueueCount}/{MaxQueue}";

    public void EnqueueFiles(IEnumerable<string> files)
    {
        var rejected = 0;
        foreach (var file in files)
        {
            if (string.IsNullOrWhiteSpace(file)) continue;
            if (_queue.Count == MaxQueue) { rejected++; continue; }
            _queue.Add(file);
            InputFile ??= file;
        }
        OnQueueChanged();
        Status = rejected > 0
            ? $"Limite de {MaxQueue} arquivos. {rejected} não adicionado(s)."
            : $"Fila: {QueueSummary}. Clique em Transcrever para iniciar o arquivo atual.";
    }

    public void SetInput(string file) => EnqueueFiles([file]);

    private void OnQueueChanged()
    {
        NextCommand.NotifyCanExecuteChanged();
        DownloadVideoCommand.NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(QueueCount));
        OnPropertyChanged(nameof(QueueSummary));
        OnPropertyChanged(nameof(HasQueue));
    }

    partial void OnTranscriptChanged(string value)
    {
        if (IsCompleted && !IsBusy) Status = "Texto editado: é necessário salvar novamente antes de Próximo vídeo.";
        IsSaved = false;
        _transcriptRevision++;
    }

    private bool CanBrowse() => !IsBusy;

    [RelayCommand(CanExecute = nameof(CanBrowse))]
    private async Task Browse()
    {
        if (PickFiles is null) return;
        EnqueueFiles(await PickFiles());
    }

    private bool CanDownloadVideo() => !IsBusy && QueueCount < MaxQueue && YouTubeDownloadService.IsValidUrl(YouTubeUrl);

    [RelayCommand(CanExecute = nameof(CanDownloadVideo))]
    private async Task DownloadVideo()
    {
        if (!CanDownloadVideo() || PickDownloadFolder is null) return;
        // Reserva o estado ocupado antes de abrir o diálogo.
        IsBusy = true;
        try
        {
            var directory = await PickDownloadFolder();
            if (directory is null) return;
            _cts = new CancellationTokenSource();
            IsDownloading = true;
            Progress = 0;
            Status = "Iniciando download do YouTube...";
            IProgress<string> status = new Progress<string>(s => Status = s);
            var file = await RunDownload(YouTubeUrl, directory, status, _cts.Token);
            SetInput(file);
            Progress = 100;
            YouTubeUrl = "";
            Status = $"Vídeo salvo em {file}. Adicionado ao final da fila; o resultado atual foi preservado.";
        }
        catch (OperationCanceledException) { Status = "Download cancelado. Arquivos parciais podem ser retomados na mesma pasta."; }
        catch (Exception ex) { Status = "Erro no download: " + ex.Message; }
        finally
        {
            IsDownloading = false;
            _cts?.Dispose();
            _cts = null;
            IsBusy = false;
        }
    }

    private bool CanNext() => !IsBusy && IsCompleted && IsSaved && QueueCount > 1;

    [RelayCommand(CanExecute = nameof(CanNext))]
    private async Task Next()
    {
        if (!CanNext()) return;
        _queue.RemoveAt(0);
        InputFile = _queue[0];
        Transcript = "";
        IsCompleted = false;
        IsSaved = false;
        OnQueueChanged();
        await Transcribe();
    }

    private bool CanTranscribe() => !IsBusy && !IsCompleted && HasInput;

    [RelayCommand(CanExecute = nameof(CanTranscribe))]
    private async Task Transcribe()
    {
        if (!CanTranscribe()) return;
        IsBusy = true;
        IsSaved = false;
        Progress = 0;
        _cts = new CancellationTokenSource();
        var sw = Stopwatch.StartNew();

        // Buffer síncrono: callbacks de Progress<T> podem chegar depois que o trabalho terminou.
        var active = true;
        var previousText = Transcript;
        var partial = new StringBuilder();
        var gate = new object();
        IProgress<string> status = new Progress<string>(s => { if (active) Status = s; });
        IProgress<double> progress = new Progress<double>(p => { if (active) Progress = p; });
        IProgress<string> preview = new Progress<string>(text => { if (active) Transcript = text; });
        void Segment(string text)
        {
            lock (gate)
            {
                partial.AppendLine(text);
                preview.Report(previousText + partial);
            }
        }

        try
        {
            var model = SelectedModel.Type;
            var lang = SelectedLanguage.Code;
            var file = InputFile!;
            var token = _cts.Token;
            var result = await Task.Run(() => RunTranscription(file, model, lang, status, progress, Segment, token));
            active = false;
            token.ThrowIfCancellationRequested();
            Transcript = result;
            IsCompleted = true;
            Progress = 100;
            Status = $"Concluído em {sw.Elapsed:mm\\:ss}. Salve o .txt antes de Próximo vídeo.";
        }
        catch (OperationCanceledException)
        {
            Status = "Cancelado. Texto parcial preservado; Transcrever tenta novamente o mesmo arquivo.";
        }
        catch (Exception ex)
        {
            Status = "Erro: " + ex.Message;
        }
        finally
        {
            active = false;
            if (!IsCompleted)
            {
                lock (gate) Transcript = previousText + partial;
            }
            IsBusy = false;
            _cts.Dispose();
            _cts = null;
        }
    }

    private bool CanCancel() => IsBusy;

    [RelayCommand(CanExecute = nameof(CanCancel))]
    private void Cancel() => _cts?.Cancel();

    private bool CanSave() => !IsBusy && (IsCompleted || !string.IsNullOrWhiteSpace(Transcript));

    [RelayCommand(CanExecute = nameof(CanSave))]
    private async Task Save()
    {
        if (!CanSave() || PickSavePath is null) return;
        IsBusy = true;
        IsSaved = false;
        var revision = _transcriptRevision;
        var text = Transcript;
        try
        {
            var suggested = Path.GetFileNameWithoutExtension(InputFile ?? "transcricao") + ".txt";
            var path = await PickSavePath(suggested);
            if (path is null) return;
            await File.WriteAllTextAsync(path, text);
            IsSaved = revision == _transcriptRevision;
            Status = IsSaved ? $"Salvo em {path}" : $"Salvo em {path}, mas o texto foi editado. Salve novamente antes de avançar.";
        }
        catch (Exception ex)
        {
            Status = $"Erro ao salvar: {ex.Message} Escolha outro local ou verifique as permissões e tente novamente. A transcrição foi preservada.";
        }
        finally { IsBusy = false; }
    }

    [RelayCommand]
    private async Task Copy()
    {
        if (CopyToClipboard is null || string.IsNullOrEmpty(Transcript)) return;
        await CopyToClipboard(Transcript);
        Status = "Texto copiado.";
    }
}
