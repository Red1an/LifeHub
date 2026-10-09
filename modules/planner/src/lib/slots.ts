import { dayKey } from "@lifehub/sdk";
import type { CalEvent, Draft, PendingTask, Prefs } from "./types.ts";
import { fromKey, fromMinutes, shiftKey, toMinutes } from "./time.ts";

/*
 * Свободное время и раскладка задач по нему. Без нейронки: так блоки работы
 * гарантированно не пересекаются с занятым временем и укладываются до дедлайна.
 */

/** Свободное окно: день и минуты от его начала. */
export interface Slot {
  date: string;
  start: number;
  end: number;
}

export interface Busy {
  start: number;
  end: number;
}

const DAY = 86_400_000;

/** Что занимает время: всё, кроме напоминаний, «свободных» событий и событий на весь день. */
export function blocksTime(e: CalEvent) {
  return !e.allDay && e.kind !== "reminder" && !e.free;
}

export function busyFromEvents(events: CalEvent[]): Busy[] {
  return events.filter(blocksTime).map((e) => ({ start: e.start.getTime(), end: e.end.getTime() }));
}

/** Черновики «создать/изменить» тоже занимают время — чтобы новые блоки с ними не пересекались. */
export function busyFromDrafts(drafts: Draft[], prefs: Prefs): Busy[] {
  return drafts
    .filter((d) => !d.skip && d.op !== "delete" && d.start && d.kind !== "reminder" && !d.recurrence)
    .map((d) => {
      const s = fromKey(d.date).getTime() + toMinutes(d.start!) * 60_000;
      let e = fromKey(d.date).getTime() + (d.end ? toMinutes(d.end) : toMinutes(d.start!) + prefs.defaultMinutes) * 60_000;
      if (e <= s) e += DAY;
      return { start: s, end: e };
    });
}

/** Свободные окна с from до to (Date) внутри активного дня, с буфером вокруг занятого. */
export function freeSlots(busy: Busy[], from: Date, to: Date, prefs: Prefs): Slot[] {
  const out: Slot[] = [];
  const buffer = prefs.buffer * 60_000;
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  for (let k = dayKey(from); fromKey(k).getTime() < to.getTime(); k = shiftKey(k, 1)) {
    const day0 = fromKey(k).getTime();
    let s = day0 + toMinutes(prefs.dayStart) * 60_000;
    let e = day0 + (prefs.dayEnd === "00:00" ? 1440 : toMinutes(prefs.dayEnd)) * 60_000;
    // Не раньше «сейчас», округлённого вверх до 15 минут.
    s = Math.max(s, Math.ceil(from.getTime() / 900_000) * 900_000);
    e = Math.min(e, to.getTime());
    if (e - s < 15 * 60_000) continue;
    let cur = s;
    for (const b of sorted) {
      const bs = b.start - buffer;
      const be = b.end + buffer;
      if (be <= cur || bs >= e) continue;
      if (bs > cur) out.push({ date: k, start: (cur - day0) / 60_000, end: (bs - day0) / 60_000 });
      cur = Math.max(cur, be);
      if (cur >= e) break;
    }
    if (e > cur) out.push({ date: k, start: (cur - day0) / 60_000, end: (e - day0) / 60_000 });
  }
  return out.filter((x) => x.end - x.start >= 15);
}

/** Ближайшие окна нужной длины (для переноса пропущенного). */
export function nextSlots(busy: Busy[], minutes: number, prefs: Prefs, opts: { from?: Date; before?: Date; count?: number } = {}): Slot[] {
  const from = opts.from ?? new Date();
  const to = opts.before ?? new Date(from.getTime() + prefs.horizon * DAY);
  const res: Slot[] = [];
  const seenDays = new Map<string, number>();
  for (const s of freeSlots(busy, from, to, prefs)) {
    if (s.end - s.start < minutes) continue;
    // Не больше двух вариантов на день — чтобы варианты были разными.
    const n = seenDays.get(s.date) ?? 0;
    if (n >= 2) continue;
    seenDays.set(s.date, n + 1);
    res.push({ date: s.date, start: s.start, end: s.start + minutes });
    if (res.length >= (opts.count ?? 4)) break;
  }
  return res;
}

export interface TaskPlan {
  blocks: { date: string; start: string; end: string; minutes: number }[];
  /** Сколько минут не уместилось до дедлайна. */
  unplaced: number;
}

/**
 * Раскладывает оставшуюся работу по задаче на блоки: равномерно по дням до дедлайна,
 * не больше prefs.taskPerDay в день, стараясь закончить за день до срока.
 */
export function planTask(task: Pick<PendingTask, "estimate" | "chunk" | "deadline" | "deadlineTime">, remaining: number, busy: Busy[], prefs: Prefs, now = new Date()): TaskPlan {
  const deadline = fromKey(task.deadline).getTime() + (task.deadlineTime ? toMinutes(task.deadlineTime) : toMinutes(prefs.dayEnd === "00:00" ? "23:59" : prefs.dayEnd)) * 60_000;
  const chunk = Math.max(30, task.chunk || 90);
  const blocks: TaskPlan["blocks"] = [];
  let left = Math.max(0, remaining);
  if (left === 0 || deadline <= now.getTime()) return { blocks, unplaced: left };

  const taken = [...busy];
  /** whole — только целые блоки (или весь остаток), без мелких кусков по щелям. */
  const tryPlace = (until: number, perDay: number, whole: boolean, spread: boolean) => {
    const days = new Map<string, number>();
    for (const b of blocks) days.set(b.date, (days.get(b.date) ?? 0) + b.minutes);
    const slots = freeSlots(taken, now, new Date(until), prefs);
    const dayList = [...new Set(slots.map((s) => s.date))];
    const dayCount = dayList.length || 1;
    // Равномерно: целевое количество работы в день, но не меньше одного блока.
    const target = Math.min(perDay, Math.max(chunk, Math.ceil(left / dayCount / 15) * 15));
    // Работы меньше, чем дней (курсовая на два месяца), — блок раз в несколько дней, а не каждый день подряд.
    const stride = spread ? Math.max(1, Math.floor(dayCount / Math.ceil(left / chunk))) : 1;
    const dayIdx = new Map(dayList.map((d, i) => [d, i]));
    for (const s of slots) {
      if (left <= 0) break;
      if ((dayIdx.get(s.date) ?? 0) % stride !== 0) continue;
      let cur = s.start;
      while (left > 0 && s.end - cur >= Math.min(30, left)) {
        const used = days.get(s.date) ?? 0;
        if (used >= target) break;
        const want = Math.min(chunk, left);
        const len = Math.min(want, s.end - cur, target - used);
        if (whole ? len < want : len < Math.min(30, left)) break;
        blocks.push({ date: s.date, start: fromMinutes(cur), end: fromMinutes(cur + len), minutes: len });
        const day0 = fromKey(s.date).getTime();
        taken.push({ start: day0 + cur * 60_000, end: day0 + (cur + len) * 60_000 });
        days.set(s.date, used + len);
        left -= len;
        cur += len + prefs.buffer;
      }
    }
  };
  // Сначала — с запасом в день до дедлайна, потом до самого срока, потом плотнее.
  const dayBefore = deadline - DAY;
  if (dayBefore > now.getTime()) tryPlace(dayBefore, prefs.taskPerDay, true, true);
  if (left > 0) tryPlace(deadline, prefs.taskPerDay, true, false);
  // Не влезает целыми блоками — плотнее и кусками от 30 минут.
  if (left > 0) tryPlace(deadline, Math.max(prefs.taskPerDay * 2, 360), false, false);
  blocks.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  return { blocks, unplaced: left };
}
