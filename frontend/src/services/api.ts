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

// --- Radar ---
export type RadarOrigin = 'operator_fixture' | 'youtube_data_api' | string;

export type RadarDatasetSummary = {
  snapshot_id: string;
  revision: number;
  origin: RadarOrigin;
  status: 'complete' | 'partial' | 'failed' | string;
  collected_at: string;
  expires_at: string;
  records: number;
  videos: number;
  eligible_videos: number;
  issues: number;
};

export type RadarEligibility = {
  eligible: boolean;
  reasons: string[];
};

export type RadarPublicRecord = {
  source_id: string;
  kind: 'youtube_video' | 'youtube_channel';
  youtube_id: string;
  url: string;
  retrieved_at: string;
  expires_at: string;
  origin: string;
  endpoint: string;
  title?: string | null;
  channel_id?: string | null;
  channel_title?: string | null;
  published_at?: string | null;
  duration_iso8601?: string | null;
  duration_seconds?: number | null;
  language?: string | null;
  country?: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  subscribers?: number | null;
  subscribers_rounded?: boolean | null;
  video_count?: number | null;
  uploads_playlist?: string | null;
  live_status?: string | null;
  unavailable?: Record<string, string>;
};

export type RadarDataset = {
  schema_version: string;
  snapshot_id: string;
  revision: number;
  origin: RadarOrigin;
  collected_at: string;
  expires_at: string;
  request?: unknown;
  status: 'complete' | 'partial' | 'failed' | string;
  records: RadarPublicRecord[];
  issues?: { code: string; resource: string; references?: string[]; retryable?: boolean; message: string }[];
  limitations?: string[];
  quota_spent?: Record<string, number>;
};

export type RadarDatasetDetail = {
  dataset: RadarDataset;
  eligibility: Record<string, RadarEligibility>;
};

export type CreateRadarWorkflowRequest = {
  snapshot_id: string;
  revision: number;
  source_ids?: string[];
  objective: string;
  channel: {
    channel_id: string;
    summary: string;
  };
};

export type RadarWorkflowBlock = {
  snapshot_id: string;
  revision: number;
  origin: RadarOrigin;
  expires_at: string;
  included: string[];
  excluded: { source_id: string; reasons: string[] }[];
};

// --- Workflows ---
export type WorkflowStage = 'planning' | 'research' | 'analysis' | 'proposal';
export type WorkflowStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'cancel_requested'
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'unknown'
  | string;

