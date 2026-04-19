import "dotenv/config";
import path from "path";

// ── Helpers ──────────────────────────────────────────────────────────────────
// trim + CR-strip: schuetzt gegen CRLF-editierte .env, trailing spaces nach Paste.
const env = (k: string): string => (process.env[k] ?? "").replace(/\r/g, "").trim();

// ── LLM (Provider-agnostisch: OpenRouter / Ollama / OpenAI / etc.) ───────────
// Priority-Chain: LLM_* > OPENROUTER_* > Ollama-Fallback
//
// Kritisch: frueher fiel LLM_API_KEY auf "ollama" zurueck wenn alle leer waren,
// was bei gesetztem LLM_BASE_URL=https://openrouter.ai/... zu einem 401 fuehrte
// (Key="ollama" an OpenRouter geschickt). Jetzt: _isLocal wird sauber aus
// OLLAMA_BASE_URL oder localhost-URL abgeleitet, nicht aus dem Key-Fallback.
const _llmKey = env("LLM_API_KEY");
const _orKey = env("OPENROUTER_API_KEY");
const _ollamaBase = env("OLLAMA_BASE_URL");
const _llmBase = env("LLM_BASE_URL");

const _isLocal =
  _ollamaBase !== "" ||
  (_llmBase !== "" && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(_llmBase)) ||
  (_llmKey === "ollama");

export const LLM_API_KEY = _llmKey || _orKey || (_isLocal ? "ollama" : "");
export const LLM_BASE_URL = _llmBase || _ollamaBase || (_isLocal ? "http://localhost:11434/v1" : "https://openrouter.ai/api/v1");
export const DEFAULT_MODEL = env("LLM_MODEL") || env("OLLAMA_MODEL") || (_isLocal ? "qwen2.5:7b" : "openrouter/elephant-alpha");

export const VISION_MODEL = process.env.VISION_MODEL || DEFAULT_MODEL;

/** OpenRouter-spezifische Header (werden von anderen Providern ignoriert) */
export const LLM_APP_NAME = process.env.LLM_APP_NAME ?? "Obsidian-OS";
export const LLM_APP_URL = process.env.LLM_APP_URL ?? "";

/** True wenn LLM auf localhost laeuft (Ollama) */
export const LLM_IS_LOCAL = LLM_BASE_URL.includes("localhost") || LLM_BASE_URL.includes("127.0.0.1");

// ── Whisper (lokal) ──────────────────────────────────────────────────────────
export const WHISPER_MODEL = process.env.WHISPER_MODEL || "large-v3";
export const WHISPER_LANG = process.env.WHISPER_LANG || "de";

// ── Agent ────────────────────────────────────────────────────────────────────
// Zweistufiges Budget:
// - SOFT: ab dieser Runde bekommt das LLM eine "bitte langsam wrappen"-Message
//   eingeschoben, um Fokus zu schaerfen. Normale Tool-Calls laufen weiter.
// - HARD: echte Obergrenze. In der letzten Runde wird tool_choice auf antworten
//   gezwungen, damit der User nie im generischen Fallback landet.
// Real-World: viele-Tasks-abarbeiten + lesen + zusammenfassen kann 20+ Runden
// brauchen — hart 15 war zu knapp. Hard-Cap 80 schuetzt vor Runaway-Loops.
export const MAX_TOOL_ROUNDS = Number(process.env.MAX_TOOL_ROUNDS ?? 80);
export const SOFT_TOOL_ROUNDS = Number(process.env.SOFT_TOOL_ROUNDS ?? 25);

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
// Frueher: `ALLOWED_CHAT_ID ? parseInt(...) : null` — wenn .env "ALLOWED_CHAT_ID=abc"
// oder "ALLOWED_CHAT_ID= " enthielt, ergab parseInt NaN, und der isAllowed-Check
// verglich ctx.chat.id === NaN (immer false) → kompletter Bot-Lockout, ohne
// Hinweis in den Logs. Jetzt: Nur numerische Werte werden akzeptiert.
const _chatIdRaw = env("ALLOWED_CHAT_ID");
const _chatIdNum = _chatIdRaw ? Number(_chatIdRaw) : NaN;
export const ALLOWED_CHAT_ID: number | null =
  Number.isFinite(_chatIdNum) && Number.isInteger(_chatIdNum) ? _chatIdNum : null;
if (_chatIdRaw && ALLOWED_CHAT_ID === null) {
  // Sofort bei Boot loggen — sonst laeuft Bot mit offener Whitelist unbemerkt.
  // (Dynamischer Import vermeidet Circular-Dep zwischen config und logger.)
  import("./logger.js").then(({ logWarn }) =>
    logWarn(`ALLOWED_CHAT_ID="${_chatIdRaw}" ist keine gueltige Zahl — ignoriert, Whitelist offen!`),
  ).catch(() => { /* ignore */ });
}

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
