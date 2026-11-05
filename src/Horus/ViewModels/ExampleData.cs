using Avalonia.Media;
using Avalonia.Media.Immutable;

namespace Horus.ViewModels;

// Dados fictícios para avaliar o design. Não representam funcionalidades do produto.
public sealed record ExampleCard(
    string Number,
    string Title,
    string Description,
    string Status,
    string Meta,
    string Action,
    IBrush Color);

public sealed record ExampleSubject(
    string Name,
    string Description,
    string Status,
    double Progress,
    string Next,
    string Action,
    IBrush Color);

public static class ExampleData
{
    private static readonly IBrush Blue = new ImmutableSolidColorBrush(Color.Parse("#2D81FF"));
    private static readonly IBrush Coral = new ImmutableSolidColorBrush(Color.Parse("#EE6A52"));
    private static readonly IBrush Purple = new ImmutableSolidColorBrush(Color.Parse("#9B7BFF"));
    private static readonly IBrush Amber = new ImmutableSolidColorBrush(Color.Parse("#F5A623"));
    private static readonly IBrush Teal = new ImmutableSolidColorBrush(Color.Parse("#1FB89A"));
    private static readonly IBrush Pink = new ImmutableSolidColorBrush(Color.Parse("#EC5CA8"));

    public static IReadOnlyList<ExampleCard> Cards { get; } =
    [
        new("01", "Item de exemplo A", "Descrição curta deste item", "PENDENTE", "Atualizado hoje", "ABRIR", Blue),
        new("02", "Item de exemplo B", "Descrição curta deste item", "EM ANDAMENTO", "Atualizado ontem", "CONTINUAR", Coral),
        new("03", "Item de exemplo C", "Um texto maior para testar como a descrição se comporta em duas linhas", "CONCLUÍDO", "Atualizado há 3 dias", "REVER", Purple),
        new("04", "Item de exemplo D", "Descrição curta deste item", "PENDENTE", "Atualizado há 5 dias", "ABRIR", Amber),
        new("05", "Item de exemplo E", "Descrição curta deste item", "EM ANDAMENTO", "Atualizado há 1 semana", "CONTINUAR", Teal),
        new("06", "Item de exemplo F", "Descrição curta deste item", "CONCLUÍDO", "Atualizado há 2 semanas", "REVER", Pink),
    ];

    public static IReadOnlyList<ExampleSubject> Subjects { get; } =
    [
        new("Área de exemplo A", "Descrição curta", "EM ANDAMENTO", 72, "Hoje", "CONTINUAR", Blue),
        new("Área de exemplo B", "Descrição curta", "PENDENTE", 15, "Amanhã", "ABRIR", Coral),
        new("Área de exemplo C", "Descrição curta", "CONCLUÍDO", 100, "—", "REVER", Purple),
        new("Área de exemplo D", "Descrição curta", "EM ANDAMENTO", 48, "Sexta-feira", "CONTINUAR", Amber),
        new("Área de exemplo E", "Descrição curta", "PENDENTE", 5, "Próxima semana", "ABRIR", Teal),
        new("Área de exemplo F", "Descrição curta", "EM ANDAMENTO", 33, "Segunda-feira", "CONTINUAR", Pink),
    ];
}
