import { useEffect, useRef, useState } from 'react';
import { observeJob, terminalStatuses } from '../services/api';
import type { Connection, JobEvent, JobStatus } from '../services/api';
import type { ScriptRecord } from '../services/scripts';
import type {
  ProductionArtifact,
  ProductionArtifactKind,
  ProductionMode,
  ProductionNarrationSelection,
  ProductionRecord,
  ProductionReviewDecision,
  ProductionReviewNote,
  ProductionStage,
  RenderQuality,
  SrtSegment,
} from '../services/production';
import {
  cancelProductionJob,
  createScriptProduction,
  deriveProductionProvenance,
  doesProductionRequireQualityAcknowledgement,
  extractSceneNavItems,
  extractSubtitleNavItems,
  fetchProductionArtifactBlob,
  formatProductionError,
  formatTimecode,
  getProduction,
  getScriptProductions,
  normalizeAssetProvenance,
  normalizeQualityReport,
  normalizeWordTimings,
  parsePilotEvidencePayload,
  parseSrtSegments,
  reviewProduction,
  sortProductionsDesc,
  summarizeJsonArtifact,
} from '../services/production';
import AssetProvenancePanel from './production/AssetProvenancePanel';
import ProductionLaunchOptions from './production/ProductionLaunchOptions';
import ProductionGlossary, { termTitle } from './production/ProductionGlossary';
import ProductionProgress, { describeJobEvent, suggestFailureAction } from './production/ProductionProgress';
import QualityReportPanel from './production/QualityReportPanel';
import TimecodeReviewWorkspace from './production/TimecodeReviewWorkspace';

const PRODUCTION_STAGES: ProductionStage[] = [
  'prepare',
  'narration',
  'scenes',
  'subtitles',
  'render',
  'quality',
  'review',
];

const STAGE_LABELS: Record<ProductionStage, string> = {
  prepare: 'Preparação',
  narration: 'Narração',
  scenes: 'Cenas',
  align: 'Alinhando fala',
  subtitles: 'Legendas',
  render: 'Render',
  quality: 'Qualidade (QC)',
  review: 'Revisão',
};

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Na fila',
  running: 'Em execução',
  cancel_requested: 'Cancelamento solicitado',
  succeeded: 'Execução técnica concluída',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  interrupted: 'Interrompido',
  blocked: 'Bloqueado',
};

const STATUS_TONE: Record<JobStatus, string> = {
  queued: '',
  running: 'warn',
  cancel_requested: 'warn',
  succeeded: 'good',
  failed: 'bad',
  cancelled: '',
  interrupted: 'warn',
  blocked: 'bad',
};

const MODE_LABELS: Record<ProductionMode, string> = {
  simulated: 'SIMULADO (FIXTURE)',
  local_demo: 'DEMO LOCAL (FÁBRICA OFFLINE)',
  local_pilot: 'PILOTO LOCAL COM NARRAÇÃO',
};

const ARTIFACT_KIND_LABELS: Record<ProductionArtifactKind, string> = {
  plan: 'PLANO',
  scene: 'CENA',
  audio: 'ÁUDIO',
  subtitles: 'LEGENDAS',
  video: 'VÍDEO',
  manifest: 'MANIFESTO',
};

const REVIEW_DECISION_LABELS: Record<ProductionReviewDecision, string> = {
  approve: 'Aprovado na revisão final',
  reject: 'Rejeitado na revisão final',
};

const LAUNCH_PREFS_KEY = 'horus.production.launchPrefs';

// Preferência local de UI (modo e qualidade); falha de armazenamento nunca impede a tela.
function readLaunchPrefs(): { mode: ProductionMode; quality: RenderQuality } {
  const defaults = { mode: 'simulated' as ProductionMode, quality: 'draft' as RenderQuality };
  try {
    const raw = JSON.parse(window.localStorage.getItem(LAUNCH_PREFS_KEY) ?? 'null');
    const modes: ProductionMode[] = ['simulated', 'local_demo', 'local_pilot'];
    return {
      mode: modes.includes(raw?.mode) ? raw.mode : defaults.mode,
      quality: raw?.quality === 'final' ? 'final' : defaults.quality,
    };
  } catch {
    return defaults;
  }
}

