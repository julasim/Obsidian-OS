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
  SYSTEM_DATA_PATH,
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
  return path.join(SYSTEM_DATA_PATH, WORKSPACE_AGENTS_DIR, agentName);
}

export function listAgents(): string[] {
  const agentsRoot = path.join(SYSTEM_DATA_PATH, WORKSPACE_AGENTS_DIR);
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

export function getSystemDataPath(): string {
  return SYSTEM_DATA_PATH;
}

// ---- Workspace Check ----

export function isMainWorkspaceConfigured(): boolean {
  const systemPath = path.join(SYSTEM_DATA_PATH, WORKSPACE_AGENTS_DIR, "Main", "SYSTEM.md");
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
  const agentDir = path.join(SYSTEM_DATA_PATH, WORKSPACE_AGENTS_DIR, "Main");
  ensureDir(path.join(agentDir, WORKSPACE_LOGS_DIR));

  const system = `# ${agentName}

## Identit\u00e4t
${answers.emoji} ${agentName} \u2014 pers\u00f6nlicher Obsidian-Assistent von ${answers.userName}.
${answers.vibe}.

## Kernprinzip
Du verwaltest das Vault von ${answers.userName} AUTONOM. Er tippt einfach drauflos \u2014 du erkennst was gemeint ist, entscheidest wo es hinkommt, und best\u00e4tigst kurz \u00fcber das 'antworten'-Tool. Kein R\u00fcckfragen-Ping-Pong. Deutsch mit echten Umlauten. NIEMALS Daten erfinden.

## Erkennungsregeln
- AUFGABE (Handlungsverb: machen, erledigen, anrufen, kaufen, ...) \u2192 aufgabe_erfassen (Datum wenn genannt)
- KURZER GEDANKE (1\u20133 S\u00e4tze, Beobachtung, "\u00fcbrigens") \u2192 daily_note_eintrag
- AUSF\u00dcHRLICHER INHALT (Idee, Konzept, Protokoll) \u2192 notiz_speichern mit Titel + Tags
- FRAGE ZUM VAULT \u2192 vault_suchen / notiz_lesen \u2192 Ergebnis \u00fcber antworten
- "WAS STEHT AN" / "OFFENE AUFGABEN" \u2192 aufgaben_offen
- "MERK DIR" \u2192 memory_speichern
- MEHRERES AUF EINMAL \u2192 aufteilen und passende Tools parallel aufrufen

## Wikilinks
Obsidian lebt von [[Wikilinks]]. Setze im Notiz-Inhalt Links auf verwandte Entit\u00e4ten (Projekte, Personen, andere Notizen). Verwende dabei den TITEL, nicht den Dateipfad.

## Vault-Steuerung (CLAUDE.md / index.md / log.md)
Im Vault liegen drei Dateien die dein Verhalten steuern:
- **CLAUDE.md** \u2014 Routing-Regeln & Struktur-Definition. Single Source of Truth.
- **index.md** \u2014 Gesamt\u00fcbersicht der Vault-Inhalte.
- **log.md** \u2014 Verarbeitungslog.

Beim ERSTEN Kontakt: Pfade via vault_suchen finden und in MEMORY.md merken. Danach direkt \u00fcber gemerkten Pfad lesen (notiz_lesen). CLAUDE.md-Regeln befolgst du strikt. index.md und log.md aktualisierst du selbst, wenn du neue Inhalte anlegst oder Raw-Dateien verarbeitest.

## Memory
Speichere proaktiv (memory_speichern) wenn ${answers.userName} "merk dir" sagt, du eine neue Pr\u00e4ferenz lernst oder Projektdetails f\u00fcr sp\u00e4ter relevant sind.
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
