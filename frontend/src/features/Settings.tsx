import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Connection, HermesStatus } from '../services/api';
import { connectDesktop, nativeDesktop } from '../platform/desktop';
import PrivacySecurity from './PrivacySecurity';

export type Theme = 'system' | 'light' | 'dark';
export type SettingsSection = 'general' | 'privacy';
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
    {report?.checks?.map(check => <div key={check.id}><div className="row spread"><h3>{check.name}</h3><span className="tag">{check.available ? 'LOCALIZADO' : 'NÃO LOCALIZADO'}</span></div><p className="muted">{check.detail}</p></div>)}
  </section>;
}

export default function Settings({ theme, setTheme, connect, connection, hermes, onHermesStatus, initialSection = 'general' }: {
  theme: Theme; setTheme: (theme: Theme) => void; connect: (connection: Connection) => void; connection: Connection | null;
  hermes: HermesStatus | null; onHermesStatus: (status: HermesStatus) => void; initialSection?: SettingsSection;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [url, setUrl] = useState('http://127.0.0.1:8765');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [connecting, setConnecting] = useState(false);
  async function reconnect() {
    setConnecting(true);
    try {
      const candidate = await connectDesktop();
      if (!candidate) throw new Error('Backend desktop indisponível.');
      await api(candidate, '/health'); connect(candidate); setMessage('Backend local reconectado. Retome o acompanhamento na Transcrição.');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setConnecting(false); }
  }
  async function manualConnect() {
    try {
      const address = new URL(url);
      if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(address.hostname) || address.username || address.password || address.search || address.hash || address.pathname !== '/') throw new Error('Use apenas um endereço HTTP local, sem caminho ou credenciais na URL.');
      const candidate = { baseUrl: address.origin, token };
      await api(candidate, '/health'); connect(candidate); setToken(''); setMessage('Backend local conectado.');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <div className="page settings">
    <div className="page-heading">
      <div>
        <p className="eyebrow accent">AJUSTES</p>
        <h1>{section === 'privacy' ? 'Privacidade e Segurança' : 'Aparência'}</h1>
        <p className="muted">{section === 'privacy' ? 'Superfície de segurança local, permissões do agente e integridade de dados.' : 'A mesma identidade, no tema que combina com seu espaço.'}</p>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="Seções de Ajustes">
        <button
          role="tab"
          id="tab-general"
          aria-selected={section === 'general'}
          aria-controls="panel-general"
          className={`button ${section === 'general' ? 'active' : ''}`}
          onClick={() => setSection('general')}
          onKeyDown={e => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              setSection('privacy');
              document.getElementById('tab-privacy')?.focus();
            }
          }}
        >
          GERAL
        </button>
        <button
          role="tab"
          id="tab-privacy"
          aria-selected={section === 'privacy'}
          aria-controls="panel-privacy"
          className={`button ${section === 'privacy' ? 'active' : ''}`}
          onClick={() => setSection('privacy')}
          onKeyDown={e => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              setSection('general');
              document.getElementById('tab-general')?.focus();
            }
          }}
        >
          PRIVACIDADE E SEGURANÇA
        </button>
      </div>
    </div>

    {section === 'general' ? (
      <div id="panel-general" role="tabpanel" aria-labelledby="tab-general" className="settings-panel">
        <div className="theme-options" aria-label="Tema">{(['system', 'light', 'dark'] as Theme[]).map((value, index) => <button key={value} className={`button ${theme === value ? 'active' : ''}`} aria-pressed={theme === value} onClick={() => setTheme(value)}>{['SISTEMA', 'CLARO', 'ESCURO'][index]}</button>)}</div>
        <section className="card"><p className="eyebrow">CONEXÃO LOCAL</p><h2>{connection ? 'Backend disponível.' : 'Conecte seu espaço de trabalho.'}</h2><p className="muted">{nativeDesktop ? 'O aplicativo gerencia o backend local. Credenciais de conexão ficam somente na memória desta sessão.' : 'No navegador, você pode conectar um backend iniciado separadamente. A versão desktop faz essa conexão automaticamente.'}</p>
          {!nativeDesktop && <form onSubmit={event => { event.preventDefault(); void manualConnect(); }}><label>Endereço local<input value={url} onChange={e => setUrl(e.target.value)} autoComplete="off" /></label><label>Token da sessão<input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" /></label><button className="button primary" type="submit" disabled={token.length < 24}>CONECTAR BACKEND</button></form>}
          {nativeDesktop && <button className="button" disabled={connecting} onClick={() => void reconnect()}>RECONECTAR BACKEND</button>}
          {message && <p role="status">{message}</p>}
        </section>
        <HermesIntegration connection={connection} report={hermes} onStatus={onHermesStatus} />
        {connection && <EnvironmentDiagnostics connection={connection} />}
      </div>
    ) : (
      <div id="panel-privacy" role="tabpanel" aria-labelledby="tab-privacy" className="settings-panel">
        <PrivacySecurity connection={connection} />
      </div>
    )}
  </div>;
}

function HermesIntegration({ connection, report, onStatus }: {
  connection: Connection | null; report: HermesStatus | null; onStatus: (status: HermesStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function verify() {
    if (!connection || busy) return;
    setBusy(true); setError('');
    try { onStatus(await api<HermesStatus>(connection, '/v1/hermes/probe', { method: 'POST' })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <section className="card" aria-label="Integração Hermes"><p className="eyebrow">HERMES AGENT</p>
    <h2>{report?.connected ? 'Conexão autenticada verificada.' : 'Conecte o motor de inteligência.'}</h2>
    <p className="muted">O Hórus consulta a API local do Hermes. Esta verificação não envia prompts nem inicia produções.</p>
    {report && <><p role="status">{report.message}</p><p className="muted">CLI: {report.cli_available ? 'localizado' : 'não localizado'} · Conexão: {report.configured ? 'configurada' : 'não configurada'}{report.version ? ` · Hermes ${report.version}` : ''}</p>
      {report.checked_at && <p className="muted">Última verificação: {new Date(report.checked_at).toLocaleString('pt-BR')}</p>}
      {report.features.length > 0 && <p className="muted">API anuncia: {report.features.map(name => ({ run_submission: 'execuções', responses_api: 'respostas', chat_completions: 'chat' }[name] ?? name)).join(', ')}. A orquestração audiovisual ainda será integrada.</p>}
    </>}
    <button className="button primary" disabled={!connection || busy} onClick={() => void verify()}>{busy ? 'VERIFICANDO HERMES…' : 'VERIFICAR CONEXÃO HERMES'}</button>
    {!connection && <p className="muted">Conecte o backend local primeiro.</p>}
    {report && !report.configured && <p className="muted">A conexão precisa ser preparada neste computador antes da verificação.</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
