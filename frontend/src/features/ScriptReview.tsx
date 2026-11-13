import { useEffect, useRef, useState } from 'react';
import type { Connection, WorkflowArtifact, WorkflowDetail } from '../services/api';
import type {
  ScriptRecord,
  ScriptReviewDecision,
  ScriptSectionKind,
  ScriptStatus,
} from '../services/scripts';
import {
  createWorkflowScript,
  formatScriptError,
  getScript,
  getWorkflowScripts,
  reviewScript,
  sortScriptsDesc,
} from '../services/scripts';

const SCRIPT_STATUS_LABELS: Record<ScriptStatus, string> = {
  awaiting_review: 'Aguardando revisão',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  changes_requested: 'Alterações solicitadas',
};

const SCRIPT_STATUS_TONE: Record<ScriptStatus, string> = {
  awaiting_review: 'warn',
  approved: 'good',
  rejected: 'bad',
  changes_requested: 'warn',
};

const SECTION_KIND_LABELS: Record<ScriptSectionKind, string> = {
  hook: 'GANCHO · HOOK',
  body: 'DESENVOLVIMENTO · BODY',
  conclusion: 'CONCLUSÃO · CONCLUSION',
};

const DECISION_LABELS: Record<ScriptReviewDecision, string> = {
  approve: 'Aprovado',
  reject: 'Rejeitado',
  request_changes: 'Alterações solicitadas',
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

function resolveProposalArtifactId(
  workflow: WorkflowDetail,
  proposalArtifact?: WorkflowArtifact
): string | null {
  if (proposalArtifact?.id) {
    return proposalArtifact.id;
  }
  const revisionArtifact = workflow.artifacts?.find(
    a => a.stage === 'proposal' && a.revision === workflow.revision
  );
  if (revisionArtifact?.id) {
    return revisionArtifact.id;
  }
  const approvedDecision = workflow.approvals?.find(
    app => app.revision === workflow.revision && app.decision === 'approve'
  );
  if (approvedDecision?.artifact_id) {
    return approvedDecision.artifact_id;
  }
  if (workflow.current_artifact_id) {
    return workflow.current_artifact_id;
  }
  return null;
}

export default function ScriptReview({
  connection,
  workflow,
  proposalArtifact,
}: {
  connection: Connection | null;
  workflow: WorkflowDetail;
  proposalArtifact?: WorkflowArtifact;
}) {
  const [scripts, setScripts] = useState<ScriptRecord[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState('');

  // Synchronous lock to prevent duplicate submissions on rapid double-clicks
  const inFlightRef = useRef(false);
  // Preserves Idempotency-Key across network retries of the exact same logical operation
  const idempotencyCacheRef = useRef<{ signature: string; key: string } | null>(null);
  const mountedWorkflowRef = useRef<string>(workflow.id);
  const inspectControllerRef = useRef<AbortController | null>(null);
  const inspectRequestIdRef = useRef(0);

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

  function upsertScriptRecord(record: ScriptRecord) {
    setScripts(prev => {
      const filtered = prev.filter(item => item.id !== record.id && item.version !== record.version);
      return sortScriptsDesc([record, ...filtered]);
    });
    setSelectedVersion(record.version);
  }

  const proposalArtifactId = resolveProposalArtifactId(workflow, proposalArtifact);
  const isProposalApproved = workflow.status === 'approved' && Boolean(proposalArtifactId);

  useEffect(() => {
    mountedWorkflowRef.current = workflow.id;
    cancelPendingInspect();
    setScripts([]);
    setSelectedVersion(null);
    setError('');
    setFeedback('');
    setFeedbackError('');
    idempotencyCacheRef.current = null;
    return () => {
      cancelPendingInspect();
    };
  }, [workflow.id]);

  useEffect(() => {
    const conn = connection;
    if (!conn || workflow.status !== 'approved') {
      setLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');

    void getWorkflowScripts(conn, workflow.id, controller.signal)
      .then(items => {
        if (!active) return;
        setScripts(items);
        setSelectedVersion(prev => {
          if (prev !== null && items.some(i => i.version === prev)) {
            return prev;
          }
          return items[0]?.version ?? null;
        });
      })
      .catch(reason => {
        if (!active || controller.signal.aborted) return;
        setError(formatScriptError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [connection, workflow.id, workflow.revision, workflow.status]);

  const latestScript = scripts[0] ?? null;
  const activeScript =
    scripts.find(item => item.version === selectedVersion) ?? latestScript ?? null;

  const canGenerateFirst = isProposalApproved && scripts.length === 0;
  const canGenerateNext =
    isProposalApproved && latestScript !== null && latestScript.status === 'changes_requested';
  const canGenerate = (canGenerateFirst || canGenerateNext) && !loading && !submitting;

  async function handleRefreshList() {
    if (!connection || inFlightRef.current || submitting) return;
    cancelPendingInspect();
    setLoading(true);
    setError('');
    try {
      const items = await getWorkflowScripts(connection, workflow.id);
      if (mountedWorkflowRef.current !== workflow.id) return;
      setScripts(items);
      setSelectedVersion(prev => {
        if (prev !== null && items.some(i => i.version === prev)) {
          return prev;
        }
        return items[0]?.version ?? null;
      });
    } catch (reason) {
      if (mountedWorkflowRef.current !== workflow.id) return;
      setError(formatScriptError(reason));
    } finally {
      if (mountedWorkflowRef.current === workflow.id) {
        setLoading(false);
      }
    }
  }

  async function handleInspectVersion(item: ScriptRecord) {
    inspectControllerRef.current?.abort();
    const controller = new AbortController();
    inspectControllerRef.current = controller;
    const requestId = ++inspectRequestIdRef.current;
    const targetWorkflowId = workflow.id;
    const intendedVersion = item.version;

    setSelectedVersion(intendedVersion);
    setError('');

    if (!connection) return;
    try {
      const fresh = await getScript(connection, item.id, controller.signal);
      if (
        controller.signal.aborted ||
        inspectRequestIdRef.current !== requestId ||
        mountedWorkflowRef.current !== targetWorkflowId
      ) {
        return;
      }
      setScripts(prev => {
        const filtered = prev.filter(s => s.id !== fresh.id && s.version !== fresh.version);
        return sortScriptsDesc([fresh, ...filtered]);
      });
      setSelectedVersion(intendedVersion);
    } catch (reason) {
      if (
        controller.signal.aborted ||
        inspectRequestIdRef.current !== requestId ||
        mountedWorkflowRef.current !== targetWorkflowId
      ) {
        return;
      }
      setError(formatScriptError(reason));
    }
  }

  async function handleGenerateScript() {
    if (!connection || !isProposalApproved || !proposalArtifactId) return;
    if (inFlightRef.current || submitting) return;

    cancelPendingInspect();
    const targetWorkflowId = workflow.id;
    const signature = `create:${targetWorkflowId}:${workflow.revision}:${proposalArtifactId}:${latestScript?.version ?? 0}`;
    const idempotencyKey = getOrCreateIdempotencyKey(signature);

    inFlightRef.current = true;
    setSubmitting(true);
    setError('');

    try {
      // Note: Do not attach an UI abort button that pretends to cancel backend execution.
      const created = await createWorkflowScript(
        connection,
        targetWorkflowId,
        {
          expected_revision: workflow.revision,
          proposal_artifact_id: proposalArtifactId,
        },
        idempotencyKey
      );
      clearIdempotencyKey(signature);
      if (mountedWorkflowRef.current !== targetWorkflowId) return;
      upsertScriptRecord(created);
      setFeedback('');
      setFeedbackError('');
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'status' in reason) {
        clearIdempotencyKey(signature);
      }
      if (mountedWorkflowRef.current !== targetWorkflowId) return;
      setError(formatScriptError(reason));
    } finally {
      inFlightRef.current = false;
      if (mountedWorkflowRef.current === targetWorkflowId) {
        setSubmitting(false);
      }
    }
  }

  async function handleReviewScript(decision: ScriptReviewDecision) {
    if (!connection || !latestScript || latestScript.status !== 'awaiting_review') return;
    if (inFlightRef.current || submitting) return;

    const trimmedFeedback = feedback.trim();
    if (decision === 'request_changes' && !trimmedFeedback) {
      setFeedbackError('Descreva obrigatoriamente as alterações solicitadas para o roteiro.');
      return;
    }

    cancelPendingInspect();
    const targetWorkflowId = workflow.id;
    const signature = `review:${latestScript.id}:${latestScript.version}:${decision}:${trimmedFeedback}`;
    const idempotencyKey = getOrCreateIdempotencyKey(signature);

    inFlightRef.current = true;
    setSubmitting(true);
    setError('');
    setFeedbackError('');

    try {
      const reviewed = await reviewScript(
        connection,
        latestScript.id,
        {
          expected_version: latestScript.version,
          decision,
          feedback: trimmedFeedback,
        },
        idempotencyKey
      );
      clearIdempotencyKey(signature);
      if (mountedWorkflowRef.current !== targetWorkflowId) return;
      upsertScriptRecord(reviewed);
      setFeedback('');
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'status' in reason) {
        clearIdempotencyKey(signature);
      }
      if (mountedWorkflowRef.current !== targetWorkflowId) return;
      setError(formatScriptError(reason));
    } finally {
      inFlightRef.current = false;
      if (mountedWorkflowRef.current === targetWorkflowId) {
        setSubmitting(false);
      }
    }
  }

  const generateButtonLabel = canGenerateNext
    ? 'Gerar nova versão do roteiro'
    : isProposalApproved
    ? 'Gerar roteiro simulado'
    : 'Gerar roteiro';

  return (
    <article className="card" role="region" aria-label="Roteiro e revisão humana">
      <div className="row spread">
        <div>
          <p className="eyebrow accent">ETAPA DE ROTEIRIZAÇÃO (M3)</p>
          <h3>Roteiro estruturado e revisão humana</h3>
        </div>
        <div className="row">
          {(isProposalApproved || activeScript?.document.simulated) && (
            <span className="tag simulated">SIMULADO</span>
          )}
          {latestScript && (
            <span className={`tag ${SCRIPT_STATUS_TONE[latestScript.status] || ''}`}>
              {SCRIPT_STATUS_LABELS[latestScript.status] || latestScript.status}
            </span>
          )}
          <span className="tag">
            {latestScript ? `Versão atual: v${latestScript.version}` : 'Sem roteiro'}
          </span>
        </div>
      </div>

      <p className="muted">
        Derivação local a partir da proposta aprovada, sem inferência externa, sem custos e sem acionar
        renderização ou publicação na fábrica.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!isProposalApproved && (
        <div className="fact-item" role="note" aria-label="Pré-requisito de geração de roteiro">
          <p className="eyebrow warn">PROPOSTA AINDA NÃO APROVADA</p>
          <p className="muted">
            A geração de roteiro exige aprovação humana prévia da proposta editorial na revisão atual (revisão{' '}
            {workflow.revision}). O backend valida e governa esta permissão.
          </p>
          <div className="actions">
            <button className="button primary" type="button" disabled>
              {generateButtonLabel}
            </button>
          </div>
        </div>
      )}

      {isProposalApproved && (
        <div className="row spread" style={{ gap: '12px' }}>
          <div className="muted" style={{ overflowWrap: 'anywhere' }}>
            Origem autorizada: Revisão <strong>{workflow.revision}</strong> · Proposta{' '}
            <strong>{proposalArtifactId}</strong>
          </div>
          <div className="actions">
            <button
              className="button primary"
              type="button"
              disabled={!canGenerate}
              onClick={() => void handleGenerateScript()}
            >
              {submitting ? 'Processando…' : generateButtonLabel}
            </button>
            <button
              className="button"
              type="button"
              disabled={loading || submitting}
              onClick={() => void handleRefreshList()}
            >
              Atualizar roteiros
            </button>
            {activeScript && (
              <button
                className="button"
                type="button"
                disabled={loading || submitting}
                onClick={() => void handleInspectVersion(activeScript)}
              >
                Recarregar versão v{activeScript.version}
              </button>
            )}
          </div>
        </div>
      )}

      {loading && (
        <p className="loading" role="status" style={{ padding: '12px 0' }}>
          Carregando versões do roteiro…
        </p>
      )}

      {isProposalApproved && !loading && scripts.length === 0 && !error && (
        <div className="fact-item">
          <p className="eyebrow">PRONTO PARA GERAR</p>
          <p className="muted">
            Proposta aprovada. Gere a primeira versão do roteiro estruturado para iniciar a revisão humana por
            seções.
          </p>
        </div>
      )}

      {latestScript && latestScript.status === 'changes_requested' && (
        <div className="fact-item" role="region" aria-label="Alterações solicitadas na versão anterior">
          <div className="row spread">
            <span className="eyebrow warn">ALTERAÇÕES SOLICITADAS NA VERSÃO {latestScript.version}</span>
            <span className="tag warn">NOVA VERSÃO DISPONÍVEL</span>
          </div>
          {latestScript.review?.feedback && (
            <p>
              <strong>Feedback registrado:</strong> {latestScript.review.feedback}
            </p>
          )}
          <small className="muted">
            Gere uma nova versão do roteiro para incorporar os ajustes preservando o histórico anterior.
          </small>
        </div>
      )}

      {activeScript && (
        <div
          className="card sunken"
          role="region"
          aria-label={`Documento do roteiro versão ${activeScript.version}`}
          style={{ gap: '14px' }}
        >
          <div className="row spread">
            <div>
              <p className="eyebrow accent">
                DOCUMENTO DO ROTEIRO · VERSÃO {activeScript.version}
              </p>
              <h3>{activeScript.document.title}</h3>
            </div>
            <div className="row">
              {activeScript.document.simulated && <span className="tag simulated">SIMULADO</span>}
              <span className={`tag ${SCRIPT_STATUS_TONE[activeScript.status] || ''}`}>
                {SCRIPT_STATUS_LABELS[activeScript.status] || activeScript.status}
              </span>
              <span className="tag">v{activeScript.version}</span>
            </div>
          </div>

          <div className="info-grid">
            <div className="info-block">
              <span className="eyebrow">ID DO ROTEIRO</span>
              <span style={{ overflowWrap: 'anywhere' }}>{activeScript.id}</span>
            </div>
            <div className="info-block">
              <span className="eyebrow">PROPOSTA / REVISÃO</span>
              <span style={{ overflowWrap: 'anywhere' }}>
                {activeScript.proposal_artifact_id} (Rev. {activeScript.workflow_revision})
              </span>
            </div>
            <div className="info-block">
              <span className="eyebrow">HASH DA PROPOSTA</span>
              <span style={{ overflowWrap: 'anywhere' }}>{activeScript.proposal_content_hash}</span>
            </div>
            <div className="info-block">
              <span className="eyebrow">CRIADO EM</span>
              <span>{formatDate(activeScript.created_at)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <p className="eyebrow">
              SEÇÕES DO ROTEIRO ({activeScript.document.sections.length})
            </p>
            {activeScript.document.sections.map((section, index) => (
              <div
                key={section.id}
                className="fact-item"
                role="group"
                aria-label={`Seção ${index + 1}: ${section.heading}`}
                style={{ background: 'var(--Background)' }}
              >
                <div className="row spread">
                  <div className="row">
                    <span className="tag">#{index + 1}</span>
                    <span className="eyebrow accent">
                      {SECTION_KIND_LABELS[section.kind] || section.kind}
                    </span>
                    <span className="eyebrow muted">({section.id})</span>
                  </div>
                  <span className="tag">
                    {section.source_ids.length > 0
                      ? `Fontes: ${section.source_ids.join(', ')}`
                      : 'Sem fontes vinculadas'}
                  </span>
                </div>
                <strong>{section.heading}</strong>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{section.narration}</p>
              </div>
            ))}
          </div>

          {activeScript.review && (
            <div className="fact-item" style={{ background: 'var(--Background)' }}>
              <div className="row spread">
                <span className="eyebrow">DECISÃO REGISTRADA NESTA VERSÃO</span>
                <span
                  className={`tag ${
                    activeScript.review.decision === 'approve'
                      ? 'good'
                      : activeScript.review.decision === 'reject'
                      ? 'bad'
                      : 'warn'
                  }`}
                >
                  {DECISION_LABELS[activeScript.review.decision] || activeScript.review.decision}
                </span>
              </div>
              {activeScript.review.feedback && (
                <p className="muted">Feedback: {activeScript.review.feedback}</p>
              )}
              <small className="muted">Revisado em: {formatDate(activeScript.review.reviewed_at)}</small>
            </div>
          )}
        </div>
      )}

      {latestScript && latestScript.status === 'awaiting_review' && (
        <div className="card sunken" role="region" aria-label="Revisão humana do roteiro">
          <div className="row spread">
            <p className="eyebrow accent">DECISÃO HUMANA DO ROTEIRO</p>
            <span className="tag warn">VERSÃO {latestScript.version} AGUARDANDO REVISÃO</span>
          </div>
          <h3>Avaliar roteiro (v{latestScript.version})</h3>
          <p className="muted">
            Registre a decisão humana para a versão {latestScript.version}. Para solicitar alterações e permitir
            a geração de uma nova versão, o preenchimento do feedback é obrigatório. A aprovação é final e não
            dispara renderização nem publicação externa.
          </p>

          <label>
            Feedback do roteiro
            <textarea
              value={feedback}
              onChange={e => {
                setFeedback(e.target.value);
                if (feedbackError) setFeedbackError('');
              }}
              placeholder="Descreva ajustes de gancho, ritmo, desenvolvimento ou conclusão para a próxima versão..."
              maxLength={2000}
              rows={3}
              disabled={submitting}
            />
          </label>

          {feedbackError && (
            <p className="error" role="alert">
              {feedbackError}
            </p>
          )}

          <div className="actions">
            <button
              className="button primary"
              type="button"
              disabled={submitting}
              onClick={() => void handleReviewScript('approve')}
            >
              Aprovar roteiro
            </button>
            <button
              className="button"
              type="button"
              disabled={submitting}
              onClick={() => void handleReviewScript('reject')}
            >
              Rejeitar roteiro
            </button>
            <button
              className="button"
              type="button"
              disabled={submitting || !feedback.trim()}
              onClick={() => void handleReviewScript('request_changes')}
            >
              Solicitar alterações no roteiro
            </button>
          </div>
        </div>
      )}

      {scripts.length > 0 && (
        <div role="region" aria-label="Histórico de versões do roteiro" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p className="eyebrow">HISTÓRICO DE VERSÕES DO ROTEIRO ({scripts.length})</p>
          {scripts.map(item => {
            const isSelected = activeScript?.version === item.version;
            return (
              <div
                key={item.id}
                className="fact-item"
                style={{
                  borderColor: isSelected ? 'var(--AccentInk)' : undefined,
                }}
              >
                <div className="row spread">
                  <div className="row">
                    <span className="eyebrow accent">Versão {item.version}</span>
                    {item.document.simulated && <span className="tag simulated">SIMULADO</span>}
                    <span className={`tag ${SCRIPT_STATUS_TONE[item.status] || ''}`}>
                      {SCRIPT_STATUS_LABELS[item.status] || item.status}
                    </span>
                  </div>
                  <div className="row">
                    <small className="muted">
                      Rev. {item.workflow_revision} · Proposta {item.proposal_artifact_id} ·{' '}
                      {formatDate(item.created_at)}
                    </small>
                    {scripts.length > 1 && (
                      <button
                        className={`button ${isSelected ? 'active' : ''}`}
                        type="button"
                        style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                        onClick={() => void handleInspectVersion(item)}
                      >
                        {isSelected ? `Exibindo v${item.version}` : `Ver v${item.version}`}
                      </button>
                    )}
                  </div>
                </div>
                {item.review && (
                  <div className="row spread">
                    <small className="muted">
                      Decisão: <strong>{DECISION_LABELS[item.review.decision] || item.review.decision}</strong>
                      {item.review.feedback ? ` — Feedback: ${item.review.feedback}` : ''}
                    </small>
                    <small className="muted">Revisado em {formatDate(item.review.reviewed_at)}</small>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