function writeLaunchPrefs(prefs: { mode: ProductionMode; quality: RenderQuality }) {
  try {
    window.localStorage.setItem(LAUNCH_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* armazenamento indisponível: a escolha vale apenas nesta sessão */
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    return isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function describeDemoOnlyFlag(value: boolean | undefined): string {
  if (value === true) return 'Somente demonstração / teste (publishable: false)';
  return 'Não verificado para publicação (demo / teste)';
}

export default function ProductionRun({
  connection,
  latestScript,
}: {
  connection: Connection | null;
  latestScript: ScriptRecord | null;
}) {
  const [productions, setProductions] = useState<ProductionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [initialPrefs] = useState(readLaunchPrefs);
  const [mode, setModeState] = useState<ProductionMode>(initialPrefs.mode);
  const [renderQuality, setRenderQualityState] = useState<RenderQuality>(initialPrefs.quality);
  const setMode = (next: ProductionMode) => {
    setModeState(next);
    writeLaunchPrefs({ mode: next, quality: renderQuality });
  };
  const setRenderQuality = (next: RenderQuality) => {
    setRenderQualityState(next);
    writeLaunchPrefs({ mode, quality: next });
  };
  const [voice, setVoice] = useState<ProductionNarrationSelection | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [jobEvents, setJobEvents] = useState<JobEvent[]>([]);
  const [jobError, setJobError] = useState('');
  const [trackingError, setTrackingError] = useState('');
  const [reconciled, setReconciled] = useState(false);

  // Pilot evidence & contract artifacts state
  const [pilotEvidenceData, setPilotEvidenceData] = useState<Record<string, unknown> | null>(null);
  const [pilotEvidenceError, setPilotEvidenceError] = useState('');
  const [pilotEvidenceReloadCount, setPilotEvidenceReloadCount] = useState(0);
  const [wordTimingsData, setWordTimingsData] = useState<Record<string, unknown> | null>(null);
  const [qualityArtifactData, setQualityArtifactData] = useState<Record<string, unknown> | null>(
    null
  );
  const [effectiveProvenance, setEffectiveProvenance] = useState<Record<string, unknown> | null>(null);
  const [assetProvenanceData, setAssetProvenanceData] =useState<Record<string, unknown> | null>(
    null
  );

  // Timecode review & navigation state
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [reviewNotes, setReviewNotes] = useState<ProductionReviewNote[]>([]);
  const [approvalConfirmationChecked, setApprovalConfirmationChecked] = useState(false);

  // Preview state (authenticated blob URL or text content)
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewTarget, setPreviewTarget] = useState<{
    artifact: ProductionArtifact;
    kind: 'video' | 'audio' | 'image' | 'text';
    blobUrl?: string;
    text?: string;
    srtSegments?: SrtSegment[];
    jsonSummary?: Array<{ label: string; value: string }>;
  } | null>(null);

  const inFlightRef = useRef(false);
  const idempotencyCacheRef = useRef<{ signature: string; key: string } | null>(null);
  const mountedScriptIdRef = useRef<string | null>(latestScript?.id ?? null);
  const inspectControllerRef = useRef<AbortController | null>(null);
  const inspectRequestIdRef = useRef(0);
  const previewControllerRef = useRef<AbortController | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);
  const logsRef = useRef<HTMLPreElement>(null);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const revealPreviewRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekSecondsRef = useRef<number | null>(null);

  function revokeActiveBlobUrl() {
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
  }

  function clearPreview() {
    previewControllerRef.current?.abort();
    previewControllerRef.current = null;
    revokeActiveBlobUrl();
    setPreviewTarget(null);
    setPreviewError('');
    setPreviewLoading(false);
  }

  function cancelPendingInspect() {
    inspectControllerRef.current?.abort();
    inspectControllerRef.current = null;
    inspectRequestIdRef.current += 1;
  }

  function getOrCreateIdempotencyKey(signature: string): string {
    if (idempotencyCacheRef.current?.signature === signature) {
      return idempotencyCacheRef.current.key;
    }
    const key = crypto.randomUUID();
    idempotencyCacheRef.current = { signature, key };
    return key;
  }

  function clearIdempotencyKey(signature: string) {
    if (idempotencyCacheRef.current?.signature === signature) {
      idempotencyCacheRef.current = null;
    }
  }

  function upsertProductionRecord(record: ProductionRecord, select = true) {
    setProductions(prev => {
      const filtered = prev.filter(item => item.id !== record.id);
      return sortProductionsDesc([record, ...filtered]);
    });
    if (select) {
      setSelectedId(record.id);
    }
  }

  useEffect(() => {
    return () => {
      cancelPendingInspect();
      previewControllerRef.current?.abort();
      revokeActiveBlobUrl();
    };
  }, []);

  useEffect(() => {
    mountedScriptIdRef.current = latestScript?.id ?? null;
    cancelPendingInspect();
    clearPreview();
    setProductions([]);
    setSelectedId(null);
    setError('');
    setJobEvents([]);
    setJobError('');
    setPilotEvidenceData(null);
    setPilotEvidenceError('');
    setWordTimingsData(null);
    setQualityArtifactData(null);
    setAssetProvenanceData(null);
    setCurrentTimeSeconds(0);
    setReviewNotes([]);
    setApprovalConfirmationChecked(false);
    idempotencyCacheRef.current = null;
  }, [latestScript?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isLatestScriptApproved = latestScript?.status === 'approved';

  useEffect(() => {
    const conn = connection;
    const scriptId = latestScript?.id;
    if (!conn || !scriptId || latestScript?.status !== 'approved') {
      setLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');

    void getScriptProductions(conn, scriptId, controller.signal)
      .then(items => {
        if (!active) return;
        setProductions(items);
        setSelectedId(prev => {
          if (prev && items.some(i => i.id === prev)) {
            return prev;
          }
          return items[0]?.id ?? null;
        });
      })
      .catch(reason => {
        if (!active || controller.signal.aborted) return;
        setError(formatProductionError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [connection, latestScript?.id, latestScript?.version, latestScript?.status]);

  const activeProduction =
    productions.find(item => item.id === selectedId) ?? productions[0] ?? null;

  // Clear preview and per-production review state if user switches selected production
  useEffect(() => {
    clearPreview();
    setTrackingError('');
    setReconciled(false);
    setPilotEvidenceData(null);
    setPilotEvidenceError('');
    setWordTimingsData(null);
    setQualityArtifactData(null);
    setAssetProvenanceData(null);
    setCurrentTimeSeconds(0);
    setReviewNotes([]);
    setApprovalConfirmationChecked(false);
  }, [activeProduction?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pilotEvidenceArtifact =
    activeProduction?.artifacts.find(
      a =>
        a.kind === 'manifest' &&
        (a.relative_path === 'pilot-evidence.json' ||
          a.relative_path.endsWith('/pilot-evidence.json'))
    ) ?? null;

  const wordTimingsArtifact =
    activeProduction?.artifacts.find(
      a =>
        a.relative_path === 'word-timings.json' ||
        a.relative_path.endsWith('/word-timings.json')
    ) ?? null;

  const qualityReportArtifact =
    activeProduction?.artifacts.find(
      a =>
        a.relative_path === 'quality-report.json' ||
        a.relative_path.endsWith('/quality-report.json')
    ) ?? null;

  const assetProvenanceArtifact =
    activeProduction?.artifacts.find(
      a =>
        a.relative_path === 'asset-provenance.json' ||
        a.relative_path.endsWith('/asset-provenance.json')
    ) ?? null;

  // Automatically fetch pilot-evidence.json when registered in activeProduction.artifacts
  useEffect(() => {
    const conn = connection;
    const prod = activeProduction;
    const artifact = pilotEvidenceArtifact;
    if (!conn || !prod || !artifact) {
      setPilotEvidenceData(null);
      setPilotEvidenceError('');
      return;
    }

    let active = true;
    const controller = new AbortController();
    const targetScriptId = prod.script_id;
    const targetProductionId = prod.id;

    void fetchProductionArtifactBlob(conn, targetProductionId, artifact.id, controller.signal)
      .then(async ({ blob }) => {
        const rawText = await blob.text();
        if (!active || controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) {
          return;
        }
        const parsed = parsePilotEvidencePayload(rawText);
        if (parsed === null) {
          setPilotEvidenceData(null);
          setPilotEvidenceError('Manifesto pilot-evidence.json inválido ou malformado.');
          return;
        }
        setPilotEvidenceData(parsed);
        setPilotEvidenceError('');
      })
      .catch(reason => {
        if (!active || controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) {
          return;
        }
        setPilotEvidenceError(formatProductionError(reason));
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    connection,
    activeProduction?.id,
    activeProduction?.script_id,
    pilotEvidenceArtifact?.id,
    pilotEvidenceArtifact?.sha256,
    pilotEvidenceReloadCount,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Automatically fetch word-timings.json when registered in activeProduction.artifacts
  useEffect(() => {
    const conn = connection;
    const prod = activeProduction;
    const artifact = wordTimingsArtifact;
    if (!conn || !prod || !artifact || prod.word_timings) {
      setWordTimingsData(null);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const targetScriptId = prod.script_id;

    void fetchProductionArtifactBlob(conn, prod.id, artifact.id, controller.signal)
      .then(async ({ blob }) => {
        const rawText = await blob.text();
        if (!active || controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) {
          return;
        }
        const parsed = parsePilotEvidencePayload(rawText);
        setWordTimingsData(parsed);
      })
      .catch(() => {
        if (!active || controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) {
          return;
        }
        setWordTimingsData(null);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    connection,
    activeProduction?.id,
    activeProduction?.script_id,
    activeProduction?.word_timings,
    wordTimingsArtifact?.id,
    wordTimingsArtifact?.sha256,
    pilotEvidenceReloadCount,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Automatically fetch quality-report.json if not already embedded on activeProduction.quality_report
  useEffect(() => {
    const conn = connection;
    const prod = activeProduction;
    const artifact = qualityReportArtifact;
    if (!conn || !prod || !artifact || prod.quality_report) {
      setQualityArtifactData(null);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const targetScriptId = prod.script_id;

    void fetchProductionArtifactBlob(conn, prod.id, artifact.id, controller.signal)
      .then(async ({ blob }) => {
        const rawText = await blob.text();
        if (!active || controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) {
          return;
        }
        const parsed = parsePilotEvidencePayload(rawText);
        setQualityArtifactData(parsed);
      })
      .catch(() => {
        if (!active || controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) {
          return;
        }
        setQualityArtifactData(null);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    connection,
    activeProduction?.id,
    activeProduction?.script_id,
    activeProduction?.quality_report,
    qualityReportArtifact?.id,
    qualityReportArtifact?.sha256,
    pilotEvidenceReloadCount,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Automatically fetch asset-provenance.json if not already embedded on activeProduction.asset_provenance
  useEffect(() => {
    const conn = connection;
    const prod = activeProduction;
    const artifact = assetProvenanceArtifact;
    if (!conn || !prod || !artifact || prod.asset_provenance) {
      setAssetProvenanceData(null);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const targetScriptId = prod.script_id;

    void fetchProductionArtifactBlob(conn, prod.id, artifact.id, controller.signal)
      .then(async ({ blob }) => {
        const rawText = await blob.text();
        if (!active || controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) {
          return;
        }
        const parsed = parsePilotEvidencePayload(rawText);
        setAssetProvenanceData(parsed);
      })
      .catch(() => {
        if (!active || controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) {
          return;
        }
        setAssetProvenanceData(null);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    connection,
    activeProduction?.id,
    activeProduction?.script_id,
    activeProduction?.asset_provenance,
    assetProvenanceArtifact?.id,
    assetProvenanceArtifact?.sha256,
    pilotEvidenceReloadCount,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // J-11: depois de pedir uma prévia, leva a vista até ela (e o foco, sem nova rolagem).
  useEffect(() => {
    if (!previewTarget || !revealPreviewRef.current) return;
    revealPreviewRef.current = false;
    const panel = previewPanelRef.current;
    if (!panel) return;
    panel.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    panel.focus({ preventScroll: true });
  }, [previewTarget]);

  // Auto-scroll job logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [jobEvents]);

  // Observe real job events when a production is selected
  useEffect(() => {
    const conn = connection;
    const prod = activeProduction;
    if (!conn || !prod?.job_id) {
      setJobEvents([]);
      setJobError('');
      return;
    }

    const controller = new AbortController();
    const targetScriptId = prod.script_id;
    setJobEvents([]);
    setJobError('');

    void observeJob(conn, prod.job_id, controller.signal, event => {
      if (controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) return;
      if (event.kind === 'complete') return;
      setJobEvents(prev => [...prev, event].slice(-500));
    }).catch(reason => {
      if (!controller.signal.aborted && mountedScriptIdRef.current === targetScriptId) {
        if (!terminalStatuses.includes(prod.status)) {
          setJobError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    });

    return () => {
      controller.abort();
    };
  }, [connection, activeProduction?.id, activeProduction?.job_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling production status while non-terminal so stage and artifacts stay synchronized with JobManager
  useEffect(() => {
    const conn = connection;
    const prod = activeProduction;
    if (!conn || !prod || terminalStatuses.includes(prod.status)) {
      return;
    }

    let active = true;
    const targetProductionId = prod.id;
    const targetScriptId = prod.script_id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const fresh = await getProduction(conn!, targetProductionId, controller.signal);
        if (!active || mountedScriptIdRef.current !== targetScriptId) return;
        setTrackingError('');
        upsertProductionRecord(fresh, false);
      } catch (reason) {
        if (!active || controller.signal.aborted) return;
        setTrackingError(formatProductionError(reason));
      } finally {
        if (active) timer = window.setTimeout(() => void refresh(), 1200);
      }
    }
    timer = window.setTimeout(() => void refresh(), 1200);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [connection, activeProduction?.id, activeProduction?.status, activeProduction?.script_id]);

  const hasActiveRun = productions.some(item => !terminalStatuses.includes(item.status));
  const canStartProduction =
    Boolean(connection) &&
    Boolean(latestScript) &&
    isLatestScriptApproved &&
    !hasActiveRun &&
    (!activeProduction ||
      !['failed', 'interrupted', 'blocked', 'cancelled'].includes(activeProduction.status) ||
      reconciled) &&
    !loading &&
    !submitting;

  async function handleRefreshProductions() {
    if (!connection || !latestScript || inFlightRef.current || submitting) return;
    cancelPendingInspect();
    const targetScriptId = latestScript.id;
    setLoading(true);
    setError('');
    try {
      const items = await getScriptProductions(connection, targetScriptId);
      if (mountedScriptIdRef.current !== targetScriptId) return;
      setProductions(items);
      setTrackingError('');
      setPilotEvidenceReloadCount(c => c + 1);
      setSelectedId(prev => {
        if (prev && items.some(i => i.id === prev)) {
          return prev;
        }
        return items[0]?.id ?? null;
      });
    } catch (reason) {
      if (mountedScriptIdRef.current !== targetScriptId) return;
      setError(formatProductionError(reason));
    } finally {
      if (mountedScriptIdRef.current === targetScriptId) {
        setLoading(false);
      }
    }
  }

  async function handleInspectProduction(item: ProductionRecord) {
    inspectControllerRef.current?.abort();
    const controller = new AbortController();
    inspectControllerRef.current = controller;
    const requestId = ++inspectRequestIdRef.current;
    const targetScriptId = item.script_id;
    const intendedId = item.id;

    setSelectedId(intendedId);
    setError('');

    if (!connection) return;
    try {
      const fresh = await getProduction(connection, intendedId, controller.signal);
      if (
        controller.signal.aborted ||
        inspectRequestIdRef.current !== requestId ||
        mountedScriptIdRef.current !== targetScriptId
      ) {
        return;
      }
      upsertProductionRecord(fresh, true);
      setTrackingError('');
      setPilotEvidenceReloadCount(c => c + 1);
    } catch (reason) {
      if (
        controller.signal.aborted ||
        inspectRequestIdRef.current !== requestId ||
        mountedScriptIdRef.current !== targetScriptId
      ) {
        return;
      }
      setError(formatProductionError(reason));
    }
  }

  async function handleStartProduction() {
    if (!connection || !latestScript || !isLatestScriptApproved) return;
    if (inFlightRef.current || submitting) return;

    cancelPendingInspect();
    const targetScriptId = latestScript.id;
    const pilotOptions =
      mode === 'local_pilot'
        ? { render_quality: renderQuality, ...(voice ? { narration: voice } : {}) }
        : {};
    const signature = `create:${targetScriptId}:${latestScript.version}:${mode}:${productions.length}:${JSON.stringify(pilotOptions)}`;
    const idempotencyKey = getOrCreateIdempotencyKey(signature);

    inFlightRef.current = true;
    setSubmitting(true);
    setError('');

    try {
      const created = await createScriptProduction(
        connection,
        targetScriptId,
        {
          expected_version: latestScript.version,
          mode,
          ...pilotOptions,
        },
        idempotencyKey
      );
      clearIdempotencyKey(signature);
      if (mountedScriptIdRef.current !== targetScriptId) return;
      upsertProductionRecord(created, true);
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'status' in reason) {
        clearIdempotencyKey(signature);
      }
      if (mountedScriptIdRef.current !== targetScriptId) return;
      setError(formatProductionError(reason));
    } finally {
      inFlightRef.current = false;
      if (mountedScriptIdRef.current === targetScriptId) {
        setSubmitting(false);
      }
    }
  }

  async function handleCancelJob() {
    if (!connection || !activeProduction || inFlightRef.current || submitting) return;
    const targetScriptId = activeProduction.script_id;
    const targetProductionId = activeProduction.id;
    const targetJobId = activeProduction.job_id;

    inFlightRef.current = true;
    setSubmitting(true);
    setError('');

    try {
      await cancelProductionJob(connection, targetJobId);
      const fresh = await getProduction(connection, targetProductionId);
      if (mountedScriptIdRef.current !== targetScriptId) return;
      upsertProductionRecord(fresh, true);
    } catch (reason) {
      if (mountedScriptIdRef.current !== targetScriptId) return;
      setError(formatProductionError(reason));
    } finally {
      inFlightRef.current = false;
      if (mountedScriptIdRef.current === targetScriptId) {
        setSubmitting(false);
      }
    }
  }

  async function handlePreviewArtifact(artifact: ProductionArtifact) {
    if (!connection || !activeProduction) return;
    revealPreviewRef.current = true;
    previewControllerRef.current?.abort();
    const controller = new AbortController();
    previewControllerRef.current = controller;
    const targetScriptId = activeProduction.script_id;
    const targetProductionId = activeProduction.id;

    setPreviewLoading(true);
    setPreviewError('');

    try {
      const { blob } = await fetchProductionArtifactBlob(
        connection,
        targetProductionId,
        artifact.id,
        controller.signal
      );
      if (controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) return;

      revokeActiveBlobUrl();

      if (artifact.kind === 'video') {
        const blobUrl = URL.createObjectURL(blob);
        activeBlobUrlRef.current = blobUrl;
        setPreviewTarget({ artifact, kind: 'video', blobUrl });
      } else if (artifact.kind === 'audio') {
        const blobUrl = URL.createObjectURL(blob);
        activeBlobUrlRef.current = blobUrl;
        setPreviewTarget({ artifact, kind: 'audio', blobUrl });
      } else if (
        artifact.kind === 'scene' &&
        artifact.relative_path.toLowerCase().endsWith('.png')
      ) {
        const blobUrl = URL.createObjectURL(blob);
        activeBlobUrlRef.current = blobUrl;
        setPreviewTarget({ artifact, kind: 'image', blobUrl });
      } else {
        const rawText = await blob.text();
        if (controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) return;
        let formattedText = rawText;
        let jsonSummary: Array<{ label: string; value: string }> | undefined;
        let srtSegments: SrtSegment[] | undefined;

        if (artifact.relative_path.endsWith('.json')) {
          try {
            const parsed: unknown = JSON.parse(rawText);
            formattedText = JSON.stringify(parsed, null, 2);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              const recordData = parsed as Record<string, unknown>;
              jsonSummary = summarizeJsonArtifact(artifact.relative_path, recordData);
              if (
                artifact.relative_path === 'pilot-evidence.json' ||
                artifact.relative_path.endsWith('/pilot-evidence.json')
              ) {
                setPilotEvidenceData(recordData);
                setPilotEvidenceError('');
              } else if (
                artifact.relative_path === 'word-timings.json' ||
                artifact.relative_path.endsWith('/word-timings.json')
              ) {
                setWordTimingsData(recordData);
              } else if (
                artifact.relative_path === 'quality-report.json' ||
                artifact.relative_path.endsWith('/quality-report.json')
              ) {
                setQualityArtifactData(recordData);
              } else if (
                artifact.relative_path === 'asset-provenance.json' ||
                artifact.relative_path.endsWith('/asset-provenance.json')
              ) {
                setAssetProvenanceData(recordData);
              }
            }
          } catch {
            formattedText = rawText;
          }
        } else if (
          artifact.kind === 'subtitles' ||
          artifact.relative_path.toLowerCase().endsWith('.srt')
        ) {
          srtSegments = parseSrtSegments(rawText);
        }

        setPreviewTarget({
          artifact,
          kind: 'text',
          text: formattedText,
          srtSegments,
          jsonSummary,
        });
      }
    } catch (reason) {
      if (controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) return;
      setPreviewError(formatProductionError(reason));
    } finally {
      if (!controller.signal.aborted && mountedScriptIdRef.current === targetScriptId) {
        setPreviewLoading(false);
      }
    }
  }

  function handleSeekTimecode(seconds: number) {
    const safeSeconds = Math.max(0, Math.round(seconds * 1000) / 1000);
    setCurrentTimeSeconds(safeSeconds);
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      if (!Number.isFinite(dur) || (dur > 0 && safeSeconds <= dur)) {
        try {
          videoRef.current.currentTime = safeSeconds;
        } catch {
          // Ignore browser media seek error on synthetic test buffers
        }
      }
      previewPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const vidArt = activeProduction?.artifacts.find(a => a.kind === 'video') ?? null;
    if (vidArt && previewTarget?.artifact.id !== vidArt.id && !previewLoading) {
      pendingSeekSecondsRef.current = safeSeconds;
      void handlePreviewArtifact(vidArt);
    }
  }

  function handleCaptureCurrentVideoTime(): number {
    if (
      videoRef.current &&
      Number.isFinite(videoRef.current.currentTime) &&
      videoRef.current.currentTime > 0 &&
      (!Number.isFinite(videoRef.current.duration) ||
        currentTimeSeconds <= videoRef.current.duration)
    ) {
      const t = Math.round(videoRef.current.currentTime * 1000) / 1000;
      setCurrentTimeSeconds(t);
      return t;
    }
    return currentTimeSeconds;
  }

  const provenance = activeProduction
    ? deriveProductionProvenance(activeProduction, pilotEvidenceData)
    : null;

  const normalizedQuality = activeProduction
    ? normalizeQualityReport(activeProduction, qualityArtifactData, pilotEvidenceData)
    : null;

  const normalizedAssetProvenance = activeProduction
    ? normalizeAssetProvenance(
        effectiveProvenance
          ? { ...activeProduction, asset_provenance: effectiveProvenance as ProductionRecord['asset_provenance'] }
          : activeProduction,
        assetProvenanceData,
        pilotEvidenceData
      )
    : null;

  const normalizedWordTimings = activeProduction
    ? normalizeWordTimings(
        activeProduction,
        wordTimingsData,
        pilotEvidenceData,
        latestScript?.document?.sections ?? null
      )
    : null;

  const hasQcFail = normalizedQuality?.overallStatus === 'fail';
  const hasQcNotRunInPilot =
    activeProduction?.mode === 'local_pilot' &&
    (!normalizedQuality?.executed || normalizedQuality?.overallStatus === 'not_run');
  const hasUnverifiedLicense = Boolean(normalizedAssetProvenance?.hasUnverifiedOrUnknown);
  const requiresQualityAcknowledgement =
    activeProduction && normalizedQuality && normalizedAssetProvenance
      ? doesProductionRequireQualityAcknowledgement(
          activeProduction,
          normalizedQuality,
          normalizedAssetProvenance
        )
      : false;
  const requiresApprovalConfirmation =
    requiresQualityAcknowledgement || hasQcFail || hasUnverifiedLicense;

  async function handleReviewProduction(
    decision: ProductionReviewDecision,
    videoArtifact: ProductionArtifact
  ) {
    if (!connection || !activeProduction || inFlightRef.current || submitting) return;

    const validNotes = reviewNotes.map(n => ({
      at_seconds: Math.round(Math.max(0, Number(n.at_seconds)) * 1000) / 1000,
      text: n.text.trim(),
    }));
    const hasInvalidNote = validNotes.some(
      n => !Number.isFinite(n.at_seconds) || n.at_seconds < 0 || n.text.length < 1 || n.text.length > 2000
    );
    if (hasInvalidNote || validNotes.length > 200) {
      setError(
        'Verifique as notas por timecode: cada nota deve ter at_seconds >= 0 e texto entre 1 e 2000 caracteres (máx. 200 notas).'
      );
      return;
    }

    const sendQualityAck =
      decision === 'approve' && requiresQualityAcknowledgement && approvalConfirmationChecked;

    const targetScriptId = activeProduction.script_id;
    const targetProductionId = activeProduction.id;
    const notesKeyPart = validNotes.length > 0 ? `:${JSON.stringify(validNotes)}` : '';
    const ackKeyPart = sendQualityAck ? ':ack_qc' : '';
    const signature = `review:${targetProductionId}:${videoArtifact.sha256}:${decision}${notesKeyPart}${ackKeyPart}`;
    const idempotencyKey = getOrCreateIdempotencyKey(signature);

    inFlightRef.current = true;
    setSubmitting(true);
    setError('');

    try {
      const reviewed = await reviewProduction(
        connection,
        targetProductionId,
        {
          decision,
          artifact_sha256: videoArtifact.sha256,
          notes: validNotes.length > 0 ? validNotes : undefined,
          acknowledge_quality_errors: sendQualityAck ? true : undefined,
        },
        idempotencyKey
      );
      clearIdempotencyKey(signature);
      if (mountedScriptIdRef.current !== targetScriptId) return;
      upsertProductionRecord(reviewed, true);
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'status' in reason) {
        clearIdempotencyKey(signature);
      }
      if (mountedScriptIdRef.current !== targetScriptId) return;
      setError(formatProductionError(reason));
    } finally {
      inFlightRef.current = false;
      if (mountedScriptIdRef.current === targetScriptId) {
        setSubmitting(false);
      }
    }
  }

  const sceneNavItems = extractSceneNavItems(pilotEvidenceData, null);
  const subtitleNavItems = extractSubtitleNavItems(
    pilotEvidenceData,
    previewTarget?.srtSegments ?? null
  );
  const qualityChecksWithTimecode =
    normalizedQuality?.checks.filter(c => c.timecode !== null) ?? [];

  const videoArtifact = activeProduction?.artifacts.find(a => a.kind === 'video') ?? null;
  const subtitlesArtifact = activeProduction?.artifacts.find(a => a.kind === 'subtitles') ?? null;
  const primaryAudioArtifact =
    provenance?.narrationAudioArtifact ?? provenance?.fixtureAudioArtifact ?? null;
  const planArtifact = activeProduction?.artifacts.find(a => a.kind === 'plan') ?? null;
  const validationArtifact =
    activeProduction?.artifacts.find(
      a => a.kind === 'manifest' && a.relative_path.endsWith('validation.json')
    ) ?? null;

  const isTerminal = activeProduction ? terminalStatuses.includes(activeProduction.status) : false;
  const canCancelJob =
    activeProduction &&
    !isTerminal &&
    activeProduction.status !== 'cancel_requested' &&
    !submitting;
  const needsReconciliation =
    activeProduction &&
    ['failed', 'interrupted', 'blocked', 'cancelled'].includes(activeProduction.status) &&
    !submitting;

  const canReviewFinal =
    Boolean(activeProduction) &&
    activeProduction?.status === 'succeeded' &&
    activeProduction?.mode !== 'simulated' &&
    Boolean(videoArtifact?.sha256) &&
    activeProduction?.review === null;

  const hasInvalidDraftNotes =
    reviewNotes.length > 200 ||
    reviewNotes.some(
      n =>
        !Number.isFinite(n.at_seconds) ||
        n.at_seconds < 0 ||
        n.text.trim().length < 1 ||
        n.text.trim().length > 2000
    );

  // `align` ocorre entre Cenas e Legendas e não consta da trilha: marca Cenas como concluída.
  const currentStageIndex = activeProduction
    ? PRODUCTION_STAGES.indexOf(activeProduction.stage === 'align' ? 'subtitles' : activeProduction.stage)
    : -1;

  return (
    <article className="card" role="region" aria-label="Produção técnica local e revisão final">
      <div className="row spread">
        <div>
          <p className="eyebrow accent">PRODUÇÃO TÉCNICA LOCAL (M4)</p>
          <h3>Execução local, artefatos verificáveis e revisão humana</h3>
        </div>
        <div className="row">
          {(isLatestScriptApproved || activeProduction !== null) && (
            <span className={`tag ${mode === 'simulated' ? 'simulated' : 'demo'}`}>
              {MODE_LABELS[mode] || mode}
            </span>
          )}
          {activeProduction && (
            <span className={`tag ${STATUS_TONE[activeProduction.status] || ''}`}>
              {STATUS_LABELS[activeProduction.status] || activeProduction.status}
            </span>
          )}
          <span className="tag">
            {productions.length > 0 ? `${productions.length} execução(ões)` : 'Sem produção'}
          </span>
        </div>
      </div>

      <p className="muted">
        Adaptação local do roteiro aprovado (M3) para artefatos de produção verificáveis por hash SHA-256.
        Sem provedores externos, sem geração de voz paga (ElevenLabs), sem busca na rede e sem publicar ou
        forjar marcador de aprovação da fábrica.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!isLatestScriptApproved && (
        <div className="fact-item" role="note" aria-label="Pré-requisito de produção técnica">
          <p className="eyebrow warn">ROTEIRO M3 AINDA NÃO APROVADO</p>
          <p className="muted">
            A produção técnica local exige que a versão mais recente do roteiro estruturado (M3) esteja com
            decisão humana <strong>Aprovado</strong> persistida no backend.
            {latestScript
              ? ` Estado atual da v${latestScript.version}: ${latestScript.status}.`
              : ' Nenhum roteiro gerado para este workflow.'}
          </p>
          <div className="actions">
            <button className="button primary" type="button" disabled>
              Iniciar produção técnica
            </button>
          </div>
        </div>
      )}

      {isLatestScriptApproved && latestScript && (
        <div className="card sunken" role="region" aria-label="Controles de disparo da produção">
          <div className="row spread">
            <div>
              <p className="eyebrow accent">DISPARO AUTORIZADO PELO ROTEIRO v{latestScript.version}</p>
              <small className="muted">
                Roteiro ID: <strong>{latestScript.id}</strong> · Versão: <strong>v{latestScript.version}</strong>
              </small>
            </div>
            <span className="tag demo">
              {mode === 'local_pilot'
                ? 'PILOTO LOCAL · TTS SINTÉTICO (SEM VOZ HUMANA/CLONE)'
                : 'TESTE / DEMO · SEM VOZ REAL'}
            </span>
          </div>

          <div className="form-row" style={{ alignItems: 'end' }}>
            <label>
              Modo de execução
              <select
                aria-label="Modo de execução da produção"
                value={mode}
                disabled={submitting || hasActiveRun}
                onChange={e => setMode(e.target.value as ProductionMode)}
              >
                <option value="simulated">Simulado (gera plano e fixtures locais sem vídeo)</option>
                <option value="local_demo">Demo local (fábrica offline, exige dependências instaladas)</option>
                <option value="local_pilot">
                  Piloto local com narração (TTS local sintético offline, sujeito a dependências)
                </option>
              </select>
            </label>
            <div className="actions">
              <button
                className="button primary"
                type="button"
                disabled={!canStartProduction}
                onClick={() => void handleStartProduction()}
              >
                {submitting
                  ? 'Processando…'
                  : mode === 'simulated'
                  ? 'Iniciar produção simulada'
                  : mode === 'local_demo'
                  ? 'Iniciar demo local'
                  : 'Iniciar piloto local com narração'}
              </button>
              <button
                className="button"
                type="button"
                disabled={loading || submitting}
                onClick={() => void handleRefreshProductions()}
              >
                Atualizar produções
              </button>
              {activeProduction && (
                <button
                  className="button"
                  type="button"
                  disabled={loading || submitting}
                  onClick={() => void handleInspectProduction(activeProduction)}
                >
                  Recarregar produção atual
                </button>
              )}
            </div>
          </div>

          {mode === 'local_pilot' && (
            <ProductionLaunchOptions
              connection={connection}
              disabled={submitting || hasActiveRun}
              quality={renderQuality}
              onQualityChange={setRenderQuality}
              onVoiceChange={setVoice}
            />
          )}

          <small className="muted">
            {mode === 'simulated'
              ? 'Modo Simulado: gera plano de produção, cenas PNG, WAV de tom e SRT sintético sem renderizar vídeo MP4. Nunca apresentado como render real.'
              : mode === 'local_demo'
              ? 'Modo Demo local: aciona a fábrica offline em diretório isolado (teste: true, áudio de tom local sem voz real). Se dependências locais (FFmpeg/Remotion/browser) estiverem ausentes, o job fica Bloqueado sem falso vídeo.'
              : 'Modo Piloto local com narração: solicita síntese de voz local (TTS sintético offline; não é voz humana nem clone), cenas demonstrativas, legenda segmentada e renderização local sem provedores externos. Não promete ferramenta instalada: se motor de voz/render faltar ou o backend não suportar o modo, o bloqueio ou erro real do backend é exibido.'}
          </small>
        </div>
      )}

      {loading && (
        <p className="loading" role="status" style={{ padding: '12px 0' }}>
          Carregando execuções de produção…
        </p>
      )}

      {activeProduction && provenance && (
        <div
          className="card sunken"
          role="region"
          aria-label={`Detalhes da produção ${activeProduction.id}`}
          style={{ gap: '14px' }}
        >
          <div className="row spread">
            <div>
              <p className="eyebrow accent">
                EXECUÇÃO DE PRODUÇÃO · ROTEIRO v{activeProduction.script_version}
              </p>
              <h3>Produção {activeProduction.id}</h3>
            </div>
            <div className="row">
              <span
                className={`tag ${activeProduction.mode === 'simulated' ? 'simulated' : 'demo'}`}
              >
                {MODE_LABELS[activeProduction.mode] || activeProduction.mode}
              </span>
              <span className={`tag ${STATUS_TONE[activeProduction.status] || ''}`}>
                {STATUS_LABELS[activeProduction.status] || activeProduction.status}
              </span>
              <span className="tag">
                Etapa: {STAGE_LABELS[activeProduction.stage] || activeProduction.stage}
              </span>
            </div>
          </div>

          <div className="info-grid">
            <div className="info-block">
              <span className="eyebrow">ID DA PRODUÇÃO</span>
              <span style={{ overflowWrap: 'anywhere' }}>{activeProduction.id}</span>
            </div>
            <div className="info-block">
              <span className="eyebrow">JOB VINCULADO</span>
              <span style={{ overflowWrap: 'anywhere' }}>{activeProduction.job_id}</span>
            </div>
            <div className="info-block">
              <span className="eyebrow" title={termTitle('sha256')}>
                HASH DO ROTEIRO (M3)
              </span>
              <span style={{ overflowWrap: 'anywhere' }}>{activeProduction.script_content_hash}</span>
            </div>
            <div className="info-block">
              <span className="eyebrow">ATUALIZADO EM</span>
              <span>{formatDate(activeProduction.updated_at)}</span>
            </div>
          </div>

          <ProductionProgress
            stage={activeProduction.stage}
            status={activeProduction.status}
            createdAt={activeProduction.created_at}
            updatedAt={activeProduction.updated_at}
            lastEvent={jobEvents.length > 0 ? jobEvents[jobEvents.length - 1] : null}
            terminal={terminalStatuses.includes(activeProduction.status)}
            showNarrationHint={activeProduction.mode === 'local_pilot'}
          />

          <div
            className="fact-item"
            role="note"
            aria-label="Avisos de proveniência e escopo de demonstração"
            style={{ background: 'var(--Background)' }}
          >
            <div className="row spread">
              <span className="eyebrow warn">AVISOS DE PROVENIÊNCIA E ESCOPO TÉCNICO</span>
              <span className="tag demo" title={termTitle('publishable')}>
                NÃO PUBLICÁVEL (publishable: false)
              </span>
            </div>
            <ProductionGlossary />
            <div className="info-grid" style={{ marginTop: '4px' }}>
              <div className="info-block">
                <span className="eyebrow" title={termTitle('demo_only')}>
                  ESCOPO (demo_only)
                </span>
                <small>{describeDemoOnlyFlag(provenance.demoOnly)}</small>
              </div>
              <div className="info-block">
                <span className="eyebrow" title={termTitle('real_voice')}>
                  NARRAÇÃO (real_voice)
                </span>
                <small>{provenance.narrationLabel}</small>
                {provenance.narrationDisclosure && (
                  <small className="muted">{provenance.narrationDisclosure}</small>
                )}
              </div>
              <div className="info-block">
                <span className="eyebrow" title={termTitle('speech_aligned')}>
                  LEGENDAS (speech_aligned)
                </span>
                <small>{provenance.subtitleLabel}</small>
                {provenance.subtitleDisclosure && (
                  <small className="muted">{provenance.subtitleDisclosure}</small>
                )}
              </div>
              <div className="info-block">
                <span className="eyebrow">CENAS VISUAIS</span>
                <small>{provenance.sceneLabel}</small>
              </div>
              <div className="info-block">
                <span className="eyebrow">RELATÓRIO DE QUALIDADE</span>
                <small>{provenance.qualityLabel}</small>
                {provenance.qualityChecksSummary &&
                  provenance.qualityChecksSummary.warnings.length > 0 && (
                    <small className="muted">
                      Avisos QC: {provenance.qualityChecksSummary.warnings.join(' · ')}
                    </small>
                  )}
                {provenance.qualityChecksSummary &&
                  provenance.qualityChecksSummary.blockingErrors.length > 0 && (
                    <small className="error">
                      Erros QC: {provenance.qualityChecksSummary.blockingErrors.join(' · ')}
                    </small>
                  )}
              </div>
              <div className="info-block">
                <span className="eyebrow">MANIFESTO DO PILOTO E LICENÇAS</span>
                <small>
                  {provenance.pilotEvidenceArtifact
                    ? `${provenance.pilotEvidenceArtifact.relative_path} (${
                        provenance.pilotEvidenceLoaded
                          ? 'Evidência carregada'
                          : pilotEvidenceError
                          ? 'Falha ao ler manifesto'
                          : 'Carregando evidência…'
                      })`
                    : 'Não verificado (pilot-evidence.json ausente nos artefatos)'}
                </small>
                <small className="muted">{provenance.licenseSummary}</small>
              </div>
            </div>
            {pilotEvidenceError && (
              <div
                role="alert"
                aria-label="Erro ao carregar evidência do piloto"
                style={{ marginTop: '8px' }}
              >
                <p className="error">{pilotEvidenceError}</p>
                <small className="muted">
                  O estado conhecido da produção foi preservado; campos dependentes de{' '}
                  <code>pilot-evidence.json</code> permanecem como Não verificado até nova leitura.
                </small>
                <div className="actions" style={{ marginTop: '6px' }}>
                  <button
                    className="button"
                    type="button"
                    disabled={loading || submitting}
                    onClick={() => setPilotEvidenceReloadCount(c => c + 1)}
                  >
                    Recarregar evidência do piloto
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="eyebrow">ETAPAS DO PIPELINE DE PRODUÇÃO</p>
            <div className="steps-horizontal" role="list" aria-label="Etapas da produção">
              {PRODUCTION_STAGES.map((stageKey, index) => {
                const isCurrent = activeProduction.stage === stageKey;
                const isPast = currentStageIndex > index;
                const isDone =
                  isPast || (isCurrent && activeProduction.status === 'succeeded');
                const isWarn =
                  isCurrent &&
                  ['running', 'queued', 'cancel_requested', 'interrupted'].includes(
                    activeProduction.status
                  );
                const isBad =
                  isCurrent && ['failed', 'blocked'].includes(activeProduction.status);
                return (
                  <span
                    key={stageKey}
                    role="listitem"
                    className={`tag ${isDone ? 'good' : isBad ? 'bad' : isWarn ? 'warn' : ''}`}
                  >
                    {index + 1}. {STAGE_LABELS[stageKey]}
                    {isCurrent
                      ? ` (${STATUS_LABELS[activeProduction.status]})`
                      : isDone
                      ? ' (Concluída)'
                      : ''}
                  </span>
                );
              })}
            </div>
          </div>

          {activeProduction.status === 'cancel_requested' && (
            <div className="fact-item" role="status">
              <p className="eyebrow warn">CANCELAMENTO EM ANDAMENTO</p>
              <p className="muted">
                O pedido de cancelamento foi enviado ao executor (`cancel_requested`). Aguardando o
                encerramento real da árvore de processos antes de declarar a tarefa como Cancelada.
              </p>
            </div>
          )}

          {activeProduction.status === 'blocked' && (
            <div className="fact-item" role="alert" aria-label="Produção bloqueada">
              <div className="row spread">
                <span className="eyebrow warn">
                  EXECUÇÃO BLOQUEADA POR PRÉ-CONDIÇÃO OU DEPENDÊNCIA
                </span>
                <span className="tag bad">BLOQUEADO</span>
              </div>
              <p>
                {activeProduction.error ||
                  'Dependências locais da fábrica (TTS/CLI/FFmpeg/Remotion/browser) ausentes ou pré-condição offline não atendida. Nenhum vídeo falso foi gerado.'}
              </p>
              <small className="muted">
                Prepare o ambiente isolado da fábrica (incluindo síntese de voz local quando em Piloto
                local) ou utilize o modo Simulado para validar o contrato e o plano sem renderização de
                vídeo.
              </small>
            </div>
          )}

          {activeProduction.status === 'failed' && (
            <div className="fact-item" role="alert" aria-label="Falha na produção">
              <div className="row spread">
                <span className="eyebrow warn">FALHA NA EXECUÇÃO TÉCNICA</span>
                <span className="tag bad">FALHOU</span>
              </div>
              <p>
                {activeProduction.error ||
                  'A tarefa de produção encerrou com erro no executor local.'}
              </p>
              <small className="muted">
                <strong>O que fazer:</strong>{' '}
                {suggestFailureAction(activeProduction.stage, activeProduction.error)}
              </small>
            </div>
          )}

          {activeProduction.status === 'interrupted' && (
            <div className="fact-item" role="alert" aria-label="Produção interrompida">
              <div className="row spread">
                <span className="eyebrow warn">EXECUÇÃO INTERROMPIDA NO REINÍCIO</span>
                <span className="tag warn">INTERROMPIDO</span>
              </div>
              <p>
                {activeProduction.error ||
                  'A produção estava em andamento quando o backend foi reiniciado. Revise os artefatos antes de tentar novamente.'}
              </p>
              <small className="muted">
                <strong>O que fazer:</strong>{' '}
                Confira os artefatos e logs abaixo; se o vídeo não foi concluído, inicie uma nova produção.
              </small>
            </div>
          )}

          {activeProduction.status === 'succeeded' && activeProduction.review === null && (
            <div className="fact-item" role="note" aria-label="Aviso de conclusão técnica">
              <div className="row spread">
                <span className="eyebrow accent">
                  EXECUÇÃO TÉCNICA CONCLUÍDA · NÃO É APROVAÇÃO FINAL
                </span>
                <span className="tag warn">REVISÃO PENDENTE</span>
              </div>
              <p className="muted">
                O status <code>succeeded</code> indica apenas que o job técnico terminou.{' '}
                {activeProduction.mode === 'simulated'
                  ? 'Como esta execução é SIMULADA (sem vídeo real), ela não admite aprovação final de vídeo como produção real.'
                  : activeProduction.mode === 'local_pilot'
                  ? 'No modo Piloto local com narração, os artefatos utilizam TTS local sintético (não é voz humana nem clone), cenas demonstrativas e legenda segmentada com alinhamento não verificado (publishable: false). Inspecione vídeo, SRT, metadados e proveniência antes de registrar a decisão humana vinculada ao hash SHA-256.'
                  : 'Mesmo com MP4 gerado em Demo Local, trata-se de render técnico com áudio de tom (sem voz real) e legenda sintética (não publicável). Inspecione o vídeo e registre a decisão humana vinculada ao hash SHA-256.'}
              </p>
            </div>
          )}

          <div className="actions">
            {canCancelJob && (
              <button
                className="button"
                type="button"
                disabled={submitting}
                onClick={() => void handleCancelJob()}
              >
                Cancelar produção
              </button>
            )}
            {activeProduction.status === 'cancel_requested' && (
              <button className="button" type="button" disabled>
                Cancelando processo…
              </button>
            )}
            {needsReconciliation && (
              <div role="region" aria-label="Conciliação da produção">
                <p>
                  Confira os arquivos e os efeitos da tentativa anterior antes de criar outra
                  produção. A tentativa anterior e seus artefatos serão preservados; não há
                  retentativa automática.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={reconciled}
                    onChange={event => setReconciled(event.target.checked)}
                  />
                  Conferi os artefatos e os efeitos da tentativa anterior
                </label>
                <button
                  className="button"
                  type="button"
                  disabled={!reconciled || !canStartProduction}
                  onClick={() => void handleStartProduction()}
                >
                  Criar nova produção após conciliação
                </button>
              </div>
            )}
          </div>

          {trackingError && (
            <div role="alert" aria-label="Acompanhamento desatualizado">
              <p>
                Acompanhamento indisponível. Último estado conhecido em{' '}
                {formatDate(activeProduction.updated_at)}; não confirma o término nem o
                cancelamento.
              </p>
              <p className="error">{trackingError}</p>
              <button
                className="button"
                disabled={loading || submitting}
                onClick={() => void handleInspectProduction(activeProduction)}
              >
                Verificar acompanhamento agora
              </button>
            </div>
          )}

          <details open>
            <summary>Logs e eventos reais do job ({activeProduction.job_id})</summary>
            {jobError && (
              <p className="error" role="alert">
                {jobError}
              </p>
            )}
            <pre ref={logsRef} className="logs" aria-label="Logs da produção">
              {jobEvents.length > 0
                ? jobEvents
                    .map(ev => describeJobEvent(ev))
                    .join('\n')
                : terminalStatuses.includes(activeProduction.status)
                ? `Job ${activeProduction.job_id} em estado ${activeProduction.status}.`
                : 'Aguardando eventos do executor…'}
            </pre>
          </details>

          <div
            role="region"
            aria-label="Artefatos da produção"
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
          >
            <div className="row spread">
              <p className="eyebrow">
                ARTEFATOS REGISTRADOS ({activeProduction.artifacts.length})
              </p>
              <span className="tag demo">
                {provenance.narrationKind === 'synthetic_local_tts'
                  ? 'TTS LOCAL SINTÉTICO (SEM VOZ HUMANA/CLONE) · CENAS DEMO · LEGENDA SEGMENTADA'
                  : 'ÁUDIO DE FIXTURE · SEM NARRAÇÃO DE VOZ REAL · SRT SINTÉTICO'}
              </span>
            </div>

            {activeProduction.artifacts.length > 0 && (
              <div
                className="fact-item"
                role="region"
                aria-label="Acesso rápido de insumos para revisão"
                style={{ background: 'var(--Background)' }}
              >
                <span className="eyebrow">
                  ACESSO RÁPIDO PARA REVISÃO (VÍDEO, SRT/TRANSCRIÇÃO, METADADOS E PROVENIÊNCIA)
                </span>
                <div className="actions" style={{ marginTop: '4px' }}>
                  {videoArtifact && (
                    <button
                      className={`button ${
                        previewTarget?.artifact.id === videoArtifact.id ? 'active' : ''
                      }`}
                      type="button"
                      disabled={previewLoading}
                      onClick={() => void handlePreviewArtifact(videoArtifact)}
                    >
                      Prévia de vídeo (MP4)
                    </button>
                  )}
                  {subtitlesArtifact && (
                    <button
                      className={`button ${
                        previewTarget?.artifact.id === subtitlesArtifact.id ? 'active' : ''
                      }`}
                      type="button"
                      disabled={previewLoading}
                      onClick={() => void handlePreviewArtifact(subtitlesArtifact)}
                    >
                      Legendas / transcrição SRT
                    </button>
                  )}
                  {primaryAudioArtifact && (
                    <button
                      className={`button ${
                        previewTarget?.artifact.id === primaryAudioArtifact.id ? 'active' : ''
                      }`}
                      type="button"
                      disabled={previewLoading}
                      onClick={() => void handlePreviewArtifact(primaryAudioArtifact)}
                    >
                      Áudio / narração WAV
                    </button>
                  )}
                  {!primaryAudioArtifact &&
                    provenance.narrationAudioStatus === 'loading_evidence' && (
                      <span className={`tag ${pilotEvidenceError ? 'bad' : 'warn'}`}>
                        {pilotEvidenceError
                          ? 'Narração completa não verificada (falha ao ler pilot-evidence.json · use a tabela para faixas individuais)'
                          : 'Verificando narração completa em pilot-evidence.json…'}
                      </span>
                    )}
                  {!primaryAudioArtifact &&
                    provenance.narrationAudioStatus === 'hash_mismatch_or_missing' && (
                      <span className="tag bad">
                        Narração completa não verificada (narration.sha256 ausente ou sem correspondência nos artefatos · use a tabela para faixas individuais)
                      </span>
                    )}
                  {!primaryAudioArtifact &&
                    provenance.narrationAudioStatus === 'evidence_missing_or_unverified' && (
                      <span className="tag warn">
                        Narração completa não verificada (pilot-evidence.json ausente · use a tabela para faixas individuais)
                      </span>
                    )}
                  {planArtifact && (
                    <button
                      className={`button ${
                        previewTarget?.artifact.id === planArtifact.id ? 'active' : ''
                      }`}
                      type="button"
                      disabled={previewLoading}
                      onClick={() => void handlePreviewArtifact(planArtifact)}
                    >
                      Plano e metadados
                    </button>
                  )}
                  {pilotEvidenceArtifact && (
                    <button
                      className={`button ${
                        previewTarget?.artifact.id === pilotEvidenceArtifact.id ? 'active' : ''
                      }`}
                      type="button"
                      disabled={previewLoading}
                      onClick={() => void handlePreviewArtifact(pilotEvidenceArtifact)}
                    >
                      Proveniência / qualidade (pilot-evidence.json)
                    </button>
                  )}
                  {validationArtifact && (
                    <button
                      className={`button ${
                        previewTarget?.artifact.id === validationArtifact.id ? 'active' : ''
                      }`}
                      type="button"
                      disabled={previewLoading}
                      onClick={() => void handlePreviewArtifact(validationArtifact)}
                    >
                      Validação de stream
                    </button>
                  )}
                </div>
              </div>
            )}

            {activeProduction.artifacts.length === 0 ? (
              <p className="muted">Nenhum artefato registrado até o momento para esta execução.</p>
            ) : (
              <div className="data-table-container">
                <table className="data-table" aria-label="Tabela de artefatos da produção">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Caminho relativo confinado</th>
                      <th>Tamanho</th>
                      <th>SHA-256</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeProduction.artifacts.map(artifact => {
                      const isPreviewed = previewTarget?.artifact.id === artifact.id;
                      return (
                        <tr key={artifact.id}>
                          <td>
                            <span className="tag">
                              {ARTIFACT_KIND_LABELS[artifact.kind] || artifact.kind}
                            </span>
                          </td>
                          <td
                            style={{
                              fontFamily: 'Geist, monospace',
                              fontSize: '11px',
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-word',
                            }}
                          >
                            {artifact.relative_path}
                          </td>
                          <td>{formatBytes(artifact.size_bytes)}</td>
                          <td
                            style={{
                              fontFamily: 'Geist, monospace',
                              fontSize: '11px',
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-all',
                            }}
                          >
                            {artifact.sha256}
                          </td>
                          <td>
                            <button
                              className={`button ${isPreviewed ? 'active' : ''}`}
                              type="button"
                              disabled={previewLoading}
                              style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                              onClick={() => void handlePreviewArtifact(artifact)}
                            >
                              {artifact.kind === 'video'
                                ? 'Abrir vídeo'
                                : artifact.kind === 'audio'
                                ? 'Ouvir áudio'
                                : 'Inspecionar'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {previewLoading && (
              <p role="status" className="muted">
                Carregando artefato autenticado…
              </p>
            )}

            {previewError && (
              <p className="error" role="alert">
                {previewError}
              </p>
            )}

            {previewTarget && (
              <div
                ref={previewPanelRef}
                tabIndex={-1}
                className="card"
                role="region"
                aria-label={`Prévia do artefato ${previewTarget.artifact.relative_path}`}
              >
                <div className="row spread">
                  <div>
                    <p className="eyebrow accent">
                      PRÉVIA AUTENTICADA · {ARTIFACT_KIND_LABELS[previewTarget.artifact.kind]}
                    </p>
                    <h4>{previewTarget.artifact.relative_path}</h4>
                    <small className="muted">SHA-256: {previewTarget.artifact.sha256}</small>
                  </div>
                  <div className="row">
                    <span className="tag demo">DEMO / TESTE (teste: true)</span>
                    <button className="button" type="button" onClick={() => clearPreview()}>
                      Fechar prévia
                    </button>
                  </div>
                </div>

                {previewTarget.kind === 'video' && previewTarget.blobUrl && (
                  <div className="player">
                    <video
                      ref={videoRef}
                      key={previewTarget.blobUrl}
                      controls
                      preload="metadata"
                      src={previewTarget.blobUrl}
                      aria-label={`Player de vídeo ${previewTarget.artifact.relative_path}`}
                      onLoadedMetadata={e => {
                        if (pendingSeekSecondsRef.current !== null) {
                          const targetSec = pendingSeekSecondsRef.current;
                          pendingSeekSecondsRef.current = null;
                          const dur = e.currentTarget.duration;
                          if (!Number.isFinite(dur) || (dur > 0 && targetSec <= dur)) {
                            try {
                              e.currentTarget.currentTime = targetSec;
                            } catch {
                              // ignore
                            }
                          }
                        }
                      }}
                      onTimeUpdate={e => {
                        if (
                          Number.isFinite(e.currentTarget.duration) &&
                          e.currentTarget.duration > 0 &&
                          Number.isFinite(e.currentTarget.currentTime)
                        ) {
                          setCurrentTimeSeconds(
                            Math.round(e.currentTarget.currentTime * 1000) / 1000
                          );
                        }
                      }}
                      onSeeked={e => {
                        if (
                          Number.isFinite(e.currentTarget.duration) &&
                          e.currentTarget.duration > 0 &&
                          Number.isFinite(e.currentTarget.currentTime)
                        ) {
                          setCurrentTimeSeconds(
                            Math.round(e.currentTarget.currentTime * 1000) / 1000
                          );
                        }
                      }}
                    />
                    <small className="muted">
                      Prévia local via Blob autenticado — Narração: {provenance.narrationLabel} ·
                      Legendas: {provenance.subtitleLabel} · Timecode:{' '}
                      {formatTimecode(currentTimeSeconds)}.
                    </small>
                  </div>
                )}

                {previewTarget.kind === 'audio' && previewTarget.blobUrl && (
                  <div>
                    <audio
                      key={previewTarget.blobUrl}
                      controls
                      preload="metadata"
                      src={previewTarget.blobUrl}
                      style={{ width: '100%' }}
                      aria-label={`Player de áudio ${previewTarget.artifact.relative_path}`}
                    />
                    <small className="muted">
                      {provenance.narrationAudioArtifact?.id === previewTarget.artifact.id
                        ? 'Áudio de TTS local sintético — não é voz humana nem clone de voz · Narração completa confirmada por SHA-256 em pilot-evidence.json.'
                        : provenance.fixtureAudioArtifact?.id === previewTarget.artifact.id
                        ? 'Áudio local de fixture (tom/silêncio para render técnico) — sem narração de voz real.'
                        : 'Faixa de áudio individual ou auxiliar — completude de narração não inferida fora do narration.sha256 de pilot-evidence.json (não é voz humana nem clone de voz).'}
                    </small>
                  </div>
                )}

                {previewTarget.kind === 'image' && previewTarget.blobUrl && (
                  <div>
                    <img
                      key={previewTarget.blobUrl}
                      src={previewTarget.blobUrl}
                      alt={`Cena ${previewTarget.artifact.relative_path}`}
                      style={{
                        maxHeight: '320px',
                        border: '1px solid var(--Line)',
                        display: 'block',
                      }}
                    />
                    <small className="muted">
                      Cena demonstrativa gerada localmente (fixture) — sem assets externos.
                    </small>
                  </div>
                )}

                {previewTarget.kind === 'text' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {previewTarget.srtSegments && previewTarget.srtSegments.length > 0 && (
                      <div
                        className="fact-item"
                        role="region"
                        aria-label="Segmentos de legenda SRT"
                      >
                        <div className="row spread">
                          <span className="eyebrow">
                            TRANSCRIÇÃO / LEGENDA SEGMENTADA ({previewTarget.srtSegments.length}{' '}
                            TRECHO(S))
                          </span>
                          <span className="tag warn">{provenance.alignmentLabel}</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            marginTop: '4px',
                          }}
                        >
                          {previewTarget.srtSegments.map(seg => (
                            <div
                              key={seg.index}
                              style={{
                                padding: '6px 8px',
                                background: 'var(--Background)',
                                border: '1px solid var(--Line)',
                              }}
                            >
                              <div className="row spread">
                                <small className="eyebrow accent">
                                  #{seg.index} · {seg.start} → {seg.end}
                                </small>
                                {seg.startSeconds !== null && (
                                  <button
                                    className="button"
                                    type="button"
                                    style={{
                                      padding: '2px 8px',
                                      minHeight: '24px',
                                      fontSize: '9px',
                                    }}
                                    onClick={() => handleSeekTimecode(seg.startSeconds!)}
                                  >
                                    Ir para {formatTimecode(seg.startSeconds)}
                                  </button>
                                )}
                              </div>
                              <p style={{ marginTop: '2px', fontSize: '13px' }}>{seg.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {previewTarget.jsonSummary && previewTarget.jsonSummary.length > 0 && (
                      <div
                        className="fact-item"
                        role="region"
                        aria-label="Resumo de metadados do artefato"
                      >
                        <span className="eyebrow">RESUMO DE METADADOS E PROVENIÊNCIA</span>
                        <div className="info-grid" style={{ marginTop: '4px' }}>
                          {previewTarget.jsonSummary.map(item => (
                            <div key={item.label} className="info-block">
                              <span className="eyebrow">{item.label}</span>
                              <small style={{ overflowWrap: 'anywhere' }}>{item.value}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <pre
                      className="logs"
                      aria-label={`Conteúdo de ${previewTarget.artifact.relative_path}`}
                    >
                      {previewTarget.text}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {normalizedQuality && (
            <QualityReportPanel
              quality={normalizedQuality}
              onSeekTimecode={seconds => handleSeekTimecode(seconds)}
            />
          )}

          {normalizedAssetProvenance && (
            <AssetProvenancePanel
              assetProvenance={normalizedAssetProvenance}
              connection={connection}
              productionId={activeProduction?.id}
              onEffectiveProvenance={setEffectiveProvenance}
              reloadKey={`${activeProduction?.status}:${activeProduction?.stage}:${activeProduction?.artifacts.length}`}
            />
          )}

          {videoArtifact && normalizedWordTimings && (
            <TimecodeReviewWorkspace
              currentTimeSeconds={currentTimeSeconds}
              scenes={sceneNavItems}
              subtitles={subtitleNavItems}
              wordTimings={normalizedWordTimings}
              qualityChecksWithTimecode={qualityChecksWithTimecode}
              subtitlesCheck={
                normalizedQuality?.checks.find(c => c.id === 'subtitles_vs_words') ?? null
              }
              notes={reviewNotes}
              canEditNotes={canReviewFinal}
              onSeekTimecode={seconds => handleSeekTimecode(seconds)}
              onCaptureCurrentVideoTime={handleCaptureCurrentVideoTime}
              onAddNote={note => setReviewNotes(prev => [...prev, note])}
              onUpdateNote={(index, updated) =>
                setReviewNotes(prev => prev.map((item, idx) => (idx === index ? updated : item)))
              }
              onRemoveNote={index =>
                setReviewNotes(prev => prev.filter((_, idx) => idx !== index))
              }
            />
          )}

          {activeProduction.mode === 'simulated' && activeProduction.status === 'succeeded' && (
            <div
              className="fact-item"
              role="region"
              aria-label="Restrição de revisão em modo simulado"
            >
              <div className="row spread">
                <span className="eyebrow accent">MODO SIMULADO · SEM VÍDEO REAL</span>
                <span className="tag simulated">SIMULAÇÃO</span>
              </div>
              <p className="muted">
                Execuções em modo <strong>Simulado</strong> validam o plano e os artefatos de fixture
                sem renderizar vídeo real. Conforme o contrato M4, produções simuladas sem vídeo não
                admitem revisão final como produção real.
              </p>
            </div>
          )}

          {canReviewFinal && videoArtifact && (
            <div className="card" role="region" aria-label="Revisão humana final da produção">
              <div className="row spread">
                <p className="eyebrow accent">REVISÃO HUMANA FINAL (VÍDEO VERIFICADO POR HASH)</p>
                <span className="tag demo">APENAS DEMO / TESTE · NÃO PUBLICÁVEL</span>
              </div>
              <h3>Registrar decisão humana sobre o vídeo</h3>
              <p className="muted">
                Confirme a integridade do vídeo renderizado, das legendas/transcrição SRT e dos
                metadados antes de aprovar ou rejeitar.{' '}
                {provenance.narrationKind === 'synthetic_local_tts' ? (
                  <>
                    Este piloto utiliza <strong>TTS local sintético (não é voz humana nem clone)</strong>,{' '}
                    <strong>cenas demonstrativas locais</strong> e{' '}
                    <strong>
                      {normalizedWordTimings?.speechAligned
                        ? 'alinhamento por palavra validado'
                        : 'legenda segmentada com alinhamento não verificado'}
                    </strong>{' '}
                    (<code>publishable: false</code>).
                  </>
                ) : (
                  <>
                    Mesmo com MP4 gerado localmente, este artefato usa{' '}
                    <strong>tom de fixture (sem narração de voz real)</strong> e{' '}
                    <strong>legenda SRT sintética</strong> (<code>publishable: false</code>).
                  </>
                )}{' '}
                Esta decisão é vinculada ao hash SHA-256 do vídeo,{' '}
                <strong>não implica licença ou publicabilidade</strong> e <strong>não</strong> executa{' '}
                <code>fabrica aprovar</code>, <code>produzir</code>, upload ou <code>publicar</code>.
              </p>
              <div className="fact-item">
                <span className="eyebrow">ARTEFATO DE VÍDEO ALVO</span>
                <span>
                  <strong>{videoArtifact.relative_path}</strong> ({formatBytes(videoArtifact.size_bytes)})
                </span>
                <small className="muted" style={{ overflowWrap: 'anywhere' }}>
                  SHA-256: <strong>{videoArtifact.sha256}</strong>
                </small>
                <small className="muted">
                  Qualidade: {provenance.qualityLabel} · Narração: {provenance.narrationLabel} · Notas
                  marcadas para envio: <strong>{reviewNotes.length}</strong>
                </small>
              </div>

              {hasUnverifiedLicense && normalizedAssetProvenance && (
                <div
                  className="fact-item"
                  role="note"
                  aria-label="Pendências de licença antes de aprovar"
                  style={{ borderColor: 'var(--Warn)' }}
                >
                  <span className="eyebrow warn">
                    PENDÊNCIAS DE LICENÇA ANTES DE APROVAR
                  </span>
                  <small className="muted">
                    Revise ou registre a verificação humana no Painel de Licenças acima antes de
                    aprovar, ou confirme ciência explícita abaixo (<code>publishable: false</code>):
                  </small>
                  <ul className="blocker-items-list">
                    {normalizedAssetProvenance.assets
                      .filter(
                        item =>
                          item.status === 'unverified' ||
                          item.status === 'rejected' ||
                          item.commercialUse === 'unknown' ||
                          item.commercialUse === 'restricted' ||
                          !item.verifiedBy
                      )
                      .map(item => (
                        <li key={item.assetId} className="blocker-item warning">
                          <strong>{item.assetId}</strong> ({item.kindLabel}) · status:{' '}
                          <code>{item.status}</code> · uso comercial:{' '}
                          <code>{item.commercialUse}</code>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {requiresApprovalConfirmation && (
                <div
                  className={`blocker-item ${hasQcFail ? 'critical' : 'warning'}`}
                  role="note"
                  aria-label="Aviso explícito para aprovação com ressalvas"
                >
                  <span className="eyebrow warn">
                    AVISO EXPLÍCITO: QC REPROVADO OU LICENÇA NÃO VERIFICADA
                  </span>
                  <p className="muted">
                    {hasQcFail && (
                      <>
                        <strong>Relatório de qualidade reprovado (status: fail)</strong> com erros
                        bloqueantes ou falhas técnicas.{' '}
                      </>
                    )}
                    {!hasQcFail && hasQcNotRunInPilot && (
                      <>
                        <strong>Relatório de qualidade ausente ou não executado (not_run)</strong>{' '}
                        neste piloto local (<code>quality_acknowledgement_required: true</code>).{' '}
                      </>
                    )}
                    {hasUnverifiedLicense && (
                      <>
                        <strong>Licença ou proveniência não verificada</strong> (status{' '}
                        <code>unverified</code>/<code>rejected</code>,{' '}
                        <code>commercial_use: unknown</code> ou ausência de verificação humana).{' '}
                      </>
                    )}
                    Para aprovar esta revisão técnica por hash, confirme ciência explícita abaixo (
                    <code>acknowledge_quality_errors: true</code>). Rejeitar continua sempre
                    disponível. Publicação permanece bloqueada (<code>publishable: false</code>).
                  </p>
                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: '8px',
                      color: 'var(--Ink)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: '16px', height: '16px', flexShrink: 0 }}
                      aria-label="Confirmo ciência das pendências de QC e/ou licenças não verificadas (publishable: false)"
                      checked={approvalConfirmationChecked}
                      onChange={e => setApprovalConfirmationChecked(e.target.checked)}
                    />
                    <span>
                      Confirmo ciência das pendências de QC e/ou licenças não verificadas; a decisão
                      mantém <code>publishable: false</code> e não autoriza publicação
                    </span>
                  </label>
                </div>
              )}

              <div className="actions">
                <button
                  className="button primary"
                  type="button"
                  disabled={
                    submitting ||
                    hasInvalidDraftNotes ||
                    (requiresApprovalConfirmation && !approvalConfirmationChecked)
                  }
                  onClick={() => void handleReviewProduction('approve', videoArtifact)}
                >
                  Aprovar produção (hash verificado)
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={submitting || hasInvalidDraftNotes}
                  onClick={() => void handleReviewProduction('reject', videoArtifact)}
                >
                  Rejeitar produção
                </button>
              </div>
              {(() => {
                const reasons: string[] = [];
                if (submitting) reasons.push('Envio da revisão em andamento.');
                if (hasInvalidDraftNotes) reasons.push('Há notas de revisão incompletas ou com timecode inválido.');
                if (requiresApprovalConfirmation && !approvalConfirmationChecked) {
                  reasons.push(
                    'Marque a caixa de ciência explícita acima (pendências de QC e/ou licenças não verificadas).'
                  );
                }
                if (reasons.length === 0) return null;
                return (
                  <p className="muted" role="status" aria-label="Motivo do bloqueio de aprovação">
                    <strong>Aprovação bloqueada:</strong> {reasons.join(' ')}
                  </p>
                );
              })()}
            </div>
          )}

          {activeProduction.review && (
            <div
              className="fact-item"
              role="region"
              aria-label="Decisão de revisão final registrada"
              style={{ background: 'var(--Background)' }}
            >
              <div className="row spread">
                <span className="eyebrow">REVISÃO HUMANA FINAL REGISTRADA</span>
                <div className="row">
                  <span className="tag demo">DEMO / TESTE (teste: true)</span>
                  <span
                    className={`tag ${
                      activeProduction.review.decision === 'approve' ? 'good' : 'bad'
                    }`}
                  >
                    {REVIEW_DECISION_LABELS[activeProduction.review.decision] ||
                      activeProduction.review.decision}
                  </span>
                </div>
              </div>
              <p className="muted" style={{ overflowWrap: 'anywhere' }}>
                Hash SHA-256 revisado: <strong>{activeProduction.review.artifact_sha256}</strong>
              </p>
              <small className="muted">
                Revisado em: {formatDate(activeProduction.review.reviewed_at)} · Decisão vinculada ao
                hash não implica licença/publicabilidade, não realiza upload/publicação e não forja
                marcador da fábrica (<code>publishable: false</code>).
              </small>
              {(activeProduction.review.acknowledge_quality_errors === true ||
                activeProduction.review.acknowledged_quality_errors === true) && (
                <div className="row" style={{ marginTop: '4px' }}>
                  <span className="tag warn">
                    Reconhecimento explícito de pendências de QC / licença registrado
                    (acknowledge_quality_errors: true)
                  </span>
                </div>
              )}

              <div
                className="fact-item"
                role="region"
                aria-label="Notas registradas na revisão"
                style={{ marginTop: '6px' }}
              >
                <span className="eyebrow">
                  NOTAS DE REVISÃO POR TIMECODE REGISTRADAS (
                  {activeProduction.review.notes?.length ?? 0})
                </span>
                {activeProduction.review.notes && activeProduction.review.notes.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {activeProduction.review.notes.map((note, idx) => (
                      <div key={idx} className="row" style={{ flexWrap: 'wrap' }}>
                        <button
                          className="button"
                          type="button"
                          style={{ padding: '3px 8px', minHeight: '24px', fontSize: '10px' }}
                          aria-label={`Ir para nota registrada ${idx + 1} em ${formatTimecode(
                            note.at_seconds
                          )}`}
                          onClick={() => handleSeekTimecode(note.at_seconds)}
                        >
                          {formatTimecode(note.at_seconds)} ({note.at_seconds}s)
                        </button>
                        <span style={{ fontSize: '13px' }}>{note.text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <small className="muted">
                    Nenhuma nota por timecode registrada nesta decisão.
                  </small>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {productions.length > 0 && (
        <div
          role="region"
          aria-label="Histórico de execuções da produção"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          <p className="eyebrow">HISTÓRICO DE EXECUÇÕES DESTE ROTEIRO ({productions.length})</p>
          {productions.map(item => {
            const isSelected = activeProduction?.id === item.id;
            return (
              <div
                key={item.id}
                className="fact-item"
                style={{
                  borderColor: isSelected ? 'var(--AccentInk)' : undefined,
                }}
              >
                <div className="row spread">
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <span className="eyebrow accent" style={{ overflowWrap: 'anywhere' }}>
                      {item.id}
                    </span>
                    <span
                      className={`tag ${item.mode === 'simulated' ? 'simulated' : 'demo'}`}
                    >
                      {MODE_LABELS[item.mode] || item.mode}
                    </span>
                    <span className={`tag ${STATUS_TONE[item.status] || ''}`}>
                      {STATUS_LABELS[item.status] || item.status}
                    </span>
                    {item.review && (
                      <span
                        className={`tag ${item.review.decision === 'approve' ? 'good' : 'bad'}`}
                      >
                        {REVIEW_DECISION_LABELS[item.review.decision]}
                      </span>
                    )}
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <small className="muted">
                      Etapa: {STAGE_LABELS[item.stage] || item.stage} · {formatDate(item.created_at)}
                    </small>
                    {productions.length > 1 && (
                      <button
                        className={`button ${isSelected ? 'active' : ''}`}
                        type="button"
                        style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                        onClick={() => void handleInspectProduction(item)}
                      >
                        {isSelected ? 'Exibindo' : 'Inspecionar'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
