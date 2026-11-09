using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Platform.Storage;
using Horus.ViewModels;

namespace Horus.Views;

public partial class TranscriptionView : UserControl
{
    private static readonly FilePickerFileType MediaFiles = new("Áudio e vídeo")
    {
        Patterns =
        [
            "*.mp3", "*.wav", "*.m4a", "*.aac", "*.flac", "*.ogg", "*.opus", "*.wma",
            "*.mp4", "*.mkv", "*.mov", "*.avi", "*.webm", "*.wmv", "*.flv", "*.m4v",
        ],
    };

    public TranscriptionView()
    {
        InitializeComponent();
        AddHandler(DragDrop.DragEnterEvent, OnDragOver);
        AddHandler(DragDrop.DragOverEvent, OnDragOver);
        AddHandler(DragDrop.DragLeaveEvent, (_, _) => SetDragging(false));
        AddHandler(DragDrop.DropEvent, OnDrop);
    }

    protected override void OnDataContextChanged(EventArgs e)
    {
        base.OnDataContextChanged(e);
        if (DataContext is not TranscriptionViewModel vm) return;

        // A janela é resolvida no momento do uso, pois o controle pode ainda não estar anexado.
        vm.PickFiles = async () =>
        {
            if (TopLevel.GetTopLevel(this) is not { } top) return [];
            var files = await top.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
            {
                Title = $"Adicionar à fila (até {TranscriptionViewModel.MaxQueue} arquivos)",
                AllowMultiple = true,
                FileTypeFilter = [MediaFiles, FilePickerFileTypes.All],
            });
            return files.Select(f => f.TryGetLocalPath()).OfType<string>().ToArray();
        };

        vm.PickDownloadFolder = async () =>
        {
            if (TopLevel.GetTopLevel(this) is not { } top) return null;
            var folders = await top.StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
            {
                Title = "Onde salvar o vídeo do YouTube?",
                AllowMultiple = false,
            });
            return folders.FirstOrDefault()?.TryGetLocalPath();
        };

        vm.PickSavePath = async suggested =>
        {
            if (TopLevel.GetTopLevel(this) is not { } top) return null;
            var file = await top.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
            {
                Title = "Salvar transcrição",
                SuggestedFileName = suggested,
                DefaultExtension = "txt",
                FileTypeChoices = [new FilePickerFileType("Texto") { Patterns = ["*.txt"] }],
            });
            return file?.TryGetLocalPath();
        };

        vm.CopyToClipboard = async text =>
        {
            if (TopLevel.GetTopLevel(this)?.Clipboard is { } clipboard) await clipboard.SetTextAsync(text);
        };
    }

    private bool CanAcceptDrop => DataContext is TranscriptionViewModel { IsBusy: false };

    private void OnDragOver(object? sender, DragEventArgs e)
    {
        var accepts = CanAcceptDrop && e.DataTransfer.Contains(DataFormat.File);
        e.DragEffects = accepts ? DragDropEffects.Copy : DragDropEffects.None;
        SetDragging(accepts);
    }

    private void OnDrop(object? sender, DragEventArgs e)
    {
        SetDragging(false);
        if (DataContext is not TranscriptionViewModel vm || vm.IsBusy) return;
        var paths = e.DataTransfer.TryGetFiles()?.Select(f => f.TryGetLocalPath()).OfType<string>();
        if (paths is not null) vm.EnqueueFiles(paths);
    }

    private void SetDragging(bool value) => DropZone.Classes.Set("dragging", value);
}
