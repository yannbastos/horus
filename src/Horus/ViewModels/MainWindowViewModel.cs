namespace Horus.ViewModels;

public sealed class MainWindowViewModel
{
    public string AppName => "HORUS";

    public string StatusMessage => "APLICATIVO EM DESENVOLVIMENTO";

    public TranscriptionViewModel Transcription { get; } = new();

    public WorkspaceSection Radar { get; } = new(
        "02 / RADAR", "Um olhar para as oportunidades.",
        "Um espaço para explorar referências e reconhecer caminhos para conteúdos originais.",
        "A próxima ideia começa com uma boa pergunta.",
        "A pesquisa de vídeos e canais ainda não está conectada. Esta tela apresenta a organização prevista para suas descobertas.",
        [
            new("Referências", "Vídeos e canais reunidos para analisar formatos e desempenho."),
            new("Observações", "Fontes e sinais públicos, separados de hipóteses sobre desempenho."),
            new("Ideias salvas", "Oportunidades selecionadas por você para aprofundar depois.")
        ]);

    public WorkspaceSection Library { get; } = new(
        "03 / BIBLIOTECA", "Sua mídia, em um lugar.",
        "Vídeos, áudios, transcrições e recursos da produção audiovisual.",
        "Traga a mídia da sua próxima produção.",
        "A biblioteca ainda não está integrada. Para trabalhar com um arquivo agora, use Transcrição no menu lateral.",
        [
            new("Mídia", "Vídeos, áudios e recursos organizados por produção."),
            new("Transcrições", "Texto para revisar narração, roteiros e legendas."),
            new("Arquivos finais", "Renders e materiais associados às entregas.")
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

    public WorkspaceSection History { get; } = new(
        "06 / HISTÓRICO OPERACIONAL", "Cada produção deixa um registro.",
        "Execuções, revisões e decisões da operação audiovisual.",
        "Rastreie o caminho até a entrega.",
        "O histórico operacional ainda não está conectado. Esta tela não registra execuções ou decisões.",
        [
            new("Execuções", "Etapas, falhas e novas tentativas por vídeo."),
            new("Revisões", "Decisões editoriais associadas à versão aprovada."),
            new("Resultados", "Custos e métricas das produções, quando disponíveis.")
        ]);
}
