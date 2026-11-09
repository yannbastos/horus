using Horus.Services;

namespace Horus.Tests;

public class YouTubeDownloadTests
{
    [Fact]
    public void DownloadUsesSafeArgumentsAndReportsFinalPath()
    {
        var method = typeof(YouTubeDownloadService).GetMethod("CreateStartInfo");
        Assert.NotNull(method);
        var start = Assert.IsType<System.Diagnostics.ProcessStartInfo>(method.Invoke(null,
            ["yt-dlp", "https://youtu.be/BaW_jenozKc", "C:/Videos", null]));
        Assert.False(start.UseShellExecute);
        Assert.Contains("--js-runtimes", start.ArgumentList);
        Assert.Contains("node", start.ArgumentList);
        Assert.Contains("--ignore-config", start.ArgumentList);
        Assert.Contains("--no-playlist", start.ArgumentList);
        Assert.Contains("after_move:HORUS_FILE:%(filepath)s", start.ArgumentList);
        Assert.Equal("https://youtu.be/BaW_jenozKc", start.ArgumentList.Last());
        Assert.Equal("--", start.ArgumentList[^2]);
    }

    [Theory]
    [InlineData("https://www.youtube.com/watch?v=BaW_jenozKc", true)]
    [InlineData("https://youtu.be/BaW_jenozKc", true)]
    [InlineData("https://m.youtube.com/shorts/BaW_jenozKc", true)]
    [InlineData("https://youtube.com.evil.org/watch?v=x", false)]
    [InlineData("file:///C:/test", false)]
    [InlineData("--exec calc", false)]
    [InlineData("https://youtube.com/playlist?list=test", false)]
    public void ValidatesSingleYouTubeVideo(string url, bool expected)
    {
        var type = typeof(AudioConverter).Assembly.GetType("Horus.Services.YouTubeDownloadService");
        Assert.NotNull(type);
        var method = type.GetMethod("IsValidUrl");
        Assert.NotNull(method);
        Assert.Equal(expected, method.Invoke(null, [url]));
    }
}
