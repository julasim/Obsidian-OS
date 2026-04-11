// Session-Queue: serialisiert Runs pro Chat-ID
// Verhindert Race Conditions wenn zwei Nachrichten gleichzeitig ankommen

const queues = new Map<number, Promise<void>>();

export function enqueue(chatId: number, fn: () => Promise<void>): Promise<void> {
  const prev = queues.get(chatId) ?? Promise.resolve();

  const next = prev.then(fn, fn);
  queues.set(chatId, next);

  next.finally(() => {
    if (queues.get(chatId) === next) queues.delete(chatId);
  });

  return next;
}
