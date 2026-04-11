import type OpenAI from "openai";
import { saveTask, listTasks, completeTask } from "../../workspace/tasks.js";
import type { HandlerMap } from "./types.js";

export const taskSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "aufgabe_speichern",
      description:
        "Speichert eine neue Aufgabe. Formuliere den Text IMMER mit konkretem Verb am Anfang (z.B. 'Angebot an Kunde schicken'). Erkenne Aufgaben automatisch wenn der Input ein Handlungsverb enthaelt.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Beschreibung der Aufgabe" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aufgaben_auflisten",
      description: "Listet alle offenen (nicht erledigten) Aufgaben auf.",
      parameters: {
        type: "object",
        properties: { projekt: { type: "string", description: "Optional: nur Aufgaben eines Projekts" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aufgabe_erledigen",
      description: "Markiert eine Aufgabe als erledigt (done).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Exakter Text der Aufgabe" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
];

export const taskHandlers: HandlerMap = {
  aufgabe_speichern: async (args) => {
    saveTask(String(args.text), args.projekt ? String(args.projekt) : undefined);
    return `Aufgabe gespeichert: ${args.text}`;
  },

  aufgaben_auflisten: async (args) => {
    const tasks = listTasks(args.projekt ? String(args.projekt) : undefined);
    const open = tasks.filter((t) => t.status !== "done");
    return open.length
      ? open
          .map((t) => `\u2022 ${t.text}${t.assignee ? ` (@${t.assignee})` : ""}${t.date ? ` [${t.date}]` : ""}`)
          .join("\n")
      : "Keine offenen Aufgaben.";
  },

  aufgabe_erledigen: async (args) => {
    const ok = completeTask(String(args.text), args.projekt ? String(args.projekt) : undefined);
    return ok ? `Erledigt: ${args.text}` : `Aufgabe nicht gefunden: "${args.text}".`;
  },
};
