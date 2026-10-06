import { dayKey } from "@lifehub/sdk";

export const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
export const WEEKDAYS_LONG = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
export const RRULE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** День недели 0 = понедельник. */
export const weekday = (d: Date) => (d.getDay() + 6) % 7;

export const fromKey = (k: string) => new Date(k + "T00:00:00");

export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const fromMinutes = (m: number) => {
  m = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export const shiftKey = (k: string, days: number) => {
  const d = fromKey(k);
  d.setDate(d.getDate() + days);
  return dayKey(d);
};

/** «7 октября, ср» */
export function dayLabel(k: string): string {
  const d = fromKey(k);
  const today = dayKey();
  if (k === today) return "Сегодня";
  if (k === shiftKey(today, 1)) return "Завтра";
  if (k === shiftKey(today, -1)) return "Вчера";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS[weekday(d)]}`;
}

export const monthTitle = (d: Date) => {
  const s = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1).replace(" г.", "");
};

/** Описание повтора по-человечески. */
export function recurrenceLabel(r?: { freq: string; byDay?: string[]; interval?: number; until?: string; count?: number }): string {
  if (!r) return "";
  const every = r.interval && r.interval > 1 ? `каждые ${r.interval} ` : "";
  let s =
    r.freq === "DAILY"
      ? every ? `${every}дн.` : "каждый день"
      : r.freq === "MONTHLY"
        ? every ? `${every}мес.` : "каждый месяц"
        : r.byDay?.length
          ? `${every ? every + "нед. " : "по "}${r.byDay.map((d) => WEEKDAYS[RRULE_DAYS.indexOf(d)] ?? d).join(", ")}`
          : every ? `${every}нед.` : "каждую неделю";
  if (r.until) s += ` до ${dayLabel(r.until).toLowerCase()}`;
  else if (r.count) s += `, ${r.count} раз`;
  return s;
}
