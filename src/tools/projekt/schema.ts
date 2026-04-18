import type { ToolSchema } from "../_lib/types.js";

export const schema: ToolSchema = {
  type: "function",
  function: {
    name: "projekt",
    description:
      "Projekt-Management: Projekt-Ordner erstellen oder umbenennen. " +
      "modus=erstellen: Legt Projekte/<name>/ an, optional mit Standard-Unterordner 'Notizen/'. " +
      "Trigger: 'lege Projekt X an', 'neues Projekt Y starten'. " +
      "modus=umbenennen: Benennt Projekte/<name>/ auf <neuer_name>/ um. " +
      "Trigger: 'benenne Projekt X in Y um', 'Projekt Z heisst jetzt A'. " +
      "HINWEIS: Wikilinks in anderen Notizen werden NICHT automatisch aktualisiert. " +
      "Loeschen von Projekten wird bewusst NICHT unterstuetzt — manuell im Obsidian durchfuehren.",
    parameters: {
      type: "object",
      properties: {
        modus: {
          type: "string",
          enum: ["erstellen", "umbenennen"],
          description: "Betriebsmodus (Pflicht)",
        },
        name: {
          type: "string",
          description: "Aktueller Projekt-Name (Pflicht — der Ordner unter Projekte/)",
        },
        neuer_name: {
          type: "string",
          description: "Neuer Projekt-Name (Pflicht bei modus=umbenennen)",
        },
        mit_notizen_ordner: {
          type: "string",
          description: "Auf 'false' setzen, um das Notizen/-Unterverzeichnis NICHT anzulegen (nur bei modus=erstellen, Default: true)",
        },
      },
      required: ["modus", "name"],
    },
  },
};
