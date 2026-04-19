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

// ---- Plan-Meta-Tool ----
// Interner Scratchpad fuer Multi-Step-Tasks. Verhindert dass das LLM bei
// komplexen Anfragen den Faden verliert oder falsche Tools callt. Pattern:
//   1. LLM erkennt Multi-Step → plan(aktion="erstellen", schritte=[...])
//   2. LLM arbeitet Schritt fuer Schritt ab, callt andere Tools
//   3. Nach jedem Schritt: plan(aktion="abhaken", index=N)
//   4. Am Ende: antworten()
// State ist pro User-Turn lokal (resettet bei jedem processAgent-Call).
const PLAN_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "plan",
    description:
      "Internes Scratchpad fuer Multi-Step-Tasks (>=3 Schritte oder 'lies X und mach Y mit Z').\n\n" +
      "WORKFLOW (strikt einhalten):\n" +
      "1. SCOUT ZUERST — bevor du plan(erstellen) callst, lies die relevanten Dateien/Ordner mit " +
      "vault(suchen/lesen/projekt_inhalt) damit du den echten Stand kennst. Ohne Kontext produzierst " +
      "du einen Plan mit falschen Annahmen.\n" +
      "2. plan(aktion=erstellen, schritte=[...]) — mit den ECHTEN Infos aus Schritt 1, konkrete " +
      "Schritte (Dateinamen, Zielordner, genaue Aktionen).\n" +
      "3. EXEKUTIEREN — arbeite Schritt fuer Schritt ab. NACH JEDEM Schritt IMMER " +
      "plan(aktion=abhaken, index=N) callen, dann erst zum naechsten Schritt. " +
      "Nicht mehrere Schritte auf einmal machen ohne abzuhaken.\n" +
      "4. Wenn waehrend der Ausfuehrung neue Arbeit auftaucht: plan(aktion=hinzufuegen, schritt=...).\n" +
      "5. Erst wenn alle Schritte [x] sind → antworten(text=...).\n\n" +
      "aktion=status falls du den Ueberblick verloren hast.\n\n" +
      "Bei EINFACHEN Anfragen (eine Aktion, direkte Antwort, 1-2 Tool-Calls) plan() NICHT nutzen — " +
      "das ist Overhead. Faustregel: wenn du >=3 Tool-Calls brauchst, zuerst scouten und planen.",
    parameters: {
      type: "object",
      properties: {
        aktion: {
          type: "string",
          enum: ["erstellen", "abhaken", "hinzufuegen", "status"],
          description: "Welche Plan-Operation (Pflicht)",
        },
        schritte: {
          type: "array",
          description: "Liste der Schritte (nur bei aktion=erstellen). Jeder Schritt konkret und ausfuehrbar, keine Platzhalter.",
        },
        index: {
          type: "number",
          description: "Index des Schritts der abgehakt werden soll (nur bei aktion=abhaken, 0-basiert)",
        },
        schritt: {
          type: "string",
          description: "Text des neuen Schritts (nur bei aktion=hinzufuegen)",
        },
      },
      required: ["aktion"],
    },
  },
};

const ALL_TOOLS: ChatTool[] = [ANTWORTEN_TOOL, PLAN_TOOL, ...TOOLS];

// ---- Plan-Handler (runtime-lokal) ----
// State lebt pro User-Turn. Der Plan ist nur innerhalb eines processAgent-Calls
// sichtbar und wird beim naechsten User-Message geleert — genau wie ein
// mentaler Scratchpad fuer "diese Aufgabe".

interface PlanStep { text: string; done: boolean; }

function formatPlan(plan: PlanStep[]): string {
  if (plan.length === 0) return "Plan ist leer.";
  const open = plan.filter((s) => !s.done).length;
  const header = `Plan (${plan.length - open}/${plan.length} erledigt):`;
  const body = plan.map((s, i) => `${s.done ? "[x]" : "[ ]"} ${i}: ${s.text}`).join("\n");
  return `${header}\n${body}`;
}

/** Liefert den naechsten offenen Schritt als Hint, oder null wenn fertig. */
function nextOpenStep(plan: PlanStep[]): { idx: number; text: string } | null {
  const idx = plan.findIndex((s) => !s.done);
  if (idx < 0) return null;
  return { idx, text: plan[idx].text };
}

