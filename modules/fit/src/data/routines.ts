import type { WorkoutKind } from "../lib/types.ts";

export interface Routine {
  id: string;
  kind: Exclude<WorkoutKind, "workout">;
  title: string;
  icon: string;
  text: string;
  color: string;
  /** [упражнение, секунд, подсказка по повторам] */
  items: [string, number, number?][];
}

/** Готовые короткие комплексы: разминка у стола, зарядка, растяжка. */
export const ROUTINES: Routine[] = [
  /* ───── У стола (2–4 минуты) ───── */
  {
    id: "desk-neck", kind: "break", title: "Шея и плечи", icon: "🙆", color: "#38d6f5",
    text: "Снять зажим после ноутбука",
    items: [["neck-tilts", 30], ["chin-tuck", 30, 8], ["shoulder-rolls", 30], ["desk-upper-trap", 40], ["desk-shrugs", 20, 5], ["scap-squeeze", 30, 6]],
  },
  {
    id: "desk-back", kind: "break", title: "Спина после сидения", icon: "🧍", color: "#c8f031",
    text: "Распрямиться и разгрузить поясницу",
    items: [["standing-backbend", 20, 8], ["standing-hip-flexor", 60], ["seated-twist", 40], ["standing-side-bend", 40], ["wall-angel", 40, 8]],
  },
  {
    id: "desk-hands", kind: "break", title: "Кисти и глаза", icon: "🤲", color: "#ff7a2f",
    text: "Для тех, кто много печатает",
    items: [["wrist-circles", 30], ["wrist-stretch", 40], ["cross-shoulder", 40], ["eyes-20", 30]],
  },
  {
    id: "desk-energy", kind: "break", title: "Взбодриться", icon: "⚡", color: "#ff4d8d",
    text: "Разогнать кровь вместо кофе",
    items: [["march", 40], ["box-squat", 40, 12], ["incline-pushup", 30, 10], ["calf-raise", 30, 15], ["torso-twist", 30], ["jumping-jacks", 30]],
  },
  {
    id: "desk-hips", kind: "break", title: "Таз и ноги", icon: "🦵", color: "#a78bfa",
    text: "Раскрыть бёдра после долгого сидения",
    items: [["hip-circles", 30], ["standing-hip-flexor", 60], ["seated-figure4", 60], ["standing-hamstring", 60], ["calf-raise", 20, 12]],
  },
  {
    id: "desk-calm", kind: "break", title: "Перезагрузка головы", icon: "🌬️", color: "#34d399",
    text: "Дыхание и глаза — когда устал думать",
    items: [["box-breath", 64], ["eyes-20", 30], ["desk-shrugs", 20, 5], ["neck-tilts", 30]],
  },

  /* ───── Зарядка ───── */
  {
    id: "morning-soft", kind: "morning", title: "Мягкое пробуждение", icon: "🌅", color: "#fbbf24",
    text: "5 минут, можно прямо в пижаме",
    items: [["neck-tilts", 30], ["shoulder-rolls", 30], ["cat-cow", 45], ["thoracic-rotation", 60], ["glute-bridge", 40, 12], ["standing-side-bend", 40], ["march", 45]],
  },
  {
    id: "morning-energy", kind: "morning", title: "Бодрая зарядка", icon: "☀️", color: "#ff7a2f",
    text: "10 минут: мобильность + лёгкая сила",
    items: [
      ["jumping-jacks", 45], ["arm-circles", 30], ["hip-circles", 30], ["worlds-greatest", 60], ["air-squat", 40, 15],
      ["pushup", 40, 10], ["reverse-lunge", 60, 8], ["bird-dog", 60, 8], ["plank", 40], ["shadow-boxing", 45], ["down-dog", 40],
    ],
  },
  {
    id: "morning-mobility", kind: "morning", title: "Суставы и спина", icon: "🐈", color: "#38d6f5",
    text: "8 минут: подвижность без нагрузки",
    items: [
      ["neck-tilts", 30], ["shoulder-rolls", 30], ["wrist-circles", 30], ["cat-cow", 60], ["thoracic-rotation", 60],
      ["hip-circles", 30], ["deep-squat-hold", 45], ["worlds-greatest", 60], ["dead-bug", 60, 10], ["lying-twist", 60],
    ],
  },

  /* ───── Растяжка ───── */
  {
    id: "stretch-evening", kind: "stretch", title: "Вечерняя растяжка", icon: "🌙", color: "#a78bfa",
    text: "10 минут перед сном: спина, таз, ноги",
    items: [
      ["cat-cow", 45], ["childs-pose", 60], ["cobra", 40], ["figure4-lying", 80], ["lying-twist", 80],
      ["seated-hamstring", 60], ["butterfly", 60], ["box-breath", 64],
    ],
  },
  {
    id: "stretch-desk", kind: "stretch", title: "Антиофис", icon: "💼", color: "#c8f031",
    text: "8 минут против сидячей работы",
    items: [
      ["doorway-pec", 45], ["standing-hip-flexor", 80], ["couch-stretch", 80], ["pigeon", 80], ["childs-pose", 45], ["cobra", 40], ["wall-angel", 45, 10],
    ],
  },
];

export const ROUTINE = new Map(ROUTINES.map((r) => [r.id, r]));
