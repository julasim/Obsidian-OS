import fs from "fs";
import path from "path";
import { vaultPath, safePath, ensureDir, walkMarkdownFiles } from "../_lib/vault.js";
import { DEFAULT_TERMIN_FILE } from "../_lib/config.js";
import { ok, err, list, EMOJI } from "../_lib/format.js";
import { todayStr } from "../_lib/date.js";
import type { ToolHandler } from "../_lib/types.js";

// ============================================================
// Shared
// ============================================================

const ORT_RE = /\s*\u{1F4CD}\s*(.+)$/u;

// ============================================================
// Modus: erfassen
// ============================================================

function formatTerminLine(
  datum: string,
  zeit: string | undefined,
  endZeit: string | undefined,
  text: string,
  ort?: string,
): string {
  const zeitPart = zeit ? (endZeit ? ` ${zeit}-${endZeit}` : ` ${zeit}`) : "";
  const ortPart = ort ? ` \u{1F4CD} ${ort}` : "";
  return `- ${datum}${zeitPart} ${text}${ortPart}`;
}

function addTermin(
  datum: string,
  text: string,
  zeit?: string,
  endZeit?: string,
  ort?: string,
  datei?: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null;
  if (zeit && !/^\d{2}:\d{2}$/.test(zeit)) return null;
  if (endZeit && !/^\d{2}:\d{2}$/.test(endZeit)) return null;
  if (endZeit && !zeit) return null;

  const clean = text.trim();
  if (!clean) return null;

  const target = datei ?? DEFAULT_TERMIN_FILE;
  const withExt = target.endsWith(".md") ? target : target + ".md";
  const abs = safePath(withExt);
  if (!abs) return null;

  ensureDir(path.dirname(abs));

  const line = formatTerminLine(datum, zeit, endZeit, clean, ort) + "\n";

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

async function handleErfassen(args: Record<string, string | number | boolean | undefined>): Promise<string> {
  const datum = String(args.datum ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    return err(`Datum muss YYYY-MM-DD sein, bekommen: "${datum}"`);
  }

  const text = String(args.text ?? "").trim();
  if (!text) return err("Kein Termintext angegeben");

  const zeit = args.zeit ? String(args.zeit).trim() : undefined;
  if (zeit && !/^\d{2}:\d{2}$/.test(zeit)) {
    return err(`Zeit muss HH:MM sein, bekommen: "${zeit}"`);
  }

  const endZeit = args.endZeit ? String(args.endZeit).trim() : undefined;
  if (endZeit && !/^\d{2}:\d{2}$/.test(endZeit)) {
    return err(`Endzeit muss HH:MM sein, bekommen: "${endZeit}"`);
  }
  if (endZeit && !zeit) {
    return err("Endzeit ohne Startzeit ist nicht erlaubt");
  }

  const ort = args.ort ? String(args.ort).trim() : undefined;
  const datei = args.datei ? String(args.datei).trim() : undefined;
  const abs = addTermin(datum, text, zeit, endZeit, ort, datei);
  if (!abs) return err(`Ungueltiger Zielpfad "${datei ?? DEFAULT_TERMIN_FILE}"`);

  const rel = path.relative(vaultPath, abs).replace(/\\/g, "/");
  const zeitHint = zeit
    ? endZeit
      ? `${zeit}-${endZeit}`
      : zeit
    : "ganztaegig";
  const ortHint = ort ? ` (${ort})` : "";
  return ok("event", "Termin erfasst", rel, `${datum} ${zeitHint} ${text}${ortHint}`);
}

// ============================================================
// Modus: auflisten
// ============================================================

interface Termin {
  file: string;
  line: number;
  datum: string;
  zeit?: string;
  endZeit?: string;
  text: string;
  ort?: string;
}

// `- YYYY-MM-DD [HH:MM[-HH:MM]] text [📍 ort]`
const TERMIN_RE =
  /^\s*[-*+]\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?)?\s+(.+?)\s*$/;

/**
 * Liefert die Liste der zu scannenden Dateien.
 * Default: nur DEFAULT_TERMIN_FILE (vermeidet False-Positives in normalen Notizen).
 * Mit alleDateien=true: alle .md im Vault (altes Verhalten, opt-in).
 */
