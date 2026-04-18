import fs from "fs";
import path from "path";
import {
  vaultPath,
  safePath,
  resolveDir,
  projectPath,
  ensureDir,
  timestampFilename,
  atomicWriteSync,
  resolveNotePath,
} from "../_lib/vault.js";
import {
  INBOX_DIR,
  PROJECT_NOTES_SUBDIR,
  LOCALE,
  TIMEZONE,
} from "../_lib/config.js";
import { ok, err, wikilink } from "../_lib/format.js";
import { dailyNotePath, createDailyNote, formatDate } from "../_lib/daily.js";
import type { ToolHandler } from "../_lib/types.js";

// ============================================================
// Modus: speichern
// ============================================================

/** Titel zu Obsidian-tauglichem Dateinamen normalisieren */
function titleToFilename(title: string): string {
  return title
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** YAML-safe Wert: bei Sonderzeichen in Quotes wrappen */
function yamlValue(val: string): string {
  if (/[:#\[\]{}&*!|>'"`,@]/.test(val) || val.startsWith("-") || val.startsWith("?")) {
    return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return val;
}

interface SaveNoteOptions {
  project?: string;
  title?: string;
  tags?: string[];
  ordner?: string;
  quelle?: string;
}

function saveNote(content: string, opts: SaveNoteOptions = {}): string | null {
  let folder: string;
  if (opts.ordner) {
    const resolved = safePath(opts.ordner);
    if (!resolved) return null;
    folder = resolved;
  } else if (opts.project) {
    folder = projectPath(opts.project, PROJECT_NOTES_SUBDIR);
  } else {
    folder = resolveDir(vaultPath, INBOX_DIR);
  }

  ensureDir(folder);

  const baseName = opts.title ? titleToFilename(opts.title) : timestampFilename();
  let filename = baseName + ".md";

  if (fs.existsSync(path.join(folder, filename))) {
    filename = `${baseName} ${timestampFilename()}.md`;
  }

  const filepath = path.join(folder, filename);

  const now = new Date();
  const date = now.toLocaleDateString(LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const time = now.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  });

  const source = opts.quelle ?? "extern";
  let fm = `---\ncreated: ${date} ${time}\nsource: ${yamlValue(source)}\n`;
  if (opts.title) fm += `title: ${yamlValue(opts.title)}\n`;
  if (opts.tags && opts.tags.length > 0) fm += `tags: [${opts.tags.join(", ")}]\n`;
  fm += `---\n\n`;

  atomicWriteSync(filepath, fm + content + "\n");
  return filepath;
}

async function handleSpeichern(
  args: Record<string, string | number | boolean | undefined>,
): Promise<string> {
  const text = String(args.text ?? "").trim();
  if (!text) return err("Kein Text angegeben");

  const tags = args.tags
    ? String(args.tags).split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;

  const filepath = saveNote(text, {
    project: args.projekt ? String(args.projekt) : undefined,
    title: args.titel ? String(args.titel) : undefined,
    ordner: args.ordner ? String(args.ordner) : undefined,
    quelle: args.quelle ? String(args.quelle) : undefined,
    tags,
  });

  if (!filepath) return err(`Ungueltiger Ordner-Pfad: "${args.ordner}"`);

  const detail = args.projekt
    ? `Projekt: ${String(args.projekt)}`
    : args.ordner
      ? String(args.ordner)
      : undefined;
  return ok("note", "Notiz gespeichert", wikilink(filepath), detail);
}

// ============================================================
// Modus: bearbeiten
// ============================================================

interface EditResult {
  count: number;
  preview: string;
}

function editFile(
  nameOrPath: string,
  search: string,
  replace: string,
  options?: { regex?: boolean; all?: boolean },
): EditResult | null {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath || !fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath, "utf-8");
  const useRegex = options?.regex ?? false;
  const replaceAll = options?.all ?? false;
  const flags = replaceAll ? "g" : "";
  let pattern: RegExp;
  try {
    pattern = useRegex
      ? new RegExp(search, flags)
      : new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  } catch (err) {
    return { count: 0, preview: `Regex-Fehler: ${err}` };
  }
  let count = 0;
  const updated = content.replace(pattern, () => {
    count++;
    return replace;
  });
  if (count === 0) return { count: 0, preview: "" };
  atomicWriteSync(filepath, updated);
  // Bei leerem replace (= Text geloescht) koennen wir keinen Kontext um den Treffer zeigen.
  // Stattdessen: zeige die erste betroffene Region (vor dem ersten "Loch" im Content).
  let preview: string;
  if (replace === "") {
    preview = `${count}x entfernt`;
  } else {
    const idx = updated.indexOf(replace);
    const start = Math.max(0, idx - 30);
    const end = Math.min(updated.length, idx + replace.length + 30);
    preview =
      (start > 0 ? "..." : "") +
      updated.slice(start, end) +
      (end < updated.length ? "..." : "");
  }
  return { count, preview };
}

function appendToNote(nameOrPath: string, content: string): boolean {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return false;
  const now = new Date();
  const time = now.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  });
  fs.appendFileSync(filepath, `\n**Nachtrag ${time}:** ${content}\n`, "utf-8");
  return true;
}

