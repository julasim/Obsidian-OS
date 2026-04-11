/** Gemeinsamer Handler-Typ fuer alle Tool-Handler */
export type ToolArgs = Record<string, string | number>;
export type ToolHandler = (args: ToolArgs) => Promise<string>;
export type HandlerMap = Record<string, ToolHandler>;
