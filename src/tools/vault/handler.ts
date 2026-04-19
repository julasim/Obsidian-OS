import fs from "fs";
import path from "path";
import {
  vaultPath,
  safePath,
  resolveNotePath,
  resolveDir,
  walkMarkdownFiles,
  projectPath,
} from "../_lib/vault.js";
import {
  SEARCH_MAX_RESULTS,
  SEARCH_LINE_MAX,
  MAX_FILE_SCAN,
  TOOL_OUTPUT_MAX_CHARS,
  SKIP_DIRS,
} from "../_lib/config.js";
import { EMOJI, list, err, safeHandler } from "../_lib/format.js";
import {
  getOrCreateDailyNote,
  readDailyNote,
  listDailyNotes,
} from "../_lib/daily.js";
import {
  buildLookupMap,
  readHotCache,
  readGlossary,
  parseTableEntries,
  readPerson,
  readProject,
} from "../_lib/knowledge.js";
import type { ToolHandler, FolderEntry } from "../_lib/types.js";

// ============================================================
// Modus: lesen (ex notiz_lesen)
// ============================================================

function readFileFromVault(relativePath: string): string | null {
  const filepath = safePath(relativePath);
  if (!filepath || !fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

function readNote(nameOrPath: string): string | null {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return null;
  return fs.readFileSync(filepath, "utf-8");
}

/**
 * Extrahiert den YAML-Frontmatter-Block (ohne Body).
 * Gibt null zurueck wenn kein Frontmatter vorhanden.
 */
function extractFrontmatter(content: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[0] : null;
}

async function handleLesen(args: Record<string, unknown>): Promise<string> {
  const name = String(args.name ?? "").trim();
  if (!name) return err("Kein Name angegeben");

  const content = readNote(name) ?? readFileFromVault(name);
  if (!content) return `Datei "${name}" nicht gefunden.`;

  // Nur Frontmatter
  const nurFm = String(args.nur_frontmatter ?? "").toLowerCase() === "true";
  if (nurFm) {
    const fm = extractFrontmatter(content);
    return fm ?? `Kein Frontmatter in "${name}" vorhanden.`;
  }

  // Limit (erste N Zeilen)
  if (args.limit !== undefined) {
    const limit = Math.max(1, Number(args.limit));
    const lines = content.split("\n");
    if (lines.length <= limit) return content;
    const truncated = lines.slice(0, limit).join("\n");
    return `${truncated}\n\n[... ${lines.length - limit} weitere Zeilen, ${lines.length} gesamt]`;
  }

  return content;
}

// ============================================================
// Modus: suchen (ex vault_suchen)
// ============================================================

// --- Text Search ---

interface MatchLine {
  lineNum: number;
  text: string;
}

interface FileSearchResult {
  file: string;      // vault-relativ
  matches: MatchLine[];
  matchCount: number;
  mtime: number;      // letzte Aenderung (ms seit Epoch)
}

/**
 * Prueft ob ein Regex-Pattern potentiell gefaehrlich ist (ReDoS).
 */
function isUnsafeRegex(pattern: string): boolean {
  if (/(\(.+[+*]\))[+*]/.test(pattern)) return true;
  if (/\([^)]*\|[^)]*\)[+*]{1,2}/.test(pattern) && pattern.length > 50) return true;
  if (pattern.length > 200) return true;
  return false;
}

/** Kontext-Zeilen um einen Treffer extrahieren (±contextLines). */
function extractContext(
  lines: string[],
  matchIdx: number,
  contextLines: number,
): string {
  const start = Math.max(0, matchIdx - contextLines);
  const end = Math.min(lines.length - 1, matchIdx + contextLines);
  const contextParts: string[] = [];
  for (let i = start; i <= end; i++) {
    const prefix = i === matchIdx ? "▸ " : "  ";
    contextParts.push(`${prefix}${lines[i].trim()}`);
  }
  return contextParts.join("\n");
}

