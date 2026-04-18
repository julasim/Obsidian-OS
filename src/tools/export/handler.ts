import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";
import { ensureDir, vaultPath, safePath } from "../_lib/vault.js";
import { EXPORT_DIR } from "../_lib/config.js";
import { readNoteContent, parseNote, safeFilename, stripInline } from "../_lib/note-content.js";
import { ok as fmtOk, err as fmtErr, relPath } from "../_lib/format.js";
import type { ToolHandler } from "../_lib/types.js";

// ---- PDF ---- ---- ---- ---- ---- ---- ---- ---- ---- ----

// ============================================================
// Markdown-Tabellen-Parser
// ============================================================

interface MdTable {
  headers: string[];
  alignments: ("left" | "center" | "right")[];
  rows: string[][];
}

/** Erkennt ob eine Zeile eine Markdown-Tabellen-Separator-Zeile ist (|---|---|) */
function isTableSeparator(line: string): boolean {
  return /^\|[\s:?-]+(\|[\s:?-]+)+\|?\s*$/.test(line);
}

/** Parsed Alignment aus der Separator-Zeile */
function parseAlignments(sepLine: string): ("left" | "center" | "right")[] {
  return sepLine
    .split("|")
    .filter((c) => c.trim())
    .map((cell) => {
      const trimmed = cell.trim();
      if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
      if (trimmed.endsWith(":")) return "right";
      return "left";
    });
}

/** Parsed eine Tabellen-Zeile in Zellen */
function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1) // fuehrendes | entfernen
    .map((c) => c.trim())
    .filter((_, i, arr) => i < arr.length); // trailendes leeres Element
}

/**
 * Versucht ab einer gegebenen Position im Line-Array eine Markdown-Tabelle zu parsen.
 * Gibt die Tabelle und die Anzahl konsumierter Zeilen zurueck, oder null.
 */
function tryParseTable(lines: string[], startIdx: number): { table: MdTable; consumed: number } | null {
  if (startIdx + 1 >= lines.length) return null;

  const headerLine = lines[startIdx];
  const sepLine = lines[startIdx + 1];

  // Muss | enthalten und Separator muss passen
  if (!headerLine.includes("|") || !isTableSeparator(sepLine)) return null;

  const headers = parseTableRow(headerLine).map((h) => stripInline(h));
  const alignments = parseAlignments(sepLine);
  const rows: string[][] = [];

  let i = startIdx + 2;
  while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
    rows.push(parseTableRow(lines[i]).map((c) => stripInline(c)));
    i++;
  }

  if (headers.length === 0) return null;

  return { table: { headers, alignments, rows }, consumed: i - startIdx };
}

// ============================================================
// PDF-Generator
// ============================================================

