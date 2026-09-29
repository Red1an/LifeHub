import { addDays, dayKey } from "@lifehub/sdk";
import type { LogEntry } from "./types.ts";

export interface Rank {
  xp: number;
  title: string;
  icon: string;
}

export const RANKS: Rank[] = [
  { xp: 0, title: "Стажёр", icon: "🥚" },
  { xp: 300, title: "Junior", icon: "🐣" },
  { xp: 900, title: "Junior+", icon: "🐥" },
  { xp: 2000, title: "Middle", icon: "🦊" },
  { xp: 3800, title: "Middle+", icon: "🐺" },
  { xp: 6500, title: "Senior", icon: "🦅" },
  { xp: 10000, title: "Senior+", icon: "🐉" },
  { xp: 15000, title: "Tech Lead", icon: "🧙" },
  { xp: 22000, title: "Architect", icon: "🏛️" },
  { xp: 32000, title: "Легенда", icon: "🌌" },
];

export function rankFor(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const cur = RANKS[i];
  const next = RANKS[i + 1];
  return { rank: cur, next, index: i, progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1 };
}

export function xpByDay(log: LogEntry[]) {
  const m: Record<string, number> = {};
  for (const e of log) m[e.date] = (m[e.date] ?? 0) + e.xp;
  return m;
}

/** Серия дней, когда выполнена дневная цель по опыту (сегодня можно ещё не выполнить). */
export function streak(byDay: Record<string, number>, goal: number) {
  let n = 0;
  let d = new Date();
  if ((byDay[dayKey(d)] ?? 0) < goal) d = addDays(d, -1);
  while ((byDay[dayKey(d)] ?? 0) >= goal) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function bestStreak(byDay: Record<string, number>, goal: number) {
  const days = Object.keys(byDay).filter((k) => byDay[k] >= goal).sort();
  let best = 0;
  let cur = 0;
  let prev = "";
  for (const k of days) {
    cur = prev && dayKey(addDays(prev, 1)) === k ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = k;
  }
  return best;
}

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  text: string;
  done: boolean;
}

export function achievements(s: {
  log: LogEntry[];
  xp: number;
  best: number;
  doneTopics: number;
  learnedCards: number;
  tracksStarted: number;
  projectsDone: number;
}): Achievement[] {
  const count = (k: LogEntry["kind"], min = 0) => s.log.filter((e) => e.kind === k && (e.score ?? 100) >= min).length;
  const blitzBest = Math.max(0, ...s.log.filter((e) => e.kind === "blitz").map((e) => e.score ?? 0));
  const a = (id: string, icon: string, title: string, text: string, done: boolean) => ({ id, icon, title, text, done });
  return [
    a("first", "🚀", "Первый шаг", "Пройти первый урок", count("lesson") >= 1),
    a("s3", "🔥", "Разогрев", "Серия 3 дня", s.best >= 3),
    a("s7", "⚡", "Неделя огня", "Серия 7 дней", s.best >= 7),
    a("s30", "🌋", "Железная дисциплина", "Серия 30 дней", s.best >= 30),
    a("s100", "☄️", "Машина", "Серия 100 дней", s.best >= 100),
    a("t10", "📚", "Эрудит", "Закрыть 10 тем", s.doneTopics >= 10),
    a("t50", "🎓", "Энциклопедист", "Закрыть 50 тем", s.doneTopics >= 50),
    a("c50", "🧠", "Долгая память", "50 карточек выучено надолго", s.learnedCards >= 50),
    a("r500", "🔁", "Повторение — мать", "500 повторений карточек", s.log.filter((e) => e.kind === "review").reduce((n, e) => n + Number(e.note ?? 1), 0) >= 500),
    a("bug10", "🐞", "Охотник на баги", "Найти 10 багов", count("bug", 100) >= 10),
    a("blitz", "⏱️", "Молния", "Набрать 15+ в Блице", blitzBest >= 15),
    a("boss", "👹", "Победитель босса", "Сдать экзамен трека на 80%+", count("boss", 80) >= 1),
    a("boss5", "🏆", "Гроза боссов", "Сдать 5 экзаменов", count("boss", 80) >= 5),
    a("prac", "🛠️", "Практик", "Решить 10 практических задач", count("practice") >= 10),
    a("iv", "🎤", "Не страшно", "Пройти пробное собеседование", count("interview") >= 1),
    a("vid", "🎬", "Киноман", "Посмотреть 20 обучающих видео", count("video") >= 20),
    a("fix", "🩹", "Работа над ошибками", "10 подходов к ошибкам", count("mistakes") >= 10),
    a("mix", "🔀", "Чередование", "10 смешанных тренировок", count("mixed") >= 10),
    a("test", "💯", "Отличник", "Сдать 10 тестов на 90%+", count("test", 90) >= 10),
    a("proj", "🏗️", "Строитель", "Закрыть 5 этапов проектов", count("project") >= 5),
    a("proj1", "🚢", "В портфолио", "Закончить целый проект", s.projectsDone >= 1),
    a("wide", "🧭", "Т-образный", "Начать 6 разных треков", s.tracksStarted >= 6),
    a("x5k", "💎", "5000 XP", "Набрать 5000 опыта", s.xp >= 5000),
  ];
}

/** Опыт за действия. */
export const XP = {
  lessonStep: 5,
  lessonDone: 40,
  review: 2,
  practice: 50,
  bug: 20,
  question: 25,
  interview: 60,
  boss: 100,
  cards: 10,
};
