/**
 * Shared Knowledge-Primitives — Two-Tier Memory System.
 *
 * Tier 1: KNOWLEDGE.md (Hot Cache) — Top-Personen, Begriffe, Projekte (~100 Zeilen)
 * Tier 2: knowledge/ (Deep Storage) — Glossar, People, Projects, Context
 *
 * Genutzt von: memory-Tool, vault-Tool (modus=dekodieren)
 */

import fs from "fs";
import path from "path";
import { vaultPath, ensureDir } from "./vault.js";
import { KNOWLEDGE_FILE, KNOWLEDGE_DIR, LOCALE } from "./config.js";

// ============================================================
// Pfade
// ============================================================

export function knowledgeFilePath(): string {
  return path.join(vaultPath, KNOWLEDGE_FILE);
}

export function knowledgeDirPath(): string {
  return path.join(vaultPath, KNOWLEDGE_DIR);
}

export function glossaryPath(): string {
  return path.join(knowledgeDirPath(), "glossary.md");
}

export function peopleDirPath(): string {
  return path.join(knowledgeDirPath(), "people");
}

export function projectsDirPath(): string {
  return path.join(knowledgeDirPath(), "projects");
}

export function contextDirPath(): string {
  return path.join(knowledgeDirPath(), "context");
}

/** Sichere Dateinamen fuer people/projects (lowercase, hyphens) */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u00e4\u00f6\u00fc\u00df\s-]/g, "")
    .replace(/\s+/g, "-")
    .trim()
    .slice(0, 80);
}

// ============================================================
// Initialisierung
// ============================================================

const KNOWLEDGE_TEMPLATE = `# Knowledge

## Ich
<!-- Wer bin ich? Rolle, Team, was ich mache. -->

## Personen
| Wer | Rolle |
|-----|-------|
<!-- | **Max** | Max Mustermann, Projektleiter | -->

## Begriffe
| Begriff | Bedeutung |
|---------|-----------|
<!-- | PSR | Pipeline Status Report | -->

## Projekte
| Name | Was |
|------|-----|
<!-- | **Phoenix** | DB-Migration, Q2 Launch | -->

## Praeferenzen
<!-- - 25-Minuten-Meetings -->
`;

const GLOSSARY_TEMPLATE = `# Glossar

Abkuerzungen, interner Jargon und Shorthand.

## Abkuerzungen
| Begriff | Bedeutung | Kontext |
|---------|-----------|---------|

## Interne Begriffe
| Begriff | Bedeutung |
|---------|-----------|

## Spitznamen
| Spitzname | Person |
|-----------|--------|

## Projekt-Codenamen
| Codename | Projekt |
|----------|---------|
`;

/** Stellt sicher, dass die Knowledge-Struktur existiert. */
export function ensureKnowledgeStructure(): void {
  const kDir = knowledgeDirPath();
  ensureDir(kDir);
  ensureDir(peopleDirPath());
  ensureDir(projectsDirPath());
  ensureDir(contextDirPath());

  const kFile = knowledgeFilePath();
  if (!fs.existsSync(kFile)) {
    fs.writeFileSync(kFile, KNOWLEDGE_TEMPLATE, "utf-8");
  }

  const gFile = glossaryPath();
  if (!fs.existsSync(gFile)) {
    fs.writeFileSync(gFile, GLOSSARY_TEMPLATE, "utf-8");
  }
}

// ============================================================
// Lesen
// ============================================================

/** Liest den Hot Cache (KNOWLEDGE.md). Gibt "" wenn nicht existent. */
export function readHotCache(): string {
  const fp = knowledgeFilePath();
  if (!fs.existsSync(fp)) return "";
  return fs.readFileSync(fp, "utf-8");
}

/** Liest das vollstaendige Glossar. Gibt "" wenn nicht existent. */
export function readGlossary(): string {
  const fp = glossaryPath();
  if (!fs.existsSync(fp)) return "";
  return fs.readFileSync(fp, "utf-8");
}

