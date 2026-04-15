import fs from "fs";
import path from "path";
import { workspacePath, walkMarkdownFiles, safePath, ensureDir } from "./helpers.js";

export interface OpenTask {
  file: string;       // Vault-relativer Pfad
  line: number;       // 1-basiert
  text: string;       // Aufgabentext ohne Checkbox-Syntax
  datum?: string;     // YYYY-MM-DD falls vorhanden
}

const OPEN_CHECKBOX = /^\s*[-*+]\s*\[\s\]\s*(.+?)\s*$/;
const DUE_DATE = /\s*\u{1F4C5}\s*(\d{4}-\d{2}-\d{2})/u; // 📅 YYYY-MM-DD

const DEFAULT_TASK_FILE = process.env.TASKS_FILE || "Aufgaben.md";

/**
 * Haengt eine Aufgabe als Obsidian-Checkbox an eine Datei an.
 * Ohne `datei` landet sie in Aufgaben.md im Vault-Root (Datei wird bei Bedarf angelegt).
 * Rueckgabe: absoluter Pfad der bearbeiteten Datei, oder null bei ungueltigem Pfad.
 */
export function addTask(text: string, datum?: string, datei?: string): string | null {
  const clean = text.trim();
  if (!clean) return null;

  const target = datei ?? DEFAULT_TASK_FILE;
  const withExt = target.endsWith(".md") ? target : target + ".md";
  const abs = safePath(withExt);
  if (!abs) return null;

  ensureDir(path.dirname(abs));

  const datumStr = datum ? ` \u{1F4C5} ${datum}` : "";
  const line = `- [ ] ${clean}${datumStr}\n`;

  if (!fs.existsSync(abs)) {
    // Neue Datei: minimaler Header
    const header = target === DEFAULT_TASK_FILE ? "# Aufgaben\n\n" : "";
    fs.writeFileSync(abs, header + line, "utf-8");
  } else {
    const existing = fs.readFileSync(abs, "utf-8");
    const prefix = existing.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(abs, prefix + line, "utf-8");
  }

  return abs;
}

/**
 * Listet alle offenen Checkboxen `- [ ]` aus allen Markdown-Dateien im Vault.
 * Erledigte (`- [x]`) werden ignoriert. Skip-Dirs (.obsidian, .git, ...) ebenso.
 */
export function listOpenTasks(limit = 200): OpenTask[] {
  const results: OpenTask[] = [];

  walkMarkdownFiles(workspacePath, (full) => {
    try {
      const content = fs.readFileSync(full, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(OPEN_CHECKBOX);
        if (!match) continue;

        let text = match[1];
        let datum: string | undefined;
        const dueMatch = text.match(DUE_DATE);
        if (dueMatch) {
          datum = dueMatch[1];
          text = text.replace(DUE_DATE, "").trim();
        }

        results.push({
          file: path.relative(workspacePath, full).replace(/\\/g, "/"),
          line: i + 1,
          text,
          datum,
        });

        if (results.length >= limit) return false;
      }
    } catch {
      /* unlesbare Datei ueberspringen */
    }
  });

  // Sortierung: Mit Datum zuerst (aufsteigend), dann undatierte
  results.sort((a, b) => {
    if (a.datum && b.datum) return a.datum.localeCompare(b.datum);
    if (a.datum) return -1;
    if (b.datum) return 1;
    return 0;
  });

  return results;
}
