namespace Horus.ViewModels;

public sealed class MainWindowViewModel
{
    public string AppName => "HORUS";

    public string StatusMessage => "APLICATIVO EM DESENVOLVIMENTO";

    public IReadOnlyList<ExampleCard> ExampleCards => ExampleData.Cards;

    public IReadOnlyList<ExampleSubject> ExampleSubjects => ExampleData.Subjects;

    public TranscriptionViewModel Transcription { get; } = new();

    public WorkspaceSection Radar { get; } = new(
        "02 / RADAR", "Um olhar para as oportunidades.",
        "Um espaço para explorar referências e reconhecer caminhos para conteúdos originais.",
        "A próxima ideia começa com uma boa pergunta.",
        "A pesquisa de vídeos e canais ainda não está conectada. Esta tela apresenta a organização prevista para suas descobertas.",
        [
            new("Referências", "Vídeos e canais reunidos para estudar formatos e assuntos."),
            new("Observações", "Fontes e sinais públicos, separados de hipóteses sobre desempenho."),
            new("Ideias salvas", "Oportunidades selecionadas por você para aprofundar depois.")
        ]);

    public WorkspaceSection Library { get; } = new(
        "03 / BIBLIOTECA", "Seu repertório, em um lugar.",
        "A organização prevista para vídeos, transcrições e materiais de referência.",
        "Toda história começa com repertório.",
        "A biblioteca ainda não está integrada. Para trabalhar com um arquivo agora, use Transcrição no menu lateral.",
        [
            new("Materiais", "Referências organizadas por assunto e projeto."),
            new("Transcrições", "Textos associados aos seus materiais, com espaço para revisão."),
            new("Conexões", "Anotações e fontes que ajudam a transformar estudo em ideia.")
        ]);

    public WorkspaceSection Production { get; } = new(
        "04 / PRODUÇÃO", "Da ideia à próxima entrega.",
        "Um espaço para acompanhar a criação, mantendo suas decisões no centro do processo.",
        "Sua próxima história vai passar por aqui.",
        "A fábrica ainda não está conectada ao aplicativo. Nenhuma produção, chamada paga ou render é iniciado nesta prévia.",
        [
            new("Planejamento", "Briefing, roteiro e referências antes de produzir."),
            new("Aprovações", "Um lugar para revisar escolhas e solicitar ajustes."),
            new("Entregas", "Prévia do vídeo, revisão final e organização dos arquivos.")
        ]);

    public WorkspaceSection Channels { get; } = new(
        "05 / CANAIS", "Uma identidade para cada história.",
        "A organização prevista para os canais e suas escolhas editoriais.",
        "Comece por um canal. Encontre sua voz.",
        "Os perfis da fábrica ainda não são carregados pelo desktop. Esta prévia não cria canais nem altera configurações.",
        [
            new("Identidade", "Público, assuntos e direção visual de cada canal."),
            new("Voz editorial", "Tom, narração e preferências para manter consistência."),
            new("Formatos", "Organização de séries, Shorts e vídeos longos.")
        ]);

    public WorkspaceSection Memory { get; } = new(
        "06 / MEMÓRIA", "Aprendizado que acompanha você.",
        "Um espaço para reunir decisões, observações e aprendizados que merecem continuar.",
        "Boas escolhas também deixam referências.",
        "A memória operacional ainda não está conectada. Nenhuma conversa ou preferência é registrada por esta tela.",
        [
            new("Decisões", "Escolhas importantes e os motivos por trás delas."),
            new("Aprendizados", "O que foi observado, revisado e validado."),
            new("Experimentos", "Hipóteses e resultados, sem confundir expectativa com evidência.")
        ]);
}
