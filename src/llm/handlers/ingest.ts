import type OpenAI from "openai";
import path from "path";
import { moveFile } from "../../workspace/files.js";
import { WORKSPACE_PATH } from "../../config.js";
import type { HandlerMap } from "./types.js";

export const ingestSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "datei_verschieben",
      description:
        "Verschiebt eine Datei innerhalb des Vaults. Wichtig fuer die Ingest-Pipeline: raw/ → archiv/raw/ nach Verarbeitung. Beide Pfade relativ zum Vault-Root.",
      parameters: {
        type: "object",
        properties: {
          von: { type: "string", description: "Relativer Quellpfad (z.B. 'raw/dokument.md')" },
          nach: { type: "string", description: "Relativer Zielpfad (z.B. 'archiv/raw/dokument.md')" },
        },
        required: ["von", "nach"],
      },
    },
  },
];

export const ingestHandlers: HandlerMap = {
  datei_verschieben: async (args) => {
    const von = String(args.von || "");
    const nach = String(args.nach || "");
    if (!von || !nach) return "Fehler: 'von' und 'nach' muessen angegeben werden.";

    // Block path traversal
    if (von.includes("..") || nach.includes("..") || path.isAbsolute(von) || path.isAbsolute(nach)) {
      return "Fehler: Ungueltiger Pfad (kein .. oder absoluter Pfad erlaubt).";
    }

    const result = moveFile(von, nach);
    if (!result) return `Fehler: Datei "${von}" nicht gefunden oder Pfad ungueltig.`;
    const relPath = path.relative(WORKSPACE_PATH, result).replace(/\\/g, "/");
    return `Datei verschoben: ${von} → ${relPath}`;
  },
};
