import { OpenRouter } from "@openrouter/sdk";
import { LLM_BASE_URL, LLM_API_KEY, LLM_APP_NAME, LLM_APP_URL, LLM_IS_LOCAL, LOCALE, TIMEZONE } from "../config.js";
import type { ToolSchema, ChatMessage, ChatResponse } from "./types.js";
import { logError, logWarn } from "../logger.js";

// HTTP-Timeout fuer LLM-Calls. Free-Tier-Provider auf OpenRouter koennen
// minutenlang haengen bevor sie fehlschlagen; ohne Timeout sitzt der User
// bei jeder Nachricht 2+ Min im Typing-Indicator.
const LLM_HTTP_TIMEOUT_MS = Number(process.env.LLM_HTTP_TIMEOUT_MS ?? 60_000);
const LLM_MAX_RETRIES = Number(process.env.LLM_MAX_RETRIES ?? 2);

// ── OpenRouter Client ──────────────────────────────────────────────────────────
export const client = new OpenRouter({
  apiKey: LLM_API_KEY,
  // serverURL erlaubt auch Ollama/Custom-Provider (backward-compat)
  ...(LLM_IS_LOCAL ? { serverURL: LLM_BASE_URL } : {}),
  appTitle: LLM_APP_NAME || undefined,
  httpReferer: LLM_APP_URL || undefined,
});

// ── Date-Line Helper ───────────────────────────────────────────────────────────
export function buildDateLine(): string {
  return `Heute ist: ${new Date().toLocaleDateString(LOCALE, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: TIMEZONE,
  })}`;
}

// ── Chat-Completion Wrapper ────────────────────────────────────────────────────
// Konvertiert zwischen snake_case (unser Code) und camelCase (SDK).

interface ChatCompleteParams {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  tool_choice?: "required" | "auto" | "none";
  max_tokens?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSdkMessages(msgs: ChatMessage[]): any[] {
  return msgs.map((msg) => {
    if (msg.role === "tool") {
      return { role: "tool", toolCallId: msg.tool_call_id, content: msg.content };
    }
    if (msg.role === "assistant" && msg.tool_calls) {
      return { role: "assistant", content: msg.content, toolCalls: msg.tool_calls };
    }
    return msg;
  });
}

function fromSdkChoice(choice: any): ChatResponse["choices"][0] {
  const msg = choice.message;
  return {
    message: {
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: msg.toolCalls?.map((tc: any) => ({
        id: tc.id,
        type: tc.type ?? "function",
        function: tc.function,
      })),
    },
    finish_reason: choice.finishReason ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Retry-faehige Fehler: Netzwerk, Timeout, 5xx, 429, Validation (transient).
 *  Nicht retryen: 400/401/403/404 (Modell/Key-Probleme — Retry macht's nicht besser). */
function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; name?: string; code?: string; constructor?: { name?: string } };
  const status = e?.status ?? e?.statusCode;
  if (status !== undefined) {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  // AbortError (Timeout) oder Netzwerk-Code
  if (e?.name === "AbortError" || e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT" || e?.code === "EAI_AGAIN") return true;
  // Validation: retryen hilft bei kurzen Provider-Hiccups, aber nur einmal (wird durch maxRetries ohnehin begrenzt)
  if (e?.name === "ResponseValidationError" || e?.constructor?.name === "ResponseValidationError") return true;
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
      // SDK akzeptiert options als zweites Argument mit fetchOptions.signal
      const result = await client.chat.send(
        {
          chatRequest: {
            model: params.model,
            messages: toSdkMessages(params.messages) as any,
            tools: params.tools as any,
            toolChoice: params.tool_choice as any,
            maxTokens: params.max_tokens ?? undefined,
            stream: false,
          },
        },
        { fetchOptions: { signal: ac.signal } } as any,
      );
      clearTimeout(timeoutHandle);
      return { choices: result.choices.map(fromSdkChoice) };
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      lastErr = err;

      // ResponseValidationError: Raw-Body einmal loggen (unabhaengig von Retry)
      const e = err as { name?: string; rawValue?: unknown; cause?: unknown; constructor?: { name?: string } };
      const isValidation =
        e?.name === "ResponseValidationError" ||
        e?.constructor?.name === "ResponseValidationError" ||
        e?.rawValue !== undefined;
      if (isValidation) {
        try {
          const raw = JSON.stringify(e.rawValue ?? e.cause, null, 0).slice(0, 4000);
          logError("LLM-SDK", `ResponseValidationError raw=${raw}`);
        } catch {
          logError("LLM-SDK", "ResponseValidationError (raw body not serializable)");
        }
      }

      if (attempt >= LLM_MAX_RETRIES || !isRetryable(err)) break;

      // Exponential backoff mit Jitter: 500ms, 1500ms, ...
      const delay = 500 * Math.pow(3, attempt) + Math.floor(Math.random() * 300);
      logWarn(`LLM-Retry ${attempt + 1}/${LLM_MAX_RETRIES} in ${delay}ms (${e?.name ?? "error"})`);
      await sleep(delay);
      attempt++;
    }
  }

  throw lastErr;
}
