/**
 * Tool-Registry — re-export der 6 konsolidierten Tools aus src/tools/.
 *
 * Vorher: viele Einzel-Handler (notiz_speichern, vault_suchen, ...).
 * Jetzt: 6 Dispatcher-Tools mit `modus`-Parameter, aus der KI-Tools-Library.
 */
import { TOOL_SCHEMAS, TOOL_HANDLERS } from "../tools/index.js";
import type { ChatTool } from "./client.js";

// TOOL_SCHEMAS aus den Tools hat exakt das OpenAI ChatTool-Format
export const TOOLS: ChatTool[] = TOOL_SCHEMAS as unknown as ChatTool[];

export { TOOL_HANDLERS };
