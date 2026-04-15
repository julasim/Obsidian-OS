import fs from "fs";
import path from "path";
import { workspacePath, ensureDir, safePath, resolveDir } from "./helpers.js";

export function readFile(relativePath: string): string | null {
  const filepath = safePath(relativePath);
  if (!filepath || !fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

export function createFile(relativePath: string, content: string): string {
  const filepath = safePath(relativePath);
  if (!filepath) return "(Pfad ungueltig)";
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, content, "utf-8");
  return filepath;
}

export function moveFile(fromRelative: string, toRelative: string): string | null {
  const src = safePath(fromRelative);
  const dst = safePath(toRelative);
  if (!src || !dst) return null;
  if (!fs.existsSync(src)) return null;
  ensureDir(path.dirname(dst));
  fs.renameSync(src, dst);
  return dst;
}

export interface FolderEntry {
  name: string;
  type: "folder" | "file";
}

export function listFolder(relativePath = ""): FolderEntry[] {
  let folderPath = relativePath ? safePath(relativePath) : workspacePath;
  if (!folderPath) return [];

  // Case-insensitive Fallback fuer Linux-Filesysteme (Daily != daily)
  if (relativePath && !fs.existsSync(folderPath)) {
    const segments = relativePath.split(/[\\/]+/).filter(Boolean);
    let current = workspacePath;
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
      .map((e) => ({ name: e.name, type: (e.isDirectory() ? "folder" : "file") as "folder" | "file" }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
  } catch {
    return [];
  }
}
