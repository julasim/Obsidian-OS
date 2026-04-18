import OpenAI from "openai";
import { LLM_BASE_URL, LLM_API_KEY, LLM_APP_NAME, LLM_APP_URL, LOCALE, TIMEZONE } from "../config.js";
import { logError, logWarn } from "../logger.js";

// ── OpenAI-kompatibler Client ────────────────────────────────────────────────
// Funktioniert mit OpenRouter, OpenAI direkt, Ollama (OpenAI-kompatibler Endpoint),
// Together, Groq. Provider-Wechsel rein ueber ENV (LLM_BASE_URL, LLM_API_KEY).
const defaultHeaders: Record<string, string> = {};
if (LLM_APP_NAME) defaultHeaders["X-Title"] = LLM_APP_NAME;
if (LLM_APP_URL) defaultHeaders["HTTP-Referer"] = LLM_APP_URL;

export const client = new OpenAI({
  apiKey: LLM_API_KEY,
  baseURL: LLM_BASE_URL,
  defaultHeaders,
});

// HTTP-Timeout + Retry fuer flakige Free-Tier-Provider.
const LLM_HTTP_TIMEOUT_MS = Number(process.env.LLM_HTTP_TIMEOUT_MS ?? 60_000);
const LLM_MAX_RETRIES = Number(process.env.LLM_MAX_RETRIES ?? 2);

// ── Date-Line Helper ───────────────────────────────────────────────────────────
export function buildDateLine(): string {
  return `Heute ist: ${new Date().toLocaleDateString(LOCALE, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: TIMEZONE,
  })}`;
}

// ── Chat-Completion Wrapper mit Retry + Timeout ──────────────────────────────

export type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;
export type ChatResponseMessage = OpenAI.Chat.ChatCompletionMessage;
export type ChatTool = OpenAI.Chat.ChatCompletionTool;
export type ChatResponse = OpenAI.Chat.ChatCompletion;

interface ChatCompleteParams {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: OpenAI.Chat.ChatCompletionToolChoiceOption;
  max_tokens?: number;
}

/** Retry-faehige Fehler: Netzwerk, Timeout, 5xx, 429. */
function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; name?: string; code?: string };
  const status = e?.status ?? e?.statusCode;
  if (status !== undefined) {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  if (e?.name === "AbortError") return true;
  if (e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT" || e?.code === "EAI_AGAIN") return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function chatComplete(params: ChatCompleteParams): Promise<ChatResponse> {
  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= LLM_MAX_RETRIES) {
    const ac = new AbortController();
    const timeoutHandle = setTimeout(() => ac.abort(), LLM_HTTP_TIMEOUT_MS);

    try {
      const result = await client.chat.completions.create(
        {
          model: params.model,
          messages: params.messages,
          tools: params.tools,
          tool_choice: params.tool_choice,
          max_tokens: params.max_tokens,
        },
        { signal: ac.signal },
      );
      clearTimeout(timeoutHandle);
      return result;
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      lastErr = err;

      // OpenAI-SDK-Error-Details (status + body) extrahieren wenn vorhanden,
      // damit wir bei 4xx den konkreten Grund sehen (dead model, bad key, ...)
      const e = err as { name?: string; status?: number; message?: string; error?: { message?: string } };
      if (e?.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
        const detail = e.error?.message ?? e.message ?? "";
        logError("LLM-SDK", `${e.name ?? "Error"} ${e.status}: ${detail}`);
      }

      if (attempt >= LLM_MAX_RETRIES || !isRetryable(err)) break;

      const delay = 500 * Math.pow(3, attempt) + Math.floor(Math.random() * 300);
      logWarn(`LLM-Retry ${attempt + 1}/${LLM_MAX_RETRIES} in ${delay}ms (${e?.name ?? "error"})`);
      await sleep(delay);
      attempt++;
    }
  }

  throw lastErr;
}
