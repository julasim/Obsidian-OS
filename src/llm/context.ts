/**
 * Shared runtime context — bricht zirkulaere Abhaengigkeiten
 * zwischen executor.ts und den Handler-Modulen.
 */

let _replyFn: ((text: string) => Promise<void>) | null = null;

export function setReplyContext(fn: (text: string) => Promise<void>): void {
  _replyFn = fn;
}

export function getReplyFn(): ((text: string) => Promise<void>) | null {
  return _replyFn;
}

// ---- File-Send Context (fuer PDF/DOCX-Export via Telegram) ----

type FileSendFn = (buffer: Buffer, filename: string) => Promise<void>;
let _fileSendFn: FileSendFn | null = null;

export function setFileSendContext(fn: FileSendFn): void {
  _fileSendFn = fn;
}

export function getFileSendFn(): FileSendFn | null {
  return _fileSendFn;
}
