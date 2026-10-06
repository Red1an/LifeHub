import { dayKey, startOfWeek } from "@lifehub/sdk";
import { EX, MAJOR } from "../data/library.ts";
import type { Focus, Muscle, Pattern, Workout, WorkoutItem } from "./types.ts";

export type Hist = Workout & { id: string };

const HOUR = 3600_000;

export const doneSets = (it: WorkoutItem) => it.sets.filter((s) => s.done);
export const isMain = (it: WorkoutItem) => it.block === "main";

/** Сколько подходов пришлось на каждую мышцу (основная — 1, вспомогательная — 0.5). */
function addLoad(acc: Partial<Record<Muscle, number>>, it: WorkoutItem, k = 1) {
  const e = EX.get(it.ex);
  if (!e) return;
  const n = doneSets(it).length * k;
  if (!n) return;
  for (const m of e.muscles) acc[m] = (acc[m] ?? 0) + n;
  for (const m of e.secondary ?? []) acc[m] = (acc[m] ?? 0) + n * 0.5;
}

/**
 * Восстановление мышц 0..1 (как в Fitbod): усталость от подходов за последние 3 дня,
 * линейно спадает за 72 часа. 6 «свежих» подходов = мышца уставшая.
 */
export function recovery(hist: Hist[], now = Date.now()): Record<Muscle, number> {
  const fatigue: Partial<Record<Muscle, number>> = {};
  for (const w of hist) {
    if (w.kind !== "workout" || !w.finishedAt) continue;
    const h = (now - w.finishedAt) / HOUR;
    if (h > 72) continue;
    const k = 1 - h / 72;
    for (const it of w.items) if (isMain(it)) addLoad(fatigue, it, k);
  }
  const out = {} as Record<Muscle, number>;
  for (const m of [...MAJOR, "forearms", "obliques", "neck"] as Muscle[]) out[m] = Math.max(0, Math.min(1, 1 - (fatigue[m] ?? 0) / 6));
  return out;
}

/** Подходы на мышцу за неделю (с понедельника). */
export function weekVolume(hist: Hist[], weekStart = startOfWeek().getTime()) {
  const acc: Partial<Record<Muscle, number>> = {};
  for (const w of hist) {
    if (w.kind !== "workout" || !w.finishedAt || w.finishedAt < weekStart || w.finishedAt >= weekStart + 7 * 24 * HOUR) continue;
    for (const it of w.items) if (isMain(it)) addLoad(acc, it);
  }
  return acc;
}

const PUSH: Pattern[] = ["push_h", "push_v", "dip"];
const PULL: Pattern[] = ["pull_h", "pull_v"];

/** Баланс жимов и тяг за 4 недели: подходы. */
export function pushPull(hist: Hist[], now = Date.now()) {
  let push = 0, pull = 0;
  for (const w of hist) {
    if (w.kind !== "workout" || !w.finishedAt || now - w.finishedAt > 28 * 24 * HOUR) continue;
    for (const it of w.items) {
      if (!isMain(it)) continue;
      const p = EX.get(it.ex)?.pattern;
      const n = doneSets(it).length;
      if (p && PUSH.includes(p)) push += n;
      if (p && PULL.includes(p)) pull += n;
    }
  }
  return { push, pull };
}

export const FOCUS_MUSCLES: Record<Focus, Muscle[]> = {
  auto: MAJOR,
  full: MAJOR,
  upper: ["chest", "delts", "triceps", "biceps", "lats", "upperback"],
  lower: ["quads", "glutes", "hams", "calves", "lowerback"],
  push: ["chest", "delts", "triceps"],
  pull: ["lats", "upperback", "biceps"],
  core: ["abs", "obliques", "lowerback"],
  hiit: MAJOR,
  mobility: [],
};

export const FOCUS_INFO: Record<Focus, { title: string; icon: string; text: string }> = {
  auto: { title: "Умный выбор", icon: "✨", text: "По восстановлению мышц и плану недели" },
  full: { title: "Всё тело", icon: "🔥", text: "Ноги, жим, тяга, кор" },
  upper: { title: "Верх", icon: "💪", text: "Грудь, спина, плечи, руки" },
  lower: { title: "Низ", icon: "🦵", text: "Ноги, ягодицы, кор" },
  push: { title: "Жимы", icon: "🫸", text: "Грудь, плечи, трицепс" },
  pull: { title: "Тяги", icon: "🧗", text: "Спина, бицепс, хват" },
  core: { title: "Кор", icon: "🪵", text: "Пресс, косые, поясница" },
  hiit: { title: "Интервалы", icon: "⚡", text: "Круговая на выносливость и жиросжигание" },
  mobility: { title: "Мобильность", icon: "🧘", text: "Суставы, растяжка, восстановление" },
};

/** Какой сплит подходит под число тренировок в неделю. */
export function splitFor(perWeek: number): Focus[] {
  if (perWeek <= 3) return ["full"];
  if (perWeek === 4) return ["upper", "lower"];
  return ["push", "pull", "lower"];
}

/** Выбор фокуса «по уму»: самые восстановленные мышцы из сплита, при равенстве — давно не было. */
export function autoFocus(hist: Hist[], perWeek: number): Focus {
  const split = splitFor(perWeek);
  if (split.length === 1) return split[0];
  const rec = recovery(hist);
  const lastOf = (f: Focus) => hist.filter((w) => w.kind === "workout" && w.focus === f).reduce((m, w) => Math.max(m, w.finishedAt ?? 0), 0);
  // Округляем, чтобы почти равные варианты решались по давности.
  const score = (f: Focus) => {
    const ms = FOCUS_MUSCLES[f];
    return Math.round((ms.reduce((s, m) => s + rec[m], 0) / ms.length) * 10);
  };
  return [...split].sort((a, b) => score(b) - score(a) || lastOf(a) - lastOf(b))[0];
}

/** Последний раз, когда упражнение делали в основной части. */
export function lastPerformance(hist: Hist[], ex: string) {
  for (let i = hist.length - 1; i >= 0; i--) {
    const w = hist[i];
    if (!w.finishedAt) continue;
    const it = w.items.find((x) => x.ex === ex && isMain(x) && doneSets(x).length);
    if (it) return { item: it, at: w.finishedAt };
  }
  return null;
}

/** Лучшие результаты по упражнению: вес, повторы, время. */
export function bests(hist: Hist[], ex: string, exceptId?: string) {
  let kg = 0, reps = 0, sec = 0;
  for (const w of hist) {
    if (w.id === exceptId) continue;
    for (const it of w.items) {
      if (it.ex !== ex || !isMain(it)) continue;
      for (const s of doneSets(it)) {
        kg = Math.max(kg, s.kg ?? 0);
        reps = Math.max(reps, s.reps ?? 0);
        sec = Math.max(sec, s.sec ?? 0);
      }
    }
  }
  return { kg, reps, sec };
}

export const minutesOf = (w: Workout) => Math.round((w.seconds ?? 0) / 60);

export function activeByDay(hist: Hist[]) {
  const out: Record<string, number> = {};
  for (const w of hist) if (w.finishedAt) out[dayKey(w.finishedAt)] = (out[dayKey(w.finishedAt)] ?? 0) + Math.max(1, minutesOf(w));
  return out;
}
