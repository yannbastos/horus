namespace Horus.ViewModels;

/// <summary>Conteúdo editorial das prévias de layout, sem dados ou operações de backend.</summary>
public sealed record WorkspaceSection(
    string Caption,
    string Title,
    string Description,
    string EmptyTitle,
    string EmptyDescription,
    IReadOnlyList<WorkspaceFeature> Features);

public sealed record WorkspaceFeature(string Title, string Description);
