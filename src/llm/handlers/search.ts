import type OpenAI from "openai";
import { searchWorkspace } from "../../workspace/search.js";
import { globFiles } from "../../workspace/fileops.js";
import { listFolder } from "../../workspace/files.js";
import { TOOL_OUTPUT_MAX_CHARS } from "../../config.js";
import type { HandlerMap } from "./types.js";

export const searchSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "vault_suchen",
      description:
        "Durchsucht den Vault. Drei Modi: 'text' (Standard) sucht Textinhalt in Markdown-Dateien. 'dateien' sucht Dateien per Glob-Pattern (z.B. '*.md', 'Daily/*.md', 'Projekte/**/*.md'). 'ordner' zeigt den Inhalt eines Ordners.",
      parameters: {
        type: "object",
        properties: {
          abfrage: {
            type: "string",
            description: "Suchbegriff, Glob-Pattern oder Ordnerpfad (je nach Modus)",
          },
          modus: {
            type: "string",
            enum: ["text", "dateien", "ordner"],
            description: "Suchmodus: 'text' (Standard), 'dateien' oder 'ordner'",
          },
          ordner: {
            type: "string",
            description: "Optional: Suche auf Unterordner begrenzen (z.B. 'Projekte/MeinProjekt')",
          },
        },
        required: ["abfrage"],
      },
    },
  },
];

export const searchHandlers: HandlerMap = {
  vault_suchen: async (args) => {
    const abfrage = String(args.abfrage || "");
    if (!abfrage) return "Fehler: Keine Suchabfrage angegeben.";
    const modus = String(args.modus || "text");
    const ordner = args.ordner ? String(args.ordner) : undefined;

    if (modus === "ordner") {
      const entries = listFolder(abfrage);
      if (!entries.length) return `Ordner "${abfrage}" ist leer oder existiert nicht.`;
      const lines = entries.map((e) => `${e.type === "folder" ? "\u{1F4C1}" : "\u{1F4C4}"} ${e.name}`);
      return `Inhalt von ${abfrage}/:\n${lines.join("\n")}`;
    }

    if (modus === "dateien") {
      const files = globFiles(abfrage, { subdir: ordner });
      if (!files.length) return `Keine Dateien gefunden fuer "${abfrage}".`;
      return `${files.length} Datei(en) gefunden:\n${files.map((f) => `\u{1F4C4} ${f}`).join("\n")}`;
    }

    // Default: text search
    const results = searchWorkspace(abfrage, ordner);
    if (!results.length) return `Keine Treffer fuer "${abfrage}".`;

    let output = `${results.length} Treffer fuer "${abfrage}":\n\n`;
    for (const r of results) {
      output += `\u{1F4C4} ${r.file}\n   ${r.line}\n\n`;
    }
    return output.length > TOOL_OUTPUT_MAX_CHARS
      ? output.slice(0, TOOL_OUTPUT_MAX_CHARS) + "\n[... gekuerzt]"
      : output;
  },
};
