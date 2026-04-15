import fs from "fs";
import path from "path";
import { workspacePath, walkMarkdownFiles, safePath, ensureDir } from "./helpers.js";

export interface Termin {
  file: string;          // Vault-relativer Pfad
  line: number;          // 1-basiert
  datum: string;         // YYYY-MM-DD
  zeit?: string;         // HH:MM (undefined = ganztaegig)
  endZeit?: string;      // HH:MM (undefined = keine Endzeit)
  text: string;
}

// `- YYYY-MM-DD [HH:MM[-HH:MM]] text`
const TERMIN_RE =
  /^\s*[-*+]\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?)?\s+(.+?)\s*$/;

const DEFAULT_TERMIN_FILE = process.env.TERMINE_FILE || "Termine.md";

function formatTerminLine(datum: string, zeit: string | undefined, endZeit: string | undefined, text: string): string {
  const zeitPart = zeit ? (endZeit ? ` ${zeit}-${endZeit}` : ` ${zeit}`) : "";
  return `- ${datum}${zeitPart} ${text}`;
}

/**
 * Haengt einen Termin als Markdown-Zeile an eine Datei an.
 * Default-Ziel: Termine.md im Vault-Root. `datei` kann eine andere Ziel-Datei sein
 * (z.B. ein Projekt- oder Personen-Notiz).
 *
 * Format: `- YYYY-MM-DD [HH:MM[-HH:MM]] text`.
 * Rueckgabe: absoluter Pfad der bearbeiteten Datei, oder null bei ungueltigen
 * Eingaben.
 */
export function addTermin(
  datum: string,
  text: string,
  zeit?: string,
  endZeit?: string,
  datei?: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null;
  if (zeit && !/^\d{2}:\d{2}$/.test(zeit)) return null;
  if (endZeit && !/^\d{2}:\d{2}$/.test(endZeit)) return null;
  if (endZeit && !zeit) return null; // Endzeit ohne Startzeit ist sinnlos

  const clean = text.trim();
  if (!clean) return null;

  const target = datei ?? DEFAULT_TERMIN_FILE;
  const withExt = target.endsWith(".md") ? target : target + ".md";
  const abs = safePath(withExt);
  if (!abs) return null;

  ensureDir(path.dirname(abs));

  const line = formatTerminLine(datum, zeit, endZeit, clean) + "\n";

  if (!fs.existsSync(abs)) {
    const header = target === DEFAULT_TERMIN_FILE ? "# Termine\n\n" : "";
    fs.writeFileSync(abs, header + line, "utf-8");
  } else {
    const existing = fs.readFileSync(abs, "utf-8");
    const prefix = existing.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(abs, prefix + line, "utf-8");
  }

  return abs;
}

/**
 * Listet Termine aus ALLEN Markdown-Dateien im Vault, die dem Format entsprechen.
 * Optional per Datumsbereich gefiltert (inklusiv). Sortiert nach Datum + Zeit.
 */
export function listTermine(vonDatum?: string, bisDatum?: string, limit = 200): Termin[] {
  const results: Termin[] = [];

  walkMarkdownFiles(workspacePath, (full) => {
    try {
      const content = fs.readFileSync(full, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(TERMIN_RE);
        if (!match) continue;

        const datum = match[1];
        if (vonDatum && datum < vonDatum) continue;
        if (bisDatum && datum > bisDatum) continue;

        results.push({
          file: path.relative(workspacePath, full).replace(/\\/g, "/"),
          line: i + 1,
          datum,
          zeit: match[2] || undefined,
          endZeit: match[3] || undefined,
          text: match[4],
        });

        if (results.length >= limit) return false;
      }
    } catch {
      /* unlesbare Datei ueberspringen */
    }
  });

  results.sort((a, b) => {
    if (a.datum !== b.datum) return a.datum.localeCompare(b.datum);
    const aZ = a.zeit ?? "00:00";
    const bZ = b.zeit ?? "00:00";
    return aZ.localeCompare(bZ);
  });

  return results;
}
