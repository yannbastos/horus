import { api, ApiError } from './api';
import type { Connection, JobStatus } from './api';
import type { ScriptSection } from './scripts';
import {
  MAX_INTERPOLATED_RUN_SECONDS,
  MIN_ALIGNMENT_MATCH_RATE,
  isRecord,
  parseWordTimingsWords,
  readFiniteNumber,
  readSha256,
  readString,
} from './mediaContracts';
import type {
  RecomputedAlignment,
  WordAlignmentSummary,
  WordTimingItem,
  WordTimingSource,
  WordTimingsReport,
} from './mediaContracts';

export type {
  RecomputedAlignment,
  WordAlignmentSummary,
  WordTimingEngine,
  WordTimingItem,
  WordTimingKind,
  WordTimingSource,
  WordTimingsReport,
} from './mediaContracts';

export type ProductionMode = 'simulated' | 'local_demo' | 'local_pilot';

export type ProductionStage =
  | 'prepare'
  | 'narration'
  | 'scenes'
  | 'align'
  | 'subtitles'
  | 'render'
  | 'quality'
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

// Contrato 4 — Revisão por timecode e reconhecimento de erros de QC
export type ProductionReviewNote = {
  at_seconds: number;
  text: string;
};

export type ProductionReview = {
  decision: ProductionReviewDecision;
  artifact_sha256: string;
  reviewed_at: string;
  notes?: ProductionReviewNote[];
  acknowledge_quality_errors?: boolean;
  acknowledged_quality_errors?: boolean;
};

// Contrato 1 — word-timings.json (contracts/media/word-timings.schema.json)
// Contrato 2 — quality-report.json (contracts/media/quality-report.schema.json)
export type QualityCheckCategory =
  | 'integrity'
  | 'duration'
  | 'audio'
  | 'sync'
  | 'subtitles'
  | 'provenance'
  | 'visual';

export type QualityCheckStatus = 'pass' | 'warn' | 'fail' | 'skipped' | 'not_checked';

export type QualityCheckMethod = 'measured' | 'declared' | 'estimated';

export type QualityCheckTimecode = {
  start: number;
  end: number;
};

export type QualityScalarValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>;

export type PilotQualityCheckItem = {
  id: string;
  category?: QualityCheckCategory | string;
  status: QualityCheckStatus | string;
  method?: QualityCheckMethod | string;
  measured?: Record<string, QualityScalarValue | unknown> | null;
  threshold?: Record<string, QualityScalarValue | unknown> | null;
  detail?: string;
  timecode?: QualityCheckTimecode | null;
};

export type QualityReportTool = {
  name: string;
  version: string;
};

export type QualityReportOverallStatus = 'pass' | 'warn' | 'fail' | 'not_run';

export type ProductionQualityReport = {
  schema_version?: 1 | number;
  production_id?: string;
  video_sha256?: string;
  generated_at?: string;
  tool?: QualityReportTool | null;
  status?: QualityReportOverallStatus | string | null;
  passed?: boolean | null;
  valid?: boolean | null;
  summary?: string | null;
  checks?: PilotQualityCheckItem[] | Record<string, unknown> | null;
  blocking_errors?: string[] | null;
  warnings?: string[] | null;
  issues?: string[] | null;
  publishable?: boolean | null;
};

// Contrato 3 — asset-provenance.json (contracts/media/asset-provenance.schema.json)
export type AssetProvenanceKind = 'image' | 'video' | 'audio' | 'voice' | 'music' | 'font';

export type AssetProvenanceOrigin =
  | 'original_local'
  | 'system_voice'
  | 'local_tts_model'
  | 'stock_pexels'
  | 'stock_pixabay'
  | 'licensed_manual';

export type CommercialUseStatus = 'allowed' | 'restricted' | 'unknown';

export type AssetLicenseInfo = {
  id?: string | null;
  name?: string | null;
  url?: string | null;
  commercial_use: CommercialUseStatus | string;
  attribution_required: boolean | null;
  verified_by: 'human' | null | string;
  verified_at: string | null;
};

export type AssetVerificationStatus = 'verified' | 'unverified' | 'rejected';

export type AssetProvenanceItem = {
  asset_id: string;
  relative_path: string;
  sha256: string;
  kind: AssetProvenanceKind | string;
  origin: AssetProvenanceOrigin | string;
  source_url?: string | null;
  author?: string | null;
  license: AssetLicenseInfo;
  status: AssetVerificationStatus | string;
  notes?: string | null;
};

export type AssetProvenanceReport = {
  schema_version: 1 | number;
  assets: AssetProvenanceItem[];
};

// Contrato 5 — Registro da produção
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
  // Campos confirmados do contrato local_pilot (derivados do resultado validado, nunca do modo solicitado)
  narration_kind?: 'fixture_tone' | 'local_tts' | string | null;
  narration_disclosure?: string | null;
  alignment_method?: 'measured_sections' | string | null;
  publishable?: boolean | null;
  // Campos expostos em GET /v1/productions/{id} (Contrato 5) e flag de reconhecimento de QC
  quality_report?: ProductionQualityReport | Record<string, unknown> | null;
  asset_provenance?: AssetProvenanceReport | Record<string, unknown> | null;
  word_timings?: WordTimingsReport | Record<string, unknown> | null;
  quality_acknowledgement_required?: boolean | null;
  requires_quality_acknowledgement?: boolean | null;
  // Campos opcionais defensivos adicionais (Sonnet schema v1)
  audio_kind?: string | null;
  voice_kind?: string | null;
  tts_engine?: string | null;
  synthetic_tts?: boolean | null;
  local_tts?: boolean | null;
  subtitles_kind?: string | null;
  scenes_kind?: string | null;
  visual_origin?: string | null;
  quality_status?: string | null;
  pilot_evidence?: Record<string, unknown> | null;
  provenance?: Record<string, unknown> | null;
};

export type ProductionListResponse = {
  items: ProductionRecord[];
};

export type RenderQuality = 'draft' | 'final';

export type ProductionNarrationSelection = { provider: string; voice_id: string };

export type CreateProductionPayload = {
  expected_version: number;
  mode: ProductionMode;
  /** Somente local_pilot: voz escolhida (GET /v1/narration/providers). */
  narration?: ProductionNarrationSelection;
  /** Somente local_pilot aceita 'final'; omitido, o backend usa 'draft'. */
  render_quality?: RenderQuality;
};

export type ReviewProductionPayload = {
  decision: ProductionReviewDecision;
  artifact_sha256: string;
  notes?: ProductionReviewNote[];
  acknowledge_quality_errors?: boolean;
};

export type NarrationProvenanceKind =
  | 'fixture_tone'
  | 'synthetic_local_tts'
  | 'unverified';

export type SubtitleProvenanceKind =
  | 'synthetic_srt'
  | 'segmented_srt'
  | 'unverified';

export type SceneProvenanceKind = 'demo_local' | 'unverified';

export type QualityReportStatus =
  | 'passed'
  | 'partial_not_checked'
  | 'failed'
  | 'unverified';

export type NarrationAudioStatus =
  | 'confirmed_by_sha256'
  | 'fixture_single_tone'
  | 'loading_evidence'
  | 'hash_mismatch_or_missing'
  | 'evidence_missing_or_unverified'
  | 'no_audio';

export type NormalizedProductionProvenance = {
  demoOnly: boolean | undefined;
  realVoice: boolean | undefined;
  speechAligned: boolean | undefined;
  publishable: false;
  narrationKind: NarrationProvenanceKind;
  narrationEngine: string | null;
  narrationVoice: string | null;
  narrationDisclosure: string | null;
  narrationLabel: string;
  narrationSha256: string | null;
  narrationDurationSeconds: number | null;
  narrationAudioArtifact: ProductionArtifact | null;
  fixtureAudioArtifact: ProductionArtifact | null;
  narrationAudioStatus: NarrationAudioStatus;
  alignmentMethod: string | null;
  subtitleKind: SubtitleProvenanceKind;
  subtitleDisclosure: string | null;
  subtitleLabel: string;
  alignmentLabel: string;
  sceneKind: SceneProvenanceKind;
  sceneCount: number;
  sceneLabel: string;
  licenseSummary: string;
  qualityStatus: QualityReportStatus;
  qualitySummary: string | null;
  qualityLabel: string;
  qualityChecksSummary: {
    passCount: number;
    failCount: number;
    notCheckedCount: number;
    notCheckedIds: string[];
    blockingErrors: string[];
    warnings: string[];
  } | null;
  hasPilotEvidenceManifest: boolean;
  pilotEvidenceArtifact: ProductionArtifact | null;
  pilotEvidenceLoaded: boolean;
};

export type SrtSegment = {
  index: number;
  start: string;
  end: string;
  startSeconds: number | null;
  endSeconds: number | null;
  text: string;
};

export type NormalizedQualityCheck = {
  id: string;
  category: string;
  categoryLabel: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped' | 'not_checked';
  statusLabel: string;
  method: 'measured' | 'declared' | 'estimated' | 'unverified';
  methodLabel: string;
  measuredSource: string | null;
  measuredText: string;
  thresholdText: string;
  detail: string;
  timecode: QualityCheckTimecode | null;
  isBlocking: boolean;
  isWarning: boolean;
};

export type NormalizedQualityHighlight = {
  id: string;
  kind: 'blocking_error' | 'warning';
  detail: string;
  categoryLabel: string | null;
  methodLabel: string | null;
  timecode: QualityCheckTimecode | null;
};

export type NormalizedQualityReport = {
  executed: boolean;
  overallStatus: QualityReportOverallStatus;
  overallStatusLabel: string;
  overallTone: 'good' | 'warn' | 'bad' | '';
  productionId: string | null;
  videoSha256: string | null;
  generatedAt: string | null;
  toolName: string | null;
  toolVersion: string | null;
  checks: NormalizedQualityCheck[];
  blockingErrors: NormalizedQualityHighlight[];
  warnings: NormalizedQualityHighlight[];
  passCount: number;
  warnCount: number;
  failCount: number;
  skippedCount: number;
};

