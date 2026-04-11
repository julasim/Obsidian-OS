import fs from "fs";
import path from "path";
import { WORKSPACE_PATH, DAILY_NOTES_DIR, LOCALE, TIMEZONE } from "../config.js";
import { ensureDir } from "./helpers.js";

/** Returns absolute path for a daily note */
export function dailyNotePath(date?: Date): string {
  const d = date ?? new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return path.join(WORKSPACE_PATH, DAILY_NOTES_DIR, `${year}-${month}-${day}.md`);
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLongDate(date: Date): string {
  return date.toLocaleDateString(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIMEZONE,
  });
}

/** Apply simple {{var}} substitution to a template string */
function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

/** Get content of today's (or given date's) daily note, creating if missing */
export function getOrCreateDailyNote(date?: Date): string {
  const fp = dailyNotePath(date);
  if (fs.existsSync(fp)) return fs.readFileSync(fp, "utf-8");
  createDailyNote(date);
  return fs.readFileSync(fp, "utf-8");
}

/** Create a new daily note with Obsidian-compatible frontmatter */
export function createDailyNote(date?: Date): string {
  const d = date ?? new Date();
  const fp = dailyNotePath(d);
  ensureDir(path.dirname(fp));

  // Try to use Templates/Daily.md if available
  const templatePath = path.join(WORKSPACE_PATH, "Templates", "Daily.md");
  if (fs.existsSync(templatePath)) {
    const template = fs.readFileSync(templatePath, "utf-8");
    const vars: Record<string, string> = {
      date: formatDate(d),
      time: d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE }),
      weekday: d.toLocaleDateString(LOCALE, { weekday: "long", timeZone: TIMEZONE }),
      year: String(d.getFullYear()),
      month: String(d.getMonth() + 1).padStart(2, "0"),
      day: String(d.getDate()).padStart(2, "0"),
      title: formatLongDate(d),
    };
    const content = applyVars(template, vars);
    fs.writeFileSync(fp, content, "utf-8");
    return fp;
  }

  // Default hardcoded format
  const content = `---
date: ${formatDate(d)}
tags: [daily]
---

# ${formatLongDate(d)}

## Heute

## Log

`;

  fs.writeFileSync(fp, content, "utf-8");
  return fp;
}

/** Append a timestamped entry under a section */
export function appendToDailyNote(entry: string, section?: string): string {
  if (!fs.existsSync(dailyNotePath())) createDailyNote();

  const fp = dailyNotePath();
  const targetSection = section ?? "Log";
  let content = fs.readFileSync(fp, "utf-8");

  const now = new Date();
  const time = now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });

  const sectionHeader = `## ${targetSection}`;
  const sectionIdx = content.indexOf(sectionHeader);
  const insertion = `\n### ${time}\n${entry}\n`;

  if (sectionIdx !== -1) {
    const afterSection = sectionIdx + sectionHeader.length;
    const nextSectionIdx = content.indexOf("\n## ", afterSection);
    if (nextSectionIdx !== -1) {
      content = content.slice(0, nextSectionIdx) + insertion + content.slice(nextSectionIdx);
    } else {
      content = content + insertion;
    }
  } else {
    content = content + `\n## ${targetSection}${insertion}`;
  }

  fs.writeFileSync(fp, content, "utf-8");
  return `Eintrag hinzugefügt: ${formatDate(now)} ${time}`;
}

/** List daily note filenames, newest first */
export function listDailyNotes(limit?: number): string[] {
  const dir = path.join(WORKSPACE_PATH, DAILY_NOTES_DIR);
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();
    return limit ? files.slice(0, limit) : files.slice(0, 30);
  } catch {
    return [];
  }
}

/** Read a specific daily note by date string YYYY-MM-DD */
export function readDailyNote(dateStr: string): string | null {
  const fp = path.join(WORKSPACE_PATH, DAILY_NOTES_DIR, `${dateStr}.md`);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf-8");
}
