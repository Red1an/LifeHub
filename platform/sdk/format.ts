/* Форматирование и мелкие утилиты, которые нужны почти каждому модулю. */

const toDate = (d: Date | number | string) => (d instanceof Date ? d : new Date(d));

export function formatDate(d: Date | number | string, style: "short" | "long" | "time" | "datetime" | "weekday" = "short"): string {
  const date = toDate(d);
  switch (style) {
    case "long":
      return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
    case "time":
      return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    case "datetime":
      return date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    case "weekday":
      return date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    default:
      return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }
}

/** «только что», «5 минут назад», «вчера», «3 дня назад». */
export function formatRelative(d: Date | number | string): string {
  const diff = Date.now() - toDate(d).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} ${plural(min, ["минуту", "минуты", "минут"])} назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${plural(h, ["час", "часа", "часов"])} назад`;
  const days = Math.round(h / 24);
  if (days === 1) return "вчера";
  if (days < 30) return `${days} ${plural(days, ["день", "дня", "дней"])} назад`;
  return formatDate(d, "long");
}

export function formatMoney(n: number, currency = "RUB", fractionDigits = 0): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits }).format(n);
}

export function formatNumber(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: fractionDigits }).format(n);
}

/** 00:00 или 1:02:03 из секунд. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** plural(5, ["день", "дня", "дней"]) → "дней". */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Ключ дня в локальном времени: "2026-09-25". */
export function dayKey(d: Date | number | string = new Date()): string {
  const date = toDate(d);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Ключ месяца: "2026-09". */
export function monthKey(d: Date | number | string = new Date()): string {
  return dayKey(d).slice(0, 7);
}

export function startOfDay(d: Date | number | string = new Date()): Date {
  const date = new Date(toDate(d));
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Понедельник текущей недели. */
export function startOfWeek(d: Date | number | string = new Date()): Date {
  const date = startOfDay(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
}

export function addDays(d: Date | number | string, days: number): Date {
  const date = new Date(toDate(d));
  date.setDate(date.getDate() + days);
  return date;
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
