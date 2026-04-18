import type { ToolSchema } from "../_lib/types.js";

export const schema: ToolSchema = {
  type: "function",
  function: {
    name: "export",
    description:
      "Exportiert eine Vault-Notiz als PDF oder DOCX. Format 'pdf': fixierte Druckausgabe mit Headings, Listen, Checkboxen, Tabellen, Codeblocks, Blockquotes und Seitenzahlen. Format 'docx': bearbeitbares Word-Dokument. Nutze bei: 'als PDF exportieren', 'mach ein PDF daraus', 'als Word exportieren', 'DOCX erstellen', 'druckversion erstellen'.",
    parameters: {
      type: "object",
      properties: {
        format: {
          type: "string",
          description: "Ausgabeformat: 'pdf' oder 'docx'",
          enum: ["pdf", "docx"],
        },
        name: {
          type: "string",
          description: "Dateiname, Pfad oder Wikilink der zu exportierenden Notiz",
        },
        ausgabe: {
          type: "string",
          description: "Optionaler Ausgabeordner (vault-relativ). Default: EXPORT_DIR aus ENV.",
        },
      },
      required: ["format", "name"],
    },
  },
};
