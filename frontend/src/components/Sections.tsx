import { Orbit } from './Identity';

export type Page = 'overview' | 'radar' | 'library' | 'production' | 'channels' | 'history' | 'transcription' | 'settings';
export const navigation: { id: Page; title: string }[] = [
  { id: 'overview', title: 'Visão geral' }, { id: 'radar', title: 'Radar' },
  { id: 'library', title: 'Biblioteca' }, { id: 'production', title: 'Produção' },
  { id: 'channels', title: 'Canais' }, { id: 'history', title: 'Histórico operacional' },
];

export const sections = {
  radar: { caption: '02 / RADAR', title: 'Um olhar para as oportunidades.', description: 'Um espaço para explorar referências e reconhecer caminhos para conteúdos originais.', emptyTitle: 'A próxima ideia começa com uma boa pergunta.', emptyDescription: 'A pesquisa de vídeos e canais ainda não está conectada. Esta tela apresenta a organização prevista para suas descobertas.', features: [['Referências', 'Vídeos e canais reunidos para analisar formatos e desempenho.'], ['Observações', 'Fontes e sinais públicos, separados de hipóteses sobre desempenho.'], ['Ideias salvas', 'Oportunidades selecionadas por você para produzir depois.']] },
  library: { caption: '03 / BIBLIOTECA', title: 'Sua mídia, em um lugar.', description: 'Vídeos, áudios, transcrições e recursos da produção audiovisual.', emptyTitle: 'Traga a mídia da sua próxima produção.', emptyDescription: 'Selecione um arquivo para visualizar sua mídia local. A organização editorial da biblioteca será integrada em etapas.', features: [['Mídia', 'Vídeos, áudios e recursos organizados por produção.'], ['Transcrições', 'Texto para revisar narração, roteiros e legendas.'], ['Arquivos finais', 'Renders e materiais associados às entregas.']] },
  production: { caption: '04 / PRODUÇÃO', title: 'Da ideia à próxima entrega.', description: 'Um espaço para acompanhar a criação, mantendo suas decisões no centro do processo.', emptyTitle: 'Sua próxima história vai passar por aqui.', emptyDescription: 'A conexão local permite consultar um perfil e acompanhar um render de rascunho. O pipeline editorial completo ainda não está integrado.', features: [['Planejamento', 'Briefing, roteiro e referências antes de produzir.'], ['Aprovações', 'Um lugar para revisar escolhas e solicitar ajustes.'], ['Entregas', 'Prévia do vídeo, revisão final e organização dos arquivos.']] },
  channels: { caption: '05 / CANAIS', title: 'Uma identidade para cada história.', description: 'A organização prevista para os canais e suas escolhas editoriais.', emptyTitle: 'Comece por um canal. Encontre sua voz.', emptyDescription: 'Consulte um perfil existente pela operação local. Esta versão não cria canais nem altera suas configurações editoriais.', features: [['Identidade', 'Público, assuntos e direção visual de cada canal.'], ['Voz editorial', 'Tom, narração e preferências para manter consistência.'], ['Formatos', 'Organização de séries, Shorts e vídeos longos.']] },
  history: { caption: '06 / HISTÓRICO OPERACIONAL', title: 'Cada produção deixa um registro.', description: 'Execuções, revisões e decisões da operação audiovisual.', emptyTitle: 'Rastreie o caminho até a entrega.', emptyDescription: 'Esta área consolidada ainda não está integrada. As tarefas técnicas e seus logs já podem ser consultados em Produção.', features: [['Execuções', 'Etapas, falhas e novas tentativas por vídeo.'], ['Revisões', 'Decisões editoriais associadas à versão aprovada.'], ['Resultados', 'Custos e métricas das produções, quando disponíveis.']] },
};

export function Overview({ navigate }: { navigate: (page: Page) => void }) {
  return <div className="page overview">
    <div className="page-heading"><div><p className="eyebrow accent">01 / VISÃO GERAL</p><h1>Um novo olhar para criar.</h1></div><span className="tag">PRÉVIA DE LAYOUT</span></div>
    <section className="hero"><div className="hero-copy"><p className="eyebrow accent">PESQUISE. PLANEJE. PRODUZA.</p><h2>Da referência<br />à sua próxima história.</h2><p className="muted">Pesquise oportunidades, planeje vídeos originais e acompanhe sua produção audiovisual.</p><div className="actions"><button className="button primary" onClick={() => navigate('production')}>ABRIR PRODUÇÃO</button><button className="button" onClick={() => navigate('radar')}>EXPLORAR RADAR</button></div></div><Orbit /></section>
    <section><p className="eyebrow section-label">UM FLUXO, DO PRIMEIRO SINAL À ENTREGA</p><div className="three-columns">
      <article className="card"><p className="eyebrow accent">01 / DESCOBRIR</p><h3>Encontre um caminho.</h3><p className="muted">Referências, formatos e ideias que merecem um olhar mais atento.</p><p className="eyebrow small">RADAR · EM PREPARAÇÃO</p></article>
      <article className="card"><p className="eyebrow accent">02 / PLANEJAR</p><h3>Prepare o próximo vídeo.</h3><p className="muted">Defina abordagem, roteiro, título e direção visual antes de produzir.</p><p className="eyebrow small">PLANEJAMENTO · EM PREPARAÇÃO</p></article>
      <article className="card"><p className="eyebrow accent">03 / CRIAR</p><h3>Dê forma à história.</h3><p className="muted">Do briefing à revisão final, com espaço para suas escolhas.</p><p className="eyebrow small">PRODUÇÃO · EM PREPARAÇÃO</p></article>
    </div></section>
    <div className="overview-bottom"><article className="card"><p className="eyebrow">SEU PRÓXIMO PASSO</p><h2>Acompanhe sua produção.</h2><p className="muted">Organize sua mídia, consulte o perfil do canal e acompanhe as etapas disponíveis da fábrica.</p><p className="eyebrow small">MÍDIA LOCAL · CONTROLE EDITORIAL</p></article><article className="card sunken"><p className="eyebrow">CONSTRUINDO O HORUS</p><h2>Um passo de cada vez.</h2><p className="muted">Explore a organização da plataforma. Pesquisa, canais e produção editorial ainda estão em preparação.</p></article></div>
  </div>;
}

export function SectionHeader({ section }: { section: (typeof sections)[keyof typeof sections] }) {
  return <div className="section-heading"><p className="eyebrow accent">{section.caption}</p><h1>{section.title}</h1><p className="muted description">{section.description}</p></div>;
}

export function Preview({ section }: { section: (typeof sections)[keyof typeof sections] }) {
  return <><div className="empty-state"><span className="tag">PRÉVIA DE LAYOUT · EM PREPARAÇÃO</span><svg width="35" height="35" viewBox="0 0 35 35" fill="none" className="accent" aria-hidden="true"><path d="M.5 .5H34V34H.5ZM10 17H24M17 10V24" stroke="currentColor" /></svg><h2>{section.emptyTitle}</h2><p className="muted">{section.emptyDescription}</p></div><p className="eyebrow">O QUE ESTE ESPAÇO VAI REUNIR</p><div className="three-columns">{section.features.map(([title, description]) => <article key={title} className="card"><h3>{title}</h3><p className="muted">{description}</p></article>)}</div></>;
}
