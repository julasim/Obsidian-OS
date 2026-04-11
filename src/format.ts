/**
 * Konvertiert LLM-Markdown-Output zu Telegram HTML.
 * Telegram unterstützt: <b>, <i>, <u>, <s>, <code>, <pre>
 */
export function fmt(text: string): string {
  return (
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/```[\w]*\n?([\s\S]+?)```/g, "<pre>$1</pre>")
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
      .replace(/\*([^*\n]+?)\*/g, "<i>$1</i>")
      .replace(/__(.+?)__/gs, "<u>$1</u>")
      .replace(/_([^_\n]+?)_/g, "<i>$1</i>")
  );
}

/** Markdown-Markierungen für Plaintext-Fallback entfernen */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/\*([^*\n]+?)\*/g, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/_([^_\n]+?)_/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/```[\w]*\n?([\s\S]+?)```/g, "$1");
}
