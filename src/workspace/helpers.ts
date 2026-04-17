import fs from "fs";
import path from "path";
import { WORKSPACE_PATH, LOCALE, SKIP_DIRS } from "../config.js";

export const workspacePath = WORKSPACE_PATH;

/**
 * Resolve a subdirectory case-insensitively under a parent.
 * Returns the absolute path to the existing folder (whatever its casing),
 * or the configured path as fallback (for write operations that will create it).
 * Essential on case-sensitive filesystems (Linux/Docker) where "Daily" ≠ "daily".
 */
export function resolveDir(parent: string, name: string): string {
  const direct = path.join(parent, name);
  if (fs.existsSync(direct)) return direct;
  try {
    const entries = fs.readdirSync(parent, { withFileTypes: true });
    const match = entries.find(
      (e) => e.isDirectory() && e.name.toLowerCase() === name.toLowerCase(),
    );
    if (match) return path.join(parent, match.name);
  } catch {
    /* parent not readable */
  }
  return direct; // fallback to configured path (will be created on write)
}

/**
 * Resolve project folder path (case-insensitive Projekte/-root).
 * projectPath()                    → absolute path to Projekte/
 * projectPath("WebApp")            → absolute path to Projekte/WebApp
 * projectPath("WebApp", "Notizen") → absolute path to Projekte/WebApp/Notizen
 */
export function projectPath(projectName?: string, ...subPaths: string[]): string {
  const projectsDir = process.env.PROJECTS_DIR || "Projekte";
  const root = resolveDir(workspacePath, projectsDir);
  return projectName ? path.join(root, projectName, ...subPaths) : root;
}

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

/** Sicherer Pfad innerhalb des Vaults — blockiert Traversal und Symlinks.
 *
 * Bugfix: frueher nutzte der Check `resolved.startsWith(workspacePath)`, was
 * `/vault-backup/secret` akzeptiert haette (kein Trailing-Separator). Jetzt:
 * Boundary via path.sep, und realpath-Check gegen Symlinks auf ALLEN Segmenten.
 */
export function safePath(relativePath: string): string | null {
  if (typeof relativePath !== "string") return null;

  // Absolute Pfade aus Tool-Args sind nie erlaubt (auch `C:\…` auf Windows)
  if (path.isAbsolute(relativePath)) return null;

  const resolved = path.resolve(workspacePath, relativePath);
  const wsWithSep = workspacePath.endsWith(path.sep) ? workspacePath : workspacePath + path.sep;

  // `resolved === workspacePath` ist OK (Vault-Root selbst);
  // sonst muss resolved unter workspacePath + separator liegen.
  if (resolved !== workspacePath && !resolved.startsWith(wsWithSep)) return null;

  try {
    if (fs.existsSync(resolved)) {
      // realpath loest ALLE Symlinks auf (auch in Zwischen-Segmenten).
      // Wenn realpath ausserhalb des Vaults zeigt → Block.
      const real = fs.realpathSync(resolved);
      const realWs = fs.realpathSync(workspacePath);
      const realWsSep = realWs.endsWith(path.sep) ? realWs : realWs + path.sep;
      if (real !== realWs && !real.startsWith(realWsSep)) return null;
    }
  } catch { /* nicht existent = OK fuer Write-Targets */ }
  return resolved;
}

/** Walk all .md files under root, calling callback for each. Return false from callback to stop. */
export function walkMarkdownFiles(
  root: string,
  callback: (filepath: string) => boolean | void,
  limit = Infinity,
): void {
  let count = 0;
  function walk(dir: string): void {
    if (count >= limit) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (count >= limit) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) {
        count++;
        if (callback(full) === false) return;
      }
    }
  }
  walk(root);
}

export function resolveNotePath(nameOrPath: string): string | null {
  if (typeof nameOrPath !== "string" || !nameOrPath.trim()) return null;

  const withExt = nameOrPath.endsWith(".md") ? nameOrPath : nameOrPath + ".md";

  // Direkter Pfad: MUSS durch safePath, sonst erlaubt `path.join` Traversal
  // wie `../../../etc/passwd.md`. safePath blockt das.
  const direct = safePath(withExt);
  if (direct && fs.existsSync(direct)) return direct;

  // Fuzzy-Suche per Dateiname: rekursiv im Vault nach passendem basename.
  // Ignoriert Pfad-Teile des Inputs (nur der letzte Segmenteintrag zaehlt),
  // damit Eingaben wie `Meeting` oder `Daily/Meeting` zum selben File resolven.
  const wantedName = path.basename(withExt).toLowerCase();

  function searchDir(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return null; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = searchDir(full);
        if (found) return found;
      } else if (entry.name.toLowerCase() === wantedName) {
        // Gefundener Pfad nochmal durch safePath (Symlink-Schutz)
        const rel = path.relative(workspacePath, full);
        return safePath(rel);
      }
    }
    return null;
  }

  return searchDir(workspacePath);
}
