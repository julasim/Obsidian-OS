/**
 * LLM types — re-exports vom OpenAI SDK.
 *
 * Vorher: eigene Typen fuer @openrouter/sdk Kompatibilitaet.
 * Jetzt: direkt OpenAI SDK Typen, da der Client auf OpenAI SDK steht.
 */

export type {
  ChatMessage,
  ChatTool,
  ChatResponse,
  ChatResponseMessage,
} from "./client.js";

/** Tool-Schema (KI-Tools-Format). OpenAI SDK hat ChatTool, fuer unseren eigenen
 *  Type-Export nutzen wir einfach das KI-Tools-ToolSchema, das strukturell
 *  identisch zu OpenAI's ChatCompletionTool ist. */
export type { ToolSchema, ToolHandler, ToolArgs } from "../tools/_lib/types.js";
