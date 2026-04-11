import fs from "fs";
import path from "path";
import { workspacePath, ensureDir, safePath } from "./helpers.js";

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

export interface FolderEntry {
  name: string;
  type: "folder" | "file";
}

export function listFolder(relativePath = ""): FolderEntry[] {
  const folderPath = relativePath ? safePath(relativePath) : workspacePath;
  if (!folderPath || !fs.existsSync(folderPath)) return [];
  try {
    return fs
      .readdirSync(folderPath, { withFileTypes: true })
      .map((e) => ({ name: e.name, type: (e.isDirectory() ? "folder" : "file") as "folder" | "file" }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
  } catch {
    return [];
  }
}
