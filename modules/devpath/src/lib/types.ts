/* Форматы данных модуля. Меняя их, сохраняй совместимость со старыми записями. */

/** Шаг интерактивного урока или экзамена. */
export type Step =
  | { kind: "explain"; title: string; md: string }
  | { kind: "choice"; question: string; code?: string; options: string[]; correct: number; why: string }
  | { kind: "open"; question: string; hint?: string }
  /** Расставить элементы по порядку: options — в правильном порядке, показываются перемешанными. */
  | { kind: "order"; question: string; options: string[]; why: string }
  /** Найти строку с ошибкой: bugLine — индекс в lines. */
  | { kind: "bug"; question: string; lines: string[]; bugLine: number; why: string; fix?: string }
  /** Вспомнить ответ и оценить себя (работает без нейронки). */
  | { kind: "recall"; question: string; answer: string };

export interface Lesson {
  steps: Step[];
  depth: "simple" | "normal" | "deep";
  createdAt: number;
}

/** Коллекция topics, id = id темы из curriculum. */
export interface TopicState {
  status: "learning" | "done";
  lesson?: Lesson;
  /** До какого шага урок пройден. */
  lessonStep?: number;
  /** До какого шага пройден встроенный урок. */
  builtinStep?: number;
  /** Лучший результат теста по теме, 0–100. */
  testBest?: number;
  /** 0–100: растёт от уроков, квизов, практики. */
  mastery?: number;
  notes?: string;
  lastAt?: number;
}

/** Коллекция cards: интервальное повторение (SM-2). */
export interface Card {
  topicId: string;
  front: string;
  back: string;
  source: "seed" | "ai" | "user";
  reps: number;
  lapses: number;
  ease: number;
  /** Интервал в днях. */
  interval: number;
  /** dayKey следующего показа; нет — карточка новая. */
  due?: string;
  lastAt?: number;
}

export type ActivityKind =
  | "lesson" | "review" | "practice" | "bug" | "blitz" | "boss" | "interview" | "question" | "cards"
  | "test" | "video" | "mistakes" | "mixed" | "placement" | "project" | "mission" | "kata" | "build";

/** Коллекция log: всё, за что начислен опыт. */
export interface LogEntry {
  date: string;
  kind: ActivityKind;
  xp: number;
  topicId?: string;
  trackId?: string;
  /** 0–100 */
  score?: number;
  note?: string;
}

export interface Quest {
  id: string;
  kind: ActivityKind;
  title: string;
  subtitle: string;
  icon: string;
  xp: number;
  to: string;
  topicId?: string;
  done?: boolean;
}

/** Коллекция days, id = dayKey. План дня фиксируется при первом открытии. */
export interface DayPlan {
  quests: Quest[];
}

/** Коллекция practice: задачи от нейронки и ответы. */
export interface PracticeTask {
  topicId: string;
  title: string;
  kind: "code" | "design" | "lab" | "explain";
  statement: string;
  hints: string[];
  criteria: string[];
  answer?: string;
  review?: string;
  score?: number;
  createdAt: number;
}

/** Коллекция mistakes: вопросы, на которых ошибся. id — хэш темы и вопроса. */
export interface Mistake {
  topicId?: string;
  step: Step;
  wrong: number;
  right: number;
  lastAt: number;
  resolved?: boolean;
}

/** Коллекция watched: просмотренные видео, id = id видео YouTube. */
export interface Watched {
  topicId: string;
  at: number;
}

