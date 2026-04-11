import fs from "fs";
import path from "path";
import { workspacePath } from "./helpers.js";
import { SEARCH_MAX_RESULTS, SEARCH_LINE_MAX, SKIP_DIRS } from "../config.js";

export interface SearchResult {
  file: string;
  line: string;
}

export function searchWorkspace(query: string, limitTo?: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  // Improved: no forced restriction to Projekte/ subdir — search whole vault optionally limited
  const searchRoot = limitTo ? path.join(workspacePath, limitTo) : workspacePath;

  function searchDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    if (results.length >= SEARCH_MAX_RESULTS) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (results.length >= SEARCH_MAX_RESULTS) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        searchDir(full);
      } else if (entry.name.endsWith(".md")) {
        try {
          const lines = fs.readFileSync(full, "utf-8").split("\n");
          for (const line of lines) {
            if (line.toLowerCase().includes(lowerQuery) && line.trim()) {
              results.push({
                file: path.relative(workspacePath, full).replace(/\\/g, "/"),
                line: line.trim().slice(0, SEARCH_LINE_MAX),
              });
              break;
            }
          }
        } catch { /* skip unreadable files */ }
      }
    }
  }

  searchDir(searchRoot);
  return results.slice(0, SEARCH_MAX_RESULTS);
}

/**
 * Findet alle Notizen die auf [[noteName]] verlinken (Backlinks).
 */
export function findBacklinks(noteName: string): SearchResult[] {
  // Strip .md extension if present
  const name = noteName.replace(/\.md$/, "");
  // Matches [[noteName]] or [[noteName|alias]]
  const pattern = new RegExp(`\\[\\[${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\|[^\\]]*)?\\]\\]`, "i");

  const results: SearchResult[] = [];

  function walkDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
      } else if (entry.name.endsWith(".md")) {
        try {
          const content = fs.readFileSync(full, "utf-8");
          const lines = content.split("\n");
          for (const line of lines) {
            if (pattern.test(line)) {
              results.push({
                file: path.relative(workspacePath, full).replace(/\\/g, "/"),
                line: line.trim().slice(0, SEARCH_LINE_MAX),
              });
              break;
            }
          }
        } catch { /* skip */ }
      }
    }
  }

  walkDir(workspacePath);
  return results;
}
