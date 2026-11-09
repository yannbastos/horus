using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Whisper.net;
using Whisper.net.Ggml;

namespace Horus.Services;

public static class TranscriptionService
{
    private static readonly string LocalData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

    public static string ModelsDir { get; } = Path.Combine(LocalData, "Horus", "models");

    private static string ModelFileName(GgmlType type) => $"ggml-{type.ToString().ToLowerInvariant()}.bin";

    public static string ModelPath(GgmlType type) => Path.Combine(ModelsDir, ModelFileName(type));

    /// <summary>Baixa o modelo (uma única vez) se ainda não existir.</summary>
    public static async Task<string> EnsureModelAsync(GgmlType type, IProgress<string> status, CancellationToken ct)
    {
        var path = ModelPath(type);
        if (File.Exists(path)) return path;

        Directory.CreateDirectory(ModelsDir);
        var tmp = path + ".part";
        status.Report($"Baixando modelo {type} (só na primeira vez)...");

        await using (var src = await WhisperGgmlDownloader.Default.GetGgmlModelAsync(type, QuantizationType.NoQuantization, ct))
        await using (var dst = File.Create(tmp))
        {
            var buffer = new byte[1 << 20];
            long total = 0;
            int read;
            while ((read = await src.ReadAsync(buffer, ct)) > 0)
            {
                await dst.WriteAsync(buffer.AsMemory(0, read), ct);
                total += read;
                status.Report($"Baixando modelo {type}: {total / (1024 * 1024)} MB");
            }
        }
        File.Move(tmp, path, overwrite: true);
        return path;
    }

    /// <summary>Transcreve um arquivo de áudio ou vídeo e devolve o texto puro.</summary>
    public static async Task<string> TranscribeAsync(
        string inputPath,
        GgmlType model,
        string language,
        IProgress<string> status,
        IProgress<double> progress,
        Action<string> onSegment,
        CancellationToken ct)
    {
        var modelPath = await EnsureModelAsync(model, status, ct);

        status.Report("Extraindo áudio com ffmpeg...");
        var wav = await AudioConverter.ToWav16kMonoAsync(inputPath, ct);

        try
        {
            status.Report("Carregando modelo...");
            using var factory = WhisperFactory.FromPath(modelPath);

            var builder = factory.CreateBuilder()
                .WithLanguage(language)
                .WithProgressHandler(p => progress.Report(p));

            await using var processor = builder.Build();
            await using var stream = File.OpenRead(wav);

            status.Report("Transcrevendo...");
            var sb = new StringBuilder();
            await foreach (var seg in processor.ProcessAsync(stream, ct))
            {
                var text = seg.Text.Trim();
                if (text.Length == 0) continue;
                sb.AppendLine(text);
                onSegment(text);
            }
            progress.Report(100);
            return sb.ToString();
        }
        finally
        {
            AudioConverter.TryDelete(wav);
        }
    }
}
