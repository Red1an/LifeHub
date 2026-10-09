import fs from "node:fs";
import path from "node:path";
import * as db from "../db.ts";
import { getSettings } from "../settings.ts";
import { MODULES_DIR } from "../paths.ts";
import { emit } from "../events.ts";
import { googleFetch } from "../google.ts";
import { dayKey, fromKey, fromMinutes, shiftKey, toMinutes, weekday } from "./nlu.ts";

/*
 * Данные для Джарвиса: Google Календарь (с настройками модуля «Расписание») и коллекции
 * встроенных модулей. Форматы записей — как в самих модулях (modules/<id>/src).
 */

/* ───────────── календарь ───────────── */

const CAL = "https://www.googleapis.com/calendar/v3";
const enc = encodeURIComponent;

export interface PlannerPrefs {
  calendarId: string | null;
  readCalendars: string[];
  dayStart: string;
  dayEnd: string;
  defaultMinutes: number;
  reminder: number;
  allDayReminder: number;
  reminderTime: string;
}

const DEFAULT_PREFS: PlannerPrefs = {
  calendarId: null,
  readCalendars: [],
  dayStart: "08:00",
  dayEnd: "23:00",
  defaultMinutes: 60,
  reminder: 15,
  allDayReminder: 240,
  reminderTime: "09:00",
};

export const plannerPrefs = (): PlannerPrefs => ({ ...DEFAULT_PREFS, ...((db.getKv("planner", "prefs") as Partial<PlannerPrefs>) ?? {}) });

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  /** Не занимает время (напоминание). */
  free: boolean;
  kind: "event" | "reminder";
  location?: string;
}

async function gcal<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await googleFetch(["google:calendar"], { method, url: CAL + path, body });
  if (r.status >= 400) {
    const msg = (r.data as any)?.error?.message ?? `Google ответил ${r.status}`;
    throw new Error(msg);
  }
  return r.data as T;
}

let calendarsCache: { at: number; ids: string[] } | null = null;

/** Календари, которые показывает «Расписание»: выбранные в его настройках или видимые в Google. */
async function readCalendars(): Promise<string[]> {
  const prefs = plannerPrefs();
  if (prefs.readCalendars.length) return [...new Set([...prefs.readCalendars, ...(prefs.calendarId ? [prefs.calendarId] : [])])];
  if (calendarsCache && Date.now() - calendarsCache.at < 10 * 60_000) return calendarsCache.ids;
  const r = await gcal<{ items: { id: string; selected?: boolean; primary?: boolean }[] }>("GET", "/users/me/calendarList?minAccessRole=reader&maxResults=250");
  const ids = (r.items ?? []).filter((c) => c.selected || c.primary).map((c) => c.id);
  if (prefs.calendarId && !ids.includes(prefs.calendarId)) ids.push(prefs.calendarId);
  calendarsCache = { at: Date.now(), ids };
  return ids;
}

const eventsCache = new Map<string, { at: number; events: CalEvent[] }>();

export function invalidateEvents() {
  eventsCache.clear();
}

/** События за период [from, to). Кэш на минуту: Алиса ждёт ответ не дольше 3 секунд. */
export async function listEvents(from: Date, to: Date): Promise<CalEvent[]> {
  const key = `${from.getTime()}|${to.getTime()}`;
  const hit = eventsCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.events;
  const cals = await readCalendars();
  const lists = await Promise.all(
    cals.map(async (id) => {
      const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
      const r = await gcal<{ items: any[] }>("GET", `/calendars/${enc(id)}/events?${q}`).catch(() => ({ items: [] }));
      return (r.items ?? [])
        .filter((e) => e.status !== "cancelled" && e.start)
        .map((e): CalEvent => {
          const allDay = !!e.start.date;
          return {
            id: e.id,
            calendarId: id,
            title: e.summary || "без названия",
            start: new Date(allDay ? e.start.date + "T00:00:00" : e.start.dateTime),
            end: new Date(allDay ? e.end.date + "T00:00:00" : e.end.dateTime),
            allDay,
            free: e.transparency === "transparent",
            kind: e.extendedProperties?.private?.kind === "reminder" ? "reminder" : "event",
            location: e.location,
          };
        });
    }),
  );
  const events = lists.flat().sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
  eventsCache.set(key, { at: Date.now(), events });
  return events;
}

