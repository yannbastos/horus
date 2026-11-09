using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Horus.Services;

/// <summary>
/// Converte qualquer áudio/vídeo para WAV PCM 16 kHz mono (formato exigido pelo Whisper) usando ffmpeg.
/// </summary>
public static class AudioConverter
{
    public static string? FindFfmpeg()
    {
        var exe = OperatingSystem.IsWindows() ? "ffmpeg.exe" : "ffmpeg";

        // 1) ao lado do executável do app
        var local = Path.Combine(AppContext.BaseDirectory, exe);
        if (File.Exists(local)) return local;

        // 2) no PATH
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var candidate = Path.Combine(dir.Trim('"'), exe);
                if (File.Exists(candidate)) return candidate;
            }
            catch { /* entrada inválida no PATH */ }
        }
        return null;
    }

    public static async Task<string> ToWav16kMonoAsync(string inputPath, CancellationToken ct)
    {
        var ffmpeg = FindFfmpeg() ?? throw new InvalidOperationException(
            "ffmpeg não encontrado. Instale (ex.: winget install Gyan.FFmpeg) ou coloque ffmpeg.exe na pasta do app.");

        var output = Path.Combine(Path.GetTempPath(), $"horus_{Guid.NewGuid():N}.wav");

        var psi = new ProcessStartInfo(ffmpeg)
        {
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in new[] { "-nostdin", "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output })
            psi.ArgumentList.Add(a);

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Falha ao iniciar ffmpeg.");
        var stderrTask = proc.StandardError.ReadToEndAsync(ct);
        _ = proc.StandardOutput.ReadToEndAsync(ct);

        try
        {
            await proc.WaitForExitAsync(ct);
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(true); } catch { }
            TryDelete(output);
            throw;
        }

        if (proc.ExitCode != 0 || !File.Exists(output))
        {
            var err = await stderrTask;
            TryDelete(output);
            var tail = err.Length > 800 ? err[^800..] : err;
            throw new InvalidOperationException($"ffmpeg falhou (código {proc.ExitCode}):\n{tail}");
        }
        return output;
    }

    public static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }
}
