using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Media;
using Avalonia.Styling;
using Horus.ViewModels;
using Horus.Views;

namespace Horus.Tests;

public class ThemeTests
{
    private const double MinimumTextContrast = 4.5;

    private static readonly string[] TextBrushes =
    [
        "HorusInkBrush",
        "HorusInkStrongBrush",
        "HorusMutedBrush",
        "HorusFaintBrush",
        "HorusAccentInkBrush",
        "HorusGoodBrush",
        "HorusWarnBrush",
        "HorusBadBrush",
    ];

    [AvaloniaTheory]
    [InlineData("Dark", "HorusBackgroundBrush")]
    [InlineData("Dark", "HorusSunkenBrush")]
    [InlineData("Light", "HorusBackgroundBrush")]
    [InlineData("Light", "HorusSunkenBrush")]
    public void Text_colors_are_readable_on_surfaces(string variantName, string surfaceBrush)
    {
        var variant = VariantFrom(variantName);
        var surface = ColorOf(surfaceBrush, variant);

        foreach (var textBrush in TextBrushes)
        {
            var contrast = ContrastRatio(ColorOf(textBrush, variant), surface);

            Assert.True(
                contrast >= MinimumTextContrast,
                $"{textBrush} on {surfaceBrush} ({variantName}) has contrast {contrast:F2}:1");
        }
    }

    [AvaloniaFact]
    public void Primary_button_text_is_readable_in_both_themes()
    {
        foreach (var variant in new[] { ThemeVariant.Dark, ThemeVariant.Light })
        {
            var contrast = ContrastRatio(
                ColorOf("HorusInvertForegroundBrush", variant),
                ColorOf("HorusInvertBackgroundBrush", variant));

            Assert.True(contrast >= MinimumTextContrast, $"{variant}: {contrast:F2}:1");
        }
    }

    [AvaloniaTheory]
    [InlineData("HorusDisplayFont", "Archivo")]
    [InlineData("HorusBodyFont", "Inter")]
    [InlineData("HorusMonoFont", "Geist Mono")]
    public void Theme_fonts_load_without_falling_back(string fontKey, string expectedFamily)
    {
        Assert.True(Application.Current!.TryGetResource(fontKey, null, out var resource));
        var family = Assert.IsType<FontFamily>(resource);

        Assert.True(
            FontManager.Current.TryGetGlyphTypeface(new Typeface(family), out var typeface),
            $"{fontKey} could not be loaded");
        Assert.StartsWith(expectedFamily, typeface.FamilyName);
    }

    [AvaloniaFact]
    public void Window_background_follows_the_active_theme()
    {
        var application = Application.Current!;
        var original = application.RequestedThemeVariant;
        var window = new MainWindow { DataContext = new MainWindowViewModel() };
        window.Show();

        try
        {
            application.RequestedThemeVariant = ThemeVariant.Dark;
            Assert.Equal(ColorOf("HorusBackgroundBrush", ThemeVariant.Dark), BackgroundOf(window));

            application.RequestedThemeVariant = ThemeVariant.Light;
            Assert.Equal(ColorOf("HorusBackgroundBrush", ThemeVariant.Light), BackgroundOf(window));
        }
        finally
        {
            window.Close();
            application.RequestedThemeVariant = original;
        }
    }

    private static ThemeVariant VariantFrom(string name) =>
        name == "Dark" ? ThemeVariant.Dark : ThemeVariant.Light;

    private static Color BackgroundOf(Window window) =>
        Assert.IsAssignableFrom<ISolidColorBrush>(window.Background).Color;

    private static Color ColorOf(string brushKey, ThemeVariant variant)
    {
        Assert.True(
            Application.Current!.TryGetResource(brushKey, variant, out var resource),
            $"Missing resource {brushKey} for {variant}");

        return Assert.IsAssignableFrom<ISolidColorBrush>(resource).Color;
    }

    // WCAG 2.x: https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
    private static double ContrastRatio(Color first, Color second)
    {
        var lighter = Math.Max(Luminance(first), Luminance(second));
        var darker = Math.Min(Luminance(first), Luminance(second));

        return (lighter + 0.05) / (darker + 0.05);
    }

    private static double Luminance(Color color) =>
        (0.2126 * Linear(color.R)) + (0.7152 * Linear(color.G)) + (0.0722 * Linear(color.B));

    private static double Linear(byte channel)
    {
        var value = channel / 255.0;

        return value <= 0.04045 ? value / 12.92 : Math.Pow((value + 0.055) / 1.055, 2.4);
    }
}
