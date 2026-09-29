import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Loading, useNavigate, useParams, cn } from "@lifehub/sdk";
import { ALL_TOPICS, TRACKS, topicById, trackById } from "../data/curriculum.ts";
import { useDev, useSettings, award, bumpMastery, startTopic, topicsDb, type Dev } from "../lib/store.ts";
import { generateBoss, generateBug, generateQuestion } from "../lib/ai.ts";
import { XP } from "../lib/game.ts";
import { sfx } from "../lib/sfx.ts";
import type { Step } from "../lib/types.ts";
import { Screen, Header, Panel, Btn, Pill, Tile, Thinking, AiError, celebrate, Bar, Ring } from "../components/kit.tsx";
import { StepPlayer, type PlayerResult } from "../components/StepPlayer.tsx";

const BOSSES: Record<string, { name: string; icon: string }> = {
  csharp: { name: "Сборщик Мусора Gen2", icon: "🗑️" },
  dotnet: { name: "Middleware-Гидра", icon: "🐍" },
  data: { name: "Призрак N+1", icon: "👻" },
  arch: { name: "Большой Ком Грязи", icon: "🟫" },
  distributed: { name: "Византийский Генерал", icon: "⚔️" },
  devops: { name: "CrashLoopBackOff", icon: "💥" },
  cs: { name: "Экспоненциальный Змей", icon: "🐉" },
  net: { name: "Потерянный Пакет", icon: "📦" },
  ai: { name: "Галлюцинирующая Модель", icon: "🌀" },
  sysdesign: { name: "Единая Точка Отказа", icon: "🎯" },
  onec: { name: "Запрос-в-Цикле", icon: "🔄" },
  craft: { name: "Легаси без Тестов", icon: "🦖" },
  sec: { name: "Нулевой День", icon: "🕷️" },
  aidev: { name: "Галлюцинирующий Автопилот", icon: "🤖" },
};

/** Случайная тема для игр: из начатых, иначе из фокуса. */
function randomTopic(dev: Dev) {
  const started = ALL_TOPICS.filter((t) => dev.state(t.id));
  const pool = started.length ? started : ALL_TOPICS.filter((t) => dev.settings.focus.includes(t.trackId) && t.level <= dev.settings.level);
  const list = pool.length ? pool : ALL_TOPICS;
  return list[Math.floor(Math.random() * list.length)];
}

export function ArenaPage() {
  const dev = useDev();
  const nav = useNavigate();
  if (dev.loading) return <Screen><Loading /></Screen>;
  const known = dev.cards.items.length;
  return (
    <Screen>
      <Header title="⚔️ Арена" subtitle="Игры и испытания, чтобы знания стали рефлексами" />
      <div className="grid grid-cols-2 gap-3">
        <Tile to="/blitz" icon="⏱️" title="Блиц" text="60 секунд, серии x2" color="#fbbf24" badge={known < 4 ? <Pill>нужны карточки</Pill> : undefined} />
        <Tile onClick={() => nav(`/bug/${randomTopic(dev).id}`)} icon="🐞" title="Найди баг" text="Случайная тема" color="#f43f5e" />
        <Tile onClick={() => nav(`/question/${randomTopic(dev).id}`)} icon="🎤" title="Вопрос" text="С собеседования" color="#22d3ee" />
        <Tile to="/mentor?new=interview" icon="🧑‍💼" title="Собеседование" text="Пробное, с оценкой" color="#8b5cf6" />
        <Tile to="/mixed" icon="🔀" title="Смешанная" text="Вопросы из разных тем" color="#34d399" />
        <Tile
          to="/mistakes"
          icon="🩹"
          title="Ошибки"
          text="Исправь, где ошибался"
          color="#fb923c"
          badge={dev.openMistakes.length ? <Pill color="#fb923c">{dev.openMistakes.length}</Pill> : undefined}
        />
      </div>

      <Link to="/projects" className="dp-panel mt-3 flex items-center gap-3 p-4 transition hover:-translate-y-0.5">
        <div className="text-4xl">🏗️</div>
        <div className="flex-1">
          <div className="font-bold">Проекты для портфолио</div>
          <div className="text-sm text-[var(--dp-muted)]">Сервисы по этапам: от API до Kubernetes и RAG-ассистента</div>
        </div>
        <span className="text-[var(--dp-muted)]">→</span>
      </Link>

      <h2 className="mb-3 mt-7 text-lg font-bold">👹 Боссы треков</h2>
      <div className="space-y-2">
        {TRACKS.map((tr) => {
          const done = tr.topics.filter((t) => dev.state(t.id)?.status === "done").length;
          const wins = dev.log.items.filter((e) => e.kind === "boss" && e.trackId === tr.id && (e.score ?? 0) >= 80).length;
          return (
            <Link key={tr.id} to={`/boss/${tr.id}`} className="dp-panel flex items-center gap-3 p-3 transition hover:-translate-y-0.5">
              <div className="grid size-11 place-items-center rounded-2xl bg-[#2a0f16] text-2xl">{BOSSES[tr.id]?.icon ?? "👹"}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{BOSSES[tr.id]?.name ?? "Босс"}</div>
                <div className="text-xs text-[var(--dp-muted)]">{tr.icon} {tr.title} · изучено тем: {done}</div>
              </div>
              {wins > 0 ? <Pill color="#34d399">побеждён ×{wins}</Pill> : <Pill color={done >= 3 ? "#f43f5e" : undefined}>{done >= 3 ? "готов к бою" : "рано"}</Pill>}
            </Link>
          );
        })}
      </div>
    </Screen>
  );
}

