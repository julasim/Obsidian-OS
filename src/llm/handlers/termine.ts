import type { ToolSchema } from "../types.js";
import path from "path";
import { addTermin, listTermine } from "../../workspace/termine.js";
import { WORKSPACE_PATH } from "../../config.js";
import type { HandlerMap } from "./types.js";

export const terminSchemas: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "termin_erfassen",
      description:
        "Erfasst einen Termin als Markdown-Zeile '- YYYY-MM-DD [HH:MM[-HH:MM]] text'. Standardziel: Termine.md im Vault-Root. Fuer projekt-/personenbezogene Termine 'datei' setzen (z.B. 'Projekte/WebApp.md' oder 'Personen/Max.md'). Zeit optional (dann ganztaegig). Endzeit nur zusammen mit Startzeit sinnvoll.",
      parameters: {
        type: "object",
        properties: {
          datum: { type: "string", description: "Datum im Format YYYY-MM-DD" },
          text: { type: "string", description: "Terminbeschreibung (z.B. 'Zahnarzt', 'Meeting mit [[Max]]')" },
          zeit: { type: "string", description: "Optionale Startzeit HH:MM" },
          endZeit: { type: "string", description: "Optionale Endzeit HH:MM (nur mit zeit)" },
          datei: { type: "string", description: "Optionale Zieldatei (Vault-relativ). Default: Termine.md" },
        },
        required: ["datum", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termine_auflisten",
      description:
        "Listet Termine aus ALLEN Markdown-Dateien im Vault. Optional per Datumsbereich (inklusiv) filtern. Sortierung: nach Datum + Zeit aufsteigend. Nutze fuer 'was habe ich am/diese Woche/naechsten Monat vor', Kalenderabfragen etc.",
      parameters: {
        type: "object",
        properties: {
          von: { type: "string", description: "Optional: Startdatum YYYY-MM-DD (inklusiv)" },
          bis: { type: "string", description: "Optional: Enddatum YYYY-MM-DD (inklusiv)" },
          limit: { type: "number", description: "Maximale Anzahl (Default 50)" },
        },
        required: [],
      },
    },
  },
];

export const terminHandlers: HandlerMap = {
  termin_erfassen: async (args) => {
    const datum = String(args.datum || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      return `Fehler: Datum muss YYYY-MM-DD sein, bekommen: "${datum}".`;
    }

    const text = String(args.text || "").trim();
    if (!text) return "Fehler: Kein Termintext angegeben.";

    const zeit = args.zeit ? String(args.zeit).trim() : undefined;
    if (zeit && !/^\d{2}:\d{2}$/.test(zeit)) {
      return `Fehler: Zeit muss HH:MM sein, bekommen: "${zeit}".`;
    }

    const endZeit = args.endZeit ? String(args.endZeit).trim() : undefined;
    if (endZeit && !/^\d{2}:\d{2}$/.test(endZeit)) {
      return `Fehler: Endzeit muss HH:MM sein, bekommen: "${endZeit}".`;
    }
    if (endZeit && !zeit) {
      return "Fehler: Endzeit ohne Startzeit ist nicht erlaubt.";
    }

    const datei = args.datei ? String(args.datei).trim() : undefined;
    const abs = addTermin(datum, text, zeit, endZeit, datei);
    if (!abs) return `Fehler: Ungueltiger Zielpfad "${datei ?? "Termine.md"}".`;

    const rel = path.relative(WORKSPACE_PATH, abs).replace(/\\/g, "/");
    const zeitHint = zeit ? (endZeit ? ` ${zeit}-${endZeit}` : ` ${zeit}`) : " (ganztaegig)";
    return `Termin erfasst in ${rel}: ${datum}${zeitHint} ${text}`;
  },

  termine_auflisten: async (args) => {
    const von = args.von ? String(args.von).trim() : undefined;
    const bis = args.bis ? String(args.bis).trim() : undefined;
    if (von && !/^\d{4}-\d{2}-\d{2}$/.test(von)) {
      return `Fehler: 'von' muss YYYY-MM-DD sein, bekommen: "${von}".`;
    }
    if (bis && !/^\d{4}-\d{2}-\d{2}$/.test(bis)) {
      return `Fehler: 'bis' muss YYYY-MM-DD sein, bekommen: "${bis}".`;
    }

    const limit = args.limit !== undefined ? Math.max(1, Number(args.limit)) : 50;
    const termine = listTermine(von, bis, limit);
    if (!termine.length) return "Keine Termine gefunden.";

    const lines = termine.map((t) => {
      const zeit = t.zeit ? (t.endZeit ? ` ${t.zeit}-${t.endZeit}` : ` ${t.zeit}`) : "";
      return `- ${t.datum}${zeit} ${t.text}  \u2014 ${t.file}:${t.line}`;
    });

    return `${termine.length} Termin(e):\n${lines.join("\n")}`;
  },
};
