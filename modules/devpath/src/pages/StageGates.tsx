import { useState } from "react";
import { ai, cn, toast, useAi, type WithDoc } from "@lifehub/sdk";
import type { BuildProject } from "../data/projects-build.ts";
import { buildsDb, useRunner } from "../lib/workshop.ts";
import { ARCHITECT, PASS_SCORE, STAGE_REVIEWER, defenseSystem, designReviewPrompt, parseScore, stageReviewPrompt, type StageContext } from "../lib/ai.ts";
import type { Stage } from "../lib/workshop-parse.ts";
import type { BuildState, ChatMsg } from "../lib/types.ts";
import { sfx } from "../lib/sfx.ts";
import { Panel, Btn, Pill, AiError, celebrate } from "../components/kit.tsx";
import { Md } from "../components/Md.tsx";

/*
 * Шаги этапа после «план → код»: тесты → обязательное ревью → защита → разбор.
 * Открытые этапы перед кодом проходят ещё приём дизайн-документа архитектором.
 */

export type StepId = "design" | "code" | "review" | "defense" | "debrief";

const STEPS: { id: StepId; label: string }[] = [
  { id: "design", label: "План" },
  { id: "code", label: "Код и тесты" },
  { id: "review", label: "Ревью" },
  { id: "defense", label: "Защита" },
  { id: "debrief", label: "Разбор" },
];

