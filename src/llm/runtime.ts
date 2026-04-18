import { chatComplete, buildDateLine } from "./client.js";
import type { ChatMessage } from "./client.js";
import { TOOLS } from "./tools.js";
import { executeTool } from "./executor.js";
import { runCompaction } from "./compaction.js";
import { loadAgentWorkspace, appendAgentConversation, loadAgentHistory, shouldCompact } from "../workspace/index.js";
import {
  DEFAULT_MODEL,
  MAX_HISTORY_CHARS,
  MAX_TOOL_ROUNDS,
  MESSAGE_PREVIEW_LENGTH,
  KEPT_TOOL_MESSAGES,
  HISTORY_LOAD_LIMIT,
} from "../config.js";
import { logInfo, logError } from "../logger.js";

// ---- Agent Runtime ----
// Pattern nach KI-Tools/INTEGRATION.md:
//   tool_choice="auto", Loop bis Modell keinen Tool-Call mehr macht.
//   Finaler content des Modells ist die Antwort an den User.

export async function processAgent(agentName: string, userMessage: string): Promise<string> {
  const preview =
    userMessage.length > MESSAGE_PREVIEW_LENGTH ? userMessage.slice(0, MESSAGE_PREVIEW_LENGTH) + "\u2026" : userMessage;
  logInfo(`[${agentName}] Start — "${preview}"`);

  const workspaceContext = loadAgentWorkspace(agentName);
  const dateLine = buildDateLine();
  const systemPrompt = workspaceContext ? `${dateLine}\n\n${workspaceContext}` : dateLine;

  const history = loadAgentHistory(agentName, HISTORY_LOAD_LIMIT);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.flatMap((h) => [
      { role: "user" as const, content: h.user },
      { role: "assistant" as const, content: h.assistant },
    ]),
    { role: "user", content: userMessage },
  ];

  let totalChars = messages.reduce((s, m) => s + JSON.stringify(m).length, 0);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chatComplete({
      model: DEFAULT_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    });

    const choice = response.choices?.[0];
    const reply = choice?.message;
    const finishReason = choice?.finish_reason ?? null;

    if (!reply) {
      logError(`[${agentName}]`, `API returned empty choices (finish=${finishReason})`);
      const fallback = "Ich konnte keine Antwort generieren.";
      appendAgentConversation(agentName, userMessage, fallback);
      return fallback;
    }

    // Assistant-Message (evtl. mit tool_calls) in History aufnehmen
    messages.push(reply as ChatMessage);
    totalChars += JSON.stringify(reply).length;

    // Kein Tool-Call → Modell hat direkt geantwortet → fertig
    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      const antwort = (reply.content ?? "").trim() || "Ich konnte keine Antwort generieren.";
      appendAgentConversation(agentName, userMessage, antwort);
      logInfo(`[${agentName}] Antwort (Runde ${round + 1}, ${antwort.length} Z, finish=${finishReason})`);
      if (shouldCompact(agentName)) await runCompaction(agentName);
      return antwort;
    }

    // Tool-Calls verarbeiten. OpenAI SDK v6 hat Union
    // (function | custom); wir unterstuetzen nur function-Typ.
    const functionCalls = reply.tool_calls.filter(
      (tc): tc is typeof tc & { type: "function"; function: { name: string; arguments: string } } =>
        tc.type === "function",
    );

    const toolSummary = functionCalls
      .map((tc) => {
        const argsRaw = tc.function.arguments || "";
        const argsShort = argsRaw.length > 120 ? argsRaw.slice(0, 120) + "..." : argsRaw;
        return `${tc.function.name}(${argsShort})`;
      })
      .join(", ");
    logInfo(`[${agentName}] Tools (Runde ${round + 1}): ${toolSummary}`);

    const toolResults: ChatMessage[] = await Promise.all(
      functionCalls.map(async (tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            content: `Fehler: Ungueltige Tool-Argumente fuer ${tc.function.name}.`,
          };
        }
        const result = await executeTool(tc.function.name, args);
        return { role: "tool" as const, tool_call_id: tc.id, content: result };
      }),
    );

    messages.push(...toolResults);
    for (const r of toolResults) totalChars += JSON.stringify(r).length;

    // History-Pruning: tool+assistant Paare muessen beieinander bleiben,
    // sonst verletzt der nachfolgende Request das OpenAI-Message-Schema.
    if (totalChars > MAX_HISTORY_CHARS) {
      const systemMsg = messages[0];
      let cutPoint = Math.max(1, messages.length - (KEPT_TOOL_MESSAGES * 3));

      // Rueckwaerts: wenn cutPoint auf tool-Message landet, eine zurueck
      while (cutPoint > 1 && messages[cutPoint].role === "tool") {
        cutPoint--;
      }

      const recentMsgs = messages.slice(cutPoint);
      const firstUserIdx = messages.findIndex((m, idx) => idx > 0 && m.role === "user");
      const firstUser = firstUserIdx > 0 && firstUserIdx < cutPoint ? [messages[firstUserIdx]] : [];
      messages.splice(0, messages.length, systemMsg, ...firstUser, ...recentMsgs);
      totalChars = messages.reduce((s, m) => s + JSON.stringify(m).length, 0);
    }
  }

  const fallback = "Ich konnte deine Anfrage nicht vollstaendig bearbeiten (Tool-Runden erschoepft).";
  appendAgentConversation(agentName, userMessage, fallback);
  logInfo(`[${agentName}] Fallback nach ${MAX_TOOL_ROUNDS} Runden`);
  if (shouldCompact(agentName)) await runCompaction(agentName);
  return fallback;
}

export const processMessage = (msg: string) => processAgent("Main", msg);
