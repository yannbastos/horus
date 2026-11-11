export type Connection = { baseUrl: string; token: string };
export type HermesStatus = {
  state: string; connected: boolean; cli_available: boolean; configured: boolean;
  message: string; checked_at: string | null; version: string | null; features: string[];
};
export type JobStatus = 'queued' | 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'blocked';
export type FactoryPayload = { operation: 'factory.profile' | 'factory.render.preview'; channel_id: string; video_id: string | null };
export type TranscriptionPayload = { operation: 'transcription.run'; path: string; model: string; language: string };
export type DownloadPayload = { operation: 'youtube.download'; url: string; directory: string };
export type Job = {
  id: string; status: JobStatus; attempt: number; created_at: string; updated_at: string;
  payload: FactoryPayload | TranscriptionPayload | DownloadPayload;
  error: string | null; result: unknown;
};
export type JobEvent = { sequence: number; kind: string; message: string; job?: Job };
export type Media = { id: string; name: string; size: number; stream_path: string };
export const terminalStatuses: JobStatus[] = ['succeeded', 'failed', 'cancelled', 'interrupted', 'blocked'];

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T>(connection: Connection, path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, 15000);
  try {
    const response = await fetch(connection.baseUrl + path, {
      ...options, signal: controller.signal,
      headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json', ...options.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(typeof body?.detail === 'string' ? body.detail : `Não foi possível concluir a operação (${response.status}).`, response.status);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

export async function observeJob(connection: Connection, jobId: string, signal: AbortSignal, onEvent: (event: JobEvent) => void, after = 0) {
  let cursor = after;
  let failures = 0;
  // Uma reconexão é idempotente: somente eventos posteriores ao último recebido.
  while (!signal.aborted) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let watchdog = window.setTimeout(abort, 30000);
    try {
      const response = await fetch(`${connection.baseUrl}/v1/jobs/${jobId}/events?after=${cursor}`, {
        headers: { Authorization: `Bearer ${connection.token}` }, signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('Não foi possível acompanhar esta tarefa.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      try {
        while (!signal.aborted) {
          const chunk = await reader.read();
          pending += decoder.decode(chunk.value, { stream: !chunk.done });
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as JobEvent;
            if (!event || typeof event.kind !== 'string') throw new Error('Frame de acompanhamento inválido.');
            if (event.kind === 'keepalive') {
              if (event.sequence !== undefined) throw new Error('Keepalive não pode alterar o cursor.');
            } else if (event.kind === 'complete') {
              if (!event.job || event.job.id !== jobId || !terminalStatuses.includes(event.job.status)) throw new Error('Resultado de acompanhamento inválido.');
            } else if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0 || typeof event.message !== 'string') {
              throw new Error('Evento de acompanhamento inválido.');
            }
            failures = 0;
            clearTimeout(watchdog);
            watchdog = window.setTimeout(abort, 30000);
            if (event.kind === 'keepalive') continue;
            if (event.sequence && event.sequence <= cursor) continue;
            if (event.sequence) cursor = event.sequence;
            onEvent(event);
            if (event.kind === 'complete') return;
          }
          if (chunk.done) throw new Error('A conexão com a tarefa foi interrompida.');
        }
      } finally { await reader.cancel().catch(() => undefined); }
    } catch (error) {
      if (signal.aborted) return;
      if (++failures >= 3) throw error;
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = window.setTimeout(finish, 500 * failures);
        signal.addEventListener('abort', finish, { once: true });
      });
    } finally {
      clearTimeout(watchdog);
      signal.removeEventListener('abort', abort);
    }
  }
}
