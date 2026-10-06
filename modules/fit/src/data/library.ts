import type { Equip, Exercise, Limitation, Muscle, Pattern, Place } from "../lib/types.ts";
import { STRENGTH } from "./strength.ts";
import { MOBILITY } from "./mobility.ts";
import { STANDING } from "./standing.ts";
import { EXTRA_RAW } from "./extra.ts";
import { GIF, GIF_EXTRA, YT } from "./demos.ts";

/** Свои упражнения с техникой на русском: на них работают генератор, лестницы и тренер. */
export const EXERCISES: Exercise[] = [...STRENGTH, ...MOBILITY, ...STANDING];

const ICON: Record<Pattern, string> = {
  push_h: "💪", push_v: "🙌", pull_h: "🚣", pull_v: "🧗", dip: "🏗️", squat: "🦵", lunge: "🚶", hinge: "🍑",
  core: "🔥", arms: "💪", calves: "🦶", cardio: "🏃", mobility: "🔄", stretch: "🧘",
};
const LOAD: Partial<Record<Equip, Exercise["load"]>> = { barbell: "barbell", dumbbell: "dumbbell", kettlebell: "kettlebell" };
const list = <T extends string>(s: string) => (s ? (s.split(",") as T[]) : []);

/** Расширенный каталог (free-exercise-db): для поиска, своих комплексов и замен. */
export const EXTRA: Exercise[] = EXTRA_RAW.map(([id, name, pattern, muscles, secondary, equip, level, flags]) => {
  const eq = list<Equip>(equip);
  return {
    id: `x:${id}`, name, icon: ICON[pattern as Pattern], pattern: pattern as Pattern,
    muscles: list<Muscle>(muscles), secondary: list<Muscle>(secondary), equip: eq, level,
    mode: flags.includes("t") ? "time" : "reps", sides: flags.includes("s") || undefined,
    load: eq.map((q) => LOAD[q]).find(Boolean),
    steps: [], cues: [], mistakes: [], photo: id, gif: GIF_EXTRA[id], ext: true,
  };
});

