/**
 * Konfiguration fuer alle Tools — primaer ueber ENV gesteuert.
 *
 * Erwartete Umgebungsvariablen:
 *
 * --- LLM-Provider ---
 *   LLM_API_KEY       API-Key (oder OPENROUTER_API_KEY als Alias)
 *   LLM_BASE_URL      API-Endpoint (Default: OpenRouter https://openrouter.ai/api/v1)
 *   LLM_MODEL         Modellname (Default: anthropic/claude-sonnet-4)
 *   LLM_APP_NAME      App-Name fuer OpenRouter-Header X-Title (Default: "KI Tools")
 *   LLM_APP_URL       App-URL fuer OpenRouter-Header HTTP-Referer (optional)
 *
 * --- Vault ---
 *   VAULT_PATH        absoluter Pfad zum Vault (Pflicht fuer alle Datei-Tools)
 *   LOCALE            z.B. "de-AT" (Default)
 *   TIMEZONE          z.B. "Europe/Vienna" (Default)
 *   INBOX_DIR         Ordnername fuer Inbox (Default "Inbox")
 *   DAILY_NOTES_DIR   Ordnername fuer Daily Notes (Default "Daily")
 *   PROJECTS_DIR      Ordnername fuer Projekte (Default "Projekte")
 *   PROJECT_NOTES_SUBDIR  Unterordner fuer Projekt-Notizen (Default "Notizen")
 *   TASKS_FILE        Standardziel fuer aufgabe_erfassen (Default "Aufgaben.md")
 *   TERMINE_FILE      Standardziel fuer termin_erfassen (Default "Termine.md")
 *   SYSTEM_DATA_PATH  Pfad fuer Bot-State (Memory) — fuer memory_speichern
 *   EXPORT_DIR        Ausgabeordner fuer export_pdf / export_docx (Default ./exports)
 */

// ---- LLM-Provider ----

/** API-Key — akzeptiert LLM_API_KEY oder OPENROUTER_API_KEY */
export const LLM_API_KEY: string =
  process.env.LLM_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "";

/** Base-URL — Default ist OpenRouter. Fuer Ollama: http://localhost:11434/v1 */
export const LLM_BASE_URL: string =
  process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1";

/** Modellname — OpenRouter-Format: provider/model */
export const LLM_MODEL: string =
  process.env.LLM_MODEL ?? "anthropic/claude-sonnet-4";

/** App-Name fuer OpenRouter X-Title Header (Ranking/Credits-Dashboard) */
export const LLM_APP_NAME: string =
  process.env.LLM_APP_NAME ?? "KI Tools";

/** App-URL fuer OpenRouter HTTP-Referer Header (optional) */
export const LLM_APP_URL: string =
  process.env.LLM_APP_URL ?? "";

// ---- Vault ----

export const VAULT_PATH: string =
  process.env.VAULT_PATH ?? process.env.WORKSPACE_PATH ?? "";

export const LOCALE: string = process.env.LOCALE ?? "de-AT";
export const TIMEZONE: string = process.env.TIMEZONE ?? "Europe/Vienna";

export const INBOX_DIR: string = process.env.INBOX_DIR ?? "Inbox";
export const DAILY_NOTES_DIR: string = process.env.DAILY_NOTES_DIR ?? "Daily";
export const PROJECTS_DIR: string = process.env.PROJECTS_DIR ?? "Projekte";
export const PROJECT_NOTES_SUBDIR: string =
  process.env.PROJECT_NOTES_SUBDIR ?? "Notizen";

export const DEFAULT_TASK_FILE: string = process.env.TASKS_FILE ?? "Aufgaben.md";
export const DEFAULT_TERMIN_FILE: string =
  process.env.TERMINE_FILE ?? "Termine.md";

export const SYSTEM_DATA_PATH: string =
  process.env.SYSTEM_DATA_PATH ?? "./data";

/** Ausgabeordner fuer Export-Tools (PDF/DOCX). Default: ./exports */
export const EXPORT_DIR: string = process.env.EXPORT_DIR ?? "./exports";

// ---- Knowledge-System (Two-Tier Memory) ----

/** Hot-Cache-Datei im Vault-Root. Default: KNOWLEDGE.md */
export const KNOWLEDGE_FILE: string =
  process.env.KNOWLEDGE_FILE ?? "KNOWLEDGE.md";

/** Deep-Storage-Ordner im Vault. Default: knowledge */
export const KNOWLEDGE_DIR: string =
  process.env.KNOWLEDGE_DIR ?? "knowledge";

/** Verzeichnisse, die beim Vault-Walk ignoriert werden */
export const SKIP_DIRS: Set<string> = new Set([
  ".obsidian",
  ".git",
  ".trash",
  "node_modules",
  ".DS_Store",
]);

/** Limits */
export const SEARCH_MAX_RESULTS = 20;
export const SEARCH_LINE_MAX = 200;
export const MAX_FILE_SCAN = 1_000;
export const TOOL_OUTPUT_MAX_CHARS = 8_000;
