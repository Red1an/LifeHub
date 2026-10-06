import { EX } from "../data/library.ts";
import type { Hist } from "./analysis.ts";
import { makeItem } from "./generator.ts";
import type { Profile, Workout, WorkoutKind } from "./types.ts";

/** Свой комплекс, собранный из каталога (коллекция `mine`). */
export interface MyItem {
  ex: string;
  /** Секунд (комплекс по таймеру или упражнение на время). */
  sec?: number;
  /** Повторов (тренировка) или подсказка «≈ N раз» (по таймеру). */
  reps?: number;
  /** Подходов (тренировка). */
  sets?: number;
}

export interface MyRoutine {
  title: string;
  icon: string;
  kind: WorkoutKind;
  /** По таймеру: кругов. */
  rounds: number;
  /** По таймеру — отдых между упражнениями, в тренировке — между подходами, сек. */
  rest: number;
  items: MyItem[];
}

export const KINDS: { kind: WorkoutKind; name: string; icon: string; text: string }[] = [
  { kind: "morning", name: "Зарядка", icon: "🌅", text: "идёт сама по таймеру" },
  { kind: "break", name: "Разминка", icon: "🧘", text: "по таймеру, засчитывается как разминка" },
  { kind: "stretch", name: "Растяжка", icon: "🌙", text: "по таймеру, удержания" },
  { kind: "workout", name: "Тренировка", icon: "💪", text: "подходы и повторы, записываю результат" },
];

export const timed = (r: Pick<MyRoutine, "kind">) => r.kind !== "workout";

/** Значения по умолчанию для упражнения, добавленного в комплекс. */
export function defaultItem(ex: string, r: Pick<MyRoutine, "kind">): MyItem {
  const e = EX.get(ex);
  const time = e?.mode === "time";
  if (timed(r)) return { ex, sec: e?.pattern === "stretch" ? 40 : 30 };
  return { ex, sets: 3, ...(time ? { sec: 30 } : { reps: 10 }) };
}

/** Длительность комплекса в секундах (примерно). */
export function myRoutineSeconds(r: MyRoutine) {
  const per = (it: MyItem) => {
    const e = EX.get(it.ex);
    const side = e?.sides ? 2 : 1;
    if (timed(r)) return (it.sec ?? 30) * side + 5;
    const work = it.sec ? it.sec * side : (it.reps ?? 10) * 3 * side;
    return (it.sets ?? 3) * (work + r.rest);
  };
  const one = r.items.reduce((n, it) => n + per(it), 0);
  return timed(r) ? one * r.rounds + r.rest * (r.items.length - 1) * r.rounds + 60 * (r.rounds - 1) : one;
}

/** Свой комплекс → тренировка для плеера. */
export function myWorkout(r: MyRoutine, profile: Profile, hist: Hist[]): Workout {
  const items = r.items.filter((it) => EX.has(it.ex));
  if (timed(r)) {
    const rounds = Math.max(1, r.rounds);
    const circuit = rounds > 1 || r.rest > 0;
    return {
      kind: r.kind,
      title: r.title,
      startedAt: Date.now(),
      ...(circuit ? { circuit: { rounds, work: Math.round(items.reduce((n, it) => n + (it.sec ?? 30), 0) / Math.max(1, items.length)), rest: r.rest } } : {}),
      items: items.map((it) => ({
        ex: it.ex, block: "main",
        plan: { sets: rounds, sec: it.sec ?? 30, reps: it.reps ? [it.reps, it.reps] : undefined, rest: 0 },
        sets: Array.from({ length: rounds }, () => ({ done: false, sec: it.sec ?? 30 })),
      })),
    };
  }
  return {
    kind: "workout",
    title: r.title,
    startedAt: Date.now(),
    items: items.map((it) => {
      const base = makeItem(it.ex, "main", profile, hist);
      const sets = it.sets ?? base.plan.sets;
      const plan = { ...base.plan, sets, rest: r.rest, ...(it.sec ? { sec: it.sec, reps: undefined } : it.reps ? { reps: [it.reps, it.reps] as [number, number] } : {}) };
      return { ...base, plan, sets: Array.from({ length: sets }, () => ({ ...base.sets[0], done: false, sec: plan.sec, reps: undefined })) };
    }),
  };
}
