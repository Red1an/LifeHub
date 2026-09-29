import { useMemo, useState, type ReactNode } from "react";
import { cn, Link } from "@lifehub/sdk";
import type { Step } from "../lib/types.ts";
import { gradeOpen, type Grade } from "../lib/ai.ts";
import { sfx } from "../lib/sfx.ts";
import { recordAnswer } from "../lib/store.ts";
import { Btn, Bar, AiError } from "./kit.tsx";
import { Md, Code, highlight } from "./Md.tsx";

export interface PlayerResult {
  correct: number;
  total: number;
  /** Досрочно проиграл (кончились жизни). */
  defeated?: boolean;
}

interface Props {
  steps: Step[];
  topicId?: string;
  /** Тема каждого шага (для смешанных тренировок); иначе — topicId. */
  topics?: (string | undefined)[];
  /** Записывать ошибки в «Работу над ошибками» (по умолчанию да). */
  trackMistakes?: boolean;
  startAt?: number;
  exit: string;
  /** Жизни (для экзамена-босса). */
  lives?: number;
  boss?: { name: string; icon: string };
  onProgress?: (index: number) => void;
  /** Ответ на вопрос с индексом шага. */
  onAnswer?: (index: number, ok: boolean) => void;
  onFinish: (r: PlayerResult) => void;
}

const shuffle = <T,>(a: T[]) => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

const isQuestion = (s: Step) => s.kind !== "explain";

