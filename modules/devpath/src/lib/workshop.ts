import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, db, dayKey, useCollection, type WithDoc } from "@lifehub/sdk";
import { KATAS } from "../data/workshop.ts";
import type { Kata, Mission, Stage } from "./workshop-parse.ts";
import type { BuildProject } from "../data/projects-build.ts";
import { award, bumpMastery, cardsDb, hashId } from "./store.ts";
import { newCard } from "./srs.ts";
import type { BuildState, KataState, MissionState, Run } from "./types.ts";

/*
 * Мастерская: миссии (проект в ~/DevPath/<id>, правится в IDE) и каты (код в редакторе модуля).
 * Тесты гоняет хаб (server/devpath): модуль кладёт запрос в коллекцию runs и ждёт, пока хаб допишет результат.
 */

export const runsDb = db.collection<Run>("runs");
export const missionsDb = db.collection<MissionState>("missions");
export const katasDb = db.collection<KataState>("katas");

/** dotnet test с нуля (восстановление пакетов) бывает долгим, но не бесконечным. */
const RUN_TIMEOUT_MS = 6 * 60_000;

/** Запросы к хабу: run() кладёт запрос и ждёт ответа. */
export function useRunner() {
  const runs = useCollection<Run>("runs");
  const waiting = useRef(new Map<string, (r: WithDoc<Run>) => void>());
  const latest = useRef(runs.items);
  latest.current = runs.items;
  const [pending, setPending] = useState<string | null>(null);

  const settle = useCallback((items: WithDoc<Run>[]) => {
    for (const r of items) {
      const resolve = waiting.current.get(r.id);
      if (resolve && (r.status === "done" || r.status === "error")) {
        waiting.current.delete(r.id);
        resolve(r);
      }
    }
  }, []);

  useEffect(() => settle(runs.items), [runs.items, settle]);

  const run = useCallback(
    async (req: Run): Promise<WithDoc<Run>> => {
      const doc = await runsDb.add(req);
      setPending(doc.id);
      try {
        return await new Promise<WithDoc<Run>>((resolve) => {
          waiting.current.set(doc.id, resolve);
          settle(latest.current);
          setTimeout(() => {
            if (!waiting.current.delete(doc.id)) return;
            resolve({ ...doc, status: "error", error: "Хаб не ответил. Он запущен и обновлён? Перезапусти его в настройках хаба." });
          }, RUN_TIMEOUT_MS);
        });
      } finally {
        setPending((p) => (p === doc.id ? null : p));
      }
    },
    [settle],
  );

  const current = pending ? runs.items.find((r) => r.id === pending) : undefined;
  return { run, busy: !!pending, running: current?.status === "running" };
}

/* ───────────── опыт и закрепление ───────────── */

const MISSION_XP: Record<1 | 2 | 3, number> = { 1: 120, 2: 180, 3: 260 };

/** Опыт за миссию: подсказки его уменьшают, но не до нуля — дойти самому лучше, чем бросить. */
export function missionXp(m: Mission, hints: number) {
  return Math.round(MISSION_XP[m.level] * Math.max(0.5, 1 - 0.15 * hints));
}

/** Миссия пройдена: опыт, освоение тем, вопросы «почему» — в карточки повторения. */
export async function completeMission(m: Mission, state: MissionState, quizScore: number) {
  const xp = missionXp(m, state.hints);
  await award("mission", xp, { topicId: m.topics[0], score: quizScore, note: m.id });
  for (const t of m.topics) await bumpMastery(t, 15);
  const topic = m.topics[0] ?? "csharp-types";
  for (const r of m.recall) {
    const id = hashId("mr", m.id + r.q);
    if (!(await cardsDb.get(id))) await cardsDb.put(id, newCard(topic, r.q, r.a, "seed"));
  }
  await missionsDb.update(m.id, { stage: "done", doneAt: Date.now(), quiz: quizScore });
  return xp;
}

/** Опыт за кату: первое решение — полностью, повторное — немного (мышечная память), с подглядыванием — минимум. */
export async function kataSolved(k: Kata, state: WithDoc<KataState> | null, seconds: number) {
  const first = !state?.solvedAt;
  const fast = seconds <= k.minutes * 60;
  const xp = state?.peeked && first ? 10 : first ? (fast ? 40 : 30) : fast ? 15 : 10;
  await award("kata", xp, { topicId: k.topics[0], note: k.id });
  if (first) for (const t of k.topics) await bumpMastery(t, 5);
  await katasDb.update(k.id, {
    solvedAt: Date.now(),
    best: state?.best ? Math.min(state.best, seconds) : seconds,
    startedAt: 0,
  });
  return xp;
}

/**
 * Ката дня: сначала нерешённые по порядку, потом повтор давно решённой (через неделю и больше) —
 * код руками забывается так же, как теория.
 */
export function kataOfDay(states: Map<string, KataState>, date = dayKey()): Kata | undefined {
  const fresh = KATAS.find((k) => !states.get(k.id)?.solvedAt);
  if (fresh) return fresh;
  const weekAgo = addDays(new Date(date), -7).getTime();
  return [...KATAS]
    .filter((k) => (states.get(k.id)?.solvedAt ?? 0) < weekAgo)
    .sort((a, b) => (states.get(a.id)?.solvedAt ?? 0) - (states.get(b.id)?.solvedAt ?? 0))[0];
}

export const formatSeconds = (s: number) => (s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, "0")} с`);

/* ───────────── большой проект ───────────── */

export const buildsDb = db.collection<BuildState>("builds");

/** Опыт за этап: ~50 XP за час работы, подсказки уменьшают, но не ниже 60%. */
export function stageXp(s: Stage, hints: number) {
  return Math.round(s.hours * 50 * Math.max(0.6, 1 - 0.1 * hints));
}

/** Разбор этапа пройден: опыт, освоение тем, вопросы — в карточки, открывается следующий этап. */
export async function finishStage(p: BuildProject, s: Stage, state: BuildState, quiz: number, takeaway: string) {
  const hints = state.hints[s.n] ?? 0;
  const xp = stageXp(s, hints);
  await award("build", xp, { topicId: s.topics[0], score: quiz, note: `${p.id}:${s.n}` });
  for (const t of s.topics) await bumpMastery(t, 20);
  const topic = s.topics[0] ?? "dotnet-api";
  for (const r of s.recall) {
    const id = hashId("br", `${p.id}${s.n}${r.q}`);
    if (!(await cardsDb.get(id))) await cardsDb.put(id, newCard(topic, r.q, r.a, "seed"));
  }
  await buildsDb.update(p.id, {
    finished: [...new Set([...state.finished, s.n])],
    stage: Math.max(state.stage, s.n + 1),
    quiz: { ...state.quiz, [s.n]: quiz },
    takeaways: { ...state.takeaways, [s.n]: takeaway },
  });
  return xp;
}
