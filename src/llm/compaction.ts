import { chatComplete } from "./client.js";
import { DEFAULT_MODEL } from "../config.js";
import { getLogForCompaction, writeCompactedLog } from "../workspace/index.js";
import { logInfo, logError } from "../logger.js";

async function summarizeLog(text: string): Promise<string> {
  const response = await chatComplete({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: "user",
        content: `Fasse diese Gespraechseintraege in maximal 5 Stichpunkten zusammen.\nNur wichtige Fakten, Entscheidungen und offene Punkte. Auf Deutsch:\n\n${text}`,
      },
    ],
  });
  return response.choices[0]?.message.content ?? "";
}

/**
 * Laeuft die Log-Compaction. Fehler werden geloggt, nicht geworfen — der
 * aufrufende Pfad (processAgent) soll nicht an Compaction-Problemen scheitern.
 * Rueckgabe: true bei Erfolg oder "nichts zu tun", false bei Fehler.
 */
export async function runCompaction(agentName: string): Promise<boolean> {
  try {
    const toSummarize = getLogForCompaction(agentName);
    if (!toSummarize) return true;
    logInfo(`[${agentName}] Compaction gestartet`);
    const summary = await summarizeLog(toSummarize);
    if (!summary) {
      logError(`[${agentName}] Compaction`, "Leere Zusammenfassung vom LLM");
      return false;
    }
    writeCompactedLog(agentName, summary);
    logInfo(`[${agentName}] Compaction abgeschlossen`);
    return true;
  } catch (err) {
    logError(`[${agentName}] Compaction`, err);
    return false;
  }
}

export async function compactNow(agentName: string): Promise<string> {
  try {
    const toSummarize = getLogForCompaction(agentName);
    if (!toSummarize) return "Tageslog ist noch klein – kein Komprimieren noetig.";
    const summary = await summarizeLog(toSummarize);
    if (!summary) return "Zusammenfassung fehlgeschlagen.";
    writeCompactedLog(agentName, summary);
    return `\u2705 Log komprimiert.\n\nZusammenfassung:\n${summary}`;
  } catch (err) {
    logError(`[${agentName}] Compaction`, err);
    return `Fehler beim Komprimieren: ${err}`;
  }
}
