using Avalonia.Data.Converters;

namespace Horus.Views;

public static class ViewConverters
{
    /// <summary>Mostra apenas o nome do arquivo de um caminho completo.</summary>
    public static FuncValueConverter<string?, string> FileName { get; } =
        new(path => string.IsNullOrEmpty(path) ? "" : Path.GetFileName(path));

    /// <summary>Mostra apenas a pasta de um caminho completo.</summary>
    public static FuncValueConverter<string?, string> Folder { get; } =
        new(path => string.IsNullOrEmpty(path) ? "" : Path.GetDirectoryName(path) ?? "");
}
