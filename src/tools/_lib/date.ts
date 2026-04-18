/**
 * Shared Datums-Primitives.
 *
 * Genutzt von: aufgaben, termine, memory, notiz, vault.
 * Vermeidet 3x duplizierte todayStr()-Definitionen.
 */

/** YYYY-MM-DD fuer heute (Lokalzeit, keine Intl-Abhaengigkeit). */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** YYYY-MM-DD fuer ein beliebiges Date. */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** YYYY-MM-DD fuer das Ende der aktuellen Woche (Sonntag). */
export function endOfWeekStr(): string {
  const d = new Date();
  const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ...
  const daysToSun = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  d.setDate(d.getDate() + daysToSun);
  return toIsoDate(d);
}

/** Prueft ob ein String ein gueltiges YYYY-MM-DD-Datum ist. */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Prueft ob ein String eine gueltige HH:MM-Zeit ist. */
export function isIsoTime(s: string): boolean {
  return /^\d{2}:\d{2}$/.test(s);
}
