import fs from "fs";
import path from "path";
import {
  vaultPath,
  safePath,
  ensureDir,
  projectPath,
  walkMarkdownFiles,
  atomicWriteSync,
} from "../_lib/vault.js";
import { DEFAULT_TASK_FILE } from "../_lib/config.js";
import { ok, err, list, safeHandler } from "../_lib/format.js";
import { todayStr, endOfWeekStr, toIsoDate, isIsoDate, relativeDateString } from "../_lib/date.js";
import { readProjectEmoji } from "../_lib/knowledge.js";
import {
  Task,
  TaskPrioritaet,
  PRIO_EMOJI,
  emptyTask,
} from "../_lib/task-model.js";
import { parseTaskLine, parseTaskBlock } from "../_lib/task-parser.js";
import { formatTaskLine, formatTaskBlock } from "../_lib/task-format.js";
import { parseNaturalLanguage } from "../_lib/natural-language.js";
import { computeNextDate } from "../_lib/recurrence.js";
import type { ToolHandler, ToolArgs } from "../_lib/types.js";

// ============================================================
// Shared
// ============================================================

const NEW_FILE_TEMPLATE =
  "# Aufgaben\n\n## Aktiv\n\n## Warte auf\n\n## Irgendwann\n\n## Erledigt\n";

const SECTION_MAP: Record<string, string> = {
  aktiv: "## Aktiv",
  warte_auf: "## Warte auf",
  irgendwann: "## Irgendwann",
  erledigt: "## Erledigt",
};

const PRIO_DISPLAY_MAP: Record<TaskPrioritaet, string> = {
  "hoch": " \u{1F534}",
  "mittel-hoch": " \u{1F7E0}",
  "mittel": " \u{1F7E1}",
  "niedrig-mittel": " \u{1F7E2}",
  "niedrig": " \u{1F535}",
};

// ============================================================
// Section-Helpers (arbeiten mit lines-Array)
// ============================================================

function findSection(content: string, name: string): { start: number; end: number } | null {
  const lines = content.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === name) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function insertIntoSection(content: string, sectionName: string, line: string): string {
  const lines = content.split("\n");
  const section = findSection(content, sectionName);
  if (!section) {
    const suffix = content.endsWith("\n") ? "" : "\n";
    return content + suffix + sectionName + "\n" + line + "\n";
  }
  let insertAt = section.start + 1;
  while (insertAt < section.end && lines[insertAt].trim() === "") insertAt++;
  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}

function removeRange(content: string, startIdx: number, endIdx: number): string {
  const lines = content.split("\n");
  lines.splice(startIdx, endIdx - startIdx + 1);
  return lines.join("\n");
}

// ============================================================
// Task-Resolver (Pfad + File)
// ============================================================

function resolveTaskFile(args: ToolArgs): { abs: string; fallbackCreated: boolean } | string {
  let datei = args.datei ? String(args.datei).trim() : undefined;
  if (!datei && args.projekt) {
    const projektName = String(args.projekt).trim();
    const projektDir = projectPath(projektName);
    ensureDir(projektDir);
    datei = path.relative(vaultPath, path.join(projektDir, "Aufgaben.md")).replace(/\\/g, "/");
  }
  const target = datei ?? DEFAULT_TASK_FILE;
  const withExt = target.endsWith(".md") ? target : target + ".md";
  const abs = safePath(withExt);
  if (!abs) return `Fehler: Ungueltiger Zielpfad "${target}".`;
  return { abs, fallbackCreated: !fs.existsSync(abs) };
}

// ============================================================
// Args → Task-Objekt (mit NLP + Merge)
// ============================================================

const PRIO_LABEL_MAP: Record<string, TaskPrioritaet> = {
  "hoch": "hoch",
  "mittel-hoch": "mittel-hoch",
  "mittel": "mittel",
  "niedrig-mittel": "niedrig-mittel",
  "niedrig": "niedrig",
  "high": "hoch",
  "med-high": "mittel-hoch",
  "medium": "mittel",
  "med": "mittel",
  "med-low": "niedrig-mittel",
  "low": "niedrig",
};

/**
 * Baut ein Task-Objekt aus den Handler-Args.
 * NLP wird IMMER auf `text` angewendet. Strukturierte Args ueberschreiben dann.
 */
function buildTaskFromArgs(args: ToolArgs, defaults: Partial<Task> = {}): { task: Task; nlpText?: string } {
  const inputText = String(args.text ?? "").trim();
  const nlp = inputText ? parseNaturalLanguage(inputText) : { fragment: {}, rest: "" };
  const nlpFrag = nlp.fragment as Partial<Task>;

  const task = emptyTask({
    ...defaults,
    text: nlp.rest || inputText,
    tags: [...new Set([...(nlpFrag.tags ?? []), ...parseCsv(args.tags)])],
    kontext: [...new Set([...(nlpFrag.kontext ?? []), ...parseCsv(args.kontext).map(stripAtPrefix)])],
  });

  // Datum: strukturiertes Arg hat Vorrang, sonst NLP
  if (args.datum && isValidDate(String(args.datum))) {
    task.due = String(args.datum).trim();
  } else if (nlpFrag.due) {
    task.due = nlpFrag.due;
  }
  if (args.start && isValidDate(String(args.start))) {
    task.start = String(args.start).trim();
  } else if (nlpFrag.start) {
    task.start = nlpFrag.start;
  }
  if (args.scheduled && isValidDate(String(args.scheduled))) {
    task.scheduled = String(args.scheduled).trim();
  }

  // Priorität
  if (args.prioritaet) {
    const key = String(args.prioritaet).trim().toLowerCase();
    if (PRIO_LABEL_MAP[key]) task.prioritaet = PRIO_LABEL_MAP[key];
  } else if (nlpFrag.prioritaet) {
    task.prioritaet = nlpFrag.prioritaet;
  }

  // Recurrence
  if (args.wiederholung) {
    task.recurrence = String(args.wiederholung).trim();
  } else if (nlpFrag.recurrence) {
    task.recurrence = nlpFrag.recurrence;
  }

  // Estimate
  if (args.schaetzung) {
    task.estimate = String(args.schaetzung).trim();
  } else if (nlpFrag.estimate) {
    task.estimate = nlpFrag.estimate;
  }

  // Plan-Referenz
  if (args.plan_ref) {
    task.planRef = String(args.plan_ref).trim();
  }

  // Created-Datum
  task.created = todayStr();

  // Details
  const detailsArg = String(args.details ?? "").trim();
  if (detailsArg) {
    task.details = detailsArg.split("\n").map((d) => d.trim()).filter(Boolean);
  }

  return { task, nlpText: nlp.rest };
}

