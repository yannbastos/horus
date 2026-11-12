import React from 'react';
import type { SecurityBlocker } from '../services/api';

export function AvailabilityBadge({
  available,
  reason,
  className = '',
}: {
  available: boolean;
  reason?: string;
  className?: string;
}) {
  if (!available) {
    return (
      <span className={`tag ${className}`} title={reason}>
        NÃO DISPONÍVEL
      </span>
    );
  }
  return (
    <span className={`tag good ${className}`}>
      DISPONÍVEL
    </span>
  );
}

export function UnverifiedBadge({ reason }: { reason?: string }) {
  return (
    <span className="unverified-badge-wrapper">
      <span className="tag warn">NÃO VERIFICADO</span>
      {reason && <span className="muted small unverified-reason">{reason}</span>}
    </span>
  );
}

export function BlockerList({
  blockers,
  title = 'Bloqueios e restrições',
}: {
  blockers: SecurityBlocker[];
  title?: string;
}) {
  if (blockers.length === 0) {
    return (
      <div className="blocker-list-container">
        {title && <p className="eyebrow">{title}</p>}
        <p className="muted small">Nenhum bloqueio de segurança detectado.</p>
      </div>
    );
  }

  return (
    <div className="blocker-list-container" aria-label={title}>
      {title && <p className="eyebrow">{title}</p>}
      <ul className="blocker-items-list">
        {blockers.map((b, idx) => {
          const isCritical = b.severity === 'critical';
          const isWarning = b.severity === 'warning';
          const tagClass = isCritical ? 'bad' : isWarning ? 'warn' : '';
          const tagLabel = isCritical ? 'CRÍTICO' : isWarning ? 'AVISO' : 'INFO';
          return (
            <li key={`${b.code}-${idx}`} className={`blocker-item ${b.severity}`}>
              <div className="row spread">
                <span className={`tag ${tagClass}`}>{tagLabel}</span>
                <code className="blocker-code">{b.code}</code>
              </div>
              <p className="blocker-message">{b.message}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function StatusCard({
  eyebrow,
  title,
  subtitle,
  badge,
  children,
  className = '',
  ariaLabel,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <section className={`card ${className}`} aria-label={ariaLabel || title}>
      <div className="row spread card-header-row">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {badge && <div className="card-badge-wrap">{badge}</div>}
      </div>
      {children}
    </section>
  );
}

export function SummaryBanner({
  realExecutionAllowed,
  blockers,
}: {
  realExecutionAllowed: boolean;
  blockers: SecurityBlocker[];
}) {
  const criticalBlockers = blockers.filter(b => b.severity === 'critical');

  return (
    <section
      className={`summary-banner ${realExecutionAllowed ? 'allowed' : 'blocked'}`}
      aria-label="Resumo de execução e segurança"
      role="status"
    >
      <div className="row spread">
        <div className="summary-status-header">
          <span className={`status-dot ${realExecutionAllowed ? 'good' : 'bad'}`} />
          <h2 className="summary-title">
            {realExecutionAllowed
              ? 'Execução real do Hermes permitida'
              : 'Execução real do Hermes bloqueada'}
          </h2>
        </div>
        <span className={`tag ${realExecutionAllowed ? 'good' : 'bad'}`}>
          {realExecutionAllowed ? 'EXECUÇÃO LIBERADA' : 'EXECUÇÃO BLOQUEADA'}
        </span>
      </div>
      <p className="muted">
        {realExecutionAllowed
          ? 'O Hórus autoriza o envio de execuções ao Hermes. As ferramentas disponíveis dependem da configuração do perfil ativo.'
          : 'O Hórus não autoriza execuções reais do Hermes enquanto houver bloqueios críticos. Isso não restringe o perfil Hermes em si: as ferramentas listadas abaixo continuam habilitadas nele.'}
      </p>

      {criticalBlockers.length > 0 && (
        <section className="critical-blockers-highlight" aria-label="Bloqueios críticos">
          <p className="eyebrow bad">BLOQUEIOS CRÍTICOS EM DESTAQUE</p>
          <ul className="critical-blockers-list">
            {criticalBlockers.map((b, idx) => (
              <li key={`${b.code}-${idx}`} className="critical-blocker-item">
                <span className="tag bad">CRÍTICO</span>
                <strong>{b.code}</strong>: <span>{b.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

export const TOOL_CATEGORIES = [
  'Comandos e processos',
  'Arquivos',
  'Execução de código',
  'Web e navegador',
  'Delegação e agendamento',
  'Skills e conectores',
  'Memória',
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export function categorizeTool(toolName: string): ToolCategory {
  const name = toolName.toLowerCase();

  // Comandos e processos
  if (
    ['terminal', 'bash', 'shell', 'exec', 'process', 'run_command', 'cmd', 'command', 'cli', 'system'].some(k =>
      name.includes(k)
    )
  ) {
    return 'Comandos e processos';
  }

  // Arquivos
  if (
    ['file', 'read_file', 'write_file', 'edit_file', 'list_dir', 'filesystem', 'directory', 'fs'].some(k =>
      name.includes(k)
    )
  ) {
    return 'Arquivos';
  }

  // Execução de código
  if (['python', 'code', 'eval', 'jupyter', 'sandbox', 'interpreter', 'script'].some(k => name.includes(k))) {
    return 'Execução de código';
  }

  // Web e navegador
  if (['web', 'browser', 'search', 'fetch', 'http', 'curl', 'url', 'download'].some(k => name.includes(k))) {
    return 'Web e navegador';
  }

  // Delegação e agendamento
  if (
    ['agent', 'subagent', 'delegate', 'schedule', 'cron', 'task', 'dispatch', 'worker', 'swarm'].some(k =>
      name.includes(k)
    )
  ) {
    return 'Delegação e agendamento';
  }

  // Memória
  if (['memory', 'user_profile', 'profile', 'remember', 'recall', 'store_memory'].some(k => name.includes(k))) {
    return 'Memória';
  }

  // Skills e conectores (fallback)
  return 'Skills e conectores';
}
