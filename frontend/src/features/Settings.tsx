import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Connection } from '../services/api';
import { nativeDesktop } from '../platform/desktop';

export type Theme = 'system' | 'light' | 'dark';
type Diagnostics = { checks: { id: string; name: string; available: boolean; detail: string }[]; notice: string };

function EnvironmentDiagnostics({ connection }: { connection: Connection }) {
  const [report, setReport] = useState<Diagnostics | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setReport(null);
    void api<Diagnostics>(connection, '/v1/diagnostics', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setReport(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(String(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [connection, revision]);
  return <section className="card" aria-label="Diagnóstico do ambiente"><p className="eyebrow">AMBIENTE LOCAL</p><h2>Ferramentas da operação.</h2>
    <p className="muted">{report?.notice ?? 'Consulta somente a presença das ferramentas no ambiente do backend.'}</p>
    <button className="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>VERIFICAR NOVAMENTE</button>
    {loading && <p role="status">Verificando ferramentas…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {report?.checks.map(check => <div key={check.id}><div className="row spread"><h3>{check.name}</h3><span className="tag">{check.available ? 'LOCALIZADO' : 'NÃO LOCALIZADO'}</span></div><p className="muted">{check.detail}</p></div>)}
  </section>;
}

export default function Settings({ theme, setTheme, connect, connection }: {
  theme: Theme; setTheme: (theme: Theme) => void; connect: (connection: Connection) => void; connection: Connection | null;
}) {
  const [url, setUrl] = useState('http://127.0.0.1:8765');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  async function manualConnect() {
    try {
      const address = new URL(url);
      if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(address.hostname) || address.username || address.password || address.search || address.hash || address.pathname !== '/') throw new Error('Use apenas um endereço HTTP local, sem caminho ou credenciais na URL.');
      const candidate = { baseUrl: address.origin, token };
      await api(candidate, '/health'); connect(candidate); setToken(''); setMessage('Backend local conectado.');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <div className="page settings"><p className="eyebrow accent">AJUSTES</p><h1>Aparência</h1><p className="muted">A mesma identidade, no tema que combina com seu espaço.</p><div className="theme-options" aria-label="Tema">{(['system', 'light', 'dark'] as Theme[]).map((value, index) => <button key={value} className={`button ${theme === value ? 'active' : ''}`} aria-pressed={theme === value} onClick={() => setTheme(value)}>{['SISTEMA', 'CLARO', 'ESCURO'][index]}</button>)}</div>
    <section className="card"><p className="eyebrow">CONEXÃO LOCAL</p><h2>{connection ? 'Backend disponível.' : 'Conecte seu espaço de trabalho.'}</h2><p className="muted">{nativeDesktop ? 'O aplicativo gerencia o backend local. Credenciais de conexão ficam somente na memória desta sessão.' : 'No navegador, você pode conectar um backend iniciado separadamente. A versão desktop faz essa conexão automaticamente.'}</p>
      {!nativeDesktop && <form onSubmit={event => { event.preventDefault(); void manualConnect(); }}><label>Endereço local<input value={url} onChange={e => setUrl(e.target.value)} autoComplete="off" /></label><label>Token da sessão<input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" /></label><button className="button primary" type="submit" disabled={token.length < 24}>CONECTAR BACKEND</button></form>}
      {message && <p role="status">{message}</p>}
    </section>
    {connection && <EnvironmentDiagnostics connection={connection} />}
  </div>;
}
