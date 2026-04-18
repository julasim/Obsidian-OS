import fs from "fs";
import path from "path";
import { vaultPath, safePath, ensureDir, projectPath, walkMarkdownFiles, atomicWriteSync } from "../_lib/vault.js";
import { DEFAULT_TASK_FILE } from "../_lib/config.js";
import { ok, err, list } from "../_lib/format.js";
import { todayStr, endOfWeekStr } from "../_lib/date.js";
import type { ToolHandler } from "../_lib/types.js";

// ============================================================
// Shared
// ============================================================

const PRIO_EMOJI: Record<string, string> = {
  hoch: "\u{1F534}",
  mittel: "\u{1F7E0}",
  niedrig: "\u{1F535}",
};

const PRIO_DISPLAY: Record<string, string> = {
  hoch: " \u{1F534}",
  mittel: " \u{1F7E0}",
  niedrig: " \u{1F535}",
};

const NEW_FILE_TEMPLATE = "# Aufgaben\n\n## Aktiv\n\n## Warte auf\n\n## Irgendwann\n\n## Erledigt\n";

const SECTION_MAP: Record<string, string> = {
  aktiv: "## Aktiv",
  warte_auf: "## Warte auf",
  irgendwann: "## Irgendwann",
  erledigt: "## Erledigt",
};

// ============================================================
// Hilfsfunktionen fuer Sections
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
    // Section not found — append section + line at end
    const suffix = content.endsWith("\n") ? "" : "\n";
    return content + suffix + sectionName + "\n" + line + "\n";
  }

  // Insert after section header (and any blank line right after it)
  let insertAt = section.start + 1;
  while (insertAt < section.end && lines[insertAt].trim() === "") insertAt++;

  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}

function removeLine(content: string, lineIndex: number): string {
  const lines = content.split("\n");
  lines.splice(lineIndex, 1);
  return lines.join("\n");
}

// ============================================================
// Modus: erfassen
// ============================================================

function addTask(
  text: string,
  datum?: string,
  prioritaet?: string,
  datei?: string,
): string | null {
  const clean = text.trim();
  if (!clean) return null;

  const target = datei ?? DEFAULT_TASK_FILE;
  const withExt = target.endsWith(".md") ? target : target + ".md";
  const abs = safePath(withExt);
  if (!abs) return null;

  ensureDir(path.dirname(abs));

  const prioStr = prioritaet && PRIO_EMOJI[prioritaet] ? ` ${PRIO_EMOJI[prioritaet]}` : "";
  const datumStr = datum ? ` \u{1F4C5} ${datum}` : "";
  const line = `- [ ] ${clean}${prioStr}${datumStr}\n`;

  if (!fs.existsSync(abs)) {
    // New file — use section template
    const template = NEW_FILE_TEMPLATE;
    const content = insertIntoSection(template, "## Aktiv", line.replace(/\n$/, ""));
    atomicWriteSync(abs, content);
  } else {
    const existing = fs.readFileSync(abs, "utf-8");
    const hasAktivSection = findSection(existing, "## Aktiv") !== null;

    if (hasAktivSection) {
      const updated = insertIntoSection(existing, "## Aktiv", line.replace(/\n$/, ""));
      atomicWriteSync(abs, updated);
    } else {
      // Backward-compatible: flat format without sections
      const prefix = existing.endsWith("\n") ? "" : "\n";
      fs.appendFileSync(abs, prefix + line, "utf-8");
    }
  }

  return abs;
}

async function handleErfassen(args: Record<string, string | number | boolean | undefined>): Promise<string> {
  const text = String(args.text ?? "").trim();
  if (!text) return err("Kein Aufgabentext angegeben");

  const datum = args.datum ? String(args.datum).trim() : undefined;
  if (datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    return err(`Datum muss YYYY-MM-DD sein, bekommen: "${datum}"`);
  }

  const prioritaet = args.prioritaet ? String(args.prioritaet).trim().toLowerCase() : undefined;

  let datei = args.datei ? String(args.datei).trim() : undefined;
  if (!datei && args.projekt) {
    const projektName = String(args.projekt).trim();
    const projektDir = projectPath(projektName);
    ensureDir(projektDir);
    datei = path.relative(vaultPath, path.join(projektDir, "Aufgaben.md")).replace(/\\/g, "/");
  }

  const abs = addTask(text, datum, prioritaet, datei);
  if (!abs) return err(`Ungueltiger Zielpfad "${datei ?? DEFAULT_TASK_FILE}"`);

  const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
  const parts = [`"${text}"`];
  if (prioritaet) parts.push(prioritaet);
  if (datum) parts.push(`faellig ${datum}`);
  return ok("task", "Aufgabe erfasst", rel, parts.join(", "));
}

// ============================================================
// Modus: auflisten
// ============================================================

interface OpenTask {
  file: string;
  line: number;
  text: string;
  datum?: string;
  prioritaet?: string;
}

