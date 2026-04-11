import type OpenAI from "openai";
import fs from "fs";
import path from "path";
import {
  getOrCreateDailyNote,
  appendToDailyNote,
  listDailyNotes,
  readDailyNote,
  listTemplates,
  readTemplate,
  createFromTemplate,
  findBacklinks,
  findByTag,
  upsertFrontmatterField,
  appendAgentMemory,
} from "../../workspace/index.js";
import { WORKSPACE_PATH, ATTACHMENTS_DIR, VISION_MODEL } from "../../config.js";
import type { HandlerMap } from "./types.js";

export const obsidianSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "daily_note_lesen",
      description:
        "Liest die Daily Note fuer ein Datum. Ohne Datum wird das heutige Daily Note zurueckgegeben (und erstellt falls noetig). Format: YYYY-MM-DD.",
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
      name: "notiz_aus_vorlage",
      description:
        "Erstellt eine Notiz aus einer Vorlage (Templates/-Ordner). Unterstuetzt {{variable}}-Platzhalter. Eingebaut: date, time, weekday, year, month, day, title. Wenn die Vorlage nicht gefunden wird, werden verfuegbare Vorlagen aufgelistet.",
      parameters: {
        type: "object",
        properties: {
          vorlage: { type: "string", description: "Name der Vorlage (z.B. 'Meeting', 'Projekt')" },
          zielpfad: { type: "string", description: "Relativer Pfad fuer die neue Datei (z.B. 'Inbox/meeting.md')" },
          variablen: {
            type: "string",
            description: 'Optionale Variablen als JSON (z.B. \'{"titel": "Standup", "projekt": "X"}\')',
          },
        },
        required: ["vorlage", "zielpfad"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "backlinks_suchen",
      description: "Findet alle Notizen die auf [[Notizname]] verlinken (Backlinks).",
      parameters: {
        type: "object",
        properties: {
          notiz: { type: "string", description: "Notizname (ohne .md)" },
        },
        required: ["notiz"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tag_suchen",
      description: "Findet alle Dateien mit einem bestimmten Tag (Frontmatter oder #hashtag im Text).",
      parameters: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Tag ohne # (z.B. 'idee', 'projekt')" },
          ordner: { type: "string", description: "Optional: Suche auf Unterordner begrenzen" },
        },
        required: ["tag"],
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
      name: "bild_analysieren",
      description:
        "Analysiert ein Bild aus dem Vault via Vision-AI (Beschreibung, OCR, Inhaltsanalyse). Bild muss im Attachments-Ordner liegen.",
      parameters: {
        type: "object",
        properties: {
          dateiname: { type: "string", description: "Dateiname im Attachments-Ordner (z.B. 'foto.jpg')" },
          aufgabe: { type: "string", description: "Was analysieren? (Standard: Bild beschreiben + Text extrahieren)" },
        },
        required: ["dateiname"],
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

  notiz_aus_vorlage: async (args) => {
    const vorlageName = String(args.vorlage);
    const rawTemplate = readTemplate(vorlageName);
    if (!rawTemplate) {
      const available = listTemplates();
      return `Vorlage "${vorlageName}" nicht gefunden.\nVerfuegbar: ${available.join(", ") || "keine"}`;
    }

    let extraVars: Record<string, string> = {};
    if (args.variablen) {
      try {
        extraVars = JSON.parse(String(args.variablen));
      } catch {
        return "Fehler: variablen ist kein gueltiges JSON.";
      }
    }

    const created = createFromTemplate(vorlageName, String(args.zielpfad), extraVars);
    if (!created) return `Fehler beim Erstellen aus Vorlage "${vorlageName}".`;
    const relPath = path.relative(WORKSPACE_PATH, created).replace(/\\/g, "/");
    return `Notiz erstellt: ${relPath}`;
  },

  backlinks_suchen: async (args) => {
    const results = findBacklinks(String(args.notiz));
    if (!results.length) return `Keine Backlinks fuer "[[${args.notiz}]]".`;
    return `Backlinks fuer [[${args.notiz}]] (${results.length}):\n\n` +
      results.map((r) => `\u{1F4C4} ${r.file}\n   ${r.line}`).join("\n\n");
  },

  tag_suchen: async (args) => {
    const tag = String(args.tag).replace(/^#/, "");
    const files = findByTag(tag, args.ordner ? String(args.ordner) : undefined);
    if (!files.length) return `Keine Dateien mit #${tag}.`;
    return `#${tag} (${files.length} Treffer):\n${files.map((f) => `\u{1F4C4} ${f}`).join("\n")}`;
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

  bild_analysieren: async (args) => {
    const dateiname = String(args.dateiname);
    const aufgabe = args.aufgabe
      ? String(args.aufgabe)
      : "Beschreibe dieses Bild detailliert. Falls Text sichtbar ist, transkribiere ihn vollstaendig.";

    const bildPfad = path.join(WORKSPACE_PATH, ATTACHMENTS_DIR, dateiname);
    if (!fs.existsSync(bildPfad)) return `Bild nicht gefunden: ${ATTACHMENTS_DIR}/${dateiname}`;

    const ext = path.extname(dateiname).toLowerCase().slice(1);
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp",
    };

    try {
      const base64 = fs.readFileSync(bildPfad).toString("base64");
      const { client } = await import("../client.js");
      const response = await client.chat.completions.create({
        model: VISION_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeMap[ext] || "image/jpeg"};base64,${base64}` } },
            { type: "text", text: aufgabe },
          ],
        }],
        max_tokens: 2000,
      });
      return response.choices[0].message.content ?? "Keine Antwort vom Vision-Modell.";
    } catch (err) {
      return `Vision-Fehler: ${err}`;
    }
  },

  memory_speichern: async (args) => {
    appendAgentMemory("Main", String(args.eintrag));
    return `Gespeichert in MEMORY.md: ${args.eintrag}`;
  },
};
