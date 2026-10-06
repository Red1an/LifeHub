import { addDays, dayKey, startOfWeek } from "@lifehub/sdk";
import { CHAIN, EX } from "../data/library.ts";
import { bests, doneSets, isMain, minutesOf, type Hist } from "./analysis.ts";
import type { Workout } from "./types.ts";

export const RANKS = [
  { xp: 0, title: "Новичок", icon: "🌱" },
  { xp: 150, title: "В движении", icon: "🚶" },
  { xp: 500, title: "Любитель", icon: "🏃" },
  { xp: 1200, title: "Спортсмен", icon: "💪" },
  { xp: 2500, title: "Атлет", icon: "🏅" },
  { xp: 4500, title: "Машина", icon: "⚙️" },
  { xp: 7500, title: "Зверь", icon: "🐺" },
  { xp: 12000, title: "Титан", icon: "🗿" },
  { xp: 20000, title: "Легенда", icon: "👑" },
];

export function rankFor(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && RANKS[i + 1].xp <= xp) i++;
  const rank = RANKS[i];
  const next = RANKS[i + 1];
  return { rank, next, level: i + 1, progress: next ? (xp - rank.xp) / (next.xp - rank.xp) : 1 };
}

/** Опыт за занятие. */
export function xpFor(w: Workout, prs: number) {
  const min = minutesOf(w);
  if (w.kind === "break") return 10;
  if (w.kind !== "workout") return 10 + min * 2;
  const sets = w.items.filter(isMain).reduce((n, it) => n + doneSets(it).length, 0);
  return 20 + min * 2 + sets * 2 + prs * 15;
}

/** Новые рекорды в только что законченной тренировке. */
export function findPrs(w: Workout, hist: Hist[], selfId?: string): string[] {
  const out: string[] = [];
  for (const it of w.items) {
    if (!isMain(it)) continue;
    const e = EX.get(it.ex);
    if (!e) continue;
    const prev = bests(hist, it.ex, selfId);
    const done = doneSets(it);
    const had = hist.some((h) => h.id !== selfId && h.items.some((x) => x.ex === it.ex && isMain(x) && doneSets(x).length));
    if (!done.length || !had) continue;
    const kg = Math.max(0, ...done.map((s) => s.kg ?? 0));
    const reps = Math.max(0, ...done.map((s) => s.reps ?? 0));
    const sec = Math.max(0, ...done.map((s) => s.sec ?? 0));
    if (e.load && kg > prev.kg) out.push(`${e.name}: ${kg} кг`);
    else if (!e.load && e.mode === "reps" && reps > prev.reps) out.push(`${e.name}: ${reps} повт.`);
    else if (e.mode === "time" && !w.circuit && sec > prev.sec) out.push(`${e.name}: ${sec} с`);
  }
  return out;
}

/** Удержание, после которого ступень считается освоенной. */
export const masterySec = (level: number) => (level >= 6 ? 30 : 60);

/** Лестницы, в которых пора подняться: все подходы на верхней границе и не «тяжело». */
export function levelUps(w: Workout): { chain: string; from: string; to: string }[] {
  const out: { chain: string; from: string; to: string }[] = [];
  for (const it of w.items) {
    const e = EX.get(it.ex);
    if (!isMain(it) || !e?.chain || it.feel === 3 || w.circuit) continue;
    const done = doneSets(it);
    if (done.length < it.plan.sets) continue;
    const ok = e.mode === "time" ? done.every((s) => (s.sec ?? 0) >= masterySec(e.level)) : done.every((s) => (s.reps ?? 0) >= (it.plan.reps?.[1] ?? 99));
    if (!ok) continue;
    const c = CHAIN.get(e.chain)!;
    const next = c.steps[c.steps.indexOf(e.id) + 1];
    if (next) out.push({ chain: c.id, from: e.id, to: next });
  }
  return out;
}

/** Недельная серия: подряд недель с выполненной целью (текущая засчитывается, если цель уже выполнена). */
export function weekStreak(hist: Hist[], perWeek: number) {
  const byWeek = new Map<string, number>();
  for (const w of hist) if (w.kind === "workout" && w.finishedAt) {
    const k = dayKey(startOfWeek(w.finishedAt));
    byWeek.set(k, (byWeek.get(k) ?? 0) + 1);
  }
  let d = startOfWeek();
  const thisWeek = byWeek.get(dayKey(d)) ?? 0;
  let n = thisWeek >= perWeek ? 1 : 0;
  d = addDays(d, -7);
  while ((byWeek.get(dayKey(d)) ?? 0) >= perWeek) { n++; d = addDays(d, -7); }
  return { streak: n, thisWeek };
}

