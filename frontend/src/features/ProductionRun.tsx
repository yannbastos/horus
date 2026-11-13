import { useEffect, useRef, useState } from 'react';
import { observeJob, terminalStatuses } from '../services/api';
import type { Connection, JobEvent, JobStatus } from '../services/api';
import type { ScriptRecord } from '../services/scripts';
import type {
  ProductionArtifact,
  ProductionArtifactKind,
  ProductionMode,
  ProductionRecord,
  ProductionReviewDecision,
  ProductionStage,
} from '../services/production';
import {
  cancelProductionJob,
  createScriptProduction,
  fetchProductionArtifactBlob,
  formatProductionError,
  getProduction,
  getScriptProductions,
  reviewProduction,
  sortProductionsDesc,
} from '../services/production';

const PRODUCTION_STAGES: ProductionStage[] = [
  'prepare',
  'narration',
  'scenes',
  'subtitles',
  'render',
  'review',
];

const STAGE_LABELS: Record<ProductionStage, string> = {
  prepare: 'Preparação',
  narration: 'Narração',
  scenes: 'Cenas',
  subtitles: 'Legendas',
  render: 'Render',
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

function describeRealVoiceFlag(value: boolean | undefined): string {
  if (value === false) return 'Sem voz real (tom de fixture: fixture_tone)';
  if (value === true) return 'Não verificado para publicação (demonstrativo)';
  return 'Não verificado (ausente; nunca inferir voz real)';
}

function describeSpeechAlignedFlag(value: boolean | undefined): string {
  if (value === false) return 'Sem alinhamento de fala (SRT sintético: synthetic_srt)';
  if (value === true) return 'Não verificado para publicação (demonstrativo)';
  return 'Não verificado (ausente; nunca inferir alinhamento real)';
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
  const [mode, setMode] = useState<ProductionMode>('simulated');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [jobEvents, setJobEvents] = useState<JobEvent[]>([]);
  const [jobError, setJobError] = useState('');
  const [trackingError, setTrackingError] = useState('');
  const [reconciled, setReconciled] = useState(false);

  // Preview state (authenticated blob URL or text content)
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewTarget, setPreviewTarget] = useState<{
    artifact: ProductionArtifact;
    kind: 'video' | 'audio' | 'image' | 'text';
    blobUrl?: string;
    text?: string;
  } | null>(null);

  const inFlightRef = useRef(false);
  const idempotencyCacheRef = useRef<{ signature: string; key: string } | null>(null);
  const mountedScriptIdRef = useRef<string | null>(latestScript?.id ?? null);
  const inspectControllerRef = useRef<AbortController | null>(null);
  const inspectRequestIdRef = useRef(0);
  const previewControllerRef = useRef<AbortController | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);
  const logsRef = useRef<HTMLPreElement>(null);

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

  // Clear preview if user switches selected production
  useEffect(() => {
    clearPreview();
    setTrackingError('');
    setReconciled(false);
  }, [activeProduction?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // A single polling request owns status updates; SSE only supplies logs.
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
    (!activeProduction || !['failed', 'interrupted', 'blocked', 'cancelled'].includes(activeProduction.status) || reconciled) &&
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
    const signature = `create:${targetScriptId}:${latestScript.version}:${mode}:${productions.length}`;
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
      } else if (artifact.kind === 'scene' && artifact.relative_path.toLowerCase().endsWith('.png')) {
        const blobUrl = URL.createObjectURL(blob);
        activeBlobUrlRef.current = blobUrl;
        setPreviewTarget({ artifact, kind: 'image', blobUrl });
      } else {
        const rawText = await blob.text();
        if (controller.signal.aborted || mountedScriptIdRef.current !== targetScriptId) return;
        let formattedText = rawText;
        if (artifact.relative_path.endsWith('.json')) {
          try {
            formattedText = JSON.stringify(JSON.parse(rawText), null, 2);
          } catch {
            formattedText = rawText;
          }
        }
        setPreviewTarget({ artifact, kind: 'text', text: formattedText });
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

  async function handleReviewProduction(decision: ProductionReviewDecision, videoArtifact: ProductionArtifact) {
    if (!connection || !activeProduction || inFlightRef.current || submitting) return;

    const targetScriptId = activeProduction.script_id;
    const targetProductionId = activeProduction.id;
    const signature = `review:${targetProductionId}:${videoArtifact.sha256}:${decision}`;
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

  const videoArtifact = activeProduction?.artifacts.find(a => a.kind === 'video') ?? null;
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
    activeProduction?.mode === 'local_demo' &&
    Boolean(videoArtifact?.sha256) &&
    activeProduction?.review === null;

  const currentStageIndex = activeProduction
    ? PRODUCTION_STAGES.indexOf(activeProduction.stage)
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
              {MODE_LABELS[mode]}
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
            <span className="tag demo">TESTE / DEMO · SEM VOZ REAL</span>
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
                  : 'Iniciar demo local'}
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

          <small className="muted">
            {mode === 'simulated'
              ? 'Modo Simulado: gera plano de produção, cenas PNG, WAV de tom e SRT sintético sem renderizar vídeo MP4. Nunca apresentado como render real.'
              : 'Modo Demo local: aciona a fábrica offline em diretório isolado (teste: true, áudio de tom local sem voz real). Se dependências locais (FFmpeg/Remotion/browser) estiverem ausentes, o job fica Bloqueado sem falso vídeo.'}
          </small>
        </div>
      )}

      {loading && (
        <p className="loading" role="status" style={{ padding: '12px 0' }}>
          Carregando execuções de produção…
        </p>
      )}

      {activeProduction && (
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
              <span className={`tag ${activeProduction.mode === 'simulated' ? 'simulated' : 'demo'}`}>
                {MODE_LABELS[activeProduction.mode]}
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
              <span className="eyebrow">HASH DO ROTEIRO (M3)</span>
              <span style={{ overflowWrap: 'anywhere' }}>{activeProduction.script_content_hash}</span>
            </div>
            <div className="info-block">
              <span className="eyebrow">ATUALIZADO EM</span>
              <span>{formatDate(activeProduction.updated_at)}</span>
            </div>
          </div>

          <div
            className="fact-item"
            role="note"
            aria-label="Avisos de proveniência e escopo de demonstração"
            style={{ background: 'var(--Background)' }}
          >
            <div className="row spread">
              <span className="eyebrow warn">AVISOS DE PROVENIÊNCIA E ESCOPO TÉCNICO</span>
              <span className="tag demo">NÃO PUBLICÁVEL (publishable: false)</span>
            </div>
            <div className="info-grid" style={{ marginTop: '4px' }}>
              <div className="info-block">
                <span className="eyebrow">ESCOPO (demo_only)</span>
                <small>{describeDemoOnlyFlag(activeProduction.demo_only)}</small>
              </div>
              <div className="info-block">
                <span className="eyebrow">NARRAÇÃO (real_voice)</span>
                <small>{describeRealVoiceFlag(activeProduction.real_voice)}</small>
              </div>
              <div className="info-block">
                <span className="eyebrow">LEGENDAS (speech_aligned)</span>
                <small>{describeSpeechAlignedFlag(activeProduction.speech_aligned)}</small>
              </div>
            </div>
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
                    {isCurrent ? ` (${STATUS_LABELS[activeProduction.status]})` : isDone ? ' (Concluída)' : ''}
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
                <span className="eyebrow warn">EXECUÇÃO BLOQUEADA POR PRÉ-CONDIÇÃO OU DEPENDÊNCIA</span>
                <span className="tag bad">BLOQUEADO</span>
              </div>
              <p>
                {activeProduction.error ||
                  'Dependências locais da fábrica (CLI/FFmpeg/Remotion/browser) ausentes ou pré-condição offline não atendida. Nenhum vídeo falso foi gerado.'}
              </p>
              <small className="muted">
                Prepare o ambiente isolado da fábrica ou utilize o modo Simulado para validar o contrato e o
                plano sem renderização de vídeo.
              </small>
            </div>
          )}

          {activeProduction.status === 'failed' && (
            <div className="fact-item" role="alert" aria-label="Falha na produção">
              <div className="row spread">
                <span className="eyebrow warn">FALHA NA EXECUÇÃO TÉCNICA</span>
                <span className="tag bad">FALHOU</span>
              </div>
              <p>{activeProduction.error || 'A tarefa de produção encerrou com erro no executor local.'}</p>
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
            </div>
          )}

          {activeProduction.status === 'succeeded' && activeProduction.review === null && (
            <div className="fact-item" role="note" aria-label="Aviso de conclusão técnica">
              <div className="row spread">
                <span className="eyebrow accent">EXECUÇÃO TÉCNICA CONCLUÍDA · NÃO É APROVAÇÃO FINAL</span>
                <span className="tag warn">REVISÃO PENDENTE</span>
              </div>
              <p className="muted">
                O status <code>succeeded</code> indica apenas que o job técnico terminou.{' '}
                {activeProduction.mode === 'simulated'
                  ? 'Como esta execução é SIMULADA (sem vídeo real), ela não admite aprovação final de vídeo como produção real.'
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
                <p>Confira os arquivos e os efeitos da tentativa anterior antes de criar outra produção. A tentativa anterior e seus artefatos serão preservados; não há retentativa automática.</p>
                <label><input type="checkbox" checked={reconciled} onChange={event => setReconciled(event.target.checked)} />Conferi os artefatos e os efeitos da tentativa anterior</label>
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

          {trackingError && <div role="alert" aria-label="Acompanhamento desatualizado"><p>Acompanhamento indisponível. Último estado conhecido em {formatDate(activeProduction.updated_at)}; não confirma o término nem o cancelamento.</p><p className="error">{trackingError}</p><button className="button" disabled={loading || submitting} onClick={() => void handleInspectProduction(activeProduction)}>Verificar acompanhamento agora</button></div>}

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
                    .map(ev => `${ev.kind === 'state' ? 'estado' : ev.kind}: ${ev.message}`)
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
              <span className="tag demo">ÁUDIO DE FIXTURE · SEM NARRAÇÃO DE VOZ REAL · SRT SINTÉTICO</span>
            </div>

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
                      key={previewTarget.blobUrl}
                      controls
                      preload="metadata"
                      src={previewTarget.blobUrl}
                      aria-label={`Player de vídeo ${previewTarget.artifact.relative_path}`}
                    />
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
                      Áudio local de fixture (tom/silêncio para render técnico) — sem narração de voz real.
                    </small>
                  </div>
                )}

                {previewTarget.kind === 'image' && previewTarget.blobUrl && (
                  <div>
                    <img
                      key={previewTarget.blobUrl}
                      src={previewTarget.blobUrl}
                      alt={`Cena ${previewTarget.artifact.relative_path}`}
                      style={{ maxHeight: '320px', border: '1px solid var(--Line)', display: 'block' }}
                    />
                    <small className="muted">
                      Cena original gerada localmente (fixture) — sem assets externos.
                    </small>
                  </div>
                )}

                {previewTarget.kind === 'text' && (
                  <pre className="logs" aria-label={`Conteúdo de ${previewTarget.artifact.relative_path}`}>
                    {previewTarget.text}
                  </pre>
                )}
              </div>
            )}
          </div>

          {activeProduction.mode === 'simulated' && activeProduction.status === 'succeeded' && (
            <div className="fact-item" role="region" aria-label="Restrição de revisão em modo simulado">
              <div className="row spread">
                <span className="eyebrow accent">MODO SIMULADO · SEM VÍDEO REAL</span>
                <span className="tag simulated">SIMULAÇÃO</span>
              </div>
              <p className="muted">
                Execuções em modo <strong>Simulado</strong> validam o plano e os artefatos de fixture sem
                renderizar vídeo real. Conforme o contrato M4, produções simuladas sem vídeo não admitem
                revisão final como produção real.
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
                Confirme a integridade do vídeo renderizado antes de aprovar ou rejeitar. Mesmo com MP4
                gerado localmente, este artefato usa <strong>tom de fixture (sem narração de voz real)</strong>{' '}
                e <strong>legenda SRT sintética</strong> (<code>publishable: false</code>). Esta decisão é
                vinculada ao hash SHA-256 do vídeo e <strong>não</strong> executa{' '}
                <code>fabrica aprovar</code>, <code>produzir</code> ou <code>publicar</code>.
              </p>
              <div className="fact-item">
                <span className="eyebrow">ARTEFATO DE VÍDEO ALVO</span>
                <span>
                  <strong>{videoArtifact.relative_path}</strong> ({formatBytes(videoArtifact.size_bytes)})
                </span>
                <small className="muted" style={{ overflowWrap: 'anywhere' }}>
                  SHA-256: <strong>{videoArtifact.sha256}</strong>
                </small>
              </div>
              <div className="actions">
                <button
                  className="button primary"
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleReviewProduction('approve', videoArtifact)}
                >
                  Aprovar produção (hash verificado)
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleReviewProduction('reject', videoArtifact)}
                >
                  Rejeitar produção
                </button>
              </div>
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
                Revisado em: {formatDate(activeProduction.review.reviewed_at)} · Render técnico de
                demonstração (sem voz real, SRT sintético, não publicável; não forja marcador da fábrica).
              </small>
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
                    <span className={`tag ${item.mode === 'simulated' ? 'simulated' : 'demo'}`}>
                      {MODE_LABELS[item.mode]}
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
