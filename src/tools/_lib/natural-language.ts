/**
 * Natural-Language Parser fuer Task-Eingaben.
 *
 * Deutsch + Englisch. Extrahiert Datum, Prioritaet, Tags, Context,
 * Wiederholungen und Zeitschaetzungen aus Freitext.
 *
 * Der Rest-Text ist das, was nach Entfernung aller NL-Patterns uebrig
 * bleibt — wird als Task-`text` verwendet.
 */

import { todayStr, toIsoDate } from "./date.js";

export interface NLFragment {
  due?: string;
  start?: string;
  prioritaet?: "hoch" | "mittel-hoch" | "mittel" | "niedrig-mittel" | "niedrig";
  recurrence?: string;
  tags: string[];
  kontext: string[];
  estimate?: string;
}

const WEEKDAYS_DE: Record<string, number> = {
  sonntag: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
};

const WEEKDAYS_EN: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const WEEKDAY_DE_TO_EN: Record<string, string> = {
  montag: "Monday",
  dienstag: "Tuesday",
  mittwoch: "Wednesday",
  donnerstag: "Thursday",
  freitag: "Friday",
  samstag: "Saturday",
  sonntag: "Sunday",
};

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function nextWeekday(from: Date, target: number): Date {
  const cur = from.getDay();
  let diff = target - cur;
  if (diff <= 0) diff += 7;
  return addDays(from, diff);
}

function parseDeDate(day: string, mon: string, year: string): string | null {
  const d = parseInt(day, 10);
  const m = parseInt(mon, 10);
  const y = parseInt(year, 10);
  if (!d || !m || !y) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return toIsoDate(date);
}

/**
 * Parst natuerlich-sprachliche Eingabe und trennt erkannte Fragmente
 * vom Rest-Text.
 */