export type WorkflowSummary = {
  id: string;
  status: WorkflowStatus;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowStepJob = {
  id: string;
  workflow_id: string;
  workflow_revision: number;
  step_key: WorkflowStage;
  step_index: number;
  status: string;
  attempt: number;
  created_at: string;
  updated_at: string;
  depends_on: string | null;
  payload?: { operation: string; stage: WorkflowStage };
  error: string | null;
  result: unknown;
};

export type Recommendation = {
  title_options: string[];
  premise: string;
  angle: string;
  format: 'short' | 'long' | string;
  originality: string;
  differs_from?: string[];
  risks?: string[];
  licensing_notes?: string;
};

export type AnalysisSource = {
  id: string;
  kind?: string;
  url: string;
  title?: string | null;
  retrieved_at: string;
};

export type MetricRef = {
  source_id: string;
  field: string;
  value: number;
};

export type AnalysisFact = {
  id: string;
  text: string;
  source_ids: string[];
  metric_refs?: MetricRef[];
};

export type AnalysisHypothesis = {
  id: string;
  text: string;
  based_on: string[];
  confidence: 'low' | 'medium' | 'high' | string;
  how_to_test: string;
};

export type AnalysisOpportunity = {
  id: string;
  summary: string;
  based_on: string[];
  br_fit_rationale: string;
};

export type ProposalArtifactContent = {
  schema_version?: number;
  simulated?: boolean;
  stage: 'proposal';
  title: string;
  text?: string;
  result_status?: 'complete' | 'partial' | 'insufficient_data' | string;
  recommendation?: Recommendation;
  opportunities?: AnalysisOpportunity[];
  unknowns?: string[];
  evidence?: {
    sources: number;
    facts: number;
    hypotheses: number;
  };
  memory_proposals?: { text: string; evidence: string[] }[];
  usage?: unknown;
  requires_human_review?: boolean;
};

export type AnalysisArtifactContent = {
  schema_version?: number;
  simulated?: boolean;
  stage: 'analysis';
  title?: string;
  text?: string;
  result?: {
    contract_version?: string;
    task_id?: string;
    status?: string;
    plan?: { step: string; done: boolean }[];
    sources?: AnalysisSource[];
    facts?: AnalysisFact[];
    hypotheses?: AnalysisHypothesis[];
    opportunities?: AnalysisOpportunity[];
    recommendation?: Recommendation;
    unknowns?: string[];
    memory_proposals?: { text: string; evidence: string[] }[];
  };
  usage?: unknown;
  provider?: string;
  external_ref?: string | null;
};

export type WorkflowArtifact = {
  id: string;
  workflow_id: string;
  revision: number;
  stage: WorkflowStage;
  job_id: string;
  attempt_id: string;
  schema_version: number;
  content: ProposalArtifactContent | AnalysisArtifactContent | any;
  content_hash: string;
  created_at: string;
};

export type WorkflowApproval = {
  id: string;
  workflow_id: string;
  revision: number;
  artifact_id: string;
  decision: 'approve' | 'reject' | 'request_changes';
  feedback: string;
  created_at: string;
};

export type WorkflowCognitiveRun = {
  id: string;
  job_id: string;
  attempt_id: string;
  provider: string;
  status: string;
  remote_status?: string | null;
  usage?: unknown;
  error?: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowAuthorization = {
  id: string;
  workflow_id: string;
  revision: number;
  job_id: string;
  input_artifact_id: string;
  scope: string;
  max_runs: number;
  operator_id: string;
  consumed_attempt_id?: string | null;
  created_at: string;
};

export type WorkflowDetail = {
  id: string;
  status: WorkflowStatus;
  revision: number;
  executor: string;
  simulated: boolean;
  request: {
    objective: string;
    references?: string[];
    dataset?: unknown;
    channel_profile?: unknown;
  };
  radar?: RadarWorkflowBlock;
  current_artifact_id?: string | null;
  feedback?: string;
  steps: WorkflowStepJob[];
  artifacts: WorkflowArtifact[];
  approvals: WorkflowApproval[];
  cognitive_runs: WorkflowCognitiveRun[];
  authorizations: WorkflowAuthorization[];
  pending_authorization: {
    job_id: string;
    stage: WorkflowStage;
  } | null;
  created_at: string;
  updated_at: string;
};

export type ReviewResponse = {
  approval: WorkflowApproval;
  workflow: WorkflowDetail;
};

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

// --- Radar API calls ---
export async function getRadarDatasets(connection: Connection): Promise<RadarDatasetSummary[]> {
  return api<RadarDatasetSummary[]>(connection, '/v1/radar/datasets');
}

export async function getRadarDatasetDetail(
  connection: Connection,
  snapshotId: string,
  revision: number
): Promise<RadarDatasetDetail> {
  return api<RadarDatasetDetail>(connection, `/v1/radar/datasets/${encodeURIComponent(snapshotId)}/${revision}`);
}

export async function createRadarDemoDataset(
  connection: Connection,
  idempotencyKey = crypto.randomUUID()
): Promise<RadarDatasetSummary> {
  return api<RadarDatasetSummary>(connection, '/v1/radar/datasets/demo', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function createRadarWorkflow(
  connection: Connection,
  payload: CreateRadarWorkflowRequest,
  idempotencyKey = crypto.randomUUID()
): Promise<WorkflowDetail> {
  return api<WorkflowDetail>(connection, '/v1/workflows/radar', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  });
}

// --- Workflow API calls ---
export async function getWorkflows(connection: Connection): Promise<WorkflowSummary[]> {
  return api<WorkflowSummary[]>(connection, '/v1/workflows');
}

export async function getWorkflow(connection: Connection, workflowId: string): Promise<WorkflowDetail> {
  return api<WorkflowDetail>(connection, `/v1/workflows/${encodeURIComponent(workflowId)}`);
}

export async function authorizeWorkflow(
  connection: Connection,
  workflowId: string,
  payload: { expected_revision: number; job_id: string },
  idempotencyKey = crypto.randomUUID()
): Promise<WorkflowDetail> {
  return api<WorkflowDetail>(connection, `/v1/workflows/${encodeURIComponent(workflowId)}/authorize`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  });
}

export async function reviewWorkflow(
  connection: Connection,
  workflowId: string,
  payload: {
    expected_revision: number;
    artifact_id: string;
    decision: 'approve' | 'reject' | 'request_changes';
    feedback?: string;
  },
  idempotencyKey = crypto.randomUUID()
): Promise<ReviewResponse> {
  return api<ReviewResponse>(connection, `/v1/workflows/${encodeURIComponent(workflowId)}/review`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  });
}

export async function cancelWorkflow(connection: Connection, workflowId: string): Promise<WorkflowDetail> {
  return api<WorkflowDetail>(connection, `/v1/workflows/${encodeURIComponent(workflowId)}/cancel`, {
    method: 'POST',
  });
}

export async function retryWorkflow(
  connection: Connection,
  workflowId: string,
  expectedRevision: number
): Promise<WorkflowDetail> {
  return api<WorkflowDetail>(connection, `/v1/workflows/${encodeURIComponent(workflowId)}/retry`, {
    method: 'POST',
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
}

export async function reconcileWorkflow(
  connection: Connection,
  workflowId: string,
  expectedRevision: number
): Promise<WorkflowDetail> {
  return api<WorkflowDetail>(connection, `/v1/workflows/${encodeURIComponent(workflowId)}/reconcile`, {
    method: 'POST',
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
}
