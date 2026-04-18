/**
 * Shared Primitives fuer Note-Content-Handling.
 * Genutzt von: export_pdf, export_docx, (notiz_lesen nutzt aehnliches direkt).
 */

import fs from "fs";
import { resolveNotePath, safePath } from "./vault.js";

/**
 * Liest Markdown-Inhalt einer Notiz anhand von Name, Wikilink oder Pfad.
 * Versucht erst fuzzy-Resolve (Wikilink/Name), dann direkten Pfad.
 * Gibt null zurueck wenn nicht gefunden.
 */
export function readNoteContent(nameOrPath: string): string | null {
  const resolved = resolveNotePath(nameOrPath);
  if (resolved && fs.existsSync(resolved)) {
    return fs.readFileSync(resolved, "utf-8");
  }
  const direct = safePath(nameOrPath);
  if (direct && fs.existsSync(direct)) {
    return fs.readFileSync(direct, "utf-8");
  }
  return null;
}

/**
 * Parsed Frontmatter + Body einer Notiz. Extrahiert `title:` aus dem
 * YAML-Block und entfernt eine duplizierte H1 wenn sie dem Titel entspricht.
 */
export function parseNote(content: string): { title: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { title: "", body: content.trim() };
  let title = "";
  for (const line of match[1].split("\n")) {
    const m = line.match(/^title:\s*(.+)/);
    if (m) {
      title = m[1].trim();
      break;
    }
  }
  let body = match[2].trim();
  if (title) {
    body = body
      .replace(
        new RegExp(
          `^# ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n?`,
        ),
        "",
      )
      .trim();
  }
  return { title, body };
}

/**
 * Bereinigt einen String zu einem sicheren Dateinamen (mit Umlaut-Support).
 * @param name  Basis-Name (ohne Extension)
 * @param ext   Extension inkl. Punkt (".pdf", ".docx")
 */
export function safeFilename(name: string, ext: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df\s_-]/g, "")
    .trim()
    .replace(/\.+$/, "") // trailing dots (Windows-kompatibel)
    .slice(0, 100);
  // Fallback wenn Name leer wird (z.B. nur Emoji-Titel)
  const base = cleaned || `export-${Date.now()}`;
  return base + ext;
}

/**
 * Entfernt Inline-Markdown-Formatierung fuer Plain-Text-Rendering (z.B. PDF).
 * Unterstuetzt: bold, italic, strikethrough, highlights, inline code, wikilinks.
 */
export function stripInline(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")     // ***bold italic***
    .replace(/\*\*(.+?)\*\*/g, "$1")          // **bold**
    .replace(/\*(.+?)\*/g, "$1")              // *italic*
    .replace(/_(.+?)_/g, "$1")                // _italic_
    .replace(/~~(.+?)~~/g, "$1")              // ~~strikethrough~~
    .replace(/==(.+?)==/g, "$1")              // ==highlight==
    .replace(/`(.+?)`/g, "$1")                // `inline code`
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")  // [[target|display]]
    .replace(/\[\[([^\]]+)\]\]/g, "$1");      // [[wikilink]]
}