export const eventsOn = (date: string) => listEvents(fromKey(date), fromKey(shiftKey(date, 1)));

/** Свободные окна дня (от минимальной длины), с учётом начала и конца дня из «Расписания». */
export function freeSlots(date: string, events: CalEvent[], minMinutes = 30, now = new Date()): { start: string; end: string }[] {
  const prefs = plannerPrefs();
  let from = toMinutes(prefs.dayStart);
  const to = toMinutes(prefs.dayEnd);
  if (date === dayKey(now)) from = Math.max(from, now.getHours() * 60 + now.getMinutes());
  const busy = events
    .filter((e) => !e.allDay && !e.free)
    .map((e) => [
      dayKey(e.start) < date ? 0 : e.start.getHours() * 60 + e.start.getMinutes(),
      dayKey(e.end) > date ? 24 * 60 : e.end.getHours() * 60 + e.end.getMinutes(),
    ])
    .sort((a, b) => a[0] - b[0]);
  const out: { start: string; end: string }[] = [];
  let cur = from;
  for (const [s, e] of busy) {
    if (s - cur >= minMinutes && s > cur) out.push({ start: fromMinutes(cur), end: fromMinutes(Math.min(s, to)) });
    cur = Math.max(cur, e);
    if (cur >= to) break;
  }
  if (to - cur >= minMinutes) out.push({ start: fromMinutes(cur), end: fromMinutes(to) });
  return out.filter((s) => toMinutes(s.end) - toMinutes(s.start) >= minMinutes);
}

export type Category = "work" | "study" | "sport" | "health" | "personal" | "social" | "rest" | "reminder" | "other";

/** Цвета категорий — как в «Расписании». */
const CATEGORY_COLOR: Record<Category, string> = {
  work: "9", study: "7", sport: "10", health: "2", personal: "5", social: "4", rest: "1", reminder: "6", other: "8",
};