function searchWorkspace(
  query: string,
  opts: {
    limitTo?: string;
    regex?: boolean;
    maxTrefferProDatei?: number;
    kontext?: number;
    aenderungVon?: string;
    aenderungBis?: string;
    sortierung?: string;
  } = {},
): FileSearchResult[] | string {
  const results: FileSearchResult[] = [];
  const searchRoot = opts.limitTo ? path.join(vaultPath, opts.limitTo) : vaultPath;
  const maxPerFile = opts.maxTrefferProDatei ?? 3;
  const contextLines = opts.kontext ?? 1;

  // Matcher aufbauen
  let matcher: (line: string) => boolean;
  if (opts.regex) {
    if (isUnsafeRegex(query)) {
      return "Fehler: Regex-Pattern ist zu komplex oder potentiell unsicher.";
    }
    let re: RegExp;
    try {
      re = new RegExp(query, "i");
    } catch (e) {
      return `Fehler: Ungueltiges Regex-Pattern: ${e instanceof Error ? e.message : String(e)}.`;
    }
    matcher = (line) => re.test(line);
  } else {
    const lowerQuery = query.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(lowerQuery);
  }

  // Datums-Filter vorbereiten
  let mtimeMin = 0;
  let mtimeMax = Infinity;
  if (opts.aenderungVon) {
    mtimeMin = new Date(opts.aenderungVon + "T00:00:00").getTime();
  }
  if (opts.aenderungBis) {
    mtimeMax = new Date(opts.aenderungBis + "T23:59:59").getTime();
  }

  walkMarkdownFiles(searchRoot, (full) => {
    try {
      // Datum filtern bevor Datei gelesen wird (schneller)
      if (mtimeMin > 0 || mtimeMax < Infinity) {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < mtimeMin || stat.mtimeMs > mtimeMax) return;
      }

      const content = fs.readFileSync(full, "utf-8");
      const lines = content.split("\n");
      const matches: MatchLine[] = [];
      let totalCount = 0;

      for (let i = 0; i < lines.length; i++) {
        if (matcher(lines[i]) && lines[i].trim()) {
          totalCount++;
          if (matches.length < maxPerFile) {
            matches.push({
              lineNum: i + 1,
              text: contextLines > 0
                ? extractContext(lines, i, contextLines)
                : lines[i].trim().slice(0, SEARCH_LINE_MAX),
            });
          }
        }
      }

      if (totalCount > 0) {
        const rel = path.relative(vaultPath, full).replace(/\\/g, "/");
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch { /* ok */ }

        results.push({
          file: rel,
          matches,
          matchCount: totalCount,
          mtime,
        });
      }
    } catch {
      /* skip unlesbare Dateien */
    }
    if (results.length >= SEARCH_MAX_RESULTS) return false;
  });

  // Sortierung
  const sortierung = opts.sortierung ?? "relevanz";
  if (sortierung === "datum") {
    results.sort((a, b) => b.mtime - a.mtime);
  } else {
    // Default: relevanz (meiste Treffer zuerst)
    results.sort((a, b) => b.matchCount - a.matchCount);
  }

  return results;
}

// --- Glob File Search ---

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  const regex = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/<<<GLOBSTAR>>>/g, ".*");
  return new RegExp(`^${regex}$`, "i");
}

function walkAllFiles(dir: string, collected: string[], limit: number): void {
  if (collected.length >= limit) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (collected.length >= limit) return;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAllFiles(full, collected, limit);
    else if (entry.isFile()) collected.push(full);
  }
}

function globFiles(
  pattern: string,
  opts?: { limit?: number; subdir?: string },
): string[] {
  const limit = Math.min(opts?.limit ?? 50, 100);
  const root = opts?.subdir ? safePath(opts.subdir) : vaultPath;
  if (!root || !fs.existsSync(root)) return [];
  const allFiles: string[] = [];
  walkAllFiles(root, allFiles, MAX_FILE_SCAN);
  const regex = globToRegex(pattern);
  const matches: string[] = [];
  for (const filepath of allFiles) {
    if (matches.length >= limit) break;
    const relative = path.relative(vaultPath, filepath).replace(/\\/g, "/");
    if (regex.test(relative)) matches.push(relative);
  }
  return matches;
}

