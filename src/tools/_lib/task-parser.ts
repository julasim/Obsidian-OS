/**
 * Parst Markdown-Zeilen (Obsidian-Tasks-Syntax) in Task-Objekte.
 */

import {
  Task,
  TaskStatus,
  TaskPrioritaet,
  EMOJI_TO_PRIO,
  E,
  emptyTask,
} from "./task-model.js";

// Variation-Selector entfernen (U+FE0F) — manche Emojis treten mit/ohne auf.
function stripVS(s: string): string {
  return s.replace(/\uFE0F/g, "");
}

// Zaehlt Einrueckung: Tab = 1 Level, 2 Spaces = 1 Level.
function computeIndentLevel(raw: string): { level: number; leading: string } {
  const m = raw.match(/^([ \t]*)/);
  const leading = m ? m[1] : "";
  let level = 0;
  let i = 0;
  while (i < leading.length) {
    if (leading[i] === "\t") {
      level += 1;
      i += 1;
    } else {
      // Spaces zaehlen — je 2 = 1 Level
      let spaces = 0;
      while (i < leading.length && leading[i] === " ") {
        spaces += 1;
        i += 1;
      }
      level += Math.floor(spaces / 2);
    }
  }
  return { level, leading };
}

// Regex fuer Task-Zeile: optional indent, "- [<status>] "
const TASK_LINE_RE = /^([ \t]*)-\s\[([ xX\/\->!])\]\s?(.*)$/;

/**
 * Parst eine einzelne Markdown-Zeile in ein Task-Objekt.
 * Gibt null zurueck, wenn die Zeile kein Task ist.
 *
 * Beispiele:
 *   parseTaskLine("- [ ] Test 🔴 📅 2026-04-25 #work @laptop ^t1")
 *     => { status:" ", prioritaet:"hoch", due:"2026-04-25",
 *          tags:["work"], kontext:["laptop"], blockId:"t1", text:"Test" }
 *   parseTaskLine("  - [x] Subtask 🟡")
 *     => { status:"x", prioritaet:"mittel", indentLevel:1, text:"Subtask" }
 *   parseTaskLine("Kein Task") => null
 */
