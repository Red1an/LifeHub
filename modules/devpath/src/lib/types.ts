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
  | "test" | "video" | "mistakes" | "mixed" | "placement" | "project";

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
