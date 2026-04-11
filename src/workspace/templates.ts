import fs from "fs";
import path from "path";
import { WORKSPACE_PATH, TEMPLATES_DIR, LOCALE, TIMEZONE } from "../config.js";
import { ensureDir } from "./helpers.js";

const templatesRoot = () => path.join(WORKSPACE_PATH, TEMPLATES_DIR);

/** List all template names (without .md) */
export function listTemplates(): string[] {
  const dir = templatesRoot();
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

/** Read a template by name */
export function readTemplate(name: string): string | null {
  const fp = path.join(templatesRoot(), name.endsWith(".md") ? name : `${name}.md`);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf-8");
}

/** Apply variable substitution to template string */
export function applyTemplate(template: string, vars: Record<string, string>): string {
  const now = new Date();
  const builtIn: Record<string, string> = {
    date: now.toISOString().slice(0, 10),
    time: now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE }),
    weekday: now.toLocaleDateString(LOCALE, { weekday: "long", timeZone: TIMEZONE }),
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, "0"),
    day: String(now.getDate()).padStart(2, "0"),
  };
  const allVars = { ...builtIn, ...vars };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => allVars[key] ?? `{{${key}}}`);
}

/** Create a note from a template */
export function createFromTemplate(
  templateName: string,
  targetPath: string,
  extraVars?: Record<string, string>,
): string | null {
  const template = readTemplate(templateName);
  if (!template) return null;

  const absTarget = path.isAbsolute(targetPath)
    ? targetPath
    : path.join(WORKSPACE_PATH, targetPath);

  ensureDir(path.dirname(absTarget));

  const content = applyTemplate(template, extraVars ?? {});
  fs.writeFileSync(absTarget, content, "utf-8");
  return absTarget;
}
