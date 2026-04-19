import fs from "fs";
import path from "path";
import {
  vaultPath,
  safePath,
  ensureDir,
  atomicWriteSync,
} from "../_lib/vault.js";
import { slugify } from "../_lib/knowledge.js";
import { PLANS_DIR } from "../_lib/config.js";
import { todayStr } from "../_lib/date.js";
import { ok, err, list, wikilink, safeHandler } from "../_lib/format.js";
import type { ToolHandler, ToolArgs } from "../_lib/types.js";

// ============================================================
// Status-Zeichen (Obsidian-kompatible Checkboxen)
// ============================================================

const STATUS = {
  todo: "[ ]",        // [ ]  noch nicht begonnen
  inProgress: "[~]",  // [~]  in Arbeit (Tasks-Plugin Custom)
  done: "[x]",        // [x]  erledigt
  blocked: "[!]",     // [!]  blockiert (Tasks-Plugin Custom)
} as const;

// ============================================================
// Pfade & IDs
// ============================================================

function plansDirAbs(): string {
  return path.join(vaultPath, PLANS_DIR);
}

/** Timestamp-Prefix fuer Plan-Dateinamen (YYYY-MM-DD-HH-MM). */
function timestampPrefix(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}-` +
    `${String(d.getMinutes()).padStart(2, "0")}`
  );
}

/** Absoluter Pfad zu einer Plan-Datei per ID. */
function planFilePath(planId: string): string | null {
  const id = planId.replace(/\.md$/i, "");
  const rel = path.join(PLANS_DIR, `${id}.md`);
  return safePath(rel);
}

/**
 * Findet den zuletzt geaenderten aktiven Plan.
 * Aktiv = Status im Frontmatter ist "aktiv" (Default wenn kein Status gesetzt).
 */
function findActivePlan(): string | null {
  const dir = plansDirAbs();
  if (!fs.existsSync(dir)) return null;

  let newest: { path: string; mtime: number } | null = null;
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const full = path.join(dir, file);
      try {
        const content = fs.readFileSync(full, "utf-8");
        // Archivierte Plaene ueberspringen
        if (/^status:\s*archiviert/im.test(content)) continue;
        const stat = fs.statSync(full);
        if (!newest || stat.mtimeMs > newest.mtime) {
          newest = { path: full, mtime: stat.mtimeMs };
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return newest?.path ?? null;
}

/** Aufloesen: explizite ID oder aktiver Plan. */
function resolvePlanPath(args: ToolArgs): string | null {
  if (args.plan_id) {
    return planFilePath(String(args.plan_id).trim());
  }
  return findActivePlan();
}

// ============================================================
// Plan-Parsing — Schritte aus Markdown extrahieren
// ============================================================

interface PlanStep {
  index: number;   // 1-basiert
  status: "todo" | "inProgress" | "done" | "blocked";
  text: string;
  rawLine: string;
  lineIdx: number; // Index in lines-Array
}

const STEP_RE = /^\s*-\s*\[([ x~!])\]\s*\d+\.\s+(.+?)\s*$/;

function parseSteps(content: string): PlanStep[] {
  const lines = content.split("\n");
  const steps: PlanStep[] = [];
  let stepNum = 0;

  // Nur Schritte in der "## Schritte" Section parsen
  const sectionRe = /^## Schritte\s*$/m;
  const match = sectionRe.exec(content);
  if (!match) return [];
  const startLine = content.slice(0, match.index).split("\n").length - 1 + 1;

  for (let i = startLine; i < lines.length; i++) {
    if (/^## /.test(lines[i]) && i > startLine) break; // naechste Section
    const m = lines[i].match(STEP_RE);
    if (!m) continue;
    stepNum++;
    const marker = m[1];
    const status: PlanStep["status"] =
      marker === "x" ? "done" :
      marker === "~" ? "inProgress" :
      marker === "!" ? "blocked" : "todo";
    steps.push({
      index: stepNum,
      status,
      text: m[2],
      rawLine: lines[i],
      lineIdx: i,
    });
  }
  return steps;
}

/** Ersetzt das Status-Zeichen in einer Schritt-Zeile. */
function replaceStatus(line: string, newStatus: keyof typeof STATUS): string {
  return line.replace(/\[([ x~!])\]/, STATUS[newStatus]);
}

// ============================================================
// Modus: erstellen
// ============================================================

async function handleErstellen(args: ToolArgs): Promise<string> {
  const titel = String(args.titel ?? "").trim();
  if (!titel) return err("titel ist Pflicht bei modus=erstellen");

  const schritteRaw = String(args.schritte ?? "").trim();
  if (!schritteRaw) return err("schritte ist Pflicht bei modus=erstellen (Semikolon-separiert)");

  const schritte = schritteRaw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (schritte.length === 0) return err("Mindestens ein Schritt erforderlich");

  const beschreibung = String(args.beschreibung ?? "").trim();
  const dir = plansDirAbs();
  ensureDir(dir);

  const planId = `${timestampPrefix()}-${slugify(titel)}`;
  const fp = path.join(dir, `${planId}.md`);

  const stepLines = schritte
    .map((s, i) => `- ${STATUS.todo} ${i + 1}. ${s}`)
    .join("\n");

  const content =
    `---\n` +
    `titel: ${titel}\n` +
    `erstellt: ${todayStr()}\n` +
    `status: aktiv\n` +
    `---\n\n` +
    `# ${titel}\n\n` +
    (beschreibung ? `${beschreibung}\n\n` : "") +
    `## Schritte\n\n` +
    `${stepLines}\n\n` +
    `## Notizen\n\n`;

  atomicWriteSync(fp, content);
  const rel = path.relative(vaultPath, fp).replace(/\\/g, "/");
  return ok("info", "Plan erstellt", wikilink(rel), `${schritte.length} Schritte`);
}

