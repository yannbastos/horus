import React from 'react';
import type { SecurityBlocker } from '../services/api';

export type BadgeState = 'active' | 'blocked' | 'unverified' | 'unavailable';

export const BADGE_META: Record<BadgeState, { label: string; tone: string; meaning: string }> = {
  active: { label: 'ATIVO', tone: 'good', meaning: 'O diagnóstico confirma que está em vigor.' },
  blocked: { label: 'BLOQUEADO', tone: 'bad', meaning: 'O Hórus impede esta ação.' },
  unverified: {
    label: 'NÃO VERIFICADO',
    tone: 'warn',
    meaning: 'O diagnóstico não confirmou; nenhuma proteção é presumida.',
  },
  unavailable: {
    label: 'NÃO DISPONÍVEL',
    tone: '',
    meaning: 'Ainda não implementado nesta versão; sem controles.',
  },
};

/** Único selo de estado da tela: texto + glifo (não depende só de cor). */
export function StatusBadge({
  state,
  reason,
  className = '',
}: {
  state: BadgeState;
  reason?: string;
  className?: string;
}) {
  const meta = BADGE_META[state];
  return (
    <span
      className={`tag status-badge ${meta.tone} ${className}`.trim()}
      data-state={state}
      title={reason}
    >
      {meta.label}
    </span>
  );
}

export function AvailabilityBadge({
  available,
  reason,
  className = '',
}: {
  available: boolean;
  reason?: string;
  className?: string;
}) {
  return <StatusBadge state={available ? 'active' : 'unavailable'} reason={reason} className={className} />;
}

export function UnverifiedBadge({ reason }: { reason?: string }) {
  return (
    <span className="unverified-badge-wrapper">
      <StatusBadge state="unverified" />
      {reason && <span className="muted small unverified-reason">{reason}</span>}
    </span>
  );
}

