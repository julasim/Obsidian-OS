import { chatComplete, buildDateLine } from "./client.js";
import type { ChatMessage, ChatTool } from "./client.js";
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

// ---- Antworten-Meta-Tool ----
// Zwingt das LLM, ueber DIESES Tool zu antworten (statt nur content),
// sonst haelt es `tool_choice="required"` nicht sauber durch. Verhindert
// Halluzinationen: bei Datenfragen MUSS das Modell erst ein vault/notiz/...
// Tool callen, sonst hat es keinen Kontext fuer antworten().
const ANTWORTEN_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "antworten",
    description:
      "Sendet die finale Antwort an den Benutzer. JEDE Nutzer-Antwort MUSS ueber " +
      "dieses Tool gehen. Fuer Datenfragen ZUERST vault/notiz/aufgaben/... callen, " +
      "dann mit den echten Daten antworten. NIEMALS Inhalte erfinden — wenn keine " +
      "Daten vorliegen, das ehrlich sagen.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Die Antwort an den Benutzer (Markdown erlaubt). Auf Deutsch, praezise.",
        },
      },
      required: ["text"],
    },
  },
};

const ALL_TOOLS: ChatTool[] = [ANTWORTEN_TOOL, ...TOOLS];

// ---- Agent Runtime ----

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

  let enforcementRetries = 0;
  const MAX_ENFORCEMENT_RETRIES = 2;

  // Loop-Detection: wenn dreimal hintereinander identischer Tool-Call → abbrechen.
  // Verhindert dass das Modell bei einer Nicht-gefunden-Antwort endlos retry't.
  const recentCallSignatures: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Auf der vorletzten Runde Force-antworten: das Modell MUSS wrapen.
    // Dadurch landen wir nie im "Tool-Runden erschoepft"-Fallback wenn das
    // Modell an sich noch ansprechbar ist — im schlimmsten Fall gibt es
    // eine "keine Ergebnisse" oder "nicht gefunden" Antwort.
    const isLastChance = round === MAX_TOOL_ROUNDS - 1;
    const toolChoice: "required" | { type: "function"; function: { name: string } } = isLastChance
      ? { type: "function", function: { name: "antworten" } }
      : "required";

    if (isLastChance) {
      messages.push({
        role: "user",
        content:
          "Letzte Runde — keine weiteren Tool-Calls moeglich. Bitte JETZT via antworten(text=...) " +
          "das zusammenfassen was du bis jetzt herausgefunden hast, oder ehrlich sagen dass keine " +
          "Daten gefunden wurden.",
      });
    }

    const response = await chatComplete({
      model: DEFAULT_MODEL,
      messages,
      tools: ALL_TOOLS,
      tool_choice: toolChoice,
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

    messages.push(reply as ChatMessage);
    totalChars += JSON.stringify(reply).length;

    // Modell ignoriert tool_choice="required" → Diagnose + Enforcement-Retry
    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      const contentPreview = (reply.content ?? "").slice(0, 200).replace(/\s+/g, " ").trim();
      logInfo(
        `[${agentName}] Kein Tool (Runde ${round + 1}, finish=${finishReason}, retries=${enforcementRetries}): "${contentPreview}"`,
      );

      if (enforcementRetries < MAX_ENFORCEMENT_RETRIES) {
        enforcementRetries++;
        messages.push({
          role: "user",
          content:
            "REGELVERSTOSS: Kein Tool-Call gemacht. Antworte NEU und nutze antworten(text=...) " +
            "ODER ein Daten-Tool (vault/notiz/...). Fliesstext ohne Tool ist verboten.",
        });
        continue;
      }

      // Notfall-Fallback: content direkt durchreichen
      const antwort = (reply.content ?? "").trim() || "Ich konnte keine Antwort generieren.";
      appendAgentConversation(agentName, userMessage, antwort);
      logInfo(`[${agentName}] Final ohne Tool nach ${enforcementRetries} Retries (${antwort.length} Z)`);
      if (shouldCompact(agentName)) await runCompaction(agentName);
      return antwort;
    }

    // Tool-Calls verarbeiten. OpenAI SDK v6 hat Union (function | custom);
    // wir unterstuetzen nur function-Typ.
    const functionCalls = reply.tool_calls.filter(
      (tc): tc is typeof tc & { type: "function"; function: { name: string; arguments: string } } =>
        tc.type === "function",
    );

    // antworten-Call raussuchen — der liefert den finalen User-Text
    const antwortenCall = functionCalls.find((tc) => tc.function.name === "antworten");
    const sideEffectCalls = functionCalls.filter((tc) => tc.function.name !== "antworten");

    const toolSummary = functionCalls
      .map((tc) => {
        const argsRaw = tc.function.arguments || "";
        const argsShort = argsRaw.length > 120 ? argsRaw.slice(0, 120) + "..." : argsRaw;
        return `${tc.function.name}(${argsShort})`;
      })
      .join(", ");
    logInfo(`[${agentName}] Tools (Runde ${round + 1}): ${toolSummary}`);

    // Loop-Detection: Signatur der Side-Effect-Calls (antworten darf Repeat)
    const sigCalls = sideEffectCalls.map((tc) => `${tc.function.name}(${tc.function.arguments})`);
    if (sigCalls.length > 0) {
      const sig = sigCalls.join("|");
      recentCallSignatures.push(sig);
      if (recentCallSignatures.length > 3) recentCallSignatures.shift();
      if (
        recentCallSignatures.length === 3 &&
        recentCallSignatures[0] === recentCallSignatures[1] &&
        recentCallSignatures[1] === recentCallSignatures[2]
      ) {
        logInfo(`[${agentName}] Loop erkannt — identischer Tool-Call 3x: ${sig.slice(0, 120)}`);
        // Inject eine deutliche Stop-Message und zwinge antworten() in der naechsten Runde
        messages.push({
          role: "user",
          content:
            "LOOP: Du hast denselben Tool-Call 3x hintereinander gemacht und bekommst jedesmal dasselbe Ergebnis. " +
            "Ruf JETZT antworten(text=...) auf mit dem was du weisst oder sag dass du es nicht findest. " +
            "Probier keine Variation mehr.",
        });
        // Force antworten im naechsten Loop-Durchlauf durch Setzen der Bedingung
        // (wir haben schon alle side-effects ausgefuehrt; toolResults sind unten gepusht)
        recentCallSignatures.length = 0; // reset, sonst triggert es dauernd
      }
    }

    // Seiten-Effekt-Tools (Schreiben/Suchen/...) IMMER zuerst — damit antworten
    // nie eine "Erledigt"-Bestaetigung sendet bevor der Write wirklich durch ist.
    const toolResults: ChatMessage[] = await Promise.all(
      sideEffectCalls.map(async (tc) => {
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

    // antworten-Call: finaler User-Text, nach allen Side-Effects
    if (antwortenCall) {
      let antwortText = "Erledigt.";
      try {
        const parsed = JSON.parse(antwortenCall.function.arguments || "{}") as { text?: string };
        antwortText = (parsed.text ?? "").trim() || "Erledigt.";
      } catch {
        // bei kaputten args: fallback
      }
      // tool_call_id des antworten-Calls auch noch als tool-message quittieren,
      // damit der naechste (ggf.) API-Call die message-Sequenz nicht verletzt.
      messages.push({
        role: "tool" as const,
        tool_call_id: antwortenCall.id,
        content: "OK",
      });
      messages.push(...toolResults);

      appendAgentConversation(agentName, userMessage, antwortText);
      logInfo(`[${agentName}] Antwort via antworten (Runde ${round + 1}, ${antwortText.length} Z)`);
      if (shouldCompact(agentName)) await runCompaction(agentName);
      return antwortText;
    }

    messages.push(...toolResults);
    for (const r of toolResults) totalChars += JSON.stringify(r).length;

    // History-Pruning: tool+assistant Paare zusammen halten.
    if (totalChars > MAX_HISTORY_CHARS) {
      const systemMsg = messages[0];
      let cutPoint = Math.max(1, messages.length - (KEPT_TOOL_MESSAGES * 3));

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