export type NormalizedAssetProvenanceItem = {
  assetId: string;
  relativePath: string;
  sha256: string;
  kind: string;
  kindLabel: string;
  origin: string;
  originLabel: string;
  isStock: boolean;
  isExternalOrigin: boolean;
  sourceUrl: string | null;
  author: string | null;
  licenseId: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  commercialUse: 'allowed' | 'restricted' | 'unknown';
  commercialUseLabel: string;
  commercialUsePermitted: boolean;
  attributionRequired: boolean | null;
  attributionLabel: string;
  verifiedBy: 'human' | null;
  verifiedAt: string | null;
  verificationLabel: string;
  status: 'verified' | 'unverified' | 'rejected';
  statusLabel: string;
  notes: string | null;
  warnings: string[];
};

export type NormalizedAssetProvenance = {
  hasContractReport: boolean;
  hasLegacyFallback: boolean;
  assets: NormalizedAssetProvenanceItem[];
  hasUnverifiedOrUnknown: boolean;
  hasStockPexels: boolean;
  hasStockPixabay: boolean;
  unverifiedCount: number;
  rejectedCount: number;
  unknownCommercialCount: number;
  restrictedCommercialCount: number;
  unverifiedByHumanCount: number;
  summaryWarnings: string[];
};

export type NormalizedWordTimings = {
  available: boolean;
  narrationSha256: string | null;
  durationSeconds: number | null;
  source: WordTimingSource | string | null;
  sourceLabel: string;
  isEstimated: boolean;
  engineName: string | null;
  engineVoice: string | null;
  words: WordTimingItem[];
  /** Recomputado a partir das palavras (forced_alignment válido); nunca copiado do bloco declarado. */
  alignment: RecomputedAlignment | null;
  declaredAlignment: WordAlignmentSummary | null;
  speechAligned: boolean;
  validationReason: string;
};

export type TimecodeSceneNavItem = {
  id: string;
  label: string;
  start: number;
  end: number;
  assetId?: string | null;
};

export type TimecodeSubtitleNavItem = {
  index: number;
  start: number;
  end: number;
  text: string;
};

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function formatTimecode(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '00:00.000';
  }
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = clamped - mins * 60;
  const minsStr = String(mins).padStart(2, '0');
  const secsWhole = Math.floor(secs);
  const ms = Math.round((secs - secsWhole) * 1000);
  const adjustedSecs = ms === 1000 ? secsWhole + 1 : secsWhole;
  const adjustedMs = ms === 1000 ? 0 : ms;
  return `${minsStr}:${String(adjustedSecs).padStart(2, '0')}.${String(adjustedMs).padStart(3, '0')}`;
}

export function parseSrtTimestampToSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  const match = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(trimmed);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3], 10);
  const msStr = match[4].padEnd(3, '0');
  const ms = Number.parseInt(msStr, 10);
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

export function adaptProductionRecord(raw: ProductionRecord): ProductionRecord {
  const artifacts = Array.isArray(raw.artifacts) ? raw.artifacts : [];
  const review = raw.review
    ? {
        ...raw.review,
        notes: Array.isArray(raw.review.notes)
          ? raw.review.notes
              .filter(
                (n): n is ProductionReviewNote =>
                  isRecord(n) &&
                  typeof n.at_seconds === 'number' &&
                  Number.isFinite(n.at_seconds) &&
                  n.at_seconds >= 0 &&
                  typeof n.text === 'string' &&
                  n.text.trim().length > 0
              )
              .map(n => ({
                at_seconds: Math.round(n.at_seconds * 1000) / 1000,
                text: n.text.trim(),
              }))
          : undefined,
      }
    : null;
  return {
    ...raw,
    artifacts,
    review,
    publishable: false,
  };
}

export function parsePilotEvidencePayload(rawText: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawText);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  integrity: 'Integridade (integrity)',
  duration: 'Duração (duration)',
  audio: 'Áudio (audio)',
  sync: 'Sincronização (sync)',
  subtitles: 'Legendas (subtitles)',
  provenance: 'Proveniência (provenance)',
  visual: 'Visual (visual)',
};

const CHECK_STATUS_LABELS: Record<string, string> = {
  pass: 'Aprovado (pass)',
  warn: 'Aviso (warn)',
  fail: 'Falha (fail)',
  skipped: 'Ignorado (skipped)',
  not_checked: 'Não medido (not_checked)',
};

const METHOD_LABELS: Record<string, string> = {
  measured: 'Medido (measured)',
  declared: 'Declarado (declared)',
  estimated: 'Estimado (estimated — não é medição real)',
  unverified: 'Não informado',
};

function formatMetricObject(
  obj: Record<string, unknown> | null | undefined,
  method?: string
): string {
  if (!isRecord(obj)) return '—';
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '—';
  const formatted = entries
    .map(([key, val]) => {
      if (typeof val === 'number') {
        const numStr = Number.isInteger(val) ? String(val) : String(Math.round(val * 10000) / 10000);
        return `${key}: ${numStr}`;
      }
      if (typeof val === 'boolean' || typeof val === 'string') {
        return `${key}: ${String(val)}`;
      }
      return `${key}: ${JSON.stringify(val)}`;
    })
    .join(' · ');
  if (method === 'estimated') {
    return `Estimado (heurística): ${formatted}`;
  }
  if (method === 'declared') {
    return `Declarado: ${formatted}`;
  }
  return formatted;
}

