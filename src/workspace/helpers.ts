import fs from "fs";
import path from "path";
import { WORKSPACE_PATH, WORKSPACE_INBOX, LOCALE } from "../config.js";

export const workspacePath = WORKSPACE_PATH;

export function timestampFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function frontmatter(source = "telegram"): string {
  const now = new Date();
  const date = now.toLocaleDateString(LOCALE, { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  return `---\ncreated: ${date} ${time}\nsource: ${source}\n---\n\n`;
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Atomic write: schreibt in .tmp, dann rename — verhindert Datenverlust bei Crash mid-write */
export function atomicWriteSync(filepath: string, data: string): void {
  const tmp = filepath + ".tmp";
  try {
    fs.writeFileSync(tmp, data, "utf-8");
    fs.renameSync(tmp, filepath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* tmp existiert nicht — OK */ }
    throw err;
  }
}

/** Sicherer Pfad innerhalb des Vaults — blockiert Traversal und Symlinks */
export function safePath(relativePath: string): string | null {
  const resolved = path.resolve(workspacePath, relativePath);
  if (!resolved.startsWith(workspacePath)) return null;
  try {
    if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) return null;
  } catch { /* nicht existent = OK */ }
  return resolved;
}

export function resolveNotePath(nameOrPath: string): string | null {
  const withExt = nameOrPath.endsWith(".md") ? nameOrPath : nameOrPath + ".md";

  for (const candidate of [
    path.join(workspacePath, withExt),
    path.join(workspacePath, WORKSPACE_INBOX, withExt),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const SKIP = new Set([".obsidian", ".git", ".trash", "node_modules", ".DS_Store"]);
  function searchDir(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return null; }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = searchDir(full);
        if (found) return found;
      } else if (entry.name === withExt || entry.name.includes(nameOrPath)) {
        return full;
      }
    }
    return null;
  }

  return searchDir(workspacePath);
}
