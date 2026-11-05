using Avalonia;
using Avalonia.Headless;
using Horus.Tests;

[assembly: AvaloniaTestApplication(typeof(TestAppBuilder))]

namespace Horus.Tests;

public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UseSkia()
            .WithInterFont()
            .UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false });
}
