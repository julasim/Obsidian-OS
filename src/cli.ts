#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const VERSION = "1.0.0";
const BRAND = "Obsidian-OS";

// ── Helpers ─────────────────────────────────────────────────────────────────

function col(text: string, code: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

const bold = (t: string) => col(t, "1");
const dim = (t: string) => col(t, "2");
const cyan = (t: string) => col(t, "36");
const green = (t: string) => col(t, "32");
const yellow = (t: string) => col(t, "33");
const red = (t: string) => col(t, "31");

function loadEnv(): Record<string, string> {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function mask(value: string | undefined): string {
  if (!value) return dim("nicht gesetzt");
  if (value.length > 12) return value.slice(0, 6) + "..." + value.slice(-4);
  return value.slice(0, 3) + "...";
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

// ── Commands ────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
${bold(cyan(`  ${BRAND} v${VERSION}`))}
  ${dim("Persoenlicher Obsidian-Vault-Assistent via Telegram")}

  ${bold("Verwendung:")} obsidian-os ${dim("<befehl>")}

  ${bold("Befehle:")}

    ${green("start")}          Bot starten (Produktion)
    ${green("dev")}            Bot starten (Entwicklung, auto-reload)
    ${green("status")}         Systemstatus anzeigen
    ${green("config")}         Konfiguration anzeigen
    ${green("logs")} ${dim("[n]")}       Letzte Log-Eintraege (Standard: 20)
    ${green("update")}         Update: pull + install + build
    ${green("build")}          TypeScript kompilieren
    ${green("version")}        Version anzeigen
    ${green("help")}           Diese Hilfe anzeigen

  ${bold("Ersteinrichtung:")}

    1. ${cyan("cp .env.example .env")}
    2. .env ausfuellen (BOT_TOKEN, WORKSPACE_PATH, OLLAMA_BASE_URL)
    3. ${cyan("obsidian-os start")}
    4. Bot im Telegram oeffnen ${dim("→")} Setup-Wizard startet automatisch
`);
}

function showVersion(): void {
  console.log(`${BRAND} v${VERSION}`);
}

function showStatus(): void {
  const env = loadEnv();
  const hasEnv = fileExists(".env");
  const hasDist = fileExists("dist/index.js");
  const hasModules = fileExists("node_modules");

  const vaultPath = env.WORKSPACE_PATH || env.VAULT_PATH;
  const vaultOk = vaultPath ? fs.existsSync(vaultPath) : false;

  const systemDataPath = env.SYSTEM_DATA_PATH || path.join(ROOT, "data");
  const systemDataOk = fs.existsSync(systemDataPath);

  const agentFile = path.join(systemDataPath, "Agents", "Main", "SYSTEM.md");
  const setupDone = fs.existsSync(agentFile);

  console.log(`
${bold(cyan(`  ${BRAND} Status`))}

  .env             ${hasEnv ? green("vorhanden") : red("fehlt")}
  node_modules     ${hasModules ? green("installiert") : red("fehlt — npm install")}
  Build (dist/)    ${hasDist ? green("kompiliert") : yellow("fehlt — obsidian-os build")}
  Vault            ${vaultOk ? green("erreichbar") : vaultPath ? red("nicht gefunden: " + vaultPath) : red("nicht konfiguriert")}
  System-Daten     ${systemDataOk ? green(systemDataPath) : yellow(systemDataPath + " (wird beim Start erstellt)")}
  Setup            ${setupDone ? green("abgeschlossen") : yellow("ausstehend — Bot starten")}
  Ollama           ${env.OLLAMA_BASE_URL || dim("http://localhost:11434/v1")}
  Modell           ${env.OLLAMA_MODEL || dim("kimi-k2.5:cloud")}
  Bot-Token        ${mask(env.BOT_TOKEN)}
`);
}

function showConfig(): void {
  const env = loadEnv();

  console.log(`
${bold(cyan(`  ${BRAND} Konfiguration`))}

  ${bold("Telegram")}
  BOT_TOKEN          ${mask(env.BOT_TOKEN)}
  ALLOWED_CHAT_ID    ${env.ALLOWED_CHAT_ID || dim("(alle)")}

  ${bold("Vault")}
  WORKSPACE_PATH     ${env.WORKSPACE_PATH || env.VAULT_PATH || dim("nicht gesetzt")}

  ${bold("LLM (Ollama)")}
  OLLAMA_BASE_URL    ${env.OLLAMA_BASE_URL || dim("http://localhost:11434/v1")}
  OLLAMA_MODEL       ${env.OLLAMA_MODEL || dim("kimi-k2.5:cloud")}
  OLLAMA_FAST_MODEL  ${env.OLLAMA_FAST_MODEL || dim("(= Hauptmodell)")}
  VISION_MODEL       ${env.VISION_MODEL || dim("(= Hauptmodell)")}

  ${bold("Whisper (lokal)")}
  WHISPER_MODEL      ${env.WHISPER_MODEL || dim("large-v3")}
  WHISPER_LANG       ${env.WHISPER_LANG || dim("de")}

  ${bold("Vault-Struktur (optional \u2014 gesteuert via CLAUDE.md im Vault)")}
  INBOX_DIR              ${env.INBOX_DIR || dim("Inbox")}
  DAILY_NOTES_DIR        ${env.DAILY_NOTES_DIR || dim("Daily")}
  TEMPLATES_DIR          ${env.TEMPLATES_DIR || dim("Templates")}
  ATTACHMENTS_DIR        ${env.ATTACHMENTS_DIR || dim("Attachments")}
  PROJECTS_DIR           ${env.PROJECTS_DIR || dim("Projekte")}
  PROJECT_NOTES_SUBDIR   ${env.PROJECT_NOTES_SUBDIR || dim("Notizen")}
`);
}

function showLogs(n: number): void {
  const logFile = path.join(ROOT, "logs", "bot.log");
  if (!fs.existsSync(logFile)) {
    console.log(dim("  Keine Logs vorhanden."));
    return;
  }
  const lines = fs.readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
  const recent = lines.slice(-n);
  console.log(`\n${bold(cyan(`  Letzte ${recent.length} Logs:`))}\n`);
  for (const line of recent) {
    if (line.includes("ERROR")) console.log("  " + red(line));
    else if (line.includes("WARN")) console.log("  " + yellow(line));
    else console.log("  " + dim(line));
  }
  console.log();
}

function runStart(): void {
  if (!fileExists("dist/index.js")) {
    console.log(yellow("  Build fehlt. Kompiliere..."));
    execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  }
  console.log(green(`  ${BRAND} wird gestartet...\n`));
  const child = spawn("node", ["dist/index.js"], { cwd: ROOT, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function runDev(): void {
  console.log(green(`  ${BRAND} Entwicklungsmodus...\n`));
  const child = spawn("npx", ["tsx", "watch", "src/index.ts"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function runBuild(): void {
  console.log(cyan("  Kompiliere TypeScript...\n"));
  try {
    execSync("npx tsc", { cwd: ROOT, stdio: "inherit" });
    console.log(green("\n  Build erfolgreich."));
  } catch {
    console.log(red("\n  Build fehlgeschlagen."));
    process.exit(1);
  }
}

function runUpdate(): void {
  console.log(bold(cyan(`\n  ${BRAND} Update\n`)));

  const steps: [string, string][] = [
    ["Git Pull", "git pull --rebase"],
    ["Dependencies", "npm install"],
    ["Build", "npm run build"],
  ];

  for (const [label, cmd] of steps) {
    console.log(`  ${dim(">")} ${label}...`);
    try {
      execSync(cmd, { cwd: ROOT, stdio: "inherit" });
      console.log(`  ${green("OK")}\n`);
    } catch {
      console.log(`  ${red("Fehler bei:")} ${cmd}`);
      process.exit(1);
    }
  }

  console.log(green(`  Update abgeschlossen. Starte mit: obsidian-os start\n`));
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();

switch (command) {
  case "start":
    runStart();
    break;
  case "dev":
    runDev();
    break;
  case "status":
    showStatus();
    break;
  case "config":
    showConfig();
    break;
  case "logs": {
    const n = Math.min(parseInt(args[1]) || 20, 100);
    showLogs(n);
    break;
  }
  case "build":
    runBuild();
    break;
  case "update":
    runUpdate();
    break;
  case "version":
  case "-v":
  case "--version":
    showVersion();
    break;
  case "help":
  case "-h":
  case "--help":
  default:
    showHelp();
    break;
}
