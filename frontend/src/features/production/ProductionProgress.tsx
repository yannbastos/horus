import { useEffect, useState } from 'react';
import type { JobEvent } from '../../services/api';

/** Etapa interna -> rótulo em português (inclui `align`, que não faz parte da trilha de 7 etapas). */
export const STAGE_TEXT: Record<string, string> = {
  prepare: 'Preparação',
  narration: 'Narração',
  scenes: 'Cenas',
  align: 'Alinhando fala',
  subtitles: 'Legendas',
  render: 'Render',
  quality: 'Qualidade (QC)',
  review: 'Revisão',
};

export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`;
}

const STATE_TEXT: Record<string, string> = {
  queued: 'na fila',
  running: 'em execução',
  succeeded: 'concluído',
  failed: 'falhou',
  cancelled: 'cancelado',
  interrupted: 'interrompido',
  blocked: 'bloqueado',
};

/** Traduz um evento do job mantendo o valor técnico entre parênteses para auditoria. */
export function describeJobEvent(event: Pick<JobEvent, 'kind' | 'message'>): string {
  if (event.kind === 'stage' && STAGE_TEXT[event.message]) {
    return `etapa: ${STAGE_TEXT[event.message]} (stage: ${event.message})`;
  }
  if (event.kind === 'state' && STATE_TEXT[event.message]) {
    return `estado: ${STATE_TEXT[event.message]} (${event.message})`;
  }
  return `${event.kind === 'state' ? 'estado' : event.kind}: ${event.message}`;
}

function parse(iso: string): number | null {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Progresso das esperas longas: etapa atual, tempo decorrido e última atualização do job.
 * Sem porcentagem: o backend não informa progresso mensurável dentro de cada etapa.
 */
export default function ProductionProgress({
  stage,
  status,
  createdAt,
  updatedAt,
  lastEvent,
  terminal,
  showNarrationHint,
}: {
  stage: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastEvent: JobEvent | null;
  terminal: boolean;
  showNarrationHint: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [terminal]);

  const start = parse(createdAt);
  const end = terminal ? parse(updatedAt) : now;
  const elapsed = start !== null && end !== null ? formatElapsed((end - start) / 1000) : null;
  const sinceUpdate = (() => {
    const updated = parse(updatedAt);
    return !terminal && updated !== null ? formatElapsed((now - updated) / 1000) : null;
  })();

  return (
    <div className="fact-item" role="status" aria-label="Progresso da execução">
      <span className="eyebrow">{terminal ? 'RESUMO DA EXECUÇÃO' : 'PROGRESSO DA EXECUÇÃO'}</span>
      <div className="info-grid">
        <div className="info-block">
          <span className="eyebrow">ETAPA ATUAL</span>
          <span>{STAGE_TEXT[stage] ?? stage}</span>
        </div>
        <div className="info-block">
          <span className="eyebrow">{terminal ? 'DURAÇÃO TOTAL' : 'TEMPO DECORRIDO'}</span>
          <span>{elapsed ?? '—'}</span>
        </div>
        <div className="info-block">
          <span className="eyebrow">ÚLTIMA ATUALIZAÇÃO DO JOB</span>
          <span>
            {lastEvent ? describeJobEvent(lastEvent) : `estado ${status}`}
            {sinceUpdate ? ` · registro de estado há ${sinceUpdate}` : ''}
          </span>
        </div>
      </div>
      {!terminal && (
        <small className="muted">
          O backend não informa porcentagem dentro de cada etapa: o tempo decorrido é medido desde o
          disparo e uma etapa pode ficar parada por mais de 1 minuto sem indicar travamento.
          {showNarrationHint &&
            ' A narração local (ex.: Kokoro) pode levar mais de 1 minuto só na primeira seção.'}
        </small>
      )}
    </div>
  );
}
