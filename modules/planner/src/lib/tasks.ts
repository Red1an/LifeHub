import { db, uid } from "@lifehub/sdk";
import { busyFromDrafts, busyFromEvents, planTask } from "./slots.ts";
import type { CalEvent, Draft, PendingTask, Prefs, Task, TaskBlock } from "./types.ts";
import { dayLabel } from "./time.ts";
import { markNoteDone } from "./notes.ts";

/*
 * Задачи с дедлайном. Нейронка (или форма) описывает задачу, а блоки работы
 * раскладывает planTask по свободному времени. После применения черновика задача
 * сохраняется в коллекцию tasks вместе с id созданных событий.
 */

export const tasksDb = () => db.collection<Task>("tasks");

export const doneMinutes = (t: Task) => t.blocks.filter((b) => b.done).reduce((s, b) => s + b.minutes, 0);

/** Сколько работы ещё не сделано и не запланировано на будущее. */
export function remainingToPlan(t: Task, now = Date.now()) {
  const future = t.blocks.filter((b) => !b.done && !b.missed && new Date(`${b.date}T${b.end}:00`).getTime() > now).reduce((s, b) => s + b.minutes, 0);
  return Math.max(0, t.estimate - doneMinutes(t) - future);
}

export function deadlineLabel(t: Pick<Task, "deadline" | "deadlineTime">) {
  return `${dayLabel(t.deadline).toLowerCase()}${t.deadlineTime ? ` в ${t.deadlineTime}` : ""}`;
}

/**
 * Черновики для задач: блоки работы + напоминание о дедлайне (для новых задач).
 * existingDrafts — уже есть в черновике (их время тоже считается занятым).
 */
export function draftsForTasks(tasks: PendingTask[], remaining: Record<string, number>, events: CalEvent[], existingDrafts: Draft[], prefs: Prefs): { drafts: Draft[]; tasks: PendingTask[] } {
  const busy = [...busyFromEvents(events), ...busyFromDrafts(existingDrafts, prefs)];
  const drafts: Draft[] = [];
  const out: PendingTask[] = [];
  const sorted = [...tasks].sort((a, b) => a.deadline.localeCompare(b.deadline));
  for (const t of sorted) {
    const plan = planTask(t, remaining[t.id] ?? t.estimate, busy, prefs);
    const n = plan.blocks.length;
    plan.blocks.forEach((b, i) => {
      drafts.push({
        key: uid(),
        op: "create",
        kind: "event",
        title: `📝 ${t.title}${n > 1 ? ` · ${i + 1}/${n}` : ""}`,
        date: b.date,
        start: b.start,
        end: b.end,
        category: t.category,
        description: `Работа над задачей «${t.title}». Дедлайн: ${deadlineLabel(t)}.${t.notes ? `\n${t.notes}` : ""}`,
        reminders: [10],
        source: "task",
        taskId: t.id,
        taskRole: "block",
        noteId: t.noteId,
      });
      const day0 = new Date(`${b.date}T00:00:00`).getTime();
      const [sh, sm] = b.start.split(":").map(Number);
      busy.push({ start: day0 + (sh * 60 + sm) * 60_000, end: day0 + (sh * 60 + sm + b.minutes) * 60_000 });
    });
    if (!t.existing) {
      drafts.push({
        key: uid(),
        op: "create",
        kind: "reminder",
        title: `⏰ Дедлайн: ${t.title}`,
        date: t.deadline,
        start: t.deadlineTime ?? prefs.reminderTime,
        category: "reminder",
        description: t.notes,
        reminders: [1440, 0],
        source: "task",
        taskId: t.id,
        taskRole: "deadline",
        noteId: t.noteId,
      });
    }
    out.push({ ...t, unplaced: plan.unplaced });
  }
  return { drafts, tasks: out };
}

/** После применения черновика: сохраняем задачи и привязываем созданные события. */
export async function saveTasks(pending: PendingTask[], applied: { draft: Draft; eventId: string; calendarId: string }[]) {
  const col = tasksDb();
  for (const p of pending) {
    const mine = applied.filter((a) => a.draft.taskId === p.id);
    if (!mine.length && !p.existing) continue;
    const blocks: TaskBlock[] = mine
      .filter((a) => a.draft.taskRole === "block")
      .map((a) => ({
        eventId: a.eventId,
        calendarId: a.calendarId,
        date: a.draft.date,
        start: a.draft.start!,
        end: a.draft.end!,
        minutes: minutesBetween(a.draft.start!, a.draft.end!),
      }));
    const dl = mine.find((a) => a.draft.taskRole === "deadline");
    const prev = await col.get(p.id);
    const { id: _id, existing: _e, unplaced: _u, ...fields } = p;
    if (prev) {
      await col.update(p.id, { blocks: [...prev.blocks, ...blocks], ...(dl ? { deadlineEvent: { eventId: dl.eventId, calendarId: dl.calendarId } } : {}) });
    } else {
      await col.put(p.id, {
        ...fields,
        done: false,
        blocks,
        deadlineEvent: dl ? { eventId: dl.eventId, calendarId: dl.calendarId } : undefined,
        createdAt: Date.now(),
      });
    }
  }
}

export function minutesBetween(a: string, b: string) {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let d = m(b) - m(a);
  if (d <= 0) d += 1440;
  return d;
}

/** Задача из полей формы или ответа нейронки. */
export function newPending(fields: Partial<PendingTask> & { title: string; deadline: string }): PendingTask {
  return {
    id: uid(),
    title: fields.title.slice(0, 200),
    deadline: fields.deadline,
    deadlineTime: fields.deadlineTime,
    estimate: Math.max(30, Math.round(fields.estimate ?? 180)),
    chunk: Math.max(30, Math.round(fields.chunk ?? 90)),
    category: fields.category ?? "study",
    notes: fields.notes,
    source: fields.source,
    noteId: fields.noteId,
  };
}

/** Отметить блок работы сделанным (или снять отметку). Если сделано всё — задача закрывается. */
export async function markBlock(taskId: string, eventId: string, done = true) {
  const col = tasksDb();
  const t = await col.get(taskId);
  if (!t) return null;
  const blocks = t.blocks.map((b) => (b.eventId === eventId ? { ...b, done, missed: false } : b));
  const next = { ...t, blocks };
  const finished = doneMinutes(next) >= t.estimate;
  await col.update(taskId, { blocks, ...(finished ? { done: true } : {}) });
  if (finished && t.noteId) await markNoteDone(t.noteId).catch(() => {});
  return { task: next, finished };
}
