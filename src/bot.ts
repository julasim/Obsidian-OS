import { Bot, InputFile } from "grammy";
import { saveNote, isMainWorkspaceConfigured } from "./workspace/index.js";
import { processMessage } from "./llm/runtime.js";
import { processSetup, isSetupActive, activateSetup } from "./llm/setup.js";
import { setReplyContext, setFileSendContext } from "./llm/executor.js";
import { logError } from "./logger.js";
import { enqueue } from "./queue.js";
import { fmt, stripMarkdown } from "./format.js";
import { TYPING_INTERVAL_MS, ALLOWED_CHAT_ID } from "./config.js";
import { registerFileHandlers } from "./fileHandler.js";
import type { Context } from "grammy";
import {
  handleHilfe,
  handleStatus,
  handleKontext,
  handleKompakt,
  handleNeu,
} from "./commands/system.js";

function withTyping(ctx: Context): { stop: () => void } {
  ctx.replyWithChatAction("typing").catch(() => {});
  const id = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), TYPING_INTERVAL_MS);
  return { stop: () => clearInterval(id) };
}

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
  bot.command("status", (ctx) => handleStatus(ctx));
  bot.command("kontext", (ctx) => handleKontext(ctx));
  bot.command("kompakt", (ctx) => handleKompakt(ctx));
  bot.command("neu", (ctx) => handleNeu(ctx));

  // Text messages -> LLM
  bot.on("message:text", (ctx) => {
    enqueue(ctx.chat.id, async () => {
      const raw = ctx.message.text;

      // Setup wizard
      if (!isMainWorkspaceConfigured() || isSetupActive()) {
        if (!isSetupActive()) activateSetup();
        const typing = withTyping(ctx);
        try {
          const antwort = await processSetup(raw);
          await safeReply(ctx, antwort);
        } catch (err) {
          logError("Setup", err);
          await ctx.reply("Fehler beim Setup \u2014 ist der LLM-Provider erreichbar?");
        } finally {
          typing.stop();
        }
        return;
      }

      // Normal message -> agent
      const typing = withTyping(ctx);
      try {
        setReplyContext((msg) => safeReply(ctx, msg).then(() => {}));
        setFileSendContext(async (buffer, filename) => {
          await ctx.replyWithDocument(new InputFile(new Uint8Array(buffer), filename));
        });
        const antwort = await processMessage(raw);
        await safeReply(ctx, antwort);
      } catch (err: unknown) {
        logError("LLM", err);
        try {
          const filepath = saveNote(raw);
          const filename = filepath.split(/[\\/]/).pop();
          await ctx.reply(`LLM nicht erreichbar \u2014 als Notiz gespeichert: ${filename}`);
        } catch {
          await ctx.reply("Fehler \u2014 LLM nicht erreichbar.");
        }
      } finally {
        typing.stop();
      }
    });
  });

  // File handlers (voice, photo, document)
  registerFileHandlers(bot, async (chatId, text, ctx) => {
    enqueue(chatId, async () => {
      const typing = withTyping(ctx);
      try {
        setReplyContext((msg) => safeReply(ctx, msg).then(() => {}));
        setFileSendContext(async (buffer, filename) => {
          await ctx.replyWithDocument(new InputFile(new Uint8Array(buffer), filename));
        });
        const antwort = await processMessage(text);
        await safeReply(ctx, antwort);
      } catch (err) {
        logError("LLM", err);
        await ctx.reply("LLM nicht erreichbar.");
      } finally {
        typing.stop();
      }
    });
  });

  return bot;
}