function collectTerminSources(alleDateien: boolean): string[] {
  if (alleDateien) {
    const all: string[] = [];
    walkMarkdownFiles(vaultPath, (full) => { all.push(full); });
    return all;
  }
  // Default: nur die Standard-Termin-Datei + alle Dateien die "termine" im Namen haben
  const sources: string[] = [];
  const defaultAbs = safePath(DEFAULT_TERMIN_FILE);
  if (defaultAbs && fs.existsSync(defaultAbs)) sources.push(defaultAbs);
  // Zusaetzlich: Dateien mit "termine" im Namen (z.B. "Projekte/X/Termine.md")
  walkMarkdownFiles(vaultPath, (full) => {
    if (/termine?\.md$/i.test(full) && !sources.includes(full)) {
      sources.push(full);
    }
  });
  return sources;
}

function listTermine(
  vonDatum?: string,
  bisDatum?: string,
  limit = 200,
  alleDateien = false,
): Termin[] {
  const results: Termin[] = [];
  const sources = collectTerminSources(alleDateien);

  for (const full of sources) {
    if (results.length >= limit) break;
    try {
      const content = fs.readFileSync(full, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(TERMIN_RE);
        if (!match) continue;

        const datum = match[1];
        if (vonDatum && datum < vonDatum) continue;
        if (bisDatum && datum > bisDatum) continue;

        let text = match[4];
        let ort: string | undefined;
        const ortMatch = text.match(ORT_RE);
        if (ortMatch) {
          ort = ortMatch[1].trim();
          text = text.replace(ORT_RE, "").trim();
        }

        results.push({
          file: path.relative(vaultPath, full).replace(/\\/g, "/"),
          line: i + 1,
          datum,
          zeit: match[2] || undefined,
          endZeit: match[3] || undefined,
          text,
          ort,
        });

        if (results.length >= limit) break;
      }
    } catch {
      /* skip */
    }
  }

  results.sort((a, b) => {
    if (a.datum !== b.datum) return a.datum.localeCompare(b.datum);
    const aZ = a.zeit ?? "00:00";
    const bZ = b.zeit ?? "00:00";
    return aZ.localeCompare(bZ);
  });

  return results;
}

async function handleAuflisten(args: Record<string, string | number | boolean | undefined>): Promise<string> {
  const showAll = String(args.alle ?? "").toLowerCase() === "true";
  const von = args.von
    ? String(args.von).trim()
    : showAll
      ? undefined
      : todayStr();
  const bis = args.bis ? String(args.bis).trim() : undefined;

  if (von && !/^\d{4}-\d{2}-\d{2}$/.test(von)) {
    return err(`'von' muss YYYY-MM-DD sein, bekommen: "${von}"`);
  }
  if (bis && !/^\d{4}-\d{2}-\d{2}$/.test(bis)) {
    return err(`'bis' muss YYYY-MM-DD sein, bekommen: "${bis}"`);
  }

  const limit =
    args.limit !== undefined ? Math.max(1, Number(args.limit)) : 50;
  const alleDateien = String(args.alle_dateien ?? "").toLowerCase() === "true";
  const termine = listTermine(von, bis, limit, alleDateien);

  const filterParts: string[] = [];
  if (showAll) filterParts.push("alle");
  else if (von && !args.von) filterParts.push("ab heute");
  if (von && args.von) filterParts.push(`ab ${von}`);
  if (bis) filterParts.push(`bis ${bis}`);
  const filter = filterParts.length ? ` (${filterParts.join(", ")})` : "";

  const lines = termine.map((t) => {
    const zeit = t.zeit
      ? t.endZeit
        ? ` ${t.zeit}-${t.endZeit}`
        : ` ${t.zeit}`
      : "";
    const ortPart = t.ort ? ` \u{1F4CD} ${t.ort}` : "";
    return `${EMOJI.event} ${t.datum}${zeit} ${t.text}${ortPart} \u2014 ${t.file}:${t.line}`;
  });

  return list(termine.length, "Termin", "Termine", lines, filter);
}

// ============================================================
// Dispatcher
// ============================================================

export const handler: ToolHandler = async (args) => {
  const modus = String(args.modus ?? "auflisten");

  switch (modus) {
    case "erfassen": return handleErfassen(args);
    case "auflisten": return handleAuflisten(args);
    default: return err(`Unbekannter Modus: "${modus}". Erlaubt: erfassen, auflisten`);
  }
};