export function normalizeQualityReport(
  record: ProductionRecord,
  qualityArtifactData?: Record<string, unknown> | null,
  pilotEvidence?: Record<string, unknown> | null
): NormalizedQualityReport {
  const rawQuality =
    record.quality_report ??
    qualityArtifactData ??
    pilotEvidence?.quality_report ??
    pilotEvidence?.qc ??
    pilotEvidence?.quality ??
    null;

  if (!isRecord(rawQuality)) {
    return {
      executed: false,
      overallStatus: 'not_run',
      overallStatusLabel: 'QC não executado',
      overallTone: 'warn',
      productionId: null,
      videoSha256: null,
      generatedAt: null,
      toolName: null,
      toolVersion: null,
      checks: [],
      blockingErrors: [],
      warnings: [],
      passCount: 0,
      warnCount: 0,
      failCount: 0,
      skippedCount: 0,
    };
  }

  const rawStatus = readString(rawQuality.status)?.toLowerCase() ?? null;
  const toolObj = isRecord(rawQuality.tool) ? rawQuality.tool : null;
  const toolName = readString(toolObj?.name);
  const toolVersion = readString(toolObj?.version);
  const productionId = readString(rawQuality.production_id);
  const videoSha256 = readSha256(rawQuality.video_sha256);
  const generatedAt = readString(rawQuality.generated_at);

  const rawBlocking = Array.isArray(rawQuality.blocking_errors)
    ? rawQuality.blocking_errors.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    : [];
  const rawWarnings = Array.isArray(rawQuality.warnings)
    ? rawQuality.warnings.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
    : [];

  const rawChecks = Array.isArray(rawQuality.checks) ? rawQuality.checks.filter(isRecord) : [];

  const checks: NormalizedQualityCheck[] = rawChecks.map((item, idx) => {
    const id = readString(item.id) ?? `check_${idx + 1}`;
    const rawCategory = readString(item.category)?.toLowerCase() ?? 'integrity';
    const categoryLabel = CATEGORY_LABELS[rawCategory] ?? rawCategory;

    const rawCheckStatus = readString(item.status)?.toLowerCase() ?? 'not_checked';
    let status: NormalizedQualityCheck['status'] = 'not_checked';
    if (
      rawCheckStatus === 'pass' ||
      rawCheckStatus === 'warn' ||
      rawCheckStatus === 'fail' ||
      rawCheckStatus === 'skipped' ||
      rawCheckStatus === 'not_checked'
    ) {
      status = rawCheckStatus;
    }

    const rawMethod = readString(item.method)?.toLowerCase() ?? 'unverified';
    let method: NormalizedQualityCheck['method'] = 'unverified';
    if (rawMethod === 'measured' || rawMethod === 'declared' || rawMethod === 'estimated') {
      method = rawMethod;
    }

    const measuredObj = isRecord(item.measured) ? item.measured : null;
    const thresholdObj = isRecord(item.threshold) ? item.threshold : null;
    const measuredSource = readString(measuredObj?.source);

    const tcObj = isRecord(item.timecode) ? item.timecode : null;
    const tcStart = readFiniteNumber(tcObj?.start);
    const tcEnd = readFiniteNumber(tcObj?.end);
    const timecode: QualityCheckTimecode | null =
      tcStart !== null && tcStart >= 0
        ? {
            start: tcStart,
            end: tcEnd !== null && tcEnd >= tcStart ? tcEnd : tcStart,
          }
        : null;

    const isBlocking =
      status === 'fail' ||
      rawBlocking.some(b => b === id || b.startsWith(`${id}:`));
    const isWarning =
      status === 'warn' ||
      rawWarnings.some(w => w === id || w.startsWith(`${id}:`));

    let methodLabel = METHOD_LABELS[method] ?? method;
    if (method === 'measured' && status !== 'skipped') {
      if (!measuredSource) {
        methodLabel = 'Medido (measured · source não declarada)';
      } else if (/estimat|heur[ií]stic|declared/i.test(measuredSource)) {
        methodLabel = `Inválido: source="${measuredSource}" não é medição real`;
      } else {
        methodLabel = `Medido (measured · source: ${measuredSource})`;
      }
    }

    return {
      id,
      category: rawCategory,
      categoryLabel,
      status,
      statusLabel: CHECK_STATUS_LABELS[status] ?? status,
      method,
      methodLabel,
      measuredSource,
      measuredText: formatMetricObject(measuredObj, method),
      thresholdText: formatMetricObject(thresholdObj),
      detail: readString(item.detail) ?? '—',
      timecode,
      isBlocking,
      isWarning,
    };
  });

  const checkById = new Map<string, NormalizedQualityCheck>();
  for (const c of checks) {
    checkById.set(c.id, c);
  }

  const blockingErrors: NormalizedQualityHighlight[] = [];
  const seenBlockingIds = new Set<string>();

  for (const entry of rawBlocking) {
    const matched =
      checkById.get(entry) ??
      checks.find(c => entry.startsWith(`${c.id}:`)) ??
      null;
    const id = matched?.id ?? entry;
    seenBlockingIds.add(id);
    blockingErrors.push({
      id,
      kind: 'blocking_error',
      detail:
        matched && entry === matched.id
          ? `${matched.id}: ${matched.detail}`
          : entry,
      categoryLabel: matched?.categoryLabel ?? null,
      methodLabel: matched?.methodLabel ?? null,
      timecode: matched?.timecode ?? null,
    });
  }
  for (const c of checks) {
    if (c.status === 'fail' && !seenBlockingIds.has(c.id)) {
      seenBlockingIds.add(c.id);
      blockingErrors.push({
        id: c.id,
        kind: 'blocking_error',
        detail: `${c.id}: ${c.detail}`,
        categoryLabel: c.categoryLabel,
        methodLabel: c.methodLabel,
        timecode: c.timecode,
      });
    }
  }

  const warnings: NormalizedQualityHighlight[] = [];
  const seenWarningIds = new Set<string>();

  for (const entry of rawWarnings) {
    const matched =
      checkById.get(entry) ??
      checks.find(c => entry.startsWith(`${c.id}:`)) ??
      null;
    const id = matched?.id ?? entry;
    seenWarningIds.add(id);
    warnings.push({
      id,
      kind: 'warning',
      detail:
        matched && entry === matched.id
          ? `${matched.id}: ${matched.detail}`
          : entry,
      categoryLabel: matched?.categoryLabel ?? null,
      methodLabel: matched?.methodLabel ?? null,
      timecode: matched?.timecode ?? null,
    });
  }
  for (const c of checks) {
    if (c.status === 'warn' && !seenWarningIds.has(c.id)) {
      seenWarningIds.add(c.id);
      warnings.push({
        id: c.id,
        kind: 'warning',
        detail: `${c.id}: ${c.detail}`,
        categoryLabel: c.categoryLabel,
        methodLabel: c.methodLabel,
        timecode: c.timecode,
      });
    }
  }

  const passCount = checks.filter(c => c.status === 'pass').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const failCount = checks.filter(c => c.status === 'fail').length;
  const skippedCount = checks.filter(
    c => c.status === 'skipped' || c.status === 'not_checked'
  ).length;
  const notCheckedCount = checks.filter(c => c.status === 'not_checked').length;

  // Regra Contrato 2: status derivado dos checks (fail > warn > pass, e not_run se lista vazia ou apenas skipped)
  const onlySkipped =
    checks.length > 0 &&
    passCount === 0 &&
    warnCount === 0 &&
    failCount === 0 &&
    notCheckedCount === 0;

  if (
    rawStatus === 'not_run' ||
    onlySkipped ||
    (checks.length === 0 && rawStatus === null && blockingErrors.length === 0)
  ) {
    return {
      executed: false,
      overallStatus: 'not_run',
      overallStatusLabel: 'QC não executado',
      overallTone: 'warn',
      productionId,
      videoSha256,
      generatedAt,
      toolName,
      toolVersion,
      checks,
      blockingErrors,
      warnings,
      passCount,
      warnCount,
      failCount,
      skippedCount,
    };
  }

  let overallStatus: QualityReportOverallStatus = 'pass';
  if (rawStatus === 'fail' || failCount > 0 || blockingErrors.length > 0) {
    overallStatus = 'fail';
  } else if (
    rawStatus === 'warn' ||
    warnCount > 0 ||
    notCheckedCount > 0 ||
    warnings.length > 0
  ) {
    overallStatus = 'warn';
  } else if (rawStatus === 'pass' || passCount > 0) {
    overallStatus = 'pass';
  } else {
    overallStatus = 'not_run';
  }

  const overallStatusLabel =
    overallStatus === 'fail'
      ? 'QC reprovado (fail)'
      : overallStatus === 'warn'
      ? 'QC com avisos / pendências (warn)'
      : overallStatus === 'pass'
      ? 'QC técnico aprovado (pass · publishable: false)'
      : 'QC não executado';

  const overallTone =
    overallStatus === 'fail'
      ? 'bad'
      : overallStatus === 'warn' || overallStatus === 'not_run'
      ? 'warn'
      : 'good';

  return {
    executed: overallStatus !== 'not_run',
    overallStatus,
    overallStatusLabel,
    overallTone,
    productionId,
    videoSha256,
    generatedAt,
    toolName,
    toolVersion,
    checks,
    blockingErrors,
    warnings,
    passCount,
    warnCount,
    failCount,
    skippedCount,
  };
}

const ASSET_KIND_LABELS: Record<string, string> = {
  image: 'Imagem (image)',
  video: 'Vídeo (video)',
  audio: 'Áudio (audio)',
  voice: 'Voz (voice)',
  music: 'Música (music)',
  font: 'Fonte (font)',
};

/** Data/hora no formato local já usado na interface (pt-BR); texto não-data é devolvido como veio. */
export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR');
}

const ENGINE_NAMES: Record<string, string> = {
  windows_sapi: 'Windows SAPI',
  piper: 'Piper',
  kokoro: 'Kokoro',
};

/**
 * Descreve a voz de um asset a partir da proveniência (origin + narration.engine/voice),
 * sem presumir SAPI: system_voice é a voz do Windows; local_tts_model mostra provedor e voz.
 */
