import type { ToolSchema } from "../types.js";
import { searchWorkspace, readIndexMd } from "../../workspace/search.js";
import { globFiles } from "../../workspace/fileops.js";
import { listFolder } from "../../workspace/files.js";
import { TOOL_OUTPUT_MAX_CHARS } from "../../config.js";
import type { HandlerMap } from "./types.js";

export const searchSchemas: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "vault_suchen",
      description:
        "Durchsucht den Vault. Drei Modi: 'text' (Standard) sucht Textinhalt in Markdown-Dateien \u2014 substring oder Regex (wenn regex=true). 'dateien' sucht Dateien per Glob-Pattern (z.B. '*.md', 'Daily/*.md', 'Projekte/**/*.md'). 'ordner' zeigt den Inhalt eines Ordners. Fuer SEMANTISCHE/UNKLARE Fragen zuerst 'vault_navigation' aufrufen, dann gezielt hier weitersuchen.",
      parameters: {
        type: "object",
        properties: {
          abfrage: {
            type: "string",
            description: "Suchbegriff, Regex, Glob-Pattern oder Ordnerpfad (je nach Modus)",
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
          regex: {
            type: "boolean",
            description: "Nur fuer modus='text': abfrage als case-insensitive Regex interpretieren (Default: false = substring)",
          },
        },
        required: ["abfrage"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vault_navigation",
      description:
        "Liefert den Inhalt der index.md (Vault-Uebersicht, vom User gepflegt) + eine Liste der Top-Level-Ordner. Nutze fuer SEMANTISCHE/UNKLARE Fragen bevor du in den Volltext suchst \u2014 index.md ist die LLM-Navigationshilfe. Danach gezielt vault_suchen mit 'ordner'-Filter.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export const searchHandlers: HandlerMap = {
  vault_suchen: async (args) => {
    const abfrage = String(args.abfrage || "");
    if (!abfrage) return "Fehler: Keine Suchabfrage angegeben.";
    const modus = String(args.modus || "text");
    const ordner = args.ordner ? String(args.ordner) : undefined;
    const regex = args.regex !== undefined && String(args.regex).toLowerCase() === "true";

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
    const results = searchWorkspace(abfrage, { limitTo: ordner, regex });
    if (!results.length) return `Keine Treffer fuer "${abfrage}"${regex ? " (Regex)" : ""}.`;

    let output = `${results.length} Treffer fuer "${abfrage}"${regex ? " (Regex)" : ""}:\n\n`;
    for (const r of results) {
      output += `\u{1F4C4} ${r.file}\n   ${r.line}\n\n`;
    }
    return output.length > TOOL_OUTPUT_MAX_CHARS
      ? output.slice(0, TOOL_OUTPUT_MAX_CHARS) + "\n[... gekuerzt]"
      : output;
  },

  vault_navigation: async () => {
    const index = readIndexMd();
    const topLevel = listFolder("");
    const folders = topLevel.filter((e) => e.type === "folder").map((e) => e.name);

    const folderBlock = folders.length
      ? `\n\n## Top-Level-Ordner\n${folders.map((f) => `\u{1F4C1} ${f}`).join("\n")}`
      : "\n\n## Top-Level-Ordner\n(keine)";

    if (!index) {
      return `Keine index.md im Vault-Root gefunden. Nutze vault_suchen mit modus='ordner' fuer Struktur-Erkundung.${folderBlock}`;
    }

    const header = "## index.md (Vault-Navigation)\n";
    const body = index.length > TOOL_OUTPUT_MAX_CHARS
      ? index.slice(0, TOOL_OUTPUT_MAX_CHARS) + "\n[... gekuerzt]"
      : index;

    return header + body + folderBlock;
  },
};