export function parseTaskLine(line: string): Task | null {
  const m = line.match(TASK_LINE_RE);
  if (!m) return null;

  const [, , statusRaw, rest] = m;
  const { level } = computeIndentLevel(line);

  // Normalize status
  let status: TaskStatus = " ";
  const sr = statusRaw.toLowerCase();
  if (sr === "x") status = "x";
  else if (sr === "/") status = "/";
  else if (sr === "-") status = "-";
  else if (sr === ">") status = ">";
  else if (sr === "!") status = "!";
  else status = " ";

  const task: Task = emptyTask({
    raw: line,
    status,
    indentLevel: level,
  });

  let body = stripVS(rest);

  // Block-ID am Ende: " ^abc123"
  const blockMatch = body.match(/\s\^([A-Za-z0-9-]+)\s*$/);
  if (blockMatch) {
    task.blockId = blockMatch[1];
    body = body.slice(0, blockMatch.index).trimEnd();
  }

  // Prio-Emojis extrahieren
  for (const [emoji, prio] of Object.entries(EMOJI_TO_PRIO)) {
    const stripped = stripVS(emoji);
    if (body.includes(stripped)) {
      task.prioritaet = prio;
      body = body.split(stripped).join("");
    }
  }

  // Datums-Felder (Emoji + optional space + YYYY-MM-DD)
  const dateFields: Array<[keyof Task, string]> = [
    ["start", E.start],
    ["due", E.due],
    ["scheduled", E.scheduled],
    ["created", E.created],
    ["done", E.done],
  ];

  for (const [key, emoji] of dateFields) {
    const em = stripVS(emoji);
    const re = new RegExp(
      em.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "\\s*(\\d{4}-\\d{2}-\\d{2})"
    );
    const dm = body.match(re);
    if (dm) {
      (task as any)[key] = dm[1];
      body = body.replace(dm[0], "");
    }
  }

  // Estimate: ⏱️ <token>  (z.B. "30m", "2h", "1h30m")
  {
    const em = stripVS(E.estimate);
    const re = new RegExp(
      em.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*([0-9]+[hm](?:[0-9]+m)?)"
    );
    const mm = body.match(re);
    if (mm) {
      task.estimate = mm[1];
      body = body.replace(mm[0], "");
    }
  }

  // PlanRef: 🔗 <token bis Whitespace>
  {
    const em = stripVS(E.planRef);
    const re = new RegExp(
      em.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(\\S+)"
    );
    const mm = body.match(re);
    if (mm) {
      task.planRef = mm[1];
      body = body.replace(mm[0], "");
    }
  }

  // Recurrence: 🔁 <rest bis zum naechsten bekannten Emoji oder EOL>
  {
    const em = stripVS(E.recurrence);
    const idx = body.indexOf(em);
    if (idx >= 0) {
      const after = body.slice(idx + em.length);
      // Stoppe bei naechstem Emoji/Tag/Context
      const stopRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|(?:^|\s)[#@]/u;
      const stopMatch = after.match(stopRe);
      let recText: string;
      let consumed: number;
      if (stopMatch && stopMatch.index !== undefined) {
        recText = after.slice(0, stopMatch.index).trim();
        consumed = em.length + stopMatch.index;
      } else {
        recText = after.trim();
        consumed = em.length + after.length;
      }
      task.recurrence = recText;
      body = body.slice(0, idx) + body.slice(idx + consumed);
    }
  }

  // Tags: #wort (nicht mitten im Wort, nicht in URLs)
  const tagRe = /(?:^|\s)#([A-Za-z0-9_\-\/]+)/g;
  {
    let tm: RegExpExecArray | null;
    const found: string[] = [];
    while ((tm = tagRe.exec(body)) !== null) {
      found.push(tm[1]);
    }
    if (found.length) {
      task.tags = found;
      body = body.replace(/(^|\s)#[A-Za-z0-9_\-\/]+/g, "$1");
    }
  }

  // Context: @wort
  const ctxRe = /(?:^|\s)@([A-Za-z0-9_\-\/]+)/g;
  {
    let cm: RegExpExecArray | null;
    const found: string[] = [];
    while ((cm = ctxRe.exec(body)) !== null) {
      found.push(cm[1]);
    }
    if (found.length) {
      task.kontext = found;
      body = body.replace(/(^|\s)@[A-Za-z0-9_\-\/]+/g, "$1");
    }
  }

  // Text bereinigen: mehrfache Whitespace zusammenfassen
  task.text = body.replace(/\s+/g, " ").trim();

  return task;
}

/**
 * Parst einen Task plus seine eingerueckten Detail-Zeilen.
 * Gibt die Anzahl der konsumierten Zeilen zurueck.
 *
 * Detail-Zeilen sind Zeilen mit MEHR Einrueckung als die Task-Zeile,
 * die selbst KEIN Task sind. Endet bei gleicher/weniger Einrueckung,
 * Leerzeile oder neuem Task auf gleichem Level.
 */
export function parseTaskBlock(
  lines: string[],
  startIdx: number
): { task: Task; consumed: number } | null {
  if (startIdx < 0 || startIdx >= lines.length) return null;
  const task = parseTaskLine(lines[startIdx]);
  if (!task) return null;
  task.lineIndex = startIdx;

  const parentLevel = task.indentLevel;
  const details: string[] = [];
  let i = startIdx + 1;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") break;
    const { level } = computeIndentLevel(line);
    if (level <= parentLevel) break;
    // Wenn es ein Task auf tieferer Ebene ist — NICHT als Detail einsammeln.
    if (parseTaskLine(line)) break;
    details.push(line);
    i += 1;
  }

  task.details = details;
  return { task, consumed: i - startIdx };
}