/** Картинки из free-exercise-db для своих упражнений (там, где движение совпадает). */
const PHOTO: Record<string, string> = {
  "arm-circles": "Arm_Circles", "wrist-circles": "Wrist_Circles", "cat-cow": "Cat_Stretch", "worlds-greatest": "Worlds_Greatest_Stretch",
  "hip-circles": "Standing_Hip_Circles", "ankle-circles": "Ankle_Circles", "inchworm": "Inchworm", "torso-twist": "Torso_Rotation",
  "shoulder-rolls": "Shoulder_Circles", "neck-tilts": "Side_Neck_Stretch", "standing-side-bend": "Standing_Lateral_Stretch",
  "standing-hip-flexor": "Standing_Hip_Flexors", "standing-hamstring": "Standing_Hamstring_and_Calf_Stretch", "childs-pose": "Childs_Pose",
  "figure4-lying": "Lying_Glute", "seated-hamstring": "Seated_Floor_Hamstring_Stretch", "quad-stretch": "Quad_Stretch",
  "calf-stretch": "Calf_Stretch_Hands_Against_Wall", "cross-shoulder": "Shoulder_Stretch", "triceps-stretch": "Triceps_Stretch",
  "butterfly": "Butterfly", "lying-twist": "Knee_Across_The_Body", "doorway-pec": "One_Arm_Against_Wall", "seated-figure4": "Ankle_On_The_Knee",
  "couch-stretch": "Intermediate_Hip_Flexor_and_Quad_Stretch", "elbow-circles": "Elbow_Circles", "knee-circles": "Knee_Circles",
  "windmill": "Windmills", "butt-kicks": "Single_Leg_Butt_Kick", "forward-fold": "Standing_Toe_Touches", "foot-circles": "Ankle_Circles",
  "incline-pushup": "Incline_Push-Up", "wall-pushup": "Incline_Push-Up", "pushup": "Pushups", "diamond-pushup": "Push-Ups_-_Close_Triceps_Position",
  "decline-pushup": "Push-Ups_With_Feet_Elevated", "one-arm-pushup": "Single-Arm_Push-Up", "clap-pushup": "Plyo_Push-up", "hspu": "Handstand_Push-Ups",
  "scap-pull": "Scapular_Pull-Up", "chinup": "Chin-Up", "pullup": "Pullups", "band-pullup": "Band_Assisted_Pull-Up", "muscle-up": "Muscle_Up",
  "australian-row": "Inverted_Row", "australian-row-bent": "Inverted_Row", "bench-dip": "Bench_Dips", "dip": "Parallel_Bar_Dip",
  "box-squat": "Chair_Squat", "air-squat": "Bodyweight_Squat", "split-squat": "Split_Squats", "reverse-lunge": "Dumbbell_Rear_Lunge",
  "step-up": "Dumbbell_Step_Ups", "jump-squat": "Freehand_Jump_Squat", "glute-bridge": "Butt_Lift_Bridge", "sl-glute-bridge": "Single_Leg_Glute_Bridge",
  "superman": "Superman", "dead-bug": "Dead_Bug", "plank": "Plank", "side-plank": "Side_Bridge", "lying-leg-raise": "Flat_Bench_Lying_Leg_Raise",
  "reverse-crunch": "Reverse_Crunch", "russian-twist": "Russian_Twist", "hanging-knee-raise": "Hanging_Leg_Raise", "hanging-leg-raise": "Hanging_Leg_Raise",
  "toes-to-bar": "Hanging_Pike", "v-up": "Jackknife_Sit-Up", "bicycle-crunch": "Cross-Body_Crunch", "calf-raise": "Standing_Calf_Raises",
  "mountain-climbers": "Mountain_Climbers", "nordic-negative": "Natural_Glute_Ham_Raise", "good-morning-bw": "Good_Morning",
  "db-goblet-squat": "Goblet_Squat", "db-rdl": "Stiff-Legged_Dumbbell_Deadlift", "db-bench": "Dumbbell_Bench_Press", "db-floor-press": "Dumbbell_Floor_Press",
  "db-row": "One-Arm_Dumbbell_Row", "db-ohp": "Standing_Dumbbell_Press", "db-lateral": "Side_Lateral_Raise", "db-reardelt": "Seated_Bent-Over_Rear_Delt_Raise",
  "db-curl": "Dumbbell_Bicep_Curl", "db-hammer": "Hammer_Curls", "db-oh-triceps": "Standing_Dumbbell_Triceps_Extension", "db-lunge": "Dumbbell_Lunges",
  "db-bulgarian": "Split_Squat_with_Dumbbells", "db-swing": "Vertical_Swing", "db-farmer": "Farmers_Walk", "db-shrug": "Dumbbell_Shrug",
  "bb-squat": "Barbell_Squat", "bb-deadlift": "Barbell_Deadlift", "bb-rdl": "Romanian_Deadlift", "bb-bench": "Barbell_Bench_Press_-_Medium_Grip",
  "bb-floor-press": "Floor_Press", "bb-ohp": "Standing_Military_Press", "bb-row": "Bent_Over_Barbell_Row", "bb-curl": "Barbell_Curl",
  "bb-hip-thrust": "Barbell_Hip_Thrust", "bb-lunge": "Barbell_Lunge", "bb-good-morning": "Good_Morning", "band-pull-apart": "Band_Pull_Apart",
  "band-face-pull": "Face_Pull",
};
for (const e of EXERCISES) {
  e.photo ??= PHOTO[e.id];
  e.gif ??= GIF[e.id];
  e.yt ??= YT[e.id];
}

/** Всё вместе — для каталога и поиска по id. */
export const CATALOG: Exercise[] = [...EXERCISES, ...EXTRA];
export const EX = new Map(CATALOG.map((e) => [e.id, e]));
export const exById = (id: string) => EX.get(id);

export const MUSCLES: Record<Muscle, string> = {
  chest: "Грудь", delts: "Плечи", triceps: "Трицепс", biceps: "Бицепс", forearms: "Предплечья",
  lats: "Широчайшие", upperback: "Верх спины", lowerback: "Поясница", abs: "Пресс", obliques: "Косые",
  glutes: "Ягодицы", quads: "Квадрицепс", hams: "Бицепс бедра", calves: "Икры", neck: "Шея", adductors: "Приводящие",
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
  machine: { name: "Тренажёры", icon: "⚙️" },
  cable: { name: "Блочный тренажёр", icon: "🪢" },
  ball: { name: "Фитбол, медбол", icon: "⚽" },
  roller: { name: "Ролик для МФР", icon: "🧻" },
  other: { name: "Особый инвентарь", icon: "🧰" },
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
