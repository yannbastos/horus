import type { Connection } from './api';

// Cliente tipado do contrato de provedores de narração (HOR-132).
// Rotas: /v1/narration/{providers,estimate,preview,providers/elevenlabs/credential,preference}.
// `preference` (GET/PUT {provider, voice_id}) é o acréscimo ao contrato definido pelo Maestro.

export const PREVIEW_MAX_CHARS = 300;
export const DEFAULT_PREVIEW_TEXT = 'Esta é uma frase fictícia para ouvir a voz escolhida. Nenhum roteiro real é enviado.';
export const DEFAULT_VOICE_PATH = '/v1/narration/preference';

export type ProviderKind = 'local' | 'paid_api';
export type ProviderStatus = 'available' | 'not_installed' | 'not_configured' | 'disabled' | 'blocked';
export type CommercialUse = 'allowed' | 'restricted' | 'unknown';
export type PreviewMode = 'local' | 'requires_authorization' | 'unavailable';
export type NarrationVoice = {
  id: string; name: string; language: string; license: { name: string; url: string | null };
  commercial_use: CommercialUse; preview: PreviewMode; notes: string | null;
};
export type NarrationProvider = {
  id: string; name: string; kind: ProviderKind; status: ProviderStatus; reason: string;
  engine_license: { name: string; url: string | null; notes: string | null };
  voices: NarrationVoice[]; native_word_timestamps: boolean; requires_authorization: boolean;
};
export type EstimateRequest = { provider: string; voice_id: string; model_id?: string; text?: string; script_id?: string; script_version?: number };
export type NarrationEstimate = {
  characters: number;
  cost: { amount: string | number | null; currency: string | null; basis: string | null; source: 'configured_price' | 'unknown' };
  credits: { required: number | null; available: number | null; source: 'not_checked' | 'api' | 'mock' };
  requires_authorization: boolean;
};
export type DefaultVoice = { provider: string; voice_id: string };

export class NarrationError extends Error {
  status: number; code: string | null;
  constructor(message: string, status: number, code: string | null = null) { super(message); this.status = status; this.code = code; }
}

const PROVIDER_STATUSES = ['available', 'not_installed', 'not_configured', 'disabled', 'blocked'];
const COMMERCIAL = ['allowed', 'restricted', 'unknown'];
const PREVIEWS = ['local', 'requires_authorization', 'unavailable'];

function bad(what: string): never { throw new Error(`Resposta de narração inválida: ${what}.`); }
function obj(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) bad(what);
  return value as Record<string, unknown>;
}
function str(value: unknown, what: string): string { if (typeof value !== 'string') bad(what); return value; }
function optStr(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function oneOf<T extends string>(value: unknown, allowed: string[], what: string): T {
  if (typeof value !== 'string' || !allowed.includes(value)) bad(what);
  return value as T;
}
function numOrNull(value: unknown, what: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) bad(what);
  return value;
}

export function parseProviders(raw: unknown): NarrationProvider[] {
  if (!Array.isArray(raw)) bad('lista de provedores');
  return raw.map(item => {
    const p = obj(item, 'provedor');
    const license = obj(p.engine_license ?? {}, 'licença do motor');
    if (!Array.isArray(p.voices)) bad('vozes');
    return {
      id: str(p.id, 'id do provedor'), name: str(p.name, 'nome do provedor'),
      kind: oneOf<ProviderKind>(p.kind, ['local', 'paid_api'], 'tipo do provedor'),
      status: oneOf<ProviderStatus>(p.status, PROVIDER_STATUSES, 'status do provedor'),
      reason: typeof p.reason === 'string' ? p.reason : '',
      engine_license: { name: typeof license.name === 'string' ? license.name : 'não informada', url: optStr(license.url), notes: optStr(license.notes) },
      native_word_timestamps: p.native_word_timestamps === true,
      requires_authorization: p.requires_authorization === true,
      voices: p.voices.map(voice => {
        const v = obj(voice, 'voz'); const vl = obj(v.license ?? {}, 'licença da voz');
        return {
          id: str(v.id, 'id da voz'), name: str(v.name, 'nome da voz'), language: str(v.language, 'idioma da voz'),
          license: { name: typeof vl.name === 'string' ? vl.name : 'não informada', url: optStr(vl.url) },
          commercial_use: oneOf<CommercialUse>(v.commercial_use, COMMERCIAL, 'uso comercial'),
          preview: oneOf<PreviewMode>(v.preview, PREVIEWS, 'prévia'), notes: optStr(v.notes),
        };
      }),
    };
  });
}