const OPEN_CHECKBOX = /^\s*[-*+]\s*\[\s\]\s*(.+?)\s*$/;
const DUE_DATE = /\s*\u{1F4C5}\s*(\d{4}-\d{2}-\d{2})/u;
const PRIO_RE = /\s*[\u{1F534}\u{1F7E0}\u{1F535}]/u;
const PRIO_MAP: Record<string, string> = {
  "\u{1F534}": "hoch",
  "\u{1F7E0}": "mittel",
  "\u{1F535}": "niedrig",
};

function listOpenTasks(opts: { ordner?: string; limit?: number } = {}): OpenTask[] {
  const results: OpenTask[] = [];
  const limit = opts.limit ?? 200;
  const searchRoot = opts.ordner ? safePath(opts.ordner) ?? vaultPath : vaultPath;

  walkMarkdownFiles(searchRoot, (full) => {
    try {
      const content = fs.readFileSync(full, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(OPEN_CHECKBOX);
        if (!match) continue;

        let text = match[1];
        let datum: string | undefined;
        let prioritaet: string | undefined;

        const dueMatch = text.match(DUE_DATE);
        if (dueMatch) {
          datum = dueMatch[1];
          text = text.replace(DUE_DATE, "").trim();
        }

        const prioMatch = text.match(PRIO_RE);
        if (prioMatch) {
          prioritaet = PRIO_MAP[prioMatch[0].trim()] ?? undefined;
          text = text.replace(PRIO_RE, "").trim();
        }

        results.push({
          file: path.relative(vaultPath, full).replace(/\\/g, "/"),
          line: i + 1,
          text,
          prioritaet,
          datum,
        });

        if (results.length >= limit) return false;
      }
    } catch { /* skip */ }
  });

  results.sort((a, b) => {
    if (a.datum && b.datum) return a.datum.localeCompare(b.datum);
    if (a.datum) return -1;
    if (b.datum) return 1;
    return 0;
  });

  return results;
}

function applyFaelligFilter(tasks: OpenTask[], faellig: string): OpenTask[] {
  const today = todayStr();
  switch (faellig) {
    case "heute": return tasks.filter((t) => t.datum === today);
    case "ueberfaellig": return tasks.filter((t) => t.datum !== undefined && t.datum < today);
    case "woche": {
      const endWeek = endOfWeekStr();
      return tasks.filter((t) => t.datum !== undefined && t.datum >= today && t.datum <= endWeek);
    }
    default: return tasks;
  }
}

async function handleAuflisten(args: Record<string, string | number | boolean | undefined>): Promise<string> {
  const limit = args.limit !== undefined ? Math.max(1, Number(args.limit)) : 50;
  const ordner = args.ordner ? String(args.ordner).trim() : undefined;
  const faellig = String(args.faellig ?? "alle");
  const prioFilter = args.prioritaet ? String(args.prioritaet).trim().toLowerCase() : undefined;

  let tasks = listOpenTasks({ ordner, limit });
  tasks = applyFaelligFilter(tasks, faellig);
  if (prioFilter) tasks = tasks.filter((t) => t.prioritaet === prioFilter);

  const filterHints: string[] = [];
  if (ordner) filterHints.push(`in "${ordner}"`);
  if (faellig !== "alle") filterHints.push(faellig);
  if (prioFilter) filterHints.push(`Prio: ${prioFilter}`);
  const filterStr = filterHints.length ? ` (${filterHints.join(", ")})` : "";

  const lines = tasks.map((t) => {
    const prio = t.prioritaet ? (PRIO_DISPLAY[t.prioritaet] ?? "") : "";
    const datum = t.datum ? ` \u{1F4C5} ${t.datum}` : "";
    return `- [ ] ${t.text}${prio}${datum} \u2014 ${t.file}:${t.line}`;
  });

  return list(tasks.length, "offene Aufgabe", "offene Aufgaben", lines, filterStr);
}

// ============================================================
// Modus: erledigen
// ============================================================

async function handleErledigen(args: Record<string, string | number | boolean | undefined>): Promise<string> {
  const text = String(args.text ?? "").trim();
  if (!text) return err("Kein Suchtext angegeben");

  const datei = args.datei ? String(args.datei).trim() : DEFAULT_TASK_FILE;
  const withExt = datei.endsWith(".md") ? datei : datei + ".md";
  const abs = safePath(withExt);
  if (!abs || !fs.existsSync(abs)) return `Datei "${datei}" nicht gefunden.`;

  const content = fs.readFileSync(abs, "utf-8");
  const lines = content.split("\n");

  // Find ALL matching open task lines (fuer Ambiguitaetspruefung)
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[-*+]\s*\[\s\]/.test(lines[i]) && lines[i].toLowerCase().includes(text.toLowerCase())) {
      matches.push(i);
    }
  }

  if (matches.length === 0) return `Aufgabe mit "${text}" nicht gefunden.`;
  if (matches.length > 1) {
    const preview = matches.slice(0, 5).map((idx) => `  - Zeile ${idx + 1}: ${lines[idx].trim()}`).join("\n");
    return `Mehrere Aufgaben passen zu "${text}" (${matches.length} Treffer). Bitte praeziser:\n${preview}`;
  }

  const matchIdx = matches[0];
  const today = todayStr();
  let taskLine = lines[matchIdx];

  // Extract the task text (everything after "- [ ] ")
  const taskTextMatch = taskLine.match(/^(\s*[-*+]\s*)\[\s\]\s*(.+?)\s*$/);
  if (!taskTextMatch) return `Aufgabe mit "${text}" nicht gefunden.`;

  const prefix = taskTextMatch[1];
  const taskText = taskTextMatch[2];

  // Build completed line: [x], strikethrough, date
  const completedLine = `${prefix}[x] ~~${taskText}~~ (${today})`;

  // Remove from current position
  let updated = removeLine(content, matchIdx);

  // Insert into Erledigt section
  const erledigtSection = findSection(updated, "## Erledigt");
  if (erledigtSection) {
    updated = insertIntoSection(updated, "## Erledigt", completedLine);
  } else {
    // No Erledigt section — append at end
    const suffix = updated.endsWith("\n") ? "" : "\n";
    updated = updated + suffix + completedLine + "\n";
  }

  const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
  atomicWriteSync(abs, updated);
  return ok("task", "Aufgabe erledigt", rel, `"~~${taskText}~~"`);
}

