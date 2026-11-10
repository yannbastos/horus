import { useState } from 'react';
import { api } from '../services/api';
import type { Connection } from '../services/api';
import { nativeDesktop } from '../platform/desktop';

export type Theme = 'system' | 'light' | 'dark';

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
  </div>;
}