/** Liest ein Personen-Profil. Gibt null wenn nicht existent. */
export function readPerson(name: string): string | null {
  const slug = slugify(name);
  const fp = path.join(peopleDirPath(), `${slug}.md`);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf-8");
}

/** Liest ein Projekt-Profil. Gibt null wenn nicht existent. */
export function readProject(name: string): string | null {
  const slug = slugify(name);
  const fp = path.join(projectsDirPath(), `${slug}.md`);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf-8");
}

/** Liest eine Kontext-Datei. Gibt null wenn nicht existent. */
export function readContext(topic: string): string | null {
  const slug = slugify(topic);
  const fp = path.join(contextDirPath(), `${slug}.md`);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf-8");
}

// ============================================================
// Parsen — Tabellen aus Markdown extrahieren
// ============================================================

export interface KnowledgeEntry {
  key: string;     // Begriff, Name, Codename (lowercased fuer Lookup)
  value: string;   // Bedeutung, Rolle, Beschreibung
  source: string;  // "hot_cache", "glossary", "people", "projects"
}

/** Parsed alle | Key | Value |-Tabellen aus Markdown in eine Lookup-Map. */
export function parseTableEntries(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = content.split("\n");
  for (const line of lines) {
    // Matcht | Key | Value | (optional dritte Spalte)
    const match = line.match(/^\|\s*\*?\*?([^|*]+?)\*?\*?\s*\|\s*([^|]+?)\s*\|/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    // Separator-Zeilen (---) und Header ueberspringen
    if (key.match(/^[-:]+$/) || key === "wer" || key === "begriff" ||
        key === "name" || key === "spitzname" || key === "codename" ||
        key === "term" || key === "who") continue;
    if (key && value) map.set(key, value);
  }
  return map;
}

// ============================================================
// Lookup — Progressive Aufloesung
// ============================================================

export interface LookupResult {
  found: boolean;
  term: string;
  meaning: string;
  source: string;
}

/**
 * Progressiver Lookup: Hot Cache → Glossar → People → Projects.
 * Case-insensitive.
 */
export function lookupTerm(term: string): LookupResult {
  const lower = term.toLowerCase().trim();
  if (!lower) return { found: false, term, meaning: "", source: "" };

  // 1. Hot Cache (KNOWLEDGE.md)
  const hotCache = readHotCache();
  if (hotCache) {
    const hotMap = parseTableEntries(hotCache);
    const hotVal = hotMap.get(lower);
    if (hotVal) return { found: true, term, meaning: hotVal, source: "hot_cache" };
  }

  // 2. Glossar
  const glossary = readGlossary();
  if (glossary) {
    const glossMap = parseTableEntries(glossary);
    const glossVal = glossMap.get(lower);
    if (glossVal) return { found: true, term, meaning: glossVal, source: "glossary" };
  }

  // 3. People (Dateiname-Match)
  const personContent = readPerson(lower);
  if (personContent) {
    const firstLine = personContent.split("\n").find((l) => l.startsWith("# "));
    const name = firstLine?.replace(/^#\s*/, "").trim() ?? term;
    const roleLine = personContent.split("\n").find((l) => l.startsWith("**Rolle"));
    const role = roleLine?.replace(/^\*\*Rolle[^:]*:\*\*\s*/, "").trim() ?? "";
    return { found: true, term, meaning: `${name}${role ? `, ${role}` : ""}`, source: "people" };
  }

  // 4. Projects (Dateiname-Match)
  const projectContent = readProject(lower);
  if (projectContent) {
    const firstLine = projectContent.split("\n").find((l) => l.startsWith("# "));
    const name = firstLine?.replace(/^#\s*/, "").trim() ?? term;
    const statusLine = projectContent.split("\n").find((l) => l.startsWith("**Status"));
    const status = statusLine?.replace(/^\*\*Status[^:]*:\*\*\s*/, "").trim() ?? "";
    return { found: true, term, meaning: `${name}${status ? ` (${status})` : ""}`, source: "projects" };
  }

  return { found: false, term, meaning: "", source: "" };
}

/**
 * Baut eine vollstaendige Lookup-Map aus Hot Cache + Glossar.
 * Nuetzlich fuer Batch-Decode (vault modus=dekodieren).
 */
export function buildLookupMap(): Map<string, string> {
  const map = new Map<string, string>();

  // Glossar zuerst (wird von Hot Cache ueberschrieben = Hot Cache hat Vorrang)
  const glossary = readGlossary();
  if (glossary) {
    for (const [k, v] of parseTableEntries(glossary)) map.set(k, v);
  }

  const hotCache = readHotCache();
  if (hotCache) {
    for (const [k, v] of parseTableEntries(hotCache)) map.set(k, v);
  }

  // People-Dateien scannen
  const pDir = peopleDirPath();
  if (fs.existsSync(pDir)) {
    try {
      for (const file of fs.readdirSync(pDir)) {
        if (!file.endsWith(".md")) continue;
        const slug = file.replace(/\.md$/, "");
        const content = fs.readFileSync(path.join(pDir, file), "utf-8");
        const firstLine = content.split("\n").find((l) => l.startsWith("# "));
        const name = firstLine?.replace(/^#\s*/, "").trim();
        if (name) map.set(slug, name);
      }
    } catch { /* skip */ }
  }

  // Projects-Dateien scannen
  const prDir = projectsDirPath();
  if (fs.existsSync(prDir)) {
    try {
      for (const file of fs.readdirSync(prDir)) {
        if (!file.endsWith(".md")) continue;
        const slug = file.replace(/\.md$/, "");
        const content = fs.readFileSync(path.join(prDir, file), "utf-8");
        const firstLine = content.split("\n").find((l) => l.startsWith("# "));
        const name = firstLine?.replace(/^#\s*/, "").trim();
        if (name) map.set(slug, name);
      }
    } catch { /* skip */ }
  }

  return map;
}

// ============================================================
// Schreiben
// ============================================================

/** Fuegt einen Eintrag zur Glossar-Tabelle hinzu. */
export function addToGlossary(
  begriff: string,
  bedeutung: string,
  kontext?: string,
  section = "Abkuerzungen",
): void {
  ensureKnowledgeStructure();
  const fp = glossaryPath();
  let content = fs.readFileSync(fp, "utf-8");

  const sectionHeader = `## ${section}`;
  const idx = content.indexOf(sectionHeader);
  if (idx === -1) {
    // Section existiert nicht → anhaengen
    content += `\n${sectionHeader}\n| Begriff | Bedeutung |\n|---------|-----------|`;
  }

  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const kontextStr = kontext ? ` | ${esc(kontext)}` : "";
  const newRow = `| ${esc(begriff)} | ${esc(bedeutung)}${kontextStr} |`;

  // Nach der letzten Tabellenzeile in der Section einfuegen
  const sIdx = content.indexOf(sectionHeader);
  const afterSection = sIdx + sectionHeader.length;
  const nextSection = content.indexOf("\n## ", afterSection);
  const insertPos = nextSection !== -1 ? nextSection : content.length;

  content = content.slice(0, insertPos) + `\n${newRow}` + content.slice(insertPos);
  fs.writeFileSync(fp, content, "utf-8");
}

/**
 * Upserted ein Feld im Frontmatter-Stil (**Key:** value).
 * Ersetzt bestehende Zeile oder fuegt vor der ersten ## Section ein.
 */
function upsertField(content: string, key: string, value: string): string {
  const keyPattern = new RegExp(`\\*\\*${key}:\\*\\*[^\\n]*`);
  if (keyPattern.test(content)) {
    return content.replace(keyPattern, `**${key}:** ${value}`);
  }
  // Vor erster ## Section einfuegen, sonst ans Ende
  const firstSection = content.search(/\n## /);
  if (firstSection !== -1) {
    return content.slice(0, firstSection) + `\n**${key}:** ${value}` + content.slice(firstSection);
  }
  return content + `\n**${key}:** ${value}\n`;
}

/** Erstellt oder aktualisiert ein Personen-Profil. Alle Felder werden upserted. */
export function savePerson(
  name: string,
  details: { rolle?: string; team?: string; alias?: string; notizen?: string },
): string {
  ensureKnowledgeStructure();
  const slug = slugify(name);
  const fp = path.join(peopleDirPath(), `${slug}.md`);

  let content: string;
  if (fs.existsSync(fp)) {
    content = fs.readFileSync(fp, "utf-8");
    // ALLE Felder upserten, nicht nur rolle
    if (details.alias) content = upsertField(content, "Auch bekannt als", details.alias);
    if (details.rolle) content = upsertField(content, "Rolle", details.rolle);
    if (details.team) content = upsertField(content, "Team", details.team);
    if (details.notizen) {
      content += `\n- ${new Date().toLocaleDateString(LOCALE)}: ${details.notizen}`;
    }
  } else {
    content = `# ${name}\n\n`;
    if (details.alias) content += `**Auch bekannt als:** ${details.alias}\n`;
    if (details.rolle) content += `**Rolle:** ${details.rolle}\n`;
    if (details.team) content += `**Team:** ${details.team}\n`;
    content += `\n## Kontext\n\n`;
    if (details.notizen) content += `- ${details.notizen}\n`;
  }

  fs.writeFileSync(fp, content, "utf-8");
  return fp;
}

/** Erstellt oder aktualisiert ein Projekt-Profil. */
export function saveProject(
  name: string,
  details: { status?: string; codename?: string; beschreibung?: string; notizen?: string },
): string {
  ensureKnowledgeStructure();
  const slug = slugify(name);
  const fp = path.join(projectsDirPath(), `${slug}.md`);

  let content: string;
  if (fs.existsSync(fp)) {
    content = fs.readFileSync(fp, "utf-8");
    if (details.codename) content = upsertField(content, "Codename", details.codename);
    if (details.status) content = upsertField(content, "Status", details.status);
    if (details.beschreibung) {
      // Beschreibung als Section behandeln, nicht als Field
      if (content.match(/\n## Beschreibung/)) {
        content = content.replace(/\n## Beschreibung\n\n[^\n]+/, `\n## Beschreibung\n\n${details.beschreibung}`);
      } else {
        const firstSection = content.search(/\n## /);
        const insertAt = firstSection !== -1 ? firstSection : content.length;
        content = content.slice(0, insertAt) + `\n## Beschreibung\n\n${details.beschreibung}\n` + content.slice(insertAt);
      }
    }
    if (details.notizen) {
      content += `\n- ${new Date().toLocaleDateString(LOCALE)}: ${details.notizen}`;
    }
  } else {
    content = `# ${name}\n\n`;
    if (details.codename) content += `**Codename:** ${details.codename}\n`;
    if (details.status) content += `**Status:** ${details.status}\n`;
    if (details.beschreibung) content += `\n## Beschreibung\n\n${details.beschreibung}\n`;
    content += `\n## Kontext\n\n`;
    if (details.notizen) content += `- ${details.notizen}\n`;
  }

  fs.writeFileSync(fp, content, "utf-8");
  return fp;
}

/** Fuegt eine Zeile zum Hot Cache (KNOWLEDGE.md) hinzu — in passende Tabelle. */
export function addToHotCache(
  section: string,
  key: string,
  value: string,
): void {
  ensureKnowledgeStructure();
  const fp = knowledgeFilePath();
  let content = fs.readFileSync(fp, "utf-8");

  const sectionHeader = `## ${section}`;
  const sIdx = content.indexOf(sectionHeader);
  if (sIdx === -1) return; // Section nicht gefunden

  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const newRow = `| **${esc(key)}** | ${esc(value)} |`;
  const afterSection = sIdx + sectionHeader.length;
  const nextSection = content.indexOf("\n## ", afterSection);
  const insertPos = nextSection !== -1 ? nextSection : content.length;

  content = content.slice(0, insertPos) + `\n${newRow}` + content.slice(insertPos);
  fs.writeFileSync(fp, content, "utf-8");
}
