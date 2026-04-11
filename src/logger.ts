import fs from "fs";
import path from "path";
import { LOG_FILE, MAX_LOG_LINES, TIMEZONE } from "./config.js";

let lineCount = -1;

// ── Structured Log Format ────────────────────────────────────────────────────

export interface LogEntry {
  ts: string;
  level: "info" | "error" | "warn";
  ctx?: string;
  msg: string;
  err?: string;
}

function isoNow(): string {
  return new Date().toISOString();
}

function humanTimestamp(): string {
  return new Date().toLocaleString("de-AT", { timeZone: TIMEZONE });
}

// ── File I/O ─────────────────────────────────────────────────────────────────

function ensureLogDir(): void {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function initLineCount(): void {
  if (lineCount >= 0) return;
  try {
    if (fs.existsSync(LOG_FILE)) {
      lineCount = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean).length;
    } else {
      lineCount = 0;
    }
  } catch {
    lineCount = 0;
  }
}

function append(line: string): void {
  ensureLogDir();
  initLineCount();
  fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
  lineCount++;
  if (lineCount > MAX_LOG_LINES) trimLog();
}

function trimLog(): void {
  try {
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const trimmed = lines.slice(-MAX_LOG_LINES);
    fs.writeFileSync(LOG_FILE, trimmed.join("\n") + "\n", "utf-8");
    lineCount = trimmed.length;
  } catch {
    /* Fehler beim Trimmen ist nicht kritisch */
  }
}

// ── JSONL-Log (maschinenlesbar) ──────────────────────────────────────────────

const jsonlPath = LOG_FILE.replace(/\.log$/, ".jsonl");

function appendJsonl(entry: LogEntry): void {
  try {
    ensureLogDir();
    fs.appendFileSync(jsonlPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    /* JSONL-Fehler ist nicht kritisch */
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function logInfo(msg: string, ctx?: string): void {
  const humanLine = `[${humanTimestamp()}] INFO  ${ctx ? `[${ctx}] ` : ""}${msg}`;
  console.log(humanLine);
  append(humanLine);
  appendJsonl({ ts: isoNow(), level: "info", ctx, msg });
}

export function logWarn(msg: string, ctx?: string): void {
  const humanLine = `[${humanTimestamp()}] WARN  ${ctx ? `[${ctx}] ` : ""}${msg}`;
  console.warn(humanLine);
  append(humanLine);
  appendJsonl({ ts: isoNow(), level: "warn", ctx, msg });
}

export function logError(context: string, err: unknown): void {
  const errMsg = err instanceof Error ? err.message : String(err);
  const humanLine = `[${humanTimestamp()}] ERROR [${context}] ${errMsg}`;
  console.error(humanLine);
  append(humanLine);
  appendJsonl({
    ts: isoNow(),
    level: "error",
    ctx: context,
    msg: errMsg,
    err: err instanceof Error ? err.stack : undefined,
  });
}

export function readRecentLogs(n = 20): string {
  if (!fs.existsSync(LOG_FILE)) return "Keine Logs vorhanden.";
  const lines = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
  return lines.slice(-n).join("\n") || "Keine Logs vorhanden.";
}
