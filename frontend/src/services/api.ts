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

export async function api<T>(connection: Connection, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(connection.baseUrl + path, {
    ...options,
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Não foi possível concluir a operação (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export async function observeJob(connection: Connection, jobId: string, signal: AbortSignal, onEvent: (event: JobEvent) => void) {
  let cursor = 0;
  // Uma reconexão é idempotente: somente eventos posteriores ao último recebido.
  for (let attempt = 0; !signal.aborted; attempt++) {
    try {
      const response = await fetch(`${connection.baseUrl}/v1/jobs/${jobId}/events?after=${cursor}`, {
        headers: { Authorization: `Bearer ${connection.token}` }, signal,
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
            if (event.sequence) cursor = event.sequence;
            onEvent(event);
            if (event.kind === 'complete') return;
          }
          if (chunk.done) throw new Error('A conexão com a tarefa foi interrompida.');
        }
      } finally { await reader.cancel().catch(() => undefined); }
    } catch (error) {
      if (signal.aborted) return;
      if (attempt >= 2) throw error;
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 500 * (attempt + 1));
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  }
}