/** Одиночное задание от нейронки в проигрывателе: баг или вопрос. */
function SingleChallenge({ kind }: { kind: "bug" | "question" }) {
  const { id = "" } = useParams();
  const [settings] = useSettings();
  const dev = useDev();
  const nav = useNavigate();
  const t = topicById(id);
  const [step, setStep] = useState<(Step & { title?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PlayerResult | null>(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!t) return;
    let cancelled = false;
    setStep(null);
    setError(null);
    setDone(null);
    const p = kind === "bug" ? generateBug(id, settings) : generateQuestion(id, settings).then((q) => ({ kind: "open" as const, question: q.question, hint: q.hint }));
    p.then((s) => !cancelled && setStep(s)).catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [id, n]);

  if (!t) return <Screen><Header title="Тема не найдена" back="/arena" /></Screen>;
  const title = kind === "bug" ? "🐞 Найди баг" : "🎤 Вопрос с собеседования";
  if (error) return <Screen><Header title={title} subtitle={t.title} back="/arena" /><AiError error={error} onRetry={() => setN(n + 1)} /></Screen>;
  if (!step) return <Screen><Header title={title} subtitle={t.title} back="/arena" /><Thinking text={kind === "bug" ? "Прячу баг в продакшен-код…" : "Интервьюер думает над вопросом…"} sub="10–30 секунд" /></Screen>;

  if (done) {
    return (
      <Screen>
        <div className="dp-pop py-10 text-center">
          <div className="text-7xl">{done.correct ? "🎯" : "🧐"}</div>
          <h1 className="mt-3 text-2xl font-extrabold">{done.correct ? (kind === "bug" ? "Баг пойман!" : "Хороший ответ!") : "Теперь ты знаешь, где подвох"}</h1>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Btn onClick={() => setN(n + 1)}>{kind === "bug" ? "🐞 Ещё баг" : "🎤 Ещё вопрос"}</Btn>
            <Btn tone="ghost" onClick={() => nav(`/${kind}/${randomTopic(dev).id}`)}>🎲 Другая тема</Btn>
            <Link to="/" className="dp-btn dp-btn-ghost">🎯 К заданиям дня</Link>
            <Link to={`/topic/${id}`} className="dp-btn dp-btn-ghost">📖 К теме</Link>
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      {"title" in step && step.title && <div className="mb-1 text-sm text-[var(--dp-muted)]">{t.title} · {step.title}</div>}
      <StepPlayer
        key={n}
        steps={[step]}
        topicId={id}
        exit="/arena"
        onFinish={async (r) => {
          const ok = r.correct > 0;
          const xp = kind === "bug" ? (ok ? XP.bug : 5) : ok ? XP.question : 10;
          await award(kind, xp, { topicId: id, score: ok ? 100 : 0 });
          if (!(await topicsDb.get(id))) await startTopic(id);
          await bumpMastery(id, ok ? 5 : 1);
          if (ok) sfx.win();
          celebrate(xp, ok);
          setDone(r);
        }}
      />
    </Screen>
  );
}

export const BugPage = () => <SingleChallenge kind="bug" />;
export const QuestionPage = () => <SingleChallenge kind="question" />;

export function BossPage() {
  const { id = "" } = useParams();
  const dev = useDev();
  const tr = trackById(id);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(PlayerResult & { xp: number }) | null>(null);
  if (!tr) return <Screen><Header title="Трек не найден" back="/arena" /></Screen>;
  if (dev.loading) return <Screen><Loading /></Screen>;
  const boss = BOSSES[tr.id] ?? { name: "Босс", icon: "👹" };
  const learned = tr.topics.filter((t) => dev.state(t.id));
  const pool = learned.length >= 2 ? learned : tr.topics.slice(0, 4);

  const start = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setSteps(await generateBoss(tr.id, pool, dev.settings));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <Screen><Thinking text={`${boss.name} готовится к бою…`} /></Screen>;

  if (result) {
    const ratio = result.total ? result.correct / result.total : 0;
    const win = !result.defeated && ratio >= 0.8;
    return (
      <Screen>
        <div className="dp-pop py-8 text-center">
          <div className="text-8xl">{win ? "🏆" : result.defeated ? "💀" : "⚔️"}</div>
          <h1 className="mt-3 text-3xl font-extrabold">{win ? `${boss.name} повержен!` : result.defeated ? "Жизни кончились" : "Босс выжил — но ранен"}</h1>
          <p className="mt-2 text-[var(--dp-muted)]">Верно {result.correct} из {result.total} · для победы нужно 80%</p>
          <div className="mt-2 text-2xl font-extrabold text-[var(--dp-gold)]">+{result.xp} XP</div>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Btn onClick={start}>⚔️ Реванш</Btn>
            <Link to={`/track/${tr.id}`} className="dp-btn dp-btn-ghost">К треку</Link>
          </div>
        </div>
      </Screen>
    );
  }

  if (steps) {
    return (
      <Screen>
        <StepPlayer
          steps={steps}
          exit="/arena"
          lives={3}
          boss={boss}
          onFinish={async (r) => {
            const ratio = r.total ? r.correct / r.total : 0;
            const win = !r.defeated && ratio >= 0.8;
            const xp = win ? XP.boss : 20 + r.correct * 5;
            await award("boss", xp, { trackId: tr.id, score: r.defeated ? 0 : Math.round(ratio * 100) });
            if (win) {
              sfx.win();
              for (const t of pool) await bumpMastery(t.id, 10);
            }
            celebrate(xp, win);
            setResult({ ...r, xp });
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Босс трека" subtitle={`${tr.icon} ${tr.title}`} back={`/track/${tr.id}`} />
      <Panel glow className="py-8 text-center">
        <div className="text-8xl">{boss.icon}</div>
        <div className="mt-3 text-2xl font-extrabold">{boss.name}</div>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--dp-muted)]">
          10 заданий уровня собеседования по {learned.length >= 2 ? "твоим изученным темам" : "первым темам трека"}. У тебя 3 жизни.
          Каждый верный ответ бьёт босса. Победа — 80% верных.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {pool.map((t) => <Pill key={t.id}>{t.title}</Pill>)}
        </div>
        {learned.length < 2 && <div className="mt-3 text-sm text-[var(--dp-gold)]">⚠️ Ты ещё почти не изучал этот трек — будет тяжело.</div>}
        <Btn className="mt-6" tone="red" onClick={start}>⚔️ В бой</Btn>
      </Panel>
      {error && <div className="mt-4"><AiError error={error} onRetry={start} /></div>}
    </Screen>
  );
}

/* ───────────── Блиц ───────────── */

interface BlitzQ {
  front: string;
  options: string[];
  correct: number;
}

const short = (s: string) => (s.length > 140 ? s.slice(0, 137) + "…" : s);

export function BlitzPage() {
  const dev = useDev();
  const [phase, setPhase] = useState<"ready" | "play" | "end">("ready");
  const [time, setTime] = useState(60);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [q, setQ] = useState<BlitzQ | null>(null);
  const [flash, setFlash] = useState<{ k: number; ok: boolean } | null>(null);
  const [xp, setXp] = useState(0);
  const ended = useRef(false);

  const pool = useMemo(() => {
    const learned = dev.cards.items.filter((c) => c.reps > 0);
    return learned.length >= 8 ? learned : dev.cards.items;
  }, [dev.cards.items]);

  const nextQ = () => {
    const c = pool[Math.floor(Math.random() * pool.length)];
    const sameTrack = pool.filter((x) => x.id !== c.id && topicById(x.topicId)?.trackId === topicById(c.topicId)?.trackId);
    const others = (sameTrack.length >= 3 ? sameTrack : pool.filter((x) => x.id !== c.id)).sort(() => Math.random() - 0.5).slice(0, 3);
    const options = [...others.map((o) => short(o.back)), short(c.back)].sort(() => Math.random() - 0.5);
    setQ({ front: c.front, options, correct: options.indexOf(short(c.back)) });
  };

  useEffect(() => {
    if (phase !== "play") return;
    const t = setInterval(() => setTime((x) => x - 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase === "play" && time <= 0 && !ended.current) {
      ended.current = true;
      setPhase("end");
      const gained = Math.min(40, Math.max(5, score * 2));
      setXp(gained);
      void award("blitz", gained, { score, note: String(answered) });
      sfx.win();
      celebrate(gained, score >= 15);
    }
  }, [time, phase]);

  if (dev.loading) return <Screen><Loading /></Screen>;
  if (pool.length < 4) {
    return (
      <Screen>
        <Header title="⏱️ Блиц" back="/arena" />
        <Panel className="text-center">
          <div className="text-5xl">🃏</div>
          <div className="mt-2 font-semibold">Нужно хотя бы 4 карточки</div>
          <div className="mt-1 text-sm text-[var(--dp-muted)]">Начни пару тем на карте — стартовые карточки добавятся автоматически.</div>
          <Link to="/map" className="dp-btn dp-btn-primary mt-4">На карту</Link>
        </Panel>
      </Screen>
    );
  }

  const start = () => {
    ended.current = false;
    setScore(0);
    setCombo(0);
    setAnswered(0);
    setTime(60);
    nextQ();
    setPhase("play");
  };

  const answer = (k: number) => {
    if (!q || flash) return;
    const ok = k === q.correct;
    setFlash({ k, ok });
    setAnswered((a) => a + 1);
    if (ok) {
      sfx.right();
      setScore((s) => s + (combo >= 4 ? 2 : 1));
      setCombo((c) => c + 1);
    } else {
      sfx.wrong();
      setCombo(0);
      setTime((t) => Math.max(0, t - 3));
    }
    setTimeout(() => {
      setFlash(null);
      nextQ();
    }, ok ? 350 : 900);
  };

  if (phase === "ready" || phase === "end") {
    const best = Math.max(0, ...dev.log.items.filter((e) => e.kind === "blitz").map((e) => e.score ?? 0));
    return (
      <Screen>
        <Header title="⏱️ Блиц" back="/arena" />
        <Panel glow className="py-8 text-center">
          {phase === "end" ? (
            <div className="dp-pop">
              <div className="text-7xl">{score >= best && score > 0 ? "🥇" : "⏱️"}</div>
              <div className="mt-2 text-5xl font-extrabold">{score}</div>
              <div className="text-[var(--dp-muted)]">очков · ответов {answered} · рекорд {Math.max(best, score)}</div>
              <div className="mt-2 text-xl font-bold text-[var(--dp-gold)]">+{xp} XP</div>
            </div>
          ) : (
            <>
              <div className="text-7xl">⚡</div>
              <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--dp-muted)]">
                60 секунд. Вопрос из твоих карточек — выбери верный ответ. Серия из 5 даёт двойные очки, ошибка — минус 3 секунды.
              </p>
              <div className="mt-2 text-sm">Рекорд: <b>{best}</b></div>
            </>
          )}
          <Btn className="mt-6" onClick={start}>{phase === "end" ? "Ещё раз" : "Старт!"}</Btn>
        </Panel>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="mb-4 flex items-center gap-3">
        <Ring value={time / 60} size={56} color={time <= 10 ? "var(--dp-red)" : "var(--dp-gold)"}>
          <span className="text-base">{time}</span>
        </Ring>
        <div className="flex-1">
          <Bar value={time / 60} color={time <= 10 ? "var(--dp-red)" : "var(--dp-gold)"} />
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold">{score}</div>
          {combo >= 2 && <div key={combo} className="dp-pop text-xs font-bold text-[var(--dp-gold)]">🔥 x{combo}{combo >= 4 ? " · x2" : ""}</div>}
        </div>
      </div>
      {q && (
        <div key={q.front} className="dp-slide">
          <Panel className="mb-4 text-lg font-bold">{q.front}</Panel>
          <div className="space-y-2">
            {q.options.map((o, k) => (
              <button
                key={k}
                className={cn("dp-option text-sm", flash && !flash.ok && k === flash.k && "dp-shake")}
                data-state={flash ? (k === q.correct ? "right" : k === flash.k ? "wrong" : undefined) : undefined}
                onClick={() => answer(k)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}
    </Screen>
  );
}
