import fs from "fs";
import { ensureDir } from "../_lib/vault.js";
import { LOCALE } from "../_lib/config.js";
import { ok, err } from "../_lib/format.js";
import {
  readHotCache,
  readGlossary,
  lookupTerm,
  addToGlossary,
  savePerson,
  saveProject,
  addToHotCache,
  ensureKnowledgeStructure,
  readPerson,
  knowledgeFilePath,
  contextDirPath,
  slugify,
} from "../_lib/knowledge.js";
import type { ToolHandler, ToolArgs } from "../_lib/types.js";

// ============================================================
// Helpers
// ============================================================

/** Lokalisiertes Datum fuer Memory-Eintraege (z.B. "17.04.2026"). */
function localDateStr(): string {
  return new Date().toLocaleDateString(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Sicheres Loeschen aus KNOWLEDGE.md.
 * Entfernt Zeilen die den Suchtext enthalten, ABER NICHT:
 *   - Section-Header (## ...)
 *   - Tabellen-Header (| Wer | Rolle | etc.)
 *   - Separator-Zeilen (|---|---|)
 *   - H1 (# Knowledge)
 * So bleibt die Struktur erhalten.
 */
function deleteFromKnowledge(suchtext: string): { removed: number; preview: string[] } {
  const fp = knowledgeFilePath();
  if (!fs.existsSync(fp)) return { removed: 0, preview: [] };

  const content = fs.readFileSync(fp, "utf-8");
  const lines = content.split("\n");
  const lower = suchtext.toLowerCase();

  const isStructural = (line: string): boolean => {
    const t = line.trim();
    if (t.startsWith("#")) return true;                           // Header
    if (/^\|[\s:?-]+\|/.test(t)) return true;                     // Separator
    if (/^\|\s*(Wer|Begriff|Name|Spitzname|Codename|Term|Who|Rolle|Bedeutung|Was|Person|Projekt|Kontext)\s*\|/i.test(t)) return true; // Tabellen-Header
    return false;
  };

  const removed: string[] = [];
  const filtered: string[] = [];
  for (const line of lines) {
    if (!isStructural(line) && line.toLowerCase().includes(lower)) {
      removed.push(line);
    } else {
      filtered.push(line);
    }
  }

  if (removed.length > 0) {
    fs.writeFileSync(fp, filtered.join("\n"), "utf-8");
  }
  return { removed: removed.length, preview: removed.slice(0, 3) };
}

// ============================================================
// Modus-Handler
// ============================================================

async function handleLesen(): Promise<string> {
  ensureKnowledgeStructure();
  const content = readHotCache();
  if (!content) return "Kein Wissen vorhanden. KNOWLEDGE.md ist leer.";
  return content;
}

async function handleLoeschen(args: ToolArgs): Promise<string> {
  const suchtext = String(args.eintrag ?? "").trim();
  if (!suchtext) return err("Kein Suchtext zum Loeschen angegeben");
  if (suchtext.length < 3) return err("Suchtext zu kurz (mindestens 3 Zeichen)");

  const { removed, preview } = deleteFromKnowledge(suchtext);
  if (removed === 0) {
    return `Kein Eintrag mit "${suchtext}" in KNOWLEDGE.md gefunden.`;
  }
  const detail = `${removed} Zeile(n) entfernt` +
    (preview.length ? ` (z.B. "${preview[0].trim().slice(0, 60)}")` : "");
  return ok("memory", "Eintrag geloescht", suchtext, detail);
}

async function handleNachschlagen(args: ToolArgs): Promise<string> {
  const term = String(args.begriff ?? "").trim();
  if (!term) return err("Kein Begriff zum Nachschlagen angegeben");
  ensureKnowledgeStructure();
  const result = lookupTerm(term);
  if (result.found) {
    return `\u{1F9E0} ${result.term} \u2192 ${result.meaning} (Quelle: ${result.source})`;
  }
  return `Unbekannt: ${term}. Sag mir was es bedeutet, dann merke ich es mir.`;
}

async function handleProfil(args: ToolArgs): Promise<string> {
  const name = String(args.name ?? "").trim();
  if (!name) return err("Kein Name angegeben (name ist Pflicht fuer modus=profil)");

  const rolle = String(args.rolle ?? "").trim();
  const team = String(args.team ?? "").trim();
  const alias = String(args.alias ?? "").trim();

  // Nur name → lesen
  if (!rolle && !team && !alias) {
    ensureKnowledgeStructure();
    const content = readPerson(name);
    if (!content) return `Kein Profil fuer "${name}" vorhanden.`;
    return content;
  }

  ensureKnowledgeStructure();
  savePerson(name, {
    rolle: rolle || undefined,
    team: team || undefined,
    alias: alias || undefined,
  });
  addToHotCache("Personen", name, rolle || "—");
  const details = [rolle, team, alias].filter(Boolean).join(", ");
  return ok("memory", "Profil gespeichert", name, details || "aktualisiert");
}

async function handleGlossar(args: ToolArgs): Promise<string> {
  const glossarBegriff = String(args.glossar_begriff ?? "").trim();
  const bedeutung = String(args.bedeutung ?? "").trim();

  if (!glossarBegriff && !bedeutung) {
    ensureKnowledgeStructure();
    const content = readGlossary();
    if (!content) return "Glossar ist leer.";
    return content;
  }

  if (!glossarBegriff || !bedeutung) {
    return err("glossar_begriff und bedeutung sind beide erforderlich");
  }

  const kontext = String(args.kontext ?? "").trim() || undefined;
  const section = String(args.section ?? "Abkuerzungen");

  ensureKnowledgeStructure();
  addToGlossary(glossarBegriff, bedeutung, kontext, section);
  addToHotCache("Begriffe", glossarBegriff, bedeutung);
  return ok("memory", "Glossar-Eintrag hinzugefuegt", glossarBegriff, bedeutung);
}

async function handleSpeichern(args: ToolArgs): Promise<string> {
  const eintrag = String(args.eintrag ?? "").trim();
  if (!eintrag) return err("Kein Eintrag angegeben");

  const kategorie = String(args.kategorie ?? "").trim();
  ensureKnowledgeStructure();

  switch (kategorie) {
    case "person": {
      savePerson(eintrag, {});
      addToHotCache("Personen", eintrag, "—");
      return ok("memory", "Wissen gespeichert", eintrag, "Person");
    }
    case "projekt": {
      saveProject(eintrag, {});
      addToHotCache("Projekte", eintrag, "—");
      return ok("memory", "Wissen gespeichert", eintrag, "Projekt");
    }
    case "begriff": {
      addToGlossary(eintrag, "—");
      addToHotCache("Begriffe", eintrag, "—");
      return ok("memory", "Wissen gespeichert", eintrag, "Begriff");
    }
    case "praeferenz": {
      addToHotCache("Praeferenzen", eintrag, "");
      return ok("memory", "Wissen gespeichert", eintrag, "Praeferenz");
    }
    case "kontext": {
      const slug = slugify(eintrag.slice(0, 40));
      const dir = contextDirPath();
      ensureDir(dir);
      const fp = `${dir}/${slug}.md`;
      const date = localDateStr();
      fs.writeFileSync(fp, `# ${eintrag}\n\nErstellt: ${date}\n`, "utf-8");
      return ok("memory", "Wissen gespeichert", eintrag, "Kontext");
    }
    case "": {
      // Ohne Kategorie: Freitext in Hot Cache (Praeferenzen-Section)
      const fp = knowledgeFilePath();
      let content = fs.readFileSync(fp, "utf-8");
      const date = localDateStr();
      const newLine = `- ${date}: ${eintrag}`;
      // Versuche in "## Praeferenzen" Section zu schreiben, sonst anhaengen
      const prefIdx = content.indexOf("## Praeferenzen");
      if (prefIdx !== -1) {
        const afterHeader = content.indexOf("\n", prefIdx) + 1;
        const nextSection = content.indexOf("\n## ", afterHeader);
        const insertAt = nextSection !== -1 ? nextSection : content.length;
        content = content.slice(0, insertAt) + newLine + "\n" + content.slice(insertAt);
      } else {
        content += `\n${newLine}\n`;
      }
      fs.writeFileSync(fp, content, "utf-8");
      return ok("memory", "Wissen gespeichert", eintrag, "Freitext");
    }
    default:
      return err(`Unbekannte Kategorie: "${kategorie}". Erlaubt: person, projekt, begriff, praeferenz, kontext (oder leer lassen)`);
  }
}

// ============================================================
// Dispatcher (Switch-Pattern konsistent mit anderen Tools)
// ============================================================

export const handler: ToolHandler = async (args) => {
  const modus = String(args.modus ?? "speichern");

  switch (modus) {
    case "speichern": return handleSpeichern(args);
    case "lesen": return handleLesen();
    case "loeschen": return handleLoeschen(args);
    case "nachschlagen": return handleNachschlagen(args);
    case "profil": return handleProfil(args);
    case "glossar": return handleGlossar(args);
    default:
      return err(
        `Unbekannter Modus: "${modus}". Erlaubt: speichern, lesen, loeschen, nachschlagen, profil, glossar`,
      );
  }
};
