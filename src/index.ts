import "dotenv/config";
import fs from "fs";
import path from "path";
import { createBot } from "./bot.js";
import { logInfo, logError, logWarn } from "./logger.js";

const token = (process.env.BOT_TOKEN ?? "").trim();
const workspacePath = (process.env.WORKSPACE_PATH ?? process.env.VAULT_PATH ?? "").trim();

if (!token) throw new Error("BOT_TOKEN fehlt in .env");
if (!workspacePath) throw new Error("WORKSPACE_PATH (oder VAULT_PATH) fehlt in .env");

// ── Vault-Integritaet ─────────────────────────────────────────────────────
// Schutz gegen die "Phantom-Inbox"-Falle: wenn WORKSPACE_PATH existiert aber
// kein echter Obsidian-Vault ist (kein .obsidian/-Ordner, kein Inhalt),
// wuerde saveNote() stillschweigend in einen falschen Ordner schreiben.
// Besonders kritisch im Docker-Setup wenn OneDrive-Mount gescheitert ist:
// /vault existiert als leerer Container-FS-Ordner, Bot befuellt ihn, Daten
// sind beim naechsten `docker compose down` weg.
//
// Check: WORKSPACE_PATH muss existieren, Verzeichnis sein, und entweder
//   a) ein .obsidian/-Unterordner haben (echter Vault), ODER
//   b) via OBSIDIAN_UNSAFE=1 explizit erlaubt sein (leerer Vault fuer Erst-Setup)
try {
  const st = fs.statSync(workspacePath);
  if (!st.isDirectory()) {
    throw new Error(`WORKSPACE_PATH (${workspacePath}) ist kein Verzeichnis`);
  }
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  throw new Error(`WORKSPACE_PATH (${workspacePath}) nicht lesbar: ${msg}`);
}

const obsidianDir = path.join(workspacePath, ".obsidian");
const hasVaultMarker = fs.existsSync(obsidianDir);
const unsafe = process.env.OBSIDIAN_UNSAFE === "1";

if (!hasVaultMarker && !unsafe) {
  const msg = [
    `Kein .obsidian/-Ordner in WORKSPACE_PATH (${workspacePath}).`,
    "Das ist vermutlich kein echter Obsidian-Vault — moeglicherweise",
    "ist der OneDrive-Mount gescheitert. Bot startet NICHT, sonst landen",
    "Notizen im fluechtigen Container-FS.",
    "",
    "Fixes:",
    "  1) Mount pruefen: docker compose exec bot mountpoint /vault",
    "  2) RCLONE_TOKEN in .env setzen und Container neu starten, ODER",
    "  3) In deinem Obsidian-Vault wurde .obsidian/ ggf. noch nie erstellt —",
    "     Vault einmal in Obsidian-Desktop oeffnen damit der Ordner entsteht, ODER",
    "  4) Bewusst ohne Vault-Pruefung starten: OBSIDIAN_UNSAFE=1 in .env",
  ].join("\n");
  throw new Error(msg);
}
if (!hasVaultMarker && unsafe) {
  logWarn(`OBSIDIAN_UNSAFE=1 — starte ohne .obsidian/-Marker in ${workspacePath}`);
}

const bot = createBot(token);

// grammy-Level Fehler strukturiert loggen (409 Conflict, 401 Unauthorized, etc.)
bot.catch((err) => {
  logError("grammy", err.error ?? err);
});

bot.start().catch((err: unknown) => {
  // Typische Ursachen: ungueltiger BOT_TOKEN, zweite Instanz pollt parallel
  // (409 Conflict: "terminated by other getUpdates"), Netzwerkprobleme.
  logError("bot.start", err);
  process.exit(1);
});
logInfo("Obsidian-OS gestartet");

async function shutdown(signal: string): Promise<void> {
  logInfo(`${signal} empfangen — fahre herunter...`);
  try {
    await bot.stop();
  } catch { /* ignore */ }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logError("unhandledRejection", reason);
});
