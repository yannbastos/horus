import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ScriptDocument, ScriptSectionKind } from '../../services/scripts';
import {
  countWords,
  estimateNarrationSeconds,
  formatEstimatedDuration,
  generateNextSectionId,
  MAX_HEADING_LENGTH,
  MAX_NARRATION_TOTAL,
  MAX_SECTION_NARRATION,
  MAX_SECTIONS,
  MAX_TITLE_LENGTH,
  normalizeHumanDocument,
  validateHumanScriptDocument,
} from './scriptContract';

const SECTION_KIND_LABELS: Record<ScriptSectionKind, string> = {
  hook: 'GANCHO · HOOK',
  body: 'DESENVOLVIMENTO · BODY',
  conclusion: 'CONCLUSÃO · CONCLUSION',
};

type ScriptEditorProps = {
  mode: 'create' | 'edit';
  initialDocument: ScriptDocument;
  targetVersion?: number;
  submitting: boolean;
  apiError: string;
  isConflictError: boolean;
  onSave: (document: ScriptDocument) => Promise<void>;
  onReloadOnConflict: () => Promise<void>;
  onCancel: () => void;
};

export default function ScriptEditor({
  mode,
  initialDocument,
  targetVersion,
  submitting,
  apiError,
  isConflictError,
  onSave,
  onReloadOnConflict,
  onCancel,
}: ScriptEditorProps) {
  const titleId = useId();
  const titleErrorId = `${titleId}-error`;
  const [draft, setDraft] = useState<ScriptDocument>(() => initialDocument);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pendingFocusSectionIdRef = useRef<string | null>(null);
  const sectionHeadingRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const handleSubmitRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    setDraft(initialDocument);
    setAttemptedSubmit(false);
    setConfirmDiscard(false);
  }, [initialDocument]);

  const initialSnapshot = useMemo(() => JSON.stringify(initialDocument), [initialDocument]);
  const isDirty = useMemo(() => JSON.stringify(draft) !== initialSnapshot, [draft, initialSnapshot]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const targetId = pendingFocusSectionIdRef.current;
    if (!targetId) return;
    const input = sectionHeadingRefs.current[targetId];
    if (input) {
      input.focus();
      pendingFocusSectionIdRef.current = null;
    }
  }, [draft.sections]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!submitting) {
          void handleSubmitRef.current();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submitting]);

  const validation = useMemo(() => validateHumanScriptDocument(draft), [draft]);

  const metrics = useMemo(() => {
    let totalWords = 0;
    let totalChars = 0;
    const perSection = draft.sections.map(section => {
      const words = countWords(section.narration);
      const chars = section.narration.trim().length;
      totalWords += words;
      totalChars += chars;
      const seconds = estimateNarrationSeconds(words);
      return { words, chars, seconds };
    });
    const totalSeconds = estimateNarrationSeconds(totalWords);
    return { perSection, totalWords, totalChars, totalSeconds };
  }, [draft.sections]);

  const bodyCount = draft.sections.filter(s => s.kind === 'body').length;
  const canAddSection = draft.sections.length < MAX_SECTIONS;

  function handleTitleChange(title: string) {
    setDraft(prev => ({ ...prev, title }));
    if (confirmDiscard) setConfirmDiscard(false);
  }

  function handleSectionFieldChange(index: number, field: 'heading' | 'narration', value: string) {
    setDraft(prev => ({
      ...prev,
      sections: prev.sections.map((sec, idx) => (idx === index ? { ...sec, [field]: value } : sec)),
    }));
    if (confirmDiscard) setConfirmDiscard(false);
  }

  function handleAddBodySection() {
    if (!canAddSection) return;
    const newId = generateNextSectionId(draft.sections);
    pendingFocusSectionIdRef.current = newId;
    setDraft(prev => {
      const nextSection = {
        id: newId,
        kind: 'body' as const,
        heading: '',
        narration: '',
        source_ids: [],
      };
      const conclusionIndex = prev.sections.findIndex(s => s.kind === 'conclusion');
      const insertAt = conclusionIndex >= 0 ? conclusionIndex : prev.sections.length;
      const nextSections = [...prev.sections];
      nextSections.splice(insertAt, 0, nextSection);
      return { ...prev, sections: nextSections };
    });
    if (confirmDiscard) setConfirmDiscard(false);
  }

  function handleRemoveSection(index: number) {
    const target = draft.sections[index];
    if (!target || target.kind !== 'body' || bodyCount <= 1) return;
    setDraft(prev => ({
      ...prev,
      sections: prev.sections.filter((_, idx) => idx !== index),
    }));
    if (confirmDiscard) setConfirmDiscard(false);
  }

  function handleMoveSection(index: number, direction: -1 | 1) {
    const target = draft.sections[index];
    const swapIndex = index + direction;
    const swapTarget = draft.sections[swapIndex];
    if (!target || !swapTarget || target.kind !== 'body' || swapTarget.kind !== 'body') {
      return;
    }
    setDraft(prev => {
      const next = [...prev.sections];
      next[index] = prev.sections[swapIndex];
      next[swapIndex] = prev.sections[index];
      return { ...prev, sections: next };
    });
    if (confirmDiscard) setConfirmDiscard(false);
  }

  async function handleSubmit() {
    setAttemptedSubmit(true);
    setConfirmDiscard(false);
    if (!validation.valid) {
      if (validation.titleError) {
        titleInputRef.current?.focus();
      }
      return;
    }
    await onSave(normalizeHumanDocument(draft));
  }

  handleSubmitRef.current = handleSubmit;

  function handleRequestCancel() {
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    onCancel();
  }

  const editorHeading =
    mode === 'create'
      ? 'Escrever roteiro do zero'
      : `Editar roteiro (nova versão a partir da v${targetVersion ?? 1})`;

  return (
    <div
      className="card sunken"
      role="region"
      aria-label="Editor de roteiro humano"
      style={{ gap: '14px' }}
    >
      <div className="row spread">
        <div>
          <p className="eyebrow accent">EDITOR DE ROTEIRO · AUTORIA HUMANA</p>
          <h3>{editorHeading}</h3>
        </div>
        <div className="row">
          <span className="tag">ESCRITO POR VOCÊ</span>
          {isDirty && <span className="tag warn">ALTERAÇÕES NÃO SALVAS</span>}
        </div>
      </div>

      <p className="muted">
        Edição local sem IA e sem envio externo. Ao salvar, uma nova versão entra na fila de revisão humana
        para aprovação explícita antes da produção.
      </p>

      <div className="fact-item" style={{ background: 'var(--Background)' }}>
        <div className="row spread">
          <span className="eyebrow">
            RESUMO DO ROTEIRO · {draft.sections.length}/{MAX_SECTIONS} SEÇÕES
          </span>
          <div className="row">
            <span className="tag">{metrics.totalWords} palavras</span>
            <span className="tag">
              {metrics.totalChars.toLocaleString('pt-BR')}/{MAX_NARRATION_TOTAL.toLocaleString('pt-BR')} chars
            </span>
            <span className="tag warn" title="Cálculo aproximado baseado na contagem de palavras (~145 ppm), não é medição acústica.">
              Duração total (ESTIMATIVA): {formatEstimatedDuration(metrics.totalSeconds)}
            </span>
          </div>
        </div>
        <small className="muted">
          Estimativa visual (~145 ppm; a duração final depende da voz escolhida). Para 60–120 s, comece com ~150–200 palavras.
        </small>
      </div>

      {apiError && (
        <div className="fact-item error-card" role="alert" style={{ background: 'var(--Background)' }}>
          <p className="error">{apiError}</p>
          {isConflictError && (
            <div className="actions">
              <button
                className="button"
                type="button"
                disabled={submitting}
                onClick={() => void onReloadOnConflict()}
              >
                Recarregar versão atual
              </button>
            </div>
          )}
        </div>
      )}

      {attemptedSubmit && !validation.valid && (
        <div className="fact-item error-card" role="alert" style={{ background: 'var(--Background)' }}>
          <p className="eyebrow" style={{ color: 'var(--Bad)' }}>
            CORRIJA OS CAMPOS ANTES DE SALVAR
          </p>
          {validation.documentErrors.map((msg, idx) => (
            <p key={idx} className="error">
              {msg}
            </p>
          ))}
          {(validation.titleError || Object.keys(validation.sectionErrors).length > 0) && (
            <p className="error">
              Revise os campos destacados abaixo{Object.keys(validation.sectionErrors).length > 0 ? ` em ${Object.keys(validation.sectionErrors).length} seção(ões)` : ''}.
            </p>
          )}
        </div>
      )}

      <label htmlFor={titleId}>
        Título do roteiro ({draft.title.trim().length}/{MAX_TITLE_LENGTH} chars)
        <input
          ref={titleInputRef}
          id={titleId}
          type="text"
          value={draft.title}
          maxLength={MAX_TITLE_LENGTH}
          disabled={submitting}
          placeholder="Ex.: Automação local de roteiros com supervisão humana"
          aria-invalid={attemptedSubmit && validation.titleError ? true : undefined}
          aria-describedby={attemptedSubmit && validation.titleError ? titleErrorId : undefined}
          onChange={e => handleTitleChange(e.target.value)}
        />
      </label>
      {attemptedSubmit && validation.titleError && (
        <p id={titleErrorId} className="error" role="alert">
          {validation.titleError}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="row spread">
          <p className="eyebrow">SEÇÕES DO ROTEIRO ({draft.sections.length})</p>
          <button
            className="button"
            type="button"
            disabled={submitting || !canAddSection}
            onClick={handleAddBodySection}
          >
            Adicionar seção
          </button>
        </div>

        {draft.sections.map((section, index) => {
          const secMetrics = metrics.perSection[index];
          const secErrors = attemptedSubmit ? validation.sectionErrors[index] : undefined;
          const isBody = section.kind === 'body';
          const canMoveUp = isBody && draft.sections[index - 1]?.kind === 'body';
          const canMoveDown = isBody && draft.sections[index + 1]?.kind === 'body';
          const canRemove = isBody && bodyCount > 1;
          const headingInputId = `${titleId}-sec-${index}-heading`;
          const headingErrorId = `${headingInputId}-error`;
          const narrationInputId = `${titleId}-sec-${index}-narration`;
          const narrationErrorId = `${narrationInputId}-error`;

          return (
            <div
              key={section.id}
              className="fact-item"
              role="group"
              aria-label={`Editor da seção ${index + 1}: ${SECTION_KIND_LABELS[section.kind]}`}
              style={{ background: 'var(--Background)', gap: '10px' }}
            >
              <div className="row spread">
                <div className="row">
                  <span className="tag">#{index + 1}</span>
                  <span className="eyebrow accent">{SECTION_KIND_LABELS[section.kind]}</span>
                  <span className="eyebrow muted">({section.id})</span>
                </div>
                <div className="row">
                  <span className="tag">{secMetrics.words} palavras</span>
                  <span className="tag">
                    ESTIMATIVA: {formatEstimatedDuration(secMetrics.seconds)}
                  </span>
                  {isBody && (
                    <>
                      <button
                        className="button"
                        type="button"
                        disabled={submitting || !canMoveUp}
                        aria-label={`Mover seção ${index + 1} para cima`}
                        style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                        onClick={() => handleMoveSection(index, -1)}
                      >
                        Subir
                      </button>
                      <button
                        className="button"
                        type="button"
                        disabled={submitting || !canMoveDown}
                        aria-label={`Mover seção ${index + 1} para baixo`}
                        style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                        onClick={() => handleMoveSection(index, 1)}
                      >
                        Descer
                      </button>
                      <button
                        className="button"
                        type="button"
                        disabled={submitting || !canRemove}
                        aria-label={`Remover seção ${index + 1}`}
                        style={{ padding: '4px 10px', minHeight: '28px', fontSize: '10px' }}
                        onClick={() => handleRemoveSection(index)}
                      >
                        Remover
                      </button>
                    </>
                  )}
                </div>
              </div>

              <label htmlFor={headingInputId}>
                Título da seção #{index + 1} ({section.heading.trim().length}/{MAX_HEADING_LENGTH})
                <input
                  ref={el => {
                    sectionHeadingRefs.current[section.id] = el;
                  }}
                  id={headingInputId}
                  type="text"
                  value={section.heading}
                  maxLength={MAX_HEADING_LENGTH}
                  disabled={submitting}
                  placeholder={
                    section.kind === 'hook'
                      ? 'Ex.: Abertura e gancho inicial'
                      : section.kind === 'conclusion'
                      ? 'Ex.: Fechamento e chamada final'
                      : 'Ex.: Desenvolvimento do argumento'
                  }
                  aria-invalid={secErrors?.heading ? true : undefined}
                  aria-describedby={secErrors?.heading ? headingErrorId : undefined}
                  onChange={e => handleSectionFieldChange(index, 'heading', e.target.value)}
                />
              </label>
              {secErrors?.heading && (
                <p id={headingErrorId} className="error" role="alert">
                  {secErrors.heading}
                </p>
              )}

              <label htmlFor={narrationInputId}>
                Narração da seção #{index + 1} ({secMetrics.words} palavras · {secMetrics.chars}/{MAX_SECTION_NARRATION} chars)
                <textarea
                  id={narrationInputId}
                  value={section.narration}
                  maxLength={MAX_SECTION_NARRATION}
                  rows={4}
                  disabled={submitting}
                  placeholder="Escreva o texto falado desta seção..."
                  aria-invalid={secErrors?.narration ? true : undefined}
                  aria-describedby={secErrors?.narration ? narrationErrorId : undefined}
                  onChange={e => handleSectionFieldChange(index, 'narration', e.target.value)}
                />
              </label>
              {secErrors?.narration && (
                <p id={narrationErrorId} className="error" role="alert">
                  {secErrors.narration}
                </p>
              )}

              {section.source_ids.length > 0 && (
                <small className="muted">Fontes vinculadas preservadas: {section.source_ids.join(', ')}</small>
              )}
            </div>
          );
        })}
      </div>

      {confirmDiscard && (
        <div className="fact-item" role="alertdialog" aria-label="Confirmar descarte de alterações não salvas" style={{ borderColor: 'var(--Warn)' }}>
          <p className="eyebrow warn">ALTERAÇÕES NÃO SALVAS</p>
          <p className="muted">
            Existem alterações não salvas no editor. Deseja descartá-las e sair da edição?
          </p>
          <div className="actions">
            <button
              className="button"
              type="button"
              disabled={submitting}
              onClick={onCancel}
            >
              Descartar alterações
            </button>
            <button
              className="button primary"
              type="button"
              disabled={submitting}
              onClick={() => setConfirmDiscard(false)}
            >
              Continuar editando
            </button>
          </div>
        </div>
      )}

      <div className="actions">
        <button
          className="button primary"
          type="button"
          disabled={submitting}
          title="Salvar roteiro (Ctrl+S)"
          onClick={() => void handleSubmit()}
        >
          {submitting
            ? 'Salvando…'
            : mode === 'create'
            ? 'Salvar roteiro'
            : 'Salvar como nova versão'}
        </button>
        <button
          className="button"
          type="button"
          disabled={submitting}
          onClick={handleRequestCancel}
        >
          Cancelar
        </button>
        <small className="muted">Atalho: Ctrl+S para salvar</small>
      </div>
    </div>
  );
}
