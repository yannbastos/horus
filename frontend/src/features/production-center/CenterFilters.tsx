import type { StageFilter } from '../../services/productionCenter';

const OPTIONS: { value: StageFilter; label: string }[] = [
  { value: 'all', label: 'Todas as etapas' },
  { value: 'proposal', label: 'Proposta' },
  { value: 'script', label: 'Roteiro' },
  { value: 'production', label: 'Produção' },
  { value: 'review', label: 'Revisão humana' },
];

export default function CenterFilters({ stage, onlyBlocked, onStage, onBlocked }: {
  stage: StageFilter;
  onlyBlocked: boolean;
  onStage: (value: StageFilter) => void;
  onBlocked: (value: boolean) => void;
}) {
  return (
    <div className="row" role="group" aria-label="Filtros" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span className="eyebrow">ETAPA</span>
        <select value={stage} onChange={event => onStage(event.target.value as StageFilter)}
          style={{ background: 'var(--Sunken)', color: 'var(--Ink)', border: '1px solid var(--Line)', padding: '6px 8px' }}>
          {OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={onlyBlocked} onChange={event => onBlocked(event.target.checked)} />
        <span>Somente com bloqueio (ação humana)</span>
      </label>
    </div>
  );
}
