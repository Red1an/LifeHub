import { useEffect } from "react";
import { addDays, db, dayKey, kv, useCollection, useStore, type WithDoc } from "@lifehub/sdk";
import { generate, genPuzzle } from "./gen";
import { loadOnThisDay } from "./sources";
import {
  DEFAULT_PREFS, KINDS, type CardDoc, type DayDoc, type GameDoc, type Kind, type Prefs, type QuickPuzzle, type RecallDoc,
} from "./types";

/*
 * Данные модуля:
 *  - cards — карточки порции дня (id `${day}_${kind}`), генерируются при первом открытии дня;
 *  - recall — вопросы для повторения; days — события «в этот день»; games — «Угадай год»;
 *  - kv prefs — интересы и выключенные рубрики; kv quick — задачки для Фокуса.
 */

export const useCards = () => useCollection<CardDoc>("cards");
export const useRecall = () => useCollection<RecallDoc>("recall");
export const useGames = () => useCollection<GameDoc>("games");
export const usePrefs = () => {
  const [p, set, meta] = useStore<Prefs>("prefs", DEFAULT_PREFS);
  return [{ ...DEFAULT_PREFS, ...p }, set, meta] as const;
};

const cards = db.collection<CardDoc>("cards");
const recalls = db.collection<RecallDoc>("recall");
const days = db.collection<DayDoc>("days");

export const cardId = (day: string, kind: Kind, n = 1) => (n > 1 ? `${day}_${kind}_${n}` : `${day}_${kind}`);

/** Генерация, которая «зависла» (закрыли вкладку посреди запроса), — считается ошибкой. */
const STALE_MS = 4 * 60_000;
export const isStale = (c: CardDoc) => c.status === "loading" && Date.now() - c.startedAt > STALE_MS;

/** Короткое имя карточки — для «уже было», лайков и повторения. */
export function titleOf(c: CardDoc): string {
  const d = c.data as any;
  if (!d) return "";
  switch (c.kind) {
    case "history":
      return `${d.year}: ${d.title}`;
    case "fact":
      return d.teaser;
    case "quote":
      return `${d.author}: «${d.text}»`;
    case "joke":
      return `${d.topic}: ${String(d.punchline).slice(0, 60)}`;
    case "puzzle":
      return `${d.topic}: ${d.title}`;
    case "tech":
    case "concept":
      return d.name;
    case "word":
      return d.word;
    case "poem":
      return d.firstLine;
    case "art":
      return `${d.artist} — ${d.title}`;
  }
}

export function dayLabel(day: string) {
  const d = new Date(day + "T12:00:00");
  return d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
}

/* ───────────── «в этот день» ───────────── */

const dayLoads = new Map<string, Promise<DayDoc>>();

/** События дня из Википедии: грузятся один раз и хранятся в коллекции days. */
export function ensureDay(day: string): Promise<DayDoc> {
  let p = dayLoads.get(day);
  if (!p) {
    p = (async () => {
      const have = await days.get(day);
      if (have && have.events?.length) return have;
      const fresh = await loadOnThisDay(day);
      await days.put(day, fresh);
      return fresh;
    })();
    p.catch(() => dayLoads.delete(day));
    dayLoads.set(day, p);
  }
  return p;
}

/* ───────────── генерация карточек ───────────── */

const running = new Set<string>();
const queue: (() => Promise<void>)[] = [];
let active = 0;
const LIMIT = 3;

function pump() {
  while (active < LIMIT && queue.length) {
    const job = queue.shift()!;
    active++;
    job().finally(() => {
      active--;
      pump();
    });
  }
}

