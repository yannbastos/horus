import { useEffect, useState } from 'react';
import type { Connection } from '../../services/api';
import {
  GUIDE_STATUS_LABEL,
  loadFirstVideoGuide,
} from '../../services/firstVideoGuide';
import type { FirstVideoGuideState, GuideStepStatus } from '../../services/firstVideoGuide';

const COLLAPSED_STORAGE_KEY = 'horus.first_video_guide.collapsed';

function readCollapsedPreference(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsedPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Funciona normalmente sem acesso ao localStorage.
  }
}

function statusTagClass(status: GuideStepStatus): string {
  if (status === 'done') return 'tag good';
  if (status === 'in_progress') return 'tag simulated';
  if (status === 'pending') return 'tag warn';
  return 'tag demo';
}

export default function FirstVideoGuide({
  connection,
  refreshKey = 0,
  onOpenSettings,
  onOpenProduction,
}: {
  connection: Connection | null;
  refreshKey?: number;
  onOpenSettings: () => void;
  onOpenProduction: () => void;
}) {
  const [state, setState] = useState<FirstVideoGuideState | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsedPreference());
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    if (!connection) {
      setState(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void loadFirstVideoGuide(connection, controller.signal)
      .then(loaded => {
        if (!controller.signal.aborted) setState(loaded);
      })
      .catch(() => {
        // AbortError ou falha inesperada fora das chamadas individuais.
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [connection, refreshKey]);

  if (!connection) return null;

  const isCompleted = state?.isCompleted === true;
  if (isCompleted && !reopened) {
    return (
      <div className="guide-reopen-bar" data-testid="first-video-guide-reopen">
        <span className="muted">Primeiro vídeo aprovado.</span>
        <button
          type="button"
          className="button"
          onClick={() => {
            setReopened(true);
            if (collapsed) {
              setCollapsed(false);
              writeCollapsedPreference(false);
            }
          }}
        >
          REABRIR GUIA “MEU PRIMEIRO VÍDEO”
        </button>
      </div>
    );
  }

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsedPreference(next);
  };

  const currentStepId = state?.steps.find(step => step.status !== 'done')?.id ?? null;

  return (
    <section
      className="card sunken guide-panel"
      aria-labelledby="first-video-guide-title"
      data-testid="first-video-guide"
    >
      <div className="row spread">
        <div>
          <p className="eyebrow accent">GUIA RÁPIDO</p>
          <h3 id="first-video-guide-title">Meu primeiro vídeo</h3>
          <p className="muted" role="status">
            {loading && !state
              ? 'Verificando etapas…'
              : state
                ? `${state.completedCount} de ${state.steps.length} passos concluídos.`
                : 'Acompanhamento das etapas do primeiro vídeo.'}
          </p>
        </div>
        <div className="actions">
          {isCompleted && (
            <button
              type="button"
              className="button"
              onClick={() => setReopened(false)}
            >
              OCULTAR GUIA
            </button>
          )}
          <button
            type="button"
            className="button"
            aria-expanded={!collapsed}
            aria-controls="first-video-guide-list"
            onClick={toggleCollapsed}
          >
            {collapsed ? 'EXPANDIR' : 'RECOLHER'}
          </button>
        </div>
      </div>

      {!collapsed && state && (
        <ol id="first-video-guide-list" className="guide-steps">
          {state.steps.map((step, index) => {
            const isCurrent = step.id === currentStepId;
            return (
              <li
                key={step.id}
                className={`guide-step${isCurrent ? ' current' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
                data-testid={`guide-step-${step.id}`}
              >
                <div className="guide-step-info">
                  <span className="eyebrow muted">{index + 1}.</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p className="muted small-text">{step.detail}</p>
                  </div>
                </div>
                <div className="guide-step-actions">
                  <span className={statusTagClass(step.status)}>
                    {GUIDE_STATUS_LABEL[step.status]}
                  </span>
                  <button
                    type="button"
                    className="button"
                    onClick={step.target === 'settings' ? onOpenSettings : onOpenProduction}
                    aria-label={`${step.actionLabel}: ${step.title}`}
                  >
                    {step.actionLabel.toUpperCase()}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
