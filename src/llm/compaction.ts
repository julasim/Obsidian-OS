import { client, getModel } from "./client.js";
import { getLogForCompaction, writeCompactedLog } from "../workspace/index.js";
import { logInfo, logError } from "../logger.js";

async function summarizeLog(text: string): Promise<string> {
  const response = await client.chat.completions.create({
    model: getModel(),
    messages: [
      {
        role: "user",
        content: `Fasse diese Gespraechseintraege in maximal 5 Stichpunkten zusammen.\nNur wichtige Fakten, Entscheidungen und offene Punkte. Auf Deutsch:\n\n${text}`,
      },
    ],
  });
  return response.choices[0]?.message.content ?? "";
}

export async function runCompaction(agentName: string): Promise<void> {
  const toSummarize = getLogForCompaction(agentName);
  if (!toSummarize) return;
  logInfo(`[${agentName}] Compaction gestartet`);
  const summary = await summarizeLog(toSummarize);
  if (summary) {
    writeCompactedLog(agentName, summary);
    logInfo(`[${agentName}] Compaction abgeschlossen`);
  }
}

export async function compactNow(agentName: string): Promise<string> {
  const toSummarize = getLogForCompaction(agentName);
  if (!toSummarize) return "Tageslog ist noch klein – kein Komprimieren noetig.";
  const summary = await summarizeLog(toSummarize);
  if (!summary) return "Zusammenfassung fehlgeschlagen.";
  writeCompactedLog(agentName, summary);
  return `\u2705 Log komprimiert.\n\nZusammenfassung:\n${summary}`;
}
