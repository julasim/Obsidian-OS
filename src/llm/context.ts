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

let _currentDepth = 0;

export function setCurrentDepth(depth: number): void {
  _currentDepth = depth;
}

export function getCurrentDepth(): number {
  return _currentDepth;
}

type ProcessAgentFn = (name: string, msg: string, mode: "full" | "minimal", depth: number) => Promise<string>;
let _processAgentFn: ProcessAgentFn | null = null;

export function registerProcessAgent(fn: ProcessAgentFn): void {
  _processAgentFn = fn;
}

export function getProcessAgentFn(): ProcessAgentFn | null {
  return _processAgentFn;
}
