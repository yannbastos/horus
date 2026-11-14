import type { NormalizedQualityReport } from '../../services/production';
import { formatTimecode } from '../../services/production';

const SEVERITY_ORDER: Record<string, number> = {
  fail: 0,
  warn: 1,
  not_checked: 2,
  skipped: 3,
  pass: 4,
};

const CHECK_SHORT_EXPLANATION: Record<string, string> = {
  asset_provenance: 'Há mídia, fonte ou voz sem verificação humana de licença.',
  subtitles_vs_words: 'Diferença de tempo entre legendas e palavras faladas.',
  subtitles_vs_sections: 'Legendas fora dos limites da seção correspondente.',
  word_timings: 'Alinhamento das palavras faladas com o áudio.',
  loudness: 'Volume médio (LUFS) fora da faixa recomendada (-26 a -12 LUFS).',
  true_peak: 'Pico real de áudio próximo ou acima do teto.',
  clipping: 'Distorção por saturação no áudio.',
  audio_clipping: 'Distorção por saturação no áudio.',
  silence: 'Trecho de silêncio prolongado inesperado.',
  black_frames: 'Quadros escuros ou pretos detectados no vídeo.',
  freeze_frames: 'Imagem congelada sem variação entre quadros.',
  duration: 'Duração total fora do intervalo esperado.',
  integrity: 'Integridade técnica dos fluxos de áudio e vídeo do MP4.',
  resolution: 'Resolução diferente do esperado para o perfil escolhido.',
  subtitle_safe_area: 'Legenda próxima da borda ou área de risco.',
};

