import { addDays, dayKey } from "@lifehub/sdk";
import { ALL_TOPICS, TRACKS, type Topic } from "../data/curriculum.ts";
import type { TopicState } from "./types.ts";

/*
 * Дорожная карта: цель → темы выбранных треков → план по неделям до дедлайна → контроль отставания.
 * Хранится в useStore("roadmap").
 */

export interface Goal {
  title: string;
  tracks: string[];
  /** До какого уровня тем включать: 1 — база, 2 — middle, 3 — senior. */
  level: 1 | 2 | 3;
  /** dayKey начала и дедлайна. */
  start: string;
  deadline: string;
}

export interface GoalPreset {
  id: string;
  icon: string;
  title: string;
  months: number;
  level: 1 | 2 | 3;
  tracks: string[];
  text: string;
}

export const PRESETS: GoalPreset[] = [
  { id: "senior", icon: "🦅", title: "Senior .NET за 6 месяцев", months: 6, level: 3, tracks: ["csharp", "dotnet", "data", "arch", "distributed", "devops", "sec", "sysdesign"], text: "Глубокий C#, ASP.NET Core, БД, архитектура, распределённые системы, DevOps, безопасность и system design." },
  { id: "middle", icon: "🦊", title: "Крепкий Middle за 3 месяца", months: 3, level: 2, tracks: ["csharp", "dotnet", "data", "arch", "devops"], text: "Уверенный C# и ASP.NET Core, базы данных, основы архитектуры и DevOps." },
  { id: "architect", icon: "🏛️", title: "Путь к архитектору за 9 месяцев", months: 9, level: 3, tracks: ["arch", "distributed", "sysdesign", "data", "sec", "devops", "craft"], text: "Архитектура, распределённые системы, system design, данные, безопасность и лидерство." },
  { id: "ai", icon: "🦾", title: "Инженер с ИИ за 2 месяца", months: 2, level: 3, tracks: ["aidev", "ai"], text: "Разработка вместе с ИИ-агентами и встраивание LLM в свои приложения." },
  { id: "devops", icon: "⚙️", title: "DevOps для разработчика за 3 месяца", months: 3, level: 3, tracks: ["devops", "net", "sec"], text: "Linux, контейнеры, Kubernetes, CI/CD, наблюдаемость, сети и безопасность." },
  { id: "interview", icon: "🎯", title: "К собеседованию за 6 недель", months: 1.5, level: 2, tracks: ["csharp", "dotnet", "data", "cs", "sysdesign", "craft"], text: "Самое спрашиваемое: C#, ASP.NET Core, SQL, алгоритмы, system design, истории для поведенческого интервью." },
];

const DAY = 86_400_000;
const toDate = (k: string) => new Date(k + "T00:00:00");
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

export function goalFromPreset(p: GoalPreset, start = dayKey()): Goal {
  return { title: p.title, tracks: p.tracks, level: p.level, start, deadline: dayKey(addDays(toDate(start), Math.round(p.months * 30.4))) };
}

/** Темы цели: треки по очереди (чередование), внутри трека — порядок программы. */
export function goalTopics(g: Goal): (Topic & { trackId: string })[] {
  const lists = TRACKS.filter((t) => g.tracks.includes(t.id)).map((t) => ALL_TOPICS.filter((x) => x.trackId === t.id && x.level <= g.level));
  const res: (Topic & { trackId: string })[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) res.push(l[i]);
  return res;
}

export interface Week {
  index: number;
  start: string;
  end: string;
  topics: (Topic & { trackId: string })[];
}

export interface RoadmapState {
  topics: (Topic & { trackId: string })[];
  weeks: Week[];
  done: number;
  total: number;
  /** Сколько тем должно быть закрыто к сегодняшнему дню. */
  expected: number;
  /** > 0 — отставание в темах, < 0 — опережение. */
  lag: number;
  currentWeek: number;
  daysLeft: number;
  /** Прогноз завершения при текущем темпе (dayKey) или null, если темп ещё не понятен. */
  forecast: string | null;
  perWeek: number;
  isDone: (id: string) => boolean;
}

export function computeRoadmap(g: Goal, topicMap: Map<string, TopicState>, today = dayKey()): RoadmapState {
  const topics = goalTopics(g);
  const totalDays = Math.max(7, daysBetween(g.start, g.deadline));
  const weekCount = Math.max(1, Math.ceil(totalDays / 7));
  const perWeek = Math.max(1, Math.ceil(topics.length / weekCount));
  const weeks: Week[] = Array.from({ length: weekCount }, (_, i) => ({
    index: i,
    start: dayKey(addDays(toDate(g.start), i * 7)),
    end: dayKey(addDays(toDate(g.start), Math.min(totalDays, i * 7 + 6))),
    topics: topics.slice(i * perWeek, (i + 1) * perWeek),
  }));
  const isDone = (id: string) => topicMap.get(id)?.status === "done";
  const done = topics.filter((t) => isDone(t.id)).length;
  const elapsed = Math.min(totalDays, Math.max(0, daysBetween(g.start, today)));
  const expected = Math.min(topics.length, Math.round((elapsed / totalDays) * topics.length));
  const currentWeek = Math.min(weekCount - 1, Math.floor(elapsed / 7));
  const pace = elapsed >= 3 ? done / elapsed : 0;
  const forecast = pace > 0 ? dayKey(addDays(toDate(today), Math.ceil((topics.length - done) / pace))) : null;
  return {
    topics, weeks, done, total: topics.length, expected, lag: expected - done, currentWeek,
    daysLeft: Math.max(0, daysBetween(today, g.deadline)), forecast, perWeek, isDone,
  };
}

/** Следующая тема по плану: первая незакрытая, начиная с самых ранних недель (сначала долги). */
export function nextGoalTopic(r: RoadmapState) {
  for (const w of r.weeks.slice(0, r.currentWeek + 1)) for (const t of w.topics) if (!r.isDone(t.id)) return t;
  return r.topics.find((t) => !r.isDone(t.id));
}
