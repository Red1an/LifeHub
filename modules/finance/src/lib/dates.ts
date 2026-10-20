import { monthKey } from "@lifehub/sdk";

export const today = () => key(new Date());

export function key(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const parse = (k: string) => new Date(k + "T00:00");

export function addDaysKey(k: string, n: number): string {
  const d = parse(k);
  d.setDate(d.getDate() + n);
  return key(d);
}

export function addMonthsKey(k: string, n: number): string {
  const d = parse(k);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(monthKey(d))));
  return key(d);
}

export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

export function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function monthTitle(month: string, withYear = true) {
  const [y, m] = month.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("ru-RU", withYear && y !== new Date().getFullYear() ? { month: "long", year: "numeric" } : { month: "long" });
  return s[0].toUpperCase() + s.slice(1).replace(" г.", "");
}

export function monthShort(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("ru-RU", { month: "short" }).replace(".", "");
}

/** «сегодня», «вчера», «пн, 13 окт». */
export function dayTitle(k: string) {
  const t = today();
  if (k === t) return "Сегодня";
  if (k === addDaysKey(t, -1)) return "Вчера";
  const d = parse(k);
  const s = d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
  return s[0].toUpperCase() + s.slice(1).replace(".", "");
}

export function shortDate(k: string) {
  const d = parse(k);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "2-digit" : undefined }).replace(".", "");
}

/** Следующая дата с днём месяца day (после или в from). */
export function nextMonthDay(from: string, day: number): string {
  const d = parse(from);
  const cand = new Date(d.getFullYear(), d.getMonth(), Math.min(day, daysInMonth(monthKey(d))));
  if (key(cand) >= from) return key(cand);
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return key(new Date(n.getFullYear(), n.getMonth(), Math.min(day, daysInMonth(monthKey(n)))));
}
