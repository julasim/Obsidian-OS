import fs from "fs";
import path from "path";
import { workspacePath, walkMarkdownFiles } from "./helpers.js";
import { SEARCH_MAX_RESULTS, SEARCH_LINE_MAX } from "../config.js";

export interface SearchResult {
  file: string;
  line: string;
}

export function searchWorkspace(query: string, limitTo?: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  const searchRoot = limitTo ? path.join(workspacePath, limitTo) : workspacePath;

  walkMarkdownFiles(searchRoot, (full) => {
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
    if (results.length >= SEARCH_MAX_RESULTS) return false;
  });

  return results;
}

/**
 * Findet alle Notizen die auf [[noteName]] verlinken (Backlinks).
 */
export function findBacklinks(noteName: string): SearchResult[] {
  const name = noteName.replace(/\.md$/, "");
  const pattern = new RegExp(`\\[\\[${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\|[^\\]]*)?\\]\\]`, "i");
  const results: SearchResult[] = [];

  walkMarkdownFiles(workspacePath, (full) => {
    try {
      const lines = fs.readFileSync(full, "utf-8").split("\n");
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
  });

  return results;
}
