import type { CenterRow, LicenseState } from '../../services/productionCenter';

const LICENSE_LABEL: Record<LicenseState, string> = {
  verified: 'Verificadas',
  unverified: 'Não verificadas',
  unknown: 'não informado',
  not_applicable: 'Não se aplica ao modo',
};

function formatDate(iso: string | null): string {
  if (!iso) return 'não informado';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'não informado' : date.toLocaleString('pt-BR');
}

function blockerClass(kind: string): string {
  if (kind === 'action') return 'tag warn';
  if (kind === 'ended') return 'tag';
  if (kind === 'running') return 'tag simulated';
  return 'tag demo';
}

const KIND_LABEL: Record<string, string> = {
  action: 'Ação humana',
  running: 'Em andamento',
  ended: 'Encerrado',
  unknown: 'Não informado',
};

export default function CenterTable({ rows, onOpen }: { rows: CenterRow[]; onOpen: (row: CenterRow) => void }) {
  return (
    <div className="data-table-container">
      <table className="data-table" data-testid="production-center-table">
        <caption className="eyebrow" style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--Muted)' }}>
          Vídeos por etapa, do mais recentemente atualizado ao mais antigo
        </caption>
        <thead>
          <tr>
            <th scope="col">Vídeo</th>
            <th scope="col">Etapa</th>
            <th scope="col">Status</th>
            <th scope="col">Próximo bloqueio</th>
            <th scope="col">Licenças</th>
            <th scope="col">Atualização</th>
            <th scope="col">Ação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.workflowId} data-testid={`center-row-${row.workflowId}`}>
              <th scope="row" style={{ background: 'transparent', textTransform: 'none', letterSpacing: 0, color: 'var(--Ink)', font: 'inherit', whiteSpace: 'normal' }}>
                <strong>{row.title}</strong>
                <div className="muted">Fluxo {row.workflowId.slice(0, 8)}{row.scriptVersion !== null ? ` · roteiro v${row.scriptVersion}` : ''}{row.productionMode ? ` · ${row.productionMode}` : ''}</div>
              </th>
              <td>{row.stageLabel}</td>
              <td>{row.status}</td>
              <td>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
                  {row.blockers.map(blocker => (
                    <li key={blocker.text}>
                      <span className={blockerClass(blocker.kind)}>{KIND_LABEL[blocker.kind]}</span>{' '}
                      <span>{blocker.text}</span>
                    </li>
                  ))}
                </ul>
                {row.incomplete && <p className="error" role="note">Dados incompletos: {row.incomplete}</p>}
              </td>
              <td>{LICENSE_LABEL[row.license]}</td>
              <td>{formatDate(row.updatedAt)}</td>
              <td>
                {row.action
                  ? <button type="button" className="button" onClick={() => onOpen(row)} aria-label={`${row.action}: ${row.title}`}>{row.action.toUpperCase()}</button>
                  : <span className="muted">Sem ação pendente</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
