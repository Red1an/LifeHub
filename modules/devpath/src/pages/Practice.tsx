import { useState, type KeyboardEvent } from "react";
import { Loading, useAi, useCollection, useParams, useSearchParams, formatRelative, confirm, cn } from "@lifehub/sdk";
import { topicById } from "../data/curriculum.ts";
import { contentFor } from "../lib/content.ts";
import { useSettings, award, bumpMastery, startTopic, topicsDb } from "../lib/store.ts";
import { generatePractice, REVIEWER, reviewPrompt, parseScore } from "../lib/ai.ts";
import { XP } from "../lib/game.ts";
import { sfx } from "../lib/sfx.ts";
import type { PracticeTask } from "../lib/types.ts";
import { Screen, Header, Panel, Btn, Pill, Thinking, AiError, celebrate } from "../components/kit.tsx";
import { Md } from "../components/Md.tsx";

const KINDS: { id: PracticeTask["kind"] | "auto"; label: string; icon: string }[] = [
  { id: "auto", label: "На выбор нейронки", icon: "🎲" },
  { id: "code", label: "Написать код", icon: "⌨️" },
  { id: "design", label: "Спроектировать", icon: "📐" },
  { id: "lab", label: "Лаба у себя", icon: "🧪" },
  { id: "explain", label: "Объяснить", icon: "🗣️" },
];

const KIND_LABEL: Record<PracticeTask["kind"], string> = { code: "⌨️ код", design: "📐 проектирование", lab: "🧪 лаба", explain: "🗣️ объяснение" };

/** Tab в textarea вставляет отступ, а не уводит фокус. */
export function editorKeys(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Tab") return;
  e.preventDefault();
  const el = e.currentTarget;
  const { selectionStart: s, selectionEnd: end, value } = el;
  // Через нативный сеттер, чтобы React увидел изменение управляемого поля.
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value.slice(0, s) + "    " + value.slice(end));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.selectionStart = el.selectionEnd = s + 4;
}

