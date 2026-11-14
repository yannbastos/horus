import { useEffect, useState } from 'react';
import type { FailureDetail } from '../../services/production';
import { formatElapsed, STAGE_TEXT } from './ProductionProgress';

function formatFailureDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds >= 60) return formatElapsed(seconds);
  const rounded = seconds.toFixed(2).replace(/\.?0+$/, '');
  return `${rounded} s`;
}

function buildDiagnosticText(failure: FailureDetail, errorMessage?: string | null): string {
  const stageLabel = STAGE_TEXT[failure.stage] ?? (failure.stage || '—');
  const stageLine = failure.stage && STAGE_TEXT[failure.stage]
    ? `${stageLabel} (${failure.stage})`
    : stageLabel;
  const lines = [
    errorMessage ? `Mensagem: ${errorMessage}` : null,
    `Etapa: ${stageLine}`,
    `Código: ${failure.code}`,
    `Tipo: ${failure.type}`,
    `Duração: ${formatFailureDuration(failure.duration_seconds)}`,
    `Código de saída: ${failure.exit_code !== null ? String(failure.exit_code) : '—'}`,
    '',
    'stderr_tail:',
    failure.stderr_tail || '(vazio)',
  ].filter((line): line is string => line !== null);
  return lines.join('\n');
}

/** Bloco recolhido por padrão com diagnóstico técnico estruturado e cópia local. */
export default function FailureDiagnostics({
  failure,
  error,
}: {
  failure: FailureDetail | null | undefined;
  error?: string | null;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  if (!failure) return null;

  const stageLabel = STAGE_TEXT[failure.stage] ?? (failure.stage || '—');
  const durationLabel = formatFailureDuration(failure.duration_seconds);
  const exitCodeLabel = failure.exit_code !== null ? String(failure.exit_code) : '—';

  async function handleCopy() {
    if (!failure) return;
    const text = buildDiagnosticText(failure, error);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  return (
    <details className="failure-diagnostics">
      <summary>Diagnóstico técnico</summary>
      <div className="stack" style={{ marginTop: '8px' }}>
        <div className="info-grid">
          <div className="info-block">
            <span className="eyebrow">ETAPA</span>
            <span>{stageLabel}</span>
          </div>
          <div className="info-block">
            <span className="eyebrow">CÓDIGO</span>
            <code>{failure.code}</code>
          </div>
          <div className="info-block">
            <span className="eyebrow">DURAÇÃO</span>
            <span>{durationLabel}</span>
          </div>
          <div className="info-block">
            <span className="eyebrow">CÓDIGO DE SAÍDA</span>
            <span>{exitCodeLabel}</span>
          </div>
        </div>

        <pre
          className="logs failure-diagnostics-stderr"
          aria-label="Saída de erro técnica"
        >
          {failure.stderr_tail || 'Sem saída de erro capturada.'}
        </pre>

        <div className="actions">
          <button
            className="button"
            type="button"
            onClick={() => void handleCopy()}
          >
            Copiar diagnóstico
          </button>
          {copyState === 'copied' && (
            <span className="muted" role="status" aria-live="polite">
              Diagnóstico copiado.
            </span>
          )}
          {copyState === 'error' && (
            <span className="muted" role="status" aria-live="polite">
              Não foi possível copiar para a área de transferência.
            </span>
          )}
        </div>
      </div>
    </details>
  );
}
