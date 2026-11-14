import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../services/api';
import type { Connection } from '../../services/api';
import {
  createProductionExport,
  downloadProductionExportZip,
  formatExportError,
  listProductionExports,
} from '../../services/exports';
import type { ProductionExportItem } from '../../services/exports';
import type { ProductionRecord } from '../../services/production';

function formatExportBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB (${bytes} B)`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB (${bytes} B)`;
}

function formatExportDate(iso: string): string {
  if (!iso) return 'Data não informada';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString('pt-BR');
}

export default function ProductionExportPanel({
  connection,
  production,
}: {
  connection: Connection | null;
  production: ProductionRecord;
}) {
  const isApproved =
    production.status === 'succeeded' && production.review?.decision === 'approve';

  const [items, setItems] = useState<ProductionExportItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [lastRepeated, setLastRepeated] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const keyByProductionRef = useRef<Map<string, string>>(new Map());
  const inFlightRef = useRef(false);

  function getStableKey(productionId: string): string {
    const existing = keyByProductionRef.current.get(productionId);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    keyByProductionRef.current.set(productionId, generated);
    return generated;
  }

  function rotateKey(productionId: string): void {
    keyByProductionRef.current.set(productionId, crypto.randomUUID());
  }

  useEffect(() => {
    setExportState('idle');
    setLastRepeated(false);
    setErrorMessage('');
    setDownloadingId(null);

    if (!connection || !isApproved) {
      setItems([]);
      setLoadingList(false);
      return;
    }

    const controller = new AbortController();
    setLoadingList(true);
    void listProductionExports(connection, production.id, controller.signal)
      .then(loaded => {
        if (!controller.signal.aborted) {
          setItems(loaded);
        }
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setErrorMessage(formatExportError(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingList(false);
        }
      });

    return () => controller.abort();
  }, [connection, production.id, isApproved]);

  async function handleExport() {
    if (!connection || !isApproved || inFlightRef.current) return;
    inFlightRef.current = true;
    setExportState('generating');
    setErrorMessage('');
    const targetProductionId = production.id;
    const key = getStableKey(targetProductionId);

    try {
      const result = await createProductionExport(connection, targetProductionId, key);
      setLastRepeated(!result.created);
      setExportState('ready');
      setItems(prev => {
        const exists = prev.some(entry => entry.id === result.item.id);
        return exists
          ? prev.map(entry => (entry.id === result.item.id ? result.item : entry))
          : [...prev, result.item];
      });
    } catch (reason) {
      if (reason instanceof ApiError && (reason.status === 409 || reason.status === 422)) {
        rotateKey(targetProductionId);
      }
      setExportState('error');
      setErrorMessage(formatExportError(reason));
    } finally {
      inFlightRef.current = false;
    }
  }

  async function handleDownload(item: ProductionExportItem) {
    if (!connection || downloadingId) return;
    setDownloadingId(item.id);
    setErrorMessage('');
    try {
      const blob = await downloadProductionExportZip(connection, production.id, item.id);
      const blobUrl = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = `horus-pacote-${production.id.slice(0, 8)}-${item.id.slice(0, 8)}.zip`;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }
    } catch (reason) {
      setExportState('error');
      setErrorMessage(formatExportError(reason));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <section
      className="fact-item"
      role="region"
      aria-labelledby="production-export-title"
      data-testid="production-export-panel"
      style={{ background: 'var(--Background)', display: 'grid', gap: 10 }}
    >
      <div className="row spread">
        <div>
          <span className="eyebrow accent">EXPORTAÇÃO AUDITÁVEL LOCAL</span>
          <h4 id="production-export-title" style={{ margin: '4px 0 0' }}>
            Pacote para publicação manual
          </h4>
        </div>
        {isApproved && (
          <button
            type="button"
            className="button primary"
            disabled={!connection || exportState === 'generating'}
            onClick={() => void handleExport()}
          >
            {exportState === 'generating' ? 'Gerando pacote…' : 'Exportar pacote'}
          </button>
        )}
      </div>

      <p className="muted">
        Não publica nada; prepara arquivos para você publicar e auditar (<code>publishable: false</code>).
      </p>

      {!isApproved ? (
        <p className="muted" role="status" data-testid="export-requires-approval">
          Disponível somente após aprovação na revisão humana desta produção.
        </p>
      ) : (
        <>
          {exportState === 'generating' && (
            <p className="muted" role="status" aria-live="polite">
              Gerando pacote de exportação…
            </p>
          )}
          {exportState === 'ready' && (
            <p className="good" role="status" aria-live="polite" data-testid="export-ready-status">
              {lastRepeated
                ? 'Pacote pronto (mesma chave de idempotência reutilizada, sem duplicar arquivo).'
                : 'Pacote pronto para download.'}
            </p>
          )}
          {errorMessage && (
            <p className="error" role="alert" data-testid="export-error-alert">
              {errorMessage}
            </p>
          )}

          {loadingList ? (
            <p className="muted" role="status">
              Carregando pacotes exportados…
            </p>
          ) : items.length === 0 ? (
            <p className="muted" data-testid="exports-empty">
              Nenhum pacote exportado para esta produção.
            </p>
          ) : (
            <ul
              data-testid="exports-list"
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}
            >
              {items.map(item => (
                <li
                  key={item.id}
                  data-testid={`export-item-${item.id}`}
                  style={{
                    padding: 10,
                    border: '1px solid var(--Line)',
                    background: 'var(--Sunken)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                    <strong style={{ overflowWrap: 'anywhere' }}>{item.relative_path}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Tamanho: {formatExportBytes(item.size_bytes)} · SHA-256:{' '}
                      <code title={item.sha256}>{item.sha256.slice(0, 12)}…</code> · Data:{' '}
                      {formatExportDate(item.created_at)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="button"
                    disabled={downloadingId === item.id}
                    onClick={() => void handleDownload(item)}
                  >
                    {downloadingId === item.id ? 'Baixando…' : 'Baixar ZIP'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
