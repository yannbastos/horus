import { api, ApiError } from './api';
import type { Connection, JobStatus } from './api';

export type ProductionMode = 'simulated' | 'local_demo' | 'local_pilot';

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

export type PilotQualityCheckItem = {
  id: string;
  status: 'pass' | 'fail' | 'not_checked' | string;
  detail?: string;
};

export type ProductionQualityReport = {
  schema_version?: number;
  status?: string | null;
  passed?: boolean | null;
  valid?: boolean | null;
  summary?: string | null;
  checks?: PilotQualityCheckItem[] | Record<string, unknown> | null;
  blocking_errors?: string[] | null;
  warnings?: string[] | null;
  issues?: string[] | null;
  publishable?: boolean | null;
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
  // Campos confirmados do contrato local_pilot (derivados do resultado validado, nunca do modo solicitado)
  narration_kind?: 'fixture_tone' | 'local_tts' | string | null;
  narration_disclosure?: string | null;
  alignment_method?: 'measured_sections' | string | null;
  publishable?: boolean | null;
  // Campos opcionais defensivos adicionais para proveniência e QC (Sonnet schema v1)
  audio_kind?: string | null;
  voice_kind?: string | null;
  tts_engine?: string | null;
  synthetic_tts?: boolean | null;
  local_tts?: boolean | null;
  subtitles_kind?: string | null;
  scenes_kind?: string | null;
  visual_origin?: string | null;
  quality_report?: ProductionQualityReport | Record<string, unknown> | null;
  quality_status?: string | null;
  pilot_evidence?: Record<string, unknown> | null;
  provenance?: Record<string, unknown> | null;
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
  text: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readSha256(value: unknown): string | null {
  const s = readString(value);
  return s && /^[a-f0-9]{64}$/i.test(s) ? s.toLowerCase() : null;
}

export function adaptProductionRecord(raw: ProductionRecord): ProductionRecord {
  const artifacts = Array.isArray(raw.artifacts) ? raw.artifacts : [];
  return {
    ...raw,
    artifacts,
    review: raw.review ?? null,
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

  // 1. Narração: diferenciar fixture_tone vs local_tts (TTS local sintético) vs não verificado.
  // Nunca derivar verdade apenas de record.mode, da ordem dos artefatos ou do nome do arquivo.
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

  // Resolução do artefato de narração completa:
  // Seleciona exclusivamente pelo SHA-256 confirmado em pilot-evidence.json (narration.sha256)
  // e sua correspondência exata em record.artifacts (kind === 'audio'), sem confiar em ordem/nome/modo.
  const matchedNarrationBySha256 =
    narrationSha256 !== null
      ? audioArtifacts.find(a => a.sha256.toLowerCase() === narrationSha256) ?? null
      : null;

  // Compatibilidade simulated/local_demo (single audio de tom de fixture quando não há pilot-evidence.json)
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

  // 2. Legendas e alinhamento: diferenciar SRT sintético, legenda segmentada (measured_sections) e alinhamento não verificado.
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
    subtitleLabel = 'Não verificado para publicação (demonstrativo)';
    alignmentLabel = 'Não verificado para publicação (demonstrativo)';
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

  // 3. Cenas demonstrativas vs não verificado
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

  // 4. Licenças de assets no manifesto pilot-evidence.json
  const unverifiedAssets = evAssets.filter(
    item => isRecord(item) && readString(item.license) === 'unverified'
  );
  const originalAssets = evAssets.filter(
    item => isRecord(item) && readString(item.license) === 'original'
  );
  const licenseSummary =
    evAssets.length > 0
      ? `${originalAssets.length} asset(s) original_local (license: original) · ${unverifiedAssets.length} asset(s) system_voice (license: unverified — voz SAPI não comprova licença comercial nem publicabilidade)`
      : 'Não publicável (publishable: false · licença de voz/publicação não verificada)';

  // 5. Relatório de qualidade (Sonnet QC schema v1: checks pass/fail/not_checked, blocking_errors, warnings, publishable=false)
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
    const notCheckedItems = checks.filter(c => c.status === 'not_checked');
    const notCheckedCount = notCheckedItems.length;
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

    if (failCount > 0 || blockingErrors.length > 0) {
      qualityStatus = 'failed';
      qualitySummary = blockingErrors[0] ?? `${failCount} verificação(ões) reprovada(s)`;
      qualityLabel = `QC com falhas (${failCount} fail, ${passCount} pass, ${notCheckedCount} not_checked) · ${blockingErrors.length} erro(s) bloqueante(s) · publishable: false`;
    } else if (notCheckedCount > 0) {
      // Nunca apresentar todos os checks como aprovados quando há itens not_checked (ex.: acústica, alinhamento por palavra, loudness, licença)
      qualityStatus = 'partial_not_checked';
      qualitySummary = `Itens não medidos/verificados: ${notCheckedIds.join(', ')}`;
      qualityLabel = `QC parcial (${passCount} pass, 0 fail, ${notCheckedCount} not_checked: ${notCheckedIds.join(
        ', '
      )}) · ${warnings.length} aviso(s) · publishable: false (não equivale a aprovação total)`;
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
      (rawQualityStatus !== null && /^(failed|rejected|invalid|error)$/i.test(rawQualityStatus))
    ) {
      qualityStatus = 'failed';
      qualityLabel = qualitySummary
        ? `Pendências no relatório de qualidade: ${qualitySummary}`
        : 'Relatório de qualidade apontou pendências técnicas';
    } else if (
      rawQualityPassed === true ||
      (rawQualityStatus !== null &&
        /^(passed|approved|valid|ok|succeeded|verified)$/i.test(rawQualityStatus))
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
    segments.push({
      index,
      start: (startRaw ?? '').trim(),
      end: (endRaw ?? '').trim(),
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
        value: `${originalCount} original · ${unverifiedCount} unverified (voz SAPI não comprova publicabilidade)`,
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
  const record = await api<ProductionRecord>(
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
