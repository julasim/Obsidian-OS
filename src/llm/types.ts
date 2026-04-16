/**
 * Shared LLM types — ersetzt OpenAI SDK Types.
 * Kompatibel mit OpenRouter SDK und OpenAI-kompatiblen APIs.
 */

/** Tool-Schema fuer Function-Calling */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** Chat-Message im OpenAI-kompatiblen Wire-Format (snake_case) */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | unknown[] }
  | { role: "assistant"; content?: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** Chat-Completion Response (vereinfacht) */
export interface ChatResponse {
  choices: Array<{
    message: {
      role: "assistant";
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
}
