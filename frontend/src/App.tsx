import { lazy, Suspense, useEffect, useState } from 'react';
import { EyeMark } from './components/Identity';
import { navigation, Overview, Preview, SectionHeader, sections } from './components/Sections';
import type { Page } from './components/Sections';
import { connectDesktop, nativeDesktop } from './platform/desktop';
import { api } from './services/api';
import type { Connection, HermesStatus } from './services/api';
import type { Theme } from './features/Settings';

const Library = lazy(() => import('./features/Library'));
const JobWorkspace = lazy(() => import('./features/JobWorkspace'));
const Settings = lazy(() => import('./features/Settings'));
const Transcription = lazy(() => import('./features/Transcription'));
const Radar = lazy(() => import('./features/Radar'));
const EditorialWorkflows = lazy(() => import('./features/EditorialWorkflows'));

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [theme, setTheme] = useState<Theme>(() => {
    const value = localStorage.getItem('horus.theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  });
  const [systemDark, setSystemDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [hermes, setHermes] = useState<HermesStatus | null>(null);
  const [backendError, setBackendError] = useState('');
  // Montada na primeira visita e mantida oculta depois, preservando fila e texto ao trocar de tela.
  const [transcriptionOpened, setTranscriptionOpened] = useState(false);
  useEffect(() => { if (page === 'transcription') setTranscriptionOpened(true); }, [page]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setHermes(null);
    if (connection) void api<HermesStatus>(connection, '/v1/hermes', { signal: controller.signal })
      .then(report => { if (!controller.signal.aborted) setHermes(report); })
      .catch(() => { /* O painel de Ajustes oferece uma nova verificação explícita. */ });
    return () => controller.abort();
  }, [connection]);
  useEffect(() => { localStorage.setItem('horus.theme', theme); }, [theme]);
  useEffect(() => {
    let active = true;
    void connectDesktop().then(async candidate => {
      if (!candidate) return;
      await api(candidate, '/health');
      if (active) setConnection(candidate);
    }).catch(reason => { if (active) setBackendError(String(reason)); });
    return () => { active = false; };
  }, []);
  const effectiveTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  return <div className="horus" data-theme={effectiveTheme}>
    <a className="skip-link" href="#main">Ir para o conteúdo</a>
    <aside className="sidebar"><div className="brand"><div className="brand-name"><EyeMark /><span>HORUS</span></div><p className="eyebrow">INTELIGÊNCIA AUDIOVISUAL</p></div>
      <nav aria-label="Navegação principal"><p className="eyebrow navigation-label">ESPAÇO DE TRABALHO</p>{navigation.map(item => <button key={item.id} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}>{item.title}</button>)}<p className="eyebrow navigation-label tools-label">FERRAMENTAS</p><button aria-current={page === 'transcription' ? 'page' : undefined} onClick={() => setPage('transcription')}>Transcrição</button></nav>
      <div className="sidebar-bottom"><div className="integration"><p className="eyebrow">HERMES AGENT</p><p className="muted"><span className="status-dot" />{hermes?.connected ? 'API verificada' : hermes?.cli_available ? 'CLI localizado' : 'Integração pendente'}</p></div><button className="settings-navigation" aria-current={page === 'settings' ? 'page' : undefined} onClick={() => setPage('settings')}>Ajustes</button><p className="eyebrow signature">SEU ESPAÇO DE CRIAÇÃO</p></div>
    </aside>
    <div className="workspace-shell"><header className="topbar"><div className="row"><span className="eyebrow accent">HORUS</span><span className="muted">/</span><span className="eyebrow">CENTRAL AUDIOVISUAL</span></div><span className="tag">APLICATIVO EM DESENVOLVIMENTO</span></header>
      <main id="main" tabIndex={-1}><Suspense fallback={<p className="loading" role="status">Abrindo seu espaço…</p>}>
        {page === 'overview' ? <Overview navigate={setPage} />
          : page === 'settings' ? <Settings theme={theme} setTheme={setTheme} connection={connection} connect={candidate => { setConnection(candidate); setBackendError(''); }} hermes={hermes} onHermesStatus={setHermes} />
          : page === 'library' ? <Library connection={connection} />
          : page === 'transcription' ? null
          : page === 'radar' ? <div className="page"><SectionHeader section={sections.radar} /><Radar connection={connection} /></div>
          : <div className="page"><SectionHeader section={sections[page]} />{page === 'production' && <EditorialWorkflows connection={connection} />}{(page === 'production' || page === 'channels') && <JobWorkspace connection={connection} />}<Preview section={sections[page]} /></div>}
        {(transcriptionOpened || page === 'transcription') && <Transcription connection={connection} hidden={page !== 'transcription'} />}
      </Suspense></main>
      <footer><span>{backendError ? `Backend indisponível: ${backendError}` : connection ? 'Backend local conectado' : nativeDesktop ? 'Preparando backend local…' : 'Prévia no navegador'}</span><span>Transcrição local com Whisper · Orquestração e módulos editoriais em preparação.</span></footer>
    </div>
  </div>;
}