export function StepPlayer({ steps, topicId, topics, trackMistakes = true, startAt = 0, exit, lives, boss, onProgress, onAnswer, onFinish }: Props) {
  const [first] = useState(Math.max(0, Math.min(startAt, steps.length - 1)));
  const [i, setI] = useState(first);
  const [result, setResult] = useState<{ ok: boolean; extra?: ReactNode } | null>(null);
  const [correct, setCorrect] = useState(0);
  const [combo, setCombo] = useState(0);
  const [hearts, setHearts] = useState(lives ?? 0);
  const [shaking, setShaking] = useState(false);
  const step = steps[i];
  // При продолжении урока с середины считаем только вопросы этой сессии.
  const questions = steps.slice(first).filter(isQuestion).length;
  const answeredQuestions = steps.slice(first, i).filter(isQuestion).length + (result && isQuestion(step) ? 1 : 0);

  const checked = (ok: boolean, extra?: ReactNode) => {
    setResult({ ok, extra });
    if (!isQuestion(step)) return;
    onAnswer?.(i, ok);
    if (trackMistakes && step.kind !== "open") void recordAnswer(step, ok, topics?.[i] ?? topicId).catch(() => {});
    if (ok) {
      sfx.right();
      setCorrect((c) => c + 1);
      setCombo((c) => c + 1);
      if (boss) sfx.hit();
    } else {
      sfx.wrong();
      setCombo(0);
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
      if (lives) setHearts((h) => h - 1);
    }
  };

  const next = () => {
    const total = questions;
    const nowCorrect = correct;
    if (lives && hearts <= 0) {
      onFinish({ correct: nowCorrect, total, defeated: true });
      return;
    }
    if (i + 1 >= steps.length) {
      onFinish({ correct: nowCorrect, total });
      return;
    }
    setResult(null);
    setI(i + 1);
    onProgress?.(i + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const bossHp = boss ? 1 - correct / Math.max(1, questions) : 0;

  return (
    <div className="flex min-h-[calc(100dvh-120px)] flex-col">
      {/* Верхняя полоса */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-[var(--dp-bg)]/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Link to={exit} className="text-2xl text-[var(--dp-muted)] hover:text-white" aria-label="Выйти">
          ✕
        </Link>
        <div className="flex flex-1 gap-1">
          {steps.map((s, k) => (
            <div
              key={k}
              className="h-2.5 flex-1 rounded-full transition-all"
              style={{ background: k < i || (k === i && result) ? (isQuestion(s) ? "var(--dp-green)" : "var(--dp-violet)") : k === i ? "#3b4775" : "#1b2440" }}
            />
          ))}
        </div>
        {combo >= 2 && (
          <div key={combo} className="dp-pop whitespace-nowrap text-sm font-extrabold text-[var(--dp-gold)]">
            <span className="dp-flame">🔥</span> x{combo}
          </div>
        )}
        {lives !== undefined && (
          <div className="whitespace-nowrap text-sm">{Array.from({ length: lives }, (_, k) => (k < hearts ? "❤️" : "🖤")).join("")}</div>
        )}
      </div>

      {boss && (
        <div className="mb-4 flex items-center gap-3">
          <div key={correct} className={cn("text-5xl", correct > 0 && "dp-shake")}>{boss.icon}</div>
          <div className="flex-1">
            <div className="mb-1 flex justify-between text-xs font-semibold text-[var(--dp-muted)]">
              <span>{boss.name}</span>
              <span>HP {Math.round(bossHp * 100)}%</span>
            </div>
            <Bar value={bossHp} color="linear-gradient(90deg,#f43f5e,#fb923c)" height={12} />
          </div>
        </div>
      )}

      <div key={i} className={cn("flex-1", shaking ? "dp-shake" : !result && "dp-slide")}>
        <StepView key={i} step={step} topicId={topicId} locked={!!result} onChecked={checked} onNext={next} />
      </div>

      {result && isQuestion(step) && (
        <div
          className={cn(
            "dp-slide sticky bottom-0 -mx-4 mt-6 border-t-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:-mx-6 sm:rounded-b-2xl sm:px-6",
            result.ok ? "border-[var(--dp-green)] bg-[#0b2a20]" : "border-[var(--dp-red)] bg-[#2a0f16]",
          )}
        >
          <div className={cn("text-lg font-extrabold", result.ok ? "text-[var(--dp-green)]" : "text-[var(--dp-red)]")}>
            {result.ok ? pick(["Отлично!", "В точку!", "Верно!", "Так держать!", "Сильно!"]) : pick(["Не совсем", "Мимо", "Почти", "Разберёмся"])}
          </div>
          <div className="mt-2 max-h-[40vh] overflow-y-auto text-sm">{result.extra}</div>
          <Btn tone={result.ok ? "green" : "red"} block className="mt-3" onClick={next}>
            {lives && hearts <= 0 ? "Завершить" : i + 1 >= steps.length ? "Завершить" : "Дальше"}
          </Btn>
        </div>
      )}

      <div className="mt-3 text-center text-xs text-[var(--dp-muted)]">
        {answeredQuestions}/{questions} заданий · верно {correct}
      </div>
    </div>
  );
}

const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

function StepView({ step, topicId, locked, onChecked, onNext }: { step: Step; topicId?: string; locked: boolean; onChecked: (ok: boolean, extra?: ReactNode) => void; onNext: () => void }) {
  switch (step.kind) {
    case "explain":
      return (
        <div>
          <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--dp-cyan)]">Объяснение</div>
          <h2 className="mb-3 text-2xl font-extrabold">{step.title}</h2>
          <Md text={step.md} className="text-[15px]" />
          <Btn block className="mt-6" onClick={onNext}>
            Понятно →
          </Btn>
        </div>
      );
    case "choice":
      return <ChoiceStep step={step} locked={locked} onChecked={onChecked} />;
    case "order":
      return <OrderStep step={step} locked={locked} onChecked={onChecked} />;
    case "bug":
      return <BugStep step={step} locked={locked} onChecked={onChecked} />;
    case "open":
      return <OpenStep step={step} topicId={topicId} locked={locked} onChecked={onChecked} />;
    case "recall":
      return <RecallStep step={step} locked={locked} onChecked={onChecked} />;
  }
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--dp-violet)]">{children}</div>;
}

function ChoiceStep({ step, locked, onChecked }: { step: Extract<Step, { kind: "choice" }>; locked: boolean; onChecked: (ok: boolean, extra?: ReactNode) => void }) {
  // Варианты перемешиваются при каждом показе: позиция верного ответа не должна подсказывать.
  const order = useMemo(() => shuffle(step.options.map((_, k) => k)), [step]);
  const [sel, setSel] = useState<number | null>(null);
  const check = () => {
    if (sel === null) return;
    onChecked(sel === step.correct, <Md text={step.why} />);
  };
  return (
    <div>
      <Label>Выбери ответ</Label>
      <Md text={step.question} className="text-lg font-semibold" />
      {step.code && <Code code={step.code} className="mt-3" />}
      <div className="mt-4 flex flex-col gap-2.5">
        {order.map((k, pos) => {
          const o = step.options[k];
          const state = locked ? (k === step.correct ? "right" : k === sel ? "wrong" : undefined) : k === sel ? "selected" : undefined;
          return (
            <button key={k} className="dp-option flex items-start gap-3" data-state={state} disabled={locked} onClick={() => { setSel(k); sfx.tap(); }}>
              <span className="dp-mono grid size-7 shrink-0 place-items-center rounded-lg bg-[#0b1020] text-xs font-bold text-[var(--dp-muted)]">{"ABCDEF"[pos]}</span>
              <Md text={o} className="min-w-0 flex-1 [&_p]:m-0" />
            </button>
          );
        })}
      </div>
      {!locked && (
        <Btn block className="mt-5" disabled={sel === null} onClick={check}>
          Проверить
        </Btn>
      )}
    </div>
  );
}

