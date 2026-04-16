import type { ToolSchema } from "../types.js";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { readNote } from "../../workspace/notes.js";
import { readFile } from "../../workspace/files.js";
import { getFileSendFn } from "../context.js";
import type { HandlerMap } from "./types.js";

// ---- Helpers ----

function parseNote(content: string): { title: string; body: string } {
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
  // Wenn Titel aus Frontmatter kommt, erste H1 entfernen falls identisch
  if (title) {
    body = body.replace(new RegExp(`^# ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n?`), "").trim();
  }
  return { title, body };
}

function safeFilename(name: string, ext: string): string {
  return name.replace(/[^a-zA-Z0-9\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df\s_-]/g, "").trim().slice(0, 100) + ext;
}

/** Strip inline markdown (bold, italic, code) for PDF plain-text rendering */
function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

// ---- PDF Generator ----

function generatePdf(title: string, body: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (title) {
      doc.fontSize(22).font("Helvetica-Bold").text(title, { align: "center" });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
      doc.moveDown(1);
    }

    for (const line of body.split("\n")) {
      if (line.match(/^#{1,3}\s/)) {
        const level = (line.match(/^(#+)/) as RegExpMatchArray)[1].length;
        const text = line.replace(/^#+\s*/, "");
        doc.moveDown(0.5);
        doc.fontSize(level === 1 ? 18 : level === 2 ? 15 : 13).font("Helvetica-Bold").text(text);
        doc.moveDown(0.3);
      } else if (line.match(/^[-*]\s\[[ x]\]/)) {
        const checked = line.includes("[x]");
        const text = stripInline(line.replace(/^[-*]\s\[[ x]\]\s*/, ""));
        doc.fontSize(11).font("Helvetica").text(`  ${checked ? "[x]" : "[ ]"}  ${text}`, { indent: 10 });
      } else if (line.match(/^[-*]\s/)) {
        const text = stripInline(line.replace(/^[-*]\s*/, ""));
        doc.fontSize(11).font("Helvetica").text(`  \u2022  ${text}`, { indent: 10 });
      } else if (line.match(/^\d+\.\s/)) {
        doc.fontSize(11).font("Helvetica").text(`  ${stripInline(line)}`, { indent: 10 });
      } else if (line.match(/^---+$/)) {
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
        doc.moveDown(0.5);
      } else if (line.trim() === "") {
        doc.moveDown(0.5);
      } else {
        doc.fontSize(11).font("Helvetica").text(stripInline(line));
      }
    }

    doc.end();
  });
}

// ---- DOCX Generator ----

function parseInlineFormatting(line: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|([^*_]+))/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match[2]) runs.push(new TextRun({ text: match[2], bold: true }));
    else if (match[3]) runs.push(new TextRun({ text: match[3], italics: true }));
    else if (match[4]) runs.push(new TextRun({ text: match[4], italics: true }));
    else if (match[5]) runs.push(new TextRun(match[5]));
  }
  if (runs.length === 0) runs.push(new TextRun(line));
  return runs;
}

async function generateDocx(title: string, body: string): Promise<Buffer> {
  const children: Paragraph[] = [];

  if (title) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 36 })],
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      }),
    );
    children.push(new Paragraph({ text: "" }));
  }

  for (const line of body.split("\n")) {
    if (line.match(/^# /)) {
      children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
    } else if (line.match(/^## /)) {
      children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
    } else if (line.match(/^### /)) {
      children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
    } else if (line.match(/^[-*]\s\[[ x]\]/)) {
      const checked = line.includes("[x]");
      const text = line.replace(/^[-*]\s\[[ x]\]\s*/, "");
      children.push(new Paragraph({ children: [new TextRun(`${checked ? "\u2611" : "\u2610"} ${text}`)] }));
    } else if (line.match(/^[-*]\s/)) {
      children.push(
        new Paragraph({
          children: [new TextRun(line.replace(/^[-*]\s*/, ""))],
          bullet: { level: 0 },
        }),
      );
    } else if (line.match(/^\d+\.\s/)) {
      const text = line.replace(/^\d+\.\s*/, "");
      children.push(new Paragraph({ children: parseInlineFormatting(text), numbering: { reference: "default", level: 0 } }));
    } else if (line.trim() === "") {
      children.push(new Paragraph({ text: "" }));
    } else {
      children.push(new Paragraph({ children: parseInlineFormatting(line) }));
    }
  }

  const doc = new Document({
    numbering: {
      config: [{ reference: "default", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.START }] }],
    },
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ---- Tool Schemas ----

export const exportSchemas: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "export_pdf",
      description:
        "Exportiert eine Notiz oder Datei aus dem Vault als PDF und sendet sie dem Benutzer via Telegram. Verwende dieses Tool wenn der Benutzer ein PDF einer Notiz, eines Dokuments oder einer Zusammenfassung haben moechte.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Dateiname, Pfad oder Wikilink der zu exportierenden Notiz" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_docx",
      description:
        "Exportiert eine Notiz oder Datei aus dem Vault als Word-Dokument (DOCX) und sendet sie dem Benutzer via Telegram. Verwende dieses Tool wenn der Benutzer ein Word-Dokument haben moechte.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Dateiname, Pfad oder Wikilink der zu exportierenden Notiz" },
        },
        required: ["name"],
      },
    },
  },
];

// ---- Handlers ----

export const exportHandlers: HandlerMap = {
  export_pdf: async (args) => {
    const name = String(args.name || "");
    if (!name) return "Fehler: Kein Name angegeben.";

    const content = readNote(name) ?? readFile(name);
    if (!content) return `Datei "${name}" nicht gefunden.`;

    const sendFile = getFileSendFn();
    if (!sendFile) return "Fehler: Datei-Versand nicht verfuegbar.";

    const { title, body } = parseNote(content);
    const displayTitle = title || name.replace(/\.md$/, "");

    try {
      const buffer = await generatePdf(displayTitle, body);
      await sendFile(buffer, safeFilename(displayTitle, ".pdf"));
      return `PDF exportiert: ${displayTitle}`;
    } catch (err) {
      return `Fehler beim PDF-Export: ${err}`;
    }
  },

  export_docx: async (args) => {
    const name = String(args.name || "");
    if (!name) return "Fehler: Kein Name angegeben.";

    const content = readNote(name) ?? readFile(name);
    if (!content) return `Datei "${name}" nicht gefunden.`;

    const sendFile = getFileSendFn();
    if (!sendFile) return "Fehler: Datei-Versand nicht verfuegbar.";

    const { title, body } = parseNote(content);
    const displayTitle = title || name.replace(/\.md$/, "");

    try {
      const buffer = await generateDocx(displayTitle, body);
      await sendFile(buffer, safeFilename(displayTitle, ".docx"));
      return `Word-Dokument exportiert: ${displayTitle}`;
    } catch (err) {
      return `Fehler beim DOCX-Export: ${err}`;
    }
  },
};