export function describeVoiceAssets(assets: unknown[]): string {
  const labels: string[] = [];
  for (const item of assets) {
    if (!isRecord(item)) continue;
    const origin = readString(item.origin);
    if (origin !== 'system_voice' && origin !== 'local_tts_model') continue;
    const narration = isRecord(item.narration) ? item.narration : null;
    const engine = readString(narration?.engine);
    const voice = readString(narration?.voice) ?? readString(narration?.voice_id);
    let label: string;
    if (origin === 'system_voice') {
      label = voice ? `voz do Windows (${voice})` : 'voz do Windows';
    } else {
      const name = engine ? (ENGINE_NAMES[engine] ?? engine) : 'modelo de voz local';
      label = voice ? `${name} ${voice}` : name;
    }
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.length > 0 ? labels.join(', ') : 'voz local';
}

const ASSET_ORIGIN_LABELS: Record<string, string> = {
  original_local: 'Original local (original_local)',
  system_voice: 'Voz do sistema (system_voice)',
  local_tts_model: 'Modelo TTS local (local_tts_model)',
  stock_pexels: 'Stock Pexels (stock_pexels)',
  stock_pixabay: 'Stock Pixabay (stock_pixabay)',
  licensed_manual: 'Licença manual (licensed_manual)',
};

const COMMERCIAL_USE_LABELS: Record<string, string> = {
  allowed: 'Permitido (allowed)',
  restricted: 'Restrito / Não comercial (restricted)',
  unknown: 'Desconhecido (unknown — nunca equivale a permitido)',
};

const ASSET_STATUS_LABELS: Record<string, string> = {
  verified: 'Verificado (verified)',
  unverified: 'Não verificado (unverified)',
  rejected: 'Rejeitado (rejected)',
};

export function normalizeAssetProvenance(
  record: ProductionRecord,
  assetProvenanceData?: Record<string, unknown> | null,
  pilotEvidence?: Record<string, unknown> | null
): NormalizedAssetProvenance {
  const rawProvenance = record.asset_provenance ?? assetProvenanceData ?? null;
  const hasContractReport =
    isRecord(rawProvenance) && Array.isArray(rawProvenance.assets);

  let rawAssets: Record<string, unknown>[] = [];
  let hasLegacyFallback = false;

  if (hasContractReport && isRecord(rawProvenance) && Array.isArray(rawProvenance.assets)) {
    rawAssets = rawProvenance.assets.filter(isRecord);
  } else if (isRecord(pilotEvidence) && Array.isArray(pilotEvidence.assets)) {
    const legacyAssets = pilotEvidence.assets.filter(isRecord);
    if (legacyAssets.length > 0) {
      hasLegacyFallback = true;
      rawAssets = legacyAssets.map(legacy => {
        const origin = readString(legacy.origin) ?? 'original_local';
        const legacyLicense = readString(legacy.license) ?? 'unverified';
        return {
          asset_id: readString(legacy.id) ?? readString(legacy.asset_id) ?? 'asset',
          relative_path: readString(legacy.relative_path) ?? '—',
          sha256: readSha256(legacy.sha256) ?? readString(legacy.sha256) ?? '—',
          kind: origin === 'system_voice' ? 'voice' : 'image',
          origin,
          source_url: null,
          author: readString(legacy.attribution),
          license: {
            id: legacyLicense,
            name: legacyLicense === 'original' ? 'Original local (demo)' : 'Não verificada (unverified)',
            url: null,
            commercial_use: 'unknown',
            attribution_required: null,
            verified_by: null,
            verified_at: null,
          },
          status: 'unverified',
          notes: readString(legacy.attribution),
        };
      });
    }
  }

  const assets: NormalizedAssetProvenanceItem[] = rawAssets.map((item, idx) => {
    const assetId =
      readString(item.asset_id) ?? readString(item.id) ?? `asset_${idx + 1}`;
    const relativePath = readString(item.relative_path) ?? '—';
    const sha256 = readSha256(item.sha256) ?? readString(item.sha256) ?? '—';
    const kind = readString(item.kind)?.toLowerCase() ?? 'image';
    const origin = readString(item.origin)?.toLowerCase() ?? 'original_local';
    const isStock = origin === 'stock_pexels' || origin === 'stock_pixabay';
    const isExternalOrigin = isStock || origin === 'licensed_manual';
    const sourceUrl = readString(item.source_url);
    const author = readString(item.author);

    const licObj = isRecord(item.license) ? item.license : {};
    const licenseId = readString(licObj.id);
    const licenseName = readString(licObj.name);
    const licenseUrl = readString(licObj.url);

    const rawCommercial = readString(licObj.commercial_use)?.toLowerCase() ?? 'unknown';
    const commercialUse: NormalizedAssetProvenanceItem['commercialUse'] =
      rawCommercial === 'allowed' || rawCommercial === 'restricted'
        ? rawCommercial
        : 'unknown';

    const attributionRequired =
      typeof licObj.attribution_required === 'boolean'
        ? licObj.attribution_required
        : null;
    const attributionLabel =
      attributionRequired === true
        ? 'Atribuição obrigatória'
        : attributionRequired === false
        ? 'Sem atribuição obrigatória'
        : 'Atribuição não verificada (null)';

    const rawVerifiedBy = readString(licObj.verified_by);
    const verifiedAt = readString(licObj.verified_at);
    const verifiedBy: 'human' | null =
      rawVerifiedBy === 'human' && verifiedAt !== null ? 'human' : null;
    const verificationLabel =
      verifiedBy === 'human'
        ? `Verificado por humano (${formatLocalDateTime(verifiedAt!)})`
        : 'Não verificado por humano (verified_by: null)';

    const rawStatus = readString(item.status)?.toLowerCase() ?? 'unverified';
    // Regra Contrato 3: status=verified exige verified_by="human" + verified_at, commercial_use != unknown e attribution_required conhecido
    const meetsVerifiedRequirements =
      verifiedBy === 'human' &&
      verifiedAt !== null &&
      commercialUse !== 'unknown' &&
      attributionRequired !== null;

    let status: NormalizedAssetProvenanceItem['status'] = 'unverified';
    if (rawStatus === 'rejected') {
      status = 'rejected';
    } else if (rawStatus === 'verified' && meetsVerifiedRequirements) {
      status = 'verified';
    } else {
      status = 'unverified';
    }

    const commercialUsePermitted =
      status === 'verified' && commercialUse === 'allowed' && verifiedBy === 'human';

    const notes = readString(item.notes);
    const itemWarnings: string[] = [];

    if (rawStatus === 'verified' && !meetsVerifiedRequirements) {
      itemWarnings.push(
        'Status verified inválido: exige verified_by="human", verified_at, commercial_use conhecido e attribution_required definido.'
      );
    }
    if (status === 'unverified') {
      itemWarnings.push('Status unverified: direitos e licença pendentes de verificação.');
    } else if (status === 'rejected') {
      itemWarnings.push('Status rejected: asset rejeitado para uso.');
    }

    if (commercialUse === 'unknown') {
      itemWarnings.push('commercial_use: unknown — nunca equivale a uso comercial permitido.');
    } else if (commercialUse === 'restricted') {
      itemWarnings.push('commercial_use: restricted — uso comercial restrito/bloqueado.');
    }

    if (verifiedBy !== 'human') {
      itemWarnings.push('Sem verificação humana (verified_by: null).');
    }

    if (isExternalOrigin && status !== 'rejected') {
      const missingExternalFields: string[] = [];
      if (!sourceUrl) missingExternalFields.push('source_url');
      if (!author) missingExternalFields.push('author');
      if (!licenseId || !licenseName || !licenseUrl) {
        missingExternalFields.push('termos de licença (id, name, url)');
      }
      if (verifiedBy !== 'human') {
        missingExternalFields.push('verificação humana');
      }
      if (missingExternalFields.length > 0) {
        itemWarnings.push(
          `Regra de ${isStock ? `stock (${origin})` : origin} incompleta: exige ${missingExternalFields.join(', ')}.`
        );
      }
    }

    return {
      assetId,
      relativePath,
      sha256,
      kind,
      kindLabel: ASSET_KIND_LABELS[kind] ?? kind,
      origin,
      originLabel: ASSET_ORIGIN_LABELS[origin] ?? origin,
      isStock,
      isExternalOrigin,
      sourceUrl,
      author,
      licenseId,
      licenseName,
      licenseUrl,
      commercialUse,
      commercialUseLabel: COMMERCIAL_USE_LABELS[commercialUse] ?? commercialUse,
      commercialUsePermitted,
      attributionRequired,
      attributionLabel,
      verifiedBy,
      verifiedAt,
      verificationLabel,
      status,
      statusLabel: ASSET_STATUS_LABELS[status] ?? status,
      notes,
      warnings: itemWarnings,
    };
  });

  const unverifiedCount = assets.filter(a => a.status === 'unverified').length;
  const rejectedCount = assets.filter(a => a.status === 'rejected').length;
  const unknownCommercialCount = assets.filter(a => a.commercialUse === 'unknown').length;
  const restrictedCommercialCount = assets.filter(a => a.commercialUse === 'restricted').length;
  const unverifiedByHumanCount = assets.filter(a => a.verifiedBy !== 'human').length;
  const hasStockPexels = assets.some(a => a.origin === 'stock_pexels');
  const hasStockPixabay = assets.some(a => a.origin === 'stock_pixabay');

  const hasUnverifiedOrUnknown =
    !hasContractReport ||
    assets.length === 0 ||
    unverifiedCount > 0 ||
    rejectedCount > 0 ||
    unknownCommercialCount > 0 ||
    restrictedCommercialCount > 0 ||
    unverifiedByHumanCount > 0;

  const summaryWarnings: string[] = [];
  if (!hasContractReport) {
    summaryWarnings.push(
      'Relatório asset-provenance.json ausente: licenças e uso comercial permanecem não verificados.'
    );
  }
  if (rejectedCount > 0) {
    summaryWarnings.push(`${rejectedCount} asset(s) com status rejected.`);
  }
  if (unverifiedCount > 0) {
    summaryWarnings.push(`${unverifiedCount} asset(s) com status unverified.`);
  }
  if (unknownCommercialCount > 0) {
    summaryWarnings.push(
      `${unknownCommercialCount} asset(s) com commercial_use=unknown (nunca equivale a permitido).`
    );
  }
  if (restrictedCommercialCount > 0) {
    summaryWarnings.push(`${restrictedCommercialCount} asset(s) com commercial_use=restricted.`);
  }
  if (unverifiedByHumanCount > 0) {
    summaryWarnings.push(`${unverifiedByHumanCount} asset(s) sem verificação humana (verified_by=null).`);
  }

  return {
    hasContractReport,
    hasLegacyFallback,
    assets,
    hasUnverifiedOrUnknown,
    hasStockPexels,
    hasStockPixabay,
    unverifiedCount,
    rejectedCount,
    unknownCommercialCount,
    restrictedCommercialCount,
    unverifiedByHumanCount,
    summaryWarnings,
  };
}

export function normalizeWordTimings(
  record: ProductionRecord,
  wordTimingsData?: Record<string, unknown> | null,
  pilotEvidence?: Record<string, unknown> | null,
  scriptSections?: ScriptSection[] | null
): NormalizedWordTimings {
  const raw = record.word_timings ?? wordTimingsData ?? null;
  if (!isRecord(raw) || !Array.isArray(raw.words)) {
    return {
      available: false,
      narrationSha256: null,
      durationSeconds: null,
      source: null,
      sourceLabel: 'Indisponível (word-timings.json ausente)',
      isEstimated: false,
      engineName: null,
      engineVoice: null,
      words: [],
      alignment: null,
      declaredAlignment: null,
      speechAligned: false,
      validationReason:
        'word-timings.json ausente — alinhamento por palavra não disponível (speech_aligned: false).',
    };
  }

  const narrationSha256 = readSha256(raw.narration_sha256);
  const durationSeconds = readFiniteNumber(raw.duration_seconds);
  const source = readString(raw.source) ?? 'estimated';
  const engineObj = isRecord(raw.engine) ? raw.engine : null;
  const engineName = readString(engineObj?.name);
  const engineVoice = readString(engineObj?.voice);
  const isEstimated = source === 'estimated';

  const parsed = parseWordTimingsWords(raw.words, source, raw.alignment);
  const words = parsed.words;

  const sourceLabel =
    source === 'tts_engine_events'
      ? 'Eventos do motor TTS (tts_engine_events — medido na síntese)'
      : source === 'forced_alignment'
      ? 'Alinhamento acústico forçado (forced_alignment — medido)'
      : 'Estimado / heurístico (estimated — NÃO é medição real)';

  // Regras Contrato 1 (docs/contratos-midia.md):
  // - word.text sem espaços e char_length == len(text)
  // - index = 0..N-1, end > start, monotônicos sem sobreposição (tolerância 1 ms), end <= duration_seconds
  // - char_offset crescente sem sobrepor; section não regride
  // - speech_aligned=true somente se documento válido, source != estimated e hash, duração, roteiro e seções conferem
  const reasons: string[] = [];
  if (isEstimated || (source !== 'tts_engine_events' && source !== 'forced_alignment')) {
    reasons.push('source=estimated (heurística nunca habilita speech_aligned=true)');
  }
  if (words.length === 0 || parsed.invalidItems > 0) {
    reasons.push('lista de palavras vazia ou com itens inválidos');
  }

  let isMonotonic = true;
  let validWordTextAndLength = true;
  let withinDuration = durationSeconds !== null && durationSeconds > 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/\s/.test(w.text) || w.char_length !== w.text.length || w.char_offset < 0) {
      validWordTextAndLength = false;
    }
    if (w.index !== i || w.start < 0 || w.end <= w.start) {
      isMonotonic = false;
    }
    if (i > 0) {
      const prev = words[i - 1];
      if (w.start < prev.end - 0.001) {
        isMonotonic = false;
      }
      if (
        typeof w.section === 'number' &&
        typeof prev.section === 'number' &&
        w.section < prev.section
      ) {
        isMonotonic = false;
      }
    }
    if (durationSeconds !== null && w.end > durationSeconds + 0.001) {
      withinDuration = false;
    }
  }
  reasons.push(...parsed.contractReasons);
  if (parsed.belowThreshold) {
    reasons.push(
      `alignment abaixo dos limiares (taxa de casamento < ${MIN_ALIGNMENT_MATCH_RATE * 100}% ou trecho interpolado contínuo > ${MAX_INTERPOLATED_RUN_SECONDS} s)`
    );
  }
  if (!validWordTextAndLength) {
    reasons.push('word.text contém espaços ou char_length difere de len(text)');
  }
  if (!isMonotonic) {
    reasons.push('tempos/seções de palavras não monotônicos ou índices fora de ordem');
  }
  if (!withinDuration) {
    reasons.push('tempos de palavras excedem duration_seconds');
  }

  // Validação cruzada de hash e duração com pilot-evidence.json
  const evNarration =
    isRecord(pilotEvidence) && isRecord(pilotEvidence.narration) ? pilotEvidence.narration : null;
  const evSha = readSha256(evNarration?.sha256);
  const evDur = readFiniteNumber(evNarration?.duration_seconds);
  if (evSha && narrationSha256 !== evSha) {
    reasons.push('narration_sha256 diverge do áudio registrado');
  }
  if (evDur !== null && durationSeconds !== null && Math.abs(durationSeconds - evDur) > 0.05) {
    reasons.push('duration_seconds diverge da duração medida da narração');
  }

  // Verificar limites das seções medidas quando disponíveis em pilot-evidence.json
  const scenesArray =
    isRecord(pilotEvidence) && Array.isArray(pilotEvidence.scenes)
      ? pilotEvidence.scenes.filter(isRecord)
      : [];
  if (scenesArray.length > 0) {
    const sceneBoundsById = new Map<string, { start: number; end: number }>();
    const sceneBoundsByIndex = new Map<number, { start: number; end: number }>();
    scenesArray.forEach((s, idx) => {
      const sid = readString(s.id);
      const sStart = readFiniteNumber(s.start);
      const sEnd = readFiniteNumber(s.end);
      if (sStart !== null && sEnd !== null) {
        sceneBoundsByIndex.set(idx + 1, { start: sStart, end: sEnd });
        if (sid) {
          sceneBoundsById.set(sid, { start: sStart, end: sEnd });
          sceneBoundsById.set(`sec_${sid}`, { start: sStart, end: sEnd });
        }
      }
    });
    const outsideSection = words.some(w => {
      const b =
        typeof w.section === 'number'
          ? sceneBoundsByIndex.get(w.section)
          : sceneBoundsById.get(w.section) ??
            sceneBoundsById.get(w.section.replace(/^sec_/, '')) ??
            sceneBoundsByIndex.get(Number.parseInt(w.section, 10));
      if (!b) return true;
      return w.start < b.start - 0.05 || w.end > b.end + 0.05;
    });
    if (outsideSection) {
      reasons.push('palavras fora dos limites das seções medidas');
    }
  }

  // Verificar cobertura das palavras do roteiro na ordem quando seções do roteiro estão disponíveis
  if (scriptSections && scriptSections.length > 0) {
    const expectedTokens: string[] = [];
    for (const sec of scriptSections) {
      const rawTokens = sec.narration.trim().split(/\s+/).filter(Boolean);
      expectedTokens.push(...rawTokens);
    }
    const actualTokens = words.map(w => w.text);
    if (
      expectedTokens.length > 0 &&
      (actualTokens.length !== expectedTokens.length ||
        actualTokens.some((tok, idx) => tok !== expectedTokens[idx]))
    ) {
      reasons.push('palavras não cobrem integralmente o roteiro aprovado na ordem exata');
    }
  }

  if (record.speech_aligned === false && reasons.length === 0) {
    reasons.push('speech_aligned=false declarado pelo registro da produção');
  }

  const speechAligned = reasons.length === 0;
  const validationReason = speechAligned
    ? `Alinhamento por palavra validado (${source} · ${words.length} palavras monotônicas dentro da duração e das seções · speech_aligned: true).`
    : `speech_aligned: false (${reasons.join('; ')}).`;

  return {
    available: true,
    narrationSha256,
    durationSeconds,
    source,
    sourceLabel,
    isEstimated,
    engineName,
    engineVoice,
    words,
    alignment: parsed.contractReasons.length === 0 ? parsed.alignment : null,
    declaredAlignment: parsed.declaredAlignment,
    speechAligned,
    validationReason,
  };
}

