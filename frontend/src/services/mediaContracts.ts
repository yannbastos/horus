// Validadores de contratos de mídia (docs/contratos-midia.md, seção 1 e 4).
// Funções puras, sem rede nem DOM. Não confiam em flags soltas: contagens e taxas
// do bloco `alignment` são recomputadas a partir das palavras.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readSha256(value: unknown): string | null {
  const s = readString(value);
  return s && /^[a-f0-9]{64}$/i.test(s) ? s.toLowerCase() : null;
}

// Mesmos limiares do validador do backend (speech_alignment.py).
export const MIN_ALIGNMENT_MATCH_RATE = 0.85;
export const MAX_INTERPOLATED_RUN_SECONDS = 2.0;

export type WordTimingSource = 'tts_engine_events' | 'forced_alignment' | 'estimated';
export type WordTimingKind = 'measured' | 'interpolated';

export type WordTimingItem = {
  index: number;
  text: string;
  section: number | string;
  start: number;
  end: number;
  char_offset: number;
  char_length: number;
  /** Só presente em `forced_alignment`; `null` quando o documento não declara. */
  timing?: WordTimingKind | null;
};

export type WordTimingEngine = {
  name: string;
  voice: string;
};

export type WordAlignmentSummary = {
  method: 'asr_sequence_match';
  asr_engine: string;
  matched_words: number;
  interpolated_words: number;
  match_rate: number;
  longest_interpolated_seconds: number;
};

export type WordTimingsReport = {
  schema_version: 1 | number;
  narration_sha256: string;
  duration_seconds: number;
  source: WordTimingSource | string;
  engine: WordTimingEngine;
  words: WordTimingItem[];
  alignment?: WordAlignmentSummary | null;
};

/** Resumo do alinhamento recomputado a partir das palavras (não do bloco declarado). */
export type RecomputedAlignment = {
  measuredWords: number;
  interpolatedWords: number;
  matchRate: number;
  longestInterpolatedSeconds: number;
};

export function recomputeAlignment(words: WordTimingItem[]): RecomputedAlignment {
  let measured = 0;
  let interpolated = 0;
  let longest = 0;
  let runStart: number | null = null;
  for (const w of words) {
    if (w.timing === 'interpolated') {
      interpolated += 1;
      if (runStart === null) runStart = w.start;
      longest = Math.max(longest, w.end - runStart);
    } else {
      if (w.timing === 'measured') measured += 1;
      runStart = null;
    }
  }
  const total = words.length;
  return {
    measuredWords: measured,
    interpolatedWords: interpolated,
    matchRate: total > 0 ? measured / total : 0,
    longestInterpolatedSeconds: Math.round(longest * 1000) / 1000,
  };
}

export type WordTimingsParseResult = {
  words: WordTimingItem[];
  /** Quantidade de itens descartados por forma inválida. */
  invalidItems: number;
  /** Bloco `alignment` declarado e bem formado; `null` se ausente ou malformado. */
  declaredAlignment: WordAlignmentSummary | null;
  /** Recomputado a partir das palavras; só para `forced_alignment`. */
  alignment: RecomputedAlignment | null;
  /** Violações de contrato (timing/alignment por fonte); não incluem as regras gerais. */
  contractReasons: string[];
  /** Documento válido, mas abaixo dos limiares de speech_aligned. */
  belowThreshold: boolean;
};

function parseAlignmentBlock(value: unknown): WordAlignmentSummary | null {
  if (!isRecord(value)) return null;
  const asr = readString(value.asr_engine);
  const matched = readFiniteNumber(value.matched_words);
  const interp = readFiniteNumber(value.interpolated_words);
  const rate = readFiniteNumber(value.match_rate);
  const longest = readFiniteNumber(value.longest_interpolated_seconds);
  if (
    value.method !== 'asr_sequence_match' ||
    !asr ||
    matched === null ||
    interp === null ||
    rate === null ||
    longest === null ||
    !Number.isInteger(matched) ||
    !Number.isInteger(interp) ||
    matched < 0 ||
    interp < 0 ||
    rate < 0 ||
    rate > 1 ||
    longest < 0
  ) {
    return null;
  }
  return {
    method: 'asr_sequence_match',
    asr_engine: asr,
    matched_words: matched,
    interpolated_words: interp,
    match_rate: rate,
    longest_interpolated_seconds: longest,
  };
}

