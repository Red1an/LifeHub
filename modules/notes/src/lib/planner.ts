import { useEffect, useMemo } from "react";
import { db, useCollection } from "@lifehub/sdk";
import type { Note } from "./types.ts";

/*
 * Связь с «Расписанием». Дела живут здесь, «когда» — там. Писать в чужие данные нельзя,
 * поэтому «Расписание» ведёт свою коллекцию links (id = id заметки, нужно read:planner):
 * что поставлено в календарь и отмечено ли «сделал». Отметку мы переносим к себе сами.
 * Формат чужих данных может меняться — читаем поле за полем.
 */

export interface PlanLink {
  id: string;
  /** Ближайшее событие или блок, YYYY-MM-DD и HH:MM. */
  date?: string;
  start?: string;
  done: boolean;
  doneAt: number;
}

const PLANNER = "~/m/planner";

/** Запрос в «Запланировать»: события, созданные по нему, привяжутся к заметке. */
export const askUrl = (noteId: string, text: string) => `${PLANNER}/ask?note=${encodeURIComponent(noteId)}&text=${encodeURIComponent(text)}`;
/** «Найти время» для дела — окна в «Расписании». */
export const findTimeUrl = (noteId: string) => `${PLANNER}/tasks?note=${encodeURIComponent(noteId)}`;

/** Связи из «Расписания» по id заметки. Нет модуля или он старый — пустая карта. */
export function usePlanLinks(): Map<string, PlanLink> {
  const links = useCollection<Record<string, unknown>>("links", { from: "planner" });
  return useMemo(() => {
    const m = new Map<string, PlanLink>();
    for (const l of links.items) {
      m.set(l.id, {
        id: l.id,
        date: typeof l.date === "string" ? l.date : undefined,
        start: typeof l.start === "string" ? l.start : undefined,
        done: l.done === true,
        doneAt: typeof l.doneAt === "number" ? l.doneAt : 0,
      });
    }
    return m;
  }, [links.items]);
}

/**
 * «Сделал» в Расписании → дело закрывается здесь. Каждую отметку переносим один раз
 * (planDoneSeen), чтобы снятая вручную галочка не возвращалась.
 */
export function useSyncPlanDone(notes: (Note & { id: string })[]) {
  const links = usePlanLinks();
  useEffect(() => {
    for (const n of notes) {
      const l = links.get(n.id);
      if (!l?.done || l.doneAt <= (n.planDoneSeen ?? 0)) continue;
      const patch: Partial<Note> = { planDoneSeen: l.doneAt };
      if (!n.done) Object.assign(patch, { done: true, doneAt: l.doneAt, snoozeUntil: null as unknown as undefined });
      db.collection<Note>("notes").update(n.id, patch).catch(() => {});
    }
  }, [links, notes]);
}

/** Когда дело стоит в календаре (если впереди и не сделано) — для eventWhen. */
export function planned(l: PlanLink | undefined, today: string): { date: string; start?: string } | null {
  if (!l || l.done || !l.date || l.date < today) return null;
  return { date: l.date, start: l.start };
}
