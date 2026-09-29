import { useEffect, useRef, useState } from "react";
import { Link, Loading, useParams, useSearchParams, toast } from "@lifehub/sdk";
import { topicById, trackById } from "../data/curriculum.ts";
import { useDev, startTopic, topicsDb, cardsDb, award, bumpMastery } from "../lib/store.ts";
import { generateLesson, generateCards } from "../lib/ai.ts";
import { newCard } from "../lib/srs.ts";
import { XP } from "../lib/game.ts";
import { sfx } from "../lib/sfx.ts";
import { builtinLesson } from "../lib/content.ts";
import type { Lesson } from "../lib/types.ts";
import { Screen, Panel, Btn, Thinking, AiError, celebrate, Ring } from "../components/kit.tsx";
import { StepPlayer, type PlayerResult } from "../components/StepPlayer.tsx";

export function LessonPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const regen = params.get("regen") as Lesson["depth"] | null;
  const builtin = builtinLesson(id);
  // Встроенный урок — по умолчанию; урок от нейронки — ?src=ai или ?regen=…
  const useBuiltin = !!builtin && !regen && params.get("src") !== "ai";
  const dev = useDev();
  const t = topicById(id);
  const st = dev.state(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(PlayerResult & { xp: number }) | null>(null);
  const [run, setRun] = useState(0);
  const started = useRef(false);

  const generate = async (depth: Lesson["depth"]) => {
    setBusy(true);
    setError(null);
    try {
      const lesson = await generateLesson(id, dev.settings, depth);
      await startTopic(id, dev.state(id));
      await topicsDb.update(id, { lesson, lessonStep: 0, lastAt: Date.now() });
      setParams({ regen: null, src: "ai" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (regen && !dev.loading && !started.current) {
      started.current = true;
      void generate(regen);
    }
  }, [regen, dev.loading]);

  if (!t) return <Screen><Loading /></Screen>;
  if (dev.loading) return <Screen><Loading /></Screen>;
  const tr = trackById(t.trackId)!;
  const exit = `/topic/${id}`;

  if (busy) return <Screen><Thinking text={`Готовлю урок «${t.title}»…`} /></Screen>;
  if (error) return <Screen><AiError error={error} onRetry={() => generate(regen ?? "normal")} /></Screen>;

  if (result) return <Screen><LessonResult id={id} result={result} onAgain={() => { setResult(null); setRun(run + 1); }} /></Screen>;

  const lesson = useBuiltin ? { steps: builtin!, depth: "normal" as const, createdAt: 0 } : regen ? undefined : st?.lesson;
  const stepKey = useBuiltin ? "builtinStep" : "lessonStep";
  if (!lesson) {
    return (
      <Screen>
        <div className="py-6 text-center">
          <div className="text-6xl">{tr.icon}</div>
          <h1 className="mt-3 text-2xl font-extrabold">{t.title}</h1>
          <p className="mx-auto mt-2 max-w-md text-[var(--dp-muted)]">
            Нейронка соберёт интерактивный урок под твой уровень: объяснения вперемешку с вопросами, «найди баг», «расставь по порядку» и ответ своими словами.
          </p>
        </div>
        <div className="space-y-3">
          <Btn block onClick={() => generate("normal")}>⚡ Обычный урок</Btn>
          <Btn block tone="ghost" onClick={() => generate("simple")}>🐣 Попроще, с аналогиями</Btn>
          <Btn block tone="ghost" onClick={() => generate("deep")}>🦅 Глубоко, уровень senior</Btn>
        </div>
        <div className="mt-6 text-center">
          <Link to={exit} className="text-sm text-[var(--dp-muted)]">← к теме</Link>
        </div>
      </Screen>
    );
  }

  const saved = st?.[stepKey] ?? 0;
  const startAt = saved < lesson.steps.length ? saved : 0;

  return (
    <Screen>
      <StepPlayer
        key={`${useBuiltin ? "b" : lesson.createdAt}-${run}`}
        steps={lesson.steps}
        topicId={id}
        startAt={run ? 0 : startAt}
        exit={exit}
        onProgress={async (i) => {
          if (!(await topicsDb.get(id))) await startTopic(id);
          await topicsDb.update(id, { [stepKey]: i }).catch(() => {});
        }}
        onFinish={async (r) => {
          const ratio = r.total ? r.correct / r.total : 1;
          const xp = XP.lessonDone + r.correct * XP.lessonStep;
          await award("lesson", xp, { topicId: id, score: Math.round(ratio * 100) });
          await bumpMastery(id, Math.round(20 + 30 * ratio), { [stepKey]: 0 });
          const after = await topicsDb.get(id);
          if (after && (after.mastery ?? 0) >= 80 && after.status !== "done") {
            await topicsDb.update(id, { status: "done" });
            toast("Тема освоена! ✓", "success");
          }
          sfx.win();
          celebrate(xp, ratio >= 0.7);
          setResult({ ...r, xp });
        }}
      />
    </Screen>
  );
}

function LessonResult({ id, result, onAgain }: { id: string; result: PlayerResult & { xp: number }; onAgain: () => void }) {
  const dev = useDev();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  const ratio = result.total ? result.correct / result.total : 1;
  const st = dev.state(id);

  const makeCards = async () => {
    setBusy(true);
    try {
      const steps = builtinLesson(id) ?? st?.lesson?.steps ?? [];
      const material = steps.map((s) => (s.kind === "explain" ? `${s.title}\n${s.md}` : "")).join("\n\n");
      const list = await generateCards(id, material);
      for (const c of list) if (c.front && c.back) await cardsDb.add(newCard(id, c.front, c.back, "ai"));
      await award("cards", XP.cards, { topicId: id });
      setAdded(list.length);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dp-pop py-6 text-center">
      <div className="text-7xl">{ratio >= 0.9 ? "🏆" : ratio >= 0.6 ? "🎉" : "💪"}</div>
      <h1 className="mt-3 text-3xl font-extrabold">{ratio >= 0.9 ? "Блестяще!" : ratio >= 0.6 ? "Урок пройден!" : "Урок пройден — есть что подтянуть"}</h1>
      <div className="mt-6 flex justify-center gap-6">
        <Ring value={ratio} size={84} stroke={8} color="var(--dp-green)">
          <div className="text-lg">{Math.round(ratio * 100)}%</div>
        </Ring>
        <div className="flex flex-col justify-center text-left">
          <div className="text-2xl font-extrabold text-[var(--dp-gold)]">+{result.xp} XP</div>
          <div className="text-sm text-[var(--dp-muted)]">верно {result.correct} из {result.total}</div>
          <div className="text-sm text-[var(--dp-muted)]">освоение темы {st?.mastery ?? 0}%</div>
        </div>
      </div>
      <Panel className="mt-8 text-left">
        <div className="font-bold">🃏 Закрепить в памяти</div>
        <div className="mt-1 text-sm text-[var(--dp-muted)]">Нейронка сделает карточки по уроку — они будут всплывать в повторении по кривой забывания.</div>
        {added ? (
          <div className="mt-3 font-semibold text-[var(--dp-green)]">Добавлено {added} карточек ✓</div>
        ) : (
          <Btn className="mt-3" loading={busy} onClick={makeCards}>✨ Сделать карточки из урока</Btn>
        )}
      </Panel>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Link to={`/practice/${id}`} className="dp-btn dp-btn-primary">🛠️ Практика</Link>
        <Link to="/" className="dp-btn dp-btn-ghost">🎯 К заданиям дня</Link>
        <button className="dp-btn dp-btn-ghost" onClick={onAgain}>↻ Ещё раз</button>
      </div>
    </div>
  );
}
