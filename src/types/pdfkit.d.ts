declare module "pdfkit" {
  import { Readable } from "stream";

  interface PDFDocumentOptions {
    margin?: number;
    margins?: { top: number; bottom: number; left: number; right: number };
    size?: string | [number, number];
    layout?: "portrait" | "landscape";
  }

  class PDFDocument extends Readable {
    constructor(options?: PDFDocumentOptions);
    page: { width: number; height: number };
    x: number;
    y: number;
    fontSize(size: number): this;
    font(name: string): this;
    text(text: string, options?: Record<string, unknown>): this;
    text(text: string, x: number, y: number, options?: Record<string, unknown>): this;
    moveDown(lines?: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    stroke(): this;
    end(): void;
    addPage(options?: PDFDocumentOptions): this;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export default PDFDocument;
}
