/**
 * Shared Primitives fuer Daily-Note-Tools.
 * Genutzt von: daily_notes, daily_note_eintrag.
 */

import fs from "fs";
import path from "path";
import { vaultPath, resolveDir, ensureDir } from "./vault.js";
import { DAILY_NOTES_DIR, LOCALE, TIMEZONE } from "./config.js";

/** Absoluter Pfad zum Daily-Notes-Verzeichnis (case-insensitiv aufgeloest). */
export function resolveDailyDir(): string {
  return resolveDir(vaultPath, DAILY_NOTES_DIR);
}

/** Pfad zur Daily Note fuer ein bestimmtes Datum (Default: heute). */
export function dailyNotePath(date?: Date): string {
  const d = date ?? new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return path.join(resolveDailyDir(), `${year}-${month}-${day}.md`);
}

/** YYYY-MM-DD Format (manuell, ohne Intl/Locale). */
export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Langes lokalisiertes Datum ("Mittwoch, 16. April 2026"). */
export function formatLongDate(d: Date): string {
  return d.toLocaleDateString(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TIMEZONE,
  });
}

/**
 * Legt eine neue Daily Note mit Standard-Template an.
 * Gibt den absoluten Pfad zurueck.
 */
export function createDailyNote(date?: Date): string {
  const d = date ?? new Date();
  const fp = dailyNotePath(d);
  ensureDir(path.dirname(fp));
  const content = `---\ndate: ${formatDate(d)}\ntags: [daily]\n---\n\n# ${formatLongDate(d)}\n\n## Heute\n\n## Log\n\n`;
  fs.writeFileSync(fp, content, "utf-8");
  return fp;
}

/**
 * Liest die Daily Note fuer ein Datum. Erstellt sie bei Bedarf (nur fuer heute).
 * Gibt den Markdown-Inhalt zurueck.
 */
export function getOrCreateDailyNote(date?: Date): string {
  const fp = dailyNotePath(date);
  if (fs.existsSync(fp)) return fs.readFileSync(fp, "utf-8");
  createDailyNote(date);
  return fs.readFileSync(fp, "utf-8");
}

/**
 * Liest eine Daily Note anhand eines Datums-Strings (YYYY-MM-DD oder Prefix).
 * Gibt null zurueck wenn nicht gefunden.
 */
export function readDailyNote(dateStr: string): string | null {
  const dir = resolveDailyDir();
  const exact = path.join(dir, `${dateStr}.md`);
  if (fs.existsSync(exact)) return fs.readFileSync(exact, "utf-8");
  if (!fs.existsSync(dir)) return null;
  try {
    const match = fs.readdirSync(dir).find(
      (f) => f.startsWith(dateStr) && f.endsWith(".md"),
    );
    if (match) return fs.readFileSync(path.join(dir, match), "utf-8");
  } catch {
    /* unlesbar */
  }
  return null;
}

/**
 * Listet vorhandene Daily Notes (Dateinamen, neueste zuerst).
 * @param limit Maximale Anzahl (Default: 30)
 */
export function listDailyNotes(limit = 30): string[] {
  const dir = resolveDailyDir();
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}
