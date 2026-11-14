import { useMemo, useState } from 'react';
import type { ScriptRecord, ScriptSectionKind, ScriptStatus } from '../../services/scripts';
import { getScriptOrigin } from '../../services/scripts';
import { compareScripts } from './wordDiff';
import type { DiffSegment, SectionDiffStatus } from './wordDiff';

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

const SECTION_STATUS_LABELS: Record<SectionDiffStatus, string> = {
  added: 'Seção adicionada',
  removed: 'Seção removida',
  changed: 'Seção alterada',
  unchanged: 'Sem alterações',
};

const SECTION_STATUS_TONE: Record<SectionDiffStatus, string> = {
  added: 'good',
  removed: 'bad',
  changed: 'warn',
  unchanged: '',
};

function formatOriginLabel(record: ScriptRecord): string {
  return getScriptOrigin(record) === 'human' ? 'Escrito por você' : 'Gerado pela simulação';
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString('pt-BR');
}

function DiffText({
  segments,
  filter,
}: {
  segments: DiffSegment[];
  filter?: 'all' | 'base' | 'target';
}) {
  return (
    <>
      {segments.map((seg, idx) => {
        if (filter === 'base' && seg.kind === 'added') return null;
        if (filter === 'target' && seg.kind === 'removed') return null;

        if (seg.kind === 'removed') {
          return (
            <del key={idx} className="diff-removed">
              <span className="sr-only">Removido: </span>
              {seg.text}
            </del>
          );
        }
        if (seg.kind === 'added') {
          return (
            <ins key={idx} className="diff-added">
              <span className="sr-only">Adicionado: </span>
              {seg.text}
            </ins>
          );
        }
        return <span key={idx}>{seg.text}</span>;
      })}
    </>
  );
}