// ============================================================
// Modus: verschieben
// ============================================================

async function handleVerschieben(args: Record<string, string | number | boolean | undefined>): Promise<string> {
  const text = String(args.text ?? "").trim();
  if (!text) return err("Kein Suchtext angegeben");

  const nach = String(args.nach ?? "").trim().toLowerCase();
  if (!nach || !SECTION_MAP[nach]) return err(`Ungueltiges Ziel: "${nach}". Erlaubt: aktiv, warte_auf, irgendwann`);

  const datei = args.datei ? String(args.datei).trim() : DEFAULT_TASK_FILE;
  const withExt = datei.endsWith(".md") ? datei : datei + ".md";
  const abs = safePath(withExt);
  if (!abs || !fs.existsSync(abs)) return `Datei "${datei}" nicht gefunden.`;

  const content = fs.readFileSync(abs, "utf-8");
  const lines = content.split("\n");

  // Alle matching task lines (fuer Ambiguitaetspruefung)
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[-*+]\s*\[[ x]\]/.test(lines[i]) && lines[i].toLowerCase().includes(text.toLowerCase())) {
      matches.push(i);
    }
  }

  if (matches.length === 0) return `Aufgabe mit "${text}" nicht gefunden.`;
  if (matches.length > 1) {
    const preview = matches.slice(0, 5).map((idx) => `  - Zeile ${idx + 1}: ${lines[idx].trim()}`).join("\n");
    return `Mehrere Aufgaben passen zu "${text}" (${matches.length} Treffer). Bitte praeziser:\n${preview}`;
  }

  const matchIdx = matches[0];
  const taskLine = lines[matchIdx];

  // Remove from current position
  let updated = removeLine(content, matchIdx);

  // Insert into target section
  const targetSection = SECTION_MAP[nach];
  updated = insertIntoSection(updated, targetSection, taskLine);

  atomicWriteSync(abs, updated);
  return ok("task", "Aufgabe verschoben", `nach ${nach}`, text);
}

// ============================================================
// Modus: warte_auf
// ============================================================

async function handleWarteAuf(args: Record<string, string | number | boolean | undefined>): Promise<string> {
  const text = String(args.text ?? "").trim();
  if (!text) return err("Kein Aufgabentext angegeben");

  const person = String(args.person ?? "").trim();
  if (!person) return err("Keine Person angegeben (person ist Pflicht bei modus=warte_auf)");

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
  if (!abs) return err(`Ungueltiger Zielpfad "${target}"`);

  ensureDir(path.dirname(abs));

  const today = todayStr();
  const line = `- [ ] **${text}** — warte auf ${person}, seit ${today}`;

  if (!fs.existsSync(abs)) {
    const content = insertIntoSection(NEW_FILE_TEMPLATE, "## Warte auf", line);
    atomicWriteSync(abs, content);
  } else {
    const existing = fs.readFileSync(abs, "utf-8");
    const hasSection = findSection(existing, "## Warte auf") !== null;

    if (hasSection) {
      const updated = insertIntoSection(existing, "## Warte auf", line);
      atomicWriteSync(abs, updated);
    } else {
      // No section — append section + line
      const suffix = existing.endsWith("\n") ? "" : "\n";
      atomicWriteSync(abs, existing + suffix + "## Warte auf\n" + line + "\n");
    }
  }

  const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
  return ok("task", "Warte-Aufgabe erfasst", rel, `"${text}" — ${person}`);
}

// ============================================================
// Dispatcher
// ============================================================

export const handler: ToolHandler = async (args) => {
  const modus = String(args.modus ?? "auflisten");

  switch (modus) {
    case "erfassen": return handleErfassen(args);
    case "auflisten": return handleAuflisten(args);
    case "erledigen": return handleErledigen(args);
    case "verschieben": return handleVerschieben(args);
    case "warte_auf": return handleWarteAuf(args);
    default: return err(`Unbekannter Modus: "${modus}". Erlaubt: erfassen, auflisten, erledigen, verschieben, warte_auf`);
  }
};
