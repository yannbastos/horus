import { useEffect, useRef, useState } from 'react';
import { api, observeJob } from '../services/api';
import type { Connection, DownloadPayload, Job, JobEvent, TranscriptionPayload } from '../services/api';
import { nativeDesktop, onFileDrop, selectDirectory, selectMediaFiles, selectSavePath } from '../platform/desktop';

export const maxQueue = 20;
const models = [
  ['tiny', 'Tiny · ~75 MB · mais rápido'], ['base', 'Base · ~145 MB'], ['small', 'Small · ~485 MB · equilíbrio'],
  ['medium', 'Medium · ~1,5 GB'], ['large-v3-turbo', 'Large v3 Turbo · ~1,6 GB · melhor qualidade'],
];
const languages = [['auto', 'Detectar automaticamente'], ['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol']];
type Capabilities = { engine: boolean; downloader: boolean; ffmpeg: boolean };

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const folder = (path: string) => path.slice(0, Math.max(0, path.length - fileName(path).length - 1));
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const elapsed = (started: number) => {
  const seconds = Math.round((performance.now() - started) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

/** Mesma regra do backend e do desktop Avalonia: vídeo único do YouTube, HTTPS e sem credenciais. */
export function isYouTubeUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  const id = /^[A-Za-z0-9_-]{11}$/;
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (url.hostname === 'youtu.be') return id.test(url.pathname.replace(/^\/|\/$/g, ''));
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) return false;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 2 && ['shorts', 'live', 'embed'].includes(parts[0])) return id.test(parts[1]);
  return url.pathname === '/watch' && url.searchParams.getAll('v').some(v => id.test(v));
}

/**
 * Fila de até 20 arquivos, processados um por vez. Ao concluir, a fila pausa: só depois de salvar
 * a versão atual do texto é possível avançar. O componente permanece montado para preservar a fila.
 */
