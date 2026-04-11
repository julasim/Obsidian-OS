import fs from "fs";
import path from "path";
import { workspacePath } from "./helpers.js";
import { SKIP_DIRS } from "../config.js";

/** Parse YAML frontmatter block from markdown content */
export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const yamlStr = match[1];
  const body = match[2] ?? "";
  const data: Record<string, unknown> = {};

  const lines = yamlStr.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Array key: "tags:\n  - a\n  - b"
    const arrayHeaderMatch = line.match(/^(\w[\w-]*):\s*$/);
    if (arrayHeaderMatch) {
      const key = arrayHeaderMatch[1];
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""));
        i++;
      }
      data[key] = items;
      continue;
    }
    // Inline array: "tags: [a, b]"
    const inlineArrayMatch = line.match(/^(\w[\w-]*):\s*\[(.*)\]$/);
    if (inlineArrayMatch) {
      const key = inlineArrayMatch[1];
      const items = inlineArrayMatch[2]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      data[key] = items;
      i++;
      continue;
    }
    // Key: value
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const val = kvMatch[2].trim().replace(/^["']|["']$/g, "");
      data[key] = val;
    }
    i++;
  }

  return { data, body };
}

/** Stringify frontmatter data + body back to markdown */
export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${(value as string[]).join(", ")}]`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(body.startsWith("\n") ? body.slice(1) : body);
  return lines.join("\n");
}

/** Update or add a frontmatter field in a file */
export function upsertFrontmatterField(filepath: string, key: string, value: unknown): boolean {
  // Resolve relative to vault if not absolute
  const absPath = path.isAbsolute(filepath)
    ? filepath
    : path.join(workspacePath, filepath);

  if (!fs.existsSync(absPath)) return false;
  const content = fs.readFileSync(absPath, "utf-8");
  const { data, body } = parseFrontmatter(content);
  data[key] = value;
  fs.writeFileSync(absPath, stringifyFrontmatter(data, body), "utf-8");
  return true;
}

/** Get all tags from a file (frontmatter tags + inline #hashtags) */
export function getFileTags(filepath: string): string[] {
  if (!fs.existsSync(filepath)) return [];
  try {
    const content = fs.readFileSync(filepath, "utf-8");
    const { data, body } = parseFrontmatter(content);
    const tags: Set<string> = new Set();

    // Frontmatter tags
    if (Array.isArray(data.tags)) {
      for (const t of data.tags as string[]) tags.add(String(t).toLowerCase());
    } else if (typeof data.tags === "string") {
      tags.add((data.tags as string).toLowerCase());
    }

    // Inline #hashtags in body
    const hashtagMatches = body.matchAll(/#(\w+)/g);
    for (const m of hashtagMatches) tags.add(m[1].toLowerCase());

    return [...tags];
  } catch {
    return [];
  }
}

/** Find all vault files that have a given tag */
export function findByTag(tag: string, subdir?: string): string[] {
  const normalizedTag = tag.toLowerCase().replace(/^#/, "");
  const searchRoot = subdir ? path.join(workspacePath, subdir) : workspacePath;
  const results: string[] = [];

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
        const tags = getFileTags(full);
        if (tags.includes(normalizedTag)) {
          results.push(path.relative(workspacePath, full).replace(/\\/g, "/"));
        }
      }
    }
  }

  walkDir(searchRoot);
  return results;
}
