/**
 * Shared Vault-Primitives — Filesystem + Path-Helpers.
 * Jedes Tool importiert nur das, was es wirklich braucht.
 */

import fs from "fs";
import path from "path";
import { VAULT_PATH, SKIP_DIRS, LOCALE, PROJECTS_DIR } from "./config.js";

export const vaultPath: string = VAULT_PATH;

/**
 * Loest einen Unterordner case-insensitiv unter einem Parent auf.
 * Liefert absoluten Pfad zum existierenden Ordner (egal in welcher Schreibweise),
 * oder den konfigurierten Pfad als Fallback (fuer Write-Ops, die ihn anlegen).
 * Essentiell auf case-sensitiven Filesystems (Linux/Docker) wo "Daily" != "daily".
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
    /* parent nicht lesbar */
  }
  return direct;
}

/**
 * Projekt-Ordner-Pfad (case-insensitive Projekte/-root).
 *   projectPath()                    -> absolut zum Projekte/
 *   projectPath("WebApp")            -> absolut zum Projekte/WebApp
 *   projectPath("WebApp", "Notizen") -> absolut zum Projekte/WebApp/Notizen
 */
export function projectPath(projectName?: string, ...subPaths: string[]): string {
  const root = resolveDir(vaultPath, PROJECTS_DIR);
  return projectName ? path.join(root, projectName, ...subPaths) : root;
}

/** Timestamp-basierter Dateiname (YYYY-MM-DDTHH-MM-SS) */
export function timestampFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** Standard-Frontmatter mit created + source */
export function frontmatter(source = "extern"): string {
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
  return `---\ncreated: ${date} ${time}\nsource: ${source}\n---\n\n`;
}

/** Ordner anlegen falls noetig (rekursiv) */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Atomarer Write: schreibt in .tmp, dann rename — verhindert Datenverlust
 * bei Crash mid-write.
 */
export function atomicWriteSync(filepath: string, data: string): void {
  const tmp = filepath + ".tmp";
  try {
    fs.writeFileSync(tmp, data, "utf-8");
    fs.renameSync(tmp, filepath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* tmp existiert nicht — OK */
    }
    throw err;
  }
}

/**
 * Sicherer Pfad innerhalb des Vaults — blockiert Traversal und Symlinks.
 * Rueckgabe: absoluter Pfad (auch wenn Ziel noch nicht existiert), oder null
 * wenn der Pfad ausserhalb des Vaults zeigen wuerde oder ein Symlink ist.
 */
export function safePath(relativePath: string): string | null {
  const resolved = path.resolve(vaultPath, relativePath);
  // Traversal-Schutz: Separator-basierter Vergleich verhindert Prefix-Bypass.
  // Ohne Separator wuerde VAULT_PATH=/a/vault faelschlich /a/vault-evil akzeptieren.
  const vaultWithSep = vaultPath.endsWith(path.sep) ? vaultPath : vaultPath + path.sep;
  if (resolved !== vaultPath && !resolved.startsWith(vaultWithSep)) return null;
  try {
    if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
      return null;
    }
  } catch {
    /* nicht existent = OK */
  }
  return resolved;
}

/**
 * Walk alle .md-Dateien unter root, ruft callback fuer jede auf.
 * Callback kann false zurueckgeben, um den Walk abzubrechen.
 */
export function walkMarkdownFiles(
  root: string,
  callback: (filepath: string) => boolean | void,
  limit = Infinity,
): void {
  let count = 0;
  function walk(dir: string): void {
    if (count >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
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

/**
 * Fuzzy-Resolver: findet eine .md-Datei anhand von Name, Pfad oder Wikilink.
 * Sucht zuerst direkten Pfad, dann rekursiv im Vault.
 */
export function resolveNotePath(nameOrPath: string): string | null {
  const clean = nameOrPath.replace(/^\[\[|\]\]$/g, ""); // Wikilink-Klammern weg
  const withExt = clean.endsWith(".md") ? clean : clean + ".md";

  const directPath = path.join(vaultPath, withExt);
  if (fs.existsSync(directPath)) return directPath;

  function searchDir(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = searchDir(full);
        if (found) return found;
      } else if (
        entry.name === withExt ||
        entry.name.toLowerCase() === withExt.toLowerCase()
      ) {
        return full;
      }
    }
    return null;
  }

  return searchDir(vaultPath);
}
