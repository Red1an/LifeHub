import { useMemo, useRef, useState } from "react";
import { Link, Loading, useAi, cn } from "@lifehub/sdk";
import { topicById, trackById } from "../data/curriculum.ts";
import { useDev, cardsDb, award } from "../lib/store.ts";
import { schedule, previewInterval, type Grade } from "../lib/srs.ts";
import { XP } from "../lib/game.ts";
import { sfx } from "../lib/sfx.ts";
import type { Card } from "../lib/types.ts";
import { Screen, Header, Panel, Btn, Bar, celebrate } from "../components/kit.tsx";
import { Md } from "../components/Md.tsx";

const GRADES: { g: Grade; label: string; tone: string }[] = [
  { g: 0, label: "Не помню", tone: "#f87171" },
  { g: 1, label: "Трудно", tone: "#fbbf24" },
  { g: 2, label: "Помню", tone: "#34d399" },
  { g: 3, label: "Легко", tone: "#22d3ee" },
];

export function ReviewPage() {
  const dev = useDev();
  // Очередь фиксируется при открытии, чтобы карточки не прыгали после оценки.
  const [queue, setQueue] = useState<(Card & { id: string })[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState({ done: 0, right: 0 });
  const [finished, setFinished] = useState(false);
  const explain = useAi();
  const startedAt = useRef(Date.now());

  const initial = useMemo(() => {
    if (dev.loading) return null;
    const due = [...dev.due].sort((a, b) => (a.due! < b.due! ? -1 : 1));
    return [...due, ...dev.fresh];
  }, [dev.loading]);
  const q = queue ?? initial;

  if (dev.loading || !q) return <Screen><Loading /></Screen>;

  const card = q[0];

  const finish = async (s: typeof stats) => {
    setFinished(true);
    if (s.done === 0) return;
    const xp = s.done * XP.review;
    await award("review", xp, { note: String(s.done), score: Math.round((s.right / s.done) * 100) });
    sfx.win();
    celebrate(xp, s.done >= 20);
  };

  const rate = async (g: Grade) => {
    if (!card) return;
    g === 0 ? sfx.wrong() : sfx.right();
    const patch = schedule(card, g);
    void cardsDb.update(card.id, patch);
    const rest = q.slice(1);
    // «Не помню» — показать ещё раз в конце этой же сессии.
    const nextQ = g === 0 ? [...rest, { ...card, ...patch }] : rest;
    const s = { done: stats.done + 1, right: stats.right + (g > 0 ? 1 : 0) };
    setStats(s);
    setQueue(nextQ);
    setFlipped(false);
    explain.reset();
    if (nextQ.length === 0) await finish(s);
  };

  if (finished || !card) {
    return (
      <Screen>
        <Header title="🔁 Повторение" back="/" />
        <Panel glow className="dp-pop py-10 text-center">
          <div className="text-7xl">{stats.done ? "🧠" : "🌿"}</div>
          <div className="mt-3 text-2xl font-extrabold">{stats.done ? "Память прокачана!" : "На сегодня всё повторено"}</div>
          {stats.done > 0 && (
            <div className="mt-1 text-[var(--dp-muted)]">
              {stats.done} ответов · вспомнил {Math.round((stats.right / stats.done) * 100)}% · {Math.round((Date.now() - startedAt.current) / 60000)} мин
            </div>
          )}
          {!stats.done && <div className="mt-1 text-sm text-[var(--dp-muted)]">Начни новые темы — их карточки попадут сюда. Или сгенерируй карточки из урока.</div>}
          <div className="mt-6 flex justify-center gap-2">
            <Link to="/" className="dp-btn dp-btn-primary">К заданиям</Link>
            <Link to="/blitz" className="dp-btn dp-btn-ghost">⏱️ Блиц</Link>
          </div>
        </Panel>
      </Screen>
    );
  }

  const topic = topicById(card.topicId);
  const track = topic && trackById(topic.trackId);
  const total = stats.done + q.length;

  return (
    <Screen>
      <div className="mb-4 flex items-center gap-3">
        <Link to="/" className="text-2xl text-[var(--dp-muted)]">✕</Link>
        <Bar value={stats.done / total} className="flex-1" color="linear-gradient(90deg,#8b5cf6,#22d3ee)" />
        <div className="text-sm text-[var(--dp-muted)]">{q.length}</div>
      </div>

      <button
        key={card.id + stats.done}
        onClick={() => { if (!flipped) { setFlipped(true); sfx.tap(); } }}
        className={cn("dp-panel dp-slide block min-h-[280px] w-full p-6 text-left", !flipped && "dp-glow cursor-pointer")}
      >
        <div className="mb-4 flex items-center gap-2 text-xs text-[var(--dp-muted)]">
          {track && <span>{track.icon} {topic!.title}</span>}
          {!card.due && <span className="ml-auto rounded-full bg-[var(--dp-violet)]/20 px-2 py-0.5 font-semibold text-[#c4b5fd]">новая</span>}
        </div>
        <div className="text-xl font-bold leading-snug">{card.front}</div>
        {flipped ? (
          <div className="dp-slide mt-5 border-t border-[var(--dp-line)] pt-5 text-[15px] leading-relaxed">{card.back}</div>
        ) : (
          <div className="mt-10 text-center text-sm text-[var(--dp-muted)]">Вспомни ответ и нажми, чтобы проверить</div>
        )}
      </button>

      {flipped && (
        <>
          <div className="dp-slide mt-4 grid grid-cols-4 gap-2">
            {GRADES.map(({ g, label, tone }) => (
              <button
                key={g}
                onClick={() => rate(g)}
                className="rounded-2xl border-2 px-1 py-2.5 text-center transition active:translate-y-0.5"
                style={{ borderColor: `${tone}66`, background: `${tone}14` }}
              >
                <div className="text-sm font-bold" style={{ color: tone }}>{label}</div>
                <div className="text-[11px] text-[var(--dp-muted)]">{previewInterval(card, g)}</div>
              </button>
            ))}
          </div>
          <div className="mt-4">
            {!explain.text && !explain.loading ? (
              <Btn
                tone="ghost"
                className="!min-h-9 text-sm"
                onClick={() => explain.run(`Вопрос карточки: ${card.front}\nОтвет: ${card.back}\n\nОбъясни это глубже и понятнее, с примером (код C#, если уместно). До 200 слов.`, { system: "Ты сильный инженер-преподаватель. По-русски, markdown.", model: "fast" })}
              >
                🧠 Объясни подробнее
              </Btn>
            ) : (
              <Panel className="dp-slide">
                <Md text={explain.text || "…"} />
                {explain.error && <div className="text-sm text-[var(--dp-red)]">{explain.error}</div>}
              </Panel>
            )}
          </div>
        </>
      )}
      {!flipped && (
        <Btn block className="mt-4" onClick={() => setFlipped(true)}>Показать ответ</Btn>
      )}
      <div className="mt-4 text-center">
        <button className="text-xs text-[var(--dp-muted)]" onClick={() => finish(stats)}>Закончить сейчас</button>
      </div>
    </Screen>
  );
}
