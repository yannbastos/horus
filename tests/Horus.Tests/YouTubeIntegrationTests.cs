using Horus.Services;

namespace Horus.Tests;

public class YouTubeIntegrationTests
{
    [Fact]
    [Trait("Category", "Network")]
    public async Task DownloadsRealVideoAndCancellationStopsProcess()
    {
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Horus", "integration-tests");
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(3));
        var path = await YouTubeDownloadService.DownloadAsync("https://youtu.be/jNQXAC9IVRw", folder,
            new Progress<string>(Console.WriteLine), timeout.Token);
        Assert.True(File.Exists(path));
        Assert.True(new FileInfo(path).Length > 1000);
        Console.WriteLine("Downloaded: " + path);
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => YouTubeDownloadService.DownloadAsync(
            "https://youtu.be/jNQXAC9IVRw", folder, new Progress<string>(), cancelled.Token));
    }
}
