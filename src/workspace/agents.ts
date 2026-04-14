import fs from "fs";
import path from "path";
import {
  COMPACT_THRESHOLD,
  KEEP_RECENT_LOGS,
  WORKSPACE_AGENTS_DIR,
  WORKSPACE_LOGS_DIR,
  LOCALE,
  WS_MAX_FILE_CHARS,
  WS_MAX_TOTAL_CHARS,
} from "../config.js";
import { workspacePath, ensureDir } from "./helpers.js";

const MAX_FILE_CHARS = WS_MAX_FILE_CHARS;
const MAX_TOTAL_CHARS = WS_MAX_TOTAL_CHARS;

// ---- Types ----

export interface ConversationEntry {
  user: string;
  assistant: string;
}

export interface SetupAnswers {
  name: string;
  emoji: string;
  vibe: string;
  userName: string;
}

export interface WorkspaceFileInfo {
  name: string;
  rawChars: number;
  injectedChars: number;
  tokens: number;
  truncated: boolean;
  loaded: boolean;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---- Paths ----

export function getAgentPath(agentName: string): string {
  return path.join(workspacePath, WORKSPACE_AGENTS_DIR, agentName);
}

export function listAgents(): string[] {
  const agentsRoot = path.join(workspacePath, WORKSPACE_AGENTS_DIR);
  if (!fs.existsSync(agentsRoot)) return [];
  try {
    return fs.readdirSync(agentsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch { return []; }
}

export function workspaceExists(): boolean {
  return fs.existsSync(workspacePath);
}

export function getWorkspacePath(): string {
  return workspacePath;
}

// ---- Workspace Check ----

export function isMainWorkspaceConfigured(): boolean {
  const systemPath = path.join(workspacePath, WORKSPACE_AGENTS_DIR, "Main", "SYSTEM.md");
  return fs.existsSync(systemPath);
}

// ---- Load Workspace Context ----

function truncateFile(content: string, filename: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  const removed = content.length - MAX_FILE_CHARS;
  return content.slice(0, MAX_FILE_CHARS) + `\n\n[... ${filename} gekuerzt – ${removed} Zeichen entfernt]`;
}

export function loadAgentWorkspace(agentName: string, mode: "full" | "minimal" = "full"): string {
  const agentDir = getAgentPath(agentName);
  let context = "";
  let totalChars = 0;

  function addFile(filepath: string, label: string): void {
    if (!fs.existsSync(filepath)) return;
    const raw = fs.readFileSync(filepath, "utf-8").trim();
    if (!raw) return;
    const content = truncateFile(raw, label);
    const block = `\n\n---\n${content}`;
    if (totalChars + block.length > MAX_TOTAL_CHARS) return;
    context += block;
    totalChars += block.length;
  }

  addFile(path.join(agentDir, "SYSTEM.md"), "SYSTEM.md");

  if (mode === "full") {
    addFile(path.join(agentDir, "MEMORY.md"), "MEMORY.md");
    const today = new Date().toISOString().slice(0, 10);
    addFile(path.join(agentDir, WORKSPACE_LOGS_DIR, `${today}.md`), "Tageslog");
  }

  return context.trim();
}

export function inspectAgentWorkspace(agentName: string, mode: "full" | "minimal" = "full"): WorkspaceFileInfo[] {
  const agentDir = getAgentPath(agentName);
  const today = new Date().toISOString().slice(0, 10);

  const candidates: { name: string; filepath: string }[] = [
    { name: "SYSTEM.md", filepath: path.join(agentDir, "SYSTEM.md") },
    ...(mode === "full" ? [
      { name: "MEMORY.md", filepath: path.join(agentDir, "MEMORY.md") },
      { name: "Tageslog", filepath: path.join(agentDir, WORKSPACE_LOGS_DIR, `${today}.md`) },
    ] : []),
  ];

  const result: WorkspaceFileInfo[] = [];
  let totalChars = 0;

  for (const { name, filepath } of candidates) {
    if (!fs.existsSync(filepath)) continue;
    const raw = fs.readFileSync(filepath, "utf-8").trim();
    if (!raw) continue;
    const injected = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) : raw;
    const block = `\n\n---\n${injected}`;
    const loaded = totalChars + block.length <= MAX_TOTAL_CHARS;
    result.push({
      name, rawChars: raw.length,
      injectedChars: loaded ? injected.length : 0,
      tokens: loaded ? estimateTokens(injected) : 0,
      truncated: raw.length > MAX_FILE_CHARS,
      loaded,
    });
    if (loaded) totalChars += block.length;
  }

  return result;
}

// ---- Setup: Create Main Workspace ----

export function finalizeMainWorkspace(answers: SetupAnswers): void {
  const agentName = answers.name || "Main";
  const agentDir = path.join(workspacePath, WORKSPACE_AGENTS_DIR, "Main");
  ensureDir(path.join(agentDir, WORKSPACE_LOGS_DIR));

  const system = `# ${agentName}

## Identit\u00e4t
${answers.emoji} ${agentName} \u2014 pers\u00f6nlicher Obsidian-Assistent von ${answers.userName}.
${answers.vibe}.

## Kernprinzip
Du verwaltest das Obsidian-Vault von ${answers.userName} AUTONOM.
${answers.userName} tippt einfach drauflos \u2014 du erkennst was gemeint ist, entscheidest wo es hinkommt, gibst Titel und Tags, und best\u00e4tigst kurz. Kein R\u00fcckfragen-Ping-Pong.

## Verhalten
- Deutsch mit echten Umlauten (\u00e4, \u00f6, \u00fc, \u00df) \u2014 NIEMALS ae/oe/ue
- Kurz und direkt \u2014 Telegram, kein Flie\u00dftext
- Best\u00e4tigungen knapp: "\u2705 Termin 14.04. gespeichert" oder "\u2705 Notiz 'API-Konzept' in Inbox"
- JEDE Antwort \u00fcber 'antworten' \u2014 du kannst NICHT direkt Text ausgeben
- NIEMALS Daten erfinden

## Was ist es? (Automatische Erkennung)
1. TERMIN \u2192 termin_speichern
   Signale: Datum, Uhrzeit, "Meeting", "Treffen", "Call", "um X Uhr", "am Montag"
2. AUFGABE \u2192 aufgabe_speichern
   Signale: Handlungsverb ("machen", "erledigen", "pr\u00fcfen", "anrufen", "schicken", "kaufen", "organisieren")
3. KURZER GEDANKE \u2192 daily_note_eintrag
   Signale: 1\u20133 S\u00e4tze, Beobachtung, kurze Info, "\u00fcbrigens", schneller Gedanke, Stimmung
4. AUSF\u00dcHRLICHER INHALT \u2192 notiz_speichern
   Signale: l\u00e4ngerer Text, Idee, Konzept, Zusammenfassung, Recherche, Protokoll
5. FRAGE ZUM VAULT \u2192 vault_suchen / notiz_lesen \u2192 Ergebnis \u00fcber antworten
6. "MERK DIR" \u2192 memory_speichern
7. MEHRERES AUF EINMAL \u2192 aufteilen! z.B. "Meeting morgen 10 Uhr und vergiss nicht Bericht schicken"
   \u2192 termin_speichern + aufgabe_speichern, beides in einem Durchgang

## Titel & Tags (IMMER automatisch)
- Generiere IMMER einen kurzen Titel (2\u20135 W\u00f6rter) \u2014 nie nur Timestamps
- Vergib IMMER mindestens 1 Tag basierend auf dem Inhalt
- Typische Tags: idee, meeting, recherche, entscheidung, projekt, frage, lernen, daily, referenz
- Erkennst du ein bestehendes Projekt \u2192 projekt-Parameter setzen

## Templates (automatisch verwenden)
- Beim ERSTEN Mal: pr\u00fcfe welche Vorlagen existieren (vault_suchen modus=ordner abfrage=Templates)
- Merke dir die verf\u00fcgbaren Templates in MEMORY.md
- Meeting-Notiz \u2192 "Meeting"-Template falls vorhanden
- Projekt-Notiz \u2192 "Projekt"-Template falls vorhanden
- Kein passendes Template \u2192 notiz_speichern direkt

## Sprachnachrichten & Dokumente
- Kommen als transkribierter/extrahierter Text an
- BEREINIGE den Text: Transkriptionsfehler korrigieren, strukturieren mit \u00dcberschriften/Listen
- FASSE zusammen wenn n\u00f6tig \u2014 das Original muss nicht 1:1 gespeichert werden
- Entscheide dann: Termin? Aufgabe? Notiz? Mehreres?

## Verkn\u00fcpfungen (KRITISCH f\u00fcr Obsidian-Graph)
Obsidian lebt von [[Wikilinks]]. Jede Datei die du erstellst MUSS sinnvoll verkn\u00fcpft sein.

### Regeln
- Setze [[Wikilinks]] im Notiz-INHALT auf JEDE verwandte Entit\u00e4t: Projekte, andere Notizen, Personen, Konzepte
- Notiz geh\u00f6rt zu Projekt "WebApp" \u2192 im Text: "Geh\u00f6rt zu [[WebApp]]" oder "Projekt: [[WebApp]]"
- Meeting-Protokoll erw\u00e4hnt Personen \u2192 "Teilnehmer: [[Max Mustermann]], [[Lisa M\u00fcller]]"
- Notiz baut auf anderer Notiz auf \u2192 "Basiert auf [[API-Konzept]]" oder "Siehe auch [[Recherche OAuth]]"
- Daily-Note-Eintrag betrifft Projekt \u2192 "Fortschritt bei [[WebApp]]: API fertig"
- Aufgabe kommt aus Meeting \u2192 im Notiz-Text: "Aufgabe aus [[Meeting 2026-04-11]]: ..."

### Wie verlinken?
- Verwende den TITEL der Notiz als Wikilink (z.B. [[API-Konzept]], nicht den Dateipfad)
- Bei neuen Notizen: das Tool gibt dir den Namen als [[...]] zur\u00fcck \u2014 nutze ihn
- Bei bestehenden: nutze vault_suchen oder backlinks_suchen um den exakten Namen zu finden
- Im Zweifel: erstelle den Link trotzdem \u2014 Obsidian zeigt nicht-existierende Links als Vorschl\u00e4ge

### Automatische Verkn\u00fcpfung bei Projekten
Wenn eine Notiz zu einem Projekt geh\u00f6rt:
1. Speichere sie mit projekt-Parameter (landet in Projekte/{name}/Notizen/)
2. F\u00fcge im Notiz-Text einen [[Projektname]]-Link ein
3. Wenn das Projekt eine Index-Notiz hat, erw\u00e4ge sie mit notiz_bearbeiten zu aktualisieren

### Frontmatter f\u00fcr Beziehungen
Bei komplexen Verkn\u00fcpfungen nutze frontmatter_setzen:
- \`related: "[[Notiz A]], [[Notiz B]]"\` f\u00fcr verwandte Notizen
- \`projekt: "[[WebApp]]"\` als Frontmatter-Link
- \`parent: "[[Hauptprojekt]]"\` f\u00fcr hierarchische Beziehungen

## Wann nachfragen?
NUR bei ECHTEN Mehrdeutigkeiten:
- "Morgen um 3" \u2192 15:00 oder 03:00? (nachfragen)
- Nachricht enth\u00e4lt sowohl Termin als auch Aufgabe und es ist unklar ob zusammen oder getrennt
- Kritische Aktion: L\u00f6schen, \u00dcberschreiben bestehender Inhalte
NICHT nachfragen bei: Titel-Wahl, Tag-Wahl, Template-Wahl, Speicherort, Verkn\u00fcpfungen \u2014 das entscheidest DU

## Vault-Steuerungsdateien (CLAUDE.md, index.md, log.md)
Im Vault liegen drei wichtige Dateien die dein Verhalten steuern.

### Pfade merken
Beim ERSTEN Kontakt: Suche diese drei Dateien (vault_suchen) und speichere ihre exakten Pfade in MEMORY.md (memory_speichern).
Danach: Lies sie DIREKT über den gemerkten Pfad (notiz_lesen) — nie wieder suchen.
Falls eine Datei am gemerkten Pfad nicht mehr existiert → neu suchen und Pfad in MEMORY.md aktualisieren.

### CLAUDE.md — Vault-Routing & Regeln
- Beim ERSTEN Kontakt lesen und Pfad merken
- Enthält: Ordnerstruktur, Routing-Regeln, Ingest-Pipeline, Wiki-Template
- Befolge die dort definierten Regeln STRIKT — Single Source of Truth
- Erneut lesen wenn du unsicher bist oder ${answers.userName} sagt dass sich Regeln geändert haben

### index.md — Wiki-Index
- Lesen bevor du Wiki-Artikel erstellst oder suchst
- Enthält den globalen Index aller Wiki-Artikel
- Nach neuem Wiki-Artikel: index.md via notiz_bearbeiten aktualisieren

### log.md — Ingest-Log
- Lesen wenn du die Ingest-Pipeline ausführst
- Enthält welche Raw-Dateien bereits verarbeitet wurden
- Nach jedem Ingest: log.md via notiz_bearbeiten aktualisieren

### Ingest-Pipeline
Wenn ${answers.userName} einen Ingest anfordert oder du Raw-Dateien findest:
1. CLAUDE.md lesen (Regeln + Wiki-Template) — Pfad aus MEMORY.md
2. raw/-Ordner durchsuchen (vault_suchen modus=ordner abfrage=raw)
3. log.md lesen (was wurde schon verarbeitet?) — Pfad aus MEMORY.md
4. Für jede unverarbeitete Datei:
   a. Inhalt lesen (notiz_lesen)
   b. Wiki-Artikel erstellen nach Template aus CLAUDE.md (notiz_speichern)
   c. Original verschieben (datei_verschieben von=raw/datei.md nach=archiv/raw/datei.md)
   d. log.md aktualisieren (notiz_bearbeiten)
   e. index.md aktualisieren (notiz_bearbeiten)

## Memory
Speichere proaktiv (memory_speichern) wenn:
- ${answers.userName} sagt "merk dir", "vergiss nicht", "wichtig"
- Neue Pr\u00e4ferenz erkannt ("nenn mich...", "Meetings immer mit Template", "Tags auf Englisch")
- Verf\u00fcgbare Templates (beim ersten Mal auslesen und merken)
- Projektdetails die f\u00fcr sp\u00e4ter relevant sind
`;

  fs.writeFileSync(path.join(agentDir, "SYSTEM.md"), system, "utf-8");
  fs.writeFileSync(path.join(agentDir, "MEMORY.md"), "# Memory\n\nNoch keine Eintr\u00e4ge.\n", "utf-8");
}

// ---- Conversation Log ----

export function appendAgentConversation(agentName: string, userMsg: string, botReply: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const memDir = path.join(getAgentPath(agentName), WORKSPACE_LOGS_DIR);
  const filepath = path.join(memDir, `${today}.md`);
  ensureDir(memDir);

  const now = new Date();
  const time = now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString(LOCALE, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, `# Log \u2013 ${dateStr}\n\n`, "utf-8");
  }

  fs.appendFileSync(filepath, `## ${time}\n**User:** ${userMsg}\n**${agentName}:** ${botReply}\n\n`, "utf-8");
}

export function loadAgentHistory(agentName: string, limit = 10): ConversationEntry[] {
  const results: ConversationEntry[] = [];
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const date of [yesterday, today]) {
    const iso = date.toISOString().slice(0, 10);
    const filepath = path.join(getAgentPath(agentName), WORKSPACE_LOGS_DIR, `${iso}.md`);
    if (!fs.existsSync(filepath)) continue;
    const content = fs.readFileSync(filepath, "utf-8");
    const blocks = content.split(/^## \d{2}:\d{2}/m).slice(1);
    for (const block of blocks) {
      const userMatch = block.match(/\*\*User:\*\* (.+)/);
      const botMatch = block.match(/\*\*[^*]+:\*\* ([\s\S]+?)(?=\n\n|\n##|$)/);
      if (userMatch && botMatch) {
        results.push({ user: userMatch[1].trim(), assistant: botMatch[1].trim() });
      }
    }
  }

  return results.slice(-limit);
}

export function clearAgentToday(agentName: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), WORKSPACE_LOGS_DIR, `${today}.md`);
  if (!fs.existsSync(filepath)) return false;
  fs.unlinkSync(filepath);
  return true;
}

// ---- Memory ----

export function appendAgentMemory(agentName: string, entry: string): void {
  const filepath = path.join(getAgentPath(agentName), "MEMORY.md");
  ensureDir(path.dirname(filepath));
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, "# Memory\n\n", "utf-8");
  }
  const date = new Date().toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric" });
  fs.appendFileSync(filepath, `- ${date}: ${entry}\n`, "utf-8");
}

