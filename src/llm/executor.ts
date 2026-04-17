import {
  noteHandlers,
  searchHandlers,
  taskHandlers,
  terminHandlers,
  projektHandlers,
  obsidianHandlers,
  exportHandlers,
} from "./handlers/index.js";
import type { ToolHandler } from "./handlers/index.js";
import { logError } from "../logger.js";

export {
  getReplyFn,
  getFileSendFn,
} from "./context.js";

// ---- Handler Registry ----

const registry = new Map<string, ToolHandler>();

for (const map of [noteHandlers, searchHandlers, taskHandlers, terminHandlers, projektHandlers, obsidianHandlers, exportHandlers]) {
  for (const [name, handler] of Object.entries(map)) {
    registry.set(name, handler);
  }
}

// ---- Tool Executor ----

export async function executeTool(name: string, args: Record<string, string | number>): Promise<string> {
  try {
    const handler = registry.get(name);
    if (handler) return await handler(args);
    return `Unbekanntes Tool: ${name}`;
  } catch (err) {
    // Frueher: nur Stringification an den Agent zurueck — kein Stack im Log,
    // Fehler unsichtbar fuer den Operator. Jetzt: strukturiert loggen +
    // knappere Message an den Agent (damit das Tool-Result nicht mit
    // Stack-Trace volllaeuft).
    logError(`tool:${name}`, err);
    const msg = err instanceof Error ? err.message : String(err);
    return `Fehler bei ${name}: ${msg}`;
  }
}
