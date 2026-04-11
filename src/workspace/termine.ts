import fs from "fs";
import path from "path";
import crypto from "crypto";
import { workspacePath, ensureDir, atomicWriteSync } from "./helpers.js";

export interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  endzeit: string | null;
  location: string | null;
  assignees: string[];
  project: string | null;
  createdAt: string;
}

function termineFilePath(project?: string): string {
  if (project) {
    const dir = path.join(workspacePath, "Projekte", project);
    ensureDir(dir);
    return path.join(dir, "termine.json");
  }
  return path.join(workspacePath, "data", "termine.json");
}

function legacyTerminePath(project?: string): string {
  return project
    ? path.join(workspacePath, "Projekte", project, "Termine.md")
    : path.join(workspacePath, "Termine.md");
}

function loadTermine(project?: string): Termin[] {
  const fp = termineFilePath(project);
  if (fs.existsSync(fp)) {
    try { return JSON.parse(fs.readFileSync(fp, "utf-8")) as Termin[]; }
    catch { return []; }
  }
  return migrateLegacy(project);
}

function saveTermine(termine: Termin[], project?: string): void {
  const fp = termineFilePath(project);
  ensureDir(path.dirname(fp));
  atomicWriteSync(fp, JSON.stringify(termine, null, 2));
}

function migrateLegacy(project?: string): Termin[] {
  const mdPath = legacyTerminePath(project);
  if (!fs.existsSync(mdPath)) return [];
  const content = fs.readFileSync(mdPath, "utf-8");
  const termine: Termin[] = [];
  const now = new Date().toISOString();
  for (const line of content.split("\n")) {
    const match = line.match(/^- \[ \] (.+)$/);
    if (!match) continue;
    const parts = match[1].split("|").map((s) => s.trim());
    const datum = parts[0] || "";
    let uhrzeit: string | null = null;
    let text = "";
    if (parts.length === 3) { uhrzeit = parts[1]; text = parts[2]; }
    else if (parts.length === 2) { text = parts[1]; }
    else { text = parts[0]; }
    termine.push({
      id: crypto.randomUUID().slice(0, 8),
      text, datum, uhrzeit, endzeit: null, location: null,
      assignees: [], project: project || null, createdAt: now,
    });
  }
  if (termine.length > 0) saveTermine(termine, project);
  return termine;
}

export function validateDatum(datum: string): string | null {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(datum)) {
    return `Ungueltiges Datumsformat "${datum}" — erwartet: TT.MM.JJJJ (z.B. 15.04.2026)`;
  }
  const [tag, monat, jahr] = datum.split(".").map(Number);
  if (monat < 1 || monat > 12) return `Ungueltiger Monat ${monat} in "${datum}"`;
  if (tag < 1 || tag > 31) return `Ungueltiger Tag ${tag} in "${datum}"`;
  if (jahr < 2020 || jahr > 2099) return `Ungueltiges Jahr ${jahr} in "${datum}"`;
  return null;
}

export function validateUhrzeit(uhrzeit: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(uhrzeit)) {
    return `Ungueltiges Uhrzeitformat "${uhrzeit}" — erwartet: HH:MM (z.B. 14:30)`;
  }
  const [h, m] = uhrzeit.split(":").map(Number);
  if (h < 0 || h > 23) return `Ungueltige Stunde ${h} in "${uhrzeit}"`;
  if (m < 0 || m > 59) return `Ungueltige Minute ${m} in "${uhrzeit}"`;
  return null;
}

export function saveTermin(datum: string, text: string, uhrzeit?: string, project?: string): Termin | string {
  const datumErr = validateDatum(datum);
  if (datumErr) return datumErr;
  if (uhrzeit) {
    const uhrzeitErr = validateUhrzeit(uhrzeit);
    if (uhrzeitErr) return uhrzeitErr;
  }
  const termine = loadTermine(project);
  const now = new Date().toISOString();
  const termin: Termin = {
    id: crypto.randomUUID().slice(0, 8),
    text, datum, uhrzeit: uhrzeit || null, endzeit: null, location: null,
    assignees: [], project: project || null, createdAt: now,
  };
  termine.push(termin);
  saveTermine(termine, project);
  return termin;
}

export function listTermine(project?: string): Termin[] {
  return loadTermine(project);
}

export function getTermin(id: string, project?: string): Termin | null {
  return loadTermine(project).find((t) => t.id === id) || null;
}

export function updateTermin(
  id: string,
  updates: Partial<Omit<Termin, "id" | "createdAt">>,
  project?: string,
): Termin | null {
  const termine = loadTermine(project);
  const idx = termine.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  termine[idx] = { ...termine[idx], ...updates };
  saveTermine(termine, project);
  return termine[idx];
}

export function deleteTermin(textOrId: string, project?: string): boolean {
  const termine = loadTermine(project);
  const filtered = termine.filter((t) => t.id !== textOrId && !t.text.includes(textOrId));
  if (filtered.length === termine.length) return false;
  saveTermine(filtered, project);
  return true;
}
