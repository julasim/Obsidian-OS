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
  SOFT_TOOL_ROUNDS,
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
      "Daten vorliegen, das ehrlich sagen.\n\n" +
      "REGELN fuer den text-Parameter:\n\n" +
      "1. LISTEN (aufgaben(auflisten), termine(auflisten), vault(suchen) mit mehreren " +
      "Treffern, plan(zeigen)): das Tool liefert bereits formatierte Zeilen inkl. " +
      "Emojis, Daten, Prioritaeten, Dateireferenzen. NIMM DIESE 1:1 UEBER. Keine " +
      "Felder weglassen, nicht umsortieren, nicht neu formatieren. Lass nur den " +
      "Header-Zaehler stehen und das Listen-Format exakt wie es kam.\n\n" +
      "2. LANGE INHALTE (Wiki-Artikel, komplette Notizen, grosse Tabellen): NICHT " +
      "als Rohtext kopieren. 3-5 Satz-Zusammenfassung + Dateiname reicht. Der User " +
      "kann die Datei in Obsidian selbst oeffnen.\n\n" +
      "3. BESTAETIGUNGEN (Notiz gespeichert, Aufgabe erledigt, Projekt umbenannt): " +
      "kurz quittieren mit dem was das Tool zurueckgab.\n\n" +
      "4. Maximal 3800 Zeichen (Telegram-Limit) — laengere Nachrichten werden " +
      "automatisch gesplittet, aber zielen auf <1000 Zeichen fuer normale Antworten.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "Die Antwort an den Benutzer auf Deutsch. Bei Listen: 1:1 wie vom Tool " +
            "geliefert. Bei Zusammenfassungen: praezise, knapp. Richtwert <1000 " +
            "Zeichen, ausser bei Listen die laenger sein muessen.",
        },
      },
      required: ["text"],
    },
  },
};