/** Дней подряд с любым движением (тренировка, зарядка, разминка). Сегодня можно ещё успеть. */
export function dayStreak(hist: Hist[]) {
  const days = new Set(hist.filter((w) => w.finishedAt).map((w) => dayKey(w.finishedAt!)));
  let d = new Date();
  if (!days.has(dayKey(d))) d = addDays(d, -1);
  let n = 0;
  while (days.has(dayKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

export interface Achievement { id: string; icon: string; title: string; text: string; done: boolean; progress?: number }

export function achievements(hist: Hist[], wStreak: number, dStreak: number, levels: Record<string, string>): Achievement[] {
  const done = hist.filter((w) => w.finishedAt);
  const workouts = done.filter((w) => w.kind === "workout");
  const breaks = done.filter((w) => w.kind === "break").length;
  const mornings = done.filter((w) => w.kind === "morning").length;
  const minutes = done.reduce((n, w) => n + minutesOf(w), 0);
  const prs = done.reduce((n, w) => n + (w.prs?.length ?? 0), 0);
  const maxReps = (ids: string[]) => Math.max(0, ...done.flatMap((w) => w.items.filter((i) => ids.includes(i.ex) && isMain(i)).flatMap((i) => doneSets(i).map((s) => s.reps ?? 0))));
  const pullups = maxReps(["pullup", "chinup", "wide-pullup"]);
  const pushups = maxReps(["pushup"]);
  const early = workouts.some((w) => new Date(w.startedAt).getHours() < 8);
  const late = workouts.some((w) => new Date(w.startedAt).getHours() >= 22);
  const places = new Set(workouts.map((w) => w.place)).size;
  const skill = (chain: string, id: string) => { const c = CHAIN.get(chain); return !!c && c.steps.indexOf(levels[chain] ?? "") >= c.steps.indexOf(id); };
  const a = (id: string, icon: string, title: string, text: string, cur: number, goal: number): Achievement =>
    ({ id, icon, title, text, done: cur >= goal, progress: Math.min(1, cur / goal) });
  return [
    a("first", "🎬", "Первый шаг", "Первая тренировка", workouts.length, 1),
    a("w10", "🔟", "Втянулся", "10 тренировок", workouts.length, 10),
    a("w50", "🏛️", "Полсотни", "50 тренировок", workouts.length, 50),
    a("w100", "💯", "Сотка", "100 тренировок", workouts.length, 100),
    a("streak4", "📅", "Месяц без пропусков", "4 недели подряд с выполненной целью", wStreak, 4),
    a("streak12", "🗓️", "Привычка", "12 недель подряд", wStreak, 12),
    a("days7", "🔥", "Неделя в движении", "7 дней подряд хоть что-то", dStreak, 7),
    a("days30", "☄️", "30 дней огня", "30 дней подряд в движении", dStreak, 30),
    a("breaks20", "🪑", "Офисный ниндзя", "20 разминок у стола", breaks, 20),
    a("breaks100", "🥷", "Анти-сидение", "100 разминок у стола", breaks, 100),
    a("morning10", "🌅", "Жаворонок", "10 зарядок", mornings, 10),
    a("min600", "⏱️", "10 часов", "600 минут активности", minutes, 600),
    a("min3000", "⌛", "50 часов", "3000 минут активности", minutes, 3000),
    a("pr10", "📈", "Рекордсмен", "10 личных рекордов", prs, 10),
    a("pullup1", "🧗", "Первое подтягивание", "Подтянись хотя бы раз", pullups, 1),
    a("pullup10", "🦍", "Десятка", "10 подтягиваний за подход", pullups, 10),
    a("pushup30", "💪", "Тридцатка", "30 отжиманий за подход", pushups, 30),
    a("pistol", "🎯", "Пистолет", "Дойти до пистолетика в лестнице ног", skill("squat", "pistol") ? 1 : 0, 1),
    a("handstand", "🤸", "Вверх ногами", "Дойти до стойки у стены", skill("pike", "wall-handstand") ? 1 : 0, 1),
    a("early", "🐦", "Ранняя пташка", "Тренировка до 8 утра", early ? 1 : 0, 1),
    a("late", "🦉", "Сова", "Тренировка после 22:00", late ? 1 : 0, 1),
    a("places", "🗺️", "Везде как дома", "Тренировки в 3 разных местах", places, 3),
  ];
}
