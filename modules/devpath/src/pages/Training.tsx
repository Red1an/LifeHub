import { useMemo, useState } from "react";
import { Link, Loading, useParams, toast, cn } from "@lifehub/sdk";
import { ALL_TOPICS, topicById, trackById } from "../data/curriculum.ts";
import { contentFor, quizOf } from "../lib/content.ts";
import { useDev, award, bumpMastery, startTopic, topicsDb } from "../lib/store.ts";
import { sfx } from "../lib/sfx.ts";
import type { Step } from "../lib/types.ts";
import { Screen, Header, Panel, Btn, Ring, Pill, celebrate } from "../components/kit.tsx";
import { StepPlayer, type PlayerResult } from "../components/StepPlayer.tsx";

const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);

function Result({ title, r, xp, children }: { title: string; r: PlayerResult; xp: number; children?: React.ReactNode }) {
  const ratio = r.total ? r.correct / r.total : 0;
  return (
    <div className="dp-pop py-8 text-center">
      <div className="text-7xl">{ratio >= 0.9 ? "🏆" : ratio >= 0.6 ? "🎯" : "💪"}</div>
      <h1 className="mt-3 text-2xl font-extrabold">{title}</h1>
      <div className="mt-5 flex justify-center gap-6">
        <Ring value={ratio} size={84} stroke={8} color="var(--dp-green)">
          <div className="text-lg">{Math.round(ratio * 100)}%</div>
        </Ring>
        <div className="flex flex-col justify-center text-left">
          <div className="text-2xl font-extrabold text-[var(--dp-gold)]">+{xp} XP</div>
          <div className="text-sm text-[var(--dp-muted)]">верно {r.correct} из {r.total}</div>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** Тест по теме: все вопросы из банка вперемешку + самопроверка. */
export function TestPage() {
  const { id = "" } = useParams();
  const t = topicById(id);
  const c = contentFor(id);
  const [run, setRun] = useState(0);
  const [done, setDone] = useState<{ r: PlayerResult; xp: number } | null>(null);
  const steps = useMemo<Step[]>(
    () => [...shuffle([...(c?.quiz ?? []), ...(c?.deepQuiz ?? [])]), ...(c?.recall ?? []).map((x) => ({ kind: "recall" as const, question: x.q, answer: x.a }))],
    [id, run],
  );
  if (!t) return <Screen><Header title="Тема не найдена" back="/map" /></Screen>;
  if (!steps.length) {
    return (
      <Screen>
        <Header title="Тест" subtitle={t.title} back={`/topic/${id}`} />
        <Panel>Для этой темы пока нет встроенных вопросов — попробуй «Вопрос» или урок от нейронки.</Panel>
      </Screen>
    );
  }
  if (done) {
    return (
      <Screen>
        <Result title={`Тест: ${t.title}`} r={done.r} xp={done.xp}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Btn onClick={() => { setDone(null); setRun(run + 1); }}>↻ Ещё раз</Btn>
            <Link to="/mistakes" className="dp-btn dp-btn-ghost">🩹 Работа над ошибками</Link>
            <Link to={`/topic/${id}`} className="dp-btn dp-btn-ghost">К теме</Link>
          </div>
        </Result>
      </Screen>
    );
  }
  return (
    <Screen>
      <StepPlayer
        key={run}
        steps={steps}
        topicId={id}
        exit={`/topic/${id}`}
        onFinish={async (r) => {
          const score = Math.round((r.correct / Math.max(1, r.total)) * 100);
          const xp = 15 + r.correct * 4;
          await award("test", xp, { topicId: id, score });
          const st = await topicsDb.get(id);
          if (!st) await startTopic(id);
          await bumpMastery(id, Math.round(score / 5), { testBest: Math.max(score, st?.testBest ?? 0) });
          const after = await topicsDb.get(id);
          if (score >= 90 && (after?.mastery ?? 0) >= 70 && after?.status !== "done") {
            await topicsDb.update(id, { status: "done" });
            toast("Тема освоена! ✓", "success");
          }
          sfx.win();
          celebrate(xp, score >= 80);
          setDone({ r, xp });
        }}
      />
    </Screen>
  );
}

/** Работа над ошибками: вопросы, на которых ошибался, пока не ответишь верно дважды. */
export function MistakesPage() {
  const dev = useDev();
  const [run, setRun] = useState(0);
  const [done, setDone] = useState<{ r: PlayerResult; xp: number } | null>(null);
  const batch = useMemo(() => [...dev.openMistakes].sort((a, b) => a.lastAt - b.lastAt).slice(0, 10), [dev.loading, run]);
  if (dev.loading) return <Screen><Loading /></Screen>;
  if (done) {
    return (
      <Screen>
        <Result title="Работа над ошибками" r={done.r} xp={done.xp}>
          <p className="mb-4 text-sm text-[var(--dp-muted)]">Вопрос считается исправленным после двух верных ответов. Осталось: {dev.openMistakes.length}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {dev.openMistakes.length > 0 && <Btn onClick={() => { setDone(null); setRun(run + 1); }}>Ещё подход</Btn>}
            <Link to="/" className="dp-btn dp-btn-ghost">К заданиям дня</Link>
          </div>
        </Result>
      </Screen>
    );
  }
  if (!batch.length) {
    return (
      <Screen>
        <Header title="🩹 Работа над ошибками" back="/" />
        <Panel className="py-8 text-center">
          <div className="text-6xl">✨</div>
          <div className="mt-2 font-bold">Ошибок нет</div>
          <div className="mt-1 text-sm text-[var(--dp-muted)]">Каждый неверный ответ в уроках и тестах попадает сюда — и возвращается, пока ты его не исправишь.</div>
        </Panel>
      </Screen>
    );
  }
  return (
    <Screen>
      <StepPlayer
        key={run}
        steps={batch.map((m) => m.step)}
        topics={batch.map((m) => m.topicId)}
        exit="/"
        onFinish={async (r) => {
          const xp = 10 + r.correct * 3;
          await award("mistakes", xp, { score: Math.round((r.correct / Math.max(1, r.total)) * 100) });
          sfx.win();
          celebrate(xp);
          setDone({ r, xp });
        }}
      />
    </Screen>
  );
}

/** Смешанная тренировка: вопросы из разных изученных тем вперемешку (interleaving). */
export function MixedPage() {
  const dev = useDev();
  const [run, setRun] = useState(0);
  const [done, setDone] = useState<{ r: PlayerResult; xp: number } | null>(null);
  const items = useMemo(() => {
    const started = ALL_TOPICS.filter((t) => dev.state(t.id)).map((t) => t.id);
    return shuffle(quizOf(started)).slice(0, 10);
  }, [dev.loading, run]);
  if (dev.loading) return <Screen><Loading /></Screen>;
  if (done) {
    return (
      <Screen>
        <Result title="Смешанная тренировка" r={done.r} xp={done.xp}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Btn onClick={() => { setDone(null); setRun(run + 1); }}>↻ Ещё 10 вопросов</Btn>
            <Link to="/" className="dp-btn dp-btn-ghost">К заданиям дня</Link>
          </div>
        </Result>
      </Screen>
    );
  }
  if (items.length < 4) {
    return (
      <Screen>
        <Header title="🔀 Смешанная тренировка" back="/arena" />
        <Panel className="text-center">
          <div className="text-5xl">📚</div>
          <div className="mt-2 font-semibold">Начни хотя бы пару тем</div>
          <div className="mt-1 text-sm text-[var(--dp-muted)]">Тренировка перемешивает вопросы из тем, которые ты уже изучаешь.</div>
          <Link to="/map" className="dp-btn dp-btn-primary mt-4">На карту</Link>
        </Panel>
      </Screen>
    );
  }
  return (
    <Screen>
      <StepPlayer
        key={run}
        steps={items.map((x) => x.step)}
        topics={items.map((x) => x.id)}
        exit="/arena"
        onFinish={async (r) => {
          const xp = 15 + r.correct * 4;
          await award("mixed", xp, { score: Math.round((r.correct / Math.max(1, r.total)) * 100) });
          sfx.win();
          celebrate(xp, r.correct === r.total);
          setDone({ r, xp });
        }}
      />
    </Screen>
  );
}

/** Входная диагностика трека: по два вопроса на тему, чтобы не учить то, что уже знаешь. */
export function PlacementPage() {
  const { id = "" } = useParams();
  const dev = useDev();
  const tr = trackById(id);
  const [answers, setAnswers] = useState<Record<string, { ok: number; total: number }>>({});
  const [phase, setPhase] = useState<"intro" | "play" | "result">("intro");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const items = useMemo(
    () => (tr ? tr.topics.flatMap((t) => shuffle([...(contentFor(t.id)?.quiz ?? []), ...(contentFor(t.id)?.deepQuiz ?? [])]).slice(0, 2).map((step) => ({ id: t.id, step }))) : []),
    [id],
  );
  if (!tr) return <Screen><Header title="Трек не найден" back="/map" /></Screen>;
  if (dev.loading) return <Screen><Loading /></Screen>;

  if (phase === "intro") {
    return (
      <Screen>
        <Header title="🧭 Входной тест" subtitle={`${tr.icon} ${tr.title}`} back={`/track/${id}`} />
        <Panel glow className="text-center">
          <div className="text-6xl">🧭</div>
          <p className="mx-auto mt-3 max-w-md text-sm text-[var(--dp-muted)]">
            По 2 вопроса на каждую тему трека ({items.length} вопросов). Темы, где ответишь на всё верно, можно сразу отметить как изученные
            и не тратить время на то, что уже знаешь.
          </p>
          <Btn className="mt-5" disabled={!items.length} onClick={() => setPhase("play")}>Начать</Btn>
        </Panel>
      </Screen>
    );
  }

  if (phase === "result") {
    const known = tr.topics.filter((t) => answers[t.id] && answers[t.id].ok === answers[t.id].total);
    return (
      <Screen>
        <Header title="Результат диагностики" subtitle={tr.title} back={`/track/${id}`} />
        <Panel className="mb-4">
          <div className="mb-3 text-sm text-[var(--dp-muted)]">Отметь темы, которые можно считать изученными (предвыбраны те, где всё верно):</div>
          <div className="space-y-2">
            {tr.topics.map((t) => {
              const a = answers[t.id];
              const on = chosen.has(t.id);
              return (
                <button
                  key={t.id}
                  className={cn("flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition", on ? "border-[var(--dp-green)] bg-[var(--dp-green)]/10" : "border-[var(--dp-line)]")}
                  onClick={() => { const n = new Set(chosen); on ? n.delete(t.id) : n.add(t.id); setChosen(n); }}
                >
                  <span className="text-lg">{on ? "✅" : "⬜"}</span>
                  <span className="flex-1 text-sm font-semibold">{t.title}</span>
                  {a ? <Pill color={a.ok === a.total ? "#34d399" : a.ok ? "#fbbf24" : "#f87171"}>{a.ok}/{a.total}</Pill> : <Pill>нет вопросов</Pill>}
                </button>
              );
            })}
          </div>
          <Btn
            block
            className="mt-4"
            onClick={async () => {
              for (const tid of chosen) {
                await startTopic(tid, dev.state(tid));
                await topicsDb.update(tid, { status: "done", mastery: Math.max(70, dev.state(tid)?.mastery ?? 0) });
              }
              toast(`Отмечено тем: ${chosen.size}`, "success");
              setPhase("intro");
            }}
          >
            Сохранить ({chosen.size})
          </Btn>
          <div className="mt-2 text-center text-xs text-[var(--dp-muted)]">Известных тем по тесту: {known.length} из {tr.topics.length}</div>
        </Panel>
      </Screen>
    );
  }

  return (
    <Screen>
      <StepPlayer
        steps={items.map((x) => x.step)}
        topics={items.map((x) => x.id)}
        trackMistakes={false}
        exit={`/track/${id}`}
        onFinish={async () => {
          await award("placement", 30, { trackId: id });
          const known = tr.topics.filter((t) => answers[t.id] && answers[t.id].ok === answers[t.id].total).map((t) => t.id);
          setChosen(new Set(known));
          setPhase("result");
        }}
        onAnswer={(k, ok) => {
          const tid = items[k].id;
          setAnswers((a) => ({ ...a, [tid]: { ok: (a[tid]?.ok ?? 0) + (ok ? 1 : 0), total: (a[tid]?.total ?? 0) + 1 } }));
        }}
      />
    </Screen>
  );
}
