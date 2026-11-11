import type { DownloadPayload, TranscriptionPayload } from './api';

export type MediaPayload = TranscriptionPayload | DownloadPayload;
export type Attachment = { id: string | null; key: string; payload: MediaPayload; previous: string; databaseId?: string };
const storageKey = 'horus.transcription.pending.v1';
const textPrefix = 'horus.transcription.previous.';

export class InvalidReceiptError extends Error {}
export class ReceiptStorageError extends Error {
  constructor() { super('Não foi possível ler ou gravar o recibo no armazenamento local. Verifique a cota e as permissões. Nenhum texto será descartado automaticamente.'); }
}

export function inspectAttachment(): { attachment: Attachment | null; invalid: string | null; storage: string | null } {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return { attachment: null, invalid: null, storage: null };
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value.key !== 'string' || !value.key || !(value.id === null || typeof value.id === 'string')
        || (value.databaseId !== undefined && typeof value.databaseId !== 'string')) throw new InvalidReceiptError();
      const payload = value.payload;
      if (!(payload?.operation === 'transcription.run' && typeof payload.path === 'string'
        && typeof payload.model === 'string' && typeof payload.language === 'string')
        && !(payload?.operation === 'youtube.download' && typeof payload.url === 'string'
          && typeof payload.directory === 'string')) throw new InvalidReceiptError();
      // Compatível com recibos inline; ler não modifica nem remove o registro anterior.
      let previous = value.previous;
      if (value.previousRef !== undefined) {
        if (value.previousRef !== textPrefix + value.key) throw new InvalidReceiptError();
        previous = localStorage.getItem(value.previousRef);
      }
      if (typeof previous !== 'string') throw new InvalidReceiptError();
      return { attachment: { id: value.id, key: value.key, payload, previous, databaseId: value.databaseId }, invalid: null, storage: null };
    } catch (error) {
      if (error instanceof DOMException) throw error;
      return { attachment: null, invalid: 'O recibo local está inválido ou seu texto anterior está indisponível. Ele foi preservado para revisão.', storage: null };
    }
  } catch {
    return { attachment: null, invalid: null, storage: new ReceiptStorageError().message };
  }
}

export function saveAttachment(value: Attachment | null) {
  try {
    if (value) {
      const { previous, ...metadata } = value;
      if (previous) {
        const previousRef = textPrefix + value.key;
        // Texto anterior é escrito uma vez antes do recibo; mudanças de ID não o duplicam.
        if (localStorage.getItem(previousRef) !== previous) localStorage.setItem(previousRef, previous);
        localStorage.setItem(storageKey, JSON.stringify({ ...metadata, version: 2, previousRef }));
      } else localStorage.setItem(storageKey, JSON.stringify({ ...metadata, version: 2, previous: '' }));
    } else {
      const raw = localStorage.getItem(storageKey);
      let reference: string | undefined;
      try {
        const metadata = JSON.parse(raw ?? 'null');
        if (metadata?.previousRef === textPrefix + metadata?.key) reference = metadata.previousRef;
      } catch { /* Recibo corrompido também pode ser descartado explicitamente. */ }
      localStorage.removeItem(storageKey);
      if (reference) localStorage.removeItem(reference);
    }
  } catch { throw new ReceiptStorageError(); }
}
