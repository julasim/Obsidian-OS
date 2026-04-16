import OpenAI from "openai";
import { LLM_BASE_URL, LLM_API_KEY, LLM_APP_NAME, LLM_APP_URL, LOCALE, TIMEZONE } from "../config.js";

// OpenRouter-spezifische Header — werden von anderen Providern ignoriert
const defaultHeaders: Record<string, string> = {};
if (LLM_APP_NAME) defaultHeaders["X-Title"] = LLM_APP_NAME;
if (LLM_APP_URL) defaultHeaders["HTTP-Referer"] = LLM_APP_URL;

export const client = new OpenAI({
  baseURL: LLM_BASE_URL,
  apiKey: LLM_API_KEY,
  defaultHeaders,
});

export function buildDateLine(): string {
  return `Heute ist: ${new Date().toLocaleDateString(LOCALE, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TIMEZONE,
  })}`;
}
