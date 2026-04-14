import fs from "fs";
import path from "path";
import crypto from "crypto";
import { workspacePath, ensureDir, atomicWriteSync, projectPath } from "./helpers.js";

export interface Task {
  id: string;
  text: string;
  status: "open" | "in_progress" | "done";
  assignee: string | null;
  date: string | null;
  location: string | null;
  project: string | null;
  createdAt: string;
  updatedAt: string;
}

function tasksFilePath(project?: string): string {
  if (project) {
    const dir = projectPath(project);
    ensureDir(dir);
    return path.join(dir, "tasks.json");
  }
  return path.join(workspacePath, "data", "tasks.json");
}

function legacyTasksPath(project?: string): string {
  return project
    ? projectPath(project, "Aufgaben.md")
    : path.join(workspacePath, "Aufgaben.md");
}

function loadTasks(project?: string): Task[] {
  const fp = tasksFilePath(project);
  if (fs.existsSync(fp)) {
    try { return JSON.parse(fs.readFileSync(fp, "utf-8")) as Task[]; }
    catch { return []; }
  }
  return migrateLegacy(project);
}

function saveTasks(tasks: Task[], project?: string): void {
  const fp = tasksFilePath(project);
  ensureDir(path.dirname(fp));
  atomicWriteSync(fp, JSON.stringify(tasks, null, 2));
}

function migrateLegacy(project?: string): Task[] {
  const mdPath = legacyTasksPath(project);
  if (!fs.existsSync(mdPath)) return [];
  const content = fs.readFileSync(mdPath, "utf-8");
  const tasks: Task[] = [];
  const now = new Date().toISOString();
  for (const line of content.split("\n")) {
    const openMatch = line.match(/^- \[ \] (.+)$/);
    const doneMatch = line.match(/^- \[x\] (.+)$/);
    if (openMatch || doneMatch) {
      tasks.push({
        id: crypto.randomUUID().slice(0, 8),
        text: (openMatch || doneMatch)![1].trim(),
        status: doneMatch ? "done" : "open",
        assignee: null, date: null, location: null,
        project: project || null, createdAt: now, updatedAt: now,
      });
    }
  }
  if (tasks.length > 0) saveTasks(tasks, project);
  return tasks;
}

export function saveTask(text: string, project?: string): Task {
  const tasks = loadTasks(project);
  const now = new Date().toISOString();
  const task: Task = {
    id: crypto.randomUUID().slice(0, 8),
    text, status: "open", assignee: null, date: null, location: null,
    project: project || null, createdAt: now, updatedAt: now,
  };
  tasks.push(task);
  saveTasks(tasks, project);
  return task;
}

export function listTasks(project?: string): Task[] {
  return loadTasks(project);
}

export function listOpenTasks(project?: string): Task[] {
  return loadTasks(project).filter((t) => t.status !== "done");
}

export function getTask(id: string, project?: string): Task | null {
  return loadTasks(project).find((t) => t.id === id) || null;
}

export function updateTask(
  id: string,
  updates: Partial<Omit<Task, "id" | "createdAt">>,
  project?: string,
): Task | null {
  const tasks = loadTasks(project);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
  saveTasks(tasks, project);
  return tasks[idx];
}

export function completeTask(textOrId: string, project?: string): boolean {
  const tasks = loadTasks(project);
  const idx = tasks.findIndex((t) => t.id === textOrId || t.text === textOrId);
  if (idx === -1) return false;
  tasks[idx].status = "done";
  tasks[idx].updatedAt = new Date().toISOString();
  saveTasks(tasks, project);
  return true;
}

export function deleteTask(id: string, project?: string): boolean {
  const tasks = loadTasks(project);
  const filtered = tasks.filter((t) => t.id !== id);
  if (filtered.length === tasks.length) return false;
  saveTasks(filtered, project);
  return true;
}
