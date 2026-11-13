import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { NormalizedQualityCheck, NormalizedWordTimings } from '../../services/production';
import { formatTimecode } from '../../services/production';
import { findActiveWordIndex } from '../../services/mediaContracts';

type WordButtonProps = {
  index: number;
  text: string;
  start: number;
  interpolated: boolean;
  estimated: boolean;
  active: boolean;
  focusable: boolean;
  onSeek: (seconds: number, reason?: string) => void;
};

// Memoizado: a cada atualização do player só os botões cuja `active`/`focusable` mudou são re-renderizados.
const WordButton = memo(function WordButton({
  index,
  text,
  start,
  interpolated,
  estimated,
  active,
  focusable,
  onSeek,
}: WordButtonProps) {
  const suffix = interpolated
    ? ' — tempo interpolado, não medido'
    : estimated
    ? ' — tempo estimado, não medido'
    : '';
  return (
    <button
      type="button"
      data-word-index={index}
      data-word-timing={interpolated ? 'interpolated' : estimated ? 'estimated' : 'measured'}
      className="button"
      tabIndex={focusable ? 0 : -1}
      aria-current={active ? 'true' : undefined}
      aria-label={`Palavra ${index}: ${text} (${formatTimecode(start)})${suffix}`}
      title={`${start.toFixed(2)}s${suffix}`}
      style={{
        padding: '4px 8px',
        minHeight: '26px',
        fontSize: '11px',
        borderStyle: interpolated || estimated ? 'dashed' : undefined,
        borderColor: interpolated || estimated ? 'var(--Warn)' : undefined,
        fontStyle: interpolated || estimated ? 'italic' : undefined,
        background: active ? 'var(--InvertBackground)' : undefined,
        color: active ? 'var(--InvertForeground)' : undefined,
      }}
      onClick={() => onSeek(start, `Palavra: ${text}`)}
    >
      {interpolated ? '~' : ''}
      {text}
    </button>
  );
});

function percent(value: number): string {
  return `${(Math.round(value * 1000) / 10).toFixed(1)}%`;
}

