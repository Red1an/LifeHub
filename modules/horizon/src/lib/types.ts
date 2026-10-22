/** Виды карточек порции дня — в порядке показа. */
export type Kind = "history" | "fact" | "quote" | "puzzle" | "tech" | "concept" | "word" | "joke" | "poem" | "art";

export const KINDS: Kind[] = ["history", "fact", "quote", "puzzle", "tech", "concept", "word", "joke", "poem", "art"];

export const KIND_INFO: Record<Kind, { icon: string; label: string; color: string }> = {
  history: { icon: "📜", label: "В этот день", color: "#f5b453" },
  fact: { icon: "💡", label: "Знаете ли вы", color: "#5cc8f0" },
  quote: { icon: "💬", label: "Цитата", color: "#facc15" },
  puzzle: { icon: "🧩", label: "Задачка", color: "#a78bfa" },
  tech: { icon: "🚀", label: "Технология", color: "#34d399" },
  concept: { icon: "🧠", label: "Понятие", color: "#fb7185" },
  word: { icon: "🔤", label: "Слово", color: "#fb923c" },
  joke: { icon: "😄", label: "Анекдот", color: "#2dd4bf" },
  poem: { icon: "🪶", label: "Стих", color: "#93a5ff" },
  art: { icon: "🎨", label: "Картина", color: "#f472b6" },
};

/** Вопрос для повторения: через 1, 3, 7, 21, 60 дней. */
export interface Recall {
  q: string;
  a: string;
}

export interface HistoryData {
  year: number;
  title: string;
  story: string;
  why: string;
  image?: string;
  link?: string;
  recall?: Recall;
}

export interface FactData {
  teaser: string;
  title: string;
  answer: string;
  image?: string;
  link: string;
  recall?: Recall;
}

export interface PuzzleData {
  title: string;
  topic: string;
  level: number;
  text: string;
  answerType: "number" | "choice" | "word";
  options?: string[];
  /** Для choice — текст верного варианта; для word — варианты через «|». */
  answer: string;
  hints: string[];
  solution: string;
}

export interface TechData {
  name: string;
  tagline: string;
  problem: string;
  how: string;
  where: string;
  try?: string;
  link?: string;
  recall?: Recall;
}

export interface ConceptData {
  name: string;
  field: string;
  idea: string;
  example: string;
  use: string;
  recall?: Recall;
}

export interface WordData {
  word: string;
  /** Слово с ударением: «ска́брезный». */
  stress: string;
  meaning: string;
  origin: string;
  example: string;
  recall?: Recall;
}

export interface PoemData {
  author: string;
  title: string;
  lines: string[];
  about: string;
  notice: string;
  link: string;
  firstLine: string;
}

export interface ArtData {
  title: string;
  artist: string;
  year: string;
  image?: string;
  story: string;
  look: string;
  link?: string;
  recall?: Recall;
}

export interface QuoteData {
  text: string;
  author: string;
  /** Кто это: «британский премьер-министр, 1874–1965». */
  who: string;
  /** Где и по какому поводу сказано. */
  context: string;
  meaning: string;
  /** Когда её к месту ввернуть. */
  use: string;
  recall?: Recall;
}

export interface JokeData {
  topic: string;
  setup: string;
  punchline: string;
  /** Когда к месту рассказать. */
  when: string;
  recall?: Recall;
}

export type CardData = HistoryData | FactData | QuoteData | PuzzleData | TechData | ConceptData | WordData | JokeData | PoemData | ArtData;

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export interface PuzzleState {
  solved: boolean;
  tries: number;
  hints: number;
  gaveUp?: boolean;
}

/** Коллекция cards, id — `${day}_${kind}` (доп. задачки — `${day}_puzzle_${n}`). */
export interface CardDoc {
  day: string;
  kind: Kind;
  status: "loading" | "ready" | "error";
  startedAt: number;
  error?: string;
  data?: CardData;
  reaction?: 1 | -1 | null;
  done?: boolean;
  doneAt?: number;
  puzzle?: PuzzleState;
  chat?: ChatMsg[];
}

/** Коллекция recall: вопросы для повторения по карточкам. */
export interface RecallDoc {
  cardId: string;
  kind: Kind;
  title: string;
  q: string;
  a: string;
  due: string;
  step: number;
  learned?: boolean;
}

/** Событие из «В этот день» Википедии. */
export interface DayEvent {
  year: number;
  text: string;
  title?: string;
  thumb?: string;
  link?: string;
}

/** Коллекция days, id — день: события «в этот день» (грузятся из Википедии один раз). */
export interface DayDoc {
  day: string;
  selected: DayEvent[];
  events: DayEvent[];
  births: DayEvent[];
  deaths: DayEvent[];
  holidays: string[];
}

/** Коллекция games: «Угадай год». */
export interface GameDoc {
  day: string;
  score: number;
  rounds: { year: number; guess: number; points: number }[];
  at: number;
}

/** kv prefs. */
export interface Prefs {
  interests: string;
  off: Kind[];
  /** Сложность задачек 1–5, подстраивается сама. */
  level: number;
}

export const DEFAULT_PREFS: Prefs = { interests: "", off: [], level: 2 };

/**
 * kv quick — короткие задачки с вариантами для экрана «Зачем пришёл?» в Фокусе.
 * Формат читает сервер (server/focus.ts) и расширение (focus/gate.js) — менять только вместе.
 */
export interface QuickPuzzle {
  id: string;
  text: string;
  options: string[];
  answer: number;
  why: string;
}
