using Avalonia;
using Avalonia.Headless;
using Horus.Tests;

[assembly: AvaloniaTestApplication(typeof(TestAppBuilder))]

namespace Horus.Tests;

public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UseHeadless(new AvaloniaHeadlessPlatformOptions());
}
