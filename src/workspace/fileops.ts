/**
 * Erweiterte Dateioperationen: Edit (Find-Replace), Glob (Dateisuche), Grep (Inhaltssuche)
 */

import fs from "fs";
import path from "path";
import { workspacePath, safePath } from "./helpers.js";
import { MAX_FILE_SCAN, SKIP_DIRS } from "../config.js";

function isBinary(filepath: string): boolean {
  try {
    const stat = fs.statSync(filepath);
    if (stat.size > 1_048_576) return true;
    const buf = Buffer.alloc(512);
    const fd = fs.openSync(filepath, "r");
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function walkDir(dir: string, collected: string[], limit: number): void {
  if (collected.length >= limit) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (collected.length >= limit) return;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, collected, limit);
    else if (entry.isFile()) collected.push(full);
  }
}

export interface EditResult {
  count: number;
  preview: string;
}

export function editFile(
  relativePath: string,
  search: string,
  replace: string,
  options?: { regex?: boolean; all?: boolean },
): EditResult | null {
  const filepath = safePath(relativePath);
  if (!filepath || !fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath, "utf-8");
  const useRegex = options?.regex ?? false;
  const replaceAll = options?.all ?? false;
  const flags = replaceAll ? "g" : "";
  let pattern: RegExp;
  try {
    pattern = useRegex
      ? new RegExp(search, flags)
      : new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  } catch (err) {
    return { count: 0, preview: `Regex-Fehler: ${err}` };
  }
  let count = 0;
  const updated = content.replace(pattern, () => { count++; return replace; });
  if (count === 0) return { count: 0, preview: "" };
  fs.writeFileSync(filepath, updated, "utf-8");
  const idx = updated.indexOf(replace);
  const start = Math.max(0, idx - 30);
  const end = Math.min(updated.length, idx + replace.length + 30);
  const preview = (start > 0 ? "..." : "") + updated.slice(start, end) + (end < updated.length ? "..." : "");
  return { count, preview };
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  const regex = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/<<<GLOBSTAR>>>/g, ".*");
  return new RegExp(`^${regex}$`, "i");
}

export function globFiles(pattern: string, options?: { limit?: number; subdir?: string }): string[] {
  const limit = Math.min(options?.limit ?? 50, 100);
  const root = options?.subdir ? safePath(options.subdir) : workspacePath;
  if (!root || !fs.existsSync(root)) return [];
  const allFiles: string[] = [];
  walkDir(root, allFiles, MAX_FILE_SCAN);
  const regex = globToRegex(pattern);
  const matches: string[] = [];
  for (const filepath of allFiles) {
    if (matches.length >= limit) break;
    const relative = path.relative(workspacePath, filepath).replace(/\\/g, "/");
    if (regex.test(relative)) matches.push(relative);
  }
  return matches;
}

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  totalFiles: number;
  truncated: boolean;
}

export function grepFiles(
  pattern: string,
  options?: { subdir?: string; context?: number; maxMatches?: number; fileGlob?: string },
): GrepResult {
  const maxMatches = Math.min(options?.maxMatches ?? 20, 50);
  const context = options?.context ?? 0;
  const root = options?.subdir ? safePath(options.subdir) : workspacePath;
  if (!root || !fs.existsSync(root)) return { matches: [], totalFiles: 0, truncated: false };
  let regex: RegExp;
  try { regex = new RegExp(pattern, "i"); }
  catch (err) { throw new Error(`Ungueltiger Regex: ${err}`); }
  let fileRegex: RegExp | null = null;
  if (options?.fileGlob) fileRegex = globToRegex(options.fileGlob);
  const allFiles: string[] = [];
  walkDir(root, allFiles, MAX_FILE_SCAN);
  const matches: GrepMatch[] = [];
  const filesWithMatches = new Set<string>();
  let truncated = false;
  for (const filepath of allFiles) {
    if (matches.length >= maxMatches) { truncated = true; break; }
    const relative = path.relative(workspacePath, filepath).replace(/\\/g, "/");
    if (fileRegex && !fileRegex.test(relative)) continue;
    if (isBinary(filepath)) continue;
    let content: string;
    try { content = fs.readFileSync(filepath, "utf-8"); }
    catch { continue; }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxMatches) { truncated = true; break; }
      if (!regex.test(lines[i])) continue;
      filesWithMatches.add(relative);
      if (context > 0) {
        const start = Math.max(0, i - context);
        for (let c = start; c < i; c++) {
          matches.push({ file: relative, line: c + 1, text: `  ${lines[c].slice(0, 150)}` });
        }
      }
      matches.push({ file: relative, line: i + 1, text: lines[i].slice(0, 150) });
      if (context > 0) {
        const end = Math.min(lines.length - 1, i + context);
        for (let c = i + 1; c <= end; c++) {
          matches.push({ file: relative, line: c + 1, text: `  ${lines[c].slice(0, 150)}` });
        }
      }
    }
  }
  return { matches, totalFiles: filesWithMatches.size, truncated };
}