/** Коллекция projects: прогресс проекта, id = id проекта. */
export interface ProjectState {
  done: number[];
  repo?: string;
  notes?: string;
  startedAt: number;
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/** Коллекция chats: наставник и собеседования. */
export interface Chat {
  mode: "mentor" | "interview" | "socrat";
  title: string;
  topicId?: string;
  trackId?: string;
  messages: ChatMsg[];
  updatedAt: number;
}

export interface Settings {
  focus: string[];
  level: 1 | 2 | 3;
  goal: number;
  newCards: number;
  about: string;
}

export const DEFAULT_SETTINGS: Settings = {
  focus: ["csharp", "dotnet", "devops", "arch"],
  level: 2,
  goal: 60,
  newCards: 10,
  about: "",
};

/* ───────────── Мастерская: миссии и каты (проверяет хаб, server/devpath) ───────────── */

export interface TestCase {
  name: string;
  ok: boolean;
  message?: string;
  /** Сборка с тестом: Hub.Tests — тесты хаба, остальные — свои тесты ученика. */
  source?: string;
}

export interface BuildError {
  file: string;
  line: number;
  code: string;
  message: string;
}

/** Результат прогона тестов хабом (формат — server/devpath/runner.ts). */
export interface RunResult {
  ok: boolean;
  built: boolean;
  passed: number;
  total: number;
  tests: TestCase[];
  errors: BuildError[];
  output?: string;
  ms: number;
}

/** Коллекция runs: запросы к хабу. Модуль добавляет kind и цель, хаб дописывает статус и результат. */
export interface Run {
  kind: "start" | "check" | "diff" | "open" | "reset" | "kata" | "env" | "snapshot";
  /** diff: с какого коммита; snapshot: сообщение коммита. */
  since?: string;
  message?: string;
  commit?: string;
  mission?: string;
  project?: string;
  /** Для проекта: до какого этапа гонять тесты. */
  stage?: number;
  kata?: string;
  code?: string;
  file?: string;
  line?: number;
  status?: "running" | "done" | "error";
  result?: RunResult;
  path?: string;
  diff?: string;
  error?: string;
}

/** kv env: окружение компьютера с хабом. */
export interface WorkshopEnv {
  dir: string;
  dotnet: string | null;
  git: string | null;
  code: string | null;
  checkedAt: number;
}

/** Коллекция missions, id = id миссии. */
export interface MissionState {
  stage: "work" | "debrief" | "done";
  hypothesis: string;
  /** Сколько подсказок открыто. */
  hints: number;
  checks: number;
  /** День последней проверки: первая проверка за день даёт немного опыта и закрывает задание дня. */
  lastCheckDay?: string;
  path?: string;
  last?: RunResult & { at: number };
  /** Первый раз все тесты зелёные. */
  solvedAt?: number;
  doneAt?: number;
  quiz?: number;
  /** Что понял — своими словами после разбора. */
  takeaway?: string;
  review?: string;
  startedAt: number;
}

/** Коллекция katas, id = id каты. */
export interface KataState {
  code: string;
  attempts: number;
  last?: RunResult & { at: number };
  solvedAt?: number;
  /** Лучшее время решения в секундах (от первого ввода до зелёных тестов). */
  best?: number;
  /** Начало текущей попытки. */
  startedAt?: number;
  /** Подсмотрел эталон до решения. */
  peeked?: boolean;
}

/** Коллекция builds: большой проект, id = id проекта (projects/<id>). Ключи словарей — номер этапа. */
export interface BuildState {
  /** Открытый этап: до него всё пройдено. */
  stage: number;
  /** Этапы, на которых все тесты зелёные. */
  passed: number[];
  /** Этапы, где пройден и разбор (опыт начислен). */
  finished: number[];
  design: Record<string, string>;
  hints: Record<string, number>;
  takeaways: Record<string, string>;
  quiz: Record<string, number>;
  checks: number;
  lastCheckDay?: string;
  last?: RunResult & { at: number; stage: number };
  path?: string;
  startedAt: number;
  /** Коммит-снимок начала этапа: от него считается diff этапа для ревью и защиты. */
  startCommit?: Record<string, string>;
  /** Открытые этапы: оценка дизайн-документа архитектором (нужно ≥ 7, чтобы писать код). */
  designReview?: Record<string, Graded>;
  /** Обязательное ревью кода этапа (нужно ≥ 7). */
  reviews?: Record<string, Graded>;
  /** Защита этапа: разговор с интервьюером и итоговая оценка (нужно ≥ 7). */
  defense?: Record<string, { messages: ChatMsg[]; score?: number; at: number }>;
}

/** Оценка нейронкой: 0–10 и текст разбора. */
export interface Graded {
  score: number;
  text: string;
  at: number;
}
