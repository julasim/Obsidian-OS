import type OpenAI from "openai";
import { listProjekte, getProjektInhalt } from "../../workspace/projekte.js";
import type { HandlerMap } from "./types.js";

export const projektSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "projekte_auflisten",
      description:
        "Listet alle Projekte (Unterordner direkt unter Projekte/) mit Anzahl der Markdown-Dateien. Nutze wenn der User 'welche Projekte', 'Projektliste' oder aehnliches fragt. Projekte sind in diesem Vault reine Ordner — keine Metadata noetig.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "projekt_inhalt",
      description:
        "Listet alle Markdown-Dateien innerhalb eines Projekts (rekursiv). Nutze fuer 'was gibt es zum Projekt X', 'zeig mir Projekt X' usw. Danach ggf. notiz_lesen fuer einzelne Dateien.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Name des Projekt-Ordners (z.B. 'WebApp')" },
          limit: { type: "number", description: "Maximale Anzahl (Default 100)" },
        },
        required: ["projekt"],
      },
    },
  },
];

export const projektHandlers: HandlerMap = {
  projekte_auflisten: async () => {
    const projekte = listProjekte();
    if (!projekte.length) return "Keine Projekte vorhanden.";
    const lines = projekte.map((p) => `- ${p.name} (${p.fileCount} Datei${p.fileCount === 1 ? "" : "en"})`);
    return `${projekte.length} Projekt(e):\n${lines.join("\n")}`;
  },

  projekt_inhalt: async (args) => {
    const projekt = String(args.projekt || "").trim();
    if (!projekt) return "Fehler: Kein Projektname angegeben.";
    const limit = args.limit !== undefined ? Math.max(1, Number(args.limit)) : 100;
    const files = getProjektInhalt(projekt, limit);
    if (files === null) return `Projekt "${projekt}" existiert nicht.`;
    if (!files.length) return `Projekt "${projekt}" ist leer (keine Markdown-Dateien).`;
    return `Projekt "${projekt}" (${files.length} Datei${files.length === 1 ? "" : "en"}):\n${files.map((f) => `\u{1F4C4} ${f}`).join("\n")}`;
  },
};