export interface NewEvent {
  title: string;
  date: string;
  /** Нет — на весь день. */
  start?: string;
  minutes?: number;
  kind: "event" | "reminder";
  category: Category;
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function times(e: { date: string; start?: string; minutes?: number; kind: string }) {
  const prefs = plannerPrefs();
  if (!e.start) return { start: { date: e.date }, end: { date: shiftKey(e.date, 1) } };
  const len = e.minutes ?? (e.kind === "reminder" ? 15 : prefs.defaultMinutes);
  const endMin = toMinutes(e.start) + len;
  const endDate = endMin >= 24 * 60 ? shiftKey(e.date, 1) : e.date;
  const end = fromMinutes(endMin % (24 * 60));
  return { start: { dateTime: `${e.date}T${e.start}:00`, timeZone: tz() }, end: { dateTime: `${endDate}T${end}:00`, timeZone: tz() } };
}

/** Создаёт событие в календаре «Расписания» — так же, как это делает сам модуль. */
export async function createEvent(e: NewEvent): Promise<{ id: string; calendarId: string }> {
  const prefs = plannerPrefs();
  const calendarId = prefs.calendarId ?? "primary";
  const reminders = e.kind === "reminder" ? [0] : e.start ? (prefs.reminder >= 0 ? [prefs.reminder] : []) : prefs.allDayReminder >= 0 ? [prefs.allDayReminder] : [];
  const r = await gcal<{ id: string }>("POST", `/calendars/${enc(calendarId)}/events`, {
    summary: e.title,
    colorId: CATEGORY_COLOR[e.category],
    ...times(e),
    reminders: { useDefault: false, overrides: reminders.map((minutes) => ({ method: "popup", minutes })) },
    transparency: e.kind === "reminder" ? "transparent" : "opaque",
    extendedProperties: { private: { lifehub: "planner", category: e.category, kind: e.kind, source: "alice" } },
  });
  invalidateEvents();
  return { id: r.id, calendarId };
}

/** Перенос события: новая дата/время, длительность сохраняется. */
export async function moveEvent(ev: CalEvent, date: string, start?: string) {
  const minutes = Math.round((ev.end.getTime() - ev.start.getTime()) / 60_000);
  const body = ev.allDay && !start ? { start: { date }, end: { date: shiftKey(date, Math.max(1, Math.round(minutes / 1440))) } } : times({ date, start: start ?? "09:00", minutes, kind: ev.kind });
  await gcal("PATCH", `/calendars/${enc(ev.calendarId)}/events/${enc(ev.id)}`, body);
  invalidateEvents();
}

export async function deleteEvent(ev: { id: string; calendarId: string }) {
  await gcal("DELETE", `/calendars/${enc(ev.calendarId)}/events/${enc(ev.id)}`);
  invalidateEvents();
}

/** Категория события по словам названия. */
export function guessCategory(title: string, reminder: boolean): Category {
  const t = title.toLowerCase();
  if (/трениров|зал|бег|пробежк|бассейн|йог|футбол|спорт|зарядк|турник/.test(t)) return "sport";
  if (/пар[аыу]|лекци|семинар|экзамен|зачет|зачёт|учеб|учёб|урок|курс|лаб|домашк|диплом|курсовую|курсовая/.test(t)) return "study";
  if (/врач|стоматолог|анализ|больниц|поликлиник|аптек|массаж|терапевт/.test(t)) return "health";
  if (/встреч|созвон|звонок|митинг|работ|офис|дейли|собеседован|клиент/.test(t)) return "work";
  if (/день рожд|друз|вечеринк|свидани|гости|кино|концерт/.test(t)) return "social";
  if (/отдых|сон|прогулк|отпуск/.test(t)) return "rest";
  return reminder ? "reminder" : "personal";
}

/* ───────────── модули ───────────── */

/** Модуль установлен и включён: выключенные модули Джарвис не читает и не трогает. */
export function enabled(id: string): boolean {
  return !getSettings().disabled.includes(id) && fs.existsSync(path.join(MODULES_DIR, id, "lifehub.json"));
}

function changed(module: string, collection: string) {
  emit({ type: "data", module, collection, origin: "jarvis" });
}

export function addDoc(module: string, collection: string, data: Record<string, unknown>, id?: string) {
  const doc = db.putDoc(module, collection, id, data, false);
  changed(module, collection);
  return doc;
}

export function removeDoc(module: string, collection: string, id: string) {
  db.deleteDoc(module, collection, id);
  changed(module, collection);
}

/* Привычки */

export interface Habit {
  id: string;
  name: string;
  icon: string;
  days: number[];
  archived?: boolean;
}

const isPlanned = (h: Habit, d: Date) => !h.days?.length || h.days.includes(weekday(d));

export function habits(): Habit[] {
  if (!enabled("habits")) return [];
  return (db.listDocs("habits", "habits") as unknown as Habit[]).filter((h) => !h.archived);
}

export function habitChecks(): Set<string> {
  return new Set(db.listDocs("habits", "checks").map((c) => c.id));
}

/** Привычки на день: запланированные, с отметкой и серией. */
export function habitsFor(date: string) {
  const done = habitChecks();
  const d = fromKey(date);
  return habits()
    .filter((h) => isPlanned(h, d))
    .map((h) => ({ ...h, done: done.has(`${h.id}_${date}`), streak: streak(h, done) }));
}

/** Серия: запланированные дни подряд (сегодня можно ещё не отметить) — как в модуле. */
function streak(h: Habit, done: Set<string>) {
  let n = 0;
  const d = new Date();
  if (!done.has(`${h.id}_${dayKey(d)}`)) d.setDate(d.getDate() - 1);
  for (let i = 0; i < 400; i++) {
    if (isPlanned(h, d)) {
      if (!done.has(`${h.id}_${dayKey(d)}`)) break;
      n++;
    }
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function checkHabit(habitId: string, date: string) {
  const id = `${habitId}_${date}`;
  addDoc("habits", "checks", { habitId, date }, id);
  return id;
}

/* Финансы */

export interface Tx {
  id: string;
  kind: "expense" | "income";
  amount: number;
  category: string;
  date: string;
  note?: string;
}

const DEFAULT_FINANCE_CATEGORIES = [
  { name: "Продукты", kind: "expense" }, { name: "Кафе", kind: "expense" }, { name: "Транспорт", kind: "expense" },
  { name: "Дом", kind: "expense" }, { name: "Здоровье", kind: "expense" }, { name: "Развлечения", kind: "expense" },
  { name: "Одежда", kind: "expense" }, { name: "Подписки", kind: "expense" }, { name: "Другое", kind: "expense" },
  { name: "Зарплата", kind: "income" }, { name: "Подработка", kind: "income" }, { name: "Подарки", kind: "income" },
];

export function financeCategories(): { name: string; kind: string }[] {
  return (db.getKv("finance", "categories") as { name: string; kind: string }[] | undefined) ?? DEFAULT_FINANCE_CATEGORIES;
}

export const transactions = () => (enabled("finance") ? (db.listDocs("finance", "transactions") as unknown as Tx[]) : []);
export const monthlyBudget = () => Number(db.getKv("finance", "budget") ?? 0);

/* Заметки */

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  updatedAt: number;
}

export const notes = () => (enabled("notes") ? (db.listDocs("notes", "notes") as unknown as Note[]) : []);

/* Расписание: задачи с дедлайном */

export interface Task {
  id: string;
  title: string;
  deadline: string;
  deadlineTime?: string;
  done: boolean;
  estimate: number;
  blocks: { minutes: number; done?: boolean; missed?: boolean }[];
}

export const openTasks = () => (!enabled("planner") ? [] : (db.listDocs("planner", "tasks") as unknown as Task[]).filter((t) => !t.done));

/* DevPath */

export interface Quest {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  xp: number;
  done?: boolean;
}

export const devpathDay = (date: string) => (!enabled("devpath") ? null : (db.getDoc("devpath", "days", date) as unknown as { quests: Quest[] } | null)?.quests ?? null);

export const devpathXp = (date: string) =>
  !enabled("devpath") ? 0 : db.listDocs("devpath", "log").reduce((s, l: any) => s + (l.date === date ? Number(l.xp) || 0 : 0), 0);

export interface Card {
  id: string;
  front: string;
  back: string;
  topicId: string;
}

export const devpathCards = () => (enabled("devpath") ? (db.listDocs("devpath", "cards") as unknown as Card[]) : []);

/* Форма */

export function fitWeek(now = new Date()) {
  if (!enabled("fit")) return { workouts: 0, morning: 0, perWeek: 0 };
  const monday = shiftKey(dayKey(now), -weekday(now));
  const workouts = db.listDocs("fit", "workouts").filter((w: any) => (w.kind ?? "") !== "morning" && dayKey(new Date(Number(w.startedAt) || w.createdAt)) >= monday);
  const morning = db.listDocs("fit", "workouts").filter((w: any) => w.kind === "morning" && dayKey(new Date(Number(w.startedAt) || w.createdAt)) >= monday);
  const profile = (db.getKv("fit", "profile") as { perWeek?: number } | undefined) ?? {};
  return { workouts: workouts.length, morning: morning.length, perWeek: profile.perWeek ?? 0 };
}

/* Гитара */

export function guitarDays(): string[] {
  if (!enabled("guitar")) return [];
  const raw = db.getKv("guitar", "guitarhub_practice-days");
  let map: Record<string, unknown> = {};
  try {
    map = typeof raw === "string" ? JSON.parse(raw) : ((raw as Record<string, unknown>) ?? {});
  } catch {}
  return Object.keys(map).sort();
}

/* Инвестиции */

export function portfolioSnapshots(): { date: string; value: number; invested: number }[] {
  if (!enabled("invest")) return [];
  const s = db.getKv("invest", "snapshots");
  return Array.isArray(s) ? (s as { date: string; value: number; invested: number }[]) : [];
}