export function parseNaturalLanguage(input: string): { fragment: NLFragment; rest: string } {
  const fragment: NLFragment = { tags: [], kontext: [] };
  let text = input;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // --- Tags (#wort) & Kontext (@wort) ------------------------------
  text = text.replace(/(^|\s)#([A-Za-z0-9_\-äöüÄÖÜß]+)/g, (_m, pre, tag) => {
    fragment.tags.push(tag);
    return pre;
  });
  text = text.replace(/(^|\s)@([A-Za-z0-9_\-äöüÄÖÜß]+)/g, (_m, pre, ctx) => {
    fragment.kontext.push(ctx);
    return pre;
  });

  // --- Recurrence (vor einfachen Datums-Patterns!) -----------------
  // DE: jeden <Wochentag>
  const jedenWd = text.match(/\bjeden\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i);
  if (jedenWd) {
    fragment.recurrence = `every ${WEEKDAY_DE_TO_EN[jedenWd[1].toLowerCase()]}`;
    text = text.replace(jedenWd[0], " ");
  }
  // EN: every <weekday>
  if (!fragment.recurrence) {
    const everyWd = text.match(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (everyWd) {
      const wd = everyWd[1].toLowerCase();
      fragment.recurrence = `every ${wd.charAt(0).toUpperCase()}${wd.slice(1)}`;
      text = text.replace(everyWd[0], " ");
    }
  }
  // alle N Tage/Wochen/Monate/Jahre
  if (!fragment.recurrence) {
    const alleN = text.match(/\balle\s+(\d+)\s+(tage|wochen|monate|jahre)\b/i);
    if (alleN) {
      const unit = alleN[2].toLowerCase();
      const map: Record<string, string> = { tage: "days", wochen: "weeks", monate: "months", jahre: "years" };
      fragment.recurrence = `every ${alleN[1]} ${map[unit]}`;
      text = text.replace(alleN[0], " ");
    }
  }
  // every N days/weeks/months/years
  if (!fragment.recurrence) {
    const everyN = text.match(/\bevery\s+(\d+)\s+(days|weeks|months|years)\b/i);
    if (everyN) {
      fragment.recurrence = `every ${everyN[1]} ${everyN[2].toLowerCase()}`;
      text = text.replace(everyN[0], " ");
    }
  }
  // jede Woche / jeden Monat / jaehrlich / jedes Jahr
  if (!fragment.recurrence) {
    const simpleMap: Array<[RegExp, string]> = [
      [/\bjede\s+woche\b/i, "every week"],
      [/\bw(ö|oe)chentlich\b/i, "every week"],
      [/\bjeden\s+monat\b/i, "every month"],
      [/\bmonatlich\b/i, "every month"],
      [/\bjedes\s+jahr\b/i, "every year"],
      [/\bj(ä|ae)hrlich\b/i, "every year"],
      [/\bjeden\s+tag\b/i, "every day"],
      [/\bt(ä|ae)glich\b/i, "every day"],
      [/\bevery\s+week\b/i, "every week"],
      [/\bevery\s+month\b/i, "every month"],
      [/\bevery\s+year\b/i, "every year"],
      [/\bevery\s+day\b/i, "every day"],
    ];
    for (const [re, out] of simpleMap) {
      const m = text.match(re);
      if (m) {
        fragment.recurrence = out;
        text = text.replace(m[0], " ");
        break;
      }
    }
  }

  // --- Datum absolut -----------------------------------------------
  // ISO YYYY-MM-DD
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) {
    fragment.due = iso[1];
    text = text.replace(iso[0], " ");
  }
  // DE DD.MM.YYYY
  if (!fragment.due) {
    const de = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
    if (de) {
      const parsed = parseDeDate(de[1], de[2], de[3]);
      if (parsed) {
        fragment.due = parsed;
        text = text.replace(de[0], " ");
      }
    }
  }

  // --- Datum relativ -----------------------------------------------
  // "in N Wochen" / "in N weeks"
  if (!fragment.due) {
    const inWeeks = text.match(/\bin\s+(\d+)\s+(wochen|weeks)\b/i);
    if (inWeeks) {
      fragment.due = toIsoDate(addDays(today, parseInt(inWeeks[1], 10) * 7));
      text = text.replace(inWeeks[0], " ");
    }
  }
  // "in N Tagen" / "in N days"
  if (!fragment.due) {
    const inDays = text.match(/\bin\s+(\d+)\s+(tagen|tage|days)\b/i);
    if (inDays) {
      fragment.due = toIsoDate(addDays(today, parseInt(inDays[1], 10)));
      text = text.replace(inDays[0], " ");
    }
  }
  // "day after tomorrow" / "uebermorgen" / "übermorgen"
  if (!fragment.due) {
    const dat = text.match(/\b(day\s+after\s+tomorrow|(ü|ue)bermorgen)\b/i);
    if (dat) {
      fragment.due = toIsoDate(addDays(today, 2));
      text = text.replace(dat[0], " ");
    }
  }
  // "morgen" / "tomorrow"
  if (!fragment.due) {
    const tom = text.match(/\b(morgen|tomorrow)\b/i);
    if (tom) {
      fragment.due = toIsoDate(addDays(today, 1));
      text = text.replace(tom[0], " ");
    }
  }
  // "heute" / "today"
  if (!fragment.due) {
    const tod = text.match(/\b(heute|today)\b/i);
    if (tod) {
      fragment.due = todayStr();
      text = text.replace(tod[0], " ");
    }
  }
  // "naechste Woche" / "nächste Woche" / "next week"
  if (!fragment.due) {
    const nw = text.match(/\b(n(ä|ae)chste\s+woche|next\s+week)\b/i);
    if (nw) {
      fragment.due = toIsoDate(addDays(today, 7));
      text = text.replace(nw[0], " ");
    }
  }
  // "naechsten <wochentag>" / "nächsten <wochentag>" / "next <weekday>"
  if (!fragment.due) {
    const nextDe = text.match(/\bn(ä|ae)chsten\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i);
    if (nextDe) {
      const target = WEEKDAYS_DE[nextDe[2].toLowerCase()];
      fragment.due = toIsoDate(nextWeekday(today, target));
      text = text.replace(nextDe[0], " ");
    }
  }
  if (!fragment.due) {
    const nextEn = text.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (nextEn) {
      const target = WEEKDAYS_EN[nextEn[1].toLowerCase()];
      fragment.due = toIsoDate(nextWeekday(today, target));
      text = text.replace(nextEn[0], " ");
    }
  }
  // Bare Wochentag DE
  if (!fragment.due) {
    const wdDe = text.match(/\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/i);
    if (wdDe) {
      const target = WEEKDAYS_DE[wdDe[1].toLowerCase()];
      fragment.due = toIsoDate(nextWeekday(today, target));
      text = text.replace(wdDe[0], " ");
    }
  }
  // Bare Wochentag EN
  if (!fragment.due) {
    const wdEn = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (wdEn) {
      const target = WEEKDAYS_EN[wdEn[1].toLowerCase()];
      fragment.due = toIsoDate(nextWeekday(today, target));
      text = text.replace(wdEn[0], " ");
    }
  }

  // --- Prioritaet ---------------------------------------------------
  // Wichtig: !!! vor !! vor !
  if (/!!!/.test(text)) {
    fragment.prioritaet = "hoch";
    text = text.replace(/!!!/g, " ");
  } else if (/!!/.test(text)) {
    fragment.prioritaet = "mittel-hoch";
    text = text.replace(/!!/g, " ");
  } else if (/(^|\s)!(\s|$)/.test(text)) {
    fragment.prioritaet = "mittel";
    text = text.replace(/(^|\s)!(\s|$)/g, "$1$2");
  }
  if (!fragment.prioritaet || fragment.prioritaet === "mittel") {
    const keyword = text.match(/\b(wichtig|dringend|urgent)\b/i);
    if (keyword) {
      fragment.prioritaet = "hoch";
      text = text.replace(keyword[0], " ");
    }
  }

  // --- Zeitschaetzung ----------------------------------------------
  // N h / N stunden / N Stunden
  if (!fragment.estimate) {
    const hours = text.match(/\b(\d+)\s*(h|stunden|hours)\b/i);
    if (hours) {
      fragment.estimate = `${hours[1]}h`;
      text = text.replace(hours[0], " ");
    }
  }
  // N min / N minuten / N Minuten
  if (!fragment.estimate) {
    const mins = text.match(/\b(\d+)\s*(min|minuten|minutes)\b/i);
    if (mins) {
      fragment.estimate = `${mins[1]}m`;
      text = text.replace(mins[0], " ");
    }
  }
  // N d (standalone, nicht Teil von Datum — Datum ist bereits entfernt)
  if (!fragment.estimate) {
    const days = text.match(/\b(\d+)\s*d\b/i);
    if (days) {
      fragment.estimate = `${days[1]}d`;
      text = text.replace(days[0], " ");
    }
  }

  const rest = text.replace(/\s+/g, " ").trim();
  return { fragment, rest };
}
