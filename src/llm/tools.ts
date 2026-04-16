import type { ToolSchema } from "./types.js";
import {
  noteSchemas,
  searchSchemas,
  taskSchemas,
  terminSchemas,
  projektSchemas,
  obsidianSchemas,
  exportSchemas,
} from "./handlers/index.js";

const antwortenSchema: ToolSchema = {
  type: "function",
  function: {
    name: "antworten",
    description:
      "Sendet eine Antwort an den Benutzer. JEDE Antwort MUSS ueber dieses Tool gesendet werden. Typischer Ablauf: (1) Erkenne was der Input ist (Termin/Aufgabe/Notiz/Frage), (2) Fuehre die passenden Tools aus (speichern, suchen etc.), (3) Bestaetige knapp ueber antworten. Handle AUTONOM — entscheide selbst ueber Titel, Tags, Speicherort. Frage NUR bei echten Mehrdeutigkeiten zurueck. Erfinde NIEMALS Daten.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Die Antwort an den Benutzer (Markdown erlaubt)" },
      },
      required: ["text"],
    },
  },
};

export const TOOLS: ToolSchema[] = [
  antwortenSchema,
  ...noteSchemas,
  ...searchSchemas,
  ...taskSchemas,
  ...terminSchemas,
  ...projektSchemas,
  ...obsidianSchemas,
  ...exportSchemas,
];
