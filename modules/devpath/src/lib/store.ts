import { useMemo } from "react";
import { db, dayKey, toast, useCollection, useStore, type WithDoc } from "@lifehub/sdk";
import { ALL_TOPICS, topicById } from "../data/curriculum.ts";
import { SEED_CARDS } from "../data/cards.ts";
import { newCard, isDue, isLearned } from "./srs.ts";
import { rankFor, streak, xpByDay } from "./game.ts";
import { contentFor } from "./content.ts";
import {
  DEFAULT_SETTINGS, type ActivityKind, type Card, type DayPlan, type LogEntry, type Mistake, type ProjectState, type Settings, type Step,
  type TopicState, type Watched,
} from "./types.ts";

export const topicsDb = db.collection<TopicState>("topics");
export const cardsDb = db.collection<Card>("cards");
export const logDb = db.collection<LogEntry>("log");
export const daysDb = db.collection<DayPlan>("days");
export const mistakesDb = db.collection<Mistake>("mistakes");
export const watchedDb = db.collection<Watched>("watched");
export const projectsDb = db.collection<ProjectState>("projects");

/** Короткий стабильный id по тексту (для ошибок и карточек). */
export function hashId(prefix: string, text: string) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `${prefix}${(h >>> 0).toString(36)}`;
}

const stepText = (s: Step) => ("question" in s ? s.question : "") + ("lines" in s ? s.lines.join("") : "");

/**
 * Запомнить ответ: ошибка попадает в «Работу над ошибками»,
 * вопрос считается исправленным после двух верных ответов подряд.
 */
export async function recordAnswer(step: Step, ok: boolean, topicId?: string) {
  const id = hashId("m", (topicId ?? "") + stepText(step));
  const cur = await mistakesDb.get(id);
  if (!ok) {
    await mistakesDb.put(id, { topicId, step, wrong: (cur?.wrong ?? 0) + 1, right: 0, lastAt: Date.now(), resolved: false });
  } else if (cur && !cur.resolved) {
    const right = cur.right + 1;
    await mistakesDb.update(id, { right, lastAt: Date.now(), resolved: right >= 2 });
  }
}

export function useSettings() {
  const [s, set, meta] = useStore<Settings>("settings", DEFAULT_SETTINGS);
  return [{ ...DEFAULT_SETTINGS, ...s }, set, meta] as const;
}

/** Всё состояние обучения разом: темы, карточки, опыт, серия. */
export function useDev() {
  const topics = useCollection<TopicState>("topics");
  const cards = useCollection<Card>("cards");
  const log = useCollection<LogEntry>("log");
  const mistakes = useCollection<Mistake>("mistakes");
  const [settings] = useSettings();

  return useMemo(() => {
    const topicMap = new Map(topics.items.map((x) => [x.id, x]));
    const xp = log.items.reduce((n, e) => n + e.xp, 0);
    const byDay = xpByDay(log.items);
    const today = dayKey();
    const due = cards.items.filter((c) => isDue(c, today));
    const introducedToday = cards.items.filter((c) => c.reps > 0 && c.lastAt && dayKey(c.lastAt) === today && c.lapses === 0 && c.interval <= 3).length;
    const fresh = cards.items.filter((c) => !c.due).slice(0, Math.max(0, settings.newCards - introducedToday));
    return {
      topics,
      cards,
      log,
      mistakes,
      openMistakes: mistakes.items.filter((m) => !m.resolved),
      settings,
      topicMap,
      state: (id: string) => topicMap.get(id),
      xp,
      rank: rankFor(xp),
      byDay,
      todayXp: byDay[today] ?? 0,
      streak: streak(byDay, settings.goal),
      due,
      fresh,
      learned: cards.items.filter(isLearned).length,
      loading: topics.loading || cards.loading || log.loading || mistakes.loading,
    };
  }, [topics, cards, log, mistakes, settings]);
}

export type Dev = ReturnType<typeof useDev>;

/**
 * Начислить опыт. Заодно отмечает квест дня того же вида (и той же темы, если указана).
 */
export async function award(kind: ActivityKind, xp: number, extra: Partial<LogEntry> = {}) {
  const date = dayKey();
  const topic = extra.topicId ? topicById(extra.topicId) : undefined;
  await logDb.add({ date, kind, xp, trackId: topic?.trackId, ...extra });
  try {
    const plan = await daysDb.get(date);
    if (plan) {
      const q = plan.quests.find((q) => !q.done && q.kind === kind && (!q.topicId || !extra.topicId || q.topicId === extra.topicId));
      if (q) {
        await daysDb.update(date, { quests: plan.quests.map((x) => (x === q ? { ...x, done: true } : x)) });
        toast(`Квест выполнен: ${q.title} ✨`, "success");
      }
    }
  } catch {}
}

/** Начать тему: статус «изучаю» и стартовые карточки темы в колоду. */
export async function startTopic(id: string, current?: TopicState) {
  if (!current) await topicsDb.put(id, { status: "learning", mastery: 0, lastAt: Date.now() });
  const existing = new Set((await cardsDb.list()).map((c) => c.id));
  for (let i = 0; i < SEED_CARDS.length; i++) {
    const [topicId, front, back] = SEED_CARDS[i];
    const cid = `seed-${i}`;
    if (topicId === id && !existing.has(cid)) await cardsDb.put(cid, newCard(topicId, front, back, "seed"));
  }
  // Вопросы для самопроверки из встроенных материалов тоже становятся карточками.
  for (const r of contentFor(id)?.recall ?? []) {
    const cid = hashId("rc", id + r.q);
    if (!existing.has(cid)) await cardsDb.put(cid, newCard(id, r.q, r.a, "seed"));
  }
}

export async function bumpMastery(id: string, delta: number, patch: Partial<TopicState> = {}) {
  const cur = await topicsDb.get(id);
  const mastery = Math.max(0, Math.min(100, (cur?.mastery ?? 0) + delta));
  if (!cur) await topicsDb.put(id, { status: "learning", mastery, lastAt: Date.now(), ...patch });
  else await topicsDb.update(id, { mastery, lastAt: Date.now(), ...patch });
}

/** Следующая тема трека: первая не закрытая, по порядку программы. */
export function nextTopicOf(trackId: string, map: Map<string, WithDoc<TopicState>>, level: number) {
  const list = ALL_TOPICS.filter((t) => t.trackId === trackId);
  return (
    list.find((t) => map.get(t.id)?.status === "learning") ??
    list.find((t) => !map.get(t.id) && t.level <= level) ??
    list.find((t) => map.get(t.id)?.status !== "done")
  );
}
