/**
 * Barrel-Export — alle Tools + gemeinsame Types auf einen Schlag.
 *
 * Nutzung:
 *   import { TOOL_SCHEMAS, TOOL_HANDLERS } from "./ki-tools/index.js";
 */

import { schema as vaultSchema } from "./vault/schema.js";
import { handler as vaultHandler } from "./vault/handler.js";
import { schema as notizSchema } from "./notiz/schema.js";
import { handler as notizHandler } from "./notiz/handler.js";
import { schema as aufgabenSchema } from "./aufgaben/schema.js";
import { handler as aufgabenHandler } from "./aufgaben/handler.js";
import { schema as termineSchema } from "./termine/schema.js";
import { handler as termineHandler } from "./termine/handler.js";
import { schema as memorySchema } from "./memory/schema.js";
import { handler as memoryHandler } from "./memory/handler.js";
import { schema as exportSchema } from "./export/schema.js";
import { handler as exportHandler } from "./export/handler.js";
import { schema as projektSchema } from "./projekt/schema.js";
import { handler as projektHandler } from "./projekt/handler.js";
import { schema as planSchema } from "./plan/schema.js";
import { handler as planHandler } from "./plan/handler.js";

import type { ToolSchema, ToolHandler, ToolArgs } from "./_lib/types.js";

/** Alle Schemas in einem Array — direkt an LLM uebergebbar */
export const TOOL_SCHEMAS: ToolSchema[] = [
  vaultSchema,
  notizSchema,
  aufgabenSchema,
  termineSchema,
  memorySchema,
  exportSchema,
  projektSchema,
  planSchema,
];

/** Handler-Map: Tool-Name → Handler-Funktion */
export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  vault: vaultHandler,
  notiz: notizHandler,
  aufgaben: aufgabenHandler,
  termine: termineHandler,
  memory: memoryHandler,
  export: exportHandler,
  projekt: projektHandler,
  plan: planHandler,
};

// Re-exports fuer externe Nutzung
export type { ToolSchema, ToolHandler, ToolArgs };
export { createLLMClient, LLM_MODEL } from "./_lib/llm.js";
