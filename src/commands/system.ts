import type { Context } from "grammy";
import {
  workspaceExists,
  getWorkspacePath,
  inspectAgentWorkspace,
  clearAgentToday,
  loadAgentHistory,
} from "../workspace/index.js";
import { readRecentLogs, logError } from "../logger.js";
import {
  TYPING_INTERVAL_MS,
  LOG_DEFAULT_LINES,
  LOG_MAX_DISPLAY_LINES,
  LOG_DISPLAY_MAX_CHARS,
} from "../config.js";
import fs from "fs";

const HILFE = `
Obsidian-OS \u2014 Dein pers\u00f6nlicher Vault-Assistent

Schreib einfach los \u2014 ich erledige alles via KI.
Notizen, Aufgaben, Termine, Daily Notes, Suche \u2192 einfach tippen.
Sprachnachrichten, Fotos und Dokumente werden automatisch verarbeitet.

/heute    Tages-Briefing
/daily    Daily Note anzeigen
/status   Bot-Status
/config   Konfiguration
/kontext  Kontext-Auslastung
/kompakt  Log komprimieren
/neu      Kontext zur\u00fccksetzen
/model    Modell wechseln
/fast     Fast-Modus
/export   Session exportieren
/logs     Fehler-Logs
/restart  Neu starten
`.trim();

export async function handleHilfe(ctx: Context): Promise<void> {
  await ctx.reply(HILFE);
}

export async function handleStatus(ctx: Context): Promise<void> {
  const vault = workspaceExists();
  const wp = getWorkspacePath();

  let inboxCount = 0;
  let taskCount = 0;

  if (vault) {
    const inboxPath = `${wp}/Inbox`;
    const tasksPath = `${wp}/data/tasks.json`;
    if (fs.existsSync(inboxPath)) {
      inboxCount = fs.readdirSync(inboxPath).filter((f) => f.endsWith(".md")).length;
    }
    if (fs.existsSync(tasksPath)) {
      try {
        const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
        taskCount = tasks.filter((t: { status: string }) => t.status !== "done").length;
      } catch { /* ignore */ }
    }
  }

  await ctx.reply(`
Obsidian-OS Status

Vault: ${vault ? "\u2713 erreichbar" : "\u2717 nicht gefunden"}
Pfad: ${wp}
Notizen (Inbox): ${inboxCount}
Offene Aufgaben: ${taskCount}

Ollama: ${process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1"}
Modell: ${process.env.OLLAMA_MODEL || "kimi-k2.5:cloud"}
  `.trim());
}

export async function handleKontext(ctx: Context): Promise<void> {
  const files = inspectAgentWorkspace("Main", "full");
  if (!files.length) {
    await ctx.reply("Kein Workspace gefunden.");
    return;
  }

  const totalInjected = files.filter((f) => f.loaded).reduce((s, f) => s + f.injectedChars, 0);
  const totalTokens = files.filter((f) => f.loaded).reduce((s, f) => s + f.tokens, 0);

  const lines = files.map((f) => {
    const size = f.rawChars >= 1000 ? `${(f.rawChars / 1000).toFixed(1)}k` : `${f.rawChars}`;
    const flags = [!f.loaded ? "SKIP" : "", f.truncated ? "CUT" : ""].filter(Boolean).join(" ");
    return `${f.name.padEnd(12)} ${size.padStart(5)} Z  (~${f.tokens} tok)${flags ? "  \u26A0 " + flags : ""}`;
  });

  await ctx.reply([
    "\u{1F4CA} Kontext-Auslastung",
    "\u2500".repeat(32),
    ...lines,
    "\u2500".repeat(32),
    `Gesamt: ${(totalInjected / 1000).toFixed(1)}k Z (~${totalTokens} tok)`,
    `Auslastung: ${Math.round((totalInjected / 150_000) * 100)}%`,
  ].join("\n"));
}

export async function handleNeu(ctx: Context): Promise<void> {
  const cleared = clearAgentToday("Main");
  await ctx.reply(cleared ? "Kontext zur\u00fcckgesetzt." : "Kein heutiger Verlauf.");
}

export async function handleKompakt(ctx: Context): Promise<void> {
  const { compactNow } = await import("../llm/compaction.js");
  await ctx.replyWithChatAction("typing");
  await ctx.reply(await compactNow("Main"));
}

export async function handleCommands(ctx: Context): Promise<void> {
  await ctx.reply(`
Obsidian-OS \u2013 Commands

/heute        Tages-Briefing
/daily        Daily Note
/status       Bot-Status
/config       Konfiguration
/kontext      Kontext-Auslastung
/kompakt      Log komprimieren
/neu          Kontext zur\u00fccksetzen
/model [name] Modell wechseln
/fast         Fast-Modus
/export       Session exportieren
/logs [n]     Letzte n Logs
/whoami       Chat-ID
/sprache      Whisper-Sprache
/restart      Neu starten
  `.trim());
}

export async function handleWhoami(ctx: Context): Promise<void> {
  const user = ctx.from;
  const lines = [
    `Chat-ID: ${ctx.chat?.id}`,
    user?.username ? `@${user.username}` : null,
    user?.first_name ? `${user.first_name}${user.last_name ? " " + user.last_name : ""}` : null,
  ].filter(Boolean);
  await ctx.reply(lines.join("\n"));
}