export function doesProductionRequireQualityAcknowledgement(
  record: ProductionRecord,
  quality: NormalizedQualityReport,
  assetProvenance: NormalizedAssetProvenance
): boolean {
  if (
    record.quality_acknowledgement_required === true ||
    record.requires_quality_acknowledgement === true
  ) {
    return true;
  }
  if (quality.overallStatus === 'fail' || quality.blockingErrors.length > 0) {
    return true;
  }
  if (assetProvenance.hasContractReport && assetProvenance.hasUnverifiedOrUnknown) {
    return true;
  }
  if (
    record.mode === 'local_pilot' &&
    (!quality.executed ||
      quality.overallStatus === 'not_run' ||
      assetProvenance.hasUnverifiedOrUnknown)
  ) {
    return true;
  }
  return false;
}

export function deriveProductionProvenance(
  record: ProductionRecord,
  pilotEvidence?: Record<string, unknown> | null
): NormalizedProductionProvenance {
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
  const recordObj: Record<string, unknown> = isRecord(record) ? record : {};
  const embeddedEvidence = isRecord(record.pilot_evidence)
    ? record.pilot_evidence
    : isRecord(record.provenance)
    ? record.provenance
    : null;
  const evidence = pilotEvidence ?? embeddedEvidence;

  const evAudio = isRecord(evidence?.narration)
    ? evidence.narration
    : isRecord(evidence?.audio)
    ? evidence.audio
    : isRecord(evidence?.voice)
    ? evidence.voice
    : isRecord(recordObj.narration)
    ? (recordObj.narration as Record<string, unknown>)
    : isRecord(recordObj.audio)
    ? (recordObj.audio as Record<string, unknown>)
    : null;

  const evSubtitles = isRecord(evidence?.subtitles)
    ? evidence.subtitles
    : isRecord(evidence?.captions)
    ? evidence.captions
    : isRecord(recordObj.subtitles)
    ? (recordObj.subtitles as Record<string, unknown>)
    : null;

  const evAlignment = isRecord(evidence?.alignment)
    ? evidence.alignment
    : isRecord(recordObj.alignment)
    ? (recordObj.alignment as Record<string, unknown>)
    : null;

  const evScenes = isRecord(evidence?.scenes)
    ? evidence.scenes
    : isRecord(recordObj.scenes)
    ? (recordObj.scenes as Record<string, unknown>)
    : null;

  const evAssets = Array.isArray(evidence?.assets) ? evidence.assets : [];

  const pilotEvidenceArtifact =
    artifacts.find(
      a =>
        a.kind === 'manifest' &&
        (a.relative_path === 'pilot-evidence.json' ||
          a.relative_path.endsWith('/pilot-evidence.json'))
    ) ?? null;

  const audioArtifacts = artifacts.filter(a => a.kind === 'audio');
  const subtitleArtifacts = artifacts.filter(a => a.kind === 'subtitles');
  const sceneArtifacts = artifacts.filter(a => a.kind === 'scene');

  const demoOnly =
    readBoolean(record.demo_only) ??
    readBoolean(evidence?.demo_only) ??
    undefined;

  const realVoice =
    readBoolean(record.real_voice) ??
    readBoolean(evAudio?.real_voice) ??
    readBoolean(evidence?.real_voice) ??
    undefined;

  const speechAligned =
    readBoolean(record.speech_aligned) ??
    readBoolean(evSubtitles?.speech_aligned) ??
    readBoolean(evAlignment?.speech_aligned) ??
    readBoolean(evidence?.speech_aligned) ??
    undefined;

  const rawAudioKind =
    readString(record.narration_kind) ??
    readString(record.audio_kind) ??
    readString(record.voice_kind) ??
    readString(evAudio?.kind) ??
    readString(evAudio?.mode) ??
    readString(evidence?.narration_kind) ??
    readString(evidence?.audio_kind) ??
    readString(evidence?.voice_kind);

  const narrationEngine =
    readString(record.tts_engine) ??
    readString(evAudio?.engine) ??
    readString(evAudio?.tts_engine) ??
    readString(evAudio?.motor) ??
    readString(evidence?.tts_engine) ??
    readString(evidence?.voice_engine);

  const narrationVoice = readString(evAudio?.voice) ?? null;
  const narrationSha256 = readSha256(evAudio?.sha256);
  const narrationDurationSeconds =
    typeof evAudio?.duration_seconds === 'number' && Number.isFinite(evAudio.duration_seconds)
      ? evAudio.duration_seconds
      : null;

  const systemVoiceAsset = evAssets.find(
    item => isRecord(item) && readString(item.origin) === 'system_voice'
  ) as Record<string, unknown> | undefined;

  const narrationDisclosure =
    readString(record.narration_disclosure) ??
    readString(evAudio?.disclosure) ??
    readString(evidence?.narration_disclosure) ??
    readString(evidence?.audio_disclosure) ??
    readString(systemVoiceAsset?.attribution) ??
    null;

  const explicitSyntheticTts =
    readBoolean(record.synthetic_tts) === true ||
    readBoolean(record.local_tts) === true ||
    readBoolean(evAudio?.synthetic_tts) === true ||
    readBoolean(evAudio?.local_tts) === true ||
    readBoolean(evidence?.synthetic_tts) === true ||
    readBoolean(evidence?.local_tts) === true ||
    Boolean(systemVoiceAsset);

  let narrationKind: NarrationProvenanceKind = 'unverified';
  if (
    explicitSyntheticTts ||
    (rawAudioKind &&
      /local_tts|tts|sintet|synthet|sapi|piper|espeak|pyttsx|local_voice|pilot_voice|narracao_sintetica/i.test(
        rawAudioKind
      )) ||
    (narrationEngine &&
      !/fixture_tone|synthetic_fixture_tone/i.test(narrationEngine))
  ) {
    narrationKind = 'synthetic_local_tts';
  } else if (
    (rawAudioKind && /fixture_tone|tone|tom|sine|fixture/i.test(rawAudioKind)) ||
    (record.narration_kind === undefined &&
      record.mode !== 'local_pilot' &&
      realVoice === false)
  ) {
    narrationKind = 'fixture_tone';
  } else {
    narrationKind = 'unverified';
  }

  let narrationLabel: string;
  if (realVoice === true) {
    narrationLabel = 'Não verificado para publicação (demonstrativo)';
  } else if (narrationKind === 'synthetic_local_tts') {
    const engineSuffix = narrationEngine ? ` · motor: ${narrationEngine}` : '';
    const voiceSuffix = narrationVoice ? ` (${narrationVoice})` : '';
    narrationLabel = `TTS local sintético (local_tts · não é voz humana nem clone · real_voice: false${engineSuffix}${voiceSuffix})`;
  } else if (narrationKind === 'fixture_tone' && realVoice === false) {
    narrationLabel = 'Sem voz real (tom de fixture: fixture_tone)';
  } else if (realVoice === undefined) {
    narrationLabel = 'Não verificado (ausente; nunca inferir voz real)';
  } else {
    narrationLabel =
      'Não verificado (sem evidência de áudio/TTS no resultado; nunca inferir do modo pedido)';
  }

  const matchedNarrationBySha256 =
    narrationSha256 !== null
      ? audioArtifacts.find(a => a.sha256.toLowerCase() === narrationSha256) ?? null
      : null;

  const fixtureAudioArtifact =
    matchedNarrationBySha256 === null &&
    pilotEvidenceArtifact === null &&
    audioArtifacts.length === 1 &&
    narrationKind === 'fixture_tone' &&
    record.mode !== 'local_pilot'
      ? audioArtifacts[0]
      : null;

  let narrationAudioStatus: NarrationAudioStatus;
  if (audioArtifacts.length === 0) {
    narrationAudioStatus = 'no_audio';
  } else if (matchedNarrationBySha256 !== null) {
    narrationAudioStatus = 'confirmed_by_sha256';
  } else if (fixtureAudioArtifact !== null) {
    narrationAudioStatus = 'fixture_single_tone';
  } else if (pilotEvidenceArtifact !== null && !evidence) {
    narrationAudioStatus = 'loading_evidence';
  } else if (evidence) {
    narrationAudioStatus = 'hash_mismatch_or_missing';
  } else {
    narrationAudioStatus = 'evidence_missing_or_unverified';
  }

  const alignmentMethod =
    readString(record.alignment_method) ??
    readString(evidence?.alignment_method) ??
    readString(evAlignment?.method) ??
    null;

  const rawSubtitleKind =
    readString(record.subtitles_kind) ??
    readString(evSubtitles?.kind) ??
    readString(evSubtitles?.mode) ??
    readString(evidence?.subtitles_kind) ??
    readString(evidence?.subtitle_kind);

  const subtitleDisclosure =
    readString(evSubtitles?.disclosure) ??
    readString(evidence?.subtitles_disclosure) ??
    null;

  const hasSubtitleArrayInEvidence =
    Array.isArray(evidence?.subtitles) && evidence.subtitles.length > 0;

  const explicitSegmented =
    alignmentMethod === 'measured_sections' ||
    hasSubtitleArrayInEvidence ||
    readBoolean(evSubtitles?.segmented) === true ||
    readBoolean(evidence?.segmented_subtitles) === true ||
    (rawSubtitleKind !== null &&
      /segment|measured_sections|pilot|line_srt|scene_srt|timed_srt/i.test(rawSubtitleKind));

  const explicitSyntheticSrt =
    rawSubtitleKind !== null && /synthetic_srt|synthetic|fixture/i.test(rawSubtitleKind);

  let subtitleKind: SubtitleProvenanceKind = 'unverified';
  if (explicitSegmented) {
    subtitleKind = 'segmented_srt';
  } else if (explicitSyntheticSrt) {
    subtitleKind = 'synthetic_srt';
  } else if (subtitleArtifacts.length > 0 && record.mode !== 'local_pilot') {
    subtitleKind = 'synthetic_srt';
  } else if (
    record.alignment_method === undefined &&
    speechAligned === false &&
    record.mode !== 'local_pilot'
  ) {
    subtitleKind = 'synthetic_srt';
  } else {
    subtitleKind = 'unverified';
  }

  let subtitleLabel: string;
  let alignmentLabel: string;
  if (speechAligned === true) {
    const methodTag = alignmentMethod ?? 'word-timings';
    subtitleLabel = `Alinhamento por palavra validado (${methodTag} · speech_aligned: true · demonstrativo não publicável)`;
    alignmentLabel = `Alinhamento por palavra validado (${methodTag} · speech_aligned: true)`;
  } else if (subtitleKind === 'segmented_srt') {
    const methodTag = alignmentMethod ?? 'measured_sections';
    subtitleLabel = `Legenda segmentada local (.srt · ${methodTag}) · Alinhamento de fala não verificado (speech_aligned: false · sem alinhamento fino por palavra)`;
    alignmentLabel = `Limites medidos por seção (${methodTag}) · Alinhamento fino por palavra não verificado`;
  } else if (subtitleKind === 'synthetic_srt' && speechAligned === false) {
    subtitleLabel = 'Sem alinhamento de fala (SRT sintético: synthetic_srt)';
    alignmentLabel = 'Sem alinhamento de fala (SRT sintético por cena)';
  } else if (speechAligned === undefined) {
    subtitleLabel = 'Não verificado (ausente; nunca inferir alinhamento real)';
    alignmentLabel = 'Não verificado (ausente; nunca inferir alinhamento real)';
  } else {
    subtitleLabel =
      'Não verificado (sem legenda SRT registrada; alinhamento de fala não verificado)';
    alignmentLabel = 'Não verificado (sem legenda ou alinhamento verificado)';
  }

  const rawSceneKind =
    readString(record.scenes_kind) ??
    readString(record.visual_origin) ??
    readString(evScenes?.kind) ??
    readString(evScenes?.visual_origin) ??
    readString(evidence?.scenes_kind) ??
    readString(evidence?.visual_origin);

  const hasScenesInEvidence =
    Array.isArray(evidence?.scenes) && evidence.scenes.length > 0;
  const sceneCount =
    sceneArtifacts.length > 0
      ? sceneArtifacts.length
      : Array.isArray(evidence?.scenes)
      ? evidence.scenes.length
      : typeof evScenes?.count === 'number'
      ? evScenes.count
      : 0;

  let sceneKind: SceneProvenanceKind = 'unverified';
  if (
    sceneArtifacts.length > 0 ||
    hasScenesInEvidence ||
    (rawSceneKind !== null &&
      /original_local|demo|fixture|local|synthetic/i.test(rawSceneKind))
  ) {
    sceneKind = 'demo_local';
  }

  const sceneLabel =
    sceneKind === 'demo_local'
      ? `Cenas demonstrativas locais (original_local · ${
          sceneCount > 0 ? `${sceneCount} arquivo(s) PNG · ` : ''
        }sem assets externos)`
      : 'Não verificado (sem cenas registradas nos artefatos)';

  const unverifiedAssets = evAssets.filter(
    item => isRecord(item) && readString(item.license) === 'unverified'
  );
  const originalAssets = evAssets.filter(
    item => isRecord(item) && readString(item.license) === 'original'
  );
  const unverifiedVoices = unverifiedAssets.filter(
    item => isRecord(item) && /^(system_voice|local_tts_model)$/.test(readString(item.origin) ?? '')
  );
  const licenseSummary =
    evAssets.length > 0
      ? `${originalAssets.length} asset(s) original_local (license: original) · ${unverifiedAssets.length} asset(s) não verificado(s) (license: unverified — ${describeVoiceAssets(unverifiedVoices)} não comprova licença comercial nem publicabilidade)`
      : 'Não publicável (publishable: false · licença de voz/publicação não verificada)';

  const rawQuality =
    record.quality_report ??
    evidence?.quality_report ??
    evidence?.qc ??
    evidence?.quality ??
    evidence?.quality_validation ??
    null;

  let qualityStatus: QualityReportStatus = 'unverified';
  let qualitySummary: string | null = null;
  let qualityLabel = 'Não verificado (relatório de qualidade indisponível)';
  let qualityChecksSummary: NormalizedProductionProvenance['qualityChecksSummary'] = null;

  if (isRecord(rawQuality) && Array.isArray(rawQuality.checks)) {
    const checks = rawQuality.checks.filter(isRecord);
    const passCount = checks.filter(c => c.status === 'pass').length;
    const failCount = checks.filter(c => c.status === 'fail').length;
    const notCheckedItems = checks.filter(
      c => c.status === 'not_checked' || c.status === 'skipped' || c.status === 'warn'
    );
    const notCheckedCount = checks.filter(c => c.status === 'not_checked').length;
    const notCheckedIds = notCheckedItems
      .map(c => readString(c.id))
      .filter((id): id is string => Boolean(id));
    const blockingErrors = Array.isArray(rawQuality.blocking_errors)
      ? rawQuality.blocking_errors.filter((e): e is string => typeof e === 'string')
      : [];
    const warnings = Array.isArray(rawQuality.warnings)
      ? rawQuality.warnings.filter((w): w is string => typeof w === 'string')
      : [];

    qualityChecksSummary = {
      passCount,
      failCount,
      notCheckedCount,
      notCheckedIds,
      blockingErrors,
      warnings,
    };

    const rawOverallStatus = readString(rawQuality.status)?.toLowerCase();

    if (rawOverallStatus === 'not_run') {
      qualityStatus = 'unverified';
      qualityLabel = 'QC não executado · Não verificado (relatório de qualidade indisponível)';
    } else if (rawOverallStatus === 'fail' || failCount > 0 || blockingErrors.length > 0) {
      qualityStatus = 'failed';
      qualitySummary = blockingErrors[0] ?? `${failCount} verificação(ões) reprovada(s)`;
      qualityLabel = `QC com falhas (${failCount} fail, ${passCount} pass, ${notCheckedCount} not_checked) · ${blockingErrors.length} erro(s) bloqueante(s) · publishable: false`;
    } else if (notCheckedCount > 0) {
      qualityStatus = 'partial_not_checked';
      qualitySummary = `Itens não medidos/verificados: ${notCheckedIds.join(', ')}`;
      qualityLabel = `QC parcial (${passCount} pass, 0 fail, ${notCheckedCount} not_checked: ${notCheckedIds.join(
        ', '
      )}) · ${warnings.length} aviso(s) · publishable: false (não equivale a aprovação total)`;
    } else if (rawOverallStatus === 'warn' || warnings.length > 0 || notCheckedItems.length > 0) {
      qualityStatus = 'partial_not_checked';
      qualitySummary = warnings[0] ?? 'Avisos técnicos registrados';
      qualityLabel = `QC com avisos (${passCount} pass, ${warnings.length} aviso(s)) · publishable: false`;
    } else {
      qualityStatus = 'passed';
      qualityLabel = `Checks técnicos aprovados (${passCount} pass) · publishable: false (exige revisão humana e licença não verificada)`;
    }
  } else if (isRecord(rawQuality)) {
    const rawQualityStatus =
      readString(record.quality_status) ??
      readString(rawQuality.status) ??
      readString(evidence?.quality_status);
    const rawQualityPassed =
      readBoolean(rawQuality.passed) ?? readBoolean(rawQuality.valid);
    qualitySummary =
      readString(rawQuality.summary) ??
      readString(rawQuality.message) ??
      readString(rawQuality.detail);

    if (
      rawQualityPassed === false ||
      (rawQualityStatus !== null && /^(failed|fail|rejected|invalid|error)$/i.test(rawQualityStatus))
    ) {
      qualityStatus = 'failed';
      qualityLabel = qualitySummary
        ? `Pendências no relatório de qualidade: ${qualitySummary}`
        : 'Relatório de qualidade apontou pendências técnicas';
    } else if (
      rawQualityPassed === true ||
      (rawQualityStatus !== null &&
        /^(passed|pass|approved|valid|ok|succeeded|verified)$/i.test(rawQualityStatus))
    ) {
      qualityStatus = 'passed';
      qualityLabel = qualitySummary
        ? `Relatório técnico disponível: ${qualitySummary} (publishable: false)`
        : 'Relatório técnico disponível (não implica aprovação humana nem publicabilidade)';
    }
  }

  return {
    demoOnly,
    realVoice,
    speechAligned,
    publishable: false,
    narrationKind,
    narrationEngine,
    narrationVoice,
    narrationDisclosure,
    narrationLabel,
    narrationSha256,
    narrationDurationSeconds,
    narrationAudioArtifact: matchedNarrationBySha256,
    fixtureAudioArtifact,
    narrationAudioStatus,
    alignmentMethod,
    subtitleKind,
    subtitleDisclosure,
    subtitleLabel,
    alignmentLabel,
    sceneKind,
    sceneCount,
    sceneLabel,
    licenseSummary,
    qualityStatus,
    qualitySummary,
    qualityLabel,
    qualityChecksSummary,
    hasPilotEvidenceManifest: Boolean(pilotEvidenceArtifact),
    pilotEvidenceArtifact,
    pilotEvidenceLoaded: Boolean(evidence),
  };
}