async function handleBearbeiten(
  args: Record<string, string | number | boolean | undefined>,
): Promise<string> {
  const name = String(args.name ?? "").trim();
  if (!name) return err("Kein Name angegeben");

  // Mode 2: Find-replace
  if (args.suchen) {
    const useRegex = String(args.regex ?? "").toLowerCase() === "true";
    const replaceAll = String(args.alle ?? "").toLowerCase() === "true";
    const result = editFile(name, String(args.suchen), String(args.ersetzen ?? ""), {
      regex: useRegex,
      all: replaceAll,
    });
    if (!result) return `Datei "${name}" nicht gefunden.`;
    if (result.preview.startsWith("Regex-Fehler:")) return err(result.preview);
    if (result.count === 0) return `Suchtext nicht gefunden in "${name}".`;
    const hint = [
      `${result.count}x ersetzt`,
      useRegex ? "Regex" : undefined,
      replaceAll ? "global" : undefined,
    ].filter(Boolean).join(", ");
    return ok("note", "Notiz bearbeitet", wikilink(name), hint);
  }

  // Mode 1: Append
  if (args.text) {
    const appended = appendToNote(name, String(args.text));
    if (!appended) return `Datei "${name}" nicht gefunden.`;
    return ok("note", "Nachtrag gespeichert", wikilink(name));
  }

  return err("Entweder 'text' (zum Anhaengen) oder 'suchen'+'ersetzen' angeben");
}

// ============================================================
// Modus: loeschen
// ============================================================

const TRASH_DIR = ".trash";

function trashPath(): string {
  return path.join(vaultPath, TRASH_DIR);
}