// ============================================================
// Modus: zeigen
// ============================================================

async function handleZeigen(args: ToolArgs): Promise<string> {
  const fp = resolvePlanPath(args);
  if (!fp || !fs.existsSync(fp)) {
    return args.plan_id
      ? `Plan "${args.plan_id}" nicht gefunden.`
      : "Kein aktiver Plan vorhanden. Nutze modus=erstellen um einen anzulegen.";
  }
  return fs.readFileSync(fp, "utf-8");
}

// ============================================================
// Modus: schritt_start / schritt_fertig / schritt_blockiert
// ============================================================

async function updateStepStatus(
  args: ToolArgs,
  newStatus: keyof typeof STATUS,
  aktionLabel: string,
  extraNotiz?: string,
): Promise<string> {
  const fp = resolvePlanPath(args);
  if (!fp || !fs.existsSync(fp)) {
    return args.plan_id
      ? `Plan "${args.plan_id}" nicht gefunden.`
      : "Kein aktiver Plan vorhanden.";
  }

  const schrittNr = args.schritt !== undefined ? Number(args.schritt) : NaN;
  if (!Number.isInteger(schrittNr) || schrittNr < 1) {
    return err("schritt (Nummer, 1-basiert) ist Pflicht");
  }

  let content = fs.readFileSync(fp, "utf-8");
  const steps = parseSteps(content);
  const step = steps.find((s) => s.index === schrittNr);
  if (!step) {
    return `Schritt ${schrittNr} nicht gefunden. Plan hat ${steps.length} Schritt(e).`;
  }

  const lines = content.split("\n");
  lines[step.lineIdx] = replaceStatus(step.rawLine, newStatus);
  content = lines.join("\n");

  // Optionale Notiz in "## Notizen" ergaenzen
  const notizText = extraNotiz ?? (args.notiz ? String(args.notiz).trim() : "");
  if (notizText) {
    const notizHeader = "## Notizen";
    const idx = content.indexOf(notizHeader);
    const entry = `- ${todayStr()} — Schritt ${schrittNr} (${aktionLabel}): ${notizText}`;
    if (idx !== -1) {
      const after = idx + notizHeader.length;
      const nextSection = content.indexOf("\n## ", after);
      const insertAt = nextSection !== -1 ? nextSection : content.length;
      content = content.slice(0, insertAt) + `\n${entry}` + content.slice(insertAt);
    } else {
      content += `\n## Notizen\n\n${entry}\n`;
    }
  }

  atomicWriteSync(fp, content);
  const rel = path.relative(vaultPath, fp).replace(/\\/g, "/");
  return ok("info", `Schritt ${aktionLabel}`, `${rel}#${schrittNr}`, `"${step.text}"`);
}

async function handleSchrittStart(args: ToolArgs): Promise<string> {
  return updateStepStatus(args, "inProgress", "gestartet");
}

async function handleSchrittFertig(args: ToolArgs): Promise<string> {
  return updateStepStatus(args, "done", "erledigt");
}

async function handleSchrittBlockiert(args: ToolArgs): Promise<string> {
  const grund = String(args.grund ?? "").trim();
  if (!grund) return err("grund ist Pflicht bei modus=schritt_blockiert");
  return updateStepStatus(args, "blocked", "blockiert", grund);
}

// ============================================================
// Modus: notiz (Notiz zu einem Schritt)
// ============================================================

