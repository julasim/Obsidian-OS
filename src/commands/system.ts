import type { Context } from "grammy";
import {
  workspaceExists,
  getWorkspacePath,
  inspectAgentWorkspace,
  clearAgentToday,
} from "../workspace/index.js";
import { LLM_BASE_URL, DEFAULT_MODEL } from "../config.js";
import fs from "fs";

const HILFE = `
Obsidian-OS \u2014 Dein pers\u00f6nlicher Vault-Assistent

Schreib einfach los \u2014 ich erledige alles via KI.
Notizen, Daily Notes, Suche \u2192 einfach tippen.
Sprachnachrichten, Fotos und Dokumente werden automatisch verarbeitet.

/status   Bot-Status
/kontext  Kontext-Auslastung
/kompakt  Log komprimieren
/neu      Kontext zur\u00fccksetzen
`.trim();

export async function handleHilfe(ctx: Context): Promise<void> {
  await ctx.reply(HILFE);
}

export async function handleStatus(ctx: Context): Promise<void> {
  const vault = workspaceExists();
  const wp = getWorkspacePath();

  let inboxCount = 0;

  if (vault) {
    const inboxPath = `${wp}/Inbox`;
    if (fs.existsSync(inboxPath)) {
      inboxCount = fs.readdirSync(inboxPath).filter((f) => f.endsWith(".md")).length;
    }
  }

  const chatId = ctx.chat?.id ?? "?";

  await ctx.reply(`
Obsidian-OS Status

Vault: ${vault ? "\u2713 erreichbar" : "\u2717 nicht gefunden"}
Pfad: ${wp}
Notizen (Inbox): ${inboxCount}

LLM: ${LLM_BASE_URL}
Modell: ${DEFAULT_MODEL}

Chat-ID: ${chatId}  (fuer ALLOWED_CHAT_ID in .env)
  `.trim());
}

export async function handleKontext(ctx: Context): Promise<void> {
  const files = inspectAgentWorkspace("Main");
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
