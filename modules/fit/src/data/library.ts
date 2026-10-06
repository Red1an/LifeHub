import type { Equip, Exercise, Limitation, Muscle, Pattern, Place } from "../lib/types.ts";
import { STRENGTH } from "./strength.ts";
import { MOBILITY } from "./mobility.ts";

export const EXERCISES: Exercise[] = [...STRENGTH, ...MOBILITY];
export const EX = new Map(EXERCISES.map((e) => [e.id, e]));
export const exById = (id: string) => EX.get(id);

export const MUSCLES: Record<Muscle, string> = {
  chest: "Грудь", delts: "Плечи", triceps: "Трицепс", biceps: "Бицепс", forearms: "Предплечья",
  lats: "Широчайшие", upperback: "Верх спины", lowerback: "Поясница", abs: "Пресс", obliques: "Косые",
  glutes: "Ягодицы", quads: "Квадрицепс", hams: "Бицепс бедра", calves: "Икры", neck: "Шея",
};

/** Основные группы, по которым считаем баланс недели. */
export const MAJOR: Muscle[] = ["chest", "delts", "triceps", "biceps", "lats", "upperback", "lowerback", "abs", "glutes", "quads", "hams", "calves"];

export const PATTERNS: Record<Pattern, string> = {
  push_h: "Жим от груди", push_v: "Жим вверх", pull_h: "Тяга к поясу", pull_v: "Подтягивания", dip: "Брусья",
  squat: "Приседания", lunge: "Одна нога", hinge: "Наклоны и мосты", core: "Кор", arms: "Руки и плечи",
  calves: "Икры", cardio: "Кардио", mobility: "Мобильность", stretch: "Растяжка",
};

export const EQUIP: Record<Equip, { name: string; icon: string }> = {
  mat: { name: "Коврик", icon: "🧘" },
  chair: { name: "Стул, диван, стол", icon: "🪑" },
  wall: { name: "Стена", icon: "🧱" },
  bar: { name: "Турник", icon: "➖" },
  dip: { name: "Брусья", icon: "🟰" },
  lowbar: { name: "Низкая перекладина", icon: "🛝" },
  band: { name: "Резинка", icon: "🎗️" },
  dumbbell: { name: "Гантели", icon: "🏋️" },
  barbell: { name: "Штанга", icon: "🏋️‍♂️" },
  bench: { name: "Скамья", icon: "🛏️" },
  rack: { name: "Стойки для штанги", icon: "🗼" },
  kettlebell: { name: "Гиря", icon: "🔔" },
};

export const LIMITS: Record<Limitation, string> = {
  knees: "Колени", back: "Поясница", shoulders: "Плечи", wrists: "Запястья",
};

export const DEFAULT_PLACES: Place[] = [
  { id: "home", name: "Дом", icon: "🏠", equip: ["mat", "chair", "wall"] },
  { id: "street", name: "Площадка", icon: "🌳", equip: ["bar", "dip", "lowbar", "wall"] },
  { id: "gym", name: "Мини-зал", icon: "🏋️", equip: ["dumbbell", "barbell", "bench", "mat", "wall", "chair"] },
  { id: "office", name: "Офис", icon: "💼", equip: ["chair", "wall"] },
];

export interface Chain {
  id: string;
  name: string;
  icon: string;
  goal: string;
  steps: string[];
}

const chain = (id: string, name: string, icon: string, goal: string): Chain => ({
  id, name, icon, goal,
  steps: EXERCISES.filter((e) => e.chain === id).sort((a, b) => a.level - b.level).map((e) => e.id),
});

/** Лестницы навыков: от простого к сложному. */
export const CHAINS: Chain[] = [
  chain("push", "Отжимания", "💪", "От отжиманий у стены до отжиманий на одной руке"),
  chain("pullv", "Подтягивания", "🧗", "Первое подтягивание, потом — выход силой"),
  chain("row", "Тяга", "🚣", "Сильная спина и осанка, путь к переднему вису"),
  chain("squat", "Ноги", "🦵", "От приседа на стул до пистолетика"),
  chain("hinge", "Задняя цепь", "🍑", "Ягодицы и бицепс бедра, здоровая поясница"),
  chain("dip", "Брусья", "🏗️", "Трицепс и грудь, подготовка к выходу силой"),
  chain("pike", "Стойка на руках", "🤸", "Плечи и путь к отжиманиям в стойке"),
  chain("plank", "Кор", "🪵", "От мёртвого жука до уголка"),
  chain("hang", "Пресс в висе", "🦶", "От коленей к груди до носков к перекладине"),
];
export const CHAIN = new Map(CHAINS.map((c) => [c.id, c]));

export const hasEquip = (e: Exercise, equip: readonly Equip[]) => e.equip.every((q) => equip.includes(q));
export const allowed = (e: Exercise, limits: readonly Limitation[]) => !e.avoid?.some((l) => limits.includes(l));

export const videoUrl = (e: Exercise) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(e.video ?? `${e.name} техника выполнения`)}`;

/** Шаг вниз/вверх по лестнице. */
export function neighbours(id: string) {
  const e = EX.get(id);
  const c = e?.chain ? CHAIN.get(e.chain) : undefined;
  if (!c) return { easier: undefined, harder: undefined };
  const i = c.steps.indexOf(id);
  return { easier: exById(c.steps[i - 1] ?? ""), harder: exById(c.steps[i + 1] ?? "") };
}
