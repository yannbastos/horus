import { useEffect, useRef, useState } from 'react';
import { api, ApiError, observeJob, terminalStatuses } from '../services/api';
import type { Connection, Job, JobEvent } from '../services/api';
import { nativeDesktop, onFileDrop, selectDirectory, selectMediaFiles, selectSavePath } from '../platform/desktop';
import { inspectAttachment, InvalidReceiptError, ReceiptStorageError, saveAttachment } from '../services/transcriptionRecovery';
import type { Attachment, MediaPayload } from '../services/transcriptionRecovery';

export const maxQueue = 20;
const models = [
  ['tiny', 'Tiny · ~75 MB · mais rápido'], ['base', 'Base · ~145 MB'], ['small', 'Small · ~485 MB · equilíbrio'],
  ['medium', 'Medium · ~1,5 GB'], ['large-v3-turbo', 'Large v3 Turbo · ~1,6 GB · melhor qualidade'],
];
const languages = [['auto', 'Detectar automaticamente'], ['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol']];
type Capabilities = { engine: boolean; downloader: boolean; ffmpeg: boolean };
const statusLabels: Record<string, string> = {
  queued: 'Na fila', running: 'Em execução', cancel_requested: 'Cancelando', succeeded: 'Concluído',
  failed: 'Falhou', cancelled: 'Cancelado', interrupted: 'Interrompido', blocked: 'Bloqueado',
};

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
  const [initialReceipt] = useState(inspectAttachment);
  const [queue, setQueue] = useState<string[]>(() => {
    const pending = initialReceipt.attachment;
    return pending?.payload.operation === 'transcription.run' ? [pending.payload.path] : [];
  });
  // Recibo pendente restaura as opções da tarefa original; um novo Transcrever não troca de modelo sem aviso.
  const receiptPayload = initialReceipt.attachment?.payload;
  const [model, setModel] = useState(receiptPayload?.operation === 'transcription.run' ? receiptPayload.model : 'small');
  const queueRef = useRef(queue);
  function replaceQueue(files: string[]) { queueRef.current = files; setQueue(files); }
  const [language, setLanguage] = useState(receiptPayload?.operation === 'transcription.run' ? receiptPayload.language : 'auto');
  const [url, setUrl] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [manualFolder, setManualFolder] = useState('');
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('Adicione um arquivo de áudio ou vídeo para começar.');
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [active, setActive] = useState<Attachment | null>(initialReceipt.attachment);
  const [invalidReceipt, setInvalidReceipt] = useState<string | null>(initialReceipt.invalid);
  const [storageError, setStorageError] = useState<string | null>(initialReceipt.storage);
  const [unreadableReceipt, setUnreadableReceipt] = useState(!!initialReceipt.storage);
  const [following, setFollowing] = useState(false);
  const flight = useRef(false);
  const [history, setHistory] = useState<Job[]>([]);
  const [offset, setOffset] = useState(0);
  const [historyError, setHistoryError] = useState('');
  const [historyRevision, setHistoryRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const revision = useRef(0);
  const unmounted = useRef(new AbortController());
  const busy = active !== null || saving || invalidReceipt !== null || unreadableReceipt;
  const current = queue[0];

  useEffect(() => {
    const controller = new AbortController();
    setHistory([]); setHistoryError('');
    if (connection) void api<Job[]>(connection, `/v1/transcription/jobs?offset=${offset}`, { signal: controller.signal })
      .then(setHistory).catch(reason => { if (!controller.signal.aborted) setHistoryError(message(reason)); });
    return () => controller.abort();
  }, [connection, offset, historyRevision]);

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
    const currentQueue = queueRef.current;
    const accepted = files.filter(file => file.trim()).slice(0, Math.max(0, maxQueue - currentQueue.length));
    const rejected = files.filter(file => file.trim()).length - accepted.length;
    const next = [...currentQueue, ...accepted];
    replaceQueue(next);
    setStatus(rejected > 0 ? `Limite de ${maxQueue} arquivos. ${rejected} não adicionado(s).`
      : `Fila: ${next.length}/${maxQueue}. Clique em Transcrever para iniciar o arquivo atual.`);
    return accepted.length;
  }

  async function browse() {
    if (busy || flight.current) return;
    setSaving(true);
    try { enqueue(await selectMediaFiles()); }
    catch (reason) { setStatus(`Erro ao selecionar arquivos: ${message(reason)}`); }
    finally { setSaving(false); }
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
    }).then(unlisten => { if (cancelled) unlisten(); else release = unlisten; })
      .catch(reason => { if (!cancelled) setStatus(`Não foi possível ativar arrastar arquivos: ${message(reason)}`); });
    return () => { cancelled = true; release?.(); };
  }, []);

  function remember(value: Attachment | null) {
    // Persistir antes de POST: uma resposta perdida reutiliza a mesma chave após reabrir.
    try { saveAttachment(value); }
    catch (error) {
      // O POST pode ter sido aceito; mantenha o ID em memória mesmo se sua gravação falhar.
      if (value) setActive(value);
      throw error;
    }
    setStorageError(null);
    setActive(value);
  }

  function discardReceipt() {
    if (!window.confirm('Descartar somente o recibo local? Isso não cancela a tarefa nem apaga dados do backend. Confira o histórico antes de iniciar outra execução.')) return;
    try {
      saveAttachment(null);
      if (active?.previous && !transcript) { setTranscript(active.previous); setSaved(false); }
      setActive(null); setInvalidReceipt(null); setStorageError(null); setUnreadableReceipt(false);
      setStatus('Recibo descartado por sua confirmação. Confira o histórico antes de iniciar outra execução.');
    } catch (error) { setStorageError(message(error)); }
  }

  function validateReceiptJob(job: Job, attachment: Attachment) {
    if (!job?.payload || (attachment.id && job.id !== attachment.id)
      || Object.entries(attachment.payload).some(([key, value]) =>
        (job.payload as unknown as Record<string, unknown>)[key] !== value)) {
      throw new InvalidReceiptError('A identidade ou os dados do job divergem do recibo.');
    }
  }

  const connectionHelp = nativeDesktop
    ? 'Backend local indisponível. Use RECONECTAR BACKEND em Ajustes e depois retome o acompanhamento.'
    : 'Conecte o backend local em Ajustes.';

  async function runJob(attachment: Attachment, onSnapshot: (job: Job) => void,
    onEvent: (event: JobEvent) => void): Promise<Job> {
    if (!connection) throw new Error(connectionHelp);
    const health = await api<{ database_id?: string }>(connection, '/health');
    if (initialReceipt.attachment?.key === attachment.key && !attachment.databaseId) {
      throw new InvalidReceiptError('Este recibo antigo não identifica sua base original. Confira o histórico antes de descartá-lo.');
    }
    if (attachment.databaseId && health.database_id !== attachment.databaseId) {
      throw new InvalidReceiptError('O recibo pertence a outra instância da base de dados.');
    }
    const bound = { ...attachment, databaseId: health.database_id };
    remember(bound);
    const job = attachment.id ? await api<Job>(connection, `/v1/jobs/${attachment.id}`)
      : await api<Job>(connection, '/v1/jobs', { method: 'POST',
        headers: { 'Idempotency-Key': attachment.key }, body: JSON.stringify(attachment.payload) });
    validateReceiptJob(job, attachment);
    setInvalidReceipt(null);
    remember({ ...bound, id: job.id });
    onSnapshot(job);
    if (terminalStatuses.includes(job.status)) return job;
    let final: Job | undefined;
    try {
      const result = job.result as { sequence?: number } | null;
      await observeJob(connection, job.id, unmounted.current.signal, event => {
        if (event.kind === 'complete') final = event.job; else onEvent(event);
      }, result?.sequence ?? 0);
    } catch (reason) {
      // Falha do stream não significa falha da execução. Consultar o job original, sem POST.
      const snapshot = await api<Job>(connection, `/v1/jobs/${job.id}`).catch(error => {
        if (error instanceof ApiError && [404, 409].includes(error.status)) throw error;
        return null;
      });
      if (!snapshot) throw reason;
      validateReceiptJob(snapshot, { ...bound, id: job.id });
      onSnapshot(snapshot);
      if (!terminalStatuses.includes(snapshot.status)) throw reason;
      return snapshot;
    }
    if (unmounted.current.signal.aborted) throw new Error('Acompanhamento suspenso.');
    return final ?? api<Job>(connection, `/v1/jobs/${job.id}`);
  }

  async function follow(attachment: Attachment) {
    if (flight.current) return;
    flight.current = true; setFollowing(true);
    const started = performance.now();
    let partial = '';
    let deviceUsed = '';
    let observed = false;  // recebeu eventos de execução nesta sessão; senão é um resultado já encerrado
    const transcription = attachment.payload.operation === 'transcription.run';
    try {
      const job = await runJob(attachment, snapshot => {
        partial = (snapshot.result as { text?: string } | null)?.text ?? '';
        if (transcription) setTranscript(attachment.previous + partial);
      }, event => {
        observed = true;
        if (event.kind === 'status') {
          setStatus(event.message);
          const device = event.message.match(/^Transcrevendo em (CPU|CUDA) \((int8|float16)\)/);
          if (device) deviceUsed = `${device[1]} (${device[2]})`;
        }
        else if (event.kind === 'progress') setProgress(Number(event.message) || 0);
        else if (event.kind === 'segment') { partial += `${event.message}\n`; setTranscript(attachment.previous + partial); }
        else if (!transcription && ['stdout', 'stderr'].includes(event.kind)) setStatus(event.message);
      });
      const result = job.result as { text?: string; path?: string } | null;
      if (!transcription) {
        if (job.status === 'succeeded' && result?.path) {
          const added = enqueue([result.path]); setUrl(''); setProgress(100);
          setStatus(`Vídeo salvo em ${result.path}. ${added ? 'Adicionado ao final da fila.' : 'A fila está cheia; o arquivo foi preservado no destino.'}`);
        } else setStatus(`Download ${job.status}: ${job.error ?? 'Consulte o histórico.'}`);
      } else if (job.status === 'succeeded') {
        setTranscript(result?.text ?? partial); setCompleted(true); setProgress(100);
        setStatus(attachment.id && !observed ? 'Transcrição recuperada do histórico. Salve o .txt antes de Próximo vídeo.'
          : `Concluído em ${elapsed(started)}${deviceUsed ? ` usando ${deviceUsed}` : ''}. Salve o .txt antes de Próximo vídeo.`);
      } else {
        setTranscript(attachment.previous + (result?.text ?? partial));
        setStatus(job.status === 'cancelled' ? 'Cancelado. Texto parcial preservado; Transcrever tenta novamente o mesmo arquivo.'
          : `Erro: ${job.error ?? 'a transcrição não foi concluída.'}`);
      }
      remember(null);
      setHistoryRevision(value => value + 1);
    } catch (reason) {
      if (reason instanceof ReceiptStorageError) {
        setStorageError(reason.message);
        setStatus('Falha no armazenamento do recibo local. Preserve o texto e verifique a cota/permissões antes de retomar.');
        return;
      }
      if (reason instanceof InvalidReceiptError || (reason instanceof ApiError && [404, 409].includes(reason.status))) {
        setInvalidReceipt(`Não foi possível recuperar este recibo: ${message(reason)} Confira a base correta ou descarte o recibo explicitamente.`);
        return;
      }
      if (!attachment.id && reason instanceof ApiError && reason.status === 422) {
        try { remember(null); }
        catch (error) { setStorageError(message(error)); return; }
        setStatus(`Pedido recusado: ${message(reason)} Corrija os dados antes de tentar novamente.`);
        return;
      }
      setStatus(`Acompanhamento interrompido: ${message(reason)} A tarefa pode continuar. Retome o acompanhamento do job original.`);
      // Não liberar uma nova submissão enquanto o resultado da anterior é desconhecido.
    } finally { flight.current = false; setFollowing(false); }
  }

  async function transcribe(file = current, previous = transcript) {
    if (!file || busy || flight.current) return;
    setSaved(false); setProgress(0); setStatus('Aguardando a fila local de tarefas...');
    await follow({ id: null, key: crypto.randomUUID(), previous,
      payload: { operation: 'transcription.run', path: file, model, language } });
  }

  async function recover(job: Job) {
    if (busy || flight.current) return;
    if (transcript && !saved) { setStatus('Salve o texto atual antes de abrir outra tarefa do histórico.'); return; }
    if (!['transcription.run', 'youtube.download'].includes(job.payload.operation)) return;
    const payload = job.payload as MediaPayload;
    if (payload.operation === 'transcription.run') {
      const remaining = current === payload.path || completed ? queue.slice(1) : queue;
      if (remaining.length >= maxQueue) { setStatus('A fila está cheia. Conclua um arquivo antes de recuperar outro.'); return; }
      replaceQueue([payload.path, ...remaining]); setModel(payload.model); setLanguage(payload.language);
      setCompleted(false); setSaved(false); setTranscript('');
    } else {
      setUrl(payload.url); setManualFolder(payload.directory);
    }
    await follow({ id: job.id, key: crypto.randomUUID(), previous: '', payload });
  }

  async function next() {
    if (busy || !completed || !saved || queue.length < 2) return;
    const remaining = queue.slice(1);
    replaceQueue(remaining); setTranscript(''); setCompleted(false); setSaved(false);
    await transcribe(remaining[0], '');
  }

  async function cancel() {
    if (!connection || !active?.id || invalidReceipt) return;
    try {
      const health = await api<{ database_id?: string }>(connection, '/health');
      if (initialReceipt.attachment?.key === active.key && !active.databaseId) throw new InvalidReceiptError('Recibo antigo sem identidade da base original.');
      if (active.databaseId && health.database_id !== active.databaseId) throw new InvalidReceiptError('O recibo pertence a outra base.');
      validateReceiptJob(await api<Job>(connection, `/v1/jobs/${active.id}`), active);
      await api(connection, `/v1/jobs/${active.id}/cancel`, { method: 'POST' });
    } catch (reason) {
      if (reason instanceof InvalidReceiptError || (reason instanceof ApiError && [404, 409].includes(reason.status))) {
        setInvalidReceipt(`Não foi possível recuperar este recibo: ${message(reason)}`);
      } else setStatus(`Erro ao cancelar: ${message(reason)}`);
    }
  }

  async function download() {
    if (busy || queue.length >= maxQueue || !isYouTubeUrl(url)) return;
    setSaving(true);
    try {
      const directory = nativeDesktop ? await selectDirectory() : manualFolder.trim();
      if (!directory) { if (!nativeDesktop) setStatus('Informe a pasta onde o vídeo será salvo.'); return; }
      setProgress(0); setStatus('Iniciando download do YouTube...');
      await follow({ id: null, key: crypto.randomUUID(), previous: '', payload: { operation: 'youtube.download', url, directory } });
    } catch (reason) { setStatus(`Erro no download: ${message(reason)}`); }
    finally { setSaving(false); }
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

  const warning = !connection ? connectionHelp
    : capabilities && !capabilities.engine ? 'Dependências de transcrição indisponíveis. Consulte o diagnóstico em Ajustes e prepare o extra transcription.' : '';
  return <div className="transcription" hidden={hidden}>
    <aside className="transcription-sources">
      <div className="stack"><p className="eyebrow accent">01 / TRANSCRIÇÃO</p><h1>Áudio e vídeo<br />em texto.</h1>
        <p className="muted">Transcrição offline com Whisper. Seus arquivos não saem do computador.</p></div>
      <div className={`drop-zone ${dragging ? 'dragging' : ''}`}>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="accent" aria-hidden="true"><path d="M14 0V20M6 12L14 20L22 12M0 26H28" stroke="currentColor" strokeWidth="1.5" /></svg>
        {nativeDesktop && <p className="eyebrow">ARRASTE ARQUIVOS AQUI</p>}
        <p className="muted small-text">mp3, wav, m4a, mp4, mkv, mov, webm...</p>
        {nativeDesktop
          ? <button className="button" disabled={busy} onClick={() => void browse()}>SELECIONAR ARQUIVOS</button>
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
      <section className="stack" aria-label="Histórico de transcrições e downloads">
        <p className="eyebrow">TAREFAS RECUPERÁVEIS</p>
        <button className="button" disabled={!connection || following} onClick={() => setHistoryRevision(value => value + 1)}>ATUALIZAR HISTÓRICO</button>
        {historyError && <p className="error" role="alert">{historyError}</p>}
        {history.map(job => <button key={job.id} className="job-item" disabled={busy} onClick={() => void recover(job)}>
          <span>{job.payload.operation === 'transcription.run' ? fileName(job.payload.path) : 'Download YouTube'}</span>
          <small>{statusLabels[job.status] ?? job.status} · {new Date(job.created_at).toLocaleString('pt-BR')}</small>
        </button>)}
        <div className="actions"><button className="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>MAIS RECENTES</button>
          <button className="button" disabled={history.length < 100} onClick={() => setOffset(value => value + 100)}>MAIS ANTIGAS</button></div>
      </section>
    </aside>
    <section className="transcription-result" aria-label="Arquivo atual">
      <div className="row spread"><div className="current-file"><p className="eyebrow">ARQUIVO ATUAL</p><h2>{current ? fileName(current) : 'Nenhum arquivo'}</h2><p className="muted small-text">{current ? folder(current) : ''}</p></div>
        <ol className="steps"><li className={completed ? 'done' : ''}>01 TRANSCREVER</li><li className={saved ? 'done' : ''}>02 SALVAR .TXT</li><li className={saved ? 'ready' : ''}>03 PRÓXIMO</li></ol></div>
      <div className="transcription-actions">
        <button className="button primary" disabled={busy || completed || !current || !connection} onClick={() => void transcribe()}>TRANSCREVER</button>
        <button className="button" disabled={!active?.id || !!invalidReceipt} onClick={() => void cancel()}>CANCELAR</button>
        <button className="button" disabled={busy || !completed || !saved || queue.length < 2} onClick={() => void next()}>PRÓXIMO VÍDEO</button>
        <div className={`progress ${active?.payload.operation === 'youtube.download' ? 'indeterminate' : ''}`} role="progressbar" aria-label="Progresso" aria-valuemin={0} aria-valuemax={100} aria-valuenow={active?.payload.operation === 'youtube.download' ? undefined : progress}><span style={{ width: `${progress}%` }} /></div>
        <span className="eyebrow progress-value">{progress}%</span>
      </div>
      {warning && <p className="error" role="alert">{warning}</p>}
      {storageError && <p className="error" role="alert">{storageError}</p>}
      {invalidReceipt && <p className="error" role="alert">{invalidReceipt}</p>}
      {(invalidReceipt || unreadableReceipt) && <button className="button" disabled={following} onClick={discardReceipt}>DESCARTAR RECIBO INVÁLIDO</button>}
      {active && !following && <div className="stack"><p role="status">{active.id
        ? 'Há uma tarefa pendente de acompanhamento. Retomar consulta o job original.'
        : 'Resposta do pedido desconhecida. Retomar reutiliza o pedido original; se ele não chegou ao backend, poderá iniciar a primeira execução.'}</p>
        <button className="button" disabled={!connection} onClick={() => void follow(active)}>RETOMAR ACOMPANHAMENTO</button></div>}
      <textarea className="transcript" aria-label="Transcrição" value={transcript} readOnly={busy} onChange={e => edit(e.target.value)}
        placeholder="A transcrição aparecerá aqui. Adicione um arquivo e clique em Transcrever." />
      <div className="status-bar"><p role="status" title={status}>{status}</p>
        <button className="button" disabled={!transcript} onClick={() => void copy()}>COPIAR</button>
        <button className="button primary" disabled={busy || !(completed || transcript.trim())} onClick={() => void save()}>SALVAR .TXT</button></div>
    </section>
  </div>;
}
