import {
  noteHandlers,
  searchHandlers,
  taskHandlers,
  terminHandlers,
  obsidianHandlers,
} from "./handlers/index.js";
import type { ToolHandler } from "./handlers/index.js";

export {
  setReplyContext,
  getReplyFn,
  setCurrentDepth,
  getCurrentDepth,
  registerProcessAgent,
  getProcessAgentFn,
} from "./context.js";

// ---- Handler Registry ----

const registry = new Map<string, ToolHandler>();

for (const map of [noteHandlers, searchHandlers, taskHandlers, terminHandlers, obsidianHandlers]) {
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
