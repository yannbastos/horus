import { api, ApiError, getWorkflows } from './api';
import type { Connection, WorkflowSummary } from './api';
import { getWorkflowScripts } from './scripts';
import type { ScriptRecord } from './scripts';
import { getScriptProductions } from './production';
import type { ProductionRecord } from './production';

// Central de Produção (HOR-087): agrega somente endpoints existentes e autenticados:
// GET /v1/workflows, GET /v1/workflows/{id}/scripts, GET /v1/scripts/{id}/productions
// e GET /v1/productions/{id}/license-reviews. Campo ausente aparece como "não informado".

export type CenterStage = 'proposal' | 'script' | 'production' | 'review';

export type BlockerKind =
  | 'action' // exige ação humana
  | 'running' // em andamento no sistema, sem ação humana
  | 'ended' // fluxo encerrado, sem próxima etapa
  | 'unknown'; // dado não informado ou consulta incompleta

export type Blocker = { kind: BlockerKind; text: string };

export type LicenseState = 'verified' | 'unverified' | 'unknown' | 'not_applicable';

export type CenterRow = {
  workflowId: string;
  title: string;
  stage: CenterStage;
  stageLabel: string;
  status: string;
  blockers: Blocker[];
  action: string | null;
  updatedAt: string | null;
  scriptVersion: number | null;
  productionId: string | null;
  productionMode: string | null;
  license: LicenseState;
  incomplete: string | null;
};

export const STAGE_LABELS: Record<CenterStage, string> = {
  proposal: 'Proposta',
  script: 'Roteiro',
  production: 'Produção',
  review: 'Revisão humana',
};

const NOT_INFORMED = 'não informado';

const WORKFLOW_STATUS: Record<string, string> = {
  queued: 'Na fila', running: 'Em execução', awaiting_authorization: 'Aguardando autorização',
  awaiting_approval: 'Aguardando aprovação', approved: 'Aprovada', rejected: 'Rejeitada',
  cancel_requested: 'Cancelamento solicitado', cancelled: 'Cancelada', failed: 'Falhou', interrupted: 'Interrompida',
};
const SCRIPT_STATUS: Record<string, string> = {
  awaiting_review: 'Aguardando revisão', approved: 'Aprovado', rejected: 'Rejeitado', changes_requested: 'Ajustes solicitados',
};
const PRODUCTION_STATUS: Record<string, string> = {
  queued: 'Na fila', running: 'Em execução', cancel_requested: 'Cancelamento solicitado', succeeded: 'Concluída',
  failed: 'Falhou', cancelled: 'Cancelada', interrupted: 'Interrompida', blocked: 'Bloqueada',
};
const PRODUCTION_STAGE: Record<string, string> = {
  prepare: 'preparação', narration: 'narração', scenes: 'cenas', subtitles: 'legendas', render: 'render', quality: 'qualidade', review: 'revisão',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function describeLoadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return `Sessão não autorizada (401): ${error.message}`;
    return `Erro ao consultar o backend local (${error.status}): ${error.message}`;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `Falha de rede ao comunicar com o backend local: ${detail}`;
}

// --- Qualidade e licenças: só campos reais do registro de produção ---

type QualityFacts = { failed: boolean; notRun: boolean; missing: boolean; blockingErrors: number };

export function readQuality(record: ProductionRecord): QualityFacts {
  const quality = record.quality_report;
  if (!isRecord(quality)) return { failed: false, notRun: false, missing: true, blockingErrors: 0 };
  const blocking = Array.isArray(quality.blocking_errors) ? quality.blocking_errors.length : 0;
  const status = typeof quality.status === 'string' ? quality.status : null;
  return {
    failed: status === 'fail' || blocking > 0,
    notRun: status === 'not_run',
    missing: false,
    blockingErrors: blocking,
  };
}

export function readLicense(provenance: unknown): LicenseState {
  if (!isRecord(provenance) || !Array.isArray(provenance.assets)) return 'unknown';
  if (provenance.assets.length === 0) return 'unknown';
  const states = provenance.assets.map(asset => (isRecord(asset) && typeof asset.status === 'string' ? asset.status : null));
  if (states.some(state => state === null)) return 'unknown';
  return states.every(state => state === 'verified') ? 'verified' : 'unverified';
}

function pickLatest<T extends { created_at: string }>(items: T[]): T | null {
  let best: T | null = null;
  for (const item of items) {
    const time = parseTime(item.created_at);
    if (best === null) { best = item; continue; }
    const bestTime = parseTime(best.created_at);
    if (time !== null && (bestTime === null || time > bestTime)) best = item;
  }
  return best;
}

export type RowInputs = {
  workflow: WorkflowSummary;
  scripts: ScriptRecord[] | null; // null = consulta falhou
  productions: ProductionRecord[] | null; // null = consulta falhou ou inexistente
  license: LicenseState | null; // do endpoint de revisões; null = não consultado
  loadProblem: string | null;
};

function maxTime(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestTime = -Infinity;
  for (const value of values) {
    const time = parseTime(value);
    if (time !== null && time > bestTime) { best = value ?? null; bestTime = time; }
  }
  return best;
}

