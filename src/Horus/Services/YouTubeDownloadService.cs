using System;
using System.Linq;
using System.Text.RegularExpressions;

namespace Horus.Services;

public static partial class YouTubeDownloadService
{
    private const string FileMarker = "HORUS_FILE:";

    public static bool IsValidUrl(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != "https" || !string.IsNullOrEmpty(uri.UserInfo)) return false;
        if (uri.Host == "youtu.be") return VideoId().IsMatch(uri.AbsolutePath.Trim('/'));
        if (uri.Host is not ("youtube.com" or "www.youtube.com" or "m.youtube.com" or "music.youtube.com")) return false;
        var parts = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 2 && parts[0] is "shorts" or "live" or "embed") return VideoId().IsMatch(parts[1]);
        return uri.AbsolutePath == "/watch" && uri.Query.TrimStart('?').Split('&')
            .Any(p => p.StartsWith("v=", StringComparison.Ordinal) && VideoId().IsMatch(p[2..]));
    }

    public static System.Diagnostics.ProcessStartInfo CreateStartInfo(string executable, string url, string directory, string? ffmpeg)
    {
        if (!IsValidUrl(url)) throw new ArgumentException("Informe um link válido de vídeo do YouTube.");
        var start = new System.Diagnostics.ProcessStartInfo(executable)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
        };
        foreach (var arg in new[] { "--ignore-config", "--js-runtimes", "node", "--no-playlist", "--no-overwrites", "--newline", "--progress", "--no-colors",
            "--socket-timeout", "20", "--retries", "3", "--windows-filenames", "--trim-filenames", "150",
            "-P", directory, "-o", "%(title).150B [%(id)s].%(ext)s",
            "-f", ffmpeg is null ? "best[ext=mp4]/best" : "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
            "--merge-output-format", "mp4", "--print", "after_move:HORUS_FILE:%(filepath)s" }) start.ArgumentList.Add(arg);
        if (ffmpeg is not null) { start.ArgumentList.Add("--ffmpeg-location"); start.ArgumentList.Add(ffmpeg); }
        start.ArgumentList.Add("--"); start.ArgumentList.Add(url);
        return start;
    }

    public static string? FindDownloader()
    {
        var name = OperatingSystem.IsWindows() ? "yt-dlp.exe" : "yt-dlp";
        var localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (var dir in new[] { AppContext.BaseDirectory, System.IO.Path.Combine(localData, "Horus", "tools") }
            .Concat((Environment.GetEnvironmentVariable("PATH") ?? "").Split(System.IO.Path.PathSeparator)))
        {
            try { var path = System.IO.Path.Combine(dir.Trim('"'), name); if (System.IO.File.Exists(path)) return path; }
            catch (ArgumentException) { }
        }
        return null;
    }

    public static async System.Threading.Tasks.Task<string> DownloadAsync(string url, string directory,
        IProgress<string> status, System.Threading.CancellationToken ct)
    {
        if (!IsValidUrl(url)) throw new ArgumentException("Informe um link válido de vídeo do YouTube.");
        var executable = FindDownloader() ?? throw new InvalidOperationException(
            "yt-dlp não encontrado. Instale com winget install yt-dlp.yt-dlp ou coloque yt-dlp.exe na pasta do app.");
        System.IO.Directory.CreateDirectory(directory);
        using var process = System.Diagnostics.Process.Start(CreateStartInfo(executable, url, directory, AudioConverter.FindFfmpeg()))
            ?? throw new InvalidOperationException("Não foi possível iniciar yt-dlp.");
        string? result = null;
        var errors = new System.Collections.Generic.Queue<string>();
        async System.Threading.Tasks.Task Read(System.IO.StreamReader reader, bool error)
        {
            while (await reader.ReadLineAsync(ct) is { } line)
            {
                if (line.StartsWith(FileMarker, StringComparison.Ordinal)) result = line[FileMarker.Length..];
                else
                {
                    status.Report(line);
                    if (error) { errors.Enqueue(line); if (errors.Count > 12) errors.Dequeue(); }
                }
            }
        }
        var stdout = Read(process.StandardOutput, false);
        var stderr = Read(process.StandardError, true);
        try
        {
            await System.Threading.Tasks.Task.WhenAll(process.WaitForExitAsync(ct), stdout, stderr);
            ct.ThrowIfCancellationRequested();
            if (process.ExitCode != 0) throw new InvalidOperationException(
                "Falha no download: " + string.Join(Environment.NewLine, errors));
            if (string.IsNullOrWhiteSpace(result) || !System.IO.File.Exists(result))
                throw new InvalidOperationException("yt-dlp não retornou um arquivo de vídeo válido.");
            return System.IO.Path.GetFullPath(result);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); }
            catch (InvalidOperationException) { }
            throw;
        }
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{11}$")]
    private static partial Regex VideoId();
}
