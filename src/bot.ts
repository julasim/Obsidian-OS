import { Bot, InputFile } from "grammy";
import { saveNote, isMainWorkspaceConfigured } from "./workspace/index.js";
import { processMessage } from "./llm/runtime.js";
import { processSetup, isSetupActive, activateSetup } from "./llm/setup.js";
import { withCallContext } from "./llm/context.js";
import { logError, logWarn } from "./logger.js";
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

// Telegram-Nachrichten-Limit: 4096 Zeichen. HTML-Tags zaehlen mit, deshalb
// konservativ auf 3800 gecappt — laesst Spielraum fuer <b>...</b> Overhead
// und Metadaten ("(1/3)"-Prefixes bei Mehrteilern).
const TG_MAX_CHARS = 3800;

/**
 * Splitet einen langen Text in Telegram-taugliche Chunks.
 * Versucht an Absatzgrenzen (\n\n), dann an Zeilenumbruechen, dann an Leerzeichen
 * zu splitten. Letzter Notfall: harter Cut nach TG_MAX_CHARS.
 */
function splitForTelegram(text: string): string[] {
  if (text.length <= TG_MAX_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > TG_MAX_CHARS) {
    let cut = remaining.lastIndexOf("\n\n", TG_MAX_CHARS);
    if (cut < TG_MAX_CHARS / 2) cut = remaining.lastIndexOf("\n", TG_MAX_CHARS);
    if (cut < TG_MAX_CHARS / 2) cut = remaining.lastIndexOf(" ", TG_MAX_CHARS);
    if (cut < 0) cut = TG_MAX_CHARS;

    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function safeReply(
  ctx: { reply: (text: string, opts?: object) => Promise<unknown> },
  text: string,
): Promise<void> {
  const parts = splitForTelegram(text);
  const total = parts.length;
  for (let i = 0; i < total; i++) {
    const prefix = total > 1 ? `(${i + 1}/${total}) ` : "";
    const chunk = prefix + parts[i];
    try {
      await ctx.reply(fmt(chunk), { parse_mode: "HTML" });
    } catch {
      try {
        await ctx.reply(stripMarkdown(chunk));
      } catch (err) {
        // Letzter Rettungsanker — wenn auch das scheitert, User wenigstens
        // informieren dass was nicht stimmt.
        logError("safeReply", err);
        await ctx.reply("Fehler beim Senden der Antwort (zu lang oder ungueltige Formatierung).").catch(() => {});
      }
    }
  }
}

function isAllowed(ctx: Context): boolean {
  if (!ALLOWED_CHAT_ID) return true;
  return ctx.chat?.id === ALLOWED_CHAT_ID;
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Security middleware — frueher wurden abgelehnte Nachrichten KOMPLETT
  // stillschweigend verworfen. Das fuehrte dazu dass User mit falscher
  // ALLOWED_CHAT_ID minutenlang rateten warum der Bot nichts tut. Jetzt:
  // einmal pro Chat-ID warnen, damit Misconfig in den Logs sichtbar wird.
  const loggedDeniedIds = new Set<number>();
  bot.use(async (ctx, next) => {
    if (!isAllowed(ctx)) {
      const cid = ctx.chat?.id;
      if (cid !== undefined && !loggedDeniedIds.has(cid)) {
        loggedDeniedIds.add(cid);
        logWarn(`Zugriff verweigert fuer chat_id=${cid} (ALLOWED_CHAT_ID=${ALLOWED_CHAT_ID}). Falls das dein Chat ist: ALLOWED_CHAT_ID in .env korrigieren.`);
      }
      return;
    }
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
        const antwort = await withCallContext(
          {
            replyFn: (msg) => safeReply(ctx, msg).then(() => {}),
            fileSendFn: async (buffer, filename) => {
              await ctx.replyWithDocument(new InputFile(new Uint8Array(buffer), filename));
            },
          },
          () => processMessage(raw),
        );
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
        const antwort = await withCallContext(
          {
            replyFn: (msg) => safeReply(ctx, msg).then(() => {}),
            fileSendFn: async (buffer, filename) => {
              await ctx.replyWithDocument(new InputFile(new Uint8Array(buffer), filename));
            },
          },
          () => processMessage(text),
        );
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