function parseCsv(val: string | number | boolean | undefined): string[] {
  if (!val) return [];
  return String(val)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripAtPrefix(s: string): string {
  return s.startsWith("@") ? s.slice(1) : s;
}

function isValidDate(s: string): boolean {
  return isIsoDate(s);
}

// ============================================================
// Task-Finder (in Dateien)
// ============================================================

interface TaskMatch {
  file: string;
  absFile: string;
  task: Task;
  lineIdx: number;
  blockEnd: number; // inkl. Details
}

/** Findet alle Tasks die `text` (case-insensitive) im Task-Text enthalten. */
function findTasks(
  abs: string,
  searchText: string,
  opts: { openOnly?: boolean } = {},
): TaskMatch[] {
  const content = fs.readFileSync(abs, "utf-8");
  const lines = content.split("\n");
  const lower = searchText.toLowerCase();
  const matches: TaskMatch[] = [];

  let i = 0;
  while (i < lines.length) {
    const block = parseTaskBlock(lines, i);
    if (!block) {
      i++;
      continue;
    }
    const t = block.task;
    if (opts.openOnly && t.status !== " " && t.status !== "/") {
      i += block.consumed;
      continue;
    }
    if (t.text.toLowerCase().includes(lower) || t.raw.toLowerCase().includes(lower)) {
      matches.push({
        file: path.relative(vaultPath, abs).replace(/\\/g, "/"),
        absFile: abs,
        task: { ...t, lineIndex: i },
        lineIdx: i,
        blockEnd: i + block.consumed - 1,
      });
    }
    i += block.consumed;
  }
  return matches;
}

/** Wie findTasks aber ueber den ganzen Vault / einen Unterordner. */
function findTasksInVault(
  searchText: string,
  opts: { ordner?: string; openOnly?: boolean } = {},
): TaskMatch[] {
  const root = opts.ordner ? safePath(opts.ordner) ?? vaultPath : vaultPath;
  const all: TaskMatch[] = [];
  walkMarkdownFiles(root, (abs) => {
    try {
      const found = findTasks(abs, searchText, { openOnly: opts.openOnly });
      all.push(...found);
    } catch { /* skip */ }
  });
  return all;
}

// ============================================================
// Modus: erfassen
// ============================================================

async function handleErfassen(args: ToolArgs): Promise<string> {
  const inputText = String(args.text ?? "").trim();
  if (!inputText) return err("Kein Aufgabentext angegeben");

  const resolved = resolveTaskFile(args);
  if (typeof resolved === "string") return resolved;
  const { abs } = resolved;
  ensureDir(path.dirname(abs));

  const { task } = buildTaskFromArgs(args);
  if (!task.text) return err("Task-Text wurde durch NLP komplett entfernt — bitte praeziser formulieren");

  // Subtask: wenn parent_text gegeben, Parent suchen und Einrueckung anpassen
  const parentText = String(args.parent_text ?? "").trim();
  if (parentText) {
    const existingContent = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "";
    const parentMatches = existingContent
      ? findTasks(abs, parentText, { openOnly: false })
      : [];
    if (parentMatches.length === 0) {
      return `Parent-Aufgabe mit "${parentText}" nicht gefunden.`;
    }
    if (parentMatches.length > 1) {
      const preview = parentMatches.slice(0, 5)
        .map((m) => `  - Zeile ${m.lineIdx + 1}: ${m.task.text}`).join("\n");
      return `Mehrere Parent-Kandidaten fuer "${parentText}":\n${preview}`;
    }
    const parent = parentMatches[0];
    task.indentLevel = parent.task.indentLevel + 1;
    // Einfuegen direkt nach dem Parent-Block (alle Details + existierende Subtasks)
    const lines = existingContent.split("\n");
    lines.splice(parent.blockEnd + 1, 0, ...formatTaskBlock(task));
    atomicWriteSync(abs, lines.join("\n"));
    const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
    return ok("task", "Subtask erfasst", rel, `unter "${parent.task.text}": "${task.text}"`);
  }

  // Top-Level Task in "## Aktiv" einfuegen
  const blockLines = formatTaskBlock(task);
  const blockAsLines = blockLines.join("\n");

  if (!fs.existsSync(abs)) {
    const base = NEW_FILE_TEMPLATE;
    let content = insertIntoSection(base, "## Aktiv", blockLines[0]);
    // Detail-Zeilen (ab Index 1) direkt danach einfuegen
    if (blockLines.length > 1) {
      const l = content.split("\n");
      const aktivSec = findSection(content, "## Aktiv");
      if (aktivSec) {
        // Nach der ersten Task-Zeile einfuegen
        const taskLineIdx = aktivSec.start + 1;
        // Skip Leerzeilen
        let ins = taskLineIdx;
        while (ins < l.length && l[ins].trim() === "") ins++;
        l.splice(ins + 1, 0, ...blockLines.slice(1));
        content = l.join("\n");
      }
    }
    atomicWriteSync(abs, content);
  } else {
    const existing = fs.readFileSync(abs, "utf-8");
    const hasAktiv = findSection(existing, "## Aktiv") !== null;
    if (hasAktiv) {
      // Jeden Zeile einzeln einfuegen (Reihenfolge: Task dann Details)
      let content = existing;
      for (let idx = blockLines.length - 1; idx >= 0; idx--) {
        content = insertIntoSection(content, "## Aktiv", blockLines[idx]);
      }
      atomicWriteSync(abs, content);
    } else {
      // Backward-compat: flat anhaengen
      const prefix = existing.endsWith("\n") ? "" : "\n";
      fs.appendFileSync(abs, prefix + blockAsLines + "\n", "utf-8");
    }
  }

  const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
  const parts = [`"${task.text}"`];
  if (task.prioritaet) parts.push(task.prioritaet);
  if (task.due) parts.push(`faellig ${task.due}`);
  if (task.start) parts.push(`ab ${task.start}`);
  if (task.recurrence) parts.push(`🔁 ${task.recurrence}`);
  if (task.tags.length) parts.push(task.tags.map((t) => `#${t}`).join(" "));
  if (task.kontext.length) parts.push(task.kontext.map((c) => `@${c}`).join(" "));
  return ok("task", "Aufgabe erfasst", rel, parts.join(", "));
}

// ============================================================
// Modus: auflisten (mit Views)
// ============================================================

function listAllOpenTasks(opts: { ordner?: string; limit?: number } = {}): Task[] {
  const root = opts.ordner ? safePath(opts.ordner) ?? vaultPath : vaultPath;
  const limit = opts.limit ?? 500;
  const tasks: Task[] = [];
  walkMarkdownFiles(root, (abs) => {
    try {
      const content = fs.readFileSync(abs, "utf-8");
      const lines = content.split("\n");
      const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
      let i = 0;
      while (i < lines.length && tasks.length < limit) {
        const block = parseTaskBlock(lines, i);
        if (!block) {
          i++;
          continue;
        }
        const t = block.task;
        if (t.status === " " || t.status === "/") {
          tasks.push({ ...t, file: rel, lineIndex: i });
        }
        i += block.consumed;
      }
    } catch { /* skip */ }
  });
  return tasks;
}

function applyFilters(tasks: Task[], args: ToolArgs): Task[] {
  let filtered = tasks;

  const faellig = String(args.faellig ?? "alle");
  const today = todayStr();
  const endWeek = endOfWeekStr();
  switch (faellig) {
    case "heute":
      filtered = filtered.filter((t) => (t.due ?? t.scheduled) === today);
      break;
    case "ueberfaellig":
      filtered = filtered.filter((t) => t.due !== undefined && t.due < today);
      break;
    case "woche":
      filtered = filtered.filter((t) => {
        const d = t.due ?? t.scheduled;
        return d !== undefined && d >= today && d <= endWeek;
      });
      break;
  }

  // Start-Datum: verstecke Tasks deren start > heute (sie sind noch nicht faellig sichtbar)
  if (String(args.start_respektieren ?? "true").toLowerCase() === "true") {
    filtered = filtered.filter((t) => !t.start || t.start <= today);
  }

  if (args.prioritaet) {
    const p = String(args.prioritaet).trim().toLowerCase();
    const key = PRIO_LABEL_MAP[p];
    if (key) filtered = filtered.filter((t) => t.prioritaet === key);
  }

  if (args.tag) {
    const tag = String(args.tag).trim().replace(/^#/, "").toLowerCase();
    filtered = filtered.filter((t) => t.tags.some((x) => x.toLowerCase() === tag));
  }

  if (args.kontext_filter) {
    const ctx = String(args.kontext_filter).trim().replace(/^@/, "").toLowerCase();
    filtered = filtered.filter((t) => t.kontext.some((x) => x.toLowerCase() === ctx));
  }

  if (args.person) {
    const p = String(args.person).trim().toLowerCase();
    filtered = filtered.filter((t) =>
      t.text.toLowerCase().includes(p) ||
      t.tags.some((x) => x.toLowerCase() === p) ||
      t.kontext.some((x) => x.toLowerCase() === p) ||
      (t.details.join(" ").toLowerCase().includes(p)),
    );
  }

  return filtered;
}

function sortTasks(tasks: Task[], sortierung: string): Task[] {
  const prioOrder: Record<TaskPrioritaet, number> = {
    "hoch": 1, "mittel-hoch": 2, "mittel": 3, "niedrig-mittel": 4, "niedrig": 5,
  };
  const prioScore = (t: Task) => t.prioritaet ? prioOrder[t.prioritaet] : 99;

  switch (sortierung) {
    case "nach_prio":
      return [...tasks].sort((a, b) => prioScore(a) - prioScore(b));
    case "nach_datum":
      return [...tasks].sort((a, b) => {
        const da = a.due ?? a.scheduled ?? "9999-99-99";
        const db = b.due ?? b.scheduled ?? "9999-99-99";
        return da.localeCompare(db);
      });
    default:
      // Default: nach Datum, dann nach Prio
      return [...tasks].sort((a, b) => {
        const da = a.due ?? a.scheduled ?? "9999-99-99";
        const db = b.due ?? b.scheduled ?? "9999-99-99";
        if (da !== db) return da.localeCompare(db);
        return prioScore(a) - prioScore(b);
      });
  }
}

function formatTaskForList(t: Task): string {
  const parts: string[] = [];
  parts.push(`- [${t.status}] ${t.text}`);
  if (t.prioritaet) parts.push(PRIO_DISPLAY_MAP[t.prioritaet].trim());
  if (t.due) parts.push(`\u{1F4C5} ${t.due}`);
  if (t.start) parts.push(`\u{1F6EB} ${t.start}`);
  if (t.estimate) parts.push(`\u{23F1} ${t.estimate}`);
  if (t.recurrence) parts.push(`\u{1F501} ${t.recurrence}`);
  for (const tag of t.tags) parts.push(`#${tag}`);
  for (const ctx of t.kontext) parts.push(`@${ctx}`);
  const mainLine = parts.join(" ");
  const location = t.file && t.lineIndex !== undefined
    ? ` \u2014 ${t.file}:${t.lineIndex + 1}`
    : "";
  return mainLine + location;
}

function renderDashboard(tasks: Task[]): string {
  const today = todayStr();
  const endWeek = endOfWeekStr();

  const ueberfaellig = tasks.filter((t) => t.due !== undefined && t.due < today);
  const heute = tasks.filter((t) => (t.due ?? t.scheduled) === today);
  const woche = tasks.filter((t) => {
    const d = t.due ?? t.scheduled;
    return d !== undefined && d > today && d <= endWeek;
  });
  const keinDatum = tasks.filter((t) => !t.due && !t.scheduled);

  const parts: string[] = [];
  parts.push(`Dashboard — ${tasks.length} offene Aufgaben:`);
  parts.push("");

  const section = (label: string, items: Task[]) => {
    if (items.length === 0) return;
    parts.push(`\u25B8 ${label} (${items.length}):`);
    for (const t of items.slice(0, 10)) parts.push(`  ${formatTaskForList(t)}`);
    if (items.length > 10) parts.push(`  ... und ${items.length - 10} weitere`);
    parts.push("");
  };

  section("\u{1F534} Ueberfaellig", ueberfaellig);
  section("\u{1F4C5} Heute", heute);
  section("\u{1F5D3}\u{FE0F} Diese Woche", woche);
  section("\u{1F4CC} Ohne Datum", keinDatum.slice(0, 10));

  return parts.join("\n").trimEnd();
}

// ============================================================
// Ansicht: telegram
// ============================================================

/** Escaped Telegram-MarkdownV2-Sonderzeichen in User-Text. */
function escapeMV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

/** Status-Emoji nach Dringlichkeit (nicht nach Prio). */
function statusDot(t: Task): string {
  const today = todayStr();
  const due = t.due ?? t.scheduled;
  if (due && due < today) return "\u{1F7E0}";  // 🟠 ueberfaellig
  if (due === today) return "\u{1F7E1}";        // 🟡 heute
  return "\u26AA";                              // ⚪ normal
}

/** Extrahiert Projektnamen aus dem Dateipfad (Projekte/<Name>/...). */
function projektAusPfad(file?: string): string {
  if (!file) return "Allgemein";
  const m = file.match(/^Projekte\/([^/]+)\//i);
  if (m) return m[1];
  // Sonst: erster Ordner als Gruppe, oder "Inbox"
  const parts = file.split("/");
  if (parts.length > 1) return parts[0];
  return "Allgemein";
}

/** Prioritaet als kleines Label ("hoch" / "mittel" / "niedrig"). */
function prioLabel(t: Task): string {
  if (!t.prioritaet) return "";
  switch (t.prioritaet) {
    case "hoch": return "hoch";
    case "mittel-hoch": return "hoch";
    case "mittel": return "mittel";
    case "niedrig-mittel": return "niedrig";
    case "niedrig": return "niedrig";
  }
}

/**
 * Rendert Tasks im Telegram-MarkdownV2-Format (wie der Screenshot).
 *
 * Output-Bot sendet mit parse_mode="MarkdownV2".
 */
function renderTelegramView(tasks: Task[]): string {
  const today = todayStr();
  const heute = new Date();
  const dateLabel = `${String(heute.getDate()).padStart(2, "0")}.${String(heute.getMonth() + 1).padStart(2, "0")}`;

  const ueberfaellig = tasks.filter((t) => {
    const d = t.due ?? t.scheduled;
    return d !== undefined && d < today;
  });
  const heuteCount = tasks.filter((t) => (t.due ?? t.scheduled) === today);

  // Nach Projekt gruppieren
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const proj = projektAusPfad(t.file);
    if (!groups.has(proj)) groups.set(proj, []);
    groups.get(proj)!.push(t);
  }

  // Projekt-Reihenfolge: nach Task-Anzahl absteigend
  const projectNames = [...groups.keys()].sort((a, b) => {
    return (groups.get(b)!.length - groups.get(a)!.length) || a.localeCompare(b);
  });

  const out: string[] = [];

  // Header
  out.push(`\u{1F4CB} *Offene Aufgaben* — ${escapeMV2(dateLabel)}`);
  out.push("");
  out.push(
    `*${tasks.length}* offen  ·  \u{1F7E0} *${ueberfaellig.length}* ueberfaellig  ·  \u{1F7E1} *${heuteCount.length}* heute`,
  );

  for (const proj of projectNames) {
    const items = groups.get(proj)!;
    // Sortierung innerhalb Gruppe: ueberfaellig zuerst, dann heute, dann nach Datum
    items.sort((a, b) => {
      const da = a.due ?? a.scheduled ?? "9999-99-99";
      const db = b.due ?? b.scheduled ?? "9999-99-99";
      return da.localeCompare(db);
    });

    const emoji = readProjectEmoji(proj);
    const projHeader = emoji
      ? `${emoji} *${escapeMV2(proj.toUpperCase())}*  ·  ${items.length}`
      : `\u25B8 *${escapeMV2(proj.toUpperCase())}*  ·  ${items.length}`;

    out.push("");
    out.push("\u2500".repeat(20));
    out.push(projHeader);
    out.push("");

    for (const t of items) {
      const dot = statusDot(t);
      const due = t.due ?? t.scheduled;
      const dueStr = relativeDateString(due);
      const prio = prioLabel(t);
      const metaParts: string[] = [];
      metaParts.push(dueStr);
      if (prio) metaParts.push(prio);

      const titleLine = `${dot} *${escapeMV2(t.text)}*`;
      const metaLine = `    _${escapeMV2(metaParts.join(" \u00B7 "))}_`;
      out.push(titleLine);
      out.push(metaLine);
    }
  }

  // Telegram-Message-Limit: 4096 Zeichen. Mit Puffer fuer Entities auf 3900 cappen.
  const TELEGRAM_LIMIT = 3900;
  let result = out.join("\n");
  if (result.length > TELEGRAM_LIMIT) {
    const truncated = result.slice(0, TELEGRAM_LIMIT);
    // Bis zur letzten vollstaendigen Zeile zurueckschneiden
    const lastNewline = truncated.lastIndexOf("\n");
    const safeSlice = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
    result = safeSlice + `\n\n_\\.\\.\\. gekuerzt \\(${tasks.length} Tasks gesamt, nutze Filter\\)_`;
  }
  return result;
}

async function handleAuflisten(args: ToolArgs): Promise<string> {
  const ansicht = String(args.ansicht ?? "default");
  const ordner = args.ordner ? String(args.ordner).trim() : undefined;
  const limit = args.limit !== undefined ? Math.max(1, Number(args.limit)) : 50;
  const sortierung = String(args.sortierung ?? "default");

  const all = listAllOpenTasks({ ordner, limit: 500 });

  // Dashboard ist eine Spezial-Ansicht
  if (ansicht === "dashboard") {
    return renderDashboard(all);
  }

  // Telegram-Ansicht: MarkdownV2-formatiert, gruppiert nach Projekt
  if (ansicht === "telegram") {
    // Default-Filter: start_respektieren=true (Tasks mit start>heute ausblenden)
    const filtered = applyFilters(all, args);
    return renderTelegramView(filtered);
  }

  // Preset-Ansichten setzen implizite Filter
  const derivedArgs: ToolArgs = { ...args };
  switch (ansicht) {
    case "heute":
      derivedArgs.faellig = "heute";
      break;
    case "woche":
      derivedArgs.faellig = "woche";
      break;
    case "ueberfaellig":
      derivedArgs.faellig = "ueberfaellig";
      break;
  }

  const filtered = applyFilters(all, derivedArgs);
  const sorted = sortTasks(filtered, sortierung);
  const limited = sorted.slice(0, limit);

  // Gruppierung
  if (ansicht === "projekt") {
    return renderGrouped(limited, (t) => {
      const p = t.file?.match(/Projekte\/([^/]+)/);
      return p ? p[1] : (t.file?.split("/")[0] ?? "Vault-Root");
    }, "Projekt");
  }
  if (ansicht === "tag") {
    const flat: { key: string; task: Task }[] = [];
    for (const t of limited) {
      if (t.tags.length === 0) flat.push({ key: "(kein Tag)", task: t });
      else for (const tag of t.tags) flat.push({ key: `#${tag}`, task: t });
    }
    return renderGroupedPairs(flat, "Tag");
  }
  if (ansicht === "kontext") {
    const flat: { key: string; task: Task }[] = [];
    for (const t of limited) {
      if (t.kontext.length === 0) flat.push({ key: "(kein Kontext)", task: t });
      else for (const c of t.kontext) flat.push({ key: `@${c}`, task: t });
    }
    return renderGroupedPairs(flat, "Kontext");
  }
  if (ansicht === "nach_prio") {
    return renderGrouped(limited, (t) => t.prioritaet ?? "(keine Prio)", "Prioritaet");
  }

  // Default: flache Liste
  const filterHints: string[] = [];
  if (ordner) filterHints.push(`in "${ordner}"`);
  if (args.faellig && args.faellig !== "alle") filterHints.push(String(args.faellig));
  if (args.prioritaet) filterHints.push(`Prio: ${args.prioritaet}`);
  if (args.tag) filterHints.push(`Tag: ${args.tag}`);
  if (args.kontext_filter) filterHints.push(`Kontext: ${args.kontext_filter}`);
  if (args.person) filterHints.push(`Person: ${args.person}`);
  if (ansicht && ansicht !== "default") filterHints.push(`Ansicht: ${ansicht}`);
  const filterStr = filterHints.length ? ` (${filterHints.join(", ")})` : "";

  const lines = limited.map(formatTaskForList);
  return list(limited.length, "offene Aufgabe", "offene Aufgaben", lines, filterStr);
}

function renderGrouped(
  tasks: Task[],
  keyFn: (t: Task) => string,
  groupLabel: string,
): string {
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = keyFn(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  const parts: string[] = [`${tasks.length} offene Aufgaben (nach ${groupLabel}):`, ""];
  for (const [k, items] of [...groups.entries()].sort()) {
    parts.push(`\u25B8 ${k} (${items.length}):`);
    for (const t of items) parts.push(`  ${formatTaskForList(t)}`);
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

function renderGroupedPairs(
  pairs: { key: string; task: Task }[],
  groupLabel: string,
): string {
  const groups = new Map<string, Task[]>();
  for (const p of pairs) {
    if (!groups.has(p.key)) groups.set(p.key, []);
    groups.get(p.key)!.push(p.task);
  }
  const parts: string[] = [`${pairs.length} Eintraege (nach ${groupLabel}):`, ""];
  for (const [k, items] of [...groups.entries()].sort()) {
    parts.push(`\u25B8 ${k} (${items.length}):`);
    for (const t of items) parts.push(`  ${formatTaskForList(t)}`);
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

// ============================================================
// Modus: erledigen (mit Recurrence)
// ============================================================

async function handleErledigen(args: ToolArgs): Promise<string> {
  const searchText = String(args.text ?? "").trim();
  if (!searchText) return err("Kein Suchtext angegeben");

  const resolved = resolveTaskFile(args);
  if (typeof resolved === "string") return resolved;
  const { abs } = resolved;
  if (!fs.existsSync(abs)) return `Datei "${args.datei ?? DEFAULT_TASK_FILE}" nicht gefunden.`;

  const matches = findTasks(abs, searchText, { openOnly: true });
  if (matches.length === 0) return `Aufgabe mit "${searchText}" nicht gefunden.`;
  if (matches.length > 1) {
    const preview = matches.slice(0, 5)
      .map((m) => `  - Zeile ${m.lineIdx + 1}: ${m.task.text}`).join("\n");
    return `Mehrere Aufgaben passen zu "${searchText}" (${matches.length} Treffer). Bitte praeziser:\n${preview}`;
  }

  const match = matches[0];
  const content = fs.readFileSync(abs, "utf-8");
  const lines = content.split("\n");

  // Task abhaken (Status auf "x", done-Datum setzen)
  const completedTask: Task = {
    ...match.task,
    status: "x",
    done: todayStr(),
  };

  // Eventuelle Recurrence → neue Instanz berechnen
  let recurrenceLine: string | undefined;
  if (match.task.recurrence) {
    const baseDate = match.task.due ?? match.task.scheduled ?? todayStr();
    const next = computeNextDate(match.task.recurrence, new Date(baseDate + "T12:00:00"));
    if (next) {
      const nextTask: Task = {
        ...match.task,
        status: " ",
        done: undefined,
        created: todayStr(),
      };
      if (match.task.due) nextTask.due = toIsoDate(next);
      else if (match.task.scheduled) nextTask.scheduled = toIsoDate(next);
      else nextTask.due = toIsoDate(next);
      recurrenceLine = formatTaskLine(nextTask);
    }
  }

  // Block aus aktueller Position entfernen
  let updated = removeRange(content, match.lineIdx, match.blockEnd);

  // Erledigte Task (ohne Details/Subtasks fuer Done-Section) in Erledigt einfuegen
  const completedLineOnly = formatTaskLine({ ...completedTask, details: [] });
  const erledigtSection = findSection(updated, "## Erledigt");
  if (erledigtSection) {
    updated = insertIntoSection(updated, "## Erledigt", completedLineOnly);
  } else {
    const suffix = updated.endsWith("\n") ? "" : "\n";
    updated = updated + suffix + "## Erledigt\n" + completedLineOnly + "\n";
  }

  // Neue Recurrence-Instanz in "## Aktiv"
  let recurrenceInfo = "";
  if (recurrenceLine) {
    const aktivSec = findSection(updated, "## Aktiv");
    if (aktivSec) {
      updated = insertIntoSection(updated, "## Aktiv", recurrenceLine);
    } else {
      const suffix = updated.endsWith("\n") ? "" : "\n";
      updated = updated + suffix + "## Aktiv\n" + recurrenceLine + "\n";
    }
    recurrenceInfo = ` — Wiederholung: naechste Instanz erstellt`;
  }

  atomicWriteSync(abs, updated);
  const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
  return ok("task", "Aufgabe erledigt", rel, `"${match.task.text}"${recurrenceInfo}`);
}

// ============================================================
// Modus: verschieben
// ============================================================

async function handleVerschieben(args: ToolArgs): Promise<string> {
  const searchText = String(args.text ?? "").trim();
  if (!searchText) return err("Kein Suchtext angegeben");

  const nach = String(args.nach ?? "").trim().toLowerCase();
  if (!nach || !SECTION_MAP[nach]) {
    return err(`Ungueltiges Ziel: "${nach}". Erlaubt: aktiv, warte_auf, irgendwann, erledigt`);
  }

  const resolved = resolveTaskFile(args);
  if (typeof resolved === "string") return resolved;
  const { abs } = resolved;
  if (!fs.existsSync(abs)) return `Datei "${args.datei ?? DEFAULT_TASK_FILE}" nicht gefunden.`;

  const matches = findTasks(abs, searchText, { openOnly: false });
  if (matches.length === 0) return `Aufgabe mit "${searchText}" nicht gefunden.`;
  if (matches.length > 1) {
    const preview = matches.slice(0, 5)
      .map((m) => `  - Zeile ${m.lineIdx + 1}: ${m.task.text}`).join("\n");
    return `Mehrere Aufgaben passen zu "${searchText}":\n${preview}`;
  }

  const match = matches[0];
  const content = fs.readFileSync(abs, "utf-8");
  const blockLines = formatTaskBlock({ ...match.task, indentLevel: 0 });

  let updated = removeRange(content, match.lineIdx, match.blockEnd);
  // Block in Ziel-Section einfuegen (rueckwaerts, so dass Reihenfolge erhalten bleibt)
  for (let i = blockLines.length - 1; i >= 0; i--) {
    updated = insertIntoSection(updated, SECTION_MAP[nach], blockLines[i]);
  }

  atomicWriteSync(abs, updated);
  const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
  return ok("task", "Aufgabe verschoben", `nach ${nach}`, `"${match.task.text}" in ${rel}`);
}

// ============================================================
// Modus: warte_auf
// ============================================================

async function handleWarteAuf(args: ToolArgs): Promise<string> {
  const inputText = String(args.text ?? "").trim();
  if (!inputText) return err("Kein Aufgabentext angegeben");

  const person = String(args.person ?? "").trim();
  if (!person) return err("Keine Person angegeben (person ist Pflicht bei modus=warte_auf)");

  const resolved = resolveTaskFile(args);
  if (typeof resolved === "string") return resolved;
  const { abs } = resolved;
  ensureDir(path.dirname(abs));

  const { task } = buildTaskFromArgs(args);
  task.text = `${task.text} — warte auf ${person}, seit ${todayStr()}`;

  const line = formatTaskLine(task);

  if (!fs.existsSync(abs)) {
    atomicWriteSync(abs, insertIntoSection(NEW_FILE_TEMPLATE, "## Warte auf", line));
  } else {
    const existing = fs.readFileSync(abs, "utf-8");
    const hasSection = findSection(existing, "## Warte auf") !== null;
    if (hasSection) {
      atomicWriteSync(abs, insertIntoSection(existing, "## Warte auf", line));
    } else {
      const suffix = existing.endsWith("\n") ? "" : "\n";
      atomicWriteSync(abs, existing + suffix + "## Warte auf\n" + line + "\n");
    }
  }

  const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
  return ok("task", "Warte-Aufgabe erfasst", rel, `"${task.text}"`);
}

// ============================================================
// Modus: bearbeiten
// ============================================================

async function handleBearbeiten(args: ToolArgs): Promise<string> {
  const searchText = String(args.text ?? "").trim();
  if (!searchText) return err("Kein Suchtext (text) angegeben");

  const resolved = resolveTaskFile(args);
  if (typeof resolved === "string") return resolved;
  const { abs } = resolved;
  if (!fs.existsSync(abs)) return `Datei "${args.datei ?? DEFAULT_TASK_FILE}" nicht gefunden.`;

  const matches = findTasks(abs, searchText, { openOnly: false });
  if (matches.length === 0) return `Aufgabe mit "${searchText}" nicht gefunden.`;
  if (matches.length > 1) {
    const preview = matches.slice(0, 5)
      .map((m) => `  - Zeile ${m.lineIdx + 1}: ${m.task.text}`).join("\n");
    return `Mehrere Aufgaben passen zu "${searchText}":\n${preview}`;
  }

  const match = matches[0];
  const t = { ...match.task };
  const changes: string[] = [];

  // Felder aktualisieren (strukturierte Args)
  if (args.neuer_text) {
    t.text = String(args.neuer_text).trim();
    changes.push("Text");
  }
  if (args.datum) {
    if (!isValidDate(String(args.datum))) return err(`Datum muss YYYY-MM-DD sein`);
    t.due = String(args.datum);
    changes.push(`due=${t.due}`);
  }
  if (args.start) {
    if (!isValidDate(String(args.start))) return err(`Start muss YYYY-MM-DD sein`);
    t.start = String(args.start);
    changes.push(`start=${t.start}`);
  }
  if (args.scheduled) {
    if (!isValidDate(String(args.scheduled))) return err(`Scheduled muss YYYY-MM-DD sein`);
    t.scheduled = String(args.scheduled);
    changes.push(`scheduled=${t.scheduled}`);
  }
  if (args.prioritaet) {
    const key = PRIO_LABEL_MAP[String(args.prioritaet).toLowerCase()];
    if (key) {
      t.prioritaet = key;
      changes.push(`prio=${key}`);
    }
  }
  if (args.wiederholung) {
    t.recurrence = String(args.wiederholung).trim();
    changes.push(`🔁 ${t.recurrence}`);
  }
  if (args.schaetzung) {
    t.estimate = String(args.schaetzung).trim();
    changes.push(`⏱️ ${t.estimate}`);
  }
  if (args.plan_ref) {
    t.planRef = String(args.plan_ref).trim();
    changes.push(`🔗 ${t.planRef}`);
  }

  // Tags/Context: action=add|remove|set via tag_action
  const tagAction = String(args.tag_action ?? "set");
  if (args.tags !== undefined) {
    const newTags = parseCsv(args.tags);
    if (tagAction === "add") t.tags = [...new Set([...t.tags, ...newTags])];
    else if (tagAction === "remove") t.tags = t.tags.filter((x) => !newTags.includes(x));
    else t.tags = newTags;
    changes.push(`tags(${tagAction})`);
  }
  if (args.kontext !== undefined) {
    const newCtx = parseCsv(args.kontext).map(stripAtPrefix);
    if (tagAction === "add") t.kontext = [...new Set([...t.kontext, ...newCtx])];
    else if (tagAction === "remove") t.kontext = t.kontext.filter((x) => !newCtx.includes(x));
    else t.kontext = newCtx;
    changes.push(`kontext(${tagAction})`);
  }

  if (changes.length === 0) return err("Keine Aenderungen angegeben");

  // Zeile ersetzen (nur Haupt-Zeile, Details bleiben unangetastet)
  const content = fs.readFileSync(abs, "utf-8");
  const lines = content.split("\n");
  lines[match.lineIdx] = formatTaskLine(t);
  atomicWriteSync(abs, lines.join("\n"));

  const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
  return ok("task", "Aufgabe bearbeitet", rel, `"${t.text}" — ${changes.join(", ")}`);
}

// ============================================================
// Modus: details
// ============================================================

async function handleDetails(args: ToolArgs): Promise<string> {
  const searchText = String(args.text ?? "").trim();
  if (!searchText) return err("Kein Suchtext (text) angegeben");

  const aktion = String(args.aktion ?? "hinzufuegen").toLowerCase();
  const detailText = String(args.details ?? "").trim();

  const resolved = resolveTaskFile(args);
  if (typeof resolved === "string") return resolved;
  const { abs } = resolved;
  if (!fs.existsSync(abs)) return `Datei "${args.datei ?? DEFAULT_TASK_FILE}" nicht gefunden.`;

  const matches = findTasks(abs, searchText, { openOnly: false });
  if (matches.length === 0) return `Aufgabe mit "${searchText}" nicht gefunden.`;
  if (matches.length > 1) {
    const preview = matches.slice(0, 5)
      .map((m) => `  - Zeile ${m.lineIdx + 1}: ${m.task.text}`).join("\n");
    return `Mehrere Aufgaben passen:\n${preview}`;
  }

  const match = matches[0];

  if (aktion === "zeigen") {
    if (match.task.details.length === 0) return `Keine Details fuer "${match.task.text}".`;
    return match.task.details.map((d) => `  ${d}`).join("\n");
  }

  if (aktion === "hinzufuegen") {
    if (!detailText) return err("details (Text) ist Pflicht bei aktion=hinzufuegen");
    const content = fs.readFileSync(abs, "utf-8");
    const lines = content.split("\n");
    const childIndent = "  ".repeat(match.task.indentLevel + 1);
    const newLines = detailText.split("\n").map((d) => `${childIndent}- ${d.trim()}`);
    // Einfuegen direkt nach der Task-Zeile (vor existierenden Details)
    lines.splice(match.lineIdx + 1, 0, ...newLines);
    atomicWriteSync(abs, lines.join("\n"));
    const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
    return ok("task", "Details hinzugefuegt", rel, `${newLines.length} Zeile(n) zu "${match.task.text}"`);
  }

  return err(`Unbekannte aktion: "${aktion}". Erlaubt: hinzufuegen, zeigen`);
}

// ============================================================
// Modus: bulk (Mehrere Tasks auf einmal)
// ============================================================

async function handleBulk(args: ToolArgs): Promise<string> {
  const aktion = String(args.bulk_aktion ?? "").toLowerCase();
  if (!aktion) return err("bulk_aktion ist Pflicht (erledigen oder verschieben)");
  if (aktion !== "erledigen" && aktion !== "verschieben") {
    return err(`Unbekannte bulk_aktion: "${aktion}". Erlaubt: erledigen, verschieben`);
  }

  const ordner = args.ordner ? String(args.ordner).trim() : undefined;
  let tasks = listAllOpenTasks({ ordner, limit: 500 });
  tasks = applyFilters(tasks, args);

  if (tasks.length === 0) return "Keine Tasks entsprechen den Filtern.";
  if (tasks.length > 20 && String(args.bestaetigung ?? "").toLowerCase() !== "true") {
    const preview = tasks.slice(0, 10)
      .map((t) => `  - ${t.text}${t.file ? ` (${t.file})` : ""}`).join("\n");
    return `${tasks.length} Tasks wuerden betroffen sein. Zur Bestaetigung bestaetigung=true setzen:\n${preview}\n...`;
  }

  let erfolg = 0;
  let fehler = 0;
  for (const t of tasks) {
    if (!t.file || t.lineIndex === undefined) continue;
    try {
      if (aktion === "erledigen") {
        await handleErledigen({ modus: "erledigen", text: t.text, datei: t.file });
        erfolg++;
      } else if (aktion === "verschieben") {
        const nach = String(args.nach ?? "").toLowerCase();
        if (!SECTION_MAP[nach]) { fehler++; continue; }
        await handleVerschieben({ modus: "verschieben", text: t.text, nach, datei: t.file });
        erfolg++;
      }
    } catch {
      fehler++;
    }
  }

  return ok("task", `Bulk ${aktion}`, `${erfolg} erfolgreich`, fehler > 0 ? `${fehler} Fehler` : "");
}

// ============================================================
// Dispatcher
// ============================================================

export const handler: ToolHandler = safeHandler(async (args) => {
  const modus = String(args.modus ?? "auflisten");

  switch (modus) {
    case "erfassen": return handleErfassen(args);
    case "auflisten": return handleAuflisten(args);
    case "erledigen": return handleErledigen(args);
    case "verschieben": return handleVerschieben(args);
    case "warte_auf": return handleWarteAuf(args);
    case "bearbeiten": return handleBearbeiten(args);
    case "details": return handleDetails(args);
    case "bulk": return handleBulk(args);
    default:
      return err(
        `Unbekannter Modus: "${modus}". Erlaubt: erfassen, auflisten, erledigen, verschieben, warte_auf, bearbeiten, details, bulk`,
      );
  }
});
