import { MONTHS_GEN, WEEKDAYS, dayKey, fromKey, plural, shiftKey, weekday } from "./nlu.ts";

/*
 * Как Джарвис говорит: время, даты и суммы для озвучки и заготовленные фразы.
 * Ответ Алисе — пара text (показывается на экране) и tts (произносится).
 */

export interface Say {
  text: string;
  tts: string;
}

/** Кусок ответа: одинаково на экране и в голосе, либо по-разному. */
export type Part = string | Say;

export function join(parts: (Part | null | undefined | false)[], pause = 300): Say {
  const list = parts.filter(Boolean) as Part[];
  return {
    text: list.map((p) => (typeof p === "string" ? p : p.text)).join(" "),
    tts: list.map((p) => (typeof p === "string" ? p : p.tts)).join(` sil <[${pause}]> `),
  };
}

/** Убирает то, что плохо звучит голосом: эмодзи, скобки с аудиториями, лишние знаки. */
export function speakable(s: string): string {
  return s
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "")
    .replace(/[«»"*_#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** «19:00» на экране, «в 19 часов» голосом. */
export function at(time: string): Say {
  const [h, m] = time.split(":").map(Number);
  return { text: `в ${time}`, tts: m === 0 ? `в ${h} ${plural(h, "час", "часа", "часов")}` : `в ${h} ${String(m).padStart(2, "0")}` };
}

export function until(time: string): Say {
  const [h, m] = time.split(":").map(Number);
  return { text: `до ${time}`, tts: m === 0 ? `до ${h} ${plural(h, "часа", "часов", "часов")}` : `до ${h} ${String(m).padStart(2, "0")}` };
}

/** «сегодня», «завтра», «в пятницу, 16 октября». */
export function dayName(date: string, now = new Date()): string {
  const today = dayKey(now);
  if (date === today) return "сегодня";
  if (date === shiftKey(today, 1)) return "завтра";
  if (date === shiftKey(today, 2)) return "послезавтра";
  if (date === shiftKey(today, -1)) return "вчера";
  const d = fromKey(date);
  const wd = ["в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу", "в воскресенье"][weekday(d)];
  return `${wd}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

export function fullDate(date: string): string {
  const d = fromKey(date);
  const wd = WEEKDAYS[weekday(d)];
  return `${wd.charAt(0).toUpperCase() + wd.slice(1)}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

/** «1 500 ₽» на экране, «1500 рублей» голосом. */
export function money(n: number): Say {
  const r = Math.round(n);
  return { text: `${r.toLocaleString("ru-RU")} ₽`, tts: `${r} ${plural(r, "рубль", "рубля", "рублей")}` };
}

export const count = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;

/** «через 40 минут», «через 2 часа 10 минут». */
export function inMinutes(min: number): string {
  if (min < 1) return "прямо сейчас";
  if (min < 60) return `через ${count(min, "минуту", "минуты", "минут")}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `через ${count(h, "час", "часа", "часов")}${m ? ` ${count(m, "минуту", "минуты", "минут")}` : ""}`;
}

export function listing(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;
}

/* ───────────── характер ───────────── */

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** Обращение: «, сэр» или пусто. */
export const sir = (address: string) => (address ? `, ${address}` : "");

export function greeting(address: string, now = new Date()): string {
  const h = now.getHours();
  const g = h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
  return `${g}${sir(address)}.`;
}

export const hello = (address: string) =>
  pick([`Слушаю${sir(address)}.`, `К вашим услугам${sir(address)}.`, `Да${sir(address)}? Чем помочь?`, `На связи${sir(address)}.`]);

export const done = (address: string) => pick([`Готово${sir(address)}.`, `Сделано${sir(address)}.`, `Есть${sir(address)}.`]);

export const bye = (address: string) => pick([`Обращайтесь${sir(address)}.`, `Всегда к вашим услугам.`, `Хорошего дня${sir(address)}.`]);

export const morningOutro = () => pick(["Продуктивного дня.", "Удачного дня.", "Хорошего дня — всё под контролем.", ""]);

export const eveningOutro = () => pick(["Хорошего вечера.", "Отдыхайте, завтра всё по плану.", "Спокойной ночи.", ""]);

export const freeDay = () => pick(["В календаре пусто — день в вашем распоряжении.", "Событий нет. Редкая роскошь.", "Ничего не запланировано."]);
