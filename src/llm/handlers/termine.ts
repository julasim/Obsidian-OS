import type OpenAI from "openai";
import { saveTermin, listTermine, deleteTermin } from "../../workspace/termine.js";
import type { HandlerMap } from "./types.js";

export const terminSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "termin_speichern",
      description:
        "Speichert einen Termin. Erkenne Termine automatisch wenn Datum/Uhrzeit im Input vorkommt. Berechne relative Angaben ('morgen', 'naechsten Montag', 'in 2 Wochen') zum aktuellen Datum. Format: TT.MM.JJJJ.",
      parameters: {
        type: "object",
        properties: {
          datum: { type: "string", description: "Datum im Format TT.MM.JJJJ" },
          text: { type: "string", description: "Beschreibung des Termins" },
          uhrzeit: { type: "string", description: "Optional: Uhrzeit im Format HH:MM" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["datum", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termine_auflisten",
      description: "Listet alle gespeicherten Termine auf, sortiert nach Datum.",
      parameters: {
        type: "object",
        properties: { projekt: { type: "string", description: "Optional: nur Termine eines Projekts" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termin_loeschen",
      description: "Loescht einen Termin dauerhaft.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text oder Teiltext des Termins" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
];

export const terminHandlers: HandlerMap = {
  termin_speichern: async (args) => {
    const result = saveTermin(
      String(args.datum),
      String(args.text),
      args.uhrzeit ? String(args.uhrzeit) : undefined,
      args.projekt ? String(args.projekt) : undefined,
    );
    if (typeof result === "string") return result;
    return `Termin gespeichert: ${result.datum} – ${result.text}`;
  },

  termine_auflisten: async (args) => {
    const termine = listTermine(args.projekt ? String(args.projekt) : undefined);
    return termine.length
      ? termine
          .map(
            (t) =>
              `\u{1F4C5} ${t.datum}${t.uhrzeit ? ` ${t.uhrzeit}` : ""} – ${t.text}${t.location ? ` (${t.location})` : ""}`,
          )
          .join("\n")
      : "Keine Termine.";
  },

  termin_loeschen: async (args) => {
    const ok = deleteTermin(String(args.text), args.projekt ? String(args.projekt) : undefined);
    return ok ? `Termin geloescht: ${args.text}` : `Termin "${args.text}" nicht gefunden.`;
  },
};
