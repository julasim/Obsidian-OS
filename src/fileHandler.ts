import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import type { Context } from "grammy";
import { WORKSPACE_PATH, VISION_MODEL, EXTRACT_MAX_CHARS, WHISPER_MODEL, WHISPER_LANG } from "./config.js";
import { ensureDir, resolveDir } from "./workspace/helpers.js";
import { logError, logInfo } from "./logger.js";

const execAsync = promisify(exec);

// Default-Fallback — Struktur wird primär via CLAUDE.md gesteuert.
const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR || "Attachments";

// ---- Helpers ----

function attachmentsDir(): string {
  const dir = resolveDir(WORKSPACE_PATH, ATTACHMENTS_DIR);
  ensureDir(dir);
  return dir;
}

async function downloadFile(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} beim Download`);
  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---- Voice Handler ----

/**
 * Transkribiert eine Sprachnachricht via lokales openai/whisper CLI.
 * Voraussetzung: pip install openai-whisper  (+ ffmpeg)
 *
 * Ablauf:
 *   1. OGG-Datei von Telegram herunterladen
 *   2. whisper CLI aufrufen → .txt Datei
 *   3. .txt lesen, beide temp-Dateien löschen
 *   4. Transkript zurückgeben
 */
export async function handleVoice(ctx: Context): Promise<string> {
  const voice = ctx.message?.voice;
  if (!voice) throw new Error("Keine Sprachnachricht");

  const file = await ctx.api.getFile(voice.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

  const buffer = await downloadFile(fileUrl);
  const tmpDir = attachmentsDir();
  const stem = `voice_${Date.now()}`;
  const oggPath = path.join(tmpDir, `${stem}.ogg`);
  const txtPath = path.join(tmpDir, `${stem}.txt`);
  fs.writeFileSync(oggPath, buffer);

  try {
    // whisper schreibt {stem}.txt in --output_dir
    const cmd = `whisper "${oggPath}" --model ${WHISPER_MODEL} --language ${WHISPER_LANG} --output_format txt --output_dir "${tmpDir}"`;
    logInfo(`[Whisper] ${cmd}`);
    await execAsync(cmd, { timeout: 120_000 }); // max 2 min

    if (!fs.existsSync(txtPath)) {
      throw new Error("Whisper hat keine .txt Datei erzeugt – ist whisper installiert? (pip install openai-whisper)");
    }
    const transcript = fs.readFileSync(txtPath, "utf-8").trim();
    logInfo(`[Whisper] "${transcript.slice(0, 80)}"`);
    return transcript;
  } finally {
    for (const p of [oggPath, txtPath]) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
}

// ---- Photo Handler ----

export async function handlePhoto(ctx: Context): Promise<string> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) throw new Error("Kein Foto");

  // Use highest resolution
  const photo = photos[photos.length - 1];
  const file = await ctx.api.getFile(photo.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

  const buffer = await downloadFile(fileUrl);
  const ext = file.file_path?.split(".").pop() || "jpg";
  const savePath = path.join(attachmentsDir(), `photo_${Date.now()}.${ext}`);
  fs.writeFileSync(savePath, buffer);

  const base64 = buffer.toString("base64");
  const mimeType = ext === "png" ? "image/png" : "image/jpeg";

  try {
    const { client } = await import("./llm/client.js"); // Ollama Vision-Modell
    const response = await client.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
            {
              type: "text",
              text: ctx.message?.caption
                ? `${ctx.message.caption}\n\nBeschreibe das Bild und extrahiere allen sichtbaren Text.`
                : "Beschreibe dieses Bild detailliert. Falls Text oder Handschrift sichtbar ist, transkribiere ihn vollstaendig.",
            },
          ],
        },
      ],
      max_tokens: 2000,
    });

    const description = response.choices[0].message.content ?? "Keine Beschreibung";
    const filename = path.relative(WORKSPACE_PATH, savePath).replace(/\\/g, "/");
    return `\u{1F4F8} Bild gespeichert: ${filename}\n\n${description}`;
  } catch (err) {
    const filename = path.relative(WORKSPACE_PATH, savePath).replace(/\\/g, "/");
    return `\u{1F4F8} Bild gespeichert: ${filename}\n(Vision-Analyse fehlgeschlagen: ${err})`;
  }
}

// ---- Document Handler ----

export async function handleDocument(ctx: Context): Promise<string> {
  const doc = ctx.message?.document;
  if (!doc) throw new Error("Kein Dokument");

  const file = await ctx.api.getFile(doc.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

  const buffer = await downloadFile(fileUrl);
  const filename = doc.file_name || `doc_${Date.now()}`;
  const savePath = path.join(attachmentsDir(), filename);
  fs.writeFileSync(savePath, buffer);

  const ext = path.extname(filename).toLowerCase();
  let extracted = "";

  try {
    if (ext === ".pdf") {
      const { extractPdf } = await import("./workspace/extractor.js");
      extracted = await extractPdf(savePath);
    } else if (ext === ".docx") {
      const { extractDocx } = await import("./workspace/extractor.js");
      extracted = await extractDocx(savePath);
    } else if (ext === ".txt" || ext === ".md") {
      extracted = buffer.toString("utf-8");
    }
  } catch (err) {
    logError("DocumentExtract", err);
  }

  if (extracted.length > EXTRACT_MAX_CHARS) {
    extracted = extracted.slice(0, EXTRACT_MAX_CHARS) + "\n\n[... gekuerzt]";
  }

  const relPath = path.relative(WORKSPACE_PATH, savePath).replace(/\\/g, "/");
  if (extracted) {
    return `\u{1F4C4} Dokument gespeichert: ${relPath}\n\n**Inhalt:**\n${extracted}`;
  }
  return `\u{1F4C4} Dokument gespeichert: ${relPath}\n(Kein Text-Inhalt extrahierbar fuer ${ext}-Dateien)`;
}

// ---- Registration ----

export function registerFileHandlers(
  bot: import("grammy").Bot,
  onMessage: (chatId: number, text: string, ctx: Context) => Promise<void>,
): void {
  // Voice messages → Whisper transcription → LLM
  bot.on("message:voice", (ctx) => {
    const chatId = ctx.chat.id;
    ctx.replyWithChatAction("typing").catch(() => {});
    (async () => {
      try {
        const text = await handleVoice(ctx);
        if (!text.trim()) {
          await ctx.reply("Konnte die Sprachnachricht nicht transkribieren.");
          return;
        }
        await ctx.reply(`\u{1F399}\uFE0F Transkription: _${text}_`, { parse_mode: "Markdown" }).catch(() =>
          ctx.reply(`Transkription: ${text}`),
        );
        await onMessage(chatId, text, ctx);
      } catch (err) {
        logError("Voice", err);
        const hint = String(err).includes("whisper")
          ? "Whisper nicht gefunden – installieren mit: pip install openai-whisper"
          : String(err);
        await ctx.reply(`🎤 Fehler: ${hint}`);
      }
    })().catch((e) => logError("Voice-unhandled", e));
  });

  // Photos → Vision → LLM
  bot.on("message:photo", (ctx) => {
    const chatId = ctx.chat.id;
    ctx.replyWithChatAction("typing").catch(() => {});
    (async () => {
      try {
        const description = await handlePhoto(ctx);
        await onMessage(chatId, description, ctx);
      } catch (err) {
        logError("Photo", err);
        await ctx.reply("Fehler beim Verarbeiten des Fotos.");
      }
    })().catch((e) => logError("Photo-unhandled", e));
  });

  // Documents → extractor → LLM
  bot.on("message:document", (ctx) => {
    const chatId = ctx.chat.id;
    ctx.replyWithChatAction("typing").catch(() => {});
    (async () => {
      try {
        const content = await handleDocument(ctx);
        await onMessage(chatId, content, ctx);
      } catch (err) {
        logError("Document", err);
        await ctx.reply("Fehler beim Verarbeiten des Dokuments.");
      }
    })().catch((e) => logError("Document-unhandled", e));
  });
}
