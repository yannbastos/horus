import { useRef, useState } from 'react';
import { ApiError } from '../../services/api';
import type { Connection } from '../../services/api';
import type { NormalizedAssetProvenanceItem } from '../../services/production';
import {
  EVIDENCE_MAX,
  describeLicenseReviewError,
  postLicenseReview,
  validateLicenseReviewRequest,
} from '../../services/licenseReviews';
import type {
  LicenseDecision,
  LicenseReview,
  LicenseReviewRequest,
  ReviewCommercialUse,
} from '../../services/licenseReviews';

type FormState = {
  licenseId: string;
  licenseName: string;
  licenseUrl: string;
  commercialUse: ReviewCommercialUse;
  attributionRequired: boolean;
  evidence: string;
};

function initialForm(asset: NormalizedAssetProvenanceItem): FormState {
  return {
    licenseId: asset.licenseId ?? '',
    licenseName: asset.licenseName ?? '',
    licenseUrl: asset.licenseUrl ?? '',
    commercialUse: asset.commercialUse,
    attributionRequired: asset.attributionRequired ?? false,
    evidence: '',
  };
}

export default function AssetReviewForm({
  asset,
  productionId,
  connection,
  history,
  onSaved,
}: {
  asset: NormalizedAssetProvenanceItem;
  productionId: string;
  connection: Connection;
  history: LicenseReview[];
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => initialForm(asset));
  const [pending, setPending] = useState<LicenseDecision | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const keys = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const uid = `lr-${asset.assetId}`;

  const buildRequest = (decision: LicenseDecision): LicenseReviewRequest => ({
    asset_id: asset.assetId,
    asset_sha256: asset.sha256,
    decision,
    license: {
      id: form.licenseId.trim(),
      name: form.licenseName.trim(),
      url: form.licenseUrl.trim(),
      commercial_use: form.commercialUse,
      attribution_required: form.attributionRequired,
    },
    evidence: form.evidence.trim(),
    reviewed_by: 'human',
  });

  const verifyBlocked = form.commercialUse === 'unknown';
  const set = (patch: Partial<FormState>) => setForm(prev => ({ ...prev, ...patch }));

  function ask(decision: LicenseDecision) {
    const found = validateLicenseReviewRequest(buildRequest(decision));
    setProblems(found);
    setError('');
    setPending(found.length === 0 ? decision : null);
  }

  async function confirm() {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    const request = buildRequest(pending);
    const signature = JSON.stringify(request);
    // Chave estável por corpo: reenviar após falha de rede reutiliza a mesma chave.
    let key = keys.current.get(signature);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(signature, key);
    }
    try {
      await postLicenseReview(connection, productionId, request, key);
      keys.current.delete(signature);
      setPending(null);
      setForm(f => ({ ...f, evidence: '' }));
      setOpen(false);
      await onSaved();
    } catch (reason) {
      if (reason instanceof ApiError) {
        keys.current.delete(signature);
        setError(describeLicenseReviewError(reason, reason.status));
      } else {
        setError(describeLicenseReviewError(reason));
      }
      setPending(null);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const mine = history.filter(r => r.asset_id === asset.assetId).slice().reverse();
  const voiceWarning =
    asset.origin === 'system_voice' && asset.status !== 'verified'
      ? 'Voz do sistema (system_voice) sem licença verificada: a presença da voz no Windows não atesta direitos de uso comercial.'
      : null;

  return (
    <div className="fact-item" role="group" aria-label={`Verificação humana do asset ${asset.assetId}`} style={{ gap: '8px' }}>
      <div className="row spread" style={{ flexWrap: 'wrap' }}>
        <strong style={{ fontFamily: 'Geist, monospace', fontSize: '11px' }}>{asset.assetId}</strong>
        <span className={`tag ${asset.status === 'verified' ? 'good' : asset.status === 'rejected' ? 'bad' : 'warn'}`}>
          {asset.statusLabel}
        </span>
      </div>
      {voiceWarning && (
        <p className="error" role="note">
          {voiceWarning}
        </p>
      )}
      {asset.status === 'unverified' && !voiceWarning && (
        <p className="muted" role="note">
          Asset não verificado (unverified): sem decisão humana registrada.
        </p>
      )}

      {!open ? (
        <button className="button" type="button" onClick={() => setOpen(true)} aria-expanded={false}>
          Registrar decisão humana — {asset.assetId}
        </button>
      ) : (
        <form
          aria-label={`Formulário de verificação de licença ${asset.assetId}`}
          onSubmit={event => event.preventDefault()}
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          <label>
            Licença (id)
            <input value={form.licenseId} maxLength={100} onChange={e => set({ licenseId: e.target.value })} />
          </label>
          <label>
            Nome da licença
            <input value={form.licenseName} maxLength={200} onChange={e => set({ licenseName: e.target.value })} />
          </label>
          <label>
            URL da licença (https)
            <input value={form.licenseUrl} inputMode="url" onChange={e => set({ licenseUrl: e.target.value })} />
          </label>
          <label>
            Uso comercial
            <select value={form.commercialUse} onChange={e => set({ commercialUse: e.target.value as ReviewCommercialUse })}>
              <option value="allowed">allowed — permitido</option>
              <option value="restricted">restricted — restrito</option>
              <option value="unknown">unknown — desconhecido (só rejeição)</option>
            </select>
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center' }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={form.attributionRequired}
              onChange={e => set({ attributionRequired: e.target.checked })}
            />
            Atribuição obrigatória
          </label>
          <label>
            Evidência (texto, 1 a {EVIDENCE_MAX} caracteres)
            <textarea
              value={form.evidence}
              maxLength={EVIDENCE_MAX}
              aria-describedby={`${uid}-count`}
              onChange={e => set({ evidence: e.target.value })}
            />
            <small id={`${uid}-count`} className="muted">
              {form.evidence.length}/{EVIDENCE_MAX}
            </small>
          </label>

          {verifyBlocked && (
            <p className="muted" id={`${uid}-unknown`} role="note">
              commercial_use unknown nunca pode ser verificado: só é possível rejeitar.
            </p>
          )}
          {problems.length > 0 && (
            <ul className="error" role="alert" style={{ margin: 0, paddingLeft: '18px' }}>
              {problems.map(p => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {pending ? (
            <div className="blocker-item warning" role="alertdialog" aria-label={`Confirmar decisão ${asset.assetId}`}>
              <p>
                Confirmar decisão humana <strong>{pending === 'verified' ? 'VERIFICADA' : 'REJEITADA'}</strong> para{' '}
                <code>{asset.assetId}</code>? O registro é permanente (append-only) e não torna o vídeo publicável.
              </p>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="button primary" type="button" disabled={submitting} onClick={() => void confirm()}>
                  {submitting ? 'Enviando…' : 'Confirmar decisão'}
                </button>
                <button className="button" type="button" disabled={submitting} onClick={() => setPending(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button
                className="button primary"
                type="button"
                disabled={verifyBlocked || submitting}
                aria-describedby={verifyBlocked ? `${uid}-unknown` : undefined}
                onClick={() => ask('verified')}
              >
                Verificar
              </button>
              <button className="button" type="button" disabled={submitting} onClick={() => ask('rejected')}>
                Rejeitar
              </button>
              <button className="button" type="button" onClick={() => setOpen(false)}>
                Fechar
              </button>
            </div>
          )}
        </form>
      )}

      <div role="region" aria-label={`Histórico de decisões do asset ${asset.assetId}`}>
        <span className="eyebrow">HISTÓRICO (APPEND-ONLY)</span>
        {mine.length === 0 ? (
          <p className="muted">Nenhuma decisão humana registrada.</p>
        ) : (
          <ul className="blocker-items-list">
            {mine.map(r => (
              <li key={r.id} className="blocker-item">
                <span>
                  <span className={`tag ${r.decision === 'verified' ? 'good' : 'bad'}`}>
                    {r.decision === 'verified' ? 'VERIFICADA' : 'REJEITADA'}
                  </span>{' '}
                  <time dateTime={r.reviewed_at}>{r.reviewed_at}</time> · por humano
                </span>
                <small>
                  {r.license.name} ({r.license.id}) · uso comercial {r.license.commercial_use} ·{' '}
                  {r.license.attribution_required ? 'atribuição obrigatória' : 'sem atribuição'}
                </small>
                <small className="muted" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                  Evidência: {r.evidence}
                </small>
                {r.supersedes && <small className="muted">Substitui a decisão {r.supersedes}</small>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
