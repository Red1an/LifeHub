import { db, dayKey } from "@lifehub/sdk";
import type { Category, Draft, NoteLink } from "./types.ts";

/*
 * Связь с «Заметками». Дела живут там, а здесь — только «когда». Писать в чужие данные
 * модуль не может, поэтому связь — своя коллекция links (id = id заметки), открытая
 * «Заметкам» на чтение: что стоит в календаре и отмечено ли «сделал». «Заметки» читают
 * её и закрывают дело у себя. Заметки читаем поле за полем — формат может меняться.
 */

export const linksDb = () => db.collection<NoteLink>("links");

/** Дело из «Заметок». */
export interface NoteTodo {
  id: string;
  title: string;
  body: string;
  due?: string;
  /** Объём в часах. */
  effort?: number;
  area?: string;
  /** До какой отметки «сделал» из links «Заметки» уже дошли (их planDoneSeen). */
  seen: number;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Открытые дела: тип «Дело» (или старая полка «todo»), разобраны, не закрыты и не отложены. */
export function todosFrom(items: Record<string, unknown>[], today = dayKey()): NoteTodo[] {
  const out: NoteTodo[] = [];
  for (const n of items) {
    const kind = str(n.kind) || (str(n.shelf) === "todo" ? "task" : "");
    if (kind !== "task" || n.done || n.status === "inbox" || n.status === "archived") continue;
    if (str(n.snoozeUntil) > today) continue;
    const body = str(n.body);
    const title = str(n.title) || body.split("\n")[0].slice(0, 120);
    if (!title) continue;
    out.push({
      id: str(n.id),
      title,
      body,
      due: /^\d{4}-\d{2}-\d{2}$/.test(str(n.due)) ? str(n.due) : undefined,
      effort: typeof n.effort === "number" && n.effort > 0 ? n.effort : undefined,
      area: str(n.area) || undefined,
      seen: typeof n.planDoneSeen === "number" ? n.planDoneSeen : 0,
    });
  }
  return out.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}

/** Сфера заметки → категория календаря. */
export function categoryOf(area?: string): Category {
  const map: Record<string, Category> = { study: "study", work: "work", health: "health", people: "social", fun: "rest", growth: "study" };
  return (area && map[area]) || "personal";
}

/** Созданные события из заметки → запись в links (дописывает к уже поставленным). */
export async function linkNote(noteId: string, title: string, applied: { draft: Draft; eventId: string; calendarId: string }[]) {
  const created = applied.filter((a) => a.draft.op === "create");
  if (!created.length) return;
  const col = linksDb();
  const prev = await col.get(noteId);
  const first = [...created].sort((a, b) => (a.draft.date + (a.draft.start ?? "")).localeCompare(b.draft.date + (b.draft.start ?? "")))[0].draft;
  const keepPrev = prev && !prev.done && prev.date >= dayKey() && prev.date + (prev.start ?? "") < first.date + (first.start ?? "");
  await col.put(noteId, {
    title,
    date: keepPrev ? prev.date : first.date,
    start: keepPrev ? prev.start : first.start,
    events: [...(prev?.done ? [] : (prev?.events ?? [])), ...created.map((a) => ({ eventId: a.eventId, calendarId: a.calendarId }))],
    taskId: created.find((a) => a.draft.taskId)?.draft.taskId ?? prev?.taskId,
    done: false,
    updatedAt: Date.now(),
  });
}

/** «Сделал» в Расписании → «Заметки» закроют дело, когда откроются. */
export async function markNoteDone(noteId: string, title = "") {
  const col = linksDb();
  const prev = await col.get(noteId);
  if (prev) await col.update(noteId, { done: true, doneAt: Date.now(), updatedAt: Date.now() });
  else await col.put(noteId, { title, date: dayKey(), events: [], done: true, doneAt: Date.now(), updatedAt: Date.now() });
}
