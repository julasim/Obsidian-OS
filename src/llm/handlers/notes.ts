import type { ToolSchema } from "../types.js";
import { saveNote, readNote, appendToNote, deleteNote } from "../../workspace/notes.js";
import { readFile } from "../../workspace/files.js";
import { editFile } from "../../workspace/fileops.js";
import type { HandlerMap } from "./types.js";

export const noteSchemas: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "notiz_speichern",
      description:
        "Speichert eine neue Notiz im Vault. Vergib IMMER einen aussagekraeftigen Titel und mindestens 1 Tag. Routing: (1) Explizit via 'ordner' (relativer Pfad, z.B. 'wiki' oder 'raw') — Bot entscheidet via CLAUDE.md-Regeln. (2) Via 'projekt' als Shortcut (speichert in Projekte/{name}/Notizen/). (3) Ohne beides: Inbox-Fallback. Fuer ausfuehrliche Inhalte, Ideen, Konzepte, Zusammenfassungen — alles was keine Aufgabe/Termin/kurzer Gedanke ist.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Inhalt der Notiz (Markdown, strukturiert mit Ueberschriften/Listen wenn sinnvoll)" },
          titel: { type: "string", description: "Kurzer, aussagekraeftiger Titel (2-5 Woerter, IMMER angeben)" },
          ordner: { type: "string", description: "Expliziter Zielordner relativ zum Vault (z.B. 'wiki', 'raw', 'archiv/notizen'). Bot nutzt Routing aus CLAUDE.md." },
          projekt: { type: "string", description: "Projektname falls zuordenbar (Shortcut: speichert in Projekte/{name}/Notizen/)" },
          tags: { type: "string", description: "Komma-separierte Tags (IMMER mindestens 1, z.B. 'idee', 'meeting,protokoll', 'recherche')" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_lesen",
      description:
        "Liest eine Datei aus dem Vault. Akzeptiert Dateinamen (z.B. 'Meeting'), Pfade (z.B. 'Daily/2026-04-11.md') oder [[Wikilinks]]. Sucht automatisch in Inbox, Vault-Root und Unterordnern.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Dateiname, Pfad oder Wikilink" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_bearbeiten",
      description:
        "Bearbeitet eine bestehende Notiz. Zwei Modi: (1) Text anhaengen am Ende, (2) Suchen-und-Ersetzen fuer gezielte Aenderungen.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Dateiname oder Pfad" },
          text: { type: "string", description: "Text zum Anhaengen (Modus 1)" },
          suchen: { type: "string", description: "Zu ersetzender Text (Modus 2)" },
          ersetzen: { type: "string", description: "Neuer Text (Modus 2)" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_loeschen",
      description: "Loescht eine Notiz dauerhaft aus dem Vault.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Dateiname oder Pfad" },
        },
        required: ["name"],
      },
    },
  },
];

export const noteHandlers: HandlerMap = {
  notiz_speichern: async (args) => {
    const text = String(args.text || "");
    if (!text) return "Fehler: Kein Text angegeben.";
    const tags = args.tags ? String(args.tags).split(",").map((t) => t.trim()) : undefined;
    const filepath = saveNote(text, {
      project: args.projekt ? String(args.projekt) : undefined,
      title: args.titel ? String(args.titel) : undefined,
      ordner: args.ordner ? String(args.ordner) : undefined,
      tags,
    });
    // Return wikilink-friendly name so agent can reference it in subsequent calls
    const filename = filepath.split(/[\\/]/).pop()?.replace(/\.md$/, "") ?? "";
    const locationHint = args.projekt
      ? ` (Projekt: ${args.projekt})`
      : args.ordner
        ? ` (${args.ordner})`
        : "";
    return `Notiz gespeichert: [[${filename}]]${locationHint}`;
  },

  notiz_lesen: async (args) => {
    const name = String(args.name || "");
    if (!name) return "Fehler: Kein Name angegeben.";
    // Try fuzzy resolution first (Inbox, root, subdirs), then direct path
    const content = readNote(name) ?? readFile(name);
    return content ?? `Datei "${name}" nicht gefunden.`;
  },

  notiz_bearbeiten: async (args) => {
    const name = String(args.name || "");
    if (!name) return "Fehler: Kein Name angegeben.";

    // Mode 2: Find-replace
    if (args.suchen) {
      const result = editFile(name, String(args.suchen), String(args.ersetzen ?? ""));
      if (!result) return `Datei "${name}" nicht gefunden.`;
      if (result.count === 0) return `Suchtext nicht gefunden in "${name}".`;
      return `${result.count}x ersetzt in "${name}".\nVorschau: ${result.preview}`;
    }

    // Mode 1: Append
    if (args.text) {
      const ok = appendToNote(name, String(args.text));
      return ok ? `Nachtrag gespeichert in: ${name}` : `Datei "${name}" nicht gefunden.`;
    }

    return "Fehler: Entweder 'text' (zum Anhaengen) oder 'suchen'+'ersetzen' angeben.";
  },

  notiz_loeschen: async (args) => {
    const name = String(args.name || "");
    if (!name) return "Fehler: Kein Name angegeben.";
    const deleted = deleteNote(name);
    return deleted ? `Notiz geloescht: ${deleted}` : `Datei "${name}" nicht gefunden.`;
  },
};
