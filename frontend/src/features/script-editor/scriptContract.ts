import type { ScriptDocument, ScriptSection } from '../../services/scripts';

export const MIN_SECTIONS = 3;
export const MAX_SECTIONS = 30;
export const MAX_TITLE_LENGTH = 200;
export const MAX_HEADING_LENGTH = 200;
export const MAX_SECTION_NARRATION = 8000;
export const MAX_NARRATION_TOTAL = 60000;
export const MAX_SOURCE_IDS = 50;
export const SECTION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

/** Referência aproximada (~145 ppm) usada apenas para estimativa visual no editor, nunca medição acústica. */
export const WORDS_PER_MINUTE_ESTIMATE = 145;

export type SectionValidationErrors = {
  id?: string;
  kind?: string;
  heading?: string;
  narration?: string;
  source_ids?: string;
};

export type ScriptValidationResult = {
  valid: boolean;
  titleError?: string;
  documentErrors: string[];
  sectionErrors: Record<number, SectionValidationErrors>;
};

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function estimateNarrationSeconds(wordCount: number): number {
  if (wordCount <= 0) return 0;
  return Math.max(1, Math.round((wordCount / WORDS_PER_MINUTE_ESTIMATE) * 60));
}

export function formatEstimatedDuration(seconds: number): string {
  if (seconds <= 0) return '~0 s';
  if (seconds < 60) return `~${seconds} s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `~${mins} min ${rem} s` : `~${mins} min`;
}

export function generateNextSectionId(existingSections: ScriptSection[]): string {
  const used = new Set(existingSections.map(s => s.id));
  let index = 1;
  while (used.has(`body-${index}`)) {
    index += 1;
  }
  return `body-${index}`;
}

export function createBlankHumanDocument(): ScriptDocument {
  return {
    schema_version: 1,
    simulated: false,
    title: '',
    sections: [
      { id: 'hook', kind: 'hook', heading: '', narration: '', source_ids: [] },
      { id: 'body-1', kind: 'body', heading: '', narration: '', source_ids: [] },
      { id: 'conclusion', kind: 'conclusion', heading: '', narration: '', source_ids: [] },
    ],
  };
}

export function cloneDocumentForEditing(document: ScriptDocument): ScriptDocument {
  return {
    schema_version: 1,
    simulated: false,
    title: document.title,
    sections: document.sections.map(section => ({
      id: section.id,
      kind: section.kind,
      heading: section.heading,
      narration: section.narration,
      source_ids: [...section.source_ids],
    })),
  };
}

export function normalizeHumanDocument(document: ScriptDocument): ScriptDocument {
  return {
    schema_version: 1,
    simulated: false,
    title: document.title.trim(),
    sections: document.sections.map(section => ({
      id: section.id.trim(),
      kind: section.kind,
      heading: section.heading.trim(),
      narration: section.narration.trim(),
      source_ids: section.source_ids.map(id => id.trim()),
    })),
  };
}

export function validateHumanScriptDocument(document: ScriptDocument): ScriptValidationResult {
  const documentErrors: string[] = [];
  const sectionErrors: Record<number, SectionValidationErrors> = {};
  let titleError: string | undefined;

  const title = document.title.trim();
  if (!title) {
    titleError = 'O título do roteiro é obrigatório. Informe um título curto para identificar o vídeo.';
  } else if (title.length > MAX_TITLE_LENGTH) {
    titleError = `O título deve ter no máximo ${MAX_TITLE_LENGTH} caracteres. Reduza ${title.length - MAX_TITLE_LENGTH} caractere(s).`;
  }

  const sections = document.sections;
  if (sections.length < MIN_SECTIONS) {
    documentErrors.push(`O roteiro precisa de ao menos ${MIN_SECTIONS} seções.`);
  } else if (sections.length > MAX_SECTIONS) {
    documentErrors.push(`O roteiro pode ter no máximo ${MAX_SECTIONS} seções.`);
  }

  const kinds = sections.map(s => s.kind);
  const hookCount = kinds.filter(k => k === 'hook').length;
  const conclusionCount = kinds.filter(k => k === 'conclusion').length;
  const bodyCount = kinds.filter(k => k === 'body').length;

  if (sections.length > 0 && (hookCount !== 1 || sections[0].kind !== 'hook')) {
    documentErrors.push('A primeira seção deve ser exatamente uma abertura (hook).');
  }
  if (sections.length > 0 && (conclusionCount !== 1 || sections[sections.length - 1].kind !== 'conclusion')) {
    documentErrors.push('A última seção deve ser exatamente uma conclusão (conclusion).');
  }
  if (bodyCount < 1) {
    documentErrors.push('Inclua ao menos uma seção de desenvolvimento (body).');
  }

  const seenIds = new Set<string>();
  let totalNarrationChars = 0;

  sections.forEach((section, index) => {
    const errors: SectionValidationErrors = {};
    const id = section.id.trim();
    const heading = section.heading.trim();
    const narration = section.narration.trim();

    if (!SECTION_ID_PATTERN.test(id)) {
      errors.id = 'ID da seção deve começar com letra e ter até 32 caracteres (letras, números, _ ou -).';
    } else if (seenIds.has(id)) {
      errors.id = 'ID da seção repetido.';
    }
    seenIds.add(id);

    if (!heading) {
      errors.heading = 'O título da seção é obrigatório. Preencha este campo para identificar a seção.';
    } else if (heading.length > MAX_HEADING_LENGTH) {
      errors.heading = `O título da seção deve ter no máximo ${MAX_HEADING_LENGTH} caracteres. Reduza ${heading.length - MAX_HEADING_LENGTH} caractere(s).`;
    }

    if (!narration) {
      errors.narration = 'A narração da seção é obrigatória. Escreva o texto que será falado neste trecho.';
    } else if (narration.length > MAX_SECTION_NARRATION) {
      errors.narration = `A narração da seção deve ter no máximo ${MAX_SECTION_NARRATION} caracteres. Reduza ${narration.length - MAX_SECTION_NARRATION} caractere(s).`;
    }
    totalNarrationChars += narration.length;

    if (section.source_ids.length > MAX_SOURCE_IDS) {
      errors.source_ids = `Máximo de ${MAX_SOURCE_IDS} fontes por seção.`;
    } else if (new Set(section.source_ids).size !== section.source_ids.length) {
      errors.source_ids = 'Há IDs de fonte repetidos nesta seção.';
    }

    if (Object.keys(errors).length > 0) {
      sectionErrors[index] = errors;
    }
  });

  if (totalNarrationChars > MAX_NARRATION_TOTAL) {
    documentErrors.push(
      `A narração total ultrapassa o limite de ${MAX_NARRATION_TOTAL.toLocaleString('pt-BR')} caracteres.`
    );
  }

  const valid = !titleError && documentErrors.length === 0 && Object.keys(sectionErrors).length === 0;
  return { valid, titleError, documentErrors, sectionErrors };
}