export function extractSceneNavItems(
  pilotEvidence?: Record<string, unknown> | null,
  planData?: Record<string, unknown> | null
): TimecodeSceneNavItem[] {
  const items: TimecodeSceneNavItem[] = [];
  const evScenes =
    isRecord(pilotEvidence) && Array.isArray(pilotEvidence.scenes)
      ? pilotEvidence.scenes.filter(isRecord)
      : [];
  if (evScenes.length > 0) {
    evScenes.forEach((scene, idx) => {
      const id = readString(scene.id) ?? `scene_${idx + 1}`;
      const start = readFiniteNumber(scene.start) ?? 0;
      const end = readFiniteNumber(scene.end) ?? start;
      const assetId = readString(scene.asset_id);
      items.push({
        id,
        label: `Cena ${idx + 1} (${id})${assetId ? ` · ${assetId}` : ''}`,
        start,
        end,
        assetId,
      });
    });
    return items;
  }

  const planScenes =
    isRecord(planData) && Array.isArray(planData.scenes)
      ? planData.scenes.filter(isRecord)
      : [];
  planScenes.forEach((scene, idx) => {
    const id = readString(scene.id) ?? `scene_${idx + 1}`;
    const heading = readString(scene.heading);
    const start = readFiniteNumber(scene.start) ?? 0;
    const end = readFiniteNumber(scene.end) ?? start;
    items.push({
      id,
      label: `Cena ${idx + 1} (${id})${heading ? ` · ${heading}` : ''}`,
      start,
      end,
    });
  });
  return items;
}

