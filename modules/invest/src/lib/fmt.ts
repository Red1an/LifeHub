import { currencySymbol } from "./types.ts";

/*
 * Числа по-русски: тонкий пробел между разрядами, типографский минус, «−0» не бывает.
 */

const MINUS = "−";
const NBSP = " ";

function clean(v: number, digits: number): number {
  return Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v;
}

export function num(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return "—";
  const s = clean(v, digits).toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return s.replace(/\s/g, " ").replace("-", MINUS);
}

export function rub(v: number, digits = 0): string {
  return `${num(v, digits)}${NBSP}₽`;
}

export function signedRub(v: number): string {
  return (v >= 0.5 ? "+" : "") + rub(v);
}

/** Цена бумаги: копейки для небольших сумм. */
export function money(v: number, currency = "RUB"): string {
  const digits = Math.abs(v) < 10_000 ? 2 : 0;
  return `${num(v, digits)}${NBSP}${currencySymbol(currency)}`;
}

/** «1,2 млн», «350 тыс», «870». */
export function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000_000) return `${num(v / 1_000_000_000, 1)}${NBSP}млрд`;
  if (a >= 1_000_000) return `${num(v / 1_000_000, a >= 10_000_000 ? 0 : 1)}${NBSP}млн`;
  if (a >= 10_000) return `${num(v / 1_000, 0)}${NBSP}тыс`;
  return num(v, 0);
}

export const shortRub = (v: number) => `${short(v)}${NBSP}₽`;

export function signedShort(v: number): string {
  return (v >= 0.5 ? "+" : v <= -0.5 ? MINUS : "") + short(Math.abs(v));
}

export const signedShortRub = (v: number) => `${signedShort(v)}${NBSP}₽`;

/** Доля → «12,3 %». */
export function pct(v: number | null | undefined, opts: { signed?: boolean; digits?: number } = {}): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const digits = opts.digits ?? 1;
  return (opts.signed && v > 0.00005 ? "+" : "") + num(v * 100, digits) + NBSP + "%";
}

export function qty(v: number): string {
  return Number.isInteger(v) ? num(v, 0) : num(v, 2);
}

/** Цвет числа «хорошо/плохо». */
export function tone(v: number, eps = 0.5): "up" | "down" | "flat" {
  return v > eps ? "up" : v < -eps ? "down" : "flat";
}

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** «3 года 2 месяца». */
export function duration(months: number): string {
  const y = Math.floor(months / 12);
  const m = Math.round(months % 12);
  const parts: string[] = [];
  if (y) parts.push(`${y} ${plural(y, ["год", "года", "лет"])}`);
  if (m || !y) parts.push(`${m} ${plural(m, ["месяц", "месяца", "месяцев"])}`);
  return parts.join(" ");
}
