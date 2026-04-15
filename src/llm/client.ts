import OpenAI from "openai";
import { OLLAMA_BASE_URL, LOCALE, TIMEZONE } from "../config.js";

// Ollama-Client (lokal oder Cloud via :cloud-Modellsuffix)
const apiKey = process.env.OLLAMA_API_KEY || "ollama";
export const client = new OpenAI({ baseURL: OLLAMA_BASE_URL, apiKey });

export function buildDateLine(): string {
  return `Heute ist: ${new Date().toLocaleDateString(LOCALE, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TIMEZONE,
  })}`;
}
