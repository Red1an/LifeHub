/* Общие типы модуля «Форма». */

export type Muscle =
  | "chest" | "delts" | "triceps" | "biceps" | "forearms"
  | "lats" | "upperback" | "lowerback" | "abs" | "obliques"
  | "glutes" | "quads" | "hams" | "calves" | "neck";

/** Двигательный паттерн — основа балансировки тренировок. */
export type Pattern =
  | "push_h"   // горизонтальный жим: отжимания, жим лёжа
  | "push_v"   // вертикальный жим: жим стоя, пайк
  | "pull_h"   // горизонтальная тяга: австралийские, тяга в наклоне
  | "pull_v"   // вертикальная тяга: подтягивания
  | "dip"      // брусья
  | "squat"
  | "lunge"    // на одной ноге
  | "hinge"    // наклон: мосты, становая
  | "core"
  | "arms"     // изоляция рук и плеч
  | "calves"
  | "cardio"
  | "mobility" // разминка, суставная гимнастика
  | "stretch"; // растяжка

export type Equip =
  | "mat"       // коврик
  | "chair"     // стул / диван / стол — есть везде в помещении
  | "wall"
  | "bar"       // турник
  | "dip"       // брусья
  | "lowbar"    // низкая перекладина для австралийских (на площадке)
  | "band"      // резинка
  | "dumbbell"
  | "barbell"
  | "bench"
  | "rack"      // стойки для штанги
  | "kettlebell";

export type Limitation = "knees" | "back" | "shoulders" | "wrists";

export type Tag = "warmup" | "desk" | "morning" | "cooldown" | "cardio" | "skill" | "improvised";

export interface Exercise {
  id: string;
  name: string;
  icon: string;
  pattern: Pattern;
  muscles: Muscle[];
  secondary?: Muscle[];
  /** Всё необходимое оборудование (пусто — ничего не нужно). */
  equip: Equip[];
  /** Сложность 1–10. */
  level: number;
  /** Цепочка прогрессии, в которой стоит упражнение. */
  chain?: string;
  /** Повторы или удержание по времени (сек). */
  mode: "reps" | "time";
  /** Выполняется на каждую сторону. */
  sides?: boolean;
  /** Отягощение, которое записываем в кг. */
  load?: "barbell" | "dumbbell" | "kettlebell";
  steps: string[];
  cues: string[];
  mistakes: string[];
  breathe?: string;
  /** Кому стоит быть осторожнее. */
  avoid?: Limitation[];
  tags?: Tag[];
  /** Короткий поисковый запрос для видео (иначе — название). */
  video?: string;
}

export type Goal = "health" | "strength" | "muscle" | "endurance" | "fatloss";
export type Experience = 1 | 2 | 3; // новичок, средний, продвинутый

export interface Place {
  id: string;
  name: string;
  icon: string;
  equip: Equip[];
}

export interface Profile {
  onboarded: boolean;
  name?: string;
  experience: Experience;
  goal: Goal;
  /** Тренировок в неделю (цель). */
  perWeek: number;
  /** Длительность тренировки по умолчанию, мин. */
  minutes: number;
  limits: Limitation[];
  places: Place[];
  place: string;
  /** Разминок у стола в день (цель). */
  breaksPerDay: number;
  /** Напоминать о разминке каждые N минут (0 — не напоминать). */
  remindEvery: number;
  workFrom: number; // час
  workTo: number;
  sound: boolean;
  voice: boolean;
  bodyweight?: number;
}

export type Focus = "auto" | "full" | "upper" | "lower" | "push" | "pull" | "core" | "hiit" | "mobility";

export interface SetLog {
  reps?: number;
  sec?: number;
  kg?: number;
  done: boolean;
}

export interface Prescription {
  sets: number;
  /** Цель повторов: [мин, макс]. */
  reps?: [number, number];
  sec?: number;
  kg?: number;
  rest: number;
}

export interface WorkoutItem {
  ex: string;
  block: "warmup" | "main" | "cooldown";
  plan: Prescription;
  sets: SetLog[];
  /** Ощущения после упражнения: 1 легко, 2 норм, 3 тяжело. */
  feel?: 1 | 2 | 3;
  /** Подсказка, почему именно так («+2.5 кг», «новый уровень»). */
  note?: string;
}

export type WorkoutKind = "workout" | "break" | "morning" | "stretch";

export interface Workout {
  kind: WorkoutKind;
  title: string;
  focus?: Focus;
  place?: string;
  circuit?: { rounds: number; work: number; rest: number };
  items: WorkoutItem[];
  startedAt: number;
  finishedAt?: number;
  /** Чистое время в секундах. */
  seconds?: number;
  xp?: number;
  rating?: 1 | 2 | 3 | 4 | 5;
  prs?: string[];
  /** Поднятые ступени лестниц. */
  ups?: { chain: string; from: string; to: string }[];
  note?: string;
}

export interface Benchmark {
  test: string;
  value: number;
  date: string;
}

export interface BodyEntry {
  date: string;
  weight: number;
}
