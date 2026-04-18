import { TOOL_HANDLERS } from "../tools/index.js";
import { logError } from "../logger.js";

export {
  getReplyFn,
  getFileSendFn,
} from "./context.js";

// ---- Tool Executor ----

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    const handler = TOOL_HANDLERS[name];
    if (!handler) return `Unbekanntes Tool: ${name}`;
    // Handler erwarten ToolArgs = Record<string, string|number|boolean|undefined>
    return await handler(args as Record<string, string | number | boolean | undefined>);
  } catch (err) {
    logError(`tool:${name}`, err);
    const msg = err instanceof Error ? err.message : String(err);
    return `Fehler bei ${name}: ${msg}`;
  }
}
