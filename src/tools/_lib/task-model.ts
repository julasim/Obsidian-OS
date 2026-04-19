/**
 * Task-Datenmodell fuer das aufgaben-Tool.
 * 100% Obsidian-Tasks-Plugin-kompatibel.
 */

export type TaskStatus = " " | "x" | "/" | "-" | ">" | "!";
// " " = todo, "x" = done, "/" = in-progress, "-" = cancelled, ">" = forwarded, "!" = important/blocked

export type TaskPrioritaet = "hoch" | "mittel-hoch" | "mittel" | "niedrig-mittel" | "niedrig";

export interface Task {
  raw: string;                      // Originale Markdown-Zeile
  text: string;                     // Bereinigter Text (ohne Emojis, Tags, Context)
  status: TaskStatus;
  prioritaet?: TaskPrioritaet;
  start?: string;                   // YYYY-MM-DD (🛫)
  due?: string;                     // YYYY-MM-DD (📅)
  scheduled?: string;               // YYYY-MM-DD (⏳)
  created?: string;                 // YYYY-MM-DD (➕)
  done?: string;                    // YYYY-MM-DD (✅)
  recurrence?: string;              // "every Monday", "jeden Montag" (🔁)
  estimate?: string;                // "30m", "2h" (⏱️ custom)
  planRef?: string;                 // "plan-id#schritt" (🔗 custom)
  tags: string[];                   // ["work", "review"] (ohne #)
  kontext: string[];                // ["laptop", "buero"] (ohne @)
  blockId?: string;                 // "abc123" (ohne ^)
  indentLevel: number;              // 0 = top-level, 1 = subtask, 2 = sub-sub
  details: string[];                // Eingerueckte Zusatz-Zeilen unter der Task
  lineIndex?: number;               // Zeile in der Quelldatei (fuer Updates)
  file?: string;                    // Vault-relative Datei
}

export const PRIO_EMOJI: Record<TaskPrioritaet, string> = {
  "hoch": "\u{1F534}",
  "mittel-hoch": "\u{1F7E0}",
  "mittel": "\u{1F7E1}",
  "niedrig-mittel": "\u{1F7E2}",
  "niedrig": "\u{1F535}",
};

export const EMOJI_TO_PRIO: Record<string, TaskPrioritaet> = {
  "\u{1F534}": "hoch",
  "\u{1F7E0}": "mittel-hoch",
  "\u{1F7E1}": "mittel",
  "\u{1F7E2}": "niedrig-mittel",
  "\u{1F535}": "niedrig",
};

// Obsidian-Tasks Emoji-Konstanten
export const E = {
  start: "\u{1F6EB}",       // 🛫
  due: "\u{1F4C5}",          // 📅
  scheduled: "\u{23F3}",     // ⏳
  created: "\u{2795}",       // ➕
  done: "\u{2705}",          // ✅
  recurrence: "\u{1F501}",   // 🔁
  estimate: "\u{23F1}",      // ⏱️ (custom)
  planRef: "\u{1F517}",      // 🔗 (custom)
};

export function emptyTask(overrides?: Partial<Task>): Task {
  return {
    raw: "",
    text: "",
    status: " ",
    tags: [],
    kontext: [],
    indentLevel: 0,
    details: [],
    ...overrides,
  };
}