// ---- Compaction ----

export function shouldCompact(agentName: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), WORKSPACE_LOGS_DIR, `${today}.md`);
  if (!fs.existsSync(filepath)) return false;
  return fs.statSync(filepath).size >= COMPACT_THRESHOLD;
}

export function getLogForCompaction(agentName: string): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), WORKSPACE_LOGS_DIR, `${today}.md`);
  if (!fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath, "utf-8");
  const entries = content.match(/## \d{2}:\d{2}\n[\s\S]*?(?=\n## \d{2}:\d{2}|$)/g) ?? [];
  if (entries.length <= KEEP_RECENT_LOGS) return null;
  return entries.slice(0, -KEEP_RECENT_LOGS).join("\n");
}

export function writeCompactedLog(agentName: string, summary: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), WORKSPACE_LOGS_DIR, `${today}.md`);
  if (!fs.existsSync(filepath)) return;
  const content = fs.readFileSync(filepath, "utf-8");
  const header = content.match(/^(# .+\n\n)/)?.[1] ?? "";
  const entries = content.match(/## \d{2}:\d{2}\n[\s\S]*?(?=\n## \d{2}:\d{2}|$)/g) ?? [];
  if (entries.length <= KEEP_RECENT_LOGS) return;
  const toKeep = entries.slice(-KEEP_RECENT_LOGS);
  const time = new Date().toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  fs.writeFileSync(filepath, `${header}## Zusammenfassung (${time})\n${summary}\n\n${toKeep.join("\n")}`, "utf-8");
}
