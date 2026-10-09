import { useCallback, useEffect, useState } from "react";
import { google, useGoogle, useStore } from "@lifehub/sdk";
import { CATEGORIES, DEFAULT_PREFS, GOOGLE_COLORS, type CalEvent, type CalendarInfo, type Category, type Draft, type Prefs } from "./types.ts";
import { fromMinutes, shiftKey, timeZone, toMinutes } from "./time.ts";

/* Всё общение с Google Calendar API v3 — через google.calendar() хаба. */

const enc = encodeURIComponent;

export function usePrefs() {
  const [prefs, setPrefs, meta] = useStore<Prefs>("prefs", DEFAULT_PREFS);
  const merged = { ...DEFAULT_PREFS, ...prefs };
  const update = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...DEFAULT_PREFS, ...p, ...patch })), [setPrefs]);
  return { prefs: merged, update, loading: meta.loading };
}

/* ───────────── обновление после изменений ───────────── */

let version = 0;
const listeners = new Set<() => void>();
/** Сообщить страницам, что события изменились. */
export function eventsChanged() {
  version++;
  for (const l of listeners) l();
}
function useVersion() {
  const [v, setV] = useState(version);
  useEffect(() => {
    const l = () => setV(version);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return v;
}

/* ───────────── календари ───────────── */

let calendarsCache: CalendarInfo[] | null = null;

export async function loadCalendars(force = false): Promise<CalendarInfo[]> {
  if (calendarsCache && !force) return calendarsCache;
  const r = await google.calendar<{ items: CalendarInfo[] }>("/users/me/calendarList", { query: { minAccessRole: "reader", maxResults: 250 } });
  calendarsCache = (r.items ?? []).sort((a, b) => Number(!!b.primary) - Number(!!a.primary) || a.summary.localeCompare(b.summary));
  return calendarsCache;
}

export function useCalendars() {
  const { status } = useGoogle();
  const [list, setList] = useState<CalendarInfo[] | null>(calendarsCache);
  const [error, setError] = useState<string | null>(null);
  const v = useVersion();
  useEffect(() => {
    if (!status?.connected) return;
    loadCalendars()
      .then((l) => {
        setList(l);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [status?.connected, v]);
  return { calendars: list, error, google: status };
}

export async function createLifehubCalendar(): Promise<CalendarInfo> {
  const cal = await google.calendar<{ id: string }>("/calendars", { method: "POST", body: { summary: "LifeHub", description: "События, которые ставит модуль «Расписание» в LifeHub", timeZone: timeZone() } });
  await google
    .calendar(`/users/me/calendarList/${enc(cal.id)}`, { method: "PATCH", query: { colorRgbFormat: true }, body: { backgroundColor: "#7c6cf0", foregroundColor: "#ffffff" } })
    .catch(() => {});
  const list = await loadCalendars(true);
  eventsChanged();
  return list.find((c) => c.id === cal.id) ?? { id: cal.id, summary: "LifeHub", accessRole: "owner" };
}

/** Календари, которые показываем: выбранные в настройках или видимые в Google, плюс целевой. */
export function visibleCalendars(all: CalendarInfo[], prefs: Prefs): CalendarInfo[] {
  const ids = new Set(prefs.readCalendars.length ? prefs.readCalendars : all.filter((c) => c.selected || c.primary).map((c) => c.id));
  if (prefs.calendarId) ids.add(prefs.calendarId);
  return all.filter((c) => ids.has(c.id));
}

/* ───────────── события ───────────── */

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  htmlLink?: string;
  recurringEventId?: string;
  recurrence?: string[];
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
  transparency?: string;
}

function toEvent(e: GEvent, cal: CalendarInfo): CalEvent {
  const allDay = !!e.start.date;
  const priv = e.extendedProperties?.private ?? {};
  return {
    id: e.id,
    calendarId: cal.id,
    title: e.summary || "(без названия)",
    start: new Date(allDay ? e.start.date + "T00:00:00" : e.start.dateTime!),
    end: new Date(allDay ? e.end.date + "T00:00:00" : e.end.dateTime!),
    allDay,
    color: (e.colorId && GOOGLE_COLORS[e.colorId]) || cal.backgroundColor || "#7c6cf0",
    location: e.location,
    description: e.description,
    htmlLink: e.htmlLink,
    recurringEventId: e.recurringEventId,
    ours: priv.lifehub === "planner",
    category: priv.category as Category | undefined,
    kind: priv.kind === "reminder" ? "reminder" : "event",
    taskId: priv.task || undefined,
    source: priv.source,
    free: e.transparency === "transparent",
    canEdit: cal.accessRole === "owner" || cal.accessRole === "writer",
  };
}

export async function listEvents(calendars: CalendarInfo[], from: Date, to: Date): Promise<CalEvent[]> {
  const lists = await Promise.all(
    calendars.map(async (cal) => {
      const items: GEvent[] = [];
      let pageToken: string | undefined;
      do {
        const r = await google.calendar<{ items: GEvent[]; nextPageToken?: string }>(`/calendars/${enc(cal.id)}/events`, {
          query: { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 2500, pageToken },
        });
        items.push(...(r.items ?? []));
        pageToken = r.nextPageToken;
      } while (pageToken);
      return items.filter((e) => e.status !== "cancelled" && e.start).map((e) => toEvent(e, cal));
    }),
  );
  return lists.flat().sort((a, b) => a.start.getTime() - b.start.getTime() || Number(b.allDay) - Number(a.allDay));
}

/** События за период с автоматическим обновлением после изменений. */
export function useEvents(from: Date, to: Date) {
  const { calendars, error: calError, google: status } = useCalendars();
  const { prefs } = usePrefs();
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const v = useVersion();
  const cals = calendars ? visibleCalendars(calendars, prefs) : null;
  const key = `${from.getTime()}|${to.getTime()}|${cals?.map((c) => c.id).join(",")}|${v}`;
  useEffect(() => {
    if (!cals) return;
    let alive = true;
    listEvents(cals, from, to)
      .then((e) => {
        if (!alive) return;
        setEvents(e);
        setError(null);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [key]);
  return { events, error: error ?? calError, google: status, calendars };
}

/* ───────────── черновик → Google ───────────── */

function rrule(d: Draft): string[] | undefined {
  const r = d.recurrence;
  if (!r) return undefined;
  const parts = [`FREQ=${r.freq}`];
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY" && r.byDay?.length) parts.push(`BYDAY=${r.byDay.join(",")}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, "")}T235959Z`);
  else if (r.count) parts.push(`COUNT=${r.count}`);
  return [`RRULE:${parts.join(";")}`];
}

/** Напоминания события: явные, старый формат или по настройкам. */
export function remindersOf(d: Draft, prefs: Prefs): number[] {
  if (Array.isArray(d.reminders)) return d.reminders;
  if (d.reminder !== undefined) return d.reminder === null ? [] : [d.reminder];
  if (d.kind === "reminder") return [0];
  const def = d.start ? prefs.reminder : prefs.allDayReminder;
  return def >= 0 ? [def] : [];
}

function times(d: Draft, prefs: Prefs, tz: string) {
  if (!d.start) {
    return { start: { date: d.date }, end: { date: shiftKey(d.endDate && d.endDate >= d.date ? d.endDate : d.date, 1) } };
  }
  const end = d.end ?? fromMinutes(toMinutes(d.start) + (d.kind === "reminder" ? 15 : prefs.defaultMinutes));
  // Конец раньше начала — событие заканчивается на следующий день.
  const endDate = toMinutes(end) <= toMinutes(d.start) ? shiftKey(d.date, 1) : d.date;
  return { start: { dateTime: `${d.date}T${d.start}:00`, timeZone: tz }, end: { dateTime: `${endDate}T${end}:00`, timeZone: tz } };
}

function body(d: Draft, prefs: Prefs, tz: string) {
  const reminders = [...new Set(remindersOf(d, prefs))].filter((m) => m >= 0 && m <= 40320).slice(0, 5);
  return {
    summary: d.title,
    description: d.description || undefined,
    location: d.location || undefined,
    colorId: CATEGORIES[d.category]?.colorId,
    ...times(d, prefs, tz),
    recurrence: rrule(d),
    reminders: { useDefault: false, overrides: reminders.map((minutes) => ({ method: "popup", minutes })) },
    // Напоминание не занимает время: его не видно как «занято» в календаре и у других людей.
    transparency: d.kind === "reminder" ? "transparent" : "opaque",
    extendedProperties: {
      private: { lifehub: "planner", category: d.category, kind: d.kind ?? "event", source: d.source ?? "text", ...(d.taskId ? { task: d.taskId, role: d.taskRole ?? "block" } : {}) },
    },
  };
}

/** Применяет одно изменение. Возвращает id события. */
export async function applyDraft(d: Draft, prefs: Prefs): Promise<string> {
  const tz = timeZone();
  const target = prefs.calendarId ?? "primary";
  if (d.op === "create") {
    const r = await google.calendar<{ id: string }>(`/calendars/${enc(target)}/events`, { method: "POST", body: body(d, prefs, tz) });
    return r.id;
  }
  const cal = d.calendarId ?? target;
  if (!d.eventId) throw new Error("Нет id события");
  if (d.op === "delete") {
    await google.calendar(`/calendars/${enc(cal)}/events/${enc(d.eventId)}`, { method: "DELETE" });
    return d.eventId;
  }
  const b: Record<string, unknown> = body(d, prefs, tz);
  if (d.series) {
    // У серии меняем время и поля, но не дату первого повтора.
    const master = await google.calendar<GEvent>(`/calendars/${enc(cal)}/events/${enc(d.eventId)}`);
    const firstDay = master.start.date ?? master.start.dateTime!.slice(0, 10);
    Object.assign(b, times({ ...d, date: firstDay, endDate: undefined }, prefs, master.start.timeZone ?? tz));
    if (!d.recurrence) delete b.recurrence;
  } else {
    delete b.recurrence;
  }
  await google.calendar(`/calendars/${enc(cal)}/events/${enc(d.eventId)}`, { method: "PATCH", body: b });
  return d.eventId;
}

export async function deleteEvent(e: CalEvent, series = false) {
  const id = series && e.recurringEventId ? e.recurringEventId : e.id;
  await google.calendar(`/calendars/${enc(e.calendarId)}/events/${enc(id)}`, { method: "DELETE" });
  eventsChanged();
}

/** Перенос одного события (или одного дня серии) на новое время. */
export async function moveEvent(e: CalEvent, date: string, start: string, end: string) {
  const tz = timeZone();
  const endDate = toMinutes(end) <= toMinutes(start) ? shiftKey(date, 1) : date;
  await google.calendar(`/calendars/${enc(e.calendarId)}/events/${enc(e.id)}`, {
    method: "PATCH",
    body: { start: { dateTime: `${date}T${start}:00`, timeZone: tz }, end: { dateTime: `${endDate}T${end}:00`, timeZone: tz } },
  });
  eventsChanged();
}

/** Занятость на дни вперёд по видимым календарям (с начала сегодняшнего дня). */
export async function loadBusy(prefs: Prefs, days = prefs.horizon): Promise<CalEvent[]> {
  const all = await loadCalendars();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + (days + 1) * 86_400_000);
  return listEvents(visibleCalendars(all, prefs), from, to);
}

/** Свои серии/события с заданным source (например, расписание ГУАП) — исходные, без разворачивания повторов. */
export async function listOurBySource(prefs: Prefs, source: string): Promise<{ id: string; summary?: string; recurrence?: string[] }[]> {
  const cal = prefs.calendarId ?? "primary";
  const items: GEvent[] = [];
  let pageToken: string | undefined;
  do {
    const r = await google.calendar<{ items: GEvent[]; nextPageToken?: string }>(`/calendars/${enc(cal)}/events`, {
      query: { privateExtendedProperty: ["lifehub=planner", `source=${source}`], maxResults: 2500, pageToken, showDeleted: false },
    });
    items.push(...(r.items ?? []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return items.filter((e) => e.status !== "cancelled").map((e) => ({ id: e.id, summary: e.summary, recurrence: e.recurrence }));
}

export async function deleteById(calendarId: string, id: string) {
  await google.calendar(`/calendars/${enc(calendarId)}/events/${enc(id)}`, { method: "DELETE" });
}
