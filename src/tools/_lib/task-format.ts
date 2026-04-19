/**
 * Formatiert Task-Objekte zurueck in Markdown-Zeilen
 * (Obsidian-Tasks-kompatible Feld-Reihenfolge).
 */

import { Task, PRIO_EMOJI, E } from "./task-model.js";

/**
 * Formatiert die Haupt-Zeile eines Tasks.
 * Reihenfolge:
 *   <indent>- [<status>] <text> <prio> <🛫 start> <⏳ scheduled> <📅 due>
 *   <⏱️ estimate> <🔁 recurrence> <➕ created> <✅ done> <🔗 planRef>
 *   <#tags> <@kontext> <^blockId>
 */
export function formatTaskLine(task: Task): string {
  const indent = "  ".repeat(Math.max(0, task.indentLevel | 0));
  const parts: string[] = [];

  parts.push(`${indent}- [${task.status}]`);

  const text = task.text.trim();
  if (text) parts.push(text);

  if (task.prioritaet) {
    parts.push(PRIO_EMOJI[task.prioritaet]);
  }

  if (task.start) parts.push(`${E.start} ${task.start}`);
  if (task.scheduled) parts.push(`${E.scheduled} ${task.scheduled}`);
  if (task.due) parts.push(`${E.due} ${task.due}`);
  if (task.estimate) parts.push(`${E.estimate} ${task.estimate}`);
  if (task.recurrence) parts.push(`${E.recurrence} ${task.recurrence}`);
  if (task.created) parts.push(`${E.created} ${task.created}`);
  if (task.done) parts.push(`${E.done} ${task.done}`);
  if (task.planRef) parts.push(`${E.planRef} ${task.planRef}`);

  for (const tag of task.tags) {
    parts.push(`#${tag}`);
  }
  for (const ctx of task.kontext) {
    parts.push(`@${ctx}`);
  }

  if (task.blockId) parts.push(`^${task.blockId}`);

  return parts.join(" ");
}

/**
 * Formatiert einen Task mit seinen Detail-Zeilen als Array.
 * Details werden als eingerueckte "- <detail>" Zeilen unter dem
 * Task (auf indentLevel+1) ausgegeben — ausser die Detail-Zeile
 * ist bereits vollstaendig formatiert (enthaelt fuehrenden Whitespace).
 */
export function formatTaskBlock(task: Task): string[] {
  const out: string[] = [formatTaskLine(task)];
  const childIndent = "  ".repeat(Math.max(0, (task.indentLevel | 0) + 1));

  for (const detail of task.details) {
    if (detail.startsWith(" ") || detail.startsWith("\t")) {
      // Bereits eingerueckt — uebernehmen wie ist
      out.push(detail);
    } else {
      const trimmed = detail.replace(/^[-*]\s*/, "").trim();
      out.push(`${childIndent}- ${trimmed}`);
    }
  }

  return out;
}
