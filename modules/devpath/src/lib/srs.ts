import { addDays, dayKey } from "@lifehub/sdk";
import type { Card } from "./types.ts";

/** Оценки ответа: 0 — не помню, 1 — трудно, 2 — хорошо, 3 — легко. */
export type Grade = 0 | 1 | 2 | 3;

export const newCard = (topicId: string, front: string, back: string, source: Card["source"]): Card => ({
  topicId, front, back, source, reps: 0, lapses: 0, ease: 2.5, interval: 0,
});

/** Упрощённый SM-2. Возвращает изменения карточки. */
export function schedule(c: Card, g: Grade): Partial<Card> {
  let { ease, interval, reps, lapses } = c;
  if (g === 0) {
    lapses++;
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    reps++;
    if (reps === 1) interval = g === 3 ? 3 : 1;
    else if (reps === 2) interval = g === 1 ? 3 : 6;
    else interval = Math.round(interval * (g === 1 ? 1.2 : g === 3 ? ease * 1.3 : ease));
    ease = Math.max(1.3, ease + (g === 1 ? -0.15 : g === 3 ? 0.15 : 0));
  }
  // Интервал 0 — повторить ещё раз сегодня.
  return { ease, interval, reps, lapses, due: dayKey(addDays(new Date(), interval)), lastAt: Date.now() };
}

/** Подпись интервала на кнопке оценки. */
export function previewInterval(c: Card, g: Grade) {
  const d = schedule(c, g).interval ?? 0;
  return d === 0 ? "сегодня" : d === 1 ? "1 д" : d < 30 ? `${d} д` : `${Math.round(d / 30)} мес`;
}

export const isDue = (c: Card, today = dayKey()) => !!c.due && c.due <= today;
export const isLearned = (c: Card) => c.reps > 0 && c.interval >= 21;
