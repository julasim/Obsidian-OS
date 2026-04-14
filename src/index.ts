import "dotenv/config";
import { createBot } from "./bot.js";
import { logInfo } from "./logger.js";
import { migrateAgentsFromVault } from "./workspace/agents.js";

const token = process.env.BOT_TOKEN;
const workspacePath = process.env.WORKSPACE_PATH ?? process.env.VAULT_PATH;

if (!token) throw new Error("BOT_TOKEN fehlt in .env");
if (!workspacePath) throw new Error("WORKSPACE_PATH (oder VAULT_PATH) fehlt in .env");

// Einmalige Migration: Agents/ aus User-Vault -> SYSTEM_DATA_PATH (no-op wenn bereits migriert)
migrateAgentsFromVault();

const bot = createBot(token);

bot.start();
logInfo("Obsidian-OS gestartet");

async function shutdown(signal: string): Promise<void> {
  logInfo(`${signal} empfangen — fahre herunter...`);
  try { bot.stop(); } catch { /* ignore */ }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