export function buildRow(input: RowInputs): CenterRow {
  const { workflow, scripts, productions } = input;
  const wfLabel = WORKFLOW_STATUS[workflow.status] ?? `${NOT_INFORMED} (${String(workflow.status)})`;
  const base: CenterRow = {
    workflowId: workflow.id, title: `Vídeo ${workflow.id.slice(0, 8)}`, stage: 'proposal', stageLabel: STAGE_LABELS.proposal,
    status: wfLabel, blockers: [], action: null, updatedAt: workflow.updated_at ?? null, scriptVersion: null,
    productionId: null, productionMode: null, license: 'unknown', incomplete: input.loadProblem,
  };
  const wfStatus = workflow.status as string;

  // 1. Proposta
  if (wfStatus !== 'approved') {
    base.stageLabel = `${STAGE_LABELS.proposal} (aprovação)`;
    if (wfStatus === 'awaiting_authorization') base.blockers.push({ kind: 'action', text: 'Aguardando sua autorização para executar a etapa.' });
    else if (wfStatus === 'awaiting_approval') base.blockers.push({ kind: 'action', text: 'Aguardando aprovação da proposta.' });
    else if (wfStatus === 'failed' || wfStatus === 'interrupted') base.blockers.push({ kind: 'action', text: `Workflow ${wfLabel.toLowerCase()}: repetir ou conciliar na tela de Produção.` });
    else if (wfStatus === 'queued' || wfStatus === 'running' || wfStatus === 'cancel_requested') base.blockers.push({ kind: 'running', text: 'Em andamento no sistema; sem ação humana pendente.' });
    else if (wfStatus === 'rejected' || wfStatus === 'cancelled') base.blockers.push({ kind: 'ended', text: `Proposta ${wfLabel.toLowerCase()}: fluxo encerrado.` });
    else base.blockers.push({ kind: 'unknown', text: `Estado da proposta ${NOT_INFORMED}.` });
    base.action = base.blockers[0].kind === 'action' ? 'Abrir Produção' : null;
    return base;
  }

  // 2. Roteiro
  if (scripts === null) {
    base.blockers.push({ kind: 'unknown', text: `Roteiros ${NOT_INFORMED}: falha ao consultar.` });
    return base;
  }
  const latestScript = scripts.length ? scripts.reduce((a, b) => (b.version > a.version ? b : a)) : null;
  if (!latestScript) {
    base.stageLabel = `${STAGE_LABELS.script} (a gerar)`;
    base.status = 'Proposta aprovada, sem roteiro';
    base.blockers.push({ kind: 'action', text: 'Proposta aprovada: gerar o roteiro.' });
    base.action = 'Abrir Produção';
    return base;
  }
  base.title = latestScript.document?.title || base.title;
  base.scriptVersion = latestScript.version;
  base.updatedAt = maxTime([workflow.updated_at, latestScript.created_at, latestScript.review?.reviewed_at]);
  const scriptLabel = SCRIPT_STATUS[latestScript.status] ?? `${NOT_INFORMED} (${String(latestScript.status)})`;

  // 3. Produção
  const latestProduction = productions && productions.length ? pickLatest(productions) : null;
  if (!latestProduction) {
    base.stage = 'script';
    base.stageLabel = `${STAGE_LABELS.script} v${latestScript.version}`;
    base.status = scriptLabel;
    if (productions === null) base.blockers.push({ kind: 'unknown', text: `Produções ${NOT_INFORMED}: falha ao consultar.` });
    else if (latestScript.status === 'awaiting_review') { base.blockers.push({ kind: 'action', text: 'Aguardando aprovação do roteiro.' }); base.action = 'Revisar roteiro'; }
    else if (latestScript.status === 'changes_requested') { base.blockers.push({ kind: 'action', text: 'Ajustes solicitados: gerar nova versão do roteiro.' }); base.action = 'Abrir Produção'; }
    else if (latestScript.status === 'rejected') base.blockers.push({ kind: 'ended', text: 'Roteiro rejeitado: fluxo encerrado nesta versão.' });
    else if (latestScript.status === 'approved') { base.blockers.push({ kind: 'action', text: 'Roteiro aprovado: iniciar a produção.' }); base.action = 'Iniciar produção'; }
    else base.blockers.push({ kind: 'unknown', text: `Estado do roteiro ${NOT_INFORMED}.` });
    return base;
  }

  const production = latestProduction;
  const statusLabel = PRODUCTION_STATUS[production.status] ?? `${NOT_INFORMED} (${String(production.status)})`;
  const stageName = PRODUCTION_STAGE[production.stage as string] ?? NOT_INFORMED;
  base.productionId = production.id;
  base.productionMode = production.mode ?? null;
  base.updatedAt = maxTime([base.updatedAt, production.updated_at]);
  base.status = `${statusLabel} · ${stageName}`;
  const state = production.status as string;

  if (state === 'queued' || state === 'running' || state === 'cancel_requested') {
    base.stage = 'production';
    base.stageLabel = `${STAGE_LABELS.production} (${stageName})`;
    base.blockers.push({ kind: 'running', text: 'Produção em andamento; sem ação humana pendente.' });
    return base;
  }
  if (state === 'failed' || state === 'interrupted' || state === 'blocked' || state === 'cancelled') {
    base.stage = 'production';
    base.stageLabel = STAGE_LABELS.production;
    const what = state === 'cancelled' ? 'cancelada' : state === 'failed' ? 'falhou' : state === 'interrupted' ? 'interrompida' : 'bloqueada';
    base.blockers.push({
      kind: 'action',
      text: `Produção ${what}${production.error ? ` (${production.error})` : ''}: a conciliação é exigida antes de iniciar uma nova produção.`,
    });
    base.action = 'Conciliar na Produção';
    return base;
  }
  if (state !== 'succeeded') {
    base.stage = 'production';
    base.stageLabel = STAGE_LABELS.production;
    base.blockers.push({ kind: 'unknown', text: `Estado da produção ${NOT_INFORMED}.` });
    return base;
  }

  // Produção concluída: revisão humana
  base.stage = 'review';
  base.stageLabel = STAGE_LABELS.review;
  const license = input.license ?? readLicense(production.asset_provenance);
  base.license = production.mode === 'local_pilot' ? license : 'not_applicable';
  if (production.review) {
    base.status = production.review.decision === 'approve' ? 'Aprovada na revisão (demonstração; não publicável)' : 'Rejeitada na revisão';
    base.blockers.push({ kind: 'ended', text: production.review.decision === 'approve' ? 'Revisão concluída; não existe publicação.' : 'Produção rejeitada: iniciar nova produção se desejado.' });
    return base;
  }
  const quality = readQuality(production);
  const ackRequired = production.quality_acknowledgement_required === true || production.requires_quality_acknowledgement === true;
  if (quality.failed) {
    base.blockers.push({ kind: 'action', text: `QC reprovado${quality.blockingErrors ? ` (${quality.blockingErrors} erro(s) bloqueante(s))` : ''}: a aprovação exige reconhecimento dos erros.` });
  } else if (ackRequired) {
    base.blockers.push({ kind: 'action', text: quality.missing ? 'Relatório de QC ausente ou inválido: a aprovação exige reconhecimento.' : quality.notRun ? 'QC não executado: a aprovação exige reconhecimento.' : 'Reconhecimento de QC exigido para aprovar.' });
  }
  if (base.license === 'unverified') base.blockers.push({ kind: 'action', text: 'Licenças de assets não verificadas.' });
  else if (base.license === 'unknown') base.blockers.push({ kind: 'unknown', text: `Licenças de assets ${NOT_INFORMED}.` });
  base.blockers.push({ kind: 'action', text: 'Aguardando revisão humana (aprovar/rejeitar por hash).' });
  base.action = 'Revisar produção';
  return base;
}