export async function handleExportSession(ctx: Context): Promise<void> {
  const history = loadAgentHistory("Main", 100);
  if (!history.length) {
    await ctx.reply("Kein Verlauf f\u00fcr heute.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines = history.map((h) => `User: ${h.user}\nAgent: ${h.assistant}`).join("\n\n---\n\n");
  const content = `# Session Export \u2013 ${today}\n\n${lines}\n`;

  const wp = getWorkspacePath();
  const exportDir = `${wp}/Exports`;
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(`${exportDir}/session_${today}.md`, content, "utf-8");

  await ctx.reply(`\u2705 Exportiert: Exports/session_${today}.md`);
}

export async function handleModel(ctx: Context, args: string): Promise<void> {
  const { getModel, getSubagentModel, isFastMode, setModel } = await import("../llm/client.js");
  const name = args?.trim();
  if (!name) {
    await ctx.reply(`Modell: ${getModel()}\nSub-Agent: ${getSubagentModel()}\nFast: ${isFastMode() ? "an" : "aus"}\n\n/model <name> zum Wechseln`);
    return;
  }
  setModel(name);
  await ctx.reply(`\u2705 Modell: ${name}`);
}

export async function handleFast(ctx: Context): Promise<void> {
  const { toggleFast, getModel } = await import("../llm/client.js");
  const fast = toggleFast();
  await ctx.reply(fast ? `\u26A1 Fast-Modus an \u2014 ${getModel()}` : `\u{1F422} Normal \u2014 ${getModel()}`);
}

export async function handleSprache(ctx: Context, args: string): Promise<void> {
  const lang = args?.trim().toLowerCase();
  if (!["de", "en", "auto"].includes(lang)) {
    await ctx.reply("/sprache de|en|auto");
    return;
  }
  process.env.WHISPER_LANG = lang;
  await ctx.reply(`Whisper-Sprache: ${lang}`);
}

export async function handleHeute(ctx: Context): Promise<void> {
  const typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), TYPING_INTERVAL_MS);
  await ctx.replyWithChatAction("typing");
  try {
    const { processAgent } = await import("../llm/runtime.js");
    const { fmt, stripMarkdown } = await import("../format.js");
    const antwort = await processAgent("Main",
      "Erstelle ein Tages-Briefing: (1) daily_note_lesen, (2) termine_auflisten, (3) aufgaben_auflisten. Kurz und strukturiert.",
      "full");
    clearInterval(typing);
    try { await ctx.reply(fmt(antwort), { parse_mode: "HTML" }); }
    catch { await ctx.reply(stripMarkdown(antwort)); }
  } catch (err) {
    clearInterval(typing);
    logError("Heute", err);
    await ctx.reply("Fehler beim Briefing.");
  }
}

export async function handleDaily(ctx: Context): Promise<void> {
  const typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), TYPING_INTERVAL_MS);
  await ctx.replyWithChatAction("typing");
  try {
    const { getOrCreateDailyNote } = await import("../workspace/index.js");
    const content = getOrCreateDailyNote();
    clearInterval(typing);
    const out = content.length > 3800 ? content.slice(0, 3800) + "\n\n[... gek\u00fcrzt]" : content;
    await ctx.reply(out);
  } catch (err) {
    clearInterval(typing);
    logError("Daily", err);
    await ctx.reply("Fehler beim Daily Note.");
  }
}

export async function handleRestart(ctx: Context): Promise<void> {
  await ctx.reply("Neustart...");
  setTimeout(() => process.exit(0), 500);
}

export async function handleLogs(ctx: Context, args: string): Promise<void> {
  const n = Math.min(parseInt(args?.trim()) || LOG_DEFAULT_LINES, LOG_MAX_DISPLAY_LINES);
  const logs = readRecentLogs(n);
  const out = logs.length > LOG_DISPLAY_MAX_CHARS ? "...\n" + logs.slice(-LOG_DISPLAY_MAX_CHARS) : logs;
  await ctx.reply(`Letzte ${n} Logs:\n\n${out}`);
}

export async function handleConfig(ctx: Context): Promise<void> {
  const token = process.env.BOT_TOKEN ?? "\u2013";
  const masked = token.length > 10 ? token.slice(0, 8) + "..." + token.slice(-4) : "\u2013";

  await ctx.reply([
    "Obsidian-OS Konfiguration",
    "",
    `BOT_TOKEN:     ${masked}`,
    `VAULT:         ${process.env.WORKSPACE_PATH ?? process.env.VAULT_PATH ?? "\u2013"}`,
    `OLLAMA:        ${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1"}`,
    `MODELL:        ${process.env.OLLAMA_MODEL ?? "kimi-k2.5:cloud"}`,
    `VISION:        ${process.env.VISION_MODEL ?? "(= Hauptmodell)"}`,
    `WHISPER:       lokal (${process.env.WHISPER_MODEL ?? "large-v3"})`,
    `CHAT_ID:       ${process.env.ALLOWED_CHAT_ID ?? "(alle)"}`,
  ].join("\n"));
}
