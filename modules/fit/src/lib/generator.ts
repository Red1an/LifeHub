import { CHAIN, EX, EXERCISES, allowed, hasEquip } from "../data/library.ts";
import { autoFocus, FOCUS_INFO, lastPerformance, doneSets, type Hist } from "./analysis.ts";
import { recovery } from "./analysis.ts";
import type { Equip, Exercise, Focus, Limitation, Muscle, Pattern, Place, Prescription, Profile, SetLog, Workout, WorkoutItem } from "./types.ts";

export interface GenInput {
  focus: Focus;
  minutes: number;
  place: Place;
  profile: Profile;
  /** Текущая ступень в каждой лестнице: chain → id упражнения. */
  levels: Record<string, string>;
  hidden: string[];
  hist: Hist[];
  seed?: number;
}

/** Потолок сложности упражнений вне лестниц по опыту. */
const CAP = { 1: 3, 2: 5, 3: 7 } as const;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Slot { p: Pattern[]; m?: Muscle }

const s = (p: Pattern[], m?: Muscle): Slot => ({ p, m });

/** Порядок слотов = приоритет: при нехватке времени берутся первые. */
const SLOTS: Partial<Record<Focus, Slot[]>> = {
  full: [s(["squat", "lunge"]), s(["push_h", "dip", "push_v"]), s(["pull_v", "pull_h"]), s(["hinge"]), s(["core"]), s(["push_v", "dip", "push_h"]), s(["pull_h", "pull_v"]), s(["lunge", "squat"]), s(["core"], "obliques")],
  upper: [s(["push_h", "dip"]), s(["pull_v", "pull_h"]), s(["push_v", "push_h"]), s(["pull_h", "pull_v"]), s(["arms", "pull_v"], "biceps"), s(["arms", "dip", "push_h"], "triceps"), s(["arms", "pull_h"], "delts"), s(["core"])],
  lower: [s(["squat", "lunge"]), s(["hinge"]), s(["lunge", "squat"]), s(["core"]), s(["hinge"], "hams"), s(["calves"]), s(["core"], "obliques")],
  push: [s(["push_h", "dip"]), s(["push_v", "push_h"]), s(["dip", "push_h", "arms"], "triceps"), s(["arms", "push_v"], "delts"), s(["core"]), s(["push_h"]), s(["arms"], "triceps")],
  pull: [s(["pull_v", "pull_h"]), s(["pull_h", "pull_v"]), s(["arms", "pull_v"], "biceps"), s(["pull_h", "arms"], "delts"), s(["core"]), s(["pull_v", "pull_h"]), s(["core", "arms"], "forearms")],
  core: [s(["core"], "abs"), s(["core"], "obliques"), s(["hinge", "core"], "lowerback"), s(["core"], "abs"), s(["core"]), s(["core"], "obliques")],
};

const usable = (e: Exercise, equip: readonly Equip[], limits: readonly Limitation[], hidden: readonly string[]) =>
  hasEquip(e, equip) && allowed(e, limits) && !hidden.includes(e.id);

/** Рабочая ступень лестницы на этом месте: текущая или ближайшая доступная ниже. */
export function chainStep(chainId: string, inp: Pick<GenInput, "levels" | "profile" | "hidden"> & { place: { equip: readonly Equip[] } }): Exercise | undefined {
  const c = CHAIN.get(chainId);
  if (!c) return;
  const cap = CAP[inp.profile.experience];
  const cur = inp.levels[chainId];
  let idx = cur ? c.steps.indexOf(cur) : -1;
  if (idx < 0) {
    // Без истории — самая сложная ступень, подходящая по опыту.
    idx = 0;
    c.steps.forEach((id, i) => { if ((EX.get(id)?.level ?? 99) <= cap) idx = i; });
  }
  for (let i = idx; i >= 0; i--) {
    const e = EX.get(c.steps[i]);
    if (e && usable(e, inp.place.equip, inp.profile.limits, inp.hidden)) return e;
  }
  return undefined;
}

