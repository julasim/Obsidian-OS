import type OpenAI from "openai";
import {
  getOrCreateDailyNote,
  appendToDailyNote,
  listDailyNotes,
  readDailyNote,
  upsertFrontmatterField,
  appendAgentMemory,
} from "../../workspace/index.js";
import type { HandlerMap } from "./types.js";

export const obsidianSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "daily_note_lesen",
      description:
        "Liest EINE Daily Note fuer ein Datum. Ohne Datum wird das heutige Daily Note zurueckgegeben (und erstellt falls noetig). Format: YYYY-MM-DD. Fuer eine Liste aller vorhandenen Daily Notes stattdessen daily_notes_auflisten verwenden.",
      parameters: {
        type: "object",
        properties: {
          datum: { type: "string", description: "Datum im Format YYYY-MM-DD (Standard: heute)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "daily_notes_auflisten",
      description:
        "Listet alle vorhandenen Daily Notes im Daily-Ordner auf (neueste zuerst). Nutze das wenn der User fragt was im Daily-Ordner ist, welche Dailies existieren o.ae. — NICHT daily_note_lesen, das liest nur eine einzelne Note.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximale Anzahl (Standard: 30)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "daily_note_eintrag",
      description:
        "Fuegt einen kurzen Eintrag ins heutige Daily Note ein. Fuer schnelle Gedanken, Beobachtungen, kurze Infos (1-3 Saetze). Fuer laengere Inhalte stattdessen notiz_speichern verwenden.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Inhalt des Eintrags" },
          abschnitt: { type: "string", description: "Abschnitt im Daily Note (Standard: 'Log')" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "frontmatter_setzen",
      description: "Setzt oder aktualisiert ein YAML-Frontmatter-Feld in einer Vault-Datei.",
      parameters: {
        type: "object",
        properties: {
          pfad: { type: "string", description: "Relativer Pfad der Datei" },
          schluessel: { type: "string", description: "Frontmatter-Key (z.B. 'status', 'tags')" },
          wert: { type: "string", description: "Wert (fuer Arrays: komma-separiert)" },
        },
        required: ["pfad", "schluessel", "wert"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_speichern",
      description:
        "Speichert eine Information dauerhaft in MEMORY.md. Nutze PROAKTIV: wenn der User 'merk dir'/'vergiss nicht' sagt, wenn du Praefeenzen lernst, wenn du verfuegbare Templates entdeckst, oder wenn Projektdetails fuer spaeter relevant sind.",
      parameters: {
        type: "object",
        properties: {
          eintrag: { type: "string", description: "Die zu merkende Information (1-2 Saetze)" },
        },
        required: ["eintrag"],
      },
    },
  },
];

export const obsidianHandlers: HandlerMap = {
  daily_note_lesen: async (args) => {
    if (args.datum) {
      const dateStr = String(args.datum);
      const content = readDailyNote(dateStr);
      if (!content) {
        const recent = listDailyNotes(5);
        return `Kein Daily Note fuer ${dateStr}.\nVorhandene: ${recent.join(", ") || "keine"}`;
      }
      return content;
    }
    return getOrCreateDailyNote();
  },

  daily_note_eintrag: async (args) => {
    return appendToDailyNote(String(args.text), args.abschnitt ? String(args.abschnitt) : undefined);
  },

  daily_notes_auflisten: async (args) => {
    const limit = args.limit !== undefined ? Number(args.limit) : undefined;
    const files = listDailyNotes(limit);
    if (!files.length) return "Keine Daily Notes vorhanden.";
    return `${files.length} Daily Note(s):\n${files.map((f) => `\u{1F4C4} ${f}`).join("\n")}`;
  },

  frontmatter_setzen: async (args) => {
    const pfad = String(args.pfad);
    const key = String(args.schluessel);
    const rawVal = String(args.wert);
    let value: unknown = rawVal;
    if (rawVal.includes(",") && key === "tags") {
      value = rawVal.split(",").map((s) => s.trim()).filter(Boolean);
    }
    const ok = upsertFrontmatterField(pfad, key, value);
    return ok ? `Frontmatter: ${pfad} → ${key}: ${rawVal}` : `Datei nicht gefunden: ${pfad}`;
  },

  memory_speichern: async (args) => {
    appendAgentMemory("Main", String(args.eintrag));
    return `Gespeichert in MEMORY.md: ${args.eintrag}`;
  },
};