function explainCheck(id: string): string | null {
  return CHECK_SHORT_EXPLANATION[id] ?? null;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    return isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

export default function QualityReportPanel({
  quality,
  onSeekTimecode,
}: {
  quality: NormalizedQualityReport;
  onSeekTimecode: (seconds: number, reason?: string) => void;
}) {
  return (
    <div
      className="fact-item"
      role="region"
      aria-label="Painel de qualidade (QC)"
      style={{ background: 'var(--Background)', gap: '10px' }}
    >
      <div className="row spread">
        <div>
          <p className="eyebrow accent">PAINEL DE QUALIDADE TÉCNICA (CONTRATO 2 · QC)</p>
          <h4>Inspeção técnica do vídeo e checks por método</h4>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="tag demo">NÃO PUBLICÁVEL (publishable: false)</span>
          <span className={`tag ${quality.overallTone}`}>
            {quality.executed ? quality.overallStatusLabel.toUpperCase() : 'QC NÃO EXECUTADO'}
          </span>
        </div>
      </div>

      {!quality.executed ? (
        <div
          className="blocker-item warning"
          role="status"
          aria-label="Estado de QC não executado"
        >
          <span className="eyebrow warn">QC NÃO EXECUTADO</span>
          <p className="muted">
            <strong>QC não executado</strong> — nenhum relatório de qualidade (
            <code>quality-report.json</code>) foi registrado ou executado para esta produção. A
            ausência de relatório de qualidade nunca equivale a aprovado (
            <code>publishable: false</code>).
          </p>
        </div>
      ) : (
        <>
          <div className="info-grid">
            <div className="info-block">
              <span className="eyebrow">STATUS DO QC</span>
              <small>{quality.overallStatusLabel}</small>
            </div>
            <div className="info-block">
              <span className="eyebrow">FONTE / FERRAMENTA DE MEDIÇÃO</span>
              <small>
                {quality.toolName
                  ? `${quality.toolName}${quality.toolVersion ? ` v${quality.toolVersion}` : ''}`
                  : 'Não declarada no relatório'}
              </small>
            </div>
            <div className="info-block">
              <span className="eyebrow">RESUMO DE CHECKS</span>
              <small>
                {quality.passCount} pass · {quality.warnCount} warn · {quality.failCount} fail ·{' '}
                {quality.skippedCount} skipped/not_checked
              </small>
            </div>
            <div className="info-block">
              <span className="eyebrow">GERADO EM / VÍDEO SHA-256</span>
              <small style={{ overflowWrap: 'anywhere' }}>
                {formatDate(quality.generatedAt)}
                {quality.videoSha256 ? ` · ${quality.videoSha256}` : ''}
              </small>
            </div>
          </div>

          {quality.blockingErrors.length > 0 && (
            <div
              className="critical-blockers-highlight"
              role="region"
              aria-label="Erros bloqueantes do QC"
            >
              <div className="row spread">
                <span className="eyebrow" style={{ color: 'var(--Bad)' }}>
                  ERROS BLOQUEANTES DESTACADOS ({quality.blockingErrors.length})
                </span>
                <span className="tag bad">BLOQUEANTE (FAIL)</span>
              </div>
              <ul className="blocker-items-list">
                {quality.blockingErrors.map(item => (
                  <li key={item.id} className="blocker-item critical">
                    <div className="row spread">
                      <div>
                        <strong className="blocker-code">{item.id}</strong>
                        {item.categoryLabel && (
                          <small className="muted"> · {item.categoryLabel}</small>
                        )}
                        {item.methodLabel && (
                          <small className="muted"> · Método: {item.methodLabel}</small>
                        )}
                      </div>
                      {item.timecode && (
                        <button
                          className="button"
                          type="button"
                          style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                          aria-label={`Ir para timecode do erro ${item.id} (${formatTimecode(
                            item.timecode.start
                          )})`}
                          onClick={() =>
                            onSeekTimecode(item.timecode!.start, `QC fail: ${item.id}`)
                          }
                        >
                          Timecode {formatTimecode(item.timecode.start)} →{' '}
                          {formatTimecode(item.timecode.end)}
                        </button>
                      )}
                    </div>
                    <small>{item.detail}</small>
                    {explainCheck(item.id) && (
                      <small className="muted" style={{ display: 'block', marginTop: '2px' }}>
                        O que significa: {explainCheck(item.id)}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quality.warnings.length > 0 && (
            <div
              className="fact-item"
              role="region"
              aria-label="Avisos do QC"
              style={{ borderColor: 'var(--Warn)' }}
            >
              <div className="row spread">
                <span className="eyebrow warn">
                  AVISOS DO RELATÓRIO DE QUALIDADE ({quality.warnings.length})
                </span>
                <span className="tag warn">AVISO (WARN)</span>
              </div>
              <ul className="blocker-items-list">
                {quality.warnings.map((item, idx) => (
                  <li key={`${item.id}_${idx}`} className="blocker-item warning">
                    <div className="row spread">
                      <div>
                        <strong className="blocker-code">{item.id}</strong>
                        {item.categoryLabel && (
                          <small className="muted"> · {item.categoryLabel}</small>
                        )}
                        {item.methodLabel && (
                          <small className="muted"> · Método: {item.methodLabel}</small>
                        )}
                      </div>
                      {item.timecode && (
                        <button
                          className="button"
                          type="button"
                          style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                          aria-label={`Ir para timecode do aviso ${item.id} (${formatTimecode(
                            item.timecode.start
                          )})`}
                          onClick={() =>
                            onSeekTimecode(item.timecode!.start, `QC warn: ${item.id}`)
                          }
                        >
                          Timecode {formatTimecode(item.timecode.start)} →{' '}
                          {formatTimecode(item.timecode.end)}
                        </button>
                      )}
                    </div>
                    <small>{item.detail}</small>
                    {explainCheck(item.id) && (
                      <small className="muted" style={{ display: 'block', marginTop: '2px' }}>
                        O que significa: {explainCheck(item.id)}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quality.checks.length > 0 && (
            <div className="data-table-container">
              <table className="data-table" aria-label="Tabela de checks de qualidade">
                <thead>
                  <tr>
                    <th>Check / Categoria</th>
                    <th>Status</th>
                    <th>Método (method)</th>
                    <th>Valor medido / observado</th>
                    <th>Limite (threshold)</th>
                    <th>Detalhe</th>
                    <th>Timecode</th>
                  </tr>
                </thead>
                <tbody>
                  {[...quality.checks]
                    .sort((a, b) => (SEVERITY_ORDER[a.status] ?? 9) - (SEVERITY_ORDER[b.status] ?? 9))
                    .map(check => {
                    const statusTone =
                      check.status === 'pass'
                        ? 'good'
                        : check.status === 'fail'
                        ? 'bad'
                        : 'warn';
                    const methodTone =
                      check.method === 'measured'
                        ? 'good'
                        : check.method === 'estimated'
                        ? 'warn'
                        : '';
                    return (
                      <tr key={check.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <strong style={{ fontFamily: 'Geist, monospace', fontSize: '11px' }}>
                              {check.id}
                            </strong>
                            <small className="muted">{check.categoryLabel}</small>
                          </div>
                        </td>
                        <td>
                          <span className={`tag ${statusTone}`}>{check.statusLabel}</span>
                        </td>
                        <td>
                          <span className={`tag ${methodTone}`}>{check.methodLabel}</span>
                        </td>
                        <td style={{ fontFamily: 'Geist, monospace', fontSize: '11px' }}>
                          {check.measuredText}
                        </td>
                        <td style={{ fontFamily: 'Geist, monospace', fontSize: '11px' }}>
                          {check.thresholdText}
                        </td>
                        <td>{check.detail}</td>
                        <td>
                          {check.timecode ? (
                            <button
                              className="button"
                              type="button"
                              style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                              aria-label={`Ir para timecode do check ${check.id} (${formatTimecode(
                                check.timecode.start
                              )})`}
                              onClick={() =>
                                onSeekTimecode(check.timecode!.start, `Check ${check.id}`)
                              }
                            >
                              {formatTimecode(check.timecode.start)} –{' '}
                              {formatTimecode(check.timecode.end)}
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