export function extractSubtitleNavItems(
  pilotEvidence?: Record<string, unknown> | null,
  srtSegments?: SrtSegment[] | null
): TimecodeSubtitleNavItem[] {
  if (srtSegments && srtSegments.length > 0) {
    return srtSegments.map(seg => ({
      index: seg.index,
      start: seg.startSeconds ?? 0,
      end: seg.endSeconds ?? seg.startSeconds ?? 0,
      text: seg.text,
    }));
  }

  const evSubtitles =
    isRecord(pilotEvidence) && Array.isArray(pilotEvidence.subtitles)
      ? pilotEvidence.subtitles.filter(isRecord)
      : [];
  return evSubtitles.map((sub, idx) => {
    const start = readFiniteNumber(sub.start) ?? 0;
    const end = readFiniteNumber(sub.end) ?? start;
    const text = readString(sub.text) ?? '';
    return {
      index: idx + 1,
      start,
      end,
      text,
    };
  });
}

export function parseSrtSegments(rawSrt: string): SrtSegment[] {
  const normalized = rawSrt.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n{2,}/);
  const segments: SrtSegment[] = [];
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;
    const timeLineIndex = lines.findIndex(l => l.includes('-->'));
    if (timeLineIndex === -1) continue;
    const [startRaw, endRaw] = lines[timeLineIndex].split('-->');
    const parsedIndex = Number.parseInt(lines[0], 10);
    const index = Number.isFinite(parsedIndex) ? parsedIndex : segments.length + 1;
    const text = lines.slice(timeLineIndex + 1).join(' ');
    const startTrimmed = (startRaw ?? '').trim();
    const endTrimmed = (endRaw ?? '').trim();
    segments.push({
      index,
      start: startTrimmed,
      end: endTrimmed,
      startSeconds: parseSrtTimestampToSeconds(startTrimmed),
      endSeconds: parseSrtTimestampToSeconds(endTrimmed),
      text,
    });
  }
  return segments;
}

