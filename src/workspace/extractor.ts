import fs from "fs";
import path from "path";
import { EXTRACT_MAX_CHARS } from "../config.js";

function truncate(text: string): string {
  return text.length > EXTRACT_MAX_CHARS
    ? text.slice(0, EXTRACT_MAX_CHARS) + `\n\n[... gekürzt – ${text.length - EXTRACT_MAX_CHARS} Zeichen entfernt]`
    : text;
}

export interface ExtractionResult {
  text: string;
  format: "pdf" | "docx" | "text" | "unsupported";
}

/** Extract text from a PDF file */
export async function extractPdf(filePath: string): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return truncate(data.text.trim());
}

/** Extract text from a DOCX/DOC file */
export async function extractDocx(filePath: string): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ path: filePath });
  return truncate(result.value.trim());
}

/** Dispatch to correct extractor based on MIME type or file extension */
export async function extractDocument(
  filePath: string,
  mimeType?: string,
): Promise<ExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();
  const mime = mimeType ?? "";

  if (mime === "application/pdf" || ext === ".pdf") {
    return { text: await extractPdf(filePath), format: "pdf" };
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword" ||
    ext === ".docx" ||
    ext === ".doc"
  ) {
    return { text: await extractDocx(filePath), format: "docx" };
  }

  if (mime.startsWith("text/") || ext === ".md" || ext === ".txt") {
    return { text: truncate(fs.readFileSync(filePath, "utf-8")), format: "text" };
  }

  return { text: "", format: "unsupported" };
}
