// Session-Queue: serialisiert Runs pro Chat-ID
// Verhindert Race Conditions wenn zwei Nachrichten gleichzeitig ankommen

const queues = new Map<number, Promise<void>>();

export function enqueue(chatId: number, fn: () => Promise<void>): Promise<void> {
  const prev = queues.get(chatId) ?? Promise.resolve();

  // fn laeuft bei jeder prev-Resolution (fulfilled + rejected), damit die Queue
  // nicht nach einem Fehler stuck bleibt. Die IN der Map gespeicherte Promise
  // muss aber ihre Rejection "schlucken", sonst schlaegt sie auf den naechsten
  // enqueue-Caller durch und produziert `unhandledRejection`.
  const next = prev.then(fn, fn);
  // Gespeicherte Promise: Rejection zu undefined-resolved konvertieren.
  const stored = next.catch(() => { /* consumed, next enqueue sieht resolved */ });
  queues.set(chatId, stored);

  stored.finally(() => {
    if (queues.get(chatId) === stored) queues.delete(chatId);
  });

  // Caller erhaelt die originale next-Promise (inkl. potentieller Rejection),
  // damit await enqueue(...) Fehler sichtbar macht.
  return next;
}
