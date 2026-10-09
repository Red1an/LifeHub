import { dayKey, net, startOfWeek, uid } from "@lifehub/sdk";
import type { Draft } from "./types.ts";
import { RRULE_DAYS, fromKey, shiftKey } from "./time.ts";

/*
 * Расписание ГУАП (guap.ru/rasp). Страница отдаёт готовый HTML без входа:
 * дни — <h4>, пары — «N пара (9:30—11:00)», у занятия ▲ (верхняя, нечётная неделя),
 * ▼ (нижняя, чётная) или ничего (каждую неделю). Разбираем кодом, без нейронки, —
 * так точнее. Тот же разбор понимает текст, скопированный со страницы.
 */

const BASE = "https://guap.ru/rasp/";
const DAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

export type Parity = "odd" | "even" | "both";

export interface Lesson {
  /** 0 = понедельник */
  weekday: number;
  pair: number;
  start: string;
  end: string;
  parity: Parity;
  type: string;
  subject: string;
  room?: string;
  teachers?: string;
  groups?: string;
}

export interface GuapSchedule {
  group: string;
  lessons: Lesson[];
  /** Чётность текущей недели по данным сайта (null — неизвестно). */
  currentParity: Parity | null;
  /** Занятия вне сетки (курсовые) — без времени, только для сведения. */
  extra: string[];
}

const pad = (t: string) => (t.length === 4 ? "0" + t : t);
const clean = (t: string) => t.replace(/ /g, " ").replace(/\s+/g, " ").trim();

function parityOf(text: string): Parity | null {
  if (/нижн|четн/i.test(text) && !/нечетн|нечётн/i.test(text)) return "even";
  if (/верхн|нечетн|нечётн/i.test(text)) return "odd";
  return null;
}

function details(text: string) {
  const t = clean(text);
  const room = t.match(/ауд\.\s*(.+?)\s*(?:—|$)/)?.[1]?.trim();
  const teachers = t.match(/преп:\s*(.+?)\s*(?:гр:|$)/)?.[1]?.replace(/\.\s*$/, "").trim();
  const groups = t.match(/гр:\s*(.+)$/)?.[1]?.trim();
  return { room, teachers, groups };
}

