import { api, ApiError } from './api';
import type { Connection, JobStatus } from './api';

export type ProductionMode = 'simulated' | 'local_demo';

export type ProductionStage =
  | 'prepare'
  | 'narration'
  | 'scenes'
  | 'subtitles'
  | 'render'
  | 'review';

export type ProductionArtifactKind =
  | 'plan'
  | 'scene'
  | 'audio'
  | 'subtitles'
  | 'video'
  | 'manifest';

export type ProductionArtifact = {
  id: string;
  kind: ProductionArtifactKind;
  relative_path: string;
  size_bytes: number;
  sha256: string;
};

export type ProductionReviewDecision = 'approve' | 'reject';

export type ProductionReview = {
  decision: ProductionReviewDecision;
  artifact_sha256: string;
  reviewed_at: string;
};

export type ProductionRecord = {
  id: string;
  script_id: string;
  script_version: number;
  script_content_hash: string;
  job_id: string;
  mode: ProductionMode;
  stage: ProductionStage;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  artifacts: ProductionArtifact[];
  review: ProductionReview | null;
  error?: string | null;
  demo_only?: boolean;
  real_voice?: boolean;
  speech_aligned?: boolean;
};

export type ProductionListResponse = {
  items: ProductionRecord[];
};

export type CreateProductionPayload = {
  expected_version: number;
  mode: ProductionMode;
};

export type ReviewProductionPayload = {
  decision: ProductionReviewDecision;
  artifact_sha256: string;
};

export function sortProductionsDesc(items: ProductionRecord[]): ProductionRecord[] {
  return [...items].sort((a, b) => {
    const timeDiff = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (!Number.isNaN(timeDiff) && timeDiff !== 0) {
      return timeDiff;
    }
    return b.id.localeCompare(a.id);
  });
}

export function formatProductionError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return `Sessão não autorizada (401): ${error.message}`;
    }
    if (error.status === 404) {
      return `Produção, artefato ou roteiro não encontrado (404): ${error.message}`;
    }
    if (error.status === 409) {
      return `Conflito de versão, hash ou estado (409): ${error.message}`;
    }
    if (error.status === 422) {
      return `Contrato ou payload inválido (422): ${error.message}`;
    }
    return `Erro na operação (${error.status}): ${error.message}`;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `Falha de rede ao comunicar com o backend local: ${detail}`;
}

export async function getScriptProductions(
  connection: Connection,
  scriptId: string,
  signal?: AbortSignal
): Promise<ProductionRecord[]> {
  const response = await api<ProductionListResponse | ProductionRecord[]>(
    connection,
    `/v1/scripts/${encodeURIComponent(scriptId)}/productions`,
    { signal }
  );
  const items = Array.isArray(response) ? response : response.items ?? [];
  return sortProductionsDesc(items);
}

export async function getProduction(
  connection: Connection,
  productionId: string,
  signal?: AbortSignal
): Promise<ProductionRecord> {
  return api<ProductionRecord>(
    connection,
    `/v1/productions/${encodeURIComponent(productionId)}`,
    { signal }
  );
}

export async function createScriptProduction(
  connection: Connection,
  scriptId: string,
  payload: CreateProductionPayload,
  idempotencyKey: string = crypto.randomUUID(),
  signal?: AbortSignal
): Promise<ProductionRecord> {
  return api<ProductionRecord>(
    connection,
    `/v1/scripts/${encodeURIComponent(scriptId)}/productions`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        expected_version: payload.expected_version,
        mode: payload.mode,
      }),
      signal,
    }
  );
}

export async function reviewProduction(
  connection: Connection,
  productionId: string,
  payload: ReviewProductionPayload,
  idempotencyKey: string = crypto.randomUUID(),
  signal?: AbortSignal
): Promise<ProductionRecord> {
  return api<ProductionRecord>(
    connection,
    `/v1/productions/${encodeURIComponent(productionId)}/review`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        decision: payload.decision,
        artifact_sha256: payload.artifact_sha256,
      }),
      signal,
    }
  );
}

export async function cancelProductionJob(
  connection: Connection,
  jobId: string,
  signal?: AbortSignal
): Promise<unknown> {
  return api<unknown>(connection, `/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    signal,
  });
}

export async function retryProductionJob(
  connection: Connection,
  jobId: string,
  signal?: AbortSignal
): Promise<unknown> {
  return api<unknown>(connection, `/v1/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    signal,
  });
}

export async function fetchProductionArtifactBlob(
  connection: Connection,
  productionId: string,
  artifactId: string,
  signal?: AbortSignal
): Promise<{ blob: Blob; contentType: string }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, 30000);
  try {
    const response = await fetch(
      `${connection.baseUrl}/v1/productions/${encodeURIComponent(productionId)}/artifacts/${encodeURIComponent(artifactId)}`,
      {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${connection.token}`,
        },
      }
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(
        typeof body?.detail === 'string'
          ? body.detail
          : `Não foi possível carregar o artefato (${response.status}).`,
        response.status
      );
    }
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const blob = await response.blob();
    return { blob, contentType };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