export function parseEstimate(raw: unknown): NarrationEstimate {
  const e = obj(raw, 'estimativa'); const cost = obj(e.cost, 'custo'); const credits = obj(e.credits, 'créditos');
  const source = oneOf<'configured_price' | 'unknown'>(cost.source, ['configured_price', 'unknown'], 'fonte do custo');
  const amount = cost.amount;
  if (amount !== null && amount !== undefined && typeof amount !== 'string' && typeof amount !== 'number') bad('valor do custo');
  if (typeof e.characters !== 'number' || !Number.isFinite(e.characters)) bad('caracteres');
  return {
    characters: e.characters,
    // Nunca expor valor sem preço configurado: sem `configured_price`, o custo é descartado.
    cost: source === 'configured_price'
      ? { amount: amount ?? null, currency: optStr(cost.currency), basis: optStr(cost.basis), source }
      : { amount: null, currency: null, basis: optStr(cost.basis), source },
    credits: {
      required: numOrNull(credits.required, 'créditos necessários'), available: numOrNull(credits.available, 'créditos disponíveis'),
      source: oneOf<'not_checked' | 'api' | 'mock'>(credits.source, ['not_checked', 'api', 'mock'], 'fonte dos créditos'),
    },
    requires_authorization: e.requires_authorization === true,
  };
}

function parseConfigured(raw: unknown): boolean {
  const c = obj(raw, 'credencial');
  if (typeof c.configured !== 'boolean') bad('estado da credencial');
  return c.configured;
}

async function request(connection: Connection, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, 20000);
  try {
    const response = await fetch(connection.baseUrl + path, {
      ...init, signal: controller.signal,
      headers: { Authorization: `Bearer ${connection.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { code?: unknown } | null;
      const code = typeof body?.code === 'string' ? body.code : null;
      const message = `Não foi possível concluir a operação (${response.status}${code ? `, ${code}` : ''}).`;
      throw new NarrationError(message, response.status, code);
    }
    return response;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
async function json(connection: Connection, path: string, init?: RequestInit, signal?: AbortSignal): Promise<unknown> {
  return (await request(connection, path, init, signal)).json();
}

export async function getProviders(connection: Connection, signal?: AbortSignal) {
  return parseProviders(await json(connection, '/v1/narration/providers', undefined, signal));
}
export async function estimateNarration(connection: Connection, body: EstimateRequest, signal?: AbortSignal) {
  return parseEstimate(await json(connection, '/v1/narration/estimate', { method: 'POST', body: JSON.stringify(body) }, signal));
}
/**
 * Prévia local em duas etapas: POST /v1/narration/preview -> {id, url, expires_in_seconds};
 * GET autenticado em `url` -> audio/wav (uso único). Nunca chamar para provedores pagos (o backend responde 403).
 */
export async function previewNarration(connection: Connection, body: { provider: string; voice_id: string; text: string }, signal?: AbortSignal): Promise<Blob> {
  if (body.text.length > PREVIEW_MAX_CHARS) throw new Error(`O texto da prévia aceita até ${PREVIEW_MAX_CHARS} caracteres.`);
  const created = obj(await json(connection, '/v1/narration/preview', { method: 'POST', body: JSON.stringify(body) }, signal), 'prévia');
  const id = str(created.id, 'id da prévia');
  const url = str(created.url, 'endereço da prévia');
  if (url !== `/v1/narration/previews/${id}`) bad('endereço da prévia');
  return (await request(connection, url, {}, signal)).blob();
}
export async function setElevenLabsCredential(connection: Connection, key: string): Promise<boolean> {
  return parseConfigured(await json(connection, '/v1/narration/providers/elevenlabs/credential', { method: 'PUT', body: JSON.stringify({ key }) }));
}
export async function removeElevenLabsCredential(connection: Connection): Promise<boolean> {
  return parseConfigured(await json(connection, '/v1/narration/providers/elevenlabs/credential', { method: 'DELETE' }));
}function parseDefault(raw: unknown): DefaultVoice | null {
  if (raw === null) return null;
  const d = obj(raw, 'voz padrão');
  if (d.provider === null || d.provider === undefined) return null;
  return { provider: str(d.provider, 'provedor padrão'), voice_id: str(d.voice_id, 'voz padrão') };
}
export async function getDefaultVoice(connection: Connection, signal?: AbortSignal) {
  try { return parseDefault(await json(connection, DEFAULT_VOICE_PATH, undefined, signal)); }
  catch (reason) { if (reason instanceof NarrationError && reason.status === 404) return null; throw reason; }
}
export async function setDefaultVoice(connection: Connection, body: DefaultVoice) {
  return parseDefault(await json(connection, DEFAULT_VOICE_PATH, { method: 'PUT', body: JSON.stringify(body) }));
}