/** Разбор HTML страницы guap.ru/rasp/?gr=… */
export function parseHtml(html: string, group: string): GuapSchedule {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lessons: Lesson[] = [];
  const extra: string[] = [];
  const weekSpan = doc.querySelector(".alert .week1, .alert .week2, span.week1, span.week2");
  const currentParity = weekSpan ? (weekSpan.classList.contains("week2") ? "even" : "odd") : null;

  let weekday = -1;
  let pair = 0;
  let start = "";
  let end = "";
  // Обходим элементы по порядку документа: заголовки дней, строки пар и блоки занятий.
  const anchor = doc.getElementById("result");
  const all = Array.from(doc.querySelectorAll("h4, div.mt-3, div.mb-3")).filter(
    (el) => !anchor || !!(anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  for (const el of all) {
    const text = clean(el.textContent ?? "");
    if (el.tagName === "H4") {
      weekday = DAYS.indexOf(text.toLowerCase());
      pair = 0;
      continue;
    }
    const pm = text.match(/^(\d+)\s*пара\s*\((\d{1,2}:\d{2})\s*[—–-]\s*(\d{1,2}:\d{2})\)/);
    if (pm && el.classList.contains("mt-3")) {
      pair = Number(pm[1]);
      start = pad(pm[2]);
      end = pad(pm[3]);
      continue;
    }
    if (!el.classList.contains("mb-3")) continue;
    const type = clean(el.querySelector(".fs-6")?.textContent ?? "");
    const subject = clean(el.querySelector(".lead")?.textContent ?? "");
    if (!subject) continue;
    if (weekday < 0 || !pair) {
      extra.push(`${type}: ${subject}`);
      continue;
    }
    const mark = el.querySelector(".week1, .week2");
    const parity: Parity = mark?.classList.contains("week1") ? "odd" : mark?.classList.contains("week2") ? "even" : "both";
    lessons.push({ weekday, pair, start, end, parity, type, subject, ...details(el.querySelector(".opacity-75")?.textContent ?? "") });
  }
  return { group, lessons, currentParity, extra };
}

const TYPE_RE = /^(лекция|практическое занятие|лабораторн\S* (?:занятие|работа)|семинар|консультация|экзамен|зач[её]т|курсов\S* (?:работа|проект))(?=[\s,.]|$)/i; // \b в JS не работает с кириллицей

/** Разбор текста, скопированного со страницы расписания. */
export function parseText(text: string): GuapSchedule {
  const lines = text.split(/\r?\n/).map(clean);
  const lessons: Lesson[] = [];
  const extra: string[] = [];
  let currentParity: Parity | null = null;
  let group = text.match(/гр\.\s*(\d{3,5}\S*)/)?.[1] ?? "";
  let weekday = -1;
  let pair = 0;
  let start = "";
  let end = "";
  let mark: Parity | null = null;
  let cur: Lesson | null = null;
  for (const line of lines) {
    if (!line) continue;
    if (/неделя/i.test(line) && /[▲▼]/.test(line) && line.length > 2) {
      currentParity = parityOf(line);
      continue;
    }
    const day = DAYS.indexOf(line.toLowerCase());
    if (day >= 0) {
      weekday = day;
      pair = 0;
      cur = null;
      continue;
    }
    const pm = line.match(/^(\d+)\s*пара\s*\((\d{1,2}:\d{2})\s*[—–-]\s*(\d{1,2}:\d{2})\)/);
    if (pm) {
      pair = Number(pm[1]);
      start = pad(pm[2]);
      end = pad(pm[3]);
      cur = null;
      mark = null;
      continue;
    }
    if (line === "▲" || line === "▼") {
      mark = line === "▲" ? "odd" : "even";
      cur = null;
      continue;
    }
    if (TYPE_RE.test(line)) {
      cur = { weekday, pair, start, end, parity: mark ?? "both", type: line, subject: "" };
      mark = null;
      if (weekday >= 0 && pair) lessons.push(cur);
      else extra.push(line);
      continue;
    }
    if (!cur) continue;
    if (!cur.subject) cur.subject = line;
    else if (/^ауд\./.test(line)) cur.room = details(line).room;
    else if (/^преп:/.test(line) || /гр:/.test(line)) {
      const d = details(line);
      cur.teachers = d.teachers ?? cur.teachers;
      cur.groups = d.groups ?? cur.groups;
      if (!group && d.groups) group = d.groups.split(",")[0].trim();
    }
  }
  return { group, lessons: lessons.filter((l) => l.subject), currentParity, extra };
}

/** id группы на сайте по её номеру (из списка групп на странице). */
async function groupId(number: string): Promise<string> {
  const html = await net.text(BASE);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const opt = Array.from(doc.querySelectorAll("#selGroup option")).find((o) => clean(o.textContent ?? "").toLowerCase() === number.trim().toLowerCase());
  if (!opt) throw new Error(`Группа «${number}» не найдена в расписании ГУАП`);
  return (opt as HTMLOptionElement).value;
}

export async function fetchSchedule(number: string): Promise<GuapSchedule> {
  const id = await groupId(number);
  const html = await net.text(`${BASE}?gr=${id}`);
  const s = parseHtml(html, number.trim());
  if (!s.lessons.length) throw new Error("На странице расписания не нашлось занятий — возможно, сайт поменял вёрстку. Скопируйте текст расписания и вставьте его.");
  return s;
}

/** Конец семестра по умолчанию: осенью — 31 декабря, весной — 30 июня. */
export function defaultUntil(now = new Date()): string {
  const y = now.getFullYear();
  return now.getMonth() >= 7 ? `${y}-12-31` : `${y}-06-30`;
}

const EMOJI: [RegExp, string, string][] = [
  [/лекц/i, "🎓", "лекция"],
  [/лаб/i, "🧪", "лаба"],
  [/практ|семинар/i, "📝", "практика"],
  [/консульт/i, "💬", "консультация"],
  [/экзам|зач/i, "🎯", "экзамен"],
];

/**
 * Занятия → черновики повторяющихся событий. Неделя ▲/▼ — повтор раз в две недели,
 * с первой подходящей недели начиная с текущей. currentParity — чётность этой недели.
 */
export function lessonsToDrafts(s: GuapSchedule, currentParity: Parity, until: string, reminder: number, today = dayKey()): Draft[] {
  const week0 = dayKey(startOfWeek(fromKey(today)));
  return s.lessons.map((l) => {
    // Первая неделя нужной чётности: эта (0) или следующая (1); если день уже прошёл — ещё через период.
    let offset = l.parity === "both" || l.parity === currentParity ? 0 : 1;
    let date = shiftKey(week0, offset * 7 + l.weekday);
    if (date < today) {
      offset += l.parity === "both" ? 1 : 2;
      date = shiftKey(week0, offset * 7 + l.weekday);
    }
    const [, emoji, short] = EMOJI.find(([re]) => re.test(l.type)) ?? [null, "📚", l.type.toLowerCase()];
    const parityText = l.parity === "odd" ? "по верхним (нечётным) неделям ▲" : l.parity === "even" ? "по нижним (чётным) неделям ▼" : "каждую неделю";
    return {
      key: uid(),
      op: "create",
      kind: "event",
      title: `${emoji} ${l.subject} (${short})`,
      date,
      start: l.start,
      end: l.end,
      recurrence: { freq: "WEEKLY", byDay: [RRULE_DAYS[l.weekday]], interval: l.parity === "both" ? undefined : 2, until },
      category: "study",
      location: l.room,
      description: [`${l.type}, ${l.pair} пара, ${parityText}`, l.teachers && `Преподаватели: ${l.teachers}`, l.groups && `Группы: ${l.groups}`, `Расписание ГУАП, гр. ${s.group}`]
        .filter(Boolean)
        .join("\n"),
      reminders: reminder >= 0 ? [reminder] : [],
      source: "guap",
    } satisfies Draft;
  });
}