// --- Folder Listing ---

function listFolder(relativePath = ""): FolderEntry[] {
  let folderPath = relativePath ? safePath(relativePath) : vaultPath;
  if (!folderPath) return [];
  if (relativePath && !fs.existsSync(folderPath)) {
    const segments = relativePath.split(/[\\/]+/).filter(Boolean);
    let current = vaultPath;
    for (const seg of segments) {
      const next = resolveDir(current, seg);
      if (!fs.existsSync(next)) return [];
      current = next;
    }
    folderPath = current;
  }
  if (!fs.existsSync(folderPath)) return [];
  try {
    return fs
      .readdirSync(folderPath, { withFileTypes: true })
      .map(
        (e) =>
          ({
            name: e.name,
            type: (e.isDirectory() ? "folder" : "file") as "folder" | "file",
          }) satisfies FolderEntry,
      )
      .sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1,
      );
  } catch {
    return [];
  }
}

// --- Format ---

function formatTextResults(
  results: FileSearchResult[],
  query: string,
  regexHint: string,
): string {
  if (results.length === 0) {
    return `Keine Treffer fuer "${query}"${regexHint}.`;
  }

  const totalMatches = results.reduce((sum, r) => sum + r.matchCount, 0);
  const header = `${totalMatches} Treffer in ${results.length} Datei${results.length === 1 ? "" : "en"} fuer "${query}"${regexHint}:`;

  const fileBlocks = results.map((r) => {
    const countHint = r.matchCount > r.matches.length
      ? ` (${r.matchCount} Treffer, ${r.matches.length} gezeigt)`
      : r.matchCount > 1
        ? ` (${r.matchCount} Treffer)`
        : "";
    const matchLines = r.matches.map(
      (m) => `   L${m.lineNum}: ${m.text}`,
    ).join("\n");
    return `${EMOJI.file} ${r.file}${countHint}\n${matchLines}`;
  });

  const raw = `${header}\n\n${fileBlocks.join("\n\n")}`;
  return raw.length > TOOL_OUTPUT_MAX_CHARS
    ? raw.slice(0, TOOL_OUTPUT_MAX_CHARS) + "\n\n[... gekuerzt]"
    : raw;
}

async function handleSuchen(args: Record<string, unknown>): Promise<string> {
  const abfrage = String(args.abfrage ?? "").trim();
  if (!abfrage) return err("Keine Suchabfrage angegeben");
  const suchModus = String(args.such_modus ?? "text");
  const ordner = args.ordner ? String(args.ordner) : undefined;
  const regex =
    args.regex !== undefined && String(args.regex).toLowerCase() === "true";

  // ---- Sub-Modus: ordner ----
  if (suchModus === "ordner") {
    const entries = listFolder(abfrage);
    if (!entries.length) return `Ordner "${abfrage}" ist leer oder existiert nicht.`;
    const lines = entries.map(
      (e) => `${e.type === "folder" ? EMOJI.folder : EMOJI.file} ${e.name}`,
    );
    return list(entries.length, "Eintrag", "Eintraege", lines, ` in ${abfrage}/`);
  }

  // ---- Sub-Modus: dateien ----
  if (suchModus === "dateien") {
    const files = globFiles(abfrage, { subdir: ordner });
    const lines = files.map((f) => `${EMOJI.file} ${f}`);
    return list(files.length, "Datei", "Dateien", lines, ` fuer "${abfrage}"`);
  }

  // ---- Sub-Modus: text (Default) ----
  const maxTreffer = args.max_treffer !== undefined
    ? Math.max(1, Math.min(10, Number(args.max_treffer)))
    : 3;
  const kontext = args.kontext !== undefined
    ? Math.max(0, Math.min(5, Number(args.kontext)))
    : 1;
  const sortierung = String(args.sortierung ?? "relevanz");
  const aenderungVon = args.aenderung_von ? String(args.aenderung_von).trim() : undefined;
  const aenderungBis = args.aenderung_bis ? String(args.aenderung_bis).trim() : undefined;

  if (aenderungVon && !/^\d{4}-\d{2}-\d{2}$/.test(aenderungVon)) {
    return err(`'aenderung_von' muss YYYY-MM-DD sein, bekommen: "${aenderungVon}"`);
  }
  if (aenderungBis && !/^\d{4}-\d{2}-\d{2}$/.test(aenderungBis)) {
    return err(`'aenderung_bis' muss YYYY-MM-DD sein, bekommen: "${aenderungBis}"`);
  }

  const results = searchWorkspace(abfrage, {
    limitTo: ordner,
    regex,
    maxTrefferProDatei: maxTreffer,
    kontext,
    aenderungVon,
    aenderungBis,
    sortierung,
  });

  if (typeof results === "string") return results;

  const regexHint = regex ? " (Regex)" : "";
  return formatTextResults(results, abfrage, regexHint);
}