export function StageSteps({ current }: { current: StepId }) {
  const at = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="mb-4 flex gap-1">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex-1">
          <div className={cn("h-1.5 rounded-full", i < at ? "bg-[var(--dp-green)]" : i === at ? "bg-[var(--dp-violet)]" : "bg-[var(--dp-panel-2)]")} />
          <div className={cn("mt-1 truncate text-center text-[11px]", i === at ? "font-bold text-white" : "text-[var(--dp-muted)]")}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export const reviewPassed = (state: BuildState, n: number) => (state.reviews?.[n]?.score ?? 0) >= PASS_SCORE;
export const defensePassed = (state: BuildState, n: number) => (state.defense?.[n]?.score ?? 0) >= PASS_SCORE;
export const designPassed = (state: BuildState, n: number) => (state.designReview?.[n]?.score ?? 0) >= PASS_SCORE;

/** Контекст для нейронки: требования, план и код этапа (diff от снимка начала этапа). */
export async function stageContext(p: BuildProject, s: Stage, state: BuildState, run: ReturnType<typeof useRunner>["run"]): Promise<StageContext> {
  const d = await run({ kind: "diff", project: p.id, since: state.startCommit?.[s.n] });
  const last = state.last?.stage === s.n ? state.last : undefined;
  const tests = last ? `${last.passed}/${last.total} зелёных${last.ok ? "" : `; падают: ${last.tests.filter((t) => !t.ok).map((t) => t.name).slice(0, 8).join("; ")}`}` : "ещё не запускались";
  return { project: p.title, stage: `${s.n}. ${s.title}`, story: s.story, task: s.task, plan: state.design[s.n] ?? "", diff: d.diff ?? "", tests };
}

function Grade({ score }: { score: number }) {
  return <Pill color={score >= PASS_SCORE ? "#34d399" : score >= 5 ? "#fbbf24" : "#f87171"}>{score}/10</Pill>;
}

/* ───────────── открытый этап: дизайн-документ ───────────── */

const DOC_TEMPLATE = `## Требования
- Функциональные:
- Нефункциональные (нагрузка, задержки, надёжность — с числами):
- Вне рамок:

## API и контракты

## Данные

## Основные сценарии по шагам

## Отказы и как с ними живём

## Масштабирование и узкие места

## Альтернативы и почему не они

## Как поймём, что работает (метрики, логи, алерты)
`;

/** Дизайн-документ до кода: архитектор принимает с оценкой ≥ 7. onAccepted — начать этап. */
export function DesignDoc({ p, s, state, onAccepted, busy }: { p: BuildProject; s: Stage; state?: WithDoc<BuildState>; onAccepted: (doc: string) => Promise<void>; busy: boolean }) {
  const [doc, setDoc] = useState(state?.design[s.n] || DOC_TEMPLATE);
  const review = useAi();
  const graded = state?.designReview?.[s.n];
  const shown = review.text || graded?.text;
  const score = review.text ? parseScore(review.text) : graded ? graded.score * 10 : undefined;
  const ok = score !== undefined && score / 10 >= PASS_SCORE;

  const send = async () => {
    const text = await review.run(designReviewPrompt({ project: p.title, stage: `${s.n}. ${s.title}`, story: s.story, brief: s.design, doc }), { system: ARCHITECT });
    if (!text) return;
    const sc = Math.round((parseScore(text) ?? 0) / 10);
    if (state) await buildsDb.update(p.id, { design: { ...state.design, [s.n]: doc }, designReview: { ...state.designReview, [s.n]: { score: sc, text, at: Date.now() } } });
    sc >= PASS_SCORE ? sfx.win() : sfx.wrong();
  };

  return (
    <Panel glow className="mb-4">
      <div className="font-bold">🏛️ Дизайн-документ — проектируешь сам</div>
      <div className="mt-1 text-sm"><Md text={s.design} /></div>
      <div className="mt-2 text-xs text-[var(--dp-muted)]">
        Контракта нет: API, данные и устройство — твои решения. Архитектор примет документ при оценке от {PASS_SCORE}/10, после этого — код.
        Тесты хаба проверят только поведение снаружи.
      </div>
      <textarea className="dp-input dp-mono mt-3 min-h-[420px] text-[13px]" value={doc} onChange={(e) => setDoc(e.target.value)} />
      <Btn tone="ghost" className="mt-3" block loading={review.loading} disabled={doc.trim().length < 400} onClick={send}>
        Отправить архитектору
      </Btn>
      {review.error && <div className="mt-3"><AiError error={review.error} /></div>}
      {shown && (
        <div className="mt-3 rounded-2xl bg-[var(--dp-panel-2)] p-3 text-sm">
          {score !== undefined && <div className="mb-2"><Grade score={Math.round(score / 10)} /></div>}
          <Md text={shown} />
        </div>
      )}
      {ok && (
        <Btn className="mt-3" block loading={busy} onClick={() => onAccepted(doc)}>
          Дизайн принят — начать разработку
        </Btn>
      )}
    </Panel>
  );
}

/* ───────────── обязательное ревью ───────────── */

export function ReviewGate({ p, s, state }: { p: BuildProject; s: Stage; state: WithDoc<BuildState> }) {
  const { run } = useRunner();
  const review = useAi();
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const graded = state.reviews?.[s.n];
  const shown = review.text || graded?.text;

  const send = async () => {
    setError(null);
    // Ревью — только кода, который проходит тесты: сначала проверка.
    setStep("Проверяю тесты…");
    const r = await run({ kind: "check", project: p.id, stage: s.n });
    if (r.status === "error" || !r.result) {
      setStep(null);
      return setError(r.error ?? "Хаб не вернул результат");
    }
    if (!r.result.ok) {
      setStep(null);
      await buildsDb.update(p.id, { last: { ...r.result, at: Date.now(), stage: s.n }, passed: state.passed.filter((x) => x !== s.n) });
      return toast("Тесты снова красные — сначала почини", "error");
    }
    setStep("Собираю изменения этапа…");
    const ctx = await stageContext(p, s, { ...state, last: { ...r.result, at: Date.now(), stage: s.n } }, run);
    setStep(null);
    const text = await review.run(stageReviewPrompt(ctx), { system: STAGE_REVIEWER });
    if (!text) return;
    const sc = Math.round((parseScore(text) ?? 0) / 10);
    await buildsDb.update(p.id, { reviews: { ...state.reviews, [s.n]: { score: sc, text, at: Date.now() } } });
    if (sc >= PASS_SCORE) {
      sfx.win();
      celebrate(undefined, true);
    } else sfx.wrong();
  };

  const passed = (graded?.score ?? 0) >= PASS_SCORE;
  return (
    <Panel glow className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold">👀 Обязательное код-ревью</div>
        {graded && <Grade score={graded.score} />}
      </div>
      <div className="mt-1 text-sm text-[var(--dp-muted)]">
        Тесты зелёные — теперь тимлид смотрит, можно ли это мержить: устройство кода, крайние случаи, читаемость, надёжность.
        Проходной балл — {PASS_SCORE}/10. Не прошёл — исправь «обязательные» замечания и отправь снова.
      </div>
      {shown && <div className="mt-3 rounded-2xl bg-[var(--dp-panel-2)] p-3 text-sm"><Md text={shown} /></div>}
      {error && <div className="mt-3 text-sm text-[var(--dp-red)]">{error}</div>}
      {review.error && <div className="mt-3"><AiError error={review.error} /></div>}
      {!passed && (
        <Btn className="mt-3" block loading={!!step || review.loading} onClick={send}>
          {step ?? (review.loading ? "Тимлид читает код…" : graded ? "Исправил — отправить снова" : "Отправить на ревью")}
        </Btn>
      )}
    </Panel>
  );
}

/* ───────────── защита ───────────── */

const OPENING = "Я готов к защите этапа. Начинай.";

export function DefenseGate({ p, s, state }: { p: BuildProject; s: Stage; state: WithDoc<BuildState> }) {
  const { run } = useRunner();
  const saved = state.defense?.[s.n];
  const [messages, setMessages] = useState<ChatMsg[]>(saved?.messages ?? []);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [system, setSystem] = useState<string | null>(null);
  const score = saved?.score;
  const answers = Math.max(0, messages.filter((m) => m.role === "user").length - 1);

  const ask = async (next: ChatMsg[]) => {
    setBusy(true);
    setError(null);
    try {
      let sys = system;
      if (!sys) {
        sys = defenseSystem(await stageContext(p, s, state, run));
        setSystem(sys);
      }
      const reply = await ai.chat(next, { system: sys });
      const all: ChatMsg[] = [...next, { role: "assistant", content: reply }];
      setMessages(all);
      const parsed = parseScore(reply);
      const sc = parsed === undefined ? undefined : Math.round(parsed / 10);
      await buildsDb.update(p.id, { defense: { ...state.defense, [s.n]: { messages: all, score: sc, at: Date.now() } } });
      if (sc !== undefined) {
        if (sc >= PASS_SCORE) {
          sfx.win();
          celebrate(undefined, true);
        } else sfx.wrong();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setMessages([]);
    setSystem(null);
    await buildsDb.update(p.id, { defense: { ...state.defense, [s.n]: { messages: [], at: Date.now() } } });
  };

  return (
    <Panel glow className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold">🎤 Защита этапа</div>
        {score !== undefined && <Grade score={score} />}
      </div>
      <div className="mt-1 text-sm text-[var(--dp-muted)]">
        Интервьюер задаст 5 вопросов по твоему коду и решениям — как на собеседовании. Отвечай своими словами, без подглядывания.
        Проходной балл — {PASS_SCORE}/10.
      </div>

      <div className="mt-3 space-y-2">
        {messages.slice(1).map((m, i) => (
          <div key={i} className={cn("rounded-2xl p-3 text-sm", m.role === "assistant" ? "bg-[var(--dp-panel-2)]" : "ml-6 bg-[var(--dp-violet)]/15")}>
            <Md text={m.content} />
          </div>
        ))}
      </div>
      {error && <div className="mt-3"><AiError error={error} /></div>}

      {messages.length === 0 ? (
        <Btn className="mt-3" block loading={busy} onClick={() => ask([{ role: "user", content: OPENING }])}>Начать защиту</Btn>
      ) : score === undefined ? (
        <>
          <div className="mt-3 text-xs text-[var(--dp-muted)]">Ответов: {answers} из 5</div>
          <textarea className="dp-input mt-1 min-h-28" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Твой ответ…" />
          <Btn
            className="mt-2"
            block
            loading={busy}
            disabled={answer.trim().length < 10}
            onClick={async () => {
              const next: ChatMsg[] = [...messages, { role: "user", content: answer.trim() }];
              setAnswer("");
              setMessages(next);
              await ask(next);
            }}
          >
            Ответить
          </Btn>
        </>
      ) : score < PASS_SCORE ? (
        <Btn tone="ghost" className="mt-3" block onClick={restart}>Подтянуть темы и пройти защиту заново</Btn>
      ) : null}
    </Panel>
  );
}
