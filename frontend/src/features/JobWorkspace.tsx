import { useEffect, useState } from 'react';
import { api, observeJob, terminalStatuses } from '../services/api';
import type { Connection, FactoryPayload, Job, JobEvent } from '../services/api';

// Transcrições e downloads têm tela própria; aqui ficam somente as operações da fábrica.
type FactoryJob = Job & { payload: FactoryPayload };
const isFactoryJob = (job: Job): job is FactoryJob => job.payload.operation.startsWith('factory.');

const statusLabels = {
  queued: 'Na fila', running: 'Em execução', cancel_requested: 'Cancelando',
  succeeded: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado', interrupted: 'Interrompido', blocked: 'Bloqueado',
};

function JobDetails({ job, connection, refresh }: { job: FactoryJob; connection: Connection; refresh: () => Promise<void> }) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setEvents([]);
    setError('');
    void observeJob(connection, job.id, controller.signal, event => {
      if (event.kind === 'complete' || event.kind === 'state') {
        void refresh().catch(reason => setError(String(reason)));
        if (event.kind === 'complete') return;
      }
      setEvents(previous => [...previous, event].slice(-500));
    }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
    // O encerramento da assinatura não cancela a execução.
  }, [connection, job.id, job.attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function control(action: 'cancel' | 'retry') {
    setBusy(true); setError('');
    try { await api(connection, `/v1/jobs/${job.id}/${action}`, { method: 'POST' }); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <article className="card job-details">
    <div className="row spread"><h3>{job.payload.operation === 'factory.profile' ? 'Consulta de perfil' : 'Render de rascunho'}</h3><span className="tag">{statusLabels[job.status]}</span></div>
    <p className="muted">{job.payload.channel_id}{job.payload.video_id ? ` / ${job.payload.video_id}` : ''} · Tentativa {job.attempt}</p>
    {!terminalStatuses.includes(job.status) && <p className="muted" role="status">{job.status === 'queued' ? 'Aguardando a execução anterior terminar.' : 'Acompanhando a saída real do processo. Sem percentual estimado.'}</p>}
    {job.error && <p className="error" role="alert">{job.error}</p>}
    <div className="actions">{!terminalStatuses.includes(job.status)
      ? <button className="button" disabled={busy || job.status === 'cancel_requested'} onClick={() => void control('cancel')}>CANCELAR TAREFA</button>
      : job.status !== 'succeeded' && <button className="button" disabled={busy} onClick={() => void control('retry')}>TENTAR NOVAMENTE</button>}</div>
    {error && <p className="error" role="alert">{error}</p>}
    <details open><summary>Histórico e logs</summary><pre className="logs" aria-label="Logs da tarefa">{events.map(event => `${event.kind === 'state' ? 'estado' : event.kind}: ${event.message}`).join('\n') || 'Aguardando eventos…'}</pre></details>
    {job.result != null && <details><summary>Resultado</summary><pre className="logs">{JSON.stringify(job.result, null, 2)}</pre></details>}
  </article>;
}

export default function JobWorkspace({ connection }: { connection: Connection | null }) {
  const [jobs, setJobs] = useState<FactoryJob[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [channel, setChannel] = useState('canal01');
  const [video, setVideo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    if (!connection) return;
    const list = (await api<Job[]>(connection, '/v1/jobs')).filter(isFactoryJob);
    setJobs(list);
    setSelected(previous => previous ?? list[0]?.id ?? null);
  }
  useEffect(() => { void refresh().catch(reason => setError(String(reason))); }, [connection]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(operation: FactoryPayload['operation']) {
    if (!connection) return;
    setBusy(true); setError('');
    try {
      const job = await api<Job>(connection, '/v1/jobs', { method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ operation, channel_id: channel, video_id: operation === 'factory.profile' ? null : video }),
      });
      setSelected(job.id); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  const current = jobs.find(job => job.id === selected);
  return <section className="workspace" aria-label="Operações locais da fábrica">
    <div className="card"><p className="eyebrow accent">OPERAÇÃO LOCAL</p><h2>Uma etapa por vez.</h2><p className="muted">Consulta de perfil e render de rascunho pelo CLI existente. Nenhuma geração de voz ou publicação é acionada aqui.</p>
      <div className="form-row"><label>Canal<input value={channel} onChange={e => setChannel(e.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" maxLength={64} /></label><label>Vídeo para rascunho<input value={video} onChange={e => setVideo(e.target.value)} placeholder="Identificador da pasta do vídeo" maxLength={128} /></label></div>
      <div className="actions"><button className="button primary" disabled={!connection || busy || !channel} onClick={() => void submit('factory.profile')}>CONSULTAR PERFIL</button><button className="button" disabled={!connection || busy || !channel || !video} onClick={() => void submit('factory.render.preview')}>RENDERIZAR RASCUNHO</button></div>
      {!connection && <p className="muted" role="status">Conecte o backend local em Ajustes para executar operações.</p>}{error && <p className="error" role="alert">{error}</p>}
    </div>
    {jobs.length > 0 && <div className="job-grid"><div className="job-list" aria-label="Histórico de tarefas">{jobs.map(job => <button key={job.id} className={`job-item ${job.id === selected ? 'selected' : ''}`} onClick={() => setSelected(job.id)}><span>{job.payload.operation === 'factory.profile' ? 'Consulta de perfil' : 'Render de rascunho'}</span><small>{job.payload.channel_id} · {statusLabels[job.status]}</small></button>)}</div>{current && connection && <JobDetails job={current} connection={connection} refresh={refresh} />}</div>}
  </section>;
}