function deleteNote(
  nameOrPath: string,
  permanent: boolean,
): { filename: string; action: "geloescht" | "in Papierkorb verschoben" } | { error: string } {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return { error: `Datei "${nameOrPath}" nicht gefunden.` };
  if (!fs.existsSync(filepath)) return { error: `Datei "${nameOrPath}" nicht gefunden.` };

  const filename = path.basename(filepath);

  if (permanent) {
    try {
      fs.unlinkSync(filepath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("EPERM") || msg.includes("EACCES")) {
        return { error: `Keine Berechtigung zum Loeschen von "${nameOrPath}".` };
      }
      return { error: `Loeschen fehlgeschlagen: ${msg}` };
    }
    return { filename, action: "geloescht" };
  }

  // Soft-Delete: verschieben nach .trash/
  try {
    const trash = trashPath();
    ensureDir(trash);
    let targetName = filename;
    // Bei Namenskollision im Trash: Timestamp anhaengen
    if (fs.existsSync(path.join(trash, targetName))) {
      const base = targetName.replace(/\.md$/i, "");
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      targetName = `${base} ${ts}.md`;
    }
    fs.renameSync(filepath, path.join(trash, targetName));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Verschieben in Papierkorb fehlgeschlagen: ${msg}` };
  }
  return { filename, action: "in Papierkorb verschoben" };
}

async function handleLoeschen(
  args: Record<string, string | number | boolean | undefined>,
): Promise<string> {
  const name = String(args.name ?? "").trim();
  if (!name) return err("Kein Name angegeben");

  const permanent = String(args.permanent ?? "").toLowerCase() === "true";
  const result = deleteNote(name, permanent);

  if ("error" in result) return result.error;

  const detail = result.action === "in Papierkorb verschoben" ? ".trash/" : undefined;
  return ok("note_del", `Notiz ${result.action}`, wikilink(result.filename), detail);
}

// ============================================================
// Modus: frontmatter
// ============================================================

/** Parst YAML-Frontmatter-Block. Simpler Parser — kein YAML-Library-Dep. */
function parseFrontmatter(content: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const match = content.match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/,
  );
  if (!match) return { data: {}, body: content };

  const yamlStr = match[1];
  const body = match[2] ?? "";
  const data: Record<string, unknown> = {};

  const lines = yamlStr.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Block-Array: "tags:\n  - a\n  - b"
    const arrayHeaderMatch = line.match(/^(\w[\w-]*):\s*$/);
    if (arrayHeaderMatch) {
      const key = arrayHeaderMatch[1];
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        items.push(
          lines[i]
            .replace(/^\s+-\s+/, "")
            .trim()
            .replace(/^["']|["']$/g, ""),
        );
        i++;
      }
      data[key] = items;
      continue;
    }
    // Inline-Array: "tags: [a, b]"
    const inlineArrayMatch = line.match(/^(\w[\w-]*):\s*\[(.*)\]$/);
    if (inlineArrayMatch) {
      const key = inlineArrayMatch[1];
      const items = inlineArrayMatch[2]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      data[key] = items;
      i++;
      continue;
    }
    // Key: value
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = kvMatch[2].trim().replace(/^["']|["']$/g, "");
      data[key] = val;
    }
    i++;
  }

  return { data, body };
}

/** Baut Frontmatter + Body wieder zu Markdown zusammen. */
function stringifyFrontmatter(
  data: Record<string, unknown>,
  body: string,
): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${(value as string[]).join(", ")}]`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(body.startsWith("\n") ? body.slice(1) : body);
  return lines.join("\n");
}

/**
 * Setzt, aktualisiert oder loescht ein Frontmatter-Feld.
 * value === null → Feld wird geloescht.
 * Legt Frontmatter-Block an falls die Datei keinen hat.
 * Liefert false wenn die Datei nicht existiert.
 */
function upsertFrontmatterField(
  filepath: string,
  key: string,
  value: unknown,
): boolean {
  const absPath = safePath(filepath);
  if (!absPath || !fs.existsSync(absPath)) return false;
  const content = fs.readFileSync(absPath, "utf-8");
  const { data, body } = parseFrontmatter(content);
  if (value === null) {
    delete data[key];
  } else {
    data[key] = value;
  }
  fs.writeFileSync(absPath, stringifyFrontmatter(data, body), "utf-8");
  return true;
}

async function handleFrontmatter(
  args: Record<string, string | number | boolean | undefined>,
): Promise<string> {
  const pfad = String(args.pfad ?? "").trim();
  const key = String(args.schluessel ?? "").trim();
  const rawVal = args.wert !== undefined ? String(args.wert).trim() : "";

  if (!pfad) return err("Kein Pfad angegeben");
  if (!key) return err("Kein Schluessel angegeben");

  // Leer oder nicht angegeben → Feld loeschen
  if (!rawVal) {
    const success = upsertFrontmatterField(pfad, key, null);
    return success
      ? ok("frontmatter", "Frontmatter-Feld geloescht", wikilink(pfad), key)
      : `Datei nicht gefunden: ${pfad}`;
  }

  // Array-Konvertierung: explizit per Parameter oder bei bekannten Array-Keys
  const KNOWN_ARRAY_KEYS = new Set(["tags", "aliases", "cssclasses", "cssclass"]);
  const forceArray = String(args.als_array ?? "").toLowerCase() === "true";
  let value: unknown = rawVal;
  if ((forceArray || KNOWN_ARRAY_KEYS.has(key)) && rawVal.includes(",")) {
    value = rawVal
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const success = upsertFrontmatterField(pfad, key, value);
  return success
    ? ok("frontmatter", "Frontmatter gesetzt", wikilink(pfad), `${key} = "${rawVal}"`)
    : `Datei nicht gefunden: ${pfad}`;
}

// ============================================================
// Modus: eintrag
// ============================================================

/**
 * Parsed ein optionales Datum-Argument zu einem Date-Objekt.
 * Gibt null zurueck bei ungueltigem Format.
 */
function parseDatum(datum?: string): Date | null {
  if (!datum) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null;
  const d = new Date(datum + "T12:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function appendToDailyNote(
  entry: string,
  section: string,
  targetDate: Date,
): string {
  const fp = dailyNotePath(targetDate);
  if (!fs.existsSync(fp)) createDailyNote(targetDate);

  let content = fs.readFileSync(fp, "utf-8");

  const now = new Date();
  const time = now.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
  const seconds = String(now.getSeconds()).padStart(2, "0");

  const sectionHeader = `## ${section}`;
  // Regex: matcht ## Name nur wenn am Zeilenanfang UND gefolgt von Whitespace oder Zeilenende
  // Verhindert "## Log" → "## Logistik" False-Match
  const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRe = new RegExp(`(^|\\n)## ${escapedSection}\\s*(\\n|$)`, "m");
  const match = sectionRe.exec(content);

  // Timestamp mit Sekunden um doppelte H3 zu vermeiden
  const timeHeader = `### ${time}:${seconds}`;
  const insertion = `\n${timeHeader}\n${entry}\n`;

  if (match) {
    const afterSection = match.index + match[0].length;
    const nextSectionIdx = content.indexOf("\n## ", afterSection);
    if (nextSectionIdx !== -1) {
      content =
        content.slice(0, nextSectionIdx) + insertion + content.slice(nextSectionIdx);
    } else {
      content = content + insertion;
    }
  } else {
    content = content + `\n${sectionHeader}${insertion}`;
  }

  fs.writeFileSync(fp, content, "utf-8");
  const dateStr = formatDate(targetDate);
  return ok("daily", "Eintrag hinzugefuegt", dateStr, `${time} → ${section}`);
}

async function handleEintrag(
  args: Record<string, string | number | boolean | undefined>,
): Promise<string> {
  const text = String(args.text ?? "").trim();
  if (!text) return err("Kein Text angegeben");

  const section = args.abschnitt ? String(args.abschnitt) : "Log";
  const datumStr = args.datum ? String(args.datum).trim() : undefined;
  const targetDate = parseDatum(datumStr);
  if (!targetDate) return err(`Datum muss YYYY-MM-DD sein, bekommen: "${datumStr}"`);

  return appendToDailyNote(text, section, targetDate);
}

// ============================================================
// Dispatcher
// ============================================================

export const handler: ToolHandler = async (args) => {
  const modus = String(args.modus ?? "");

  switch (modus) {
    case "speichern":
      return handleSpeichern(args);
    case "bearbeiten":
      return handleBearbeiten(args);
    case "loeschen":
      return handleLoeschen(args);
    case "frontmatter":
      return handleFrontmatter(args);
    case "eintrag":
      return handleEintrag(args);
    default:
      return err(
        `Unbekannter Modus: "${modus}". Erlaubt: speichern, bearbeiten, loeschen, frontmatter, eintrag`,
      );
  }
};
