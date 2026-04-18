/**
 * LLM-Client-Factory — erzeugt einen vorkonfigurierten OpenAI-Client.
 *
 * Funktioniert mit jedem OpenAI-kompatiblen Provider:
 *   - OpenRouter (Default) — https://openrouter.ai
 *   - Ollama lokal         — http://localhost:11434/v1
 *   - OpenAI direkt        — https://api.openai.com/v1
 *   - Together, Groq, etc.
 *
 * Konfiguration komplett ueber ENV (siehe config.ts):
 *   LLM_API_KEY / OPENROUTER_API_KEY
 *   LLM_BASE_URL   (Default: OpenRouter)
 *   LLM_MODEL      (Default: anthropic/claude-sonnet-4)
 *   LLM_APP_NAME   (OpenRouter X-Title Header)
 *   LLM_APP_URL    (OpenRouter HTTP-Referer Header)
 *
 * Verwendung:
 *   import { createLLMClient, LLM_MODEL } from "./_lib/llm.js";
 *   const client = createLLMClient();
 *   const resp = await client.chat.completions.create({
 *     model: LLM_MODEL,
 *     messages: [...],
 *     tools: [...],
 *   });
 */

import OpenAI from "openai";
import {
  LLM_API_KEY,
  LLM_BASE_URL,
  LLM_APP_NAME,
  LLM_APP_URL,
} from "./config.js";

/**
 * Erzeugt einen OpenAI-Client mit den konfigurierten ENV-Werten.
 * Optional: Parameter-Overrides fuer Sonderfaelle.
 */
export function createLLMClient(overrides?: {
  apiKey?: string;
  baseURL?: string;
  appName?: string;
  appURL?: string;
}): OpenAI {
  const apiKey = overrides?.apiKey ?? LLM_API_KEY;
  const baseURL = overrides?.baseURL ?? LLM_BASE_URL;
  const appName = overrides?.appName ?? LLM_APP_NAME;
  const appURL = overrides?.appURL ?? LLM_APP_URL;

  if (!apiKey) {
    throw new Error(
      "Kein LLM API-Key gesetzt. Setze LLM_API_KEY oder OPENROUTER_API_KEY als Umgebungsvariable.",
    );
  }

  // OpenRouter-spezifische Header — werden von anderen Providern ignoriert
  const defaultHeaders: Record<string, string> = {};
  if (appName) defaultHeaders["X-Title"] = appName;
  if (appURL) defaultHeaders["HTTP-Referer"] = appURL;

  return new OpenAI({
    baseURL,
    apiKey,
    defaultHeaders,
  });
}

/** Re-Export des konfigurierten Modellnamens fuer bequemen Zugriff */
export { LLM_MODEL } from "./config.js";
