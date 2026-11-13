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
  simulated: true;
  title: string;
  sections: ScriptSection[];
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

export type ReviewScriptPayload = {
  expected_version: number;
  decision: ScriptReviewDecision;
  feedback?: string;
};

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
