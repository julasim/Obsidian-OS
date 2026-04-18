/**
 * Konvertiert LLM-Markdown-Output zu Telegram HTML.
 *
 * Telegram unterstuetzt: <b>, <i>, <u>, <s>, <code>, <pre>
 * NICHT unterstuetzt: Tabellen, Listen, Ueberschriften, Blockquotes
 *
 * Strategie fuer nicht-HTML-kompatibles Markdown:
 *   - Tabellen  → in <pre> packen (monospace behaelt Spalten-Alignment)
 *   - Headers   → in <b> konvertieren (## Ueberschrift → <b>Ueberschrift</b>)
 *   - Horizontal Rules (---)  → einfach Leerzeile
 *
 * Reihenfolge wichtig:
 *   1. Code-Blocks + Inline-Code raus (per Placeholder) — ihr Inhalt wird
 *      nicht markdown-parsed
 *   2. Tabellen-Bloecke raus (per Placeholder als <pre>)
 *   3. HTML-Escape aller restlichen Zeichen
 *   4. Headers + inline-Markdown in Tags umwandeln
 *   5. Placeholder zurueckschreiben, Inhalt separat HTML-escaped
 */
export function fmt(text: string): string {
  const placeholders: { tag: "pre" | "code"; content: string }[] = [];
  const put = (tag: "pre" | "code", content: string): string => {
    const n = placeholders.length;
    placeholders.push({ tag, content });
    return `\u0000PH${n}\u0000`;
  };

  // 1a. Fenced Code-Blocks (```)
  let work = text.replace(/```[\w]*\n?([\s\S]+?)```/g, (_m, c: string) => put("pre", c));

  // 1b. Inline-Code (`...`)
  work = work.replace(/`([^`\n]+)`/g, (_m, c: string) => put("code", c));

  // 2. Markdown-Tabellen als <pre> — erkennt zwei aufeinanderfolgende
  //    Zeilen mit Pipe-Syntax. Nimmt die ganze Tabelle (inkl. Separator).
  const isTableLine = (s: string): boolean => /^\s*\|.*\|\s*$/.test(s);
  const lines = work.split("\n");
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableLine(lines[i]) && i + 1 < lines.length && isTableLine(lines[i + 1])) {
      const rows: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      result.push(put("pre", rows.join("\n")));
    } else {
      result.push(lines[i]);
      i++;
    }
  }
  work = result.join("\n");

  // 3. HTML-Escape fuer den restlichen Text (Placeholder sind ASCII-sicher)
  work = work
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 4a. Headers (# ... ######) → <b>...</b>
  work = work.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*$/gm, "<b>$1</b>");

  // 4b. Horizontal Rules (---, ***, ___) → Leerzeile (Telegram hat kein <hr>)
  work = work.replace(/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "");

  // 4c. Inline-Markdown
  work = work
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/\*([^*\n]+?)\*/g, "<i>$1</i>")
    .replace(/__(.+?)__/gs, "<u>$1</u>")
    .replace(/_([^_\n]+?)_/g, "<i>$1</i>");

  // 5. Placeholder zurueckschreiben, Inhalt HTML-escapen
  work = work.replace(/\u0000PH(\d+)\u0000/g, (_m, num: string) => {
    const ph = placeholders[parseInt(num, 10)];
    const esc = ph.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<${ph.tag}>${esc}</${ph.tag}>`;
  });

  // 6. Ueberzaehlige Leerzeilen zusammenfalten (nach HR-Strip)
  work = work.replace(/\n{3,}/g, "\n\n");

  return work.trim();
}

/** Markdown-Markierungen für Plaintext-Fallback entfernen */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\w]*\n?([\s\S]+?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/\*([^*\n]+?)\*/g, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/_([^_\n]+?)_/g, "$1");
}