// --- Carga ---

async function limited<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

async function licenseFor(connection: Connection, production: ProductionRecord, signal?: AbortSignal): Promise<LicenseState | null> {
  if (production.mode !== 'local_pilot' || production.status !== 'succeeded') return null;
  try {
    const response = await api<{ effective_provenance?: unknown }>(
      connection, `/v1/productions/${encodeURIComponent(production.id)}/license-reviews`, { signal });
    if (isRecord(response) && isRecord(response.effective_provenance)) return readLicense(response.effective_provenance);
  } catch {
    // Cai para a proveniência do próprio registro de produção.
  }
  return null;
}

export async function loadProductionCenter(connection: Connection, signal?: AbortSignal): Promise<CenterRow[]> {
  const workflows = await getWorkflows(connection);
  const rows = await limited(workflows, 6, async (workflow): Promise<CenterRow> => {
    let scripts: ScriptRecord[] | null = null;
    let productions: ProductionRecord[] | null = null;
    let license: LicenseState | null = null;
    let problem: string | null = null;
    try {
      scripts = workflow.status === 'approved' ? await getWorkflowScripts(connection, workflow.id, signal) : [];
    } catch (error) {
      problem = describeLoadError(error);
    }
    const latest = scripts && scripts.length ? scripts.reduce((a, b) => (b.version > a.version ? b : a)) : null;
    if (latest) {
      try {
        productions = await getScriptProductions(connection, latest.id, signal);
      } catch (error) {
        problem = describeLoadError(error);
      }
      const newest = productions && productions.length ? pickLatest(productions) : null;
      if (newest) license = await licenseFor(connection, newest, signal);
    }
    return buildRow({ workflow, scripts, productions, license, loadProblem: problem });
  });
  return rows;
}

export type StageFilter = 'all' | CenterStage;

export function filterAndSort(rows: CenterRow[], stage: StageFilter, onlyBlocked: boolean): CenterRow[] {
  return rows
    .filter(row => (stage === 'all' || row.stage === stage) && (!onlyBlocked || row.blockers.some(blocker => blocker.kind === 'action')))
    .sort((a, b) => (parseTime(b.updatedAt) ?? -Infinity) - (parseTime(a.updatedAt) ?? -Infinity));
}
