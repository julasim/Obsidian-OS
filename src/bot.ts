import { Bot } from "grammy";
import { saveNote, isMainWorkspaceConfigured } from "./workspace/index.js";
import { processMessage, processBtw } from "./llm/runtime.js";
import { processSetup, isSetupActive, activateSetup } from "./llm/setup.js";
import { setReplyContext } from "./llm/executor.js";
import { logError } from "./logger.js";
import { enqueue } from "./queue.js";
import { fmt, stripMarkdown } from "./format.js";
import { TYPING_INTERVAL_MS, ALLOWED_CHAT_ID } from "./config.js";
import { registerFileHandlers } from "./fileHandler.js";
import type { Context } from "grammy";
import {
  handleHilfe,
  handleStatus,
  handleSprache,
  handleKontext,
  handleKompakt,
  handleNeu,
  handleCommands,
  handleWhoami,
  handleExportSession,
  handleModel,
  handleFast,
  handleHeute,
  handleDaily,
  handleConfig,
  handleRestart,
  handleLogs,
} from "./commands/system.js";

async function safeReply(
  ctx: { reply: (text: string, opts?: object) => Promise<unknown> },
  text: string,
): Promise<void> {
  try {
    await ctx.reply(fmt(text), { parse_mode: "HTML" });
  } catch {
    await ctx.reply(stripMarkdown(text));
  }
}

function isAllowed(ctx: Context): boolean {
  if (!ALLOWED_CHAT_ID) return true;
  return ctx.chat?.id === ALLOWED_CHAT_ID;
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Security middleware
  bot.use(async (ctx, next) => {
    if (!isAllowed(ctx)) return;
    await next();
  });

  // Commands
  bot.command("start", (ctx) => handleHilfe(ctx));
  bot.command("hilfe", (ctx) => handleHilfe(ctx));
  bot.command("commands", (ctx) => handleCommands(ctx));
  bot.command("status", (ctx) => handleStatus(ctx));
  bot.command("kontext", (ctx) => handleKontext(ctx));
  bot.command("kompakt", (ctx) => handleKompakt(ctx));
  bot.command("neu", (ctx) => handleNeu(ctx));
  bot.command("whoami", (ctx) => handleWhoami(ctx));
  bot.command("export", (ctx) => handleExportSession(ctx));
  bot.command("model", (ctx) => handleModel(ctx, ctx.match));
  bot.command("fast", (ctx) => handleFast(ctx));
  bot.command("sprache", (ctx) => handleSprache(ctx, ctx.match));
  bot.command("heute", (ctx) => handleHeute(ctx));
  bot.command("daily", (ctx) => handleDaily(ctx));
  bot.command("config", (ctx) => handleConfig(ctx));
  bot.command("restart", (ctx) => handleRestart(ctx));
  bot.command("logs", (ctx) => handleLogs(ctx, ctx.match));

  // Text messages -> LLM
  bot.on("message:text", (ctx) => {
    enqueue(ctx.chat.id, async () => {
      const raw = ctx.message.text;

      // Setup wizard
      if (!isMainWorkspaceConfigured() || isSetupActive()) {
        if (!isSetupActive()) activateSetup();
        const typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), TYPING_INTERVAL_MS);
        await ctx.replyWithChatAction("typing");
        try {
          const antwort = await processSetup(raw);
          clearInterval(typing);
          await safeReply(ctx, antwort);
        } catch (err) {
          clearInterval(typing);
          logError("Setup", err);
          await ctx.reply("Fehler beim Setup \u2014 ist Ollama erreichbar?");
        }
        return;
      }

      // /btw — direct answer without tools
      const btwMatch = raw.match(/^\/btw\s+(.+)/is);
      if (btwMatch) {
        const typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), TYPING_INTERVAL_MS);
        await ctx.replyWithChatAction("typing");
        try {
          const antwort = await processBtw(btwMatch[1].trim());
          clearInterval(typing);
          await safeReply(ctx, antwort);
        } catch {
          clearInterval(typing);
          await ctx.reply("Fehler bei /btw \u2014 ist Ollama erreichbar?");
        }
        return;
      }

      // Normal message -> agent
      const typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), TYPING_INTERVAL_MS);
      await ctx.replyWithChatAction("typing");
      try {
        setReplyContext((msg) => safeReply(ctx, msg).then(() => {}));
        const antwort = await processMessage(raw);
        clearInterval(typing);
        await safeReply(ctx, antwort);
      } catch (err: unknown) {
        clearInterval(typing);
        logError("LLM", err);
        try {
          const filepath = saveNote(raw);
          const filename = filepath.split(/[\\/]/).pop();
          await ctx.reply(`LLM nicht erreichbar \u2014 als Notiz gespeichert: ${filename}`);
        } catch {
          await ctx.reply("Fehler \u2014 ist Ollama erreichbar?");
        }
      }
    });
  });

  // File handlers (voice, photo, document)
  registerFileHandlers(bot, async (chatId, text, ctx) => {
    enqueue(chatId, async () => {
      const typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), TYPING_INTERVAL_MS);
      await ctx.replyWithChatAction("typing");
      try {
        setReplyContext((msg) => safeReply(ctx, msg).then(() => {}));
        const antwort = await processMessage(text);
        clearInterval(typing);
        await safeReply(ctx, antwort);
      } catch (err) {
        clearInterval(typing);
        logError("LLM", err);
        await ctx.reply("LLM nicht erreichbar.");
      }
    });
  });

  return bot;
}
