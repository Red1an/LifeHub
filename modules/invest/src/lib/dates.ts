/*
 * Даты. Храним ISO-строки, считаем в миллисекундах по местному времени.
 * "2024-05-01" разбирается как полночь по местному времени (а не UTC), чтобы дата не съезжала.
 */

export const DAY = 86_400_000;

export function ms(s: string | number | Date): number {
  if (typeof s === "number") return s;
  if (s instanceof Date) return s.getTime();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" по местному времени. */
export function day(t: number | string | Date = Date.now()): string {
  const d = new Date(ms(t));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const yearOf = (t: number | string) => new Date(ms(t)).getFullYear();
/** Месяц 1–12. */
export const monthOf = (t: number | string) => new Date(ms(t)).getMonth() + 1;

export function addDays(t: number | string, n: number): number {
  const d = new Date(ms(t));
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function addMonths(t: number | string, n: number): number {
  const d = new Date(ms(t));
  const dayOfMonth = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dayOfMonth, last));
  return d.getTime();
}

export const addYears = (t: number | string, n: number) => addMonths(t, n * 12);

export function startOfDayMs(t: number | string = Date.now()): number {
  const d = new Date(ms(t));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function startOfMonthMs(t: number | string): number {
  const d = new Date(ms(t));
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export const yearsBetween = (a: number, b: number) => (b - a) / (365.25 * DAY);

/** Разбирает ISO (с долями секунд любой длины), YYYY-MM-DD, DD.MM.YYYY и серийный номер Excel. */
export function parseDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
    return m[4] ? d.toISOString() : `${m[3]}-${m[2]}-${m[1]}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) return day(Math.round((serial - 25569) * DAY) + new Date().getTimezoneOffset() * 60_000);
  }
  return null;
}

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_AXIS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «12 мая 2026» или «12 мая», если год текущий и short. */
export function fmtDate(t: number | string, opts: { year?: "auto" | "always" | "never" } = {}): string {
  const d = new Date(ms(t));
  const showYear = opts.year === "always" || (opts.year !== "never" && d.getFullYear() !== new Date().getFullYear());
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${showYear ? ` ${d.getFullYear()}` : ""}`;
}

export const monthName = (m: number) => MONTHS_NOM[m - 1];
export const monthAxis = (m: number) => MONTHS_AXIS[m - 1];

/** Сколько дней до даты (отрицательное — прошла). */
export const daysUntil = (t: number | string) => Math.round((startOfDayMs(t) - startOfDayMs()) / DAY);
