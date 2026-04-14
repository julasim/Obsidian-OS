import fs from "fs";
import { projectPath } from "./helpers.js";
import { listTasks } from "./tasks.js";
import { listTermine } from "./termine.js";

export interface ProjectInfo {
  name: string;
  notes: number;
  openTasks: number;
  termine: number;
}

function safeProjectName(name: string): boolean {
  return /^[\w\-. ]+$/.test(name) && !name.includes("..");
}

const PROJECT_NOTES_SUBDIR = process.env.PROJECT_NOTES_SUBDIR || "Notizen";

export function listProjects(): string[] {
  const projektePath = projectPath();
  if (!fs.existsSync(projektePath)) return [];
  try {
    return fs
      .readdirSync(projektePath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function getProjectInfo(name: string): ProjectInfo | null {
  if (!safeProjectName(name)) return null;
  const pPath = projectPath(name);
  if (!fs.existsSync(pPath)) return null;
  const openTasks = listTasks(name).filter((t) => t.status !== "done").length;
  const termine = listTermine(name).length;
  const notesDir = projectPath(name, PROJECT_NOTES_SUBDIR);
  let noteCount = 0;
  try {
    if (fs.existsSync(notesDir)) {
      noteCount = fs.readdirSync(notesDir).filter((f) => f.endsWith(".md")).length;
    }
  } catch { /* ignore */ }
  return { name, notes: noteCount, openTasks, termine };
}

export function listProjectNotes(name: string): string[] {
  if (!safeProjectName(name)) return [];
  const notesDir = projectPath(name, PROJECT_NOTES_SUBDIR);
  if (!fs.existsSync(notesDir)) return [];
  try {
    return fs
      .readdirSync(notesDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .map((f) => f.replace(".md", ""));
  } catch {
    return [];
  }
}

export function readProjectNote(project: string, noteName: string): string | null {
  if (!safeProjectName(project)) return null;
  const filepath = projectPath(project, PROJECT_NOTES_SUBDIR, noteName + ".md");
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}