export default function ScriptComparePanel({
  scripts,
  baseVersion,
  targetVersion,
  onChangeBaseVersion,
  onChangeTargetVersion,
  onClose,
}: {
  scripts: ScriptRecord[];
  baseVersion: number;
  targetVersion: number;
  onChangeBaseVersion: (version: number) => void;
  onChangeTargetVersion: (version: number) => void;
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<'side_by_side' | 'inline'>('side_by_side');

  const orderedAsc = useMemo(
    () => [...scripts].sort((a, b) => a.version - b.version),
    [scripts]
  );

  const baseScript = useMemo(
    () => scripts.find(s => s.version === baseVersion) ?? orderedAsc[0] ?? null,
    [scripts, orderedAsc, baseVersion]
  );

  const targetScript = useMemo(
    () => scripts.find(s => s.version === targetVersion) ?? orderedAsc[orderedAsc.length - 1] ?? null,
    [scripts, orderedAsc, targetVersion]
  );

  const comparison = useMemo(() => {
    if (!baseScript || !targetScript) return null;
    return compareScripts(baseScript, targetScript);
  }, [baseScript, targetScript]);

  if (scripts.length < 2 || !baseScript || !targetScript || !comparison) {
    return (
      <section
        className="card sunken"
        role="region"
        aria-label="Comparação de versões do roteiro"
      >
        <div className="row spread">
          <p className="eyebrow accent">COMPARAR VERSÕES DO ROTEIRO</p>
          <button type="button" className="button" onClick={onClose}>
            Fechar comparação
          </button>
        </div>
        <p className="muted" role="status">
          É necessário ter pelo menos duas versões do roteiro para comparar alterações.
        </p>
      </section>
    );
  }

  const summaryParts: string[] = [];
  if (comparison.titleChanged) summaryParts.push('Título alterado');
  if (comparison.addedCount > 0) summaryParts.push(`${comparison.addedCount} seção(ões) adicionada(s)`);
  if (comparison.removedCount > 0) summaryParts.push(`${comparison.removedCount} seção(ões) removida(s)`);
  if (comparison.changedCount > 0) summaryParts.push(`${comparison.changedCount} seção(ões) alterada(s)`);
  const summaryText =
    summaryParts.length > 0
      ? summaryParts.join(' · ')
      : 'Nenhuma diferença encontrada entre as versões selecionadas.';

  return (
    <section
      className="card sunken"
      role="region"
      aria-label="Comparação de versões do roteiro"
      style={{ gap: '16px' }}
    >
      <div className="row spread">
        <div>
          <p className="eyebrow accent">COMPARAR VERSÕES DO ROTEIRO</p>
          <h3>
            v{baseScript.version} vs v{targetScript.version}
          </h3>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="row" role="group" aria-label="Modo de visualização da comparação">
            <button
              type="button"
              className={`button ${layout === 'side_by_side' ? 'active' : ''}`}
              aria-pressed={layout === 'side_by_side'}
              onClick={() => setLayout('side_by_side')}
            >
              Lado a lado
            </button>
            <button
              type="button"
              className={`button ${layout === 'inline' ? 'active' : ''}`}
              aria-pressed={layout === 'inline'}
              onClick={() => setLayout('inline')}
            >
              Em linha
            </button>
          </div>
          <button type="button" className="button" onClick={onClose}>
            Fechar comparação
          </button>
        </div>
      </div>

      <div className="compare-grid">
        <label>
          Versão base (anterior)
          <select
            value={baseScript.version}
            onChange={e => onChangeBaseVersion(Number(e.target.value))}
          >
            {orderedAsc.map(item => (
              <option key={item.id} value={item.version}>
                v{item.version} · {formatOriginLabel(item)} · {SCRIPT_STATUS_LABELS[item.status] || item.status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Versão comparada (nova)
          <select
            value={targetScript.version}
            onChange={e => onChangeTargetVersion(Number(e.target.value))}
          >
            {orderedAsc.map(item => (
              <option key={item.id} value={item.version}>
                v{item.version} · {formatOriginLabel(item)} · {SCRIPT_STATUS_LABELS[item.status] || item.status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="data-table-container">
        <table className="data-table" aria-label="Metadados das versões comparadas">
          <thead>
            <tr>
              <th scope="col">Versão</th>
              <th scope="col">Origem</th>
              <th scope="col">Status de aprovação</th>
              <th scope="col">Criado em</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Base · v{baseScript.version}</th>
              <td>
                <span className={`tag ${getScriptOrigin(baseScript) === 'simulated' ? 'simulated' : ''}`}>
                  {formatOriginLabel(baseScript)}
                </span>
              </td>
              <td>
                <span className={`tag ${SCRIPT_STATUS_TONE[baseScript.status] || ''}`}>
                  {SCRIPT_STATUS_LABELS[baseScript.status] || baseScript.status}
                </span>
              </td>
              <td>{formatDate(baseScript.created_at)}</td>
            </tr>
            <tr>
              <th scope="row">Comparada · v{targetScript.version}</th>
              <td>
                <span className={`tag ${getScriptOrigin(targetScript) === 'simulated' ? 'simulated' : ''}`}>
                  {formatOriginLabel(targetScript)}
                </span>
              </td>
              <td>
                <span className={`tag ${SCRIPT_STATUS_TONE[targetScript.status] || ''}`}>
                  {SCRIPT_STATUS_LABELS[targetScript.status] || targetScript.status}
                </span>
              </td>
              <td>{formatDate(targetScript.created_at)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="muted" role="status" aria-live="polite">
        <strong>Resumo:</strong> {summaryText}
      </p>

      <div className="fact-item" style={{ background: 'var(--Background)' }} role="group" aria-label="Comparação do título">
        <div className="row spread">
          <span className="eyebrow">TÍTULO DO ROTEIRO</span>
          <span className={`tag ${comparison.titleChanged ? 'warn' : ''}`}>
            {comparison.titleChanged ? 'Título alterado' : 'Título sem alterações'}
          </span>
        </div>
        {layout === 'inline' ? (
          <p style={{ fontSize: '16px', fontWeight: 600 }}>
            <DiffText segments={comparison.titleDiff} />
          </p>
        ) : (
          <div className="compare-grid">
            <div>
              <span className="eyebrow muted">Base (v{baseScript.version})</span>
              <p style={{ fontWeight: 600, marginTop: '4px' }}>
                <DiffText segments={comparison.titleDiff} filter="base" />
              </p>
            </div>
            <div>
              <span className="eyebrow muted">Comparada (v{targetScript.version})</span>
              <p style={{ fontWeight: 600, marginTop: '4px' }}>
                <DiffText segments={comparison.titleDiff} filter="target" />
              </p>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <p className="eyebrow">SEÇÕES COMPARADAS ({comparison.sections.length})</p>
        {comparison.sections.map(sec => {
          const refSection = sec.targetSection ?? sec.baseSection;
          if (!refSection) return null;

          return (
            <div
              key={`${sec.status}-${sec.id}`}
              className="fact-item"
              role="group"
              aria-label={`Seção ${refSection.heading} (${SECTION_STATUS_LABELS[sec.status]})`}
              style={{ background: 'var(--Background)' }}
            >
              <div className="row spread">
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <span className={`tag ${SECTION_STATUS_TONE[sec.status]}`}>
                    {SECTION_STATUS_LABELS[sec.status]}
                  </span>
                  {sec.moved && <span className="tag warn">Ordem alterada</span>}
                  {sec.kindChanged && sec.baseSection && sec.targetSection && (
                    <span className="tag warn">
                      Tipo: {SECTION_KIND_LABELS[sec.baseSection.kind]} → {SECTION_KIND_LABELS[sec.targetSection.kind]}
                    </span>
                  )}
                  <span className="eyebrow accent">
                    {SECTION_KIND_LABELS[refSection.kind] || refSection.kind}
                  </span>
                  <span className="eyebrow muted">({sec.id})</span>
                </div>
                {sec.sourcesChanged && (
                  <span className="tag warn">Fontes alteradas</span>
                )}
              </div>

              {layout === 'inline' ? (
                <>
                  <p style={{ fontWeight: 600 }}>
                    <DiffText segments={sec.headingDiff} />
                  </p>
                  <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                    <DiffText segments={sec.narrationDiff} />
                  </p>
                </>
              ) : (
                <div className="compare-grid">
                  <div className="fact-item" style={{ background: 'var(--Sunken)' }}>
                    <span className="eyebrow muted">Base (v{baseScript.version})</span>
                    {sec.baseSection ? (
                      <>
                        <strong>
                          <DiffText segments={sec.headingDiff} filter="base" />
                        </strong>
                        <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                          <DiffText segments={sec.narrationDiff} filter="base" />
                        </p>
                      </>
                    ) : (
                      <p className="muted">Seção ausente na v{baseScript.version}.</p>
                    )}
                  </div>
                  <div className="fact-item" style={{ background: 'var(--Sunken)' }}>
                    <span className="eyebrow muted">Comparada (v{targetScript.version})</span>
                    {sec.targetSection ? (
                      <>
                        <strong>
                          <DiffText segments={sec.headingDiff} filter="target" />
                        </strong>
                        <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                          <DiffText segments={sec.narrationDiff} filter="target" />
                        </p>
                      </>
                    ) : (
                      <p className="muted">Seção removida na v{targetScript.version}.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
