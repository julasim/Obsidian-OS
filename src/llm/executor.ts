import {
  noteHandlers,
  searchHandlers,
  obsidianHandlers,
  exportHandlers,
} from "./handlers/index.js";
import type { ToolHandler } from "./handlers/index.js";

export {
  setReplyContext,
  getReplyFn,
  setFileSendContext,
  getFileSendFn,
} from "./context.js";

// ---- Handler Registry ----

const registry = new Map<string, ToolHandler>();

for (const map of [noteHandlers, searchHandlers, obsidianHandlers, exportHandlers]) {
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
    return `Fehler bei ${name}: ${err}`;
  }
}
