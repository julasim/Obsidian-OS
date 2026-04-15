import "dotenv/config";
import path from "path";

// ── LLM (Ollama) ─────────────────────────────────────────────────────────────
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
export const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "kimi-k2.5:cloud";
export const VISION_MODEL = process.env.VISION_MODEL || DEFAULT_MODEL;

// ── Whisper (lokal) ──────────────────────────────────────────────────────────
export const WHISPER_MODEL = process.env.WHISPER_MODEL || "large-v3";
export const WHISPER_LANG = process.env.WHISPER_LANG || "de";

// ── Agent ────────────────────────────────────────────────────────────────────
export const MAX_TOOL_ROUNDS = 5;

// ── Ged\u00e4chtnis ────────────────────────────────────────────────────────────────
export const MAX_HISTORY_CHARS = 60_000;
export const COMPACT_THRESHOLD = 8_000;
export const KEEP_RECENT_LOGS = 5;
export const HISTORY_LOAD_LIMIT = 10;
export const KEPT_TOOL_MESSAGES = 3;

// ── Workspace (technisch, nicht Vault-Struktur) ─────────────────────────────
// Vault-Struktur (Inbox/Daily/Templates/Projekte/...) wird via CLAUDE.md im Vault
// definiert und vom Bot via Tool-Parameter angesprochen. Hier nur System-Interne Pfade.
export const WORKSPACE_PATH = process.env.WORKSPACE_PATH ?? process.env.VAULT_PATH ?? "";
export const WORKSPACE_AGENTS_DIR = "Agents";
export const WORKSPACE_LOGS_DIR = "MEMORY_LOGS";

// System-Datenpfad (Agent-State, Memory, Logs) — getrennt vom User-Vault.
// Default: "./data" lokal; im Docker via ENV auf "/data" (eigenes Volume) gesetzt.
// Zweck: User-Vault (OneDrive) bleibt frei von Bot-Interna.
export const SYSTEM_DATA_PATH = process.env.SYSTEM_DATA_PATH
  ?? path.join(process.cwd(), "data");

// ── Dokumenten-Extraktion ──────────────────────────────────────────────────
export const EXTRACT_MAX_CHARS = 50_000;

// ── Sicherheit ───────────────────────────────────────────────────────────────
export const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID
  ? parseInt(process.env.ALLOWED_CHAT_ID, 10)
  : null;

// ── System ───────────────────────────────────────────────────────────────────
export const TIMEZONE = "Europe/Vienna";
export const LOCALE = "de-AT";
export const LOG_FILE = path.join(process.cwd(), "logs", "bot.log");

// ── Limits ───────────────────────────────────────────────────────────────────
export const TYPING_INTERVAL_MS = 4_000;
export const TOOL_OUTPUT_MAX_CHARS = 8_000;
export const MESSAGE_PREVIEW_LENGTH = 80;
export const MAX_FILE_SCAN = 1_000;
export const SEARCH_MAX_RESULTS = 20;
export const SEARCH_LINE_MAX = 200;
export const WS_MAX_FILE_CHARS = 20_000;
export const WS_MAX_TOTAL_CHARS = 150_000;

// ── Vault-Scan ──────────────────────────────────────────────────────────
export const SKIP_DIRS = new Set([".obsidian", ".git", ".trash", "node_modules", ".DS_Store"]);

// ── Logging ──────────────────────────────────────────────────────────────────
export const MAX_LOG_LINES = 500;
