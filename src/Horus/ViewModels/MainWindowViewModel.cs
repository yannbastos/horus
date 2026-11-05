namespace Horus.ViewModels;

public sealed class MainWindowViewModel
{
    public string AppName => "HORUS";

    public string StatusMessage => "APLICATIVO EM DESENVOLVIMENTO";

    public IReadOnlyList<ExampleCard> ExampleCards => ExampleData.Cards;

    public IReadOnlyList<ExampleSubject> ExampleSubjects => ExampleData.Subjects;
}
