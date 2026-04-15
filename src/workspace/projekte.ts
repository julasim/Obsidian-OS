import fs from "fs";
import path from "path";
import { workspacePath, projectPath, walkMarkdownFiles } from "./helpers.js";

export interface Projekt {
  name: string;
  fileCount: number;
}

/**
 * Listet alle Projekte (Unterordner direkt unter Projekte/).
 * Keine Metadata-Pflicht — ein Projekt ist einfach ein Ordner.
 */
export function listProjekte(): Projekt[] {
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
    walkMarkdownFiles(abs, () => { count++; });
    projekte.push({ name: entry.name, fileCount: count });
  }
  projekte.sort((a, b) => a.name.localeCompare(b.name));
  return projekte;
}

export function projektExists(name: string): boolean {
  const abs = projectPath(name);
  return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
}

/**
 * Liefert vault-relative Pfade aller Markdown-Dateien innerhalb eines Projekts.
 * null = Projekt existiert nicht.
 */
export function getProjektInhalt(name: string, limit = 200): string[] | null {
  if (!projektExists(name)) return null;
  const abs = projectPath(name);
  const files: string[] = [];
  walkMarkdownFiles(abs, (full) => {
    files.push(path.relative(workspacePath, full).replace(/\\/g, "/"));
    if (files.length >= limit) return false;
  });
  files.sort();
  return files;
}
