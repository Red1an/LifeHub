import { hubStorage } from "./storage";
const STATS_KEY = "guitarhub:train-stats";
const DAYS_KEY = "guitarhub:practice-days";
const HISTORY_LIMIT = 60;

export interface ScorePoint {
  t: number;
  score: number;
}

export interface ExerciseStat {
  attempts: number;
  best: number;
  last: number;
  updatedAt: number;
  history?: ScorePoint[];
}

export type StatsMap = Record<string, ExerciseStat>;
/** Local date → ids of exercises practised that day. */
export type DayLog = Record<string, string[]>;

export function dayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = hubStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadStats(): StatsMap {
  return read<StatsMap>(STATS_KEY, {});
}

export function loadDayLog(): DayLog {
  return read<DayLog>(DAYS_KEY, {});
}

/** Marks an exercise as practised today (also for exercises without a score). */
export function markPractice(exerciseId: string) {
  const log = loadDayLog();
  const today = dayKey();
  const ids = new Set(log[today] ?? []);
  ids.add(exerciseId);
  log[today] = [...ids];
  hubStorage.setItem(DAYS_KEY, JSON.stringify(log));
}

/**
 * Records one finished round. `score` is usually 0..100; some exercises record
 * another unit (BPM, seconds) — see ExerciseMeta.scoreUnit.
 */
export function recordScore(exerciseId: string, score: number): StatsMap {
  const stats = loadStats();
  const previous = stats[exerciseId];
  const history = [...(previous?.history ?? []), { t: Date.now(), score }].slice(-HISTORY_LIMIT);
  stats[exerciseId] = {
    attempts: (previous?.attempts ?? 0) + 1,
    best: Math.max(previous?.best ?? 0, score),
    last: score,
    updatedAt: Date.now(),
    history,
  };
  hubStorage.setItem(STATS_KEY, JSON.stringify(stats));
  markPractice(exerciseId);
  return stats;
}

/** Consecutive days with practice, counting back from today (or yesterday). */
export function currentStreak(log: DayLog): number {
  let streak = 0;
  const cursor = new Date();
  if (!log[dayKey(cursor)]?.length) cursor.setDate(cursor.getDate() - 1);
  while (log[dayKey(cursor)]?.length) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
