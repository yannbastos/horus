import { api } from './api';
import type { Connection } from './api';

export type LicenseDecision = 'verified' | 'rejected';
export type ReviewCommercialUse = 'allowed' | 'restricted' | 'unknown';

export type ReviewLicense = {
  id: string;
  name: string;
  url: string;
  commercial_use: ReviewCommercialUse;
  attribution_required: boolean;
};

export type LicenseReview = {
  id: string;
  production_id: string;
  asset_id: string;
  asset_sha256: string;
  decision: LicenseDecision;
  license: ReviewLicense;
  evidence: string;
  reviewed_by: 'human';
  reviewed_at: string;
  supersedes: string | null;
};

export type LicenseReviewsResponse = {
  production_id: string;
  current: LicenseReview[];
  history: LicenseReview[];
  effective_provenance: Record<string, unknown> | null;
  publishable: false;
};

export type LicenseReviewRequest = {
  asset_id: string;
  asset_sha256: string;
  decision: LicenseDecision;
  license: ReviewLicense;
  evidence: string;
  reviewed_by: 'human';
};

const SHA256 = /^[0-9a-f]{64}$/;
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;
export const EVIDENCE_MAX = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseReview(raw: unknown): LicenseReview {
  if (!isRecord(raw) || !isRecord(raw.license)) throw new Error('Revisão de licença com forma inválida.');
  const lic = raw.license;
  const ok =
    typeof raw.id === 'string' &&
    typeof raw.production_id === 'string' &&
    typeof raw.asset_id === 'string' &&
    typeof raw.asset_sha256 === 'string' &&
    SHA256.test(raw.asset_sha256) &&
    (raw.decision === 'verified' || raw.decision === 'rejected') &&
    typeof raw.evidence === 'string' &&
    raw.reviewed_by === 'human' &&
    typeof raw.reviewed_at === 'string' &&
    (raw.supersedes === null || typeof raw.supersedes === 'string') &&
    typeof lic.id === 'string' &&
    typeof lic.name === 'string' &&
    typeof lic.url === 'string' &&
    (lic.commercial_use === 'allowed' || lic.commercial_use === 'restricted' || lic.commercial_use === 'unknown') &&
    typeof lic.attribution_required === 'boolean';
  if (!ok) throw new Error('Revisão de licença com forma inválida.');
  return raw as unknown as LicenseReview;
}

export function parseLicenseReviewsResponse(raw: unknown): LicenseReviewsResponse {
  if (
    !isRecord(raw) ||
    typeof raw.production_id !== 'string' ||
    !Array.isArray(raw.current) ||
    !Array.isArray(raw.history) ||
    raw.publishable !== false ||
    !(raw.effective_provenance === null || isRecord(raw.effective_provenance))
  ) {
    throw new Error('Resposta de revisões de licença com forma inválida.');
  }
  return {
    production_id: raw.production_id,
    current: raw.current.map(parseReview),
    history: raw.history.map(parseReview),
    effective_provenance: raw.effective_provenance as Record<string, unknown> | null,
    publishable: false,
  };
}

export function parseLicenseReview(raw: unknown): LicenseReview {
  return parseReview(raw);
}

const base = (productionId: string) => `/v1/productions/${encodeURIComponent(productionId)}/license-reviews`;

export async function getLicenseReviews(
  connection: Connection,
  productionId: string,
  signal?: AbortSignal
): Promise<LicenseReviewsResponse> {
  return parseLicenseReviewsResponse(await api<unknown>(connection, base(productionId), { signal }));
}

/** A mesma `idempotencyKey` com o mesmo corpo é um reenvio seguro: a API devolve a mesma revisão. */
export async function postLicenseReview(
  connection: Connection,
  productionId: string,
  request: LicenseReviewRequest,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<LicenseReview> {
  const raw = await api<unknown>(connection, base(productionId), {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(request),
    signal,
  });
  return parseReview(raw);
}

export function isHttpsUrlWithoutCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Validação de forma no cliente; a API continua sendo a autoridade (host de stock, hash, etc.). */
export function validateLicenseReviewRequest(request: LicenseReviewRequest): string[] {
  const problems: string[] = [];
  const lic = request.license;
  if (!SHA256.test(request.asset_sha256)) problems.push('Hash do asset inválido.');
  if (!lic.id.trim() || lic.id.length > 100) problems.push('Informe o identificador da licença (até 100 caracteres).');
  if (!lic.name.trim() || lic.name.length > 200) problems.push('Informe o nome da licença (até 200 caracteres).');
  if (!isHttpsUrlWithoutCredentials(lic.url) || lic.url.length > 2000) {
    problems.push('A URL da licença deve ser https, sem credenciais.');
  }
  if (request.decision === 'verified' && lic.commercial_use === 'unknown') {
    problems.push('Uso comercial desconhecido nunca pode ser verificado: escolha permitido ou restrito, ou rejeite.');
  }
  const evidence = request.evidence;
  if (!evidence.trim()) problems.push('A evidência é obrigatória.');
  else if (evidence.length > EVIDENCE_MAX) problems.push(`A evidência excede ${EVIDENCE_MAX} caracteres.`);
  else if (CONTROL.test(evidence)) problems.push('A evidência contém caracteres de controle.');
  return problems;
}

export function describeLicenseReviewError(error: unknown, status?: number): string {
  if (status === 409) {
    const message = error instanceof Error ? error.message.slice(0, 300) : '';
    return `Conflito (409): ${message || 'asset, hash, proveniência ou chave de idempotência não conferem.'}`;
  }
  if (status === 422) return 'Dados rejeitados pela API (422). Revise licença, URL, uso comercial e evidência.';
  if (status === 401) return 'Sessão não autorizada (401).';
  if (status === 404) return 'Produção não encontrada (404).';
  if (status !== undefined) return `Erro na operação (${status}).`;
  return 'Falha ao comunicar com o backend local. A decisão pode ser reenviada com segurança.';
}
