import type OpenAI from "openai";
import { client, getModel } from "./client.js";
import { finalizeMainWorkspace } from "../workspace/index.js";

// ---- Setup State ----

let _active = false;

export function isSetupActive(): boolean { return _active; }
export function activateSetup(): void { _active = true; }
export function deactivateSetup(): void { _active = false; }

// ---- Setup Tool ----

const SETUP_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "setup_abschliessen",
    description: "Schliesst die Ersteinrichtung ab und speichert die Konfiguration.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name des Assistenten" },
        emoji: { type: "string", description: "Emoji des Assistenten" },
        vibe: { type: "string", description: "Charakter/Vibe des Assistenten (1-2 Saetze)" },
        userName: { type: "string", description: "Vorname des Benutzers" },
      },
      required: ["name", "emoji", "vibe", "userName"],
    },
  },
};

const SETUP_PROMPT = `Du bist ein Einrichtungsassistent. Stelle dich kurz vor und frage den Benutzer nach:
1. Wie soll dein Assistent heissen? (Name)
2. Welches Emoji passt dazu?
3. Wie soll der Assistent drauf sein? (Vibe/Charakter — z.B. "locker und direkt" oder "professionell und praezise")
4. Wie heisst du? (Vorname)

Frage alles in EINER Nachricht. Wenn der Benutzer alles beantwortet hat, rufe setup_abschliessen auf.
Antworte auf Deutsch.`;

// ---- Setup Conversation ----

let _messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

export async function processSetup(userMessage: string): Promise<string> {
  if (_messages.length === 0) {
    _messages = [{ role: "system", content: SETUP_PROMPT }];
  }

  _messages.push({ role: "user", content: userMessage });

  const response = await client.chat.completions.create({
    model: getModel(),
    messages: _messages,
    tools: [SETUP_TOOL],
    tool_choice: "auto",
  });

  const reply = response.choices[0].message;
  _messages.push(reply);

  if (reply.tool_calls?.length) {
    const call = reply.tool_calls[0] as { id: string; function: { name: string; arguments: string } };
    let args: { name: string; emoji: string; vibe: string; userName: string };
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      return "Fehler beim Verarbeiten der Setup-Daten. Bitte nochmal versuchen.";
    }

    finalizeMainWorkspace(args);
    deactivateSetup();
    _messages = [];

    return `\u2705 Eingerichtet!\n\n${args.emoji} ${args.name}\n${args.vibe}\n\nHallo ${args.userName}! Schreib einfach los \u2014 ich bin bereit.`;
  }

  return reply.content ?? "...";
}