export default function Transcription({ connection, hidden }: { connection: Connection | null; hidden: boolean }) {
  const [queue, setQueue] = useState<string[]>([]);
  const [model, setModel] = useState('small');
  const [language, setLanguage] = useState('auto');
  const [url, setUrl] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [manualFolder, setManualFolder] = useState('');
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('Adicione um arquivo de áudio ou vídeo para começar.');
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [active, setActive] = useState<{ id: string | null; kind: 'transcription' | 'download' } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const revision = useRef(0);
  const unmounted = useRef(new AbortController());
  const busy = active !== null || saving;
  const current = queue[0];

  useEffect(() => {
    // Recriado a cada montagem: o StrictMode desmonta e remonta em desenvolvimento.
    const controller = new AbortController();
    unmounted.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setCapabilities(null);
    if (connection) void api<Capabilities>(connection, '/v1/transcription').then(setCapabilities).catch(() => undefined);
  }, [connection]);

  function enqueue(files: string[]) {
    const accepted = files.filter(file => file.trim()).slice(0, Math.max(0, maxQueue - queue.length));
    const rejected = files.filter(file => file.trim()).length - accepted.length;
    const next = [...queue, ...accepted];
    setQueue(next);
    setStatus(rejected > 0 ? `Limite de ${maxQueue} arquivos. ${rejected} não adicionado(s).`
      : `Fila: ${next.length}/${maxQueue}. Clique em Transcrever para iniciar o arquivo atual.`);
    return accepted.length;
  }

  // Referências atualizadas para o evento nativo de soltar arquivos, registrado uma única vez.
  const dropState = useRef({ hidden, busy, enqueue });
  dropState.current = { hidden, busy, enqueue };
  useEffect(() => {
    let release: (() => void) | undefined;
    let cancelled = false;
    void onFileDrop(({ hovering, paths }) => {
      const state = dropState.current;
      if (state.hidden || state.busy) { setDragging(false); return; }
      setDragging(hovering);
      if (paths.length) state.enqueue(paths);
    }).then(unlisten => { if (cancelled) unlisten(); else release = unlisten; });
    return () => { cancelled = true; release?.(); };
  }, []);

  async function runJob(payload: TranscriptionPayload | DownloadPayload, onEvent: (event: JobEvent) => void): Promise<Job> {
    if (!connection) throw new Error('Conecte o backend local em Ajustes.');
    const job = await api<Job>(connection, '/v1/jobs', { method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(payload) });
    setActive(previous => previous && { ...previous, id: job.id });
    let final: Job | undefined;
    await observeJob(connection, job.id, unmounted.current.signal, event => {
      if (event.kind === 'complete') final = event.job; else onEvent(event);
    });
    return final ?? api<Job>(connection, `/v1/jobs/${job.id}`);
  }

  async function transcribe(file = current, previous = transcript) {
    if (!file || busy) return;
    setActive({ id: null, kind: 'transcription' }); setSaved(false); setProgress(0);
    setStatus('Aguardando a fila local de tarefas...');
    const started = performance.now();
    let partial = '';
    try {
      const job = await runJob({ operation: 'transcription.run', path: file, model, language }, event => {
        if (event.kind === 'status') setStatus(event.message);
        else if (event.kind === 'progress') setProgress(Number(event.message) || 0);
        else if (event.kind === 'segment') { partial += `${event.message}\n`; setTranscript(previous + partial); }
      });
      const result = job.result as { text?: string } | null;
      if (job.status === 'succeeded') {
        setTranscript(result?.text ?? partial); setCompleted(true); setProgress(100);
        setStatus(`Concluído em ${elapsed(started)}. Salve o .txt antes de Próximo vídeo.`);
      } else {
        setTranscript(previous + (result?.text ?? partial));
        setStatus(job.status === 'cancelled' ? 'Cancelado. Texto parcial preservado; Transcrever tenta novamente o mesmo arquivo.'
          : `Erro: ${job.error ?? 'a transcrição não foi concluída.'}`);
      }
    } catch (reason) {
      if (partial) setTranscript(previous + partial);
      setStatus(`Erro: ${message(reason)}`);
    } finally { setActive(null); }
  }

  async function next() {
    if (busy || !completed || !saved || queue.length < 2) return;
    const remaining = queue.slice(1);
    setQueue(remaining); setTranscript(''); setCompleted(false); setSaved(false);
    await transcribe(remaining[0], '');
  }

  async function cancel() {
    if (!connection || !active?.id) return;
    try { await api(connection, `/v1/jobs/${active.id}/cancel`, { method: 'POST' }); }
    catch (reason) { setStatus(`Erro ao cancelar: ${message(reason)}`); }
  }

  async function download() {
    if (busy || queue.length >= maxQueue || !isYouTubeUrl(url)) return;
    setActive({ id: null, kind: 'download' });
    try {
      const directory = nativeDesktop ? await selectDirectory() : manualFolder.trim();
      if (!directory) { if (!nativeDesktop) setStatus('Informe a pasta onde o vídeo será salvo.'); return; }
      setProgress(0); setStatus('Iniciando download do YouTube...');
      const job = await runJob({ operation: 'youtube.download', url, directory }, event => {
        if (event.kind === 'stdout' || event.kind === 'stderr') setStatus(event.message);
      });
      const file = (job.result as { path?: string } | null)?.path;
      if (job.status === 'succeeded' && file) {
        const added = enqueue([file]);
        setProgress(100); setUrl('');
        setStatus(added ? `Vídeo salvo em ${file}. Adicionado ao final da fila; o resultado atual foi preservado.`
          : `Vídeo salvo em ${file}, mas a fila está cheia.`);
      } else setStatus(job.status === 'cancelled' ? 'Download cancelado. Arquivos parciais podem ser retomados na mesma pasta.'
        : `Erro no download: ${job.error ?? 'o vídeo não foi baixado.'}`);
    } catch (reason) { setStatus(`Erro no download: ${message(reason)}`); }
    finally { setActive(null); }
  }

  async function save() {
    if (busy || !(completed || transcript.trim())) return;
    const text = transcript;
    const startRevision = revision.current;
    const suggested = `${fileName(current ?? 'transcricao').replace(/\.[^.]+$/, '')}.txt`;
    setSaving(true); setSaved(false);
    try {
      let target = suggested;
      if (nativeDesktop) {
        if (!connection) throw new Error('O backend local precisa estar disponível para salvar.');
        const path = await selectSavePath(suggested);
        if (!path) return;
        target = (await api<{ path: string }>(connection, '/v1/transcriptions/save', { method: 'POST', body: JSON.stringify({ path, text }) })).path;
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        link.download = suggested; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        target = `Downloads/${suggested}`;
      }
      const unchanged = startRevision === revision.current;
      setSaved(unchanged);
      setStatus(unchanged ? `Salvo em ${target}` : `Salvo em ${target}, mas o texto foi editado. Salve novamente antes de avançar.`);
    } catch (reason) {
      setStatus(`Erro ao salvar: ${message(reason)} Escolha outro local ou verifique as permissões e tente novamente. A transcrição foi preservada.`);
    } finally { setSaving(false); }
  }

  async function copy() {
    if (!transcript) return;
    try { await navigator.clipboard.writeText(transcript); setStatus('Texto copiado.'); }
    catch (reason) { setStatus(`Não foi possível copiar: ${message(reason)}`); }
  }

  function edit(value: string) {
    revision.current++;
    setTranscript(value); setSaved(false);
    if (completed) setStatus('Texto editado: é necessário salvar novamente antes de Próximo vídeo.');
  }

  const warning = !connection ? 'Conecte o backend local em Ajustes para transcrever.'
    : capabilities && !capabilities.engine ? 'Motor Whisper não instalado no backend. Prepare o extra transcription.' : '';
  return <div className="transcription" hidden={hidden}>
    <aside className="transcription-sources">
      <div className="stack"><p className="eyebrow accent">01 / TRANSCRIÇÃO</p><h1>Áudio e vídeo<br />em texto.</h1>
        <p className="muted">Transcrição offline com Whisper. Seus arquivos não saem do computador.</p></div>
      <div className={`drop-zone ${dragging ? 'dragging' : ''}`}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="accent" aria-hidden="true"><path d="M14 0V20M6 12L14 20L22 12M0 26H28" stroke="currentColor" strokeWidth="1.5" /></svg>
        {nativeDesktop && <p className="eyebrow">ARRASTE ARQUIVOS AQUI</p>}
        <p className="muted small-text">mp3, wav, m4a, mp4, mkv, mov, webm...</p>
        {nativeDesktop
          ? <button className="button" disabled={busy} onClick={() => void selectMediaFiles().then(enqueue).catch(reason => setStatus(message(reason)))}>SELECIONAR ARQUIVOS</button>
          : <form className="stack" onSubmit={event => { event.preventDefault(); if (enqueue([manualPath]) > 0) setManualPath(''); }}>
            <label>Caminho local do arquivo<input value={manualPath} onChange={e => setManualPath(e.target.value)} disabled={busy} placeholder="C:\Vídeos\entrevista.mp4" autoComplete="off" /></label>
            <button className="button" type="submit" disabled={busy || !manualPath.trim()}>ADICIONAR À FILA</button>
          </form>}
      </div>
      <div className="stack"><p className="eyebrow">YOUTUBE</p>
        <input aria-label="Link do YouTube" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} placeholder="Cole o link de um vídeo" autoComplete="off" />
        {!nativeDesktop && <input aria-label="Pasta de destino do download" value={manualFolder} onChange={e => setManualFolder(e.target.value)} disabled={busy} placeholder="Pasta de destino no computador" autoComplete="off" />}
        <button className="button" disabled={busy || !connection || queue.length >= maxQueue || !isYouTubeUrl(url)} onClick={() => void download()}>BAIXAR E ADICIONAR À FILA</button>
        <p className="muted small-text">Baixe apenas vídeos que você tem autorização para salvar.</p></div>
      <div className="stack"><label>Modelo<select value={model} onChange={e => setModel(e.target.value)} disabled={busy}>{models.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Idioma<select value={language} onChange={e => setLanguage(e.target.value)} disabled={busy}>{languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className="stack"><div className="row spread"><p className="eyebrow">FILA</p><span className="tag" aria-label="Arquivos na fila">{queue.length}/{maxQueue}</span></div>
        {queue.length === 0 ? <p className="muted small-text">A fila está vazia. O primeiro arquivo da fila é sempre o atual.</p>
          : <ol className="queue" aria-label="Fila de transcrição">{queue.map((file, index) => <li key={`${index}-${file}`} title={file}><span>{fileName(file)}</span><small>{folder(file)}</small></li>)}</ol>}</div>
    </aside>
    <section className="transcription-result" aria-label="Arquivo atual">
      <div className="row spread"><div className="current-file"><p className="eyebrow">ARQUIVO ATUAL</p><h2>{current ? fileName(current) : 'Nenhum arquivo'}</h2><p className="muted small-text">{current ? folder(current) : ''}</p></div>
        <ol className="steps"><li className={completed ? 'done' : ''}>01 TRANSCREVER</li><li className={saved ? 'done' : ''}>02 SALVAR .TXT</li><li className={saved ? 'ready' : ''}>03 PRÓXIMO</li></ol></div>
      <div className="transcription-actions">
        <button className="button primary" disabled={busy || completed || !current || !connection} onClick={() => void transcribe()}>TRANSCREVER</button>
        <button className="button" disabled={!active?.id} onClick={() => void cancel()}>CANCELAR</button>
        <button className="button" disabled={busy || !completed || !saved || queue.length < 2} onClick={() => void next()}>PRÓXIMO VÍDEO</button>
        <div className={`progress ${active?.kind === 'download' ? 'indeterminate' : ''}`} role="progressbar" aria-label="Progresso" aria-valuemin={0} aria-valuemax={100} aria-valuenow={active?.kind === 'download' ? undefined : progress}><span style={{ width: `${progress}%` }} /></div>
        <span className="eyebrow progress-value">{progress}%</span>
      </div>
      {warning && <p className="error" role="alert">{warning}</p>}
      <textarea className="transcript" aria-label="Transcrição" value={transcript} readOnly={busy} onChange={e => edit(e.target.value)}
        placeholder="A transcrição aparecerá aqui. Adicione um arquivo e clique em Transcrever." />
      <div className="status-bar"><p role="status" title={status}>{status}</p>
        <button className="button" disabled={!transcript} onClick={() => void copy()}>COPIAR</button>
        <button className="button primary" disabled={busy || !(completed || transcript.trim())} onClick={() => void save()}>SALVAR .TXT</button></div>
    </section>
  </div>;
}
