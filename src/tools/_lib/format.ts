/**
 * Einheitliche Return-Formate fuer alle Tools.
 * Siehe STYLE.md Kapitel 4, 5, 6.
 *
 * - ok()   fuer Write/Mutation-Tools (Pattern W)
 * - list() fuer Auflistungs-Tools    (Pattern L)
 * - err()  fuer Validation-Fehler    (mit "Fehler: "-Prefix)
 *
 * Such-/Nicht-gefunden-Meldungen werden NICHT durch err() geschleust —
 * sie sind natuerliche Sprache ohne Prefix (siehe STYLE.md 5b).
 */

export type ResultKind =
  | "note"       // 📝
  | "note_del"   // 🗑️
  | "task"       // ✅
  | "event"      // 📅
  | "daily"      // 📆
  | "project"    // 📁
  | "folder"     // 📂
  | "file"       // 📄
  | "memory"     // 🧠
  | "frontmatter" // 🏷️
  | "export"     // 📤
  | "info";      // ℹ️

export const EMOJI: Record<ResultKind, string> = {
  note: "\u{1F4DD}",
  note_del: "\u{1F5D1}\u{FE0F}",
  task: "\u2705",
  event: "\u{1F4C5}",
  daily: "\u{1F4C6}",
  project: "\u{1F4C1}",
  folder: "\u{1F4C2}",
  file: "\u{1F4C4}",
  memory: "\u{1F9E0}",
  frontmatter: "\u{1F3F7}\u{FE0F}",
  export: "\u{1F4E4}",
  info: "\u2139\u{FE0F}",
};

/**
 * Erfolgs-Return (Pattern W):
 *   "<emoji> <aktion>: <ziel> — <detail>"
 *
 * @param kind   bestimmt das Emoji
 * @param aktion Verb im Passiv ("Notiz gespeichert", "Aufgabe erfasst")
 * @param ziel   Wikilink [[x]] fuer Notizen, Datei/Pfad sonst
 * @param detail optionaler Zusatz (Ordner, Faelligkeit, Zeilen, etc.)
 */
export function ok(
  kind: ResultKind,
  aktion: string,
  ziel: string,
  detail?: string,
): string {
  const d = detail && detail.trim() ? ` \u2014 ${detail.trim()}` : "";
  return `${EMOJI[kind]} ${aktion}: ${ziel}${d}`;
}

/**
 * Validation-Fehler (immer mit "Fehler: "-Prefix, endet mit Punkt).
 * Fuer Nicht-gefunden / leere Ergebnisse NICHT nutzen — siehe STYLE.md 5b.
 */
export function err(message: string): string {
  const clean = message.trim().replace(/\.$/, "");
  return `Fehler: ${clean}.`;
}

/**
 * List-Return (Pattern L):
 *   "<N> <singular|plural><filter>:\n<items>"
 * Bei leerer Liste: "Keine <plural><filter>." (ohne "Fehler:"-Prefix).
 *
 * @param count    Anzahl (fuer Singular/Plural-Entscheidung)
 * @param singular "offene Aufgabe"
 * @param plural   "offene Aufgaben"
 * @param items    bereits formatierte Zeilen (inkl. Emoji-Praefix)
 * @param filter   optionaler Filter-Suffix z.B. ' fuer "bug"' oder " (Inbox)"
 */
export function list(
  count: number,
  singular: string,
  plural: string,
  items: string[],
  filter = "",
): string {
  const suffix = filter ? filter : "";
  if (count === 0) return `Keine ${plural}${suffix}.`;
  const head = `${count} ${count === 1 ? singular : plural}${suffix}:`;
  return `${head}\n${items.join("\n")}`;
}

/** Vault-relativen Pfad in Forward-Slash-Form zurueckgeben. */
export function relPath(absPath: string, vaultRoot: string): string {
  // import vermeiden (format.ts soll dependency-frei bleiben)
  const normalized = absPath.replace(/\\/g, "/");
  const rootN = vaultRoot.replace(/\\/g, "/");
  if (normalized.startsWith(rootN + "/")) {
    return normalized.slice(rootN.length + 1);
  }
  if (normalized === rootN) return "";
  return normalized;
}

/** Wikilink-Form aus Dateipfad (Basename ohne .md). */
export function wikilink(absPathOrName: string): string {
  const base = absPathOrName.split(/[\\/]/).pop() ?? absPathOrName;
  const name = base.replace(/\.md$/i, "");
  return `[[${name}]]`;
}