export function PracticePage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [settings] = useSettings();
  const tasks = useCollection<PracticeTask>("practice");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = topicById(id);
  if (!t) return <Screen><Header title="Тема не найдена" back="/map" /></Screen>;
  if (tasks.loading) return <Screen><Loading /></Screen>;

  const mine = tasks.items.filter((x) => x.topicId === id).reverse();
  const open = mine.find((x) => x.id === params.get("task"));
  if (open) return <TaskView task={open} onBack={() => setParams({ task: null })} />;

  const create = async (kind: PracticeTask["kind"] | "auto") => {
    setBusy(true);
    setError(null);
    try {
      const task = await generatePractice(id, settings, kind);
      const saved = await tasks.add(task);
      if (!(await topicsDb.get(id))) await startTopic(id);
      setParams({ task: saved.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="🛠️ Практика" subtitle={t.title} back={`/topic/${id}`} />
      {busy ? (
        <Thinking text="Придумываю задачу из реальной жизни…" />
      ) : (
        <>
          {error && <div className="mb-4"><AiError error={error} /></div>}
          <Panel className="mb-5">
            <div className="mb-3 font-bold">Новая задача</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {KINDS.map((k) => (
                <button key={k.id} className="dp-option !p-3 text-center" onClick={() => create(k.id)}>
                  <div className="text-2xl">{k.icon}</div>
                  <div className="mt-1 text-xs font-semibold">{k.label}</div>
                </button>
              ))}
            </div>
          </Panel>
        </>
      )}
      <BuiltinTask id={id} />
      {mine.length > 0 && (
        <>
          <h2 className="mb-2 font-bold">Мои задачи</h2>
          <div className="space-y-2">
            {mine.map((x) => (
              <button key={x.id} className="dp-panel flex w-full items-center gap-3 p-3 text-left" onClick={() => setParams({ task: x.id })}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{x.title}</div>
                  <div className="text-xs text-[var(--dp-muted)]">{KIND_LABEL[x.kind] ?? x.kind} · {formatRelative(x.createdAt)}</div>
                </div>
                {x.score !== undefined ? <Pill color={x.score >= 70 ? "#34d399" : x.score >= 40 ? "#fbbf24" : "#f87171"}>{x.score / 10}/10</Pill> : <Pill>не решена</Pill>}
              </button>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}

function TaskView({ task, onBack }: { task: PracticeTask & { id: string }; onBack: () => void }) {
  const tasks = useCollection<PracticeTask>("practice");
  const [answer, setAnswer] = useState(task.answer ?? "");
  const [hints, setHints] = useState(0);
  const review = useAi();
  const shown = review.text || review.loading ? review.text : task.review;

  const submit = async () => {
    const text = await review.run(reviewPrompt(task, answer), { system: REVIEWER });
    if (!text) return;
    const score = parseScore(text);
    await tasks.update(task.id, { answer, review: text, score });
    const s = score ?? 50;
    // Повторная отправка той же задачи — только небольшой бонус.
    const xp = task.score === undefined ? Math.round(XP.practice * (0.4 + (0.6 * s) / 100)) : 10;
    await award("practice", xp, { topicId: task.topicId, score: s });
    await bumpMastery(task.topicId, Math.round(s / 8));
    s >= 70 ? sfx.win() : sfx.right();
    celebrate(xp, s >= 80);
  };

  return (
    <Screen>
      <div className="mb-4 flex items-center gap-3">
        <button className="dp-btn dp-btn-ghost !min-h-10 !px-3" onClick={onBack}>←</button>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--dp-cyan)]">{KIND_LABEL[task.kind] ?? "задача"}</div>
          <h1 className="text-xl font-extrabold">{task.title}</h1>
        </div>
        <button
          className="text-sm text-[var(--dp-muted)]"
          onClick={async () => { if (await confirm("Удалить задачу?", { danger: true })) { await tasks.remove(task.id); onBack(); } }}
        >
          🗑
        </button>
      </div>

      <Panel className="mb-4">
        <Md text={task.statement} />
        {task.criteria?.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--dp-muted)]">Как будут оценивать</summary>
            <ul className="mt-2 list-disc pl-5 text-sm text-[var(--dp-muted)]">
              {task.criteria.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </details>
        )}
      </Panel>

      {task.hints?.length > 0 && (
        <div className="mb-4 space-y-2">
          {task.hints.slice(0, hints).map((h, k) => (
            <div key={k} className="dp-pop rounded-2xl border border-[var(--dp-gold)]/30 bg-[var(--dp-gold)]/10 p-3 text-sm">💡 {h}</div>
          ))}
          {hints < task.hints.length && (
            <button className="text-sm text-[var(--dp-gold)]" onClick={() => setHints(hints + 1)}>
              💡 Подсказка {hints + 1}/{task.hints.length}
            </button>
          )}
        </div>
      )}

      <textarea
        className={cn("dp-editor", task.kind !== "code" && "!font-[Inter] !text-[15px]")}
        placeholder={task.kind === "code" ? "// Твоё решение на C#" : task.kind === "lab" ? "Вставь команды, вывод терминала, файлы (Dockerfile, yaml)…" : "Твоё решение…"}
        value={answer}
        onKeyDown={task.kind === "code" || task.kind === "lab" ? editorKeys : undefined}
        onChange={(e) => setAnswer(e.target.value)}
        spellCheck={false}
      />
      <Btn block className="mt-3" loading={review.loading} disabled={answer.trim().length < 10} onClick={submit}>
        {review.loading ? "Тимлид смотрит код…" : task.review ? "Отправить исправленное на ревью" : "Отправить на ревью"}
      </Btn>
      {review.error && <div className="mt-3"><AiError error={review.error} /></div>}

      {shown && (
        <Panel className="dp-slide mt-5">
          <div className="mb-2 flex items-center gap-2 font-bold">
            👨‍💻 Ревью
            {!review.loading && parseScore(shown) !== undefined && (
              <Pill color={parseScore(shown)! >= 70 ? "#34d399" : "#fbbf24"}>{parseScore(shown)! / 10}/10</Pill>
            )}
          </div>
          <Md text={shown.replace(/^\s*ОЦЕНКА:.*$/im, "").trim()} />
        </Panel>
      )}
    </Screen>
  );
}

/** Задача из встроенной программы: решаешь у себя в IDE, проверяешь по чек-листу, по желанию — ревью нейронкой. */
function BuiltinTask({ id }: { id: string }) {
  const task = contentFor(id)?.task;
  const tasks = useCollection<PracticeTask>("practice");
  const [params, setParams] = useSearchParams();
  const [checks, setChecks] = useState<Record<number, boolean>>({});
  if (!task) return null;
  const existing = tasks.items.find((x) => x.topicId === id && x.title === task.title);
  const all = task.check.every((_, k) => checks[k]);
  const toReview = async () => {
    const saved = existing ?? (await tasks.add({ topicId: id, title: task.title, kind: "code", statement: task.md, hints: [], criteria: task.check, createdAt: Date.now() }));
    setParams({ task: saved.id });
  };
  void params;
  return (
    <Panel glow className="mb-5">
      <div className="text-xs font-bold uppercase tracking-wider text-[var(--dp-cyan)]">Задача из программы</div>
      <h2 className="mt-1 text-lg font-extrabold">{task.title}</h2>
      <Md text={task.md} className="mt-2" />
      <div className="mt-3 text-sm font-semibold">Самопроверка — реши в IDE и отметь:</div>
      <div className="mt-2 space-y-1.5">
        {task.check.map((c, k) => (
          <button
            key={k}
            onClick={() => setChecks({ ...checks, [k]: !checks[k] })}
            className={cn("flex w-full items-start gap-2 rounded-xl border p-2 text-left text-sm", checks[k] ? "border-[var(--dp-green)]/50 bg-[var(--dp-green)]/10" : "border-[var(--dp-line)]")}
          >
            <span>{checks[k] ? "✅" : "⬜"}</span>
            <span>{c}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn
          disabled={!all || existing?.score !== undefined}
          onClick={async () => {
            await tasks.add({ topicId: id, title: task.title, kind: "code", statement: task.md, hints: [], criteria: task.check, score: 80, review: "Самопроверка по чек-листу пройдена.", createdAt: Date.now() });
            await award("practice", XP.practice, { topicId: id, score: 80 });
            await bumpMastery(id, 10);
            sfx.win();
            celebrate(XP.practice, true);
          }}
        >
          ✓ Решено · +{XP.practice} XP
        </Btn>
        <Btn tone="ghost" onClick={toReview}>👨‍💻 Ревью нейронкой</Btn>
      </div>
    </Panel>
  );
}