function handlePlanAction(
  plan: PlanStep[],
  args: Record<string, unknown>,
  scoutedBefore: boolean,
): string {
  const aktion = String(args.aktion ?? "").trim();
  switch (aktion) {
    case "erstellen": {
      const schritte = args.schritte;
      if (!Array.isArray(schritte) || schritte.length === 0) {
        return "Fehler: schritte muss ein nicht-leeres Array sein.";
      }
      plan.length = 0;
      for (const s of schritte) plan.push({ text: String(s), done: false });
      const first = nextOpenStep(plan);
      const nextHint = first
        ? `\n\n→ NAECHSTE AKTION: Schritt ${first.idx} ausfuehren: "${first.text}". Danach plan(aktion=abhaken, index=${first.idx}).`
        : "";
      const scoutWarn = !scoutedBefore
        ? "\n\nWARNUNG: Plan wurde ohne vorherigen Scout erstellt. Falls deine Schritte auf Annahmen basieren (Dateien existieren, Ordnerstruktur, etc.) — erst verifizieren mit vault(lesen/suchen/projekt_inhalt) und ggf. plan(aktion=erstellen) nochmal mit korrekten Infos."
        : "";
      return `${formatPlan(plan)}\n\nPlan angelegt.${nextHint}${scoutWarn}`;
    }
    case "abhaken": {
      const idx = Number(args.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= plan.length) {
        return `Fehler: index ${args.index} ausserhalb des Plans (0..${plan.length - 1}).`;
      }
      if (plan[idx].done) return `${formatPlan(plan)}\n\nSchritt ${idx} war bereits erledigt.`;
      plan[idx].done = true;
      const next = nextOpenStep(plan);
      const nextHint = next
        ? `\n\n→ NAECHSTE AKTION: Schritt ${next.idx} ausfuehren: "${next.text}". Danach plan(aktion=abhaken, index=${next.idx}).`
        : "\n\nAlle Schritte erledigt — jetzt antworten(text=...) callen.";
      return `${formatPlan(plan)}${nextHint}`;
    }
    case "hinzufuegen": {
      const text = String(args.schritt ?? "").trim();
      if (!text) return "Fehler: schritt darf nicht leer sein.";
      plan.push({ text, done: false });
      return formatPlan(plan);
    }
    case "status": {
      const next = nextOpenStep(plan);
      const nextHint = next
        ? `\n\n→ NAECHSTE AKTION: Schritt ${next.idx} ausfuehren: "${next.text}".`
        : plan.length > 0
        ? "\n\nAlle Schritte erledigt — jetzt antworten(text=...) callen."
        : "";
      return `${formatPlan(plan)}${nextHint}`;
    }
    default:
      return `Fehler: unbekannte aktion "${aktion}". Erlaubt: erstellen, abhaken, hinzufuegen, status.`;
  }
}

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
  let softHintSent = false;

  // Plan-State: pro User-Turn. LLM manipuliert via plan()-Tool.
  const plan: PlanStep[] = [];
  // Tracking: hat das Modell vor plan(erstellen) gescoutet?
  // Zaehlt wenn ein lesender Call (vault, notiz=frontmatter, memory=nachschlagen)
  // durchgefuehrt wurde, BEVOR der erste erstellen-Call kam.
  let scoutedBefore = false;

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

    // antworten-Call raussuchen — der liefert den finalen User-Text
    const antwortenCall = functionCalls.find((tc) => tc.function.name === "antworten");
    // plan-Calls werden lokal behandelt (kein Filesystem-Side-Effect),
    // zaehlen nicht als "sideEffect" fuer Loop-Detection (Plan-Spam ist OK).
    const planCalls = functionCalls.filter((tc) => tc.function.name === "plan");
    const sideEffectCalls = functionCalls.filter(
      (tc) => tc.function.name !== "antworten" && tc.function.name !== "plan",
    );

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

    // Scout-Tracking: read-only Tools zaehlen als "scouting" fuer die Plan-Pruefung.
    // Side-effect free: vault(alle modi sind lesend), notiz(frontmatter), memory(nachschlagen/lesen/profil/glossar).
    const READ_ONLY_CALLS = new Set(["vault"]);
    const READ_ONLY_SUBMODES: Record<string, Set<string>> = {
      notiz: new Set(["frontmatter"]),
      memory: new Set(["lesen", "nachschlagen", "profil", "glossar"]),
    };
    for (const tc of sideEffectCalls) {
      if (READ_ONLY_CALLS.has(tc.function.name)) {
        scoutedBefore = true;
        break;
      }
      const subModes = READ_ONLY_SUBMODES[tc.function.name];
      if (subModes) {
        try {
          const args = JSON.parse(tc.function.arguments || "{}") as { modus?: string };
          if (args.modus && subModes.has(args.modus)) {
            scoutedBefore = true;
            break;
          }
        } catch { /* ignore */ }
      }
    }

    // Plan-Calls synchron/lokal abarbeiten
    const planResults: ChatMessage[] = planCalls.map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: `Fehler: Ungueltige plan()-Argumente.`,
        };
      }
      const content = handlePlanAction(plan, args, scoutedBefore);
      return { role: "tool" as const, tool_call_id: tc.id, content };
    });

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
      // Alle Tool-Results in die Message-History eintragen, in derselben
      // Reihenfolge wie die tool_calls. Reihenfolge: plan → side-effect → antworten.
      messages.push(...planResults);
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

    messages.push(...planResults);
    messages.push(...toolResults);
    for (const r of planResults) totalChars += JSON.stringify(r).length;
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
