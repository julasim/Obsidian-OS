/**
 * Recurrence-Engine fuer Tasks.
 *
 * Unterstuetzt DE + EN Patterns und berechnet das naechste Due-Datum
 * ausgehend von einem Referenzdatum (letzte Erledigung oder urspruengl.
 * Due). Keine externen Abhaengigkeiten — reine Date-Manipulation.
 */

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sonntag: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
};

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + n);
  return out;
}

function addYears(d: Date, n: number): Date {
  const out = new Date(d);
  out.setFullYear(out.getFullYear() + n);
  return out;
}

function nextWeekday(from: Date, target: number): Date {
  const cur = from.getDay();
  let diff = target - cur;
  if (diff <= 0) diff += 7;
  return addDays(from, diff);
}

/** Normalisiert DE-Patterns auf eine kanonische, englische Form. */
function normalize(pattern: string): string | null {
  const p = pattern.trim().toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");

  // Taeglich
  if (/^(every\s+day|jeden\s+tag|taeglich)$/i.test(p)) return "every day";
  // Woechentlich
  if (/^(every\s+week|jede\s+woche|woechentlich)$/i.test(p)) return "every week";
  // Monatlich
  if (/^(every\s+month|jeden\s+monat|monatlich)$/i.test(p)) return "every month";
  // Jaehrlich
  if (/^(every\s+year|jedes\s+jahr|jaehrlich)$/i.test(p)) return "every year";

  // every N days / alle N Tage
  let m = p.match(/^(?:every|alle)\s+(\d+)\s+(days|tage)$/);
  if (m) return `every ${m[1]} days`;
  // every N weeks / alle N Wochen
  m = p.match(/^(?:every|alle)\s+(\d+)\s+(weeks|wochen)$/);
  if (m) return `every ${m[1]} weeks`;
  // every N months / alle N Monate
  m = p.match(/^(?:every|alle)\s+(\d+)\s+(months|monate)$/);
  if (m) return `every ${m[1]} months`;
  // every N years / alle N Jahre
  m = p.match(/^(?:every|alle)\s+(\d+)\s+(years|jahre)$/);
  if (m) return `every ${m[1]} years`;

  // every <weekday> / jeden <wochentag>
  m = p.match(/^(?:every|jeden)\s+([a-z]+)$/);
  if (m && WEEKDAYS[m[1]] !== undefined) {
    const en = Object.keys(WEEKDAYS).find(
      (k) =>
        WEEKDAYS[k] === WEEKDAYS[m![1]] &&
        ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].includes(k),
    )!;
    return `every ${en}`;
  }

  return null;
}

/**
 * Berechnet das naechste Datum auf Basis eines Recurrence-Patterns.
 * Gibt `null` zurueck, wenn das Pattern nicht erkannt wird.
 */
export function computeNextDate(pattern: string, lastDate: Date): Date | null {
  const norm = normalize(pattern);
  if (!norm) return null;

  if (norm === "every day") return addDays(lastDate, 1);
  if (norm === "every week") return addDays(lastDate, 7);
  if (norm === "every month") return addMonths(lastDate, 1);
  if (norm === "every year") return addYears(lastDate, 1);

  let m = norm.match(/^every\s+(\d+)\s+days$/);
  if (m) return addDays(lastDate, parseInt(m[1], 10));
  m = norm.match(/^every\s+(\d+)\s+weeks$/);
  if (m) return addDays(lastDate, parseInt(m[1], 10) * 7);
  m = norm.match(/^every\s+(\d+)\s+months$/);
  if (m) return addMonths(lastDate, parseInt(m[1], 10));
  m = norm.match(/^every\s+(\d+)\s+years$/);
  if (m) return addYears(lastDate, parseInt(m[1], 10));

  m = norm.match(/^every\s+([a-z]+)$/);
  if (m && WEEKDAYS[m[1]] !== undefined) {
    return nextWeekday(lastDate, WEEKDAYS[m[1]]);
  }

  return null;
}

/** Prueft, ob ein Recurrence-Pattern gueltig ist. */
export function isValidRecurrence(pattern: string): boolean {
  return normalize(pattern) !== null;
}