function OrderStep({ step, locked, onChecked }: { step: Extract<Step, { kind: "order" }>; locked: boolean; onChecked: (ok: boolean, extra?: ReactNode) => void }) {
  const pool = useMemo(() => {
    let s = shuffle(step.options.map((_, k) => k));
    if (s.every((v, k) => v === k) && s.length > 1) s = [...s.slice(1), s[0]];
    return s;
  }, [step]);
  const [picked, setPicked] = useState<number[]>([]);
  const check = () => {
    const ok = picked.every((v, k) => v === k);
    onChecked(
      ok,
      <div>
        {!ok && (
          <ol className="mb-2 list-decimal pl-5">
            {step.options.map((o, k) => <li key={k}>{o}</li>)}
          </ol>
        )}
        <Md text={step.why} />
      </div>,
    );
  };
  return (
    <div>
      <Label>Расставь по порядку</Label>
      <Md text={step.question} className="text-lg font-semibold" />
      <div className="mt-4 min-h-24 space-y-2 rounded-2xl border-2 border-dashed border-[var(--dp-line)] p-2">
        {picked.length === 0 && <div className="p-3 text-center text-sm text-[var(--dp-muted)]">Нажимай на элементы ниже в правильном порядке</div>}
        {picked.map((v, k) => (
          <button
            key={v}
            disabled={locked}
            className="dp-option dp-pop flex items-center gap-3 !py-2.5"
            data-state={locked ? (v === k ? "right" : "wrong") : "selected"}
            onClick={() => setPicked(picked.filter((x) => x !== v))}
          >
            <span className="dp-mono text-xs font-bold text-[var(--dp-muted)]">{k + 1}</span>
            <span className="text-sm">{step.options[v]}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {pool.filter((v) => !picked.includes(v)).map((v) => (
          <button key={v} disabled={locked} className="dp-option !w-auto !py-2 text-sm" onClick={() => { setPicked([...picked, v]); sfx.tap(); }}>
            {step.options[v]}
          </button>
        ))}
      </div>
      {!locked && (
        <Btn block className="mt-5" disabled={picked.length !== step.options.length} onClick={check}>
          Проверить
        </Btn>
      )}
    </div>
  );
}

export function BugStep({ step, locked, onChecked }: { step: Extract<Step, { kind: "bug" }>; locked: boolean; onChecked: (ok: boolean, extra?: ReactNode) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const htmlLines = useMemo(() => {
    const html = highlight(step.lines.join("\n"), "csharp");
    return splitHtmlLines(html);
  }, [step]);
  const check = () => {
    if (sel === null) return;
    onChecked(
      sel === step.bugLine,
      <div>
        <div className="mb-1 font-semibold">Ошибка в строке {step.bugLine + 1}</div>
        <Md text={step.why} />
        {step.fix && (
          <>
            <div className="mb-1 mt-2 font-semibold">Как исправить</div>
            <Code code={step.fix} />
          </>
        )}
      </div>,
    );
  };
  return (
    <div>
      <Label>🐞 Найди баг</Label>
      <Md text={step.question} className="font-semibold" />
      <div className="dp-code mt-4 py-2">
        {htmlLines.map((h, k) => {
          const state = locked ? (k === step.bugLine ? "right" : k === sel ? "wrong" : undefined) : k === sel ? "selected" : undefined;
          return (
            <div key={k} className="dp-codeline" data-state={state} onClick={() => { if (!locked) { setSel(k); sfx.tap(); } }}>
              <span className="dp-lineno">{k + 1}</span>
              <span dangerouslySetInnerHTML={{ __html: h || " " }} />
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-[var(--dp-muted)]">Нажми на строку, где спрятана ошибка</div>
      {!locked && (
        <Btn block className="mt-5" disabled={sel === null} onClick={check}>
          Проверить
        </Btn>
      )}
    </div>
  );
}

/** Делит подсвеченный HTML на строки, закрывая и переоткрывая span-ы на переносах. */
function splitHtmlLines(html: string) {
  const out: string[] = [];
  const open: string[] = [];
  let cur = "";
  const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) { open.push(m[1]); cur += m[1]; }
    else if (m[2]) { open.pop(); cur += m[2]; }
    else if (m[3]) { cur += "</span>".repeat(open.length); out.push(cur); cur = open.join(""); }
    else cur += m[4];
  }
  out.push(cur);
  return out;
}

function OpenStep({ step, topicId, locked, onChecked }: { step: Extract<Step, { kind: "open" }>; topicId?: string; locked: boolean; onChecked: (ok: boolean, extra?: ReactNode) => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const check = async (text: string) => {
    setBusy(true);
    setError(null);
    try {
      const g = await gradeOpen(step.question, text || "(ученик не знает ответа)", topicId);
      onChecked(g.score >= 6, <GradeView g={g} />);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Label>✍️ Объясни своими словами</Label>
      <Md text={step.question} className="text-lg font-semibold" />
      {step.hint && (
        <button className="mt-2 text-sm text-[var(--dp-cyan)]" onClick={() => setShowHint(!showHint)}>
          {showHint ? step.hint : "💡 Подсказка"}
        </button>
      )}
      <textarea
        className="dp-editor mt-4 !min-h-40 !font-[Inter] !text-[15px]"
        placeholder="Как бы ты объяснил это коллеге на собеседовании…"
        value={answer}
        disabled={locked}
        onChange={(e) => setAnswer(e.target.value)}
      />
      {error && <div className="mt-3"><AiError error={error} /></div>}
      {!locked && (
        <div className="mt-4 flex gap-2">
          <Btn tone="ghost" onClick={() => check("")} loading={busy && !answer} disabled={busy}>
            Не знаю
          </Btn>
          <Btn className="flex-1" disabled={answer.trim().length < 10 || busy} loading={busy && !!answer} onClick={() => check(answer)}>
            {busy ? "Нейронка проверяет…" : "Проверить"}
          </Btn>
        </div>
      )}
    </div>
  );
}

function RecallStep({ step, locked, onChecked }: { step: Extract<Step, { kind: "recall" }>; locked: boolean; onChecked: (ok: boolean, extra?: ReactNode) => void }) {
  const [draft, setDraft] = useState("");
  const [shown, setShown] = useState(false);
  return (
    <div>
      <Label>🧠 Вспомни сам</Label>
      <Md text={step.question} className="text-lg font-semibold" />
      <p className="mt-2 text-sm text-[var(--dp-muted)]">
        Сначала сформулируй ответ — вслух или письменно. Именно попытка вспомнить закрепляет знание (эффект тестирования).
      </p>
      <textarea
        className="dp-editor mt-3 !min-h-28 !font-[Inter] !text-[15px]"
        placeholder="Мой ответ (необязательно)…"
        value={draft}
        disabled={shown}
        onChange={(e) => setDraft(e.target.value)}
      />
      {!shown ? (
        <Btn block className="mt-4" onClick={() => { setShown(true); sfx.tap(); }}>Показать ответ</Btn>
      ) : (
        <div className="dp-slide mt-4">
          <div className="rounded-2xl border border-[var(--dp-cyan)]/30 bg-[var(--dp-cyan)]/10 p-4">
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--dp-cyan)]">Ответ</div>
            <Md text={step.answer} />
          </div>
          {!locked && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Btn tone="red" onClick={() => onChecked(false, <div>Ничего страшного — вопрос попадёт в «Работу над ошибками».</div>)}>✗ Не вспомнил</Btn>
              <Btn tone="green" onClick={() => onChecked(true, <div>Отлично, знание закрепляется.</div>)}>✓ Вспомнил</Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GradeView({ g }: { g: Grade }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="dp-mono rounded-lg bg-black/30 px-2 py-0.5 font-bold">{g.score}/10</span>
        <span className="font-semibold">{g.verdict}</span>
      </div>
      <Md text={g.feedback} />
      <details className="rounded-xl bg-black/25 p-3">
        <summary className="cursor-pointer font-semibold">Эталонный ответ</summary>
        <Md text={g.ideal} className="mt-2" />
      </details>
    </div>
  );
}
