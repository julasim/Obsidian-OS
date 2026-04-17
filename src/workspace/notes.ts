import fs from "fs";
import path from "path";
import { LOCALE } from "../config.js";
import { workspacePath, timestampFilename, ensureDir, resolveNotePath, atomicWriteSync, resolveDir, safePath, projectPath } from "./helpers.js";

// Default-Fallback für Inbox — Struktur wird primär via CLAUDE.md gesteuert.
const INBOX_DIR = process.env.INBOX_DIR || "Inbox";
const PROJECT_NOTES_SUBDIR = process.env.PROJECT_NOTES_SUBDIR || "Notizen";

/** Sanitize title for safe, wikilink-friendly filenames */
function titleToFilename(title: string): string {
  return title
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")  // Obsidian-unsafe chars
    .replace(/\s+/g, " ")                  // normalize whitespace
    .trim()
    .slice(0, 120);                        // reasonable length limit
}

export interface SaveNoteOptions {
  project?: string;
  title?: string;
  tags?: string[];
  ordner?: string; // explicit relative folder path — overrides project/default
}

export function saveNote(content: string, opts: SaveNoteOptions = {}): string {
  let folder: string;
  if (opts.ordner) {
    // Explicit folder path (safePath blocks traversal) — Bot entscheidet via CLAUDE.md
    const resolved = safePath(opts.ordner);
    folder = resolved ?? resolveDir(workspacePath, INBOX_DIR);
  } else if (opts.project) {
    folder = projectPath(opts.project, PROJECT_NOTES_SUBDIR);
  } else {
    folder = resolveDir(workspacePath, INBOX_DIR);
  }
  const title = opts.title;
  const tags = opts.tags;

  ensureDir(folder);

  // Title-based filename for wikilink-friendly names; timestamp fallback
  const baseName = title ? titleToFilename(title) : timestampFilename();
  let filename = baseName + ".md";

  // Avoid overwriting: append timestamp suffix if file already exists
  if (fs.existsSync(path.join(folder, filename))) {
    filename = `${baseName} ${timestampFilename()}.md`;
  }

  const filepath = path.join(folder, filename);

  // Build frontmatter
  const now = new Date();
  const date = now.toLocaleDateString(LOCALE, { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

  let fm = `---\ncreated: ${date} ${time}\nsource: telegram\n`;
  if (title) fm += `title: ${title}\n`;
  if (tags && tags.length > 0) fm += `tags: [${tags.join(", ")}]\n`;
  fm += `---\n\n`;

  atomicWriteSync(filepath, fm + content + "\n");
  return filepath;
}

export function listNotes(limit = 10): string[] {
  const inboxPath = resolveDir(workspacePath, INBOX_DIR);
  if (!fs.existsSync(inboxPath)) return [];
  try {
    return fs
      .readdirSync(inboxPath)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => f.replace(".md", ""));
  } catch {
    return [];
  }
}

export function readNote(nameOrPath: string): string | null {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return null;
  return fs.readFileSync(filepath, "utf-8");
}

export function appendToNote(nameOrPath: string, content: string): boolean {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return false;
  const now = new Date();
  const time = now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  // Atomic: lesen + neu schreiben. appendFileSync ist nicht atomar — wenn
  // OneDrive-Sync mitten im Append feuert, kann es zu Duplikaten oder
  // Mixed-State-Lesungen kommen.
  const existing = fs.readFileSync(filepath, "utf-8");
  const appended = existing + `\n**Nachtrag ${time}:** ${content}\n`;
  atomicWriteSync(filepath, appended);
  return true;
}

export function updateNote(nameOrPath: string, content: string): boolean {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return false;
  atomicWriteSync(filepath, content);
  return true;
}

export function deleteNote(nameOrPath: string): string | null {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return null;
  const filename = path.basename(filepath);
  try { fs.unlinkSync(filepath); } catch { return null; }
  return filename;
}