// Das frueher hier inline definierte Plan-Meta-Tool (in-memory Scratchpad)
// wurde durch das persistente, file-basierte Plan-Tool aus src/tools/plan/
// ersetzt — jenes wird via TOOLS-Registry eingezogen und macht Plaene
// ueber mehrere User-Turns hinweg sichtbar (Multi-Plan, Blocker-Status,
// Archivieren). Kein runtime-lokaler State mehr noetig.

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

  // Loop-Detection + Ban-List:
  // - Zaehlt wie oft eine Signatur (Tool+Args) gecalled wurde (pro Turn).
  // - Bei >=2 identischen Calls hintereinander: Ban — weitere Calls mit
  //   derselben Signatur werden nicht mehr ausgefuehrt, stattdessen gibt es
  //   ein synthetisches Error-Result, das dem LLM klar macht: "probier was
  //   anderes". Vorher wurde der Loop nur gewarnt, LLM ignorierte die
  //   Warnung und callte 60+ mal dasselbe.
  const callCounts = new Map<string, number>();
  const bannedSignatures = new Set<string>();
  let softHintSent = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Zwei Schwellen:
    // - Soft-Cap (Default 25): einmalig "bitte wrappen"-Hinweis einschieben.
    //   LLM darf weiter Tools callen — wir haben echte Multi-Step-Ops gesehen
    //   die 20+ Runden brauchen (viele Notizen lesen + zusammenfassen).
    // - Hard-Cap (Default 80): tool_choice wird auf antworten gezwungen, um
    //   nicht im generischen Fallback zu landen.
    const isLastChance = round === MAX_TOOL_ROUNDS - 1;
    const isSoftLimit = round >= SOFT_TOOL_ROUNDS && !softHintSent;

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
    } else if (isSoftLimit) {
      softHintSent = true;
      logInfo(`[${agentName}] Soft-Cap erreicht (Runde ${round + 1}/${MAX_TOOL_ROUNDS}) — hint eingeschoben`);
      messages.push({
        role: "user",
        content:
          `Hinweis: du hast bereits ${round} Tool-Runden verbraucht. Bitte fokussieren — ` +
          `noch ${MAX_TOOL_ROUNDS - round} Runden verfuegbar bevor hart abgebrochen wird. ` +
          `Wenn du genug Info hast, JETZT antworten(text=...). Sonst die naechsten Schritte straff halten.`,
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

    // antworten-Call raussuchen — der liefert den finalen User-Text.
    // plan() laeuft jetzt ueber den normalen Executor (file-basiert) und ist
    // von der Loop-Detection ausgenommen (mehrere plan(zeigen) sind legit
    // Re-Orientierung, kein Stuck-Loop).
    const antwortenCall = functionCalls.find((tc) => tc.function.name === "antworten");
    const sideEffectCalls = functionCalls.filter(
      (tc) => tc.function.name !== "antworten",
    );

    const toolSummary = functionCalls
      .map((tc) => {
        const argsRaw = tc.function.arguments || "";
        const argsShort = argsRaw.length > 120 ? argsRaw.slice(0, 120) + "..." : argsRaw;
        return `${tc.function.name}(${argsShort})`;
      })
      .join(", ");
    logInfo(`[${agentName}] Tools (Runde ${round + 1}): ${toolSummary}`);

    // Seiten-Effekt-Tools (Schreiben/Suchen/...) IMMER zuerst — damit antworten
    // nie eine "Erledigt"-Bestaetigung sendet bevor der Write wirklich durch ist.
    // plan() laeuft ueber den normalen Executor (file-basierter State).
    // Loop-Schutz: pro Signatur (name+args) wird nach >=2 identischen Calls
    // fuer den Rest des Turns geblockt.
    const toolResults: ChatMessage[] = await Promise.all(
      sideEffectCalls.map(async (tc) => {
        const sig = `${tc.function.name}(${tc.function.arguments})`;
        const loopRelevant = tc.function.name !== "plan";

        // Ban-Check: wenn diese Signatur in diesem Turn schon >=2x aufgetreten ist
        if (loopRelevant && bannedSignatures.has(sig)) {
          logInfo(`[${agentName}] Blocked (gebannt in Turn): ${sig.slice(0, 120)}`);
          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            content:
              `BLOCKED: Du hast ${tc.function.name}(...) mit exakt diesen Argumenten in diesem Turn ` +
              `bereits mehrfach gecalled und bekommst immer dasselbe Ergebnis zurueck. Weitere Calls mit ` +
              `identischen Argumenten werden abgelehnt. ` +
              `\n\nOptionen: ` +
              `(a) Andere Argumente probieren (andere modus, andere Filter, anderer Name). ` +
              `(b) Ein anderes Tool nutzen (vault, notiz, plan, memory, ...). ` +
              `(c) Mit antworten(text=...) dem User ehrlich sagen was du gefunden hast oder nicht gefunden hast.`,
          };
        }

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

        // Loop-Tracking: Count hochzaehlen, Ban bei >=2 Calls
        if (loopRelevant) {
          const count = (callCounts.get(sig) ?? 0) + 1;
          callCounts.set(sig, count);
          if (count >= 2) {
            bannedSignatures.add(sig);
            logInfo(`[${agentName}] Loop-Ban (Runde ${round + 1}, ${count}x): ${sig.slice(0, 120)}`);
          }
        }

        // Tool-Result-Preview in den Log schreiben — bisher komplett unsichtbar,
        // was das Debuggen von "LLM callt dasselbe Tool 60x"-Mustern unmoeglich machte.
        const resultPreview = result.slice(0, 200).replace(/\s+/g, " ").trim();
        logInfo(`[${agentName}] Result ${tc.function.name}: ${resultPreview}${result.length > 200 ? " ..." : ""}`);

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
      // Alle Tool-Results in die Message-History eintragen.
      messages.push(...toolResults);
      messages.push({
        role: "tool" as const,
        tool_call_id: antwortenCall.id,
        content: "OK",
      });

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