/** Поставить карточку в очередь на генерацию (не больше трёх запросов к нейронке одновременно). */
export function runCard(id: string, kind: Kind, day: string, all: WithDoc<CardDoc>[], prefs: Prefs, opts: { topic?: string; reroll?: boolean } = {}) {
  if (running.has(id)) return;
  running.add(id);
  const startedAt = Date.now();
  void cards.put(id, { day, kind, status: "loading", startedAt });
  queue.push(async () => {
    try {
      // Заменяемая карточка («↻ Другой») тоже считается бывшей — и не зашедшей.
      const mine = all.filter((c) => c.kind === kind && c.status === "ready").sort((a, b) => a.startedAt - b.startedAt);
      const prev = opts.reroll ? all.find((c) => c.id === id && c.status === "ready") : undefined;
      const rated = all.filter((c) => c.status === "ready" && c.reaction);
      const ctx = {
        day,
        prefs,
        used: mine.map(titleOf).filter(Boolean),
        liked: rated.filter((c) => c.reaction === 1).map(titleOf),
        disliked: [...rated.filter((c) => c.reaction === -1).map(titleOf), ...(prev ? [titleOf(prev)] : [])],
        dayDoc: kind === "history" ? await ensureDay(day) : undefined,
      };
      const { data, quick } = kind === "puzzle" && opts.topic ? await genPuzzle(ctx, opts.topic) : await generate(kind, ctx);
      await cards.put(id, { day, kind, status: "ready", startedAt, data });
      const r = (data as { recall?: { q: string; a: string } }).recall;
      if (r?.q && r?.a) {
        await recalls.put(id, { cardId: id, kind, title: titleOf({ day, kind, status: "ready", startedAt, data }), q: r.q, a: r.a, due: dayKey(addDays(new Date(day + "T12:00:00"), 1)), step: 0 });
      }
      if (quick?.length) await addQuick(quick);
    } catch (e) {
      await cards.put(id, { day, kind, status: "error", startedAt, error: (e as Error).message || "Не получилось" });
    } finally {
      running.delete(id);
    }
  });
  pump();
}

/** Порция дня: запускает генерацию недостающих карточек, когда открыт сегодняшний день. */
export function useDaily(day: string) {
  const all = useCards();
  const [prefs, , { loading: prefsLoading }] = usePrefs();
  const today = day === dayKey();
  const list = KINDS.filter((k) => !prefs.off.includes(k));
  useEffect(() => {
    if (!today || all.loading || prefsLoading) return;
    for (const k of list) {
      const id = cardId(day, k);
      if (!all.items.some((c) => c.id === id)) runCard(id, k, day, all.items, prefs);
    }
  }, [today, all.loading, prefsLoading, day, list.join(",")]);
  const mine = all.items.filter((c) => c.day === day);
  const byKind = (k: Kind) => mine.find((c) => c.id === cardId(day, k));
  return { all, prefs, kinds: today ? list : KINDS.filter((k) => byKind(k)), byKind, retry: (k: Kind) => runCard(cardId(day, k), k, day, all.items, prefs),
    reroll: (k: Kind) => runCard(cardId(day, k), k, day, all.items, prefs, { reroll: true }),
  };
}

/* ───────────── задачки для Фокуса ───────────── */

async function addQuick(items: QuickPuzzle[]) {
  const cur = await kv.get<{ items: QuickPuzzle[] }>("quick", { items: [] });
  await kv.set("quick", { items: [...(cur?.items ?? []), ...items].slice(-40), at: Date.now() });
}

/* ───────────── повторение ───────────── */

const STEPS = [1, 3, 7, 21, 60];

export function nextRecall(r: RecallDoc, remembered: boolean): Partial<RecallDoc> {
  if (!remembered) return { step: 0, due: dayKey(addDays(new Date(), 1)) };
  const step = r.step + 1;
  if (step >= STEPS.length) return { step, learned: true, due: "9999-12-31" };
  return { step, due: dayKey(addDays(new Date(), STEPS[step])) };
}

/** Вопросы к повторению — только по карточкам, которые были прочитаны. */
export function useDue() {
  const recall = useRecall();
  const cards = useCards();
  const read = new Set(cards.items.filter((c) => c.done).map((c) => c.id));
  const today = dayKey();
  const mine = recall.items.filter((r) => read.has(r.cardId));
  return {
    recall,
    due: mine.filter((r) => !r.learned && r.due <= today).sort((a, b) => a.due.localeCompare(b.due)),
    learned: mine.filter((r) => r.learned).length,
    waiting: mine.filter((r) => !r.learned && r.due > today).length,
  };
}

/** Серия дней подряд, в которые порция была хоть немного прочитана. */
export function streakOf(items: CardDoc[]): number {
  const daysDone = new Set(items.filter((c) => c.done).map((c) => c.day));
  let n = 0;
  let d = new Date();
  if (!daysDone.has(dayKey(d))) d = addDays(d, -1);
  while (daysDone.has(dayKey(d))) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}