export default function WordTimeline({
  wordTimings,
  currentTimeSeconds,
  subtitlesCheck,
  onSeekTimecode,
}: {
  wordTimings: NormalizedWordTimings;
  currentTimeSeconds: number;
  subtitlesCheck: NormalizedQualityCheck | null;
  onSeekTimecode: (seconds: number, reason?: string) => void;
}) {
  const words = wordTimings.words;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [announce, setAnnounce] = useState(true);
  const [focusIndex, setFocusIndex] = useState(0);

  const activeIndex = useMemo(
    () => findActiveWordIndex(words, currentTimeSeconds),
    [words, currentTimeSeconds]
  );
  const activeWord = activeIndex >= 0 ? words[activeIndex] : null;

  // Mantém a palavra atual visível dentro da faixa, sem rolar a página.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || activeIndex < 0) return;
    const el = container.querySelector<HTMLElement>(`[data-word-index="${words[activeIndex].index}"]`);
    if (!el) return;
    const top = el.offsetTop - container.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = Math.max(0, top - container.clientHeight / 2);
    }
  }, [activeIndex, words]);

  if (!wordTimings.available || words.length === 0) {
    return (
      <small className="muted">
        <code>word-timings.json</code> ausente nos artefatos desta produção — navegação fina por
        palavra indisponível (<code>speech_aligned: false</code>).
      </small>
    );
  }

  const estimated = wordTimings.isEstimated;
  const alignment = wordTimings.alignment;
  const declared = wordTimings.declaredAlignment;

  function moveFocus(position: number) {
    const clamped = Math.max(0, Math.min(words.length - 1, position));
    setFocusIndex(clamped);
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-word-index="${words[clamped].index}"]`
    );
    el?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-word-index]');
    if (!target) return;
    const position = words.findIndex(w => String(w.index) === target.dataset.wordIndex);
    if (position < 0) return;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = position + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = position - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = words.length - 1;
    else if (e.key === 'PageDown') next = position + 20;
    else if (e.key === 'PageUp') next = position - 20;
    if (next === null) return;
    e.preventDefault();
    moveFocus(next);
  }

  // Posição focável: a palavra focada pelo teclado; sem foco prévio, a primeira.
  const focusable = Math.min(focusIndex, words.length - 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {estimated && (
        <p className="error" role="note" data-testid="word-timeline-estimated">
          Tempos ESTIMADOS (heurística), não medidos: a faixa inteira é indicativa e não comprova
          sincronia com a fala.
        </p>
      )}

      <div
        role="group"
        aria-label="Resumo do alinhamento por palavra"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}
      >
        {alignment ? (
          <>
            <span className={`tag ${wordTimings.speechAligned ? 'good' : 'warn'}`}>
              TAXA DE CASAMENTO: {percent(alignment.matchRate)} ({alignment.measuredWords}/
              {words.length})
            </span>
            <span className={`tag ${alignment.interpolatedWords > 0 ? 'warn' : ''}`}>
              INTERPOLADAS: {alignment.interpolatedWords}
            </span>
            <span className="tag">
              MAIOR LACUNA INTERPOLADA: {alignment.longestInterpolatedSeconds.toFixed(2)}s
            </span>
            <span className="tag">
              ASR: {declared?.asr_engine ?? 'não declarado'} · {declared?.method ?? 'asr_sequence_match'}
            </span>
          </>
        ) : (
          <span className="tag">
            {estimated
              ? 'SEM MEDIÇÃO ACÚSTICA (estimado)'
              : wordTimings.source === 'forced_alignment'
              ? 'ALINHAMENTO INVÁLIDO — resumo não exibido'
              : 'SEM BLOCO DE ALINHAMENTO ACÚSTICO (tempos do motor TTS)'}
          </span>
        )}
        <label
          style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '11px' }}
        >
          <input
            type="checkbox"
            checked={announce}
            onChange={e => setAnnounce(e.target.checked)}
            aria-label="Anunciar palavra atual a leitores de tela"
          />
          Anunciar palavra atual
        </label>
      </div>

      <div
        role="status"
        aria-live={announce ? 'polite' : 'off'}
        aria-atomic="true"
        data-testid="word-timeline-live"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        {announce && activeWord ? `Palavra atual: ${activeWord.text}` : ''}
      </div>

      <div
        ref={containerRef}
        role="group"
        aria-label="Faixa de palavras sincronizada com o vídeo"
        data-testid="word-timeline-track"
        data-active-word={activeWord ? String(activeWord.index) : ''}
        onKeyDown={handleKeyDown}
        onFocus={e => {
          const t = (e.target as HTMLElement).closest<HTMLElement>('[data-word-index]');
          if (!t) return;
          const pos = words.findIndex(w => String(w.index) === t.dataset.wordIndex);
          if (pos >= 0) setFocusIndex(pos);
        }}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          maxHeight: '180px',
          overflowY: 'auto',
          padding: '4px 0',
          position: 'relative',
        }}
      >
        {words.map((word, position) => (
          <WordButton
            key={word.index}
            index={word.index}
            text={word.text}
            start={word.start}
            interpolated={word.timing === 'interpolated'}
            estimated={estimated}
            active={position === activeIndex}
            focusable={position === focusable}
            onSeek={onSeekTimecode}
          />
        ))}
      </div>

      <small className="muted" data-testid="word-timeline-legend">
        Palavra atual em destaque · clique ou Enter posiciona o vídeo · setas, Home/End e
        PageUp/PageDown navegam entre palavras.{' '}
        {alignment && alignment.interpolatedWords > 0 && (
          <>
            <span style={{ fontStyle: 'italic', borderBottom: '1px dashed var(--Warn)' }}>~palavra</span>
            : tempo interpolado, não medido.{' '}
          </>
        )}
        {estimated && <>Borda tracejada: tempo estimado, não medido.</>}
      </small>

      <div
        role="group"
        aria-label="QC: legendas versus palavras"
        data-testid="word-timeline-qc"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}
      >
        <span className="eyebrow">QC subtitles_vs_words</span>
        {subtitlesCheck ? (
          <>
            <span
              className={`tag ${
                subtitlesCheck.status === 'fail'
                  ? 'bad'
                  : subtitlesCheck.status === 'warn'
                  ? 'warn'
                  : subtitlesCheck.status === 'pass'
                  ? 'good'
                  : ''
              }`}
            >
              {subtitlesCheck.statusLabel}
            </span>
            <small className="muted">
              Desvio: {subtitlesCheck.measuredText} · limite: {subtitlesCheck.thresholdText} ·{' '}
              {subtitlesCheck.methodLabel} — {subtitlesCheck.detail}
            </small>
            {subtitlesCheck.timecode && (
              <button
                type="button"
                className="button"
                style={{ padding: '4px 8px', minHeight: '26px', fontSize: '10px' }}
                aria-label={`Ir para timecode do check subtitles_vs_words (${formatTimecode(
                  subtitlesCheck.timecode.start
                )})`}
                onClick={() =>
                  onSeekTimecode(subtitlesCheck.timecode!.start, 'QC subtitles_vs_words')
                }
              >
                {formatTimecode(subtitlesCheck.timecode.start)}
              </button>
            )}
          </>
        ) : (
          <small className="muted">check subtitles_vs_words não registrado no relatório de QC.</small>
        )}
      </div>
    </div>
  );
}