// ============================================================
// Modus: navigation (ex vault_navigation)
// ============================================================

function readIndexMd(): string | null {
  const candidates = ["index.md", "Index.md", "INDEX.md"];
  for (const name of candidates) {
    const abs = safePath(name);
    if (abs && fs.existsSync(abs)) {
      try {
        return fs.readFileSync(abs, "utf-8");
      } catch {
        /* next */
      }
    }
  }
  return null;
}

function listRootFolders(): string[] {
  if (!fs.existsSync(vaultPath)) return [];
  try {
    return fs
      .readdirSync(vaultPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function handleNavigation(): Promise<string> {
  const index = readIndexMd();
  const folders = listRootFolders();

  const folderBlock = folders.length
    ? `\n\n## Top-Level-Ordner\n${folders.map((f) => `${EMOJI.folder} ${f}`).join("\n")}`
    : "\n\n## Top-Level-Ordner\n(keine)";

  if (!index) {
    return `Keine index.md im Vault-Root gefunden. Nutze vault mit modus='suchen', such_modus='ordner' fuer Struktur-Erkundung.${folderBlock}`;
  }

  const header = "## index.md (Vault-Navigation)\n";
  const body =
    index.length > TOOL_OUTPUT_MAX_CHARS
      ? index.slice(0, TOOL_OUTPUT_MAX_CHARS) + "\n[... gekuerzt]"
      : index;

  return header + body + folderBlock;
}

// ============================================================
// Modus: projekte (ex projekte_auflisten)
// ============================================================

interface Projekt {
  name: string;
  fileCount: number;
}

function listProjekte(): Projekt[] {
  const root = projectPath();
  if (!fs.existsSync(root)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const projekte: Projekt[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(root, entry.name);
    let count = 0;
    walkMarkdownFiles(abs, () => {
      count++;
    });
    projekte.push({ name: entry.name, fileCount: count });
  }
  projekte.sort((a, b) => a.name.localeCompare(b.name));
  return projekte;
}

async function handleProjekte(): Promise<string> {
  const projekte = listProjekte();

  const lines = projekte.map(
    (p) => `${EMOJI.project} ${p.name} (${p.fileCount} Datei${p.fileCount === 1 ? "" : "en"})`,
  );
  return list(projekte.length, "Projekt", "Projekte", lines);
}

// ============================================================
// Modus: projekt_inhalt (ex projekt_inhalt)
// ============================================================

function projektExists(name: string): boolean {
  const abs = projectPath(name);
  return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
}

function getProjektInhalt(name: string, limit = 200): string[] | null {
  if (!projektExists(name)) return null;
  const abs = projectPath(name);
  const files: string[] = [];
  walkMarkdownFiles(abs, (full) => {
    files.push(path.relative(vaultPath, full).replace(/\\/g, "/"));
    if (files.length >= limit) return false;
  });
  files.sort();
  return files;
}

async function handleProjektInhalt(args: Record<string, unknown>): Promise<string> {
  const projekt = String(args.projekt ?? "").trim();
  if (!projekt) return err("Kein Projektname angegeben");
  const limit =
    args.limit !== undefined ? Math.max(1, Number(args.limit)) : 100;

  const files = getProjektInhalt(projekt, limit);
  if (files === null) return `Projekt "${projekt}" existiert nicht.`;

  const lines = files.map((f) => `${EMOJI.file} ${f}`);
  return list(files.length, "Datei", "Dateien", lines, ` in "${projekt}"`);
}

// ============================================================
// Modus: daily (ex daily_notes)
// ============================================================

/**
 * Extrahiert einen H2-Abschnitt aus Markdown-Content.
 * Gibt den Inhalt zwischen `## <name>` und dem naechsten `## ` (oder EOF) zurueck.
 * Gibt null zurueck wenn der Abschnitt nicht existiert.
 */
function extractSection(content: string, sectionName: string): string | null {
  // Regex matcht "## Name" nur wenn es am Zeilenanfang steht und danach
  // Whitespace oder Zeilenende folgt — verhindert "## Log" → "## Changelog"
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(`(^|\\n)## ${escapedName}\\s*\\n`, "m");
  const match = headerRe.exec(content);
  if (!match) return null;

  const headerStart = match.index + (match[1] === "\n" ? 1 : 0);
  const afterMatch = match.index + match[0].length;
  const nextSection = content.indexOf("\n## ", afterMatch);
  const body = nextSection !== -1
    ? content.slice(headerStart, nextSection)
    : content.slice(headerStart);

  return body.trim();
}

async function handleDaily(args: Record<string, unknown>): Promise<string> {
  const dailyModus = String(args.daily_modus ?? "lesen");

  // ---- Sub-Modus: auflisten ----
  if (dailyModus === "auflisten") {
    const limit =
      args.limit !== undefined ? Math.max(1, Number(args.limit)) : 30;
    const files = listDailyNotes(limit);
    const lines = files.map((f) => `${EMOJI.daily} ${f.replace(/\.md$/, "")}`);
    return list(files.length, "Daily Note", "Daily Notes", lines);
  }

  // ---- Sub-Modus: lesen (Default) ----
  let content: string | null;
  if (args.datum) {
    const dateStr = String(args.datum).trim();
    content = readDailyNote(dateStr);
    if (!content) {
      const recent = listDailyNotes(5);
      const hint = recent.length
        ? `\nVorhandene: ${recent.map((f) => `${EMOJI.daily} ${f.replace(/\.md$/, "")}`).join(", ")}`
        : "";
      return `Kein Daily Note fuer ${dateStr}.${hint}`;
    }
  } else {
    content = getOrCreateDailyNote();
  }

  // Abschnitt-Filter
  if (args.abschnitt) {
    const section = extractSection(content, String(args.abschnitt));
    if (!section) {
      return `Abschnitt "${args.abschnitt}" nicht gefunden in der Daily Note.`;
    }
    return section;
  }

  return content;
}

// ============================================================
// Modus: dekodieren
// ============================================================

async function handleDekodieren(args: Record<string, unknown>): Promise<string> {
  const text = String(args.text ?? "").trim();
  if (!text) return err("Kein Text zum Dekodieren angegeben");

  const lookupMap = buildLookupMap();
  if (lookupMap.size === 0) {
    return "Keine bekannten Begriffe im Text gefunden. (Knowledge-System ist leer)";
  }

  // Woerter im Text extrahieren — wir pruefen jedes Wort einzeln
  // Tokenisierung: Woerter durch Whitespace und Satzzeichen trennen,
  // aber die Originalposition merken fuer die Ersetzung
  const wordPattern = /[A-Za-z\u00c0-\u024f0-9_-]+/g;
  let match: RegExpExecArray | null;

  interface Replacement {
    start: number;
    end: number;
    original: string;
    meaning: string;
    source: string;
  }

  const replacements: Replacement[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>(); // Duplikat-Vermeidung in der Aufgeloest-Liste

  while ((match = wordPattern.exec(text)) !== null) {
    const word = match[0];
    const lower = word.toLowerCase();

    if (seen.has(lower)) {
      // Bereits verarbeitet — trotzdem im Text ersetzen wenn bekannt
      const existing = replacements.find((r) => r.original.toLowerCase() === lower);
      if (existing) {
        replacements.push({
          start: match.index,
          end: match.index + word.length,
          original: word,
          meaning: existing.meaning,
          source: existing.source,
        });
      }
      continue;
    }

    seen.add(lower);

    const meaning = lookupMap.get(lower);
    if (meaning) {
      replacements.push({
        start: match.index,
        end: match.index + word.length,
        original: word,
        meaning,
        source: guessSource(lower, lookupMap),
      });
    }
  }

  // Nichts gefunden
  if (replacements.length === 0) {
    return "Keine bekannten Begriffe im Text gefunden.";
  }

  // Dekodierten Text aufbauen (von hinten nach vorne ersetzen, damit Indizes stimmen)
  let decoded = text;
  const sortedReplacements = [...replacements].sort((a, b) => b.start - a.start);
  for (const r of sortedReplacements) {
    decoded = decoded.slice(0, r.start) + r.meaning + decoded.slice(r.end);
  }

  // Aufgeloest-Liste (nur unique, in Reihenfolge des Auftretens)
  const seenInList = new Set<string>();
  const aufgeloest: string[] = [];
  for (const r of replacements) {
    const key = r.original.toLowerCase();
    if (seenInList.has(key)) continue;
    seenInList.add(key);
    aufgeloest.push(`- ${r.original} \u2192 ${r.meaning} [${r.source}]`);
  }

  return `${decoded}\n\nAufgeloest:\n${aufgeloest.join("\n")}`;
}

/**
 * Ermittelt die Quelle eines Begriffs (hot_cache, glossary, people, projects).
 * Prueft Hot Cache und Glossar separat fuer korrekte Quellenzuordnung.
 */
function guessSource(lower: string, _fullMap: Map<string, string>): string {
  // Wir muessen die Quellen einzeln pruefen, da buildLookupMap() sie zusammenfuehrt
  const hotCache = readHotCache();
  if (hotCache) {
    const hotMap = parseTableEntries(hotCache);
    if (hotMap.has(lower)) return "hot_cache";
  }

  const glossary = readGlossary();
  if (glossary) {
    const glossMap = parseTableEntries(glossary);
    if (glossMap.has(lower)) return "glossary";
  }

  const personContent = readPerson(lower);
  if (personContent) return "people";

  const projectContent = readProject(lower);
  if (projectContent) return "projects";

  return "knowledge";
}

// ============================================================
// Dispatcher
// ============================================================

export const handler: ToolHandler = safeHandler(async (args) => {
  const modus = String(args.modus ?? "");

  switch (modus) {
    case "lesen":          return handleLesen(args);
    case "suchen":         return handleSuchen(args);
    case "navigation":     return handleNavigation();
    case "projekte":       return handleProjekte();
    case "projekt_inhalt": return handleProjektInhalt(args);
    case "daily":          return handleDaily(args);
    case "dekodieren":     return handleDekodieren(args);
    default:
      return err(
        `Unbekannter Modus: "${modus}". Erlaubt: lesen, suchen, navigation, projekte, projekt_inhalt, daily, dekodieren`,
      );
  }
});