/** Lê e valida a forma de `words[]`, `timing` e `alignment` conforme a fonte declarada. */
export function parseWordTimingsWords(
  rawWords: unknown[],
  source: string,
  rawAlignment: unknown
): WordTimingsParseResult {
  const words: WordTimingItem[] = [];
  let invalidItems = 0;
  let invalidTiming = false;
  for (const item of rawWords) {
    if (!isRecord(item)) {
      invalidItems += 1;
      continue;
    }
    const index = readFiniteNumber(item.index);
    const text = typeof item.text === 'string' ? item.text : null;
    const section =
      typeof item.section === 'number' && Number.isInteger(item.section)
        ? item.section
        : readString(item.section);
    const start = readFiniteNumber(item.start);
    const end = readFiniteNumber(item.end);
    const charOffset = readFiniteNumber(item.char_offset);
    const charLength = readFiniteNumber(item.char_length);
    if (
      index === null ||
      !text ||
      section === null ||
      start === null ||
      end === null ||
      charOffset === null ||
      charLength === null
    ) {
      invalidItems += 1;
      continue;
    }
    let timing: WordTimingKind | null = null;
    if (item.timing === 'measured' || item.timing === 'interpolated') {
      timing = item.timing;
    } else if (item.timing !== undefined && item.timing !== null) {
      invalidTiming = true;
    }
    words.push({
      index,
      text,
      section,
      start,
      end,
      char_offset: charOffset,
      char_length: charLength,
      timing,
    });
  }

  const reasons: string[] = [];
  const declaredAlignment = parseAlignmentBlock(rawAlignment);
  const hasAlignmentField = rawAlignment !== undefined && rawAlignment !== null;
  if (invalidTiming) {
    reasons.push('words[].timing com valor inválido (esperado measured, interpolated ou null)');
  }
  if (hasAlignmentField && !declaredAlignment) {
    reasons.push('bloco alignment malformado');
  }

  let recomputed: RecomputedAlignment | null = null;
  let belowThreshold = false;
  if (source === 'forced_alignment') {
    if (words.some(w => w.timing === null || w.timing === undefined)) {
      reasons.push('forced_alignment exige words[].timing em todas as palavras (timing_missing)');
    }
    if (!hasAlignmentField) {
      reasons.push('forced_alignment exige o bloco alignment (alignment_missing)');
    }
    recomputed = recomputeAlignment(words);
    if (declaredAlignment) {
      if (
        declaredAlignment.matched_words !== recomputed.measuredWords ||
        declaredAlignment.interpolated_words !== recomputed.interpolatedWords
      ) {
        reasons.push('alignment: contagens declaradas diferem das palavras (alignment_counts)');
      }
      if (Math.abs(declaredAlignment.match_rate - recomputed.matchRate) > 0.0005) {
        reasons.push('alignment: match_rate declarado difere do recomputado (alignment_match_rate)');
      }
      if (
        Math.abs(
          declaredAlignment.longest_interpolated_seconds - recomputed.longestInterpolatedSeconds
        ) > 0.0015
      ) {
        reasons.push(
          'alignment: maior trecho interpolado declarado difere do recomputado (alignment_longest_run)'
        );
      }
    }
    belowThreshold =
      recomputed.matchRate < MIN_ALIGNMENT_MATCH_RATE ||
      recomputed.longestInterpolatedSeconds > MAX_INTERPOLATED_RUN_SECONDS;
  } else {
    if (words.some(w => w.timing !== null && w.timing !== undefined)) {
      reasons.push('words[].timing só é permitido em forced_alignment (timing_not_allowed)');
    }
    if (hasAlignmentField) {
      reasons.push('alignment só é permitido em forced_alignment (alignment_not_allowed)');
    }
  }

  return {
    words,
    invalidItems,
    declaredAlignment,
    alignment: recomputed,
    contractReasons: reasons,
    belowThreshold,
  };
}

/**
 * Índice da palavra ativa em `t` por busca binária (palavras ordenadas, sem sobreposição).
 * Ativa = start <= t < end. Em lacuna entre palavras devolve -1.
 */
export function findActiveWordIndex(words: { start: number; end: number }[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = words[mid];
    if (t < w.start) hi = mid - 1;
    else if (t >= w.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}
