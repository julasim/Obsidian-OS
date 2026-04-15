import fs from "fs";
import path from "path";
import { workspacePath, walkMarkdownFiles, safePath } from "./helpers.js";
import { SEARCH_MAX_RESULTS, SEARCH_LINE_MAX } from "../config.js";

export interface SearchResult {
  file: string;
  line: string;
}

export interface SearchOptions {
  limitTo?: string;
  regex?: boolean;
}

export function searchWorkspace(query: string, limitToOrOpts?: string | SearchOptions): SearchResult[] {
  const opts: SearchOptions = typeof limitToOrOpts === "string"
    ? { limitTo: limitToOrOpts }
    : limitToOrOpts ?? {};

  const results: SearchResult[] = [];
  const searchRoot = opts.limitTo ? path.join(workspacePath, opts.limitTo) : workspacePath;

  let matcher: (line: string) => boolean;
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, "i");
    } catch {
      return []; // ungueltige Regex -> leeres Ergebnis
    }
    matcher = (line) => re.test(line);
  } else {
    const lowerQuery = query.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(lowerQuery);
  }

  walkMarkdownFiles(searchRoot, (full) => {
    try {
      const lines = fs.readFileSync(full, "utf-8").split("\n");
      for (const line of lines) {
        if (matcher(line) && line.trim()) {
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
 * Liefert Inhalt der index.md im Vault-Root (falls vorhanden).
 * LLM-Navigationshilfe fuer semantische Anfragen \u2014 der User pflegt diese Datei
 * als Gesamtuebersicht ueber die Vault-Struktur.
 */
export function readIndexMd(): string | null {
  const candidates = ["index.md", "Index.md", "INDEX.md"];
  for (const name of candidates) {
    const abs = safePath(name);
    if (abs && fs.existsSync(abs)) {
      try { return fs.readFileSync(abs, "utf-8"); } catch { /* next */ }
    }
  }
  return null;
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
