import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../services/api';
import type { Connection } from '../../services/api';
import type { NormalizedAssetProvenance } from '../../services/production';
import { getLicenseReviews } from '../../services/licenseReviews';
import type { LicenseReview } from '../../services/licenseReviews';
import { describeLicenseReviewError } from '../../services/licenseReviews';
import AssetReviewForm from './AssetReviewForm';

export default function AssetProvenancePanel({
  assetProvenance,
  connection,
  productionId,
  onEffectiveProvenance,
  reloadKey,
}: {
  assetProvenance: NormalizedAssetProvenance;
  connection?: Connection | null;
  productionId?: string;
  onEffectiveProvenance?: (effective: Record<string, unknown> | null) => void;
  /** Muda quando a produção avança (status/artefatos): força nova leitura dos registros de licença. */
  reloadKey?: string;
}) {
  const [history, setHistory] = useState<LicenseReview[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const report = useRef(onEffectiveProvenance);
  report.current = onEffectiveProvenance;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!connection || !productionId) return;
      setLoading(true);
      try {
        const data = await getLicenseReviews(connection, productionId, signal);
        if (signal?.aborted) return;
        setHistory(data.history);
        setCanReview(data.effective_provenance !== null);
        setLoadError('');
        report.current?.(data.effective_provenance);
        setLoading(false);
      } catch (reason) {
        if (signal?.aborted) return;
        setLoading(false);
        setCanReview(false);
        setLoadError(
          reason instanceof ApiError
            ? describeLicenseReviewError(reason, reason.status)
            : describeLicenseReviewError(reason)
        );
      }
    },
    [connection, productionId]
  );

  const lastProduction = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Ao trocar de produção limpa o estado; ao só avançar (reloadKey), mantém o que já havia.
    if (lastProduction.current !== productionId) {
      lastProduction.current = productionId;
      setHistory([]);
      setCanReview(false);
      report.current?.(null);
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  return (
    <div
      className="fact-item"
      role="region"
      aria-label="Painel de licenças e proveniência"
      style={{ background: 'var(--Background)', gap: '10px' }}
    >
      <div className="row spread">
        <div>
          <p className="eyebrow accent">PAINEL DE LICENÇAS E PROVENIÊNCIA (CONTRATO 3)</p>
          <h4>Rastreabilidade de origem, direitos, uso comercial e verificação humana por asset</h4>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="tag demo">NÃO PUBLICÁVEL (publishable: false)</span>
          <span
            className={`tag ${
              assetProvenance.rejectedCount > 0
                ? 'bad'
                : assetProvenance.hasUnverifiedOrUnknown
                ? 'warn'
                : 'good'
            }`}
          >
            {assetProvenance.rejectedCount > 0
              ? 'LICENÇA REJEITADA (REJECTED)'
              : assetProvenance.hasUnverifiedOrUnknown
              ? 'LICENÇA NÃO VERIFICADA / UNKNOWN'
              : 'ASSETS VERIFICADOS POR HUMANO'}
          </span>
        </div>
      </div>

      {assetProvenance.hasUnverifiedOrUnknown && (
        <div
          className={`blocker-item ${assetProvenance.rejectedCount > 0 ? 'critical' : 'warning'}`}
          role="note"
          aria-label="Aviso de licenças não verificadas ou uso comercial desconhecido"
        >
          <span className="eyebrow warn">
            AVISO EXPLÍCITO DE LICENÇA E DIREITOS DE USO COMERCIAL
          </span>
          <p className="muted">
            Existem assets com status <code>unverified</code>/<code>rejected</code>, uso comercial{' '}
            <code>unknown</code>/<code>restricted</code> ou sem verificação humana (
            <code>verified_by: null</code>). <code>commercial_use: unknown</code>{' '}
            <strong>nunca equivale a uso comercial permitido</strong> e nenhuma licença é presumida
            pela presença local do arquivo ou voz (<code>publishable: false</code>).
          </p>
          {assetProvenance.summaryWarnings.length > 0 && (
            <small className="muted">{assetProvenance.summaryWarnings.join(' · ')}</small>
          )}
        </div>
      )}

      {(assetProvenance.hasStockPexels || assetProvenance.hasStockPixabay) && (
        <div className="fact-item" role="note" aria-label="Aviso de validação de stock">
          <span className="eyebrow warn">VALIDAÇÃO DE ORIGEM STOCK REGISTRADA NOS DADOS</span>
          <small className="muted">
            Assets declarados com origem{' '}
            {[
              assetProvenance.hasStockPexels ? 'Pexels (stock_pexels)' : null,
              assetProvenance.hasStockPixabay ? 'Pixabay (stock_pixabay)' : null,
            ]
              .filter(Boolean)
              .join(' / ')}{' '}
            exigem URL de origem, autor, termos de licença e verificação humana explícita. Nenhuma
            chamada externa, chave ou download automático é executado pela interface.
          </small>
        </div>
      )}

      {assetProvenance.assets.length === 0 ? (
        <p className="muted">
          Nenhum asset detalhado em <code>asset-provenance.json</code> para esta produção. Sem
          registro de proveniência validado, todos os direitos permanecem como não verificados (
          <code>unverified</code> · <code>commercial_use: unknown</code> ·{' '}
          <code>publishable: false</code>).
        </p>
      ) : (
        <div className="data-table-container">
          <table
            className="data-table"
            aria-label="Tabela de licenças e proveniência de assets"
          >
            <thead>
              <tr>
                <th>Asset / Tipo</th>
                <th>Origem</th>
                <th>Autor / Fonte</th>
                <th>Licença / Atribuição</th>
                <th>Uso comercial</th>
                <th>Verificação humana</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assetProvenance.assets.map(asset => {
                const statusTone =
                  asset.status === 'verified'
                    ? 'good'
                    : asset.status === 'rejected'
                    ? 'bad'
                    : 'warn';
                const commercialTone =
                  asset.commercialUse === 'allowed'
                    ? 'good'
                    : asset.commercialUse === 'restricted'
                    ? 'bad'
                    : 'warn';
                const verifiedTone = asset.verifiedBy === 'human' ? 'good' : 'warn';

                return (
                  <tr key={asset.assetId}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <strong style={{ fontFamily: 'Geist, monospace', fontSize: '11px' }}>
                          {asset.assetId}
                        </strong>
                        <span className="tag">{asset.kindLabel}</span>
                        <small
                          className="muted"
                          style={{
                            fontFamily: 'Geist, monospace',
                            fontSize: '10px',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {asset.relativePath}
                        </small>
                        <small
                          className="muted"
                          style={{
                            fontFamily: 'Geist, monospace',
                            fontSize: '10px',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          sha256: {asset.sha256}
                        </small>
                      </div>
                    </td>
                    <td>
                      <span className={`tag ${asset.isStock ? 'warn' : ''}`}>
                        {asset.originLabel}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>{asset.author ?? 'Autor não informado'}</span>
                        {asset.sourceUrl ? (
                          <code
                            style={{
                              fontSize: '10px',
                              color: 'var(--Muted)',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {asset.sourceUrl}
                          </code>
                        ) : (
                          <small className="muted">Sem URL externa</small>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>
                          {asset.licenseName ?? asset.licenseId ?? 'Licença não declarada'}
                          {asset.licenseId &&
                          asset.licenseName &&
                          asset.licenseId !== asset.licenseName
                            ? ` (${asset.licenseId})`
                            : ''}
                        </span>
                        <small className="muted">{asset.attributionLabel}</small>
                        {asset.licenseUrl && (
                          <code
                            style={{
                              fontSize: '10px',
                              color: 'var(--Muted)',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {asset.licenseUrl}
                          </code>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`tag ${commercialTone}`}>{asset.commercialUseLabel}</span>
                    </td>
                    <td>
                      <span className={`tag ${verifiedTone}`}>{asset.verificationLabel}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span className={`tag ${statusTone}`}>{asset.statusLabel}</span>
                        {asset.notes && <small className="muted">{asset.notes}</small>}
                        {asset.warnings.length > 0 && (
                          <small className="error">{asset.warnings.join(' ')}</small>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="blocker-item warning" role="note" aria-label="Aviso de publicação">
        <span className="eyebrow warn">APROVAÇÃO DE LICENÇA NÃO TORNA O VÍDEO PUBLICÁVEL</span>
        <p className="muted">
          A decisão humana apenas registra o estado da licença do asset. O vídeo permanece{' '}
          <code>publishable: false</code> (demonstração) independentemente de qualquer verificação.
        </p>
      </div>

      <div
        role="region"
        aria-label="Verificação humana de licença por asset"
        style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
      >
        <span className="eyebrow accent">VERIFICAÇÃO HUMANA POR ASSET</span>
        {loadError && (
          <p className="error" role="status">
            {loadError}
          </p>
        )}
        {!connection || !productionId ? (
          <p className="muted">Sem conexão com o backend: a verificação humana não está disponível.</p>
        ) : loading && !canReview ? (
          <p className="loading" role="status">
            Carregando proveniência e licenças desta produção…
          </p>
        ) : !canReview ? (
          <p className="muted">
            A API não devolveu proveniência efetiva para esta produção; sem <code>asset-provenance.json</code>{' '}
            válido não é possível registrar decisões.
          </p>
        ) : (
          assetProvenance.assets.map(asset => (
            <AssetReviewForm
              key={asset.assetId}
              asset={asset}
              productionId={productionId}
              connection={connection}
              history={history}
              onSaved={() => load()}
            />
          ))
        )}
      </div>
    </div>
  );
}
