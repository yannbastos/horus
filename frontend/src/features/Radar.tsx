import { useEffect, useState } from 'react';
import type { Connection, RadarDatasetDetail, RadarDatasetSummary, WorkflowDetail } from '../services/api';
import { createRadarDemoDataset, createRadarWorkflow, getRadarDatasetDetail, getRadarDatasets } from '../services/api';

const REASON_LABELS: Record<string, string> = {
  invalid_source_id: 'Identificador de fonte inválido',
  invalid_url: 'URL inválida (HTTPS obrigatório)',
  missing_title: 'Título ausente',
  missing_channel: 'Canal ausente',
  missing_published_at: 'Data de publicação ausente',
};

function formatReason(reason: string): string {
  return REASON_LABELS[reason] || reason;
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

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
}

export default function Radar({ connection }: { connection: Connection | null }) {
  const [datasets, setDatasets] = useState<RadarDatasetSummary[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<number>(1);
  const [detail, setDetail] = useState<RadarDatasetDetail | null>(null);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [objective, setObjective] = useState('Analisar formatos e referências para produção de vídeos originais no Brasil.');
  const [channelId, setChannelId] = useState('canal-01');
  const [channelSummary, setChannelSummary] = useState('Canal com foco em narrativas audiovisuais e tecnologia.');
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [workflowCreated, setWorkflowCreated] = useState<WorkflowDetail | null>(null);

  async function loadDatasets(selectId?: string, selectRev?: number) {
    if (!connection) return;
    setLoading(true);
    setError('');
    try {
      const list = await getRadarDatasets(connection);
      setDatasets(list);
      if (list.length > 0) {
        const target = selectId
          ? list.find(d => d.snapshot_id === selectId && (selectRev ? d.revision === selectRev : true)) || list[0]
          : list[0];
        setSelectedSnapshotId(target.snapshot_id);
        setSelectedRevision(target.revision);
      } else {
        setSelectedSnapshotId(null);
        setDetail(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDatasets();
  }, [connection]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!connection || !selectedSnapshotId) return;
    let active = true;
    setLoadingDetail(true);
    setError('');
    void getRadarDatasetDetail(connection, selectedSnapshotId, selectedRevision)
      .then(res => {
        if (!active) return;
        setDetail(res);
        // Default selection: all eligible videos up to 50
        const eligible = res.dataset.records
          .filter(r => r.kind === 'youtube_video' && res.eligibility[r.source_id]?.eligible)
          .map(r => r.source_id)
          .slice(0, 50);
        setSelectedSources(new Set(eligible));
      })
      .catch(reason => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoadingDetail(false);
      });
    return () => {
      active = false;
    };
  }, [connection, selectedSnapshotId, selectedRevision]);

  async function handleLoadDemo() {
    if (!connection) return;
    setBusy(true);
    setError('');
    try {
      const created = await createRadarDemoDataset(connection);
      await loadDatasets(created.snapshot_id, created.revision);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function toggleSource(sourceId: string, eligible: boolean) {
    if (!eligible) return;
    const next = new Set(selectedSources);
    if (next.has(sourceId)) {
      next.delete(sourceId);
    } else {
      if (next.size >= 50) return;
      next.add(sourceId);
    }
    setSelectedSources(next);
  }

  function toggleAllEligible() {
    if (!detail) return;
    const eligibleIds = detail.dataset.records
      .filter(r => r.kind === 'youtube_video' && detail.eligibility[r.source_id]?.eligible)
      .map(r => r.source_id);

    const allSelected = eligibleIds.length > 0 && eligibleIds.every(id => selectedSources.has(id));
    if (allSelected) {
      setSelectedSources(new Set());
    } else {
      setSelectedSources(new Set(eligibleIds.slice(0, 50)));
    }
  }

  async function handleStartAnalysis() {
    if (!connection || !detail) return;
    setBusy(true);
    setError('');
    setWorkflowCreated(null);
    try {
      const result = await createRadarWorkflow(connection, {
        snapshot_id: detail.dataset.snapshot_id,
        revision: detail.dataset.revision,
        source_ids: Array.from(selectedSources),
        objective: objective.trim(),
        channel: {
          channel_id: channelId.trim(),
          summary: channelSummary.trim(),
        },
      });
      setWorkflowCreated(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const currentDatasetSummary = datasets.find(
    d => d.snapshot_id === selectedSnapshotId && d.revision === selectedRevision
  );
  const isDemo = currentDatasetSummary?.origin === 'operator_fixture' || detail?.dataset.origin === 'operator_fixture';
  const videoRecords = detail ? detail.dataset.records.filter(r => r.kind === 'youtube_video') : [];
  const eligibleVideos = videoRecords.filter(r => detail?.eligibility[r.source_id]?.eligible);
  const allEligibleSelected =
    eligibleVideos.length > 0 && eligibleVideos.every(v => selectedSources.has(v.source_id));

  return (
    <section className="workspace" aria-label="Pesquisa e análise de oportunidades do Radar">
      {!connection && (
        <div className="card sunken">
          <p className="muted" role="status">
            Conecte o backend local em Ajustes para carregar e explorar os datasets do Radar.
          </p>
        </div>
      )}

      {error && (
        <div className="card">
          <p className="error" role="alert">
            {error}
          </p>
        </div>
      )}

      {connection && !loading && datasets.length === 0 && (
        <div className="empty-state">
          <span className="tag">RADAR · NENHUM DATASET COLETADO</span>
          <h2>Nenhum snapshot de pesquisa disponível</h2>
          <p className="muted">
            Você pode carregar um conjunto de dados fictícios para testar a elegibilidade, seleção de vídeos e o
            início da análise editorial.
          </p>
          <div className="actions">
            <button className="button primary" disabled={busy} onClick={() => void handleLoadDemo()}>
              Carregar dados de demonstração
            </button>
          </div>
        </div>
      )}

      {datasets.length > 0 && (
        <div className="radar-grid">
          <aside className="radar-list" aria-label="Datasets disponíveis">
            <div className="row spread">
              <p className="eyebrow accent">DATASETS DISPONÍVEIS</p>
              <button
                className="button"
                style={{ minHeight: '28px', padding: '4px 10px', fontSize: '10px' }}
                disabled={busy}
                onClick={() => void handleLoadDemo()}
                title="Carregar novo conjunto de demonstração"
              >
                + Demo
              </button>
            </div>
            {datasets.map(ds => {
              const isSelected = ds.snapshot_id === selectedSnapshotId && ds.revision === selectedRevision;
              const isItemDemo = ds.origin === 'operator_fixture';
              return (
                <button
                  key={`${ds.snapshot_id}_${ds.revision}`}
                  className={`radar-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedSnapshotId(ds.snapshot_id);
                    setSelectedRevision(ds.revision);
                    setWorkflowCreated(null);
                  }}
                >
                  <div className="row spread">
                    <span className="eyebrow accent">
                      {ds.snapshot_id} (r{ds.revision})
                    </span>
                    {isItemDemo && <span className="tag demo">DEMONSTRAÇÃO · DADOS FICTÍCIOS</span>}
                  </div>
                  <small>
                    {ds.videos} vídeos ({ds.eligible_videos} elegíveis) · {ds.records} registros
                  </small>
                  <small className="muted">Coletado: {formatDate(ds.collected_at)}</small>
                  <small className="muted">Expira: {formatDate(ds.expires_at)}</small>
                </button>
              );
            })}
          </aside>

          <main className="radar-detail" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {loadingDetail && <p className="loading" role="status">Carregando detalhes do dataset…</p>}

            {detail && !loadingDetail && (
              <>
                <article className="card">
                  <div className="row spread">
                    <div>
                      <p className="eyebrow accent">SNAPSHOT SELECIONADO</p>
                      <h2>{detail.dataset.snapshot_id} · Revisão {detail.dataset.revision}</h2>
                    </div>
                    {isDemo && <span className="tag demo">DEMONSTRAÇÃO · DADOS FICTÍCIOS</span>}
                  </div>
                  <p className="muted">
                    Origem: <strong>{detail.dataset.origin}</strong> · Status: {detail.dataset.status} · Coletado em:{' '}
                    {formatDate(detail.dataset.collected_at)} · Expira em: {formatDate(detail.dataset.expires_at)}
                  </p>
                  <div className="row spread">
                    <p className="eyebrow">
                      {selectedSources.size} de {eligibleVideos.length} elegíveis selecionados (máx. 50)
                    </p>
                    <button
                      className="button"
                      style={{ minHeight: '30px', padding: '4px 12px', fontSize: '10px' }}
                      onClick={toggleAllEligible}
                    >
                      {allEligibleSelected ? 'Desmarcar todos' : 'Selecionar todos os elegíveis'}
                    </button>
                  </div>

                  <div className="data-table-container">
                    <table className="data-table" aria-label="Tabela de vídeos do dataset">
                      <thead>
                        <tr>
                          <th style={{ width: '40px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={allEligibleSelected}
                              onChange={toggleAllEligible}
                              aria-label="Selecionar todos os vídeos elegíveis"
                            />
                          </th>
                          <th>Título</th>
                          <th>Canal</th>
                          <th>Publicação</th>
                          <th>Métricas</th>
                          <th>Coleta</th>
                          <th>Elegibilidade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {videoRecords.map(record => {
                          const elig = detail.eligibility[record.source_id];
                          const isEligible = elig ? elig.eligible : false;
                          const isChecked = selectedSources.has(record.source_id);
                          return (
                            <tr key={record.source_id}>
                              <td style={{ textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={!isEligible}
                                  onChange={() => toggleSource(record.source_id, isEligible)}
                                  aria-label={`Selecionar ${record.title || record.source_id}`}
                                />
                              </td>
                              <td>
                                <strong>{record.title || '[Sem título]'}</strong>
                                <br />
                                <small className="muted">{record.source_id}</small>
                              </td>
                              <td>{record.channel_title || record.channel_id || '—'}</td>
                              <td>{formatDate(record.published_at)}</td>
                              <td>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px' }}>
                                  <span>{record.views != null ? `${record.views.toLocaleString('pt-BR')} views` : '—'}</span>
                                  <span>{record.likes != null ? `${record.likes.toLocaleString('pt-BR')} likes` : '—'}</span>
                                  <span>{record.comments != null ? `${record.comments.toLocaleString('pt-BR')} com.` : '—'}</span>
                                  <span>Duração: {formatDuration(record.duration_seconds)}</span>
                                </div>
                              </td>
                              <td>{formatDate(record.retrieved_at)}</td>
                              <td>
                                {isEligible ? (
                                  <span className="tag good">Elegível</span>
                                ) : (
                                  <span
                                    className="tag bad"
                                    title={elig?.reasons.map(formatReason).join(', ') || 'Inelegível'}
                                  >
                                    Inelegível: {elig?.reasons.map(formatReason).join(', ') || 'Critério não atendido'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>

                <article className="card">
                  <p className="eyebrow accent">NOVA ANÁLISE EDITORIAL</p>
                  <h3>Iniciar análise a partir do Radar</h3>
                  <p className="muted">
                    Configure os parâmetros do canal e o objetivo editorial para gerar uma nova proposta no pipeline.
                  </p>

                  <div className="form-row">
                    <label>
                      Identificador do canal
                      <input
                        value={channelId}
                        onChange={e => setChannelId(e.target.value)}
                        placeholder="Ex.: canal-01"
                        maxLength={64}
                        pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                      />
                    </label>
                    <label>
                      Resumo editorial do canal
                      <textarea
                        value={channelSummary}
                        onChange={e => setChannelSummary(e.target.value)}
                        placeholder="Diretrizes do canal, público e tom editorial..."
                        maxLength={4000}
                        rows={2}
                      />
                    </label>
                  </div>

                  <label>
                    Objetivo editorial da análise
                    <textarea
                      value={objective}
                      onChange={e => setObjective(e.target.value)}
                      placeholder="Objetivo e escopo desta análise..."
                      maxLength={4000}
                      rows={3}
                    />
                  </label>

                  <div className="actions">
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        !connection ||
                        selectedSources.size === 0 ||
                        !objective.trim() ||
                        !channelId.trim() ||
                        !channelSummary.trim()
                      }
                      onClick={() => void handleStartAnalysis()}
                    >
                      Iniciar análise
                    </button>
                    {selectedSources.size === 0 && (
                      <small className="muted">Selecione pelo menos um vídeo elegível.</small>
                    )}
                  </div>
                </article>

                {workflowCreated && (
                  <article className="card sunken" role="status" aria-live="polite">
                    <div className="row spread">
                      <p className="eyebrow good">ANÁLISE INICIADA COM SUCESSO</p>
                      <span className="tag good">WORKFLOW ID: {workflowCreated.id}</span>
                    </div>
                    <p>
                      O pedido foi enfileirado no pipeline editorial. Acompanhe a execução e autorização na página{' '}
                      <strong>Produção</strong>.
                    </p>
                    {workflowCreated.radar && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <p className="eyebrow">ITENS PROCESSADOS PELO RADAR</p>
                        <p className="muted">
                          <strong>{workflowCreated.radar.included.length} incluídos:</strong>{' '}
                          {workflowCreated.radar.included.join(', ') || 'Nenhum'}
                        </p>
                        {workflowCreated.radar.excluded.length > 0 && (
                          <div className="error" style={{ fontSize: '12px' }}>
                            <strong>{workflowCreated.radar.excluded.length} excluídos:</strong>
                            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                              {workflowCreated.radar.excluded.map(ex => (
                                <li key={ex.source_id}>
                                  {ex.source_id}: {ex.reasons.map(formatReason).join(', ')}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                )}
              </>
            )}
          </main>
        </div>
      )}
    </section>
  );
}
