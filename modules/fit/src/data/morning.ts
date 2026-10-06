import type { Limitation } from "../lib/types.ts";
import { allowed, EX } from "./library.ts";
import type { Routine } from "./routines.ts";

/*
 * Зарядка дня — суставная гимнастика стоя, без пола и коврика, сверху вниз: шея → плечи и руки →
 * корпус → таз и ноги → разогрев → лёгкая сила → дыхание. Каждый день свой набор (seed = дата),
 * внутри блока порядок всегда тот же, чтобы зарядка текла естественно.
 */
interface Slot { name: string; ids: string[]; sec: number; reps?: number; take: Record<Length, number> }
export type Length = 5 | 10 | 15;

const SLOTS: Slot[] = [
  { name: "Шея", ids: ["neck-tilts", "neck-turns", "neck-nods", "chin-tuck"], sec: 30, take: { 5: 1, 10: 2, 15: 3 } },
  { name: "Плечи и руки", ids: ["shoulder-rolls", "arm-circles", "elbow-circles", "wrist-circles", "wrist-shake", "arm-scissors", "arm-swings"], sec: 30, take: { 5: 2, 10: 3, 15: 4 } },
  { name: "Корпус", ids: ["torso-twist", "standing-side-bend", "standing-cat", "windmill", "forward-fold", "good-morning-bw", "standing-backbend"], sec: 30, take: { 5: 2, 10: 3, 15: 4 } },
  { name: "Таз и ноги", ids: ["hip-circles", "knee-circles", "foot-circles", "side-lunge-shift", "knee-raise-hug", "leg-swings"], sec: 30, take: { 5: 1, 10: 3, 15: 4 } },
  { name: "Разогрев", ids: ["march", "jumping-jacks", "butt-kicks", "standing-knee-elbow", "oblique-crunch-standing", "shadow-boxing"], sec: 40, take: { 5: 1, 10: 2, 15: 3 } },
  { name: "Сила", ids: ["squat-reach", "air-squat", "calf-raise", "reverse-lunge"], sec: 40, reps: 12, take: { 5: 1, 10: 2, 15: 2 } },
  { name: "Финал", ids: ["reach-up", "breath-arms"], sec: 40, take: { 5: 1, 10: 1, 15: 1 } },
];

/** Детерминированный генератор по строке (одна и та же зарядка весь день). */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function dailyMorning(day: string, length: Length, limits: readonly Limitation[], shuffle = 0): Routine {
  const rand = rng(`${day}#${shuffle}`);
  const items: Routine["items"] = [];
  for (const slot of SLOTS) {
    const pool = slot.ids.filter((id) => { const e = EX.get(id); return !!e && allowed(e, limits); });
    const picked = new Set<string>();
    while (picked.size < Math.min(slot.take[length], pool.length)) picked.add(pool[Math.floor(rand() * pool.length)]);
    for (const id of pool.filter((x) => picked.has(x))) {
      const e = EX.get(id)!;
      const sec = Math.round((length === 5 ? slot.sec - 5 : length === 15 ? slot.sec + 5 : slot.sec) / (e.sides ? 2 : 1));
      items.push([id, sec, slot.reps && e.mode === "reps" ? slot.reps : undefined]);
    }
  }
  return {
    id: "morning-daily", kind: "morning", title: "Зарядка дня", icon: "🌞", color: "#fbbf24",
    text: `${length} минут стоя: от шеи до стоп — каждый день новая`, items,
  };
}

/** Упражнения, из которых собирается зарядка (для подсказки «что сегодня»). */
export const MORNING_POOL = SLOTS.flatMap((s) => s.ids);