export function summarizeJsonArtifact(
  relativePath: string,
  data: Record<string, unknown>
): Array<{ label: string; value: string }> {
  const summary: Array<{ label: string; value: string }> = [];
  const lower = relativePath.toLowerCase();

  if (lower.endsWith('plan.json')) {
    const title = readString(data.title);
    const mode = readString(data.mode);
    const duration = typeof data.total_duration === 'number' ? `${data.total_duration}s` : null;
    const scenesCount = Array.isArray(data.scenes) ? String(data.scenes.length) : null;
    const audioObj = isRecord(data.audio) ? data.audio : null;
    const subsObj = isRecord(data.subtitles) ? data.subtitles : null;
    if (title) summary.push({ label: 'Título do plano', value: title });
    if (mode) summary.push({ label: 'Modo no plano', value: mode });
    if (duration) summary.push({ label: 'Duração estimada', value: duration });
    if (scenesCount) summary.push({ label: 'Cenas previstas', value: `${scenesCount} cena(s)` });
    if (audioObj) {
      summary.push({
        label: 'Áudio no plano',
        value: `${readString(audioObj.kind) ?? 'não informado'} (real_voice: ${String(
          audioObj.real_voice ?? 'não verificado'
        )})`,
      });
    }
    if (subsObj) {
      summary.push({
        label: 'Legendas no plano',
        value: `${readString(subsObj.kind) ?? 'não informado'} (speech_aligned: ${String(
          subsObj.speech_aligned ?? 'não verificado'
        )})`,
      });
    }
    return summary;
  }

  if (lower.endsWith('pilot-evidence.json')) {
    const narrationObj = isRecord(data.narration)
      ? data.narration
      : isRecord(data.audio)
      ? data.audio
      : null;
    const videoObj = isRecord(data.video) ? data.video : null;
    const subsArray = Array.isArray(data.subtitles) ? data.subtitles : null;
    const subsObj = isRecord(data.subtitles) ? data.subtitles : null;
    const scenesArray = Array.isArray(data.scenes) ? data.scenes : null;
    const assetsArray = Array.isArray(data.assets) ? data.assets : null;
    const alignmentMethod = readString(data.alignment_method);
    const quality = data.quality_report ?? data.qc ?? data.quality ?? null;

    const audioKind =
      readString(narrationObj?.kind) ??
      readString(data.narration_kind) ??
      readString(data.audio_kind);
    const engine =
      readString(narrationObj?.engine) ??
      readString(data.tts_engine) ??
      readString(narrationObj?.tts_engine);
    const voice = readString(narrationObj?.voice);
    const audioDur =
      typeof narrationObj?.duration_seconds === 'number'
        ? `${narrationObj.duration_seconds.toFixed(2)}s`
        : null;
    const audioSha = readSha256(narrationObj?.sha256);

    summary.push({
      label: 'Narração / Voz',
      value: audioKind
        ? `${audioKind}${engine ? ` (${engine})` : ''}${voice ? ` · ${voice}` : ''}${
            audioDur ? ` · ${audioDur}` : ''
          }${audioSha ? ` · sha256: ${audioSha}` : ''} · real_voice: false`
        : 'Não verificado',
    });

    const subsKind =
      alignmentMethod ??
      readString(data.subtitles_kind) ??
      readString(subsObj?.kind) ??
      (subsArray ? `segmented (${subsArray.length} trechos)` : null);

    summary.push({
      label: 'Legendas / Alinhamento',
      value: `${subsKind ?? 'segmentada / local'}${
        subsArray ? ` · ${subsArray.length} segmento(s)` : ''
      } · speech_aligned: false (sem alinhamento por palavra)`,
    });

    if (scenesArray) {
      summary.push({
        label: 'Cenas medidas',
        value: `${scenesArray.length} cena(s) contígua(s) (original_local)`,
      });
    }

    if (assetsArray) {
      const unverifiedCount = assetsArray.filter(
        a => isRecord(a) && readString(a.license) === 'unverified'
      ).length;
      const originalCount = assetsArray.filter(
        a => isRecord(a) && readString(a.license) === 'original'
      ).length;
      summary.push({
        label: 'Licenças dos assets',
        value: `${originalCount} original · ${unverifiedCount} unverified (${describeVoiceAssets(assetsArray)} não comprova publicabilidade)`,
      });
    }

    if (videoObj) {
      const dims =
        videoObj.width && videoObj.height
          ? `${String(videoObj.width)}×${String(videoObj.height)}`
          : null;
      const frames = videoObj.frames ? `${String(videoObj.frames)} frames` : null;
      const dur =
        typeof videoObj.duration_seconds === 'number'
          ? `${videoObj.duration_seconds.toFixed(2)}s`
          : null;
      summary.push({
        label: 'Vídeo do piloto',
        value: [dims, frames, dur].filter(Boolean).join(' · ') || 'Registrado',
      });
    }

    if (isRecord(quality) && Array.isArray(quality.checks)) {
      const checks = quality.checks.filter(isRecord);
      const passCount = checks.filter(c => c.status === 'pass').length;
      const failCount = checks.filter(c => c.status === 'fail').length;
      const notCheckedCount = checks.filter(c => c.status === 'not_checked').length;
      summary.push({
        label: 'Relatório de qualidade',
        value: `${passCount} pass, ${failCount} fail, ${notCheckedCount} not_checked · publishable: false`,
      });
    } else if (isRecord(quality)) {
      const qStatus = readString(quality.status) ?? (quality.passed === true ? 'passed' : 'unverified');
      const qSummary = readString(quality.summary);
      summary.push({
        label: 'Relatório de qualidade',
        value:
          qStatus && !/^(unavailable|unverified|pending)$/i.test(qStatus)
            ? `${qStatus}${qSummary ? ` — ${qSummary}` : ''}`
            : 'Não verificado (indisponível)',
      });
    } else {
      summary.push({
        label: 'Relatório de qualidade',
        value: 'Não verificado (indisponível)',
      });
    }
    return summary;
  }

  if (lower.endsWith('word-timings.json')) {
    const source = readString(data.source) ?? 'não informado';
    const dur =
      typeof data.duration_seconds === 'number' ? `${data.duration_seconds.toFixed(2)}s` : '—';
    const wordsCount = Array.isArray(data.words) ? data.words.length : 0;
    const engineObj = isRecord(data.engine) ? data.engine : null;
    summary.push({
      label: 'Fonte dos tempos',
      value:
        source === 'estimated'
          ? 'estimated (heurística · speech_aligned: false)'
          : `${source} (${readString(engineObj?.name) ?? 'motor'})`,
    });
    summary.push({ label: 'Duração da narração', value: dur });
    summary.push({ label: 'Palavras registradas', value: `${wordsCount} palavra(s)` });
    return summary;
  }

  if (lower.endsWith('quality-report.json')) {
    const status = readString(data.status) ?? 'not_run';
    const checksCount = Array.isArray(data.checks) ? data.checks.length : 0;
    const toolObj = isRecord(data.tool) ? data.tool : null;
    summary.push({ label: 'Status do QC', value: status });
    summary.push({ label: 'Checks avaliados', value: `${checksCount} check(s)` });
    if (toolObj) {
      summary.push({
        label: 'Ferramenta QC',
        value: `${readString(toolObj.name) ?? 'qc'} v${readString(toolObj.version) ?? '1'}`,
      });
    }
    return summary;
  }

  if (lower.endsWith('asset-provenance.json')) {
    const assets = Array.isArray(data.assets) ? data.assets.filter(isRecord) : [];
    const verified = assets.filter(a => readString(a.status) === 'verified').length;
    const unverified = assets.filter(a => readString(a.status) !== 'verified').length;
    summary.push({
      label: 'Assets registrados',
      value: `${assets.length} (${verified} verified · ${unverified} unverified/rejected)`,
    });
    return summary;
  }

  if (lower.endsWith('validation.json')) {
    const stream = isRecord(data.stream) ? data.stream : null;
    if (stream) {
      const dims =
        stream.width && stream.height ? `${String(stream.width)}×${String(stream.height)}` : null;
      const frames = stream.nb_read_frames ? `${String(stream.nb_read_frames)} frames` : null;
      const dur = stream.duration ? `${String(stream.duration)}s` : null;
      if (dims) summary.push({ label: 'Resolução', value: dims });
      if (frames) summary.push({ label: 'Frames decodificados', value: frames });
      if (dur) summary.push({ label: 'Duração do stream', value: dur });
    }
    const sha = readString(data.sha256);
    if (sha) summary.push({ label: 'SHA-256 validado', value: sha });
    return summary;
  }

  if (lower.endsWith('alinhamento.json')) {
    const motor = readString(data.motor);
    const dur = typeof data.duracao_audio === 'number' ? `${data.duracao_audio}s` : null;
    const words = Array.isArray(data.palavras) ? data.palavras.length : null;
    const lines = Array.isArray(data.linhas) ? data.linhas.length : null;
    if (motor) summary.push({ label: 'Motor de tempo', value: motor });
    if (dur) summary.push({ label: 'Duração de áudio', value: dur });
    if (lines !== null) summary.push({ label: 'Segmentos de linha', value: String(lines) });
    summary.push({
      label: 'Palavras alinhadas',
      value:
        words === 0 || words === null
          ? '0 (alinhamento palavra a palavra não verificado)'
          : `${words} (alinhamento técnico local)`,
    });
    return summary;
  }

  return summary;
}

export function sortProductionsDesc(items: ProductionRecord[]): ProductionRecord[] {
  return [...items].map(adaptProductionRecord).sort((a, b) => {
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
  const record = await api<ProductionRecord>(
    connection,
    `/v1/productions/${encodeURIComponent(productionId)}`,
    { signal }
  );
  return adaptProductionRecord(record);
}

export async function createScriptProduction(
  connection: Connection,
  scriptId: string,
  payload: CreateProductionPayload,
  idempotencyKey: string = crypto.randomUUID(),
  signal?: AbortSignal
): Promise<ProductionRecord> {
  const record = await api<ProductionRecord>(
    connection,
    `/v1/scripts/${encodeURIComponent(scriptId)}/productions`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        expected_version: payload.expected_version,
        mode: payload.mode,
        ...(payload.narration ? { narration: payload.narration } : {}),
        ...(payload.render_quality ? { render_quality: payload.render_quality } : {}),
      }),
      signal,
    }
  );
  return adaptProductionRecord(record);
}

export async function reviewProduction(
  connection: Connection,
  productionId: string,
  payload: ReviewProductionPayload,
  idempotencyKey: string = crypto.randomUUID(),
  signal?: AbortSignal
): Promise<ProductionRecord> {
  const bodyPayload: Record<string, unknown> = {
    decision: payload.decision,
    artifact_sha256: payload.artifact_sha256,
  };
  if (payload.notes && payload.notes.length > 0) {
    bodyPayload.notes = payload.notes.map(note => ({
      at_seconds: Math.round(Number(note.at_seconds) * 1000) / 1000,
      text: note.text.trim(),
    }));
  }
  if (payload.acknowledge_quality_errors === true) {
    bodyPayload.acknowledge_quality_errors = true;
  }
  const record = await api<ProductionRecord>(
    connection,
    `/v1/productions/${encodeURIComponent(productionId)}/review`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(bodyPayload),
      signal,
    }
  );
  return adaptProductionRecord(record);
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

function assertLoopbackArtifactUrl(baseUrl: string, productionId: string, artifactId: string): string {
  if (
    !productionId ||
    !artifactId ||
    /[/:\\]|\.\./.test(productionId) ||
    /[/:\\]|\.\./.test(artifactId)
  ) {
    throw new Error('Identificador de produção ou artefato inválido.');
  }
  const parsedBase = new URL(baseUrl);
  const host = parsedBase.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error('Busca de artefato recusada: apenas loopback local é permitido.');
  }
  const target = new URL(
    `/v1/productions/${encodeURIComponent(productionId)}/artifacts/${encodeURIComponent(artifactId)}`,
    parsedBase.origin
  );
  if (target.origin !== parsedBase.origin) {
    throw new Error('Busca externa de artefato não permitida.');
  }
  return target.toString();
}

export async function fetchProductionArtifactBlob(
  connection: Connection,
  productionId: string,
  artifactId: string,
  signal?: AbortSignal
): Promise<{ blob: Blob; contentType: string }> {
  const safeUrl = assertLoopbackArtifactUrl(connection.baseUrl, productionId, artifactId);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, 30000);
  try {
    const response = await fetch(safeUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${connection.token}`,
      },
    });
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
