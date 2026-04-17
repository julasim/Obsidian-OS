import { OpenRouter } from "@openrouter/sdk";
import { LLM_BASE_URL, LLM_API_KEY, LLM_APP_NAME, LLM_APP_URL, LLM_IS_LOCAL, LOCALE, TIMEZONE } from "../config.js";
import type { ToolSchema, ChatMessage, ChatResponse } from "./types.js";
import { logError } from "../logger.js";

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

export async function chatComplete(params: ChatCompleteParams): Promise<ChatResponse> {
  let result;
  try {
    result = await client.chat.send({
      chatRequest: {
        model: params.model,
        messages: toSdkMessages(params.messages) as any,
        tools: params.tools as any,
        toolChoice: params.tool_choice as any,
        maxTokens: params.max_tokens ?? undefined,
        stream: false,
      },
    });
  } catch (err: unknown) {
    // SDK wirft ResponseValidationError wenn die API-Antwort nicht zum Zod-Schema
    // passt — haeufig bei Free-Tier-Modellen mit flakigem Tool-Calling oder bei
    // Provider-Timeouts. Raw-Body ausgeben, sonst ist das nicht debugbar.
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
    throw err;
  }

  return {
    choices: result.choices.map(fromSdkChoice),
  };
}
