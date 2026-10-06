import { db } from "@lifehub/sdk";
import { EX } from "../data/library.ts";
import type { Hist } from "./analysis.ts";
import { findPrs, levelUps, xpFor } from "./game.ts";
import { workoutSeconds } from "./generator.ts";
import type { Workout } from "./types.ts";

export type Step =
  | { t: "work"; i: number; s: number; auto: boolean; round?: number }
  | { t: "rest"; sec: number; i: number; s: number; round?: boolean };

/** Упражнение проходит само по таймеру (разминка, зарядка, круговая). */
export function isAuto(w: Workout, i: number) {
  const it = w.items[i];
  const p = EX.get(it.ex)?.pattern;
  return w.kind !== "workout" || it.block !== "main" || !!w.circuit || p === "mobility" || p === "stretch";
}

/** Разворачивает тренировку в последовательность шагов плеера. */
export function buildSteps(w: Workout): Step[] {
  const steps: Step[] = [];
  const idx = w.items.map((_, i) => i);
  const warm = idx.filter((i) => w.items[i].block === "warmup");
  const main = idx.filter((i) => w.items[i].block === "main");
  const cool = idx.filter((i) => w.items[i].block === "cooldown");
  for (const i of warm) steps.push({ t: "work", i, s: 0, auto: true });
  if (w.circuit) {
    const { rounds, rest } = w.circuit;
    for (let r = 0; r < rounds; r++) {
      main.forEach((i, k) => {
        steps.push({ t: "work", i, s: r, auto: true, round: r });
        const lastInRound = k === main.length - 1;
        if (!lastInRound) { if (rest > 0) steps.push({ t: "rest", sec: rest, i, s: r }); }
        else if (r < rounds - 1) steps.push({ t: "rest", sec: 60, i, s: r, round: true });
      });
    }
  } else {
    main.forEach((i, k) => {
      const it = w.items[i];
      const auto = isAuto(w, i);
      for (let s = 0; s < it.sets.length; s++) {
        steps.push({ t: "work", i, s, auto });
        const last = k === main.length - 1 && s === it.sets.length - 1;
        if (!auto && !last) steps.push({ t: "rest", sec: it.plan.rest, i, s });
      }
    });
  }
  for (const i of cool) steps.push({ t: "work", i, s: 0, auto: true });
  return steps;
}

export const workoutsDb = db.collection<Workout>("workouts");

/** Сохранить законченную тренировку: рекорды, опыт, новые ступени лестниц. */
export async function saveFinished(w: Workout, hist: Hist[]) {
  const finishedAt = Date.now();
  // Если телефон забыли с открытой тренировкой, время не больше двойного плана.
  const seconds = Math.max(30, Math.min(Math.round((finishedAt - w.startedAt) / 1000), workoutSeconds(w) * 2 + 600));
  const done: Workout = { ...w, finishedAt, seconds };
  const prs = done.kind === "workout" ? findPrs(done, hist) : [];
  done.prs = prs;
  done.xp = xpFor(done, prs.length);
  done.ups = done.kind === "workout" ? levelUps(done) : [];
  const saved = await workoutsDb.add(done);
  return saved;
}
