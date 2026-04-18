/**
 * Generische Typen fuer alle Tools in dieser Bibliothek.
 * Kompatibel mit OpenAI-Chat-Completions-API (tools/tool_choice).
 */

/** Schema-Format fuer ein OpenAI-kompatibles Function-Tool */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string; enum?: string[] }>;
      required?: string[];
    };
  };
}

/** Args kommen aus dem LLM — alles string oder number nach JSON-Parsing */
export type ToolArgs = Record<string, string | number | boolean | undefined>;

/** Alle Handler geben einen String zurueck (Text fuers LLM/User) */
export type ToolHandler = (args: ToolArgs) => Promise<string>;

/** Verzeichnis-Eintrag (fuer listFolder & aehnliche) */
export interface FolderEntry {
  name: string;
  type: "folder" | "file";
}
