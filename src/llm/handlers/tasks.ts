import type OpenAI from "openai";
import path from "path";
import { addTask, listOpenTasks } from "../../workspace/aufgaben.js";
import { WORKSPACE_PATH } from "../../config.js";
import type { HandlerMap } from "./types.js";

export const taskSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "aufgabe_erfassen",
      description:
        "Erfasst eine Aufgabe als Obsidian-Checkbox '- [ ] text 📅 datum'. Standardziel: Aufgaben.md im Vault-Root. Fuer projekt-/kontextspezifische Aufgaben 'datei' setzen (z.B. 'Projekte/WebApp/Aufgaben.md' oder die heutige Daily Note). Datum optional im Format YYYY-MM-DD.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Aufgabentext (kurz, handlungsorientiert)" },
          datum: { type: "string", description: "Optionales Faelligkeitsdatum YYYY-MM-DD" },
          datei: { type: "string", description: "Optionale Zieldatei (Vault-relativ). Default: Aufgaben.md" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aufgaben_offen",
      description:
        "Listet offene Aufgaben (`- [ ]`) aus ALLEN Markdown-Dateien im Vault. Sortierung: mit Faelligkeit zuerst (aufsteigend), dann undatiert. Nutze wenn der User 'was steht an', 'offene Aufgaben' oder aehnliches fragt.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximale Anzahl (Default 50)" },
        },
        required: [],
      },
    },
  },
];

export const taskHandlers: HandlerMap = {
  aufgabe_erfassen: async (args) => {
    const text = String(args.text || "").trim();
    if (!text) return "Fehler: Kein Aufgabentext angegeben.";

    const datum = args.datum ? String(args.datum).trim() : undefined;
    if (datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      return `Fehler: Datum muss YYYY-MM-DD sein, bekommen: "${datum}".`;
    }

    const datei = args.datei ? String(args.datei).trim() : undefined;
    const abs = addTask(text, datum, datei);
    if (!abs) return `Fehler: Ungueltiger Zielpfad "${datei ?? "Aufgaben.md"}".`;

    const rel = path.relative(WORKSPACE_PATH, abs).replace(/\\/g, "/");
    const datumHint = datum ? ` (faellig ${datum})` : "";
    return `Aufgabe erfasst in ${rel}${datumHint}: ${text}`;
  },

  aufgaben_offen: async (args) => {
    const limit = args.limit !== undefined ? Math.max(1, Number(args.limit)) : 50;
    const tasks = listOpenTasks(limit);
    if (!tasks.length) return "Keine offenen Aufgaben.";

    const lines = tasks.map((t) => {
      const datum = t.datum ? ` \u{1F4C5} ${t.datum}` : "";
      return `- [ ] ${t.text}${datum}  \u2014 ${t.file}:${t.line}`;
    });

    return `${tasks.length} offene Aufgabe(n):\n${lines.join("\n")}`;
  },
};
