import type { ScriptRecord, ScriptSection } from '../../services/scripts';

export type DiffSegmentKind = 'equal' | 'added' | 'removed';

export type DiffSegment = {
  kind: DiffSegmentKind;
  text: string;
};

export type SectionDiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

export type SectionComparison = {
  id: string;
  status: SectionDiffStatus;
  moved: boolean;
  kindChanged: boolean;
  sourcesChanged: boolean;
  baseSection: ScriptSection | null;
  targetSection: ScriptSection | null;
  headingDiff: DiffSegment[];
  narrationDiff: DiffSegment[];
};

export type ScriptComparison = {
  titleChanged: boolean;
  titleDiff: DiffSegment[];
  sections: SectionComparison[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
};

const MAX_DP_CELLS = 1_000_000;

function tokenize(text: string): string[] {
  if (!text) return [];
  return text.split(/(\s+)/).filter(token => token.length > 0);
}

function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === seg.kind) {
      prev.text += seg.text;
    } else {
      merged.push({ kind: seg.kind, text: seg.text });
    }
  }
  return merged;
}

/**
 * Calcula diff por palavra entre dois textos usando LCS com corte de prefixo/sufixo comum.
 */
export function diffWords(oldText: string, newText: string): DiffSegment[] {
  if (oldText === newText) {
    return oldText ? [{ kind: 'equal', text: oldText }] : [];
  }

  const a = tokenize(oldText);
  const b = tokenize(newText);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  const segments: DiffSegment[] = [];
  if (prefix > 0) {
    segments.push({ kind: 'equal', text: a.slice(0, prefix).join('') });
  }

  if (midA.length === 0 && midB.length > 0) {
    segments.push({ kind: 'added', text: midB.join('') });
  } else if (midB.length === 0 && midA.length > 0) {
    segments.push({ kind: 'removed', text: midA.join('') });
  } else if (midA.length > 0 && midB.length > 0) {
    const m = midA.length;
    const n = midB.length;

    if (m * n > MAX_DP_CELLS) {
      // Fallback seguro para textos muito extensos
      segments.push({ kind: 'removed', text: midA.join('') });
      segments.push({ kind: 'added', text: midB.join('') });
    } else {
      const dp = new Uint32Array((m + 1) * (n + 1));
      const stride = n + 1;

      for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
          if (midA[i] === midB[j]) {
            dp[i * stride + j] = dp[(i + 1) * stride + (j + 1)] + 1;
          } else {
            const down = dp[(i + 1) * stride + j];
            const right = dp[i * stride + (j + 1)];
            dp[i * stride + j] = down >= right ? down : right;
          }
        }
      }

      let i = 0;
      let j = 0;
      while (i < m && j < n) {
        if (midA[i] === midB[j]) {
          segments.push({ kind: 'equal', text: midA[i] });
          i++;
          j++;
        } else if (dp[(i + 1) * stride + j] >= dp[i * stride + (j + 1)]) {
          segments.push({ kind: 'removed', text: midA[i] });
          i++;
        } else {
          segments.push({ kind: 'added', text: midB[j] });
          j++;
        }
      }
      while (i < m) {
        segments.push({ kind: 'removed', text: midA[i++] });
      }
      while (j < n) {
        segments.push({ kind: 'added', text: midB[j++] });
      }
    }
  }

  if (suffix > 0) {
    segments.push({ kind: 'equal', text: a.slice(a.length - suffix).join('') });
  }

  return mergeSegments(segments);
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}

/**
 * Compara título e seções de duas versões de roteiro.
 */
export function compareScripts(base: ScriptRecord, target: ScriptRecord): ScriptComparison {
  const titleChanged = base.document.title !== target.document.title;
  const titleDiff = diffWords(base.document.title, target.document.title);

  const baseById = new Map<string, { section: ScriptSection; index: number }>();
  base.document.sections.forEach((section, index) => {
    baseById.set(section.id, { section, index });
  });

  const targetIds = new Set(target.document.sections.map(s => s.id));
  const sections: SectionComparison[] = [];

  target.document.sections.forEach((targetSection, targetIndex) => {
    const baseEntry = baseById.get(targetSection.id);
    if (!baseEntry) {
      sections.push({
        id: targetSection.id,
        status: 'added',
        moved: false,
        kindChanged: false,
        sourcesChanged: false,
        baseSection: null,
        targetSection,
        headingDiff: [{ kind: 'added', text: targetSection.heading }],
        narrationDiff: [{ kind: 'added', text: targetSection.narration }],
      });
      return;
    }

    const baseSection = baseEntry.section;
    const moved = baseEntry.index !== targetIndex;
    const kindChanged = baseSection.kind !== targetSection.kind;
    const sourcesChanged = !sameStringArray(baseSection.source_ids, targetSection.source_ids);
    const headingChanged = baseSection.heading !== targetSection.heading;
    const narrationChanged = baseSection.narration !== targetSection.narration;

    const status: SectionDiffStatus =
      kindChanged || sourcesChanged || headingChanged || narrationChanged || moved
        ? 'changed'
        : 'unchanged';

    sections.push({
      id: targetSection.id,
      status,
      moved,
      kindChanged,
      sourcesChanged,
      baseSection,
      targetSection,
      headingDiff: diffWords(baseSection.heading, targetSection.heading),
      narrationDiff: diffWords(baseSection.narration, targetSection.narration),
    });
  });

  for (const baseSection of base.document.sections) {
    if (!targetIds.has(baseSection.id)) {
      sections.push({
        id: baseSection.id,
        status: 'removed',
        moved: false,
        kindChanged: false,
        sourcesChanged: false,
        baseSection,
        targetSection: null,
        headingDiff: [{ kind: 'removed', text: baseSection.heading }],
        narrationDiff: [{ kind: 'removed', text: baseSection.narration }],
      });
    }
  }

  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  for (const sec of sections) {
    if (sec.status === 'added') addedCount++;
    else if (sec.status === 'removed') removedCount++;
    else if (sec.status === 'changed') changedCount++;
    else unchangedCount++;
  }

  return {
    titleChanged,
    titleDiff,
    sections,
    addedCount,
    removedCount,
    changedCount,
    unchangedCount,
  };
}