export function StatusLegend() {
  const states: BadgeState[] = ['active', 'blocked', 'unverified', 'unavailable'];
  return (
    <section className="status-legend" aria-labelledby="status-legend-title">
      <h2 id="status-legend-title" className="legend-title">
        Legenda dos selos
      </h2>
      <dl className="legend-list">
        {states.map(state => (
          <div key={state} className="legend-item">
            <dt>
              <StatusBadge state={state} />
            </dt>
            <dd className="muted small">{BADGE_META[state].meaning}</dd>
          </div>
        ))}
      </dl>
    </section>
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

export type HermesToolsSummary = {
  restricted: boolean | null;
  total: number;
  dangerous: number;
} | null;

function hermesProfileLine(tools: HermesToolsSummary): string {
  if (!tools) return 'Não verificado: o diagnóstico não inspecionou as ferramentas do perfil.';
  const count = `${tools.total} ${tools.total === 1 ? 'ferramenta efetiva' : 'ferramentas efetivas'}`;
  if (tools.restricted === true) {
    return `Perfil informado como restrito, com ${count}${
      tools.dangerous > 0 ? ` (${tools.dangerous} de alto risco)` : ''
    }.`;
  }
  if (tools.restricted === false) {
    return `Perfil não restrito, com ${count}${
      tools.dangerous > 0 ? ` (${tools.dangerous} de alto risco)` : ''
    }.`;
  }
  return `Restrição do perfil não informada; ${count} listadas abaixo.`;
}

export function SummaryBanner({
  realExecutionAllowed,
  blockers,
  tools = null,
}: {
  realExecutionAllowed: boolean;
  blockers: SecurityBlocker[];
  tools?: HermesToolsSummary;
}) {
  const criticalBlockers = blockers.filter(b => b.severity === 'critical');
  const profileNotRestricted = tools !== null && tools.restricted !== true && tools.total > 0;

  return (
    <section
      className={`summary-banner ${realExecutionAllowed ? 'allowed' : 'blocked'}`}
      aria-label="Resumo de execução e segurança"
      role="status"
    >
      <div className="row spread">
        <div className="summary-status-header">
          <span className={`status-dot ${realExecutionAllowed ? 'good' : 'bad'}`} aria-hidden="true" />
          <h2 className="summary-title">
            {realExecutionAllowed
              ? 'Execução real do Hermes permitida'
              : 'Execução real do Hermes bloqueada'}
          </h2>
        </div>
        <StatusBadge state={realExecutionAllowed ? 'active' : 'blocked'} />
      </div>

      <dl className="summary-split">
        <div className="summary-split-item">
          <dt className="eyebrow">O QUE O HÓRUS BLOQUEIA</dt>
          <dd>
            {realExecutionAllowed
              ? 'Nenhum bloqueio crítico informado: o Hórus pode enviar execuções reais ao Hermes.'
              : 'O envio de execuções reais ao Hermes, enquanto houver bloqueios críticos.'}
          </dd>
        </div>
        <div className="summary-split-item">
          <dt className="eyebrow">O QUE O PERFIL HERMES PERMITE</dt>
          <dd>
            {hermesProfileLine(tools)}
            {!realExecutionAllowed && profileNotRestricted
              ? ' O bloqueio do Hórus não altera o perfil: essas ferramentas seguem habilitadas nele.'
              : ''}
          </dd>
        </div>
      </dl>

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
  'Mídia',
  'Outras',
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export function categorizeTool(toolName: string): ToolCategory {
  const name = toolName.toLowerCase();

  // 1. Memória (inclui busca e listagem em sessões, histórico e contexto)
  if (
    ['memory', 'todo', 'session', 'profile', 'remember', 'recall'].some(k => name.includes(k))
  ) {
    return 'Memória';
  }

  // 2. Web e navegador (inclui browser_exec e pesquisas web)
  if (
    ['browser', 'web', 'curl', 'http', 'url', 'download', 'fetch', 'scrape', 'navigate', 'search'].some(k =>
      name.includes(k)
    )
  ) {
    return 'Web e navegador';
  }

  // 3. Execução de código (execute_code, python, repl, script, sandbox, etc.)
  if (
    ['code', 'python', 'eval', 'jupyter', 'sandbox', 'interpreter', 'script', 'repl'].some(k =>
      name.includes(k)
    )
  ) {
    return 'Execução de código';
  }

  // 4. Mídia (image_generate, vision_analyze, áudio, vídeo, etc.)
  if (
    ['image', 'vision', 'audio', 'video', 'media', 'speech', 'transcribe', 'tts', 'stt'].some(k =>
      name.includes(k)
    )
  ) {
    return 'Mídia';
  }

  // 5. Skills e conectores (gerenciamento de conexões, skills, MCP)
  if (
    ['skill', 'mcp', 'plugin', 'connector', 'connection'].some(k =>
      name.includes(k)
    )
  ) {
    return 'Skills e conectores';
  }

  // 6. Delegação e agendamento (subagentes, tarefas, workers, cron)
  if (
    ['agent', 'subagent', 'delegate', 'schedule', 'cron', 'task', 'dispatch', 'worker', 'swarm'].some(k =>
      name.includes(k)
    )
  ) {
    return 'Delegação e agendamento';
  }

  // 7. Arquivos (leitura, escrita, listagem no sistema de arquivos)
  if (
    ['file', 'read_file', 'write_file', 'edit_file', 'list_dir', 'filesystem', 'directory', 'fs'].some(k =>
      name.includes(k)
    )
  ) {
    return 'Arquivos';
  }

  // 8. Comandos e processos (terminal, shell, bash, CLI)
  if (
    ['terminal', 'bash', 'shell', 'exec', 'process', 'run_command', 'cmd', 'command', 'cli', 'system'].some(k =>
      name.includes(k)
    )
  ) {
    return 'Comandos e processos';
  }

  // 9. Outras (ferramentas desconhecidas nunca são omitidas)
  return 'Outras';
}

/** Uma linha sobre o que cada categoria pode fazer. Descreve capacidade, não proteção. */
export const TOOL_CATEGORY_RISK: Record<ToolCategory, string> = {
  'Comandos e processos': 'Pode rodar comandos e processos na máquina do usuário.',
  'Arquivos': 'Pode ler ou alterar arquivos acessíveis ao perfil.',
  'Execução de código': 'Pode executar código gerado pelo próprio agente.',
  'Web e navegador': 'Pode acessar a internet e trocar dados com serviços externos.',
  'Delegação e agendamento': 'Pode criar subagentes e tarefas agendadas.',
  'Skills e conectores': 'Pode ampliar o agente com skills e conexões de terceiros.',
  'Memória': 'Pode ler e gravar contexto persistente do agente.',
  'Mídia': 'Pode processar imagens, áudio e vídeo.',
  'Outras': 'Categoria não reconhecida pelo Hórus; avalie cada ferramenta.',
};
