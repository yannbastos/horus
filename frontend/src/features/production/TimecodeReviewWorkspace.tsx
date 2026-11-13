import { useEffect, useState } from 'react';
import type {
  NormalizedQualityCheck,
  NormalizedWordTimings,
  ProductionReviewNote,
  TimecodeSceneNavItem,
  TimecodeSubtitleNavItem,
} from '../../services/production';
import { formatTimecode } from '../../services/production';
import WordTimeline from './WordTimeline';

export default function TimecodeReviewWorkspace({
  currentTimeSeconds,
  scenes,
  subtitles,
  wordTimings,
  qualityChecksWithTimecode,
  subtitlesCheck,
  notes,
  canEditNotes,
  onSeekTimecode,
  onCaptureCurrentVideoTime,
  onAddNote,
  onUpdateNote,
  onRemoveNote,
}: {
  currentTimeSeconds: number;
  scenes: TimecodeSceneNavItem[];
  subtitles: TimecodeSubtitleNavItem[];
  wordTimings: NormalizedWordTimings;
  qualityChecksWithTimecode: NormalizedQualityCheck[];
  subtitlesCheck: NormalizedQualityCheck | null;
  notes: ProductionReviewNote[];
  canEditNotes: boolean;
  onSeekTimecode: (seconds: number, reason?: string) => void;
  onCaptureCurrentVideoTime: () => number;
  onAddNote: (note: ProductionReviewNote) => void;
  onUpdateNote: (index: number, note: ProductionReviewNote) => void;
  onRemoveNote: (index: number) => void;
}) {
  const [draftTimeSeconds, setDraftTimeSeconds] = useState<string>(() =>
    String(Math.round(currentTimeSeconds * 1000) / 1000)
  );
  const [draftText, setDraftText] = useState('');
  const [noteValidationError, setNoteValidationError] = useState('');

  useEffect(() => {
    const rounded = Math.round(Math.max(0, currentTimeSeconds) * 1000) / 1000;
    setDraftTimeSeconds(String(rounded));
  }, [currentTimeSeconds]);

  function handleSyncFromVideo() {
    const captured = onCaptureCurrentVideoTime();
    const rounded = Math.round(Math.max(0, captured) * 1000) / 1000;
    setDraftTimeSeconds(String(rounded));
    setNoteValidationError('');
  }

  function handleCreateNote(useCurrentPlayerTime = false) {
    setNoteValidationError('');
    if (notes.length >= 200) {
      setNoteValidationError('Limite máximo de 200 notas por revisão atingido (Contrato 4).');
      return;
    }
    const rawSec = useCurrentPlayerTime
      ? onCaptureCurrentVideoTime()
      : Number.parseFloat(draftTimeSeconds);
    if (!Number.isFinite(rawSec) || rawSec < 0) {
      setNoteValidationError('Informe um timecode válido em segundos (>= 0).');
      return;
    }
    const trimmed = draftText.trim();
    if (trimmed.length < 1 || trimmed.length > 2000) {
      setNoteValidationError('O texto da nota por timecode deve ter entre 1 e 2000 caracteres.');
      return;
    }
    const atSeconds = Math.round(rawSec * 1000) / 1000;
    onAddNote({ at_seconds: atSeconds, text: trimmed });
    setDraftText('');
  }

  return (
    <div
      className="fact-item"
      role="region"
      aria-label="Revisão e navegação por timecode"
      style={{ background: 'var(--Background)', gap: '12px' }}
    >
      <div className="row spread">
        <div>
          <p className="eyebrow accent">
            REVISÃO AUDIOVISUAL POR TIMECODE (CONTRATO 1 E CONTRATO 4)
          </p>
          <h4>Navegação por cenas, legendas, palavras e problemas do QC · Notas por tempo</h4>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span
            className="tag simulated"
            aria-label="Timecode selecionado atual"
            data-current-timecode={String(Math.round(currentTimeSeconds * 1000) / 1000)}
          >
            TIMECODE ATUAL: {formatTimecode(currentTimeSeconds)} (
            {(Math.round(currentTimeSeconds * 1000) / 1000).toFixed(2)}s)
          </span>
          <span className={`tag ${wordTimings.speechAligned ? 'good' : 'warn'}`}>
            {wordTimings.speechAligned ? 'speech_aligned: true' : 'speech_aligned: false'}
          </span>
        </div>
      </div>

      <div className="info-grid">
        <div
          className="info-block"
          role="region"
          aria-label="Navegação por cenas"
          style={{ gap: '8px' }}
        >
          <span className="eyebrow">NAVEGAR POR CENAS ({scenes.length})</span>
          {scenes.length === 0 ? (
            <small className="muted">Nenhuma cena com timecode registrada.</small>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {scenes.map(scene => (
                <button
                  key={scene.id}
                  className="button"
                  type="button"
                  style={{
                    padding: '6px 10px',
                    minHeight: '30px',
                    fontSize: '10px',
                    textAlign: 'left',
                    whiteSpace: 'normal',
                  }}
                  aria-label={`Ir para ${scene.label} em ${formatTimecode(scene.start)}`}
                  onClick={() => onSeekTimecode(scene.start, scene.label)}
                >
                  <strong>{formatTimecode(scene.start)}</strong> → {formatTimecode(scene.end)} ·{' '}
                  {scene.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className="info-block"
          role="region"
          aria-label="Navegação por legendas"
          style={{ gap: '8px' }}
        >
          <span className="eyebrow">NAVEGAR POR LEGENDAS ({subtitles.length})</span>
          {subtitles.length === 0 ? (
            <small className="muted">Nenhuma legenda segmentada carregada.</small>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                maxHeight: '180px',
                overflowY: 'auto',
              }}
            >
              {subtitles.map(sub => (
                <button
                  key={sub.index}
                  className="button"
                  type="button"
                  style={{
                    padding: '6px 10px',
                    minHeight: '30px',
                    fontSize: '10px',
                    textAlign: 'left',
                    whiteSpace: 'normal',
                  }}
                  aria-label={`Ir para legenda #${sub.index} em ${formatTimecode(sub.start)}`}
                  onClick={() => onSeekTimecode(sub.start, `Legenda #${sub.index}`)}
                >
                  <strong>
                    #{sub.index} · {formatTimecode(sub.start)}
                  </strong>{' '}
                  → {formatTimecode(sub.end)} · {sub.text}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        className="info-block"
        role="region"
        aria-label="Navegação por palavras"
        style={{ gap: '8px' }}
      >
        <div className="row spread">
          <span className="eyebrow">
            NAVEGAR POR PALAVRAS (word-timings.json · {wordTimings.words.length} PALAVRA(S))
          </span>
          <span className={`tag ${wordTimings.speechAligned ? 'good' : 'warn'}`}>
            FONTE: {wordTimings.sourceLabel}
          </span>
        </div>
        <small className={wordTimings.isEstimated ? 'error' : 'muted'}>
          {wordTimings.validationReason}
          {wordTimings.engineName
            ? ` · Motor: ${wordTimings.engineName}${
                wordTimings.engineVoice ? ` (${wordTimings.engineVoice})` : ''
              }`
            : ''}
        </small>
        <WordTimeline
          wordTimings={wordTimings}
          currentTimeSeconds={currentTimeSeconds}
          subtitlesCheck={subtitlesCheck}
          onSeekTimecode={onSeekTimecode}
        />
      </div>

      <div
        className="info-block"
        role="region"
        aria-label="Problemas do QC com timecode"
        style={{ gap: '8px' }}
      >
        <span className="eyebrow">
          PROBLEMAS E CHECKS DO QC COM TIMECODE ({qualityChecksWithTimecode.length})
        </span>
        {qualityChecksWithTimecode.length === 0 ? (
          <small className="muted">
            Nenhum problema ou check do QC possui trecho de timecode associado.
          </small>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {qualityChecksWithTimecode.map(check => {
              const tc = check.timecode!;
              const tone =
                check.status === 'fail' ? 'bad' : check.status === 'warn' ? 'warn' : '';
              return (
                <button
                  key={check.id}
                  className="button"
                  type="button"
                  style={{
                    padding: '6px 10px',
                    minHeight: '30px',
                    fontSize: '10px',
                    borderColor:
                      tone === 'bad'
                        ? 'var(--Bad)'
                        : tone === 'warn'
                        ? 'var(--Warn)'
                        : undefined,
                  }}
                  aria-label={`Ir para problema QC ${check.id} em ${formatTimecode(tc.start)}`}
                  onClick={() => onSeekTimecode(tc.start, `QC ${check.id}`)}
                >
                  [{check.status.toUpperCase()}] {check.id} · {formatTimecode(tc.start)} →{' '}
                  {formatTimecode(tc.end)} ({check.detail})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {canEditNotes && (
        <div
          className="info-block"
          role="region"
          aria-label="Notas de revisão por timecode"
          style={{ gap: '10px' }}
        >
          <div className="row spread">
            <span className="eyebrow accent">
              MARCAR NOTA NO TEMPO ATUAL DO VÍDEO ({notes.length}/200 NOTA(S))
            </span>
            <button
              className="button"
              type="button"
              style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
              onClick={handleSyncFromVideo}
            >
              Capturar tempo atual do player
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
              alignItems: 'flex-end',
            }}
          >
            <label style={{ width: '160px', flexShrink: 0 }}>
              Timecode da nota (s)
              <input
                aria-label="Timecode da nova nota (s)"
                type="number"
                min="0"
                step="0.01"
                value={draftTimeSeconds}
                onChange={e => setDraftTimeSeconds(e.target.value)}
              />
            </label>
            <label style={{ flex: '1 1 240px', minWidth: 0 }}>
              Texto da nota (1..2000 caracteres)
              <input
                aria-label="Texto da nova nota por timecode"
                type="text"
                maxLength={2000}
                placeholder="Descreva a observação ou correção neste ponto do vídeo…"
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
              />
            </label>
            <div className="actions">
              <button
                className="button"
                type="button"
                onClick={() => handleCreateNote(false)}
              >
                Adicionar nota no timecode
              </button>
            </div>
          </div>

          {noteValidationError && (
            <p className="error" role="alert">
              {noteValidationError}
            </p>
          )}

          <div
            role="region"
            aria-label="Lista de notas por timecode"
            style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
          >
            <span className="eyebrow">
              LISTA DE NOTAS EDITÁVEL ANTES DO ENVIO ({notes.length})
            </span>
            {notes.length === 0 ? (
              <small className="muted">
                Nenhuma nota marcada ainda. As notas adicionadas aqui serão enviadas junto com a
                decisão humana final (<code>notes: [&#123;at_seconds, text&#125;]</code>).
              </small>
            ) : (
              notes.map((note, idx) => (
                <div
                  key={idx}
                  className="fact-item"
                  style={{
                    background: 'var(--Background)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    alignItems: 'center',
                  }}
                >
                  <button
                    className="button"
                    type="button"
                    style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                    aria-label={`Ir para nota ${idx + 1} (${formatTimecode(note.at_seconds)})`}
                    onClick={() => onSeekTimecode(note.at_seconds, `Nota #${idx + 1}`)}
                  >
                    {formatTimecode(note.at_seconds)}
                  </button>
                  <input
                    aria-label={`Timecode da nota ${idx + 1}`}
                    type="number"
                    min="0"
                    step="0.01"
                    style={{ width: '120px' }}
                    value={note.at_seconds}
                    onChange={e => {
                      const val = Number.parseFloat(e.target.value);
                      onUpdateNote(idx, {
                        ...note,
                        at_seconds: Number.isFinite(val) && val >= 0 ? val : 0,
                      });
                    }}
                  />
                  <input
                    aria-label={`Texto da nota ${idx + 1}`}
                    type="text"
                    maxLength={2000}
                    style={{ flex: '1 1 200px', minWidth: 0 }}
                    value={note.text}
                    onChange={e => {
                      onUpdateNote(idx, {
                        ...note,
                        text: e.target.value,
                      });
                    }}
                  />
                  <button
                    className="button"
                    type="button"
                    style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                    aria-label={`Remover nota ${idx + 1}`}
                    onClick={() => onRemoveNote(idx)}
                  >
                    Remover nota
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
