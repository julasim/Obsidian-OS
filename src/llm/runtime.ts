import type OpenAI from "openai";
import { client, buildDateLine } from "./client.js";
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

export async function processAgent(agentName: string, userMessage: string): Promise<string> {
  const preview =
    userMessage.length > MESSAGE_PREVIEW_LENGTH ? userMessage.slice(0, MESSAGE_PREVIEW_LENGTH) + "\u2026" : userMessage;
  logInfo(`[${agentName}] Start — "${preview}"`);

  const workspaceContext = loadAgentWorkspace(agentName);
  const dateLine = buildDateLine();
  const systemPrompt = workspaceContext ? `${dateLine}\n\n${workspaceContext}` : dateLine;

  const history = loadAgentHistory(agentName, HISTORY_LOAD_LIMIT);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.flatMap((h) => [
      { role: "user" as const, content: h.user },
      { role: "assistant" as const, content: h.assistant },
    ]),
    { role: "user", content: userMessage },
  ];

  let totalChars = messages.reduce((s, m) => s + JSON.stringify(m).length, 0);

  let enforcementRetries = 0;
  const MAX_ENFORCEMENT_RETRIES = 2;

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "required",
    });

    const choice = response.choices[0];
    const reply = choice?.message;
    const finishReason = choice?.finish_reason;
    if (!reply) {
      logError(`[${agentName}]`, "API returned empty choices");
      break;
    }
    messages.push(reply);
    totalChars += JSON.stringify(reply).length;

    // Modell hat tool_choice="required" ignoriert → Diagnose + harter Retry
    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      const contentPreview = (reply.content ?? "")
        .slice(0, 200)
        .replace(/\s+/g, " ")
        .trim();
      logInfo(
        `[${agentName}] Kein Tool (Runde ${i + 1}, finish=${finishReason}, retries=${enforcementRetries}): "${contentPreview}"`,
      );

      // Retry: Modell explizit zum Tool-Call zwingen
      if (enforcementRetries < MAX_ENFORCEMENT_RETRIES) {
        enforcementRetries++;
        messages.push({
          role: "user",
          content:
            "REGELVERSTOSS: Du hast keinen Tool-Call gemacht. Freier Text ohne Tool ist VERBOTEN. " +
            "Fuer Chat-Antworten: antworten(text=...). Fuer Aktionen: notiz_speichern / vault_suchen usw. " +
            "Antworte jetzt NEU und nutze ein Tool. KEIN Fliesstext.",
        });
        continue;
      }

      // Nach zwei fehlgeschlagenen Retries: content als Antwort durchreichen (Notfall-Fallback)
      const antwort = reply.content ?? "Ich konnte deine Anfrage nicht vollstaendig bearbeiten.";
      appendAgentConversation(agentName, userMessage, antwort);
      logInfo(
        `[${agentName}] Final ohne Tool-Call nach ${enforcementRetries} Retries (${antwort.length} Z)`,
      );
      if (shouldCompact(agentName)) await runCompaction(agentName);
      return antwort;
    }

    const allCalls = reply.tool_calls.map((tc) => tc as { id: string; function: { name: string; arguments: string } });
    const toolSummary = allCalls
      .map((tc) => {
        const argsRaw = tc.function.arguments || "";
        const argsShort = argsRaw.length > 120 ? argsRaw.slice(0, 120) + "..." : argsRaw;
        return `${tc.function.name}(${argsShort})`;
      })
      .join(", ");
    logInfo(`[${agentName}] Tools (Runde ${i + 1}): ${toolSummary}`);

    // Pruefen ob "antworten" dabei ist
    const antwortCall = allCalls.find((tc) => tc.function.name === "antworten");
    const otherCalls = allCalls.filter((tc) => tc.function.name !== "antworten");

    // Seiteneffekt-Tools (Speichern/Verschieben/Suchen) IMMER zuerst ausfuehren und
    // vollstaendig abwarten, BEVOR wir die antworten-Bestaetigung an den User schicken.
    // So sehen wir Fehler und der User bekommt nie eine "✅ Gespeichert"-Antwort, waehrend
    // der Write noch laeuft.
    const toolResults = await Promise.all(
      otherCalls.map(async (tc) => {
        let args: Record<string, string | number>;
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, string | number>;
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

    // Wenn "antworten" aufgerufen wurde → finale Antwort zurueckgeben (nach Seiteneffekten)
    if (antwortCall) {
      let antwortText = "Erledigt.";
      try {
        const antwortArgs = JSON.parse(antwortCall.function.arguments) as Record<string, string>;
        antwortText = antwortArgs.text || "Erledigt.";
      } catch {
        // Fallback bei fehlerhaften Argumenten
      }
      appendAgentConversation(agentName, userMessage, antwortText);
      logInfo(`[${agentName}] Antwort via antworten-Tool (Runde ${i + 1}, ${antwortText.length} Z)`);
      if (shouldCompact(agentName)) await runCompaction(agentName);
      return antwortText;
    }

    messages.push(...toolResults);
    for (const r of toolResults) totalChars += JSON.stringify(r).length;

    // Pruning: keep assistant+tool pairs together (API requirement)
    if (totalChars > MAX_HISTORY_CHARS) {
      const systemMsg = messages[0];
      const recentStart = Math.max(1, messages.length - (KEPT_TOOL_MESSAGES * 3));
      const recentMsgs = messages.slice(recentStart);
      // Preserve original user message if it would be pruned
      const firstUserIdx = messages.findIndex((m, idx) => idx > 0 && m.role === "user");
      const firstUser = firstUserIdx > 0 && firstUserIdx < recentStart ? [messages[firstUserIdx]] : [];
      messages.splice(0, messages.length, systemMsg, ...firstUser, ...recentMsgs);
      totalChars = messages.reduce((s, m) => s + JSON.stringify(m).length, 0);
    }
  }

  const fallback = "Ich konnte deine Anfrage nicht vollstaendig bearbeiten.";
  appendAgentConversation(agentName, userMessage, fallback);
  logInfo(`[${agentName}] Fallback nach ${MAX_TOOL_ROUNDS} Runden`);
  if (shouldCompact(agentName)) await runCompaction(agentName);
  return fallback;
}

export const processMessage = (msg: string) => processAgent("Main", msg);
