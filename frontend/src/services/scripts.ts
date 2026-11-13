import { api, ApiError } from './api';
import type { Connection } from './api';

export type ScriptSectionKind = 'hook' | 'body' | 'conclusion';

export type ScriptSection = {
  id: string;
  kind: ScriptSectionKind;
  heading: string;
  narration: string;
  source_ids: string[];
};

export type ScriptDocument = {
  schema_version: 1;
  simulated: boolean;
  title: string;
  sections: ScriptSection[];
};

export type ScriptOrigin = 'simulated' | 'human';

export type ScriptSectionChangeField = 'kind' | 'heading' | 'narration' | 'source_ids';

export type ScriptSectionChange = {
  id: string;
  fields: ScriptSectionChangeField[];
};

export type ScriptChanges = {
  previous_version: number;
  title_changed: boolean;
  sections_added: string[];
  sections_removed: string[];
  sections_changed: ScriptSectionChange[];
  order_changed: boolean;
};

export type ScriptStatus = 'awaiting_review' | 'approved' | 'rejected' | 'changes_requested';

export type ScriptReviewDecision = 'approve' | 'reject' | 'request_changes';

export type ScriptReviewInfo = {
  decision: ScriptReviewDecision;
  feedback: string;
  reviewed_at: string;
};

export type ScriptRecord = {
  id: string;
  workflow_id: string;
  workflow_revision: number;
  proposal_artifact_id: string;
  proposal_content_hash: string;
  version: number;
  status: ScriptStatus;
  origin?: ScriptOrigin;
  authored_by?: ScriptOrigin;
  changes?: ScriptChanges | null;
  document: ScriptDocument;
  created_at: string;
  review: ScriptReviewInfo | null;
};

export type ScriptListResponse = {
  items: ScriptRecord[];
};

export type CreateScriptPayload = {
  expected_revision: number;
  proposal_artifact_id: string;
};

export type CreateManualScriptPayload = {
  source: 'manual';
  expected_revision: number;
  proposal_artifact_id: string;
  document: ScriptDocument;
};

export type CreateScriptVersionPayload = {
  expected_version: number;
  document: ScriptDocument;
};

export type ReviewScriptPayload = {
  expected_version: number;
  decision: ScriptReviewDecision;
  feedback?: string;
};

export function getScriptOrigin(record: Pick<ScriptRecord, 'origin' | 'authored_by' | 'document'>): ScriptOrigin {
  if (record.origin === 'human' || record.origin === 'simulated') {
    return record.origin;
  }
  if (record.authored_by === 'human' || record.authored_by === 'simulated') {
    return record.authored_by;
  }
  return record.document.simulated ? 'simulated' : 'human';
}

export function sortScriptsDesc(items: ScriptRecord[]): ScriptRecord[] {
  return [...items].sort((a, b) => b.version - a.version);
}

export function formatScriptError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return `Sessão não autorizada (401): ${error.message}`;
    }
    if (error.status === 404) {
      return `Roteiro ou workflow não encontrado (404): ${error.message}`;
    }
    if (error.status === 409) {
      return `Conflito de revisão ou estado (409): ${error.message}`;
    }
    if (error.status === 422) {
      return `Contrato ou payload inválido (422): ${error.message}`;
    }
    return `Erro na operação (${error.status}): ${error.message}`;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `Falha de rede ao comunicar com o backend local: ${detail}`;
}

export async function getWorkflowScripts(
  connection: Connection,
  workflowId: string,
  signal?: AbortSignal
): Promise<ScriptRecord[]> {
  const response = await api<ScriptListResponse | ScriptRecord[]>(
    connection,
    `/v1/workflows/${encodeURIComponent(workflowId)}/scripts`,
    { signal }
  );
  const items = Array.isArray(response) ? response : response.items ?? [];
  return sortScriptsDesc(items);
}

export async function getScript(
  connection: Connection,
  scriptId: string,
  signal?: AbortSignal
): Promise<ScriptRecord> {
  return api<ScriptRecord>(connection, `/v1/scripts/${encodeURIComponent(scriptId)}`, { signal });
}

export async function createWorkflowScript(
  connection: Connection,
  workflowId: string,
  payload: CreateScriptPayload,
  idempotencyKey: string = crypto.randomUUID(),
  signal?: AbortSignal
): Promise<ScriptRecord> {
  return api<ScriptRecord>(connection, `/v1/workflows/${encodeURIComponent(workflowId)}/scripts`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      expected_revision: payload.expected_revision,
      proposal_artifact_id: payload.proposal_artifact_id,
    }),
    signal,
  });
}

export async function createManualWorkflowScript(
  connection: Connection,
  workflowId: string,
  payload: CreateManualScriptPayload,
  idempotencyKey: string = crypto.randomUUID(),
  signal?: AbortSignal
): Promise<ScriptRecord> {
  return api<ScriptRecord>(connection, `/v1/workflows/${encodeURIComponent(workflowId)}/scripts`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      source: 'manual',
      expected_revision: payload.expected_revision,
      proposal_artifact_id: payload.proposal_artifact_id,
      document: payload.document,
    }),
    signal,
  });
}

export async function createScriptVersion(
  connection: Connection,
  scriptId: string,
  payload: CreateScriptVersionPayload,
  idempotencyKey: string = crypto.randomUUID(),
  signal?: AbortSignal
): Promise<ScriptRecord> {
  return api<ScriptRecord>(connection, `/v1/scripts/${encodeURIComponent(scriptId)}/versions`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      expected_version: payload.expected_version,
      document: payload.document,
    }),
    signal,
  });
}

export async function reviewScript(
  connection: Connection,
  scriptId: string,
  payload: ReviewScriptPayload,
  idempotencyKey: string = crypto.randomUUID(),
  signal?: AbortSignal
): Promise<ScriptRecord> {
  return api<ScriptRecord>(connection, `/v1/scripts/${encodeURIComponent(scriptId)}/review`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      expected_version: payload.expected_version,
      decision: payload.decision,
      feedback: (payload.feedback ?? '').trim(),
    }),
    signal,
  });
}