function generatePdf(title: string, body: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      bufferPages: true, // fuer Seitenzahlen
      info: {
        Title: title || "Export",
        Creator: "KI Tools",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 100; // 50 margin links + rechts

    // ---- Titel ----
    if (title) {
      doc
        .fontSize(22)
        .font("Helvetica-Bold")
        .text(title, { align: "center" });
      doc.moveDown(0.5);
      doc
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - 50, doc.y)
        .stroke();
      doc.moveDown(1);
    }

    // ---- Body rendern ----
    const lines = body.split("\n");
    let inCodeBlock = false;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Codeblock-Toggle
      if (line.match(/^```/)) {
        inCodeBlock = !inCodeBlock;
        if (inCodeBlock) {
          doc.moveDown(0.3);
          // Hintergrund-Hinweis (leichte Einrueckung)
        } else {
          doc.moveDown(0.3);
        }
        i++;
        continue;
      }

      if (inCodeBlock) {
        doc.fontSize(9).font("Courier").text(line, 60, undefined, { width: pageWidth - 10 });
        i++;
        continue;
      }

      // Tabelle erkennen
      const tableResult = tryParseTable(lines, i);
      if (tableResult) {
        renderTable(doc, tableResult.table, pageWidth);
        i += tableResult.consumed;
        continue;
      }

      // Headings
      if (line.match(/^#{1,3}\s/)) {
        const level = (line.match(/^(#+)/) as RegExpMatchArray)[1].length;
        const text = stripInline(line.replace(/^#+\s*/, ""));
        doc.moveDown(0.5);
        doc
          .fontSize(level === 1 ? 18 : level === 2 ? 15 : 13)
          .font("Helvetica-Bold")
          .text(text);
        doc.moveDown(0.3);
      }
      // Blockquote
      else if (line.match(/^>\s?/)) {
        const text = stripInline(line.replace(/^>\s?/, ""));
        doc.moveDown(0.2);
        // Vertikaler Strich links
        const y = doc.y;
        doc
          .fontSize(11)
          .font("Helvetica-Oblique")
          .text(text, 65, undefined, { width: pageWidth - 20, indent: 0 });
        const yEnd = doc.y;
        doc
          .save()
          .moveTo(57, y)
          .lineTo(57, yEnd)
          .lineWidth(2)
          .strokeColor("#999999")
          .stroke()
          .restore()
          .strokeColor("#000000")
          .lineWidth(1);
        doc.moveDown(0.2);
      }
      // Checkboxen
      else if (line.match(/^[-*]\s\[[ x]\]/)) {
        const checked = line.includes("[x]");
        const text = stripInline(line.replace(/^[-*]\s\[[ x]\]\s*/, ""));
        doc
          .fontSize(11)
          .font("Helvetica")
          .text(`  ${checked ? "\u2611" : "\u2610"}  ${text}`, { indent: 10 });
      }
      // Unordered List
      else if (line.match(/^[-*]\s/)) {
        const text = stripInline(line.replace(/^[-*]\s*/, ""));
        doc
          .fontSize(11)
          .font("Helvetica")
          .text(`  \u2022  ${text}`, { indent: 10 });
      }
      // Ordered List
      else if (line.match(/^\d+\.\s/)) {
        doc
          .fontSize(11)
          .font("Helvetica")
          .text(`  ${stripInline(line)}`, { indent: 10 });
      }
      // Horizontal Rule
      else if (line.match(/^---+$/)) {
        doc.moveDown(0.5);
        doc
          .moveTo(50, doc.y)
          .lineTo(doc.page.width - 50, doc.y)
          .stroke();
        doc.moveDown(0.5);
      }
      // Leerzeile
      else if (line.trim() === "") {
        doc.moveDown(0.5);
      }
      // Normaler Text
      else {
        doc.fontSize(11).font("Helvetica").text(stripInline(line));
      }

      i++;
    }

    // ---- Seitenzahlen ----
    const totalPages = doc.bufferedPageRange().count;
    for (let p = 0; p < totalPages; p++) {
      doc.switchToPage(p);
      doc
        .fontSize(9)
        .font("Helvetica")
        .text(
          `${p + 1} / ${totalPages}`,
          50,
          doc.page.height - 35,
          { align: "center", width: doc.page.width - 100 },
        );
    }

    doc.end();
  });
}

/** Rendert eine Markdown-Tabelle ins PDF */
function renderTable(
  doc: PDFKit.PDFDocument,
  table: MdTable,
  pageWidth: number,
): void {
  const colCount = table.headers.length;
  const colWidth = Math.floor(pageWidth / colCount);
  const startX = 50;

  doc.moveDown(0.5);

  // Header
  const headerY = doc.y;
  for (let c = 0; c < colCount; c++) {
    const x = startX + c * colWidth;
    const align = table.alignments[c] ?? "left";
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .text(table.headers[c] ?? "", x + 4, headerY, {
        width: colWidth - 8,
        align,
        lineBreak: false,
      });
  }
  const afterHeaderY = doc.y + 14;
  doc.y = afterHeaderY;

  // Header-Linie
  doc
    .moveTo(startX, afterHeaderY - 2)
    .lineTo(startX + colCount * colWidth, afterHeaderY - 2)
    .lineWidth(1)
    .stroke();

  // Rows
  for (const row of table.rows) {
    const rowY = doc.y + 2;
    let maxH = 14;
    for (let c = 0; c < colCount; c++) {
      const x = startX + c * colWidth;
      const cellText = row[c] ?? "";
      const align = table.alignments[c] ?? "left";
      doc
        .fontSize(10)
        .font("Helvetica")
        .text(cellText, x + 4, rowY, {
          width: colWidth - 8,
          align,
          lineBreak: false,
        });
      const cellH = doc.heightOfString(cellText, { width: colWidth - 8 });
      if (cellH > maxH) maxH = cellH;
    }
    doc.y = rowY + maxH + 2;

    // Zeilentrennlinie (duenn)
    doc
      .save()
      .moveTo(startX, doc.y)
      .lineTo(startX + colCount * colWidth, doc.y)
      .lineWidth(0.5)
      .strokeColor("#cccccc")
      .stroke()
      .restore()
      .strokeColor("#000000")
      .lineWidth(1);
  }

  doc.moveDown(0.5);
}

// ---- DOCX ---- ---- ---- ---- ---- ---- ---- ---- ---- ----

// ============================================================
// DOCX-Inline-Formatting
// ============================================================

function parseInlineFormatting(line: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|(?:^|\s)_([^_]+)_(?=\s|$)|([^*_]+))/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match[2]) runs.push(new TextRun({ text: match[2], bold: true }));
    else if (match[3]) runs.push(new TextRun({ text: match[3], italics: true }));
    else if (match[4]) {
      // Fuer _underscore_italic: das fuehrende Leerzeichen aus der Lookbehind-Gruppe reproduzieren
      if (match[0].startsWith(" ")) runs.push(new TextRun(" "));
      runs.push(new TextRun({ text: match[4], italics: true }));
    }
    else if (match[5]) runs.push(new TextRun(match[5]));
  }
  if (runs.length === 0) runs.push(new TextRun(line));
  return runs;
}

// ============================================================
// DOCX-Generator
// ============================================================

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

  let inCodeBlock = false;
  for (const line of body.split("\n")) {
    // Codeblock-Toggle
    if (line.match(/^```/)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, font: "Courier New", size: 20 })],
        }),
      );
      continue;
    }

    if (line.match(/^# /)) {
      children.push(
        new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }),
      );
    } else if (line.match(/^## /)) {
      children.push(
        new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }),
      );
    } else if (line.match(/^### /)) {
      children.push(
        new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }),
      );
    } else if (line.match(/^[-*]\s\[[ x]\]/)) {
      const checked = line.includes("[x]");
      const text = line.replace(/^[-*]\s\[[ x]\]\s*/, "");
      children.push(
        new Paragraph({
          children: [new TextRun(`${checked ? "\u2611" : "\u2610"} ${text}`)],
        }),
      );
    } else if (line.match(/^[-*]\s/)) {
      children.push(
        new Paragraph({
          children: [new TextRun(line.replace(/^[-*]\s*/, ""))],
          bullet: { level: 0 },
        }),
      );
    } else if (line.match(/^\d+\.\s/)) {
      const text = line.replace(/^\d+\.\s*/, "");
      children.push(
        new Paragraph({
          children: parseInlineFormatting(text),
          numbering: { reference: "default", level: 0 },
        }),
      );
    } else if (line.trim() === "") {
      children.push(new Paragraph({ text: "" }));
    } else {
      children.push(new Paragraph({ children: parseInlineFormatting(line) }));
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "default",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ============================================================
// Dispatcher
// ============================================================

export const handler: ToolHandler = async (args) => {
  const format = String(args.format ?? "").trim().toLowerCase();
  if (format !== "pdf" && format !== "docx") {
    return fmtErr(`Unbekanntes Format: "${format}". Erlaubt: pdf, docx`);
  }

  const name = String(args.name ?? "").trim();
  if (!name) return fmtErr("Kein Name angegeben");

  const content = readNoteContent(name);
  if (!content) return `Datei "${name}" nicht gefunden.`;

  const { title, body } = parseNote(content);
  const displayTitle = title || path.basename(name).replace(/\.md$/, "");

  try {
    // Custom Output-Pfad oder Default EXPORT_DIR
    let outDir = EXPORT_DIR;
    if (args.ausgabe) {
      const customDir = safePath(String(args.ausgabe).trim());
      if (!customDir) return fmtErr(`Ungueltiger Ausgabepfad: "${args.ausgabe}"`);
      outDir = customDir;
    }

    ensureDir(outDir);

    if (format === "pdf") {
      const buffer = await generatePdf(displayTitle, body);
      const filename = safeFilename(displayTitle, ".pdf");
      const outPath = path.resolve(outDir, filename);
      fs.writeFileSync(outPath, buffer);
      const rel = relPath(outPath, vaultPath);
      return fmtOk("export", "PDF exportiert", `"${displayTitle}"`, rel);
    } else {
      const buffer = await generateDocx(displayTitle, body);
      const filename = safeFilename(displayTitle, ".docx");
      const outPath = path.resolve(outDir, filename);
      fs.writeFileSync(outPath, buffer);
      const rel = relPath(outPath, vaultPath);
      return fmtOk("export", "DOCX exportiert", `"${displayTitle}"`, rel);
    }
  } catch (e) {
    return fmtErr(`${format.toUpperCase()}-Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  }
};
