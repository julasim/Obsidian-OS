/**
 * Per-Request Context via AsyncLocalStorage.
 * Verhindert globale State-Kontamination bei parallelen Chat-Verarbeitungen.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface CallContext {
  replyFn: ((text: string) => Promise<void>) | null;
  fileSendFn: ((buffer: Buffer, filename: string) => Promise<void>) | null;
}

const store = new AsyncLocalStorage<CallContext>();

/**
 * Fuehrt eine Funktion mit gebundenem Reply/FileSend-Context aus.
 * Der Context propagiert automatisch durch die gesamte async-Kette —
 * auch in Tool-Handlern die getReplyFn()/getFileSendFn() aufrufen.
 */
export function withCallContext<T>(ctx: Partial<CallContext>, fn: () => T): T {
  return store.run(
    {
      replyFn: ctx.replyFn ?? null,
      fileSendFn: ctx.fileSendFn ?? null,
    },
    fn,
  );
}

// ---- Getter (fuer Handler) ----

export function getReplyFn(): ((text: string) => Promise<void>) | null {
  return store.getStore()?.replyFn ?? null;
}

type FileSendFn = (buffer: Buffer, filename: string) => Promise<void>;

export function getFileSendFn(): FileSendFn | null {
  return store.getStore()?.fileSendFn ?? null;
}
