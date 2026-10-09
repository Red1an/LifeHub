/*
 * Разбор фраз без нейронки: даты, время, длительность, суммы.
 *
 * Работает по тексту, который распознала Алиса (числа она пишет цифрами), и по сущности
 * YANDEX.DATETIME из её NLU. Всё, что разобрано, вырезается из текста — остаток идёт в
 * название события, заметки или траты.
 */

export const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
/** Винительный падеж: «в среду». */
const WEEKDAYS_ACC = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"];

/** Нижний регистр, ё → е, без знаков препинания (кроме двоеточия во времени). */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(\d)[.,](\d)/g, "$1#$2")
    .replace(/[^\p{L}\d:#\s-]/gu, " ")
    .replace(/#/g, ".")
    .replace(/(^|\s)-+|-+(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k: string) => new Date(k + "T00:00:00");
export const shiftKey = (k: string, days: number) => {
  const d = fromKey(k);
  d.setDate(d.getDate() + days);
  return dayKey(d);
};
export const weekday = (d: Date) => (d.getDay() + 6) % 7;
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMinutes = (m: number) => {
  m = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/* ───────────── сущности Алисы ───────────── */

export interface AliceEntity {
  type: string;
  tokens: { start: number; end: number };
  value: any;
}

/** Слово содержит одну из основ. */
export const has = (text: string, ...stems: string[]) => stems.some((s) => new RegExp(`(^|\\s)${s}`).test(text));

/* ───────────── дата ───────────── */

export interface Found<T> {
  value: T;
  /** Текст без разобранного куска. */
  rest: string;
}

const cut = (text: string, m: RegExpMatchArray) => (text.slice(0, m.index) + " " + text.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim();

/** Дата из фразы: сегодня, завтра, в пятницу, 12 октября, через 3 дня… */
export function findDate(text: string, now = new Date()): Found<string> | null {
  const today = dayKey(now);
  let m: RegExpMatchArray | null;

  if ((m = text.match(/(^|\s)(на |в )?(сегодня|сегодняшн\S*)(?=\s|$)/))) return { value: today, rest: cut(text, m) };
  if ((m = text.match(/(^|\s)(на )?(послезавтра)(?=\s|$)/))) return { value: shiftKey(today, 2), rest: cut(text, m) };
  if ((m = text.match(/(^|\s)(на )?(завтра|завтрашн\S*)(?=\s|$)/))) return { value: shiftKey(today, 1), rest: cut(text, m) };
  if ((m = text.match(/(^|\s)(за )?(вчера|вчерашн\S*)(?=\s|$)/))) return { value: shiftKey(today, -1), rest: cut(text, m) };

  // «через 5 минут» и «через час» — это время (findTime), а не дата.
  if ((m = text.match(/(^|\s)через (?:(\d+) )?(дн\S*|день|недел\S*|месяц\S*)(?=\s|$)/))) {
    const n = m[2] ? Number(m[2]) : 1;
    const days = /^недел/.test(m[3]) ? n * 7 : /^месяц/.test(m[3]) ? n * 30 : n;
    return { value: shiftKey(today, days), rest: cut(text, m) };
  }

  const wd = WEEKDAYS_ACC.map((w, i) => [w, WEEKDAYS[i]]).flat().join("|");
  if ((m = text.match(new RegExp(`(^|\\s)(в|во|на|к)?\\s*(следующ\\S*|эт\\S+)?\\s*(${wd})(?=\\s|$)`)))) {
    const idx = WEEKDAYS_ACC.indexOf(m[4]) >= 0 ? WEEKDAYS_ACC.indexOf(m[4]) : WEEKDAYS.indexOf(m[4]);
    let diff = (idx - weekday(now) + 7) % 7;
    if (m[3]?.startsWith("следующ") && diff === 0) diff = 7;
    return { value: shiftKey(today, diff), rest: cut(text, m) };
  }

  const months = MONTHS_GEN.join("|");
  if ((m = text.match(new RegExp(`(^|\\s)(на |к )?(\\d{1,2})(-?е|-?го)?\\s+(${months})(?=\\s|$)`)))) {
    const day = Number(m[3]);
    const month = MONTHS_GEN.indexOf(m[5]);
    const d = new Date(now.getFullYear(), month, day);
    // Дата уже прошла в этом году — значит, следующий год.
    if (dayKey(d) < shiftKey(today, -1)) d.setFullYear(d.getFullYear() + 1);
    return { value: dayKey(d), rest: cut(text, m) };
  }

  if ((m = text.match(/(^|\s)(на )?(\d{1,2})(-?е|-?го)? числ\S*(?=\s|$)/))) {
    const day = Number(m[3]);
    const d = new Date(now.getFullYear(), now.getMonth(), day);
    if (dayKey(d) < today) d.setMonth(d.getMonth() + 1);
    return { value: dayKey(d), rest: cut(text, m) };
  }
  return null;
}

/* ───────────── время ───────────── */

export interface TimeOfDay {
  time: string;
  /** Время сказано относительно сейчас («через 20 минут») — с датой. */
  date?: string;
}

/** Время: в 7 вечера, в 19:30, к 9, в полдень, через 20 минут, через час. */
export function findTime(text: string, now = new Date()): Found<TimeOfDay> | null {
  let m: RegExpMatchArray | null;

  if ((m = text.match(/(^|\s)через (?:(\d+) )?(полчаса|полтора часа|час\S*|минут\S*|мин)(?=\s|$)/))) {
    const n = m[2] ? Number(m[2]) : 1;
    const u = m[3];
    const minutes = u === "полчаса" ? 30 : u === "полтора часа" ? 90 : /^час/.test(u) ? n * 60 : n;
    const at = new Date(now.getTime() + minutes * 60_000);
    return { value: { time: hhmm(at), date: dayKey(at) }, rest: cut(text, m) };
  }
  if ((m = text.match(/(^|\s)(в |к )?(полдень)(?=\s|$)/))) return { value: { time: "12:00" }, rest: cut(text, m) };
  if ((m = text.match(/(^|\s)(в |к )?(полночь)(?=\s|$)/))) return { value: { time: "23:59" }, rest: cut(text, m) };

  if ((m = text.match(/(^|\s)(в|во|к|на|с)\s+(\d{1,2})(?::(\d{2})|\s+(\d{2})(?=\s|$))?\s*(час\S*)?\s*(утра|дня|вечера|ночи)?(?=\s|$)/))) {
    let h = Number(m[3]);
    const min = Number(m[4] ?? m[5] ?? 0);
    const part = m[7];
    if (h > 23 || min > 59) return null;
    // «на 2» без «часа»/«утра» и т.п. — скорее длительность или число, а не время.
    if (m[2] === "на" && !m[4] && !m[6] && !part) return null;
    if ((part === "вечера" || part === "дня") && h < 12) h += 12;
    else if (part === "ночи" && h === 12) h = 0;
    // «в 3» без уточнения — днём, а не ночью.
    else if (!part && h >= 1 && h <= 6) h += 12;
    return { value: { time: `${pad(h)}:${pad(min)}` }, rest: cut(text, m) };
  }
  return null;
}

/** Время из сущности YANDEX.DATETIME (если своим разбором не нашлось). */
export function entityDateTime(entities: AliceEntity[] | undefined, now = new Date()): { date?: string; time?: string } {
  const e = entities?.find((x) => x.type === "YANDEX.DATETIME")?.value;
  if (!e) return {};
  const d = new Date(now);
  let date: string | undefined;
  let time: string | undefined;
  if (e.year !== undefined || e.month !== undefined || e.day !== undefined) {
    if (e.year !== undefined) d.setFullYear(e.year_is_relative ? d.getFullYear() + e.year : e.year);
    if (e.month !== undefined) d.setMonth(e.month_is_relative ? d.getMonth() + e.month : e.month - 1);
    if (e.day !== undefined) d.setDate(e.day_is_relative ? d.getDate() + e.day : e.day);
    date = dayKey(d);
  }
  if (e.hour !== undefined || e.minute !== undefined) {
    const t = new Date(now);
    if (e.hour !== undefined) {
      if (e.hour_is_relative) t.setHours(t.getHours() + e.hour);
      else t.setHours(e.hour, 0);
    }
    if (e.minute !== undefined) {
      if (e.minute_is_relative) t.setMinutes(t.getMinutes() + e.minute);
      else t.setMinutes(e.minute);
    }
    time = hhmm(t);
    if (e.hour_is_relative || e.minute_is_relative) date = dayKey(t);
  }
  return { date, time };
}

/* ───────────── длительность и суммы ───────────── */

/** «на час», «на 2 часа», «на полчаса», «на 45 минут», «на полтора часа». */
export function findDuration(text: string): Found<number> | null {
  const m = text.match(/(^|\s)на (\d+|полчаса|час|полтора)\s*(час\S*|минут\S*|мин)?(?=\s|$)/);
  if (!m) return null;
  const raw = m[2];
  const unit = m[3] ?? "";
  let minutes: number;
  if (raw === "полчаса") minutes = 30;
  else if (raw === "час") minutes = 60;
  else if (raw === "полтора") minutes = 90;
  else if (/^час/.test(unit)) minutes = Number(raw) * 60;
  else if (/^мин/.test(unit)) minutes = Number(raw);
  else return null;
  return { value: minutes, rest: cut(text, m) };
}

/** Сумма: «450», «1.5 тысячи», «5 тысяч», «2к». */
export function findAmount(text: string): Found<number> | null {
  const m = text.match(/(^|\s)(\d+(?:\.\d+)?)\s*(тысяч\S*|тыс|к)?\s*(руб\S*|р|₽)?(?=\s|$)/);
  if (!m) {
    const t = text.match(/(^|\s)(полторы тысячи|тысячу|тысяча)\s*(руб\S*)?(?=\s|$)/);
    if (!t) return null;
    return { value: t[2] === "полторы тысячи" ? 1500 : 1000, rest: cut(text, t) };
  }
  const n = Number(m[2]) * (m[3] ? 1000 : 1);
  if (!n) return null;
  return { value: Math.round(n * 100) / 100, rest: cut(text, m) };
}

/** Убрать служебные слова из начала и конца, чтобы осталось название. */
export function cleanTitle(text: string, extra: string[] = []): string {
  const junk = new Set([
    "мне", "меня", "пожалуйста", "что", "чтобы", "надо", "нужно", "в", "на", "и", "а", "о", "об", "про", "по", "с", "к", "у",
    "календарь", "календаре", "расписание", "расписании", "событие", "мой", "моем", "мою", "плиз", "джарвис", "ну", "это", ...extra,
  ]);
  const words = text.split(" ").filter(Boolean);
  while (words.length && junk.has(words[0])) words.shift();
  while (words.length && junk.has(words[words.length - 1])) words.pop();
  const s = words.join(" ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/** Похожесть фразы на название: доля слов названия, чьи основы (4 буквы) есть во фразе. */
export function similarity(phrase: string, name: string): number {
  const stems = (s: string) => normalize(s).split(" ").filter((w) => w.length > 2).map((w) => w.slice(0, Math.min(5, Math.max(3, w.length - 2))));
  const target = stems(name);
  if (!target.length) return 0;
  const words = normalize(phrase).split(" ");
  const hit = target.filter((t) => words.some((w) => w.startsWith(t))).length;
  return hit / target.length;
}
