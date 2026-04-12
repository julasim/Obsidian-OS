import OpenAI from "openai";
import {
  OLLAMA_BASE_URL,
  DEFAULT_MODEL,
  FAST_MODEL,
  SUBAGENT_MODEL,
  LOCALE,
  TIMEZONE,
} from "../config.js";

// Haupt-Client: OpenAI-kompatible API (Ollama Cloud, OpenAI, OpenRouter, lokales Ollama)
const apiKey = process.env.OLLAMA_API_KEY || process.env.OPENAI_API_KEY || "ollama";
export const client = new OpenAI({ baseURL: OLLAMA_BASE_URL, apiKey });

let MODEL = DEFAULT_MODEL;
let _fastMode = false;

export function getModel(): string {
  return MODEL;
}

export function getSubagentModel(): string {
  return SUBAGENT_MODEL;
}

export function isFastMode(): boolean {
  return _fastMode;
}

export function setModel(name: string): void {
  MODEL = name;
}

export function toggleFast(): boolean {
  _fastMode = !_fastMode;
  MODEL = _fastMode ? FAST_MODEL : DEFAULT_MODEL;
  return _fastMode;
}

export function buildDateLine(): string {
  return `Heute ist: ${new Date().toLocaleDateString(LOCALE, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TIMEZONE,
  })}`;
}