async function handleNotiz(args: ToolArgs): Promise<string> {
  const fp = resolvePlanPath(args);
  if (!fp || !fs.existsSync(fp)) {
    return args.plan_id
      ? `Plan "${args.plan_id}" nicht gefunden.`
      : "Kein aktiver Plan vorhanden.";
  }

  const notizText = String(args.notiz ?? "").trim();
  if (!notizText) return err("notiz (Text) ist Pflicht bei modus=notiz");

  const schrittNr = args.schritt !== undefined ? Number(args.schritt) : NaN;

  let content = fs.readFileSync(fp, "utf-8");
  const label = Number.isInteger(schrittNr) && schrittNr >= 1
    ? `Schritt ${schrittNr}`
    : "allgemein";
  const entry = `- ${todayStr()} — ${label}: ${notizText}`;

  const notizHeader = "## Notizen";
  const idx = content.indexOf(notizHeader);
  if (idx !== -1) {
    const after = idx + notizHeader.length;
    const nextSection = content.indexOf("\n## ", after);
    const insertAt = nextSection !== -1 ? nextSection : content.length;
    content = content.slice(0, insertAt) + `\n${entry}` + content.slice(insertAt);
  } else {
    content += `\n## Notizen\n\n${entry}\n`;
  }

  atomicWriteSync(fp, content);
  const rel = path.relative(vaultPath, fp).replace(/\\/g, "/");
  return ok("info", "Notiz gespeichert", rel, `${label}: ${notizText.slice(0, 60)}`);
}

// ============================================================
// Modus: archivieren
// ============================================================

async function handleArchivieren(args: ToolArgs): Promise<string> {
  const fp = resolvePlanPath(args);
  if (!fp || !fs.existsSync(fp)) {
    return args.plan_id
      ? `Plan "${args.plan_id}" nicht gefunden.`
      : "Kein aktiver Plan vorhanden.";
  }

  let content = fs.readFileSync(fp, "utf-8");
  if (/^status:\s*aktiv/im.test(content)) {
    content = content.replace(/^status:\s*aktiv/im, "status: archiviert");
  } else if (/^status:/im.test(content)) {
    content = content.replace(/^status:.*/im, "status: archiviert");
  } else {
    // Kein Status-Feld im Frontmatter → am Anfang ergaenzen
    if (content.startsWith("---\n")) {
      content = content.replace(/^---\n/, "---\nstatus: archiviert\n");
    } else {
      content = `---\nstatus: archiviert\n---\n\n${content}`;
    }
  }

  atomicWriteSync(fp, content);
  const rel = path.relative(vaultPath, fp).replace(/\\/g, "/");
  const steps = parseSteps(content);
  const done = steps.filter((s) => s.status === "done").length;
  return ok("info", "Plan archiviert", rel, `${done}/${steps.length} Schritte erledigt`);
}

// ============================================================
// Modus: auflisten
// ============================================================

interface PlanSummary {
  file: string;
  titel: string;
  status: string;
  progress: string;
  mtime: number;
}

async function handleAuflisten(): Promise<string> {
  const dir = plansDirAbs();
  if (!fs.existsSync(dir)) return "Keine Plaene vorhanden.";

  const summaries: PlanSummary[] = [];
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const full = path.join(dir, file);
      try {
        const content = fs.readFileSync(full, "utf-8");
        const titelM = content.match(/^titel:\s*(.+)$/m);
        const statusM = content.match(/^status:\s*(.+)$/m);
        const steps = parseSteps(content);
        const done = steps.filter((s) => s.status === "done").length;
        const stat = fs.statSync(full);
        summaries.push({
          file: file.replace(/\.md$/, ""),
          titel: titelM?.[1]?.trim() ?? file.replace(/\.md$/, ""),
          status: statusM?.[1]?.trim() ?? "aktiv",
          progress: steps.length > 0 ? `${done}/${steps.length}` : "—",
          mtime: stat.mtimeMs,
        });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  summaries.sort((a, b) => b.mtime - a.mtime);

  const lines = summaries.map((s) => {
    const marker = s.status === "archiviert" ? "🗄️" : "▸";
    return `${marker} ${s.titel} — ${s.progress} — [[${s.file}]]`;
  });

  return list(summaries.length, "Plan", "Plaene", lines);
}

// ============================================================
// Dispatcher
// ============================================================

export const handler: ToolHandler = safeHandler(async (args) => {
  const modus = String(args.modus ?? "zeigen");

  switch (modus) {
    case "erstellen": return handleErstellen(args);
    case "zeigen": return handleZeigen(args);
    case "schritt_start": return handleSchrittStart(args);
    case "schritt_fertig": return handleSchrittFertig(args);
    case "schritt_blockiert": return handleSchrittBlockiert(args);
    case "notiz": return handleNotiz(args);
    case "archivieren": return handleArchivieren(args);
    case "auflisten": return handleAuflisten();
    default:
      return err(
        `Unbekannter Modus: "${modus}". Erlaubt: erstellen, zeigen, schritt_start, schritt_fertig, schritt_blockiert, notiz, archivieren, auflisten`,
      );
  }
});
