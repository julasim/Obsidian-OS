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

/**
 * Menschenlesbares relatives Datum fuer Dashboard-Ansichten.
 * Beispiele (heute = 2026-04-19):
 *   "2026-04-19" → "heute"
 *   "2026-04-20" → "morgen"
 *   "2026-04-21" → "in 2d"
 *   "2026-04-17" → "2d ueberfaellig"
 *   "2026-05-05" → "in 16d"
 *   undefined    → "kein Datum"
 */
export function relativeDateString(iso?: string): string {
  if (!iso) return "kein Datum";
  if (!isIsoDate(iso)) return iso;

  const today = new Date(todayStr() + "T00:00:00");
  const target = new Date(iso + "T00:00:00");
  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "heute";
  if (diffDays === 1) return "morgen";
  if (diffDays === -1) return "gestern";
  if (diffDays > 0) {
    if (diffDays < 7) return `in ${diffDays}d`;
    if (diffDays < 30) return `in ${Math.round(diffDays / 7)}w`;
    if (diffDays < 365) return `in ${Math.round(diffDays / 30)}M`;
    return `in ${Math.round(diffDays / 365)}J`;
  }
  // Vergangenheit
  const abs = Math.abs(diffDays);
  if (abs < 7) return `${abs}d ueberfaellig`;
  if (abs < 30) return `${Math.round(abs / 7)}w ueberfaellig`;
  return `${Math.round(abs / 30)}M ueberfaellig`;
}
