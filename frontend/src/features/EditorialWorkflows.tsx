import { useEffect, useState } from 'react';
import type {
  AnalysisArtifactContent,
  Connection,
  ProposalArtifactContent,
  WorkflowArtifact,
  WorkflowDetail,
  WorkflowSummary,
} from '../services/api';
import {
  authorizeWorkflow,
  cancelWorkflow,
  getWorkflow,
  getWorkflows,
  reconcileWorkflow,
  retryWorkflow,
  reviewWorkflow,
} from '../services/api';
import ScriptReview from './ScriptReview';

const STATUS_LABELS: Record<string, string> = {
  queued: 'Na fila',
  running: 'Em execução',
  awaiting_authorization: 'Aguardando autorização',
  awaiting_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  cancel_requested: 'Cancelando',
  cancelled: 'Cancelado',
  failed: 'Falhou',
  interrupted: 'Interrompido',
  unknown: 'Desconhecido',
  waiting: 'Aguardando',
  succeeded: 'Concluído',
  blocked: 'Bloqueado',
};

const STAGE_LABELS: Record<string, string> = {
  planning: 'Planejamento',
  research: 'Pesquisa',
  analysis: 'Análise',
  proposal: 'Proposta',
};

const TERMINAL_STATUSES = ['approved', 'rejected', 'cancelled', 'failed'];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    return isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export default function EditorialWorkflows({
  connection,
  onOpenCenter,
}: {
  connection: Connection | null;
  onOpenCenter?: () => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState('');

  // Initial fetch and when connection changes
  async function refreshList(selectFirst = false) {
    if (!connection) return;
    try {
      const list = await getWorkflows(connection);
      setWorkflows(list);
      if (selectFirst && list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
      }
    } catch {
      // Background list polling does not spam alerts
    }
  }

  useEffect(() => {
    void refreshList(true);
  }, [connection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling: updates list and current workflow every 1.5s until terminal or unmount
  useEffect(() => {
    const conn = connection;
    if (!conn) return;
    let timer: number | undefined;
    let active = true;

    async function poll() {
      if (!conn) return;
      try {
        const list = await getWorkflows(conn);
        if (!active) return;
        setWorkflows(list);

        if (selectedId) {
          const detail = await getWorkflow(conn, selectedId);
          if (!active) return;
          setCurrent(detail);
          if (TERMINAL_STATUSES.includes(detail.status)) {
            return; // Terminal state reached: stop polling
          }
        }
      } catch (reason) {
        // Keep polling on transient errors unless unmounted
      }
      if (active) {
        timer = window.setTimeout(poll, 1500);
      }
    }

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [connection, selectedId]);

  // Load selected workflow detail immediately when selection changes
  useEffect(() => {
    const conn = connection;
    if (!conn || !selectedId) {
      setCurrent(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    void getWorkflow(conn, selectedId)
      .then(detail => {
        if (!active) return;
        setCurrent(detail);
      })
      .catch(reason => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connection, selectedId]);

  async function handleAuthorize() {
    if (!connection || !current || !current.pending_authorization) return;
    setBusy(true);
    setError('');
    try {
      const updated = await authorizeWorkflow(connection, current.id, {
        expected_revision: current.revision,
        job_id: current.pending_authorization.job_id,
      });
      setCurrent(updated);
      await refreshList();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!connection || !current) return;
    setBusy(true);
    setError('');
    try {
      const updated = await cancelWorkflow(connection, current.id);
      setCurrent(updated);
      await refreshList();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleRetry() {
    if (!connection || !current) return;
    setBusy(true);
    setError('');
    try {
      const updated = await retryWorkflow(connection, current.id, current.revision);
      setCurrent(updated);
      await refreshList();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleReconcile() {
    if (!connection || !current) return;
    setBusy(true);
    setError('');
    try {
      const updated = await reconcileWorkflow(connection, current.id, current.revision);
      setCurrent(updated);
      await refreshList();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function handleReview(decision: 'approve' | 'reject' | 'request_changes') {
    if (!connection || !current || !current.current_artifact_id) return;
    if (decision === 'request_changes' && !feedback.trim()) {
      setFeedbackError('Descreva as alterações solicitadas.');
      return;
    }
    setBusy(true);
    setError('');
    setFeedbackError('');
    try {
      const result = await reviewWorkflow(connection, current.id, {
        expected_revision: current.revision,
        artifact_id: current.current_artifact_id,
        decision,
        feedback: decision === 'request_changes' ? feedback.trim() : undefined,
      });
      // Show final state returned by backend (no optimistic state)
      setCurrent(result.workflow);
      if (decision === 'request_changes') {
        setFeedback('');
      }
      await refreshList();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const isSimulated = current?.simulated || current?.executor === 'hermes_simulated';
  const isTerminal = current ? TERMINAL_STATUSES.includes(current.status) : false;
  const canCancel = current && !isTerminal && current.status !== 'cancel_requested';
  const canRetry = current && (current.status === 'failed' || current.status === 'interrupted');
  const hasUnknownRun = current?.cognitive_runs?.some(r => r.status === 'unknown');
  const canReconcile = current && (current.status === 'failed' || current.status === 'interrupted') && hasUnknownRun;

  const proposalArtifact = current?.artifacts?.find(
    (a: WorkflowArtifact) => a.stage === 'proposal' && a.revision === current.revision
  );
  const proposalContent = proposalArtifact?.content as ProposalArtifactContent | undefined;

  const analysisArtifact = current?.artifacts?.find(
    (a: WorkflowArtifact) => a.stage === 'analysis' && a.revision === current.revision
  );
  const analysisContent = analysisArtifact?.content as AnalysisArtifactContent | undefined;
  const analysisResult = analysisContent?.result;

  return (
    <section className="workspace" aria-label="Análises editoriais e aprovação humana">
      <div className="card">
        <div className="row spread">
          <div>
            <p className="eyebrow accent">PIPELINE EDITORIAL</p>
            <h2>Análises editoriais e aprovações</h2>
          </div>
          <span className="tag">MÓDULO EDITORIAL</span>
        </div>
        <p className="muted">
          Acompanhamento de fluxos de análise com validação de evidências, autorização explícita e aprovação humana
          de propostas.
        </p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      {workflows.length > 0 && (
        <div className="editorial-grid">
          <aside className="editorial-list" aria-label="Lista de análises editoriais">
            <p className="eyebrow accent">ANÁLISES RECENTES</p>
            {workflows.map(wf => {
              const isSelected = wf.id === selectedId;
              return (
                <button
                  key={wf.id}
                  className={`editorial-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedId(wf.id);
                    setError('');
                  }}
                >
                  <div className="row spread">
                    <span className="eyebrow accent">{wf.id.slice(0, 12)}…</span>
                    <span className="tag">{STATUS_LABELS[wf.status] || wf.status}</span>
                  </div>
                  <small className="muted">
                    Revisão {wf.revision} · {formatDate(wf.created_at)}
                  </small>
                </button>
              );
            })}
          </aside>

          <main className="editorial-detail" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {loading && <p className="loading" role="status">Carregando análise…</p>}

            {current && !loading && (
              <>
                <article className="card">
                  <div className="row spread">
                    <div>
                      <p className="eyebrow accent">FLUXO EDITORIAL</p>
                      <h3>Workflow {current.id}</h3>
                    </div>
                    <div className="row">
                      {isSimulated && <span className="tag simulated">SIMULADO</span>}
                      <span className="tag">{STATUS_LABELS[current.status] || current.status}</span>
                    </div>
                  </div>

                  <p className="muted">
                    Revisão: <strong>{current.revision}</strong> · Executor: <strong>{current.executor}</strong> ·
                    Criado em: {formatDate(current.created_at)}
                  </p>

                  <div>
                    <p className="eyebrow">OBJETIVO</p>
                    <p style={{ marginTop: '4px' }}>{current.request.objective}</p>
                  </div>

                  <div>
                    <p className="eyebrow">ETAPAS DO FLUXO</p>
                    <div className="steps-horizontal">
                      {(['planning', 'research', 'analysis', 'proposal'] as const).map(stageKey => {
                        const stepJob = current.steps?.find(
                          s => s.step_key === stageKey && s.workflow_revision === current.revision
                        );
                        const stepStatus = stepJob ? stepJob.status : 'waiting';
                        const isDone = stepStatus === 'succeeded';
                        const isPendingAuth = stepStatus === 'awaiting_authorization';
                        return (
                          <span
                            key={stageKey}
                            className={`tag ${isDone ? 'good' : isPendingAuth ? 'warn' : ''}`}
                          >
                            {STAGE_LABELS[stageKey]}: {STATUS_LABELS[stepStatus] || stepStatus}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <div className="actions">
                    {canCancel && (
                      <button
                        className="button"
                        disabled={busy || current.status === 'cancel_requested'}
                        onClick={() => void handleCancel()}
                      >
                        Cancelar
                      </button>
                    )}
                    {canRetry && (
                      <button className="button" disabled={busy} onClick={() => void handleRetry()}>
                        Tentar novamente
                      </button>
                    )}
                    {canReconcile && (
                      <button className="button" disabled={busy} onClick={() => void handleReconcile()}>
                        Conciliar
                      </button>
                    )}
                  </div>
                </article>

                {current.pending_authorization && (
                  <article className="card sunken" role="region" aria-label="Autorização necessária">
                    <div className="row spread">
                      <p className="eyebrow warn">AUTORIZAÇÃO EXPLÍCITA NECESSÁRIA</p>
                      <span className="tag warn">ETAPA COGNITIVA</span>
                    </div>
                    <p>
                      A etapa de análise editorial cognitiva requer autorização explícita para prosseguir.
                      Esta execução é simulada e não gera custo.
                    </p>
                    <div className="actions">
                      <button className="button primary" disabled={busy} onClick={() => void handleAuthorize()}>
                        Autorizar uma execução
                      </button>
                    </div>
                  </article>
                )}

                {proposalContent && (
                  <article className="card" role="region" aria-label="Proposta editorial">
                    <div className="row spread">
                      <p className="eyebrow accent">PROPOSTA EDITORIAL</p>
                      {proposalContent.result_status && (
                        <span className="tag good">Status: {proposalContent.result_status}</span>
                      )}
                    </div>

                    <h2>{proposalContent.title}</h2>

                    {proposalContent.recommendation ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {proposalContent.recommendation.title_options && (
                          <div>
                            <p className="eyebrow">OPÇÕES DE TÍTULO</p>
                            <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                              {proposalContent.recommendation.title_options.map((t, idx) => (
                                <li key={idx}><strong>{t}</strong></li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="proposal-grid">
                          <div>
                            <p className="eyebrow">PREMISSA</p>
                            <p>{proposalContent.recommendation.premise}</p>
                          </div>
                          <div>
                            <p className="eyebrow">ÂNGULO</p>
                            <p>{proposalContent.recommendation.angle}</p>
                          </div>
                          <div>
                            <p className="eyebrow">FORMATO</p>
                            <p>{proposalContent.recommendation.format === 'short' ? 'Vídeo Curto (Shorts)' : 'Vídeo Longo'}</p>
                          </div>
                          <div>
                            <p className="eyebrow">ORIGINALIDADE</p>
                            <p>{proposalContent.recommendation.originality}</p>
                          </div>
                        </div>

                        {proposalContent.recommendation.risks && proposalContent.recommendation.risks.length > 0 && (
                          <div>
                            <p className="eyebrow warn">RISCOS</p>
                            <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                              {proposalContent.recommendation.risks.map((r, idx) => (
                                <li key={idx}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {proposalContent.recommendation.licensing_notes && (
                          <div>
                            <p className="eyebrow">NOTAS DE LICENCIAMENTO</p>
                            <p className="muted">{proposalContent.recommendation.licensing_notes}</p>
                          </div>
                        )}

                        {proposalContent.opportunities && proposalContent.opportunities.length > 0 && (
                          <div>
                            <p className="eyebrow">OPORTUNIDADES IDENTIFICADAS</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                              {proposalContent.opportunities.map(op => (
                                <div key={op.id} className="fact-item">
                                  <strong>{op.summary}</strong>
                                  <small className="muted">Enquadramento Brasil: {op.br_fit_rationale}</small>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {proposalContent.unknowns && proposalContent.unknowns.length > 0 && (
                          <div>
                            <p className="eyebrow">PONTOS DESCONHECIDOS</p>
                            <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                              {proposalContent.unknowns.map((u, idx) => (
                                <li key={idx} className="muted">{u}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {proposalContent.evidence && (
                          <div>
                            <p className="eyebrow">CONTAGEM DE EVIDÊNCIAS</p>
                            <div className="evidence-metrics" style={{ marginTop: '4px' }}>
                              <span className="tag">{proposalContent.evidence.sources} fontes</span>
                              <span className="tag">{proposalContent.evidence.facts} fatos</span>
                              <span className="tag">{proposalContent.evidence.hypotheses} hipóteses</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      proposalContent.text && <p className="muted">{proposalContent.text}</p>
                    )}
                  </article>
                )}

                {analysisResult && (
                  <article className="card" role="region" aria-label="Evidências da análise">
                    <p className="eyebrow accent">EVIDÊNCIAS E FATOS DA ANÁLISE</p>

                    {analysisResult.sources && analysisResult.sources.length > 0 && (
                      <details open>
                        <summary>Fontes consultadas ({analysisResult.sources.length})</summary>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                          {analysisResult.sources.map(src => (
                            <div key={src.id} className="source-item">
                              <div className="row spread">
                                <span className="eyebrow">{src.id}</span>
                                <small className="muted">{formatDate(src.retrieved_at)}</small>
                              </div>
                              <a href={src.url} target="_blank" rel="noreferrer">
                                {src.title || src.url}
                              </a>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {analysisResult.facts && analysisResult.facts.length > 0 && (
                      <details open style={{ marginTop: '10px' }}>
                        <summary>Fatos validados ({analysisResult.facts.length})</summary>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                          {analysisResult.facts.map(fact => (
                            <div key={fact.id} className="fact-item">
                              <div className="row spread">
                                <span className="eyebrow">{fact.id}</span>
                                <small className="muted">Fontes: {fact.source_ids.join(', ')}</small>
                              </div>
                              <p>{fact.text}</p>
                              {fact.metric_refs && fact.metric_refs.length > 0 && (
                                <div className="row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                                  {fact.metric_refs.map((m, idx) => (
                                    <span key={idx} className="tag small">
                                      {m.source_id} · {m.field}: {m.value.toLocaleString('pt-BR')}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {analysisResult.hypotheses && analysisResult.hypotheses.length > 0 && (
                      <details open style={{ marginTop: '10px' }}>
                        <summary>Hipóteses ({analysisResult.hypotheses.length})</summary>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                          {analysisResult.hypotheses.map(hyp => (
                            <div key={hyp.id} className="hypothesis-item">
                              <div className="row spread">
                                <span className="eyebrow">{hyp.id}</span>
                                <span className="tag small">Confiança: {hyp.confidence}</span>
                              </div>
                              <p>{hyp.text}</p>
                              <small className="muted">Baseada em: {hyp.based_on.join(', ')}</small>
                              <small className="muted">Como testar: {hyp.how_to_test}</small>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </article>
                )}

                {current.status === 'awaiting_approval' && current.current_artifact_id && (
                  <article className="card sunken" role="region" aria-label="Decisão editorial">
                    <p className="eyebrow accent">DECISÃO EDITORIAL HUMANA</p>
                    <h3>Aprovação da proposta</h3>
                    <p className="muted">
                      Avalie a proposta acima e registre sua decisão editorial. Para solicitar alterações, descreva
                      obrigatoriamente o feedback para a nova revisão.
                    </p>

                    <label>
                      Feedback / Alterações solicitadas
                      <textarea
                        value={feedback}
                        onChange={e => {
                          setFeedback(e.target.value);
                          if (feedbackError) setFeedbackError('');
                        }}
                        placeholder="Descreva as correções ou ajustes desejados na abordagem, formato ou premissa..."
                        maxLength={2000}
                        rows={3}
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
                        disabled={busy}
                        onClick={() => void handleReview('approve')}
                      >
                        Aprovar
                      </button>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => void handleReview('reject')}
                      >
                        Rejeitar
                      </button>
                      <button
                        className="button"
                        disabled={busy || !feedback.trim()}
                        onClick={() => void handleReview('request_changes')}
                      >
                        Solicitar alterações
                      </button>
                    </div>
                  </article>
                )}

                {current.approvals && current.approvals.length > 0 && (
                  <article className="card" role="region" aria-label="Histórico de decisões">
                    <p className="eyebrow">HISTÓRICO DE APROVAÇÕES</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {current.approvals.map(app => (
                        <div key={app.id} className="fact-item">
                          <div className="row spread">
                            <span className="eyebrow">Revisão {app.revision}</span>
                            <span className={`tag ${app.decision === 'approve' ? 'good' : 'bad'}`}>
                              {app.decision === 'approve'
                                ? 'Aprovado'
                                : app.decision === 'reject'
                                ? 'Rejeitado'
                                : 'Alterações solicitadas'}
                            </span>
                          </div>
                          {app.feedback && <p className="muted">Feedback: {app.feedback}</p>}
                          <small className="muted">{formatDate(app.created_at)}</small>
                        </div>
                      ))}
                    </div>
                  </article>
                )}

                {current.status === 'approved' && onOpenCenter && (
                  <article className="card" role="region" aria-label="Próxima ação da proposta aprovada">
                    <p className="eyebrow good">PROPOSTA APROVADA</p>
                    <p className="muted">
                      Gere e revise o roteiro logo abaixo; depois acompanhe a produção e o histórico na
                      Central de Produção.
                    </p>
                    <div className="actions">
                      <button className="button" type="button" onClick={onOpenCenter}>
                        Abrir Central de Produção
                      </button>
                    </div>
                  </article>
                )}

                <ScriptReview
                  connection={connection}
                  workflow={current}
                  proposalArtifact={proposalArtifact}
                />
              </>
            )}
          </main>
        </div>
      )}
    </section>
  );
}
