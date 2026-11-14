import { useEffect, useMemo, useState } from 'react';
import type { JobStatus } from '../../services/api';
import type { ProductionMode, ProductionRecord } from '../../services/production';
import {
  deriveProductionProvenance,
  describeVoiceAssets,
  normalizeQualityReport,
  normalizeWordTimings,
} from '../../services/production';

const MODE_SHORT_LABELS: Record<ProductionMode, string> = {
  simulated: 'Simulado',
  local_demo: 'Demo local',
  local_pilot: 'Piloto local',
};

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Na fila',
  running: 'Em execução',
  cancel_requested: 'Cancelamento solicitado',
  succeeded: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
  interrupted: 'Interrompida',
  blocked: 'Bloqueada',
};

export type ProductionComparisonSummary = {
  scriptVersion: string;
  modeLabel: string;
  voice: string;
  renderQuality: string;
  duration: string;
  qcSummary: string;
  qcTone: string;
  reviewState: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readVoiceLabel(record: ProductionRecord): string {
  if (isRecord(record.narration)) {
    const voiceId = typeof record.narration.voice_id === 'string' ? record.narration.voice_id.trim() : '';
    const provider = typeof record.narration.provider === 'string' ? record.narration.provider.trim() : '';
    if (voiceId && provider) return `${voiceId} (${provider})`;
    if (voiceId) return voiceId;
  }

  if (isRecord(record.asset_provenance) && Array.isArray(record.asset_provenance.assets)) {
    const described = describeVoiceAssets(record.asset_provenance.assets);
    if (described && described !== 'voz local') return described;
  }

  const wordTimings = normalizeWordTimings(record);
  if (wordTimings.engineVoice) {
    return wordTimings.engineVoice;
  }

  const provenance = deriveProductionProvenance(record);
  if (provenance.narrationVoice) {
    return provenance.narrationVoice;
  }
  if (provenance.narrationKind === 'fixture_tone') {
    return 'Tom sintético (fixture)';
  }
  if (record.mode === 'simulated') {
    return 'Simulada (sem voz real)';
  }
  return 'Não informado';
}

function readRenderQualityLabel(record: ProductionRecord): string {
  const raw =
    (typeof record.render_quality === 'string' ? record.render_quality : null) ??
    (isRecord(record.pilot_evidence) && typeof record.pilot_evidence.render_quality === 'string'
      ? record.pilot_evidence.render_quality
      : null);

  if (raw === 'final') return 'Final';
  if (raw === 'draft') return 'Rascunho';
  if (record.mode === 'simulated') return 'Não aplicável (simulado)';
  return 'Não informado';
}

function readDurationLabel(record: ProductionRecord): string {
  const wordTimings = normalizeWordTimings(record);
  if (wordTimings.durationSeconds !== null) {
    return `${wordTimings.durationSeconds.toFixed(1)}s`;
  }

  if (isRecord(record.word_timings) && typeof record.word_timings.duration_seconds === 'number' && Number.isFinite(record.word_timings.duration_seconds)) {
    return `${record.word_timings.duration_seconds.toFixed(1)}s`;
  }

  const provenance = deriveProductionProvenance(record);
  if (provenance.narrationDurationSeconds !== null) {
    return `${provenance.narrationDurationSeconds.toFixed(1)}s`;
  }

  if (isRecord(record.quality_report) && Array.isArray(record.quality_report.checks)) {
    for (const check of record.quality_report.checks) {
      if (isRecord(check) && check.category === 'duration' && isRecord(check.measured)) {
        const val = check.measured.duration_seconds ?? check.measured.video_duration_seconds;
        if (typeof val === 'number' && Number.isFinite(val)) {
          return `${val.toFixed(1)}s`;
        }
      }
    }
  }

  return 'Não informado';
}

function readQcSummary(record: ProductionRecord): { label: string; tone: string } {
  if (!isRecord(record.quality_report)) {
    return { label: 'Não informado', tone: '' };
  }
  const quality = normalizeQualityReport(record);
  if (!quality.executed || quality.overallStatus === 'not_run') {
    return { label: 'Não executado', tone: 'warn' };
  }

  const failCount = Math.max(quality.failCount, quality.blockingErrors.length);
  const warnCount = Math.max(quality.warnCount, quality.warnings.length);

  if (failCount > 0 || quality.overallStatus === 'fail') {
    return { label: `Reprovado (${failCount} fail, ${warnCount} warn)`, tone: 'bad' };
  }
  if (warnCount > 0 || quality.overallStatus === 'warn') {
    return { label: `Atenção (${warnCount} warn, 0 fail)`, tone: 'warn' };
  }
  return { label: 'Aprovado (0 fail, 0 warn)', tone: 'good' };
}

function readReviewStateLabel(record: ProductionRecord): string {
  if (record.review?.decision === 'approve') return 'Aprovada';
  if (record.review?.decision === 'reject') return 'Rejeitada';
  if (record.status === 'succeeded') return 'Aguardando revisão';
  return 'Sem revisão';
}

export function summarizeProductionForCompare(record: ProductionRecord): ProductionComparisonSummary {
  const qc = readQcSummary(record);
  return {
    scriptVersion: Number.isFinite(record.script_version) ? `v${record.script_version}` : 'Não informado',
    modeLabel: MODE_SHORT_LABELS[record.mode] || record.mode,
    voice: readVoiceLabel(record),
    renderQuality: readRenderQualityLabel(record),
    duration: readDurationLabel(record),
    qcSummary: qc.label,
    qcTone: qc.tone,
    reviewState: readReviewStateLabel(record),
  };
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export default function ProductionCompare({
  productions,
  activeProductionId,
  onOpenProduction,
}: {
  productions: ProductionRecord[];
  activeProductionId: string | null;
  onOpenProduction: (record: ProductionRecord) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    const validIds = new Set(productions.map(p => p.id));
    setSelectedIds(prev => prev.filter(id => validIds.has(id)));
  }, [productions]);

  const summaries = useMemo(() => {
    const map = new Map<string, ProductionComparisonSummary>();
    for (const item of productions) {
      map.set(item.id, summarizeProductionForCompare(item));
    }
    return map;
  }, [productions]);

  const prodA = useMemo(
    () => (selectedIds[0] ? productions.find(p => p.id === selectedIds[0]) ?? null : null),
    [productions, selectedIds]
  );
  const prodB = useMemo(
    () => (selectedIds[1] ? productions.find(p => p.id === selectedIds[1]) ?? null : null),
    [productions, selectedIds]
  );

  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      }
      if (prev.length < 2) {
        return [...prev, id];
      }
      return [prev[1], id];
    });
  }

  if (productions.length === 0) return null;

  const summaryA = prodA ? summaries.get(prodA.id) ?? null : null;
  const summaryB = prodB ? summaries.get(prodB.id) ?? null : null;

  const comparisonRows: Array<{
    label: string;
    valA: string;
    valB: string;
    toneA?: string;
    toneB?: string;
  }> =
    summaryA && summaryB
      ? [
          { label: 'Versão do roteiro', valA: summaryA.scriptVersion, valB: summaryB.scriptVersion },
          { label: 'Modo', valA: summaryA.modeLabel, valB: summaryB.modeLabel },
          { label: 'Voz', valA: summaryA.voice, valB: summaryB.voice },
          { label: 'Qualidade', valA: summaryA.renderQuality, valB: summaryB.renderQuality },
          { label: 'Duração', valA: summaryA.duration, valB: summaryB.duration },
          {
            label: 'Resumo do QC',
            valA: summaryA.qcSummary,
            valB: summaryB.qcSummary,
            toneA: summaryA.qcTone,
            toneB: summaryB.qcTone,
          },
          { label: 'Estado da revisão', valA: summaryA.reviewState, valB: summaryB.reviewState },
        ]
      : [];

  return (
    <div
      role="region"
      aria-label="Histórico de execuções da produção"
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      <div className="row spread">
        <p className="eyebrow">HISTÓRICO DE EXECUÇÕES DESTE ROTEIRO ({productions.length})</p>
        {productions.length >= 2 && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {selectedIds.length < 2 && (
              <button
                type="button"
                className="button"
                onClick={() => setSelectedIds([productions[1].id, productions[0].id])}
              >
                Comparar 2 mais recentes
              </button>
            )}
            {selectedIds.length > 0 && (
              <button
                type="button"
                className="button"
                onClick={() => setSelectedIds([])}
              >
                Limpar seleção
              </button>
            )}
          </div>
        )}
      </div>

      {productions.length === 1 && (
        <p className="muted" role="status">
          Apenas uma produção registrada para este roteiro. Execute outra produção para comparar.
        </p>
      )}

      {productions.length >= 2 && (
        <p className="muted" role="status">
          {selectedIds.length === 2
            ? 'Comparando 2 produções selecionadas abaixo (somente leitura).'
            : `Selecione 2 produções na tabela para comparar (${selectedIds.length}/2 selecionada(s)).`}
        </p>
      )}

      <div className="data-table-container">
        <table className="data-table" aria-label="Produções deste roteiro">
          <thead>
            <tr>
              {productions.length >= 2 && <th scope="col">Comparar</th>}
              <th scope="col">Produção</th>
              <th scope="col">Roteiro</th>
              <th scope="col">Voz</th>
              <th scope="col">Qualidade</th>
              <th scope="col">Duração</th>
              <th scope="col">Resumo do QC</th>
              <th scope="col">Revisão</th>
              <th scope="col">Ação</th>
            </tr>
          </thead>
          <tbody>
            {productions.map(item => {
              const isSelected = activeProductionId === item.id;
              const isChecked = selectedIds.includes(item.id);
              const summary = summaries.get(item.id)!;
              return (
                <tr key={item.id}>
                  {productions.length >= 2 && (
                    <td>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        aria-label={`Selecionar produção ${shortId(item.id)} para comparar`}
                        onChange={() => toggleSelection(item.id)}
                      />
                    </td>
                  )}
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span className="eyebrow accent" title={item.id}>
                        {shortId(item.id)}
                      </span>
                      <div className="row" style={{ flexWrap: 'wrap', gap: '4px' }}>
                        <span className={`tag ${item.mode === 'simulated' ? 'simulated' : 'demo'}`}>
                          {summary.modeLabel}
                        </span>
                        <span className="tag">
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>{summary.scriptVersion}</td>
                  <td>{summary.voice}</td>
                  <td>{summary.renderQuality}</td>
                  <td>{summary.duration}</td>
                  <td>
                    <span className={`tag ${summary.qcTone}`}>{summary.qcSummary}</span>
                  </td>
                  <td>{summary.reviewState}</td>
                  <td>
                    <button
                      type="button"
                      className={`button ${isSelected ? 'active' : ''}`}
                      style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                      onClick={() => onOpenProduction(item)}
                    >
                      {isSelected ? 'Exibindo' : 'Inspecionar'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {prodA && prodB && summaryA && summaryB && (
        <div
          className="card sunken"
          role="region"
          aria-label="Comparação entre duas produções"
          style={{ gap: '12px' }}
        >
          <div className="row spread">
            <div>
              <p className="eyebrow accent">COMPARAÇÃO DE PRODUÇÕES (SOMENTE LEITURA)</p>
              <h3>
                {shortId(prodA.id)} vs {shortId(prodB.id)}
              </h3>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className="button"
                onClick={() => onOpenProduction(prodA)}
              >
                Abrir produção A ({shortId(prodA.id)})
              </button>
              <button
                type="button"
                className="button"
                onClick={() => onOpenProduction(prodB)}
              >
                Abrir produção B ({shortId(prodB.id)})
              </button>
            </div>
          </div>

          <div className="data-table-container">
            <table className="data-table" aria-label="Tabela comparativa de produções">
              <thead>
                <tr>
                  <th scope="col">Campo</th>
                  <th scope="col">Produção A ({shortId(prodA.id)})</th>
                  <th scope="col">Produção B ({shortId(prodB.id)})</th>
                  <th scope="col">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map(row => {
                  const changed = row.valA !== row.valB;
                  return (
                    <tr key={row.label} className={changed ? 'compare-row-changed' : undefined}>
                      <th scope="row">{row.label}</th>
                      <td>
                        {row.toneA !== undefined ? (
                          <span className={`tag ${row.toneA}`}>{row.valA}</span>
                        ) : (
                          row.valA
                        )}
                      </td>
                      <td>
                        {row.toneB !== undefined ? (
                          <span className={`tag ${row.toneB}`}>{row.valB}</span>
                        ) : (
                          row.valB
                        )}
                      </td>
                      <td>
                        <span className={`tag ${changed ? 'warn' : ''}`}>
                          {changed ? 'Alterado' : 'Igual'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