/** Кандидаты для слота с оценкой. */
function candidates(slot: Slot, inp: GenInput, taken: Set<string>, main: boolean, rnd: () => number) {
  const cap = CAP[inp.profile.experience];
  const rec = recovery(inp.hist);
  const last = [...inp.hist].reverse().find((w) => w.kind === "workout");
  const lastIds = new Set(last?.items.map((i) => i.ex));
  const takenChains = new Set([...taken].map((id) => EX.get(id)?.chain).filter(Boolean));
  const hasWeights = inp.place.equip.some((q) => q === "dumbbell" || q === "barbell" || q === "kettlebell");
  const out: { e: Exercise; score: number }[] = [];
  for (const e of EXERCISES) {
    const pi = slot.p.indexOf(e.pattern);
    if (pi < 0 || taken.has(e.id)) continue;
    if (slot.m && !e.muscles.includes(slot.m)) continue;
    if (!usable(e, inp.place.equip, inp.profile.limits, inp.hidden)) continue;
    // Подручные варианты (стол, стул) — только если нет нормального инвентаря.
    if (e.tags?.includes("improvised") && hasWeights) continue;
    if (e.tags?.includes("warmup") && e.level <= 1 && e.pattern !== "core") continue;
    if (e.chain) {
      if (takenChains.has(e.chain) || chainStep(e.chain, inp)?.id !== e.id) continue;
    } else if (e.level > cap + 1) continue;
    let score = (slot.p.length - pi) * 1.5;
    if (e.load) score += inp.profile.goal === "strength" || inp.profile.goal === "muscle" ? 3 : 2;

    if (e.chain) score += 1;
    if (!e.chain) score -= Math.max(0, cap - 2 - e.level) * 0.4;
    const r = e.muscles.reduce((acc, m) => acc + (rec[m] ?? 1), 0) / e.muscles.length;
    score += r * 2;
    if (main && lastPerformance(inp.hist, e.id)) score += 1;
    if (!main && lastIds.has(e.id)) score -= 1.5;
    score += rnd() * 1.6;
    out.push({ e, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

const isNegative = (e: Exercise) => e.id.includes("negative");
const round = (x: number, step: number) => Math.max(step, Math.round(x / step) * step);

function increment(e: Exercise) {
  const lower = ["squat", "hinge", "lunge"].includes(e.pattern);
  if (e.load === "barbell") return lower ? 5 : 2.5;
  if (e.load === "kettlebell") return 4;
  return lower ? 2 : 1;
}

function defaultSec(e: Exercise, exp: 1 | 2 | 3) {
  if (e.pattern === "cardio") return [30, 40, 45][exp - 1];
  if (e.id === "db-farmer") return 40;
  if (e.level >= 6) return [10, 15, 20][exp - 1];
  return [20, 30, 45][exp - 1];
}

/** Подходы, повторы, отдых и вес — с учётом цели и прошлого раза (двойная прогрессия). */
export function prescribe(e: Exercise, profile: Profile, hist: Hist[]): { plan: Prescription; sets: SetLog[]; note?: string } {
  const g = profile.goal;
  const exp = profile.experience;
  let sets = 3, reps: [number, number] = [8, 12], rest = 75;
  if (g === "strength") { sets = 4; reps = e.load ? [4, 6] : [5, 8]; rest = e.load ? 150 : 120; }
  if (g === "muscle") { reps = [8, 12]; rest = 90; }
  if (g === "endurance") { reps = [12, 20]; rest = 45; }
  if (g === "fatloss") { reps = [10, 15]; rest = 45; }
  if (e.pattern === "arms" || e.pattern === "calves") { reps = [10, 15]; rest = 60; sets = 3; }
  if (e.pattern === "core") { reps = [10, 15]; rest = 45; }
  if (!e.load && (isNegative(e) || e.level >= 8)) reps = [3, 5];
  else if (!e.load && e.level >= 6 && e.pattern !== "core") reps = [Math.min(reps[0], 5), Math.min(reps[1], 10)];
  if (exp === 1) sets = Math.max(2, sets - 1);

  const plan: Prescription = { sets, rest };
  let note: string | undefined;
  const last = lastPerformance(hist, e.id);
  const done = last ? doneSets(last.item) : [];
  const hard = last?.item.feel === 3;

  if (e.mode === "time") {
    const best = Math.max(0, ...done.map((x) => x.sec ?? 0));
    plan.sec = best ? best + (done.length >= (last?.item.plan.sets ?? 0) && !hard ? 5 : 0) : defaultSec(e, exp);
    note = best ? `Прошлый раз ${best} с${plan.sec > best ? " — держим на 5 с дольше" : ""}` : undefined;
  } else {
    plan.reps = reps;
    if (e.load) {
      const kg = Math.max(0, ...done.map((x) => x.kg ?? 0));
      const allTop = done.length >= (last?.item.plan.sets ?? sets) && done.every((x) => (x.reps ?? 0) >= (last?.item.plan.reps?.[1] ?? reps[1]));
      const failed = done.some((x) => (x.reps ?? 0) < (last?.item.plan.reps?.[0] ?? reps[0]));
      if (!kg) note = "Подбери вес: последние 2 повтора — тяжело, но технично";
      else if (allTop && !hard) { plan.kg = kg + increment(e); note = `+${increment(e)} кг: в прошлый раз все подходы на максимум`; }
      else if (failed && hard) { plan.kg = round(kg * 0.9, increment(e) / 2); note = "Чуть легче: отточим технику и вернёмся"; }
      else { plan.kg = kg; note = `${kg} кг — добей ${plan.reps[1]} повторов во всех подходах, и вес вырастет`; }
    } else if (done.length) {
      note = `Прошлый раз ${done.map((x) => x.reps ?? 0).join("·")} — попробуй +1`;
    }
  }

  const setLogs: SetLog[] = Array.from({ length: plan.sets }, (_, i) => {
    const prev = done[i] ?? done[done.length - 1];
    return {
      done: false,
      reps: e.mode === "reps" ? Math.min(plan.reps![1], Math.max(plan.reps![0], (prev?.reps ?? plan.reps![0]) + (prev ? 1 : 0))) : undefined,
      sec: e.mode === "time" ? plan.sec : undefined,
      kg: plan.kg,
    };
  });
  return { plan, sets: setLogs, note };
}

/** Примерное время упражнения, сек. */
export function itemSeconds(it: WorkoutItem) {
  const e = EX.get(it.ex);
  const sides = e?.sides ? 2 : 1;
  const work = it.plan.sec ? it.plan.sec * sides : ((it.plan.reps?.[0] ?? 10) + (it.plan.reps?.[1] ?? 10)) / 2 * 3 * sides + 10;
  return it.plan.sets * work + Math.max(0, it.plan.sets - (it.block === "main" ? 0 : 1)) * it.plan.rest;
}

export const workoutSeconds = (w: Workout) =>
  w.circuit ? w.items.filter((i) => i.block !== "main").reduce((a, i) => a + itemSeconds(i), 0) + w.circuit.rounds * (w.items.filter((i) => i.block === "main").length * (w.circuit.work + w.circuit.rest) + 60)
    : w.items.reduce((a, i) => a + itemSeconds(i), 0);

const timed = (ex: string, sec: number, block: WorkoutItem["block"], reps?: number): WorkoutItem => ({
  ex, block, plan: { sets: 1, sec, reps: reps ? [reps, reps] : undefined, rest: 0 }, sets: [{ done: false, sec }],
});

const WARM: Partial<Record<Pattern, string[]>> = {
  push_h: ["arm-circles", "wrist-circles", "scap-pushup"],
  push_v: ["arm-circles", "towel-dislocate", "wrist-circles"],
  dip: ["arm-circles", "scap-pushup"],
  pull_v: ["shoulder-rolls", "scap-pull", "band-pull-apart"],
  pull_h: ["shoulder-rolls", "band-pull-apart", "thoracic-rotation"],
  squat: ["hip-circles", "leg-swings", "deep-squat-hold", "ankle-circles"],
  lunge: ["hip-circles", "leg-swings", "ankle-circles"],
  hinge: ["cat-cow", "inchworm", "glute-bridge"],
  core: ["cat-cow", "dead-bug", "bird-dog"],
  cardio: ["ankle-circles", "hip-circles", "arm-circles"],
};

/** Разминка: общий разогрев + суставы под сегодняшние движения. */
export function buildWarmup(patterns: Pattern[], inp: Pick<GenInput, "place" | "profile" | "minutes">): WorkoutItem[] {
  const ok = (id: string) => { const e = EX.get(id); return !!e && hasEquip(e, inp.place.equip) && allowed(e, inp.profile.limits); };
  const ids: string[] = [inp.profile.experience > 1 && !inp.profile.limits.includes("knees") ? "jumping-jacks" : "march"];
  const pool = [...new Set([...patterns.flatMap((p) => WARM[p] ?? []), "worlds-greatest", "thoracic-rotation"])];
  const max = inp.minutes <= 20 ? 4 : 6;
  // По одному на каждый паттерн по кругу, чтобы разминка покрыла всё.
  const lists = patterns.map((p) => (WARM[p] ?? []).filter(ok));
  for (let round = 0; ids.length < max && round < 4; round++) {
    for (const l of lists) if (l[round] && !ids.includes(l[round]) && ids.length < max) ids.push(l[round]);
  }
  for (const id of pool) if (ids.length < max && ok(id) && !ids.includes(id)) ids.push(id);
  return ids.map((id, i) => {
    const e = EX.get(id)!;
    return timed(id, i === 0 ? 60 : e.mode === "reps" ? 40 : 30, "warmup", e.mode === "reps" ? 8 : undefined);
  });
}

/** Заминка: растяжка мышц, которые сегодня работали. */
export function buildCooldown(muscles: Muscle[], inp: Pick<GenInput, "place" | "profile" | "minutes">): WorkoutItem[] {
  const n = inp.minutes <= 20 ? 3 : 4;
  const pool = EXERCISES.filter((e) => e.pattern === "stretch" && e.tags?.includes("cooldown") && hasEquip(e, inp.place.equip) && allowed(e, inp.profile.limits));
  const scored = pool
    .map((e) => ({ e, s: [...e.muscles, ...(e.secondary ?? [])].filter((m) => muscles.includes(m)).length + Math.random() * 0.5 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n);
  return scored.map(({ e }) => timed(e.id, 30, "cooldown"));
}

function hiit(inp: GenInput, rnd: () => number, budget: number): Pick<Workout, "items" | "circuit"> {
  const cap = CAP[inp.profile.experience];
  const pick = (ps: Pattern[], taken: string[]) => {
    // В круге без упражнений «на каждую сторону»: интервал один на всё.
    const list = EXERCISES.filter((e) => ps.includes(e.pattern) && !e.load && !e.sides && !taken.includes(e.id) && e.level <= cap + 1 && e.level >= 1 &&
      usable(e, inp.place.equip, inp.profile.limits, inp.hidden) && e.pattern !== "mobility");
    return list.length ? list[Math.floor(rnd() * list.length)].id : undefined;
  };
  const plan: Pattern[][] = [["cardio"], ["squat", "lunge"], ["push_h"], ["cardio"], ["core"], ["lunge", "hinge"], ["cardio"], ["pull_h", "pull_v", "core"]];
  const [work, rest] = ([[30, 30], [40, 20], [45, 15]] as const)[inp.profile.experience - 1];
  const ids: string[] = [];
  for (const ps of plan.slice(0, budget > 25 * 60 ? 8 : 6)) {
    const id = pick(ps, ids);
    if (id) ids.push(id);
  }
  const rounds = Math.max(2, Math.min(6, Math.round(budget / (ids.length * (work + rest) + 60))));
  return {
    circuit: { rounds, work, rest },
    items: ids.map((ex) => ({ ex, block: "main", plan: { sets: rounds, sec: work, rest }, sets: Array.from({ length: rounds }, () => ({ done: false, sec: work })) })),
  };
}

function mobilityFlow(inp: GenInput, rnd: () => number): WorkoutItem[] {
  const pool = EXERCISES.filter((e) => (e.pattern === "mobility" || e.pattern === "stretch") && e.id !== "eyes-20" && usable(e, inp.place.equip, inp.profile.limits, inp.hidden));
  const mob = pool.filter((e) => e.pattern === "mobility").sort(() => rnd() - 0.5);
  const st = pool.filter((e) => e.pattern === "stretch").sort(() => rnd() - 0.5);
  const items: WorkoutItem[] = [];
  let t = 0;
  const target = inp.minutes * 60;
  for (let i = 0; t < target && (mob[i] || st[i]); i++) {
    for (const e of [mob[i], st[i]]) {
      if (!e || t >= target) continue;
      const sec = e.pattern === "stretch" ? 45 : 40;
      items.push(timed(e.id, sec, "main", e.mode === "reps" ? 8 : undefined));
      t += sec * (e.sides ? 2 : 1) + 5;
    }
  }
  // Сначала подвижность, растяжка — в конце, дыхание — последним.
  return [...items.filter((i) => EX.get(i.ex)?.pattern === "mobility"), ...items.filter((i) => EX.get(i.ex)?.pattern === "stretch")];
}

/** Собрать тренировку под место, время, цель и историю. */
export function generate(inp: GenInput): Workout {
  const rnd = rng(inp.seed ?? Date.now());
  const focus = inp.focus === "auto" ? autoFocus(inp.hist, inp.profile.perWeek) : inp.focus;
  const title = `${FOCUS_INFO[focus].title} · ${inp.place.name}`;
  const base = { kind: "workout" as const, title, focus, place: inp.place.id, startedAt: 0 };

  if (focus === "mobility") return { ...base, items: mobilityFlow(inp, rnd) };

  const warmBudget = inp.minutes <= 15 ? 150 : inp.minutes <= 30 ? 240 : 330;
  const coolBudget = inp.minutes <= 15 ? 90 : 150;
  const budget = inp.minutes * 60 - warmBudget - coolBudget;

  let main: WorkoutItem[] = [];
  let circuit: Workout["circuit"];
  if (focus === "hiit") {
    ({ items: main, circuit } = hiit(inp, rnd, budget));
  } else {
    const slots = SLOTS[focus] ?? SLOTS.full!;
    const taken = new Set<string>();
    let t = 0;
    for (let i = 0; i < slots.length; i++) {
      const best = candidates(slots[i], inp, taken, i < 3, rnd)[0];
      if (!best) continue;
      const { plan, sets, note } = prescribe(best.e, inp.profile, inp.hist);
      const it: WorkoutItem = { ex: best.e.id, block: "main", plan, sets, note };
      const sec = itemSeconds(it);
      if (main.length >= 3 && t + sec > budget) {
        // Не влезает — пробуем урезать подходы, иначе пропускаем.
        if (plan.sets > 2 && t + sec * (2 / plan.sets) <= budget) {
          it.plan = { ...plan, sets: 2 };
          it.sets = sets.slice(0, 2);
        } else continue;
      }
      main.push(it);
      taken.add(best.e.id);
      t += itemSeconds(it);
    }
    // Тяжёлое — в начало, кор и изоляция — в конец.
    const order = (it: WorkoutItem) => { const p = EX.get(it.ex)!.pattern; return p === "core" ? 3 : p === "arms" || p === "calves" ? 2 : 1; };
    main = main.map((it, i) => ({ it, i })).sort((a, b) => order(a.it) - order(b.it) || a.i - b.i).map((x) => x.it);
  }

  const patterns = [...new Set(main.map((i) => EX.get(i.ex)!.pattern))];
  const muscles = [...new Set(main.flatMap((i) => EX.get(i.ex)!.muscles))];
  const first = main[0] && EX.get(main[0].ex);
  if (first?.load && main[0].note) main[0].note += ". Перед рабочими — 1–2 разминочных подхода с лёгким весом";
  return {
    ...base,
    circuit,
    items: [...buildWarmup(patterns, inp), ...main, ...buildCooldown(muscles, inp)],
  };
}

/** Замены для упражнения: тот же паттерн или те же мышцы, что доступны здесь. */
export function alternatives(ex: string, inp: Omit<GenInput, "focus" | "minutes" | "seed">, exclude: string[] = []): Exercise[] {
  const e = EX.get(ex);
  if (!e) return [];
  return EXERCISES
    .filter((x) => x.id !== ex && !exclude.includes(x.id) && usable(x, inp.place.equip, inp.profile.limits, inp.hidden))
    .filter((x) => (e.pattern === "stretch" || e.pattern === "mobility" ? x.pattern === e.pattern : x.pattern === e.pattern || x.muscles[0] === e.muscles[0]))
    .filter((x) => x.pattern !== "mobility" || e.pattern === "mobility")
    .sort((a, b) => Number(b.pattern === e.pattern) - Number(a.pattern === e.pattern) || Math.abs(a.level - e.level) - Math.abs(b.level - e.level))
    .slice(0, 12);
}

/** Пункт тренировки для выбранного упражнения. */
export function makeItem(ex: string, block: WorkoutItem["block"], profile: Profile, hist: Hist[]): WorkoutItem {
  const e = EX.get(ex)!;
  if (block !== "main") return timed(ex, e.pattern === "stretch" ? 30 : e.mode === "reps" ? 40 : 30, block, e.mode === "reps" ? 8 : undefined);
  const { plan, sets, note } = prescribe(e, profile, hist);
  return { ex, block, plan, sets, note };
}
