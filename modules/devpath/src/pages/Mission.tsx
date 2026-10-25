import { useState } from "react";
import { Link, Loading, cn, confirm, dayKey, plural, toast, useAi, useCollection, useParams } from "@lifehub/sdk";
import { KIND_TITLE, LEVEL_TITLE, missionById } from "../data/workshop.ts";
import { topicById } from "../data/curriculum.ts";
import { completeMission, missionXp, missionsDb, useRunner } from "../lib/workshop.ts";
import { award } from "../lib/store.ts";
import { WORKSHOP_MENTOR, WORKSHOP_REVIEWER, missionMentorPrompt, missionReviewPrompt } from "../lib/ai.ts";
import type { Mission } from "../lib/workshop-parse.ts";
import type { MissionState } from "../lib/types.ts";
import type { WithDoc } from "@lifehub/sdk";
import { sfx } from "../lib/sfx.ts";
import { Screen, Header, Panel, Btn, Pill, AiError, celebrate } from "../components/kit.tsx";
import { Md } from "../components/Md.tsx";
import { Videos } from "../components/Videos.tsx";
import { StepPlayer } from "../components/StepPlayer.tsx";
import { RunView } from "../components/RunView.tsx";

export function MissionPage() {
  const { id = "" } = useParams();
  const m = missionById(id);
  const missions = useCollection<MissionState>("missions");
  if (!m) return <Screen><Header title="Миссия не найдена" back="/train" /></Screen>;
  if (missions.loading) return <Screen><Loading /></Screen>;
  const state = missions.items.find((x) => x.id === id);

  return (
    <Screen>
      <Header
        title={<>{m.icon} {m.title}</>}
        subtitle={`${LEVEL_TITLE[m.level]} · ${KIND_TITLE[m.kind].icon} ${KIND_TITLE[m.kind].label} · ~${m.minutes} мин`}
        back="/train"
      />
      {!state ? <Intro m={m} /> : state.stage === "work" ? <Work m={m} s={state} /> : <Debrief m={m} s={state} />}
    </Screen>
  );
}

function Story({ m, open = true }: { m: Mission; open?: boolean }) {
  return (
    <details className="dp-panel mb-4 p-4" open={open}>
      <summary className="cursor-pointer font-bold">📟 Ситуация</summary>
      <div className="mt-3"><Md text={m.story} /></div>
      <div className="mt-4 text-sm font-bold">Задание</div>
      <div className="mt-1"><Md text={m.task} /></div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {m.topics.map((t) => topicById(t) && (
          <Link key={t} to={`/topic/${t}`}><Pill color="#8b5cf6">📚 {topicById(t)!.title}</Pill></Link>
        ))}
      </div>
    </details>
  );
}

function Primer({ m, open }: { m: Mission; open?: boolean }) {
  if (!m.primer) return null;
  return (
    <details className="dp-panel mb-4 border-[var(--dp-cyan)]/30 p-4" open={open}>
      <summary className="cursor-pointer font-bold">🧭 Минимум, чтобы начать: {m.primer.title}</summary>
      <div className="mt-1 text-xs text-[var(--dp-muted)]">Тема новая или забылась — прочитай. Знаешь — пропусти и сразу думай.</div>
      <div className="mt-3"><Md text={m.primer.md} terms /></div>
    </details>
  );
}

/* ───────────── 1. гипотеза и выдача проекта ───────────── */

function Intro({ m }: { m: Mission }) {
  const [hypothesis, setHypothesis] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useRunner();

  const start = async () => {
    setError(null);
    const r = await run({ kind: "start", mission: m.id });
    if (r.status === "error") return setError(r.error ?? "Не получилось");
    await missionsDb.put(m.id, { stage: "work", hypothesis: hypothesis.trim(), hints: 0, checks: 0, path: r.path, startedAt: Date.now() });
    sfx.right();
  };

  return (
    <>
      <Story m={m} />
      <Primer m={m} />
      <Panel glow className="mb-4">
        <div className="font-bold">🤔 Твоя гипотеза</div>
        <div className="mt-1 text-sm text-[var(--dp-muted)]">{m.hypothesis}</div>
        <textarea
          className="dp-input mt-3 min-h-28"
          placeholder="Я думаю, причина в … потому что … Я бы попробовал …"
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
        />
        <div className="mt-2 text-xs text-[var(--dp-muted)]">
          Неверная гипотеза — нормально: после разбора сравнишь её с тем, что было на самом деле. Так и тренируется мышление.
        </div>
        {error && <div className="mt-3 text-sm text-[var(--dp-red)]">{error}</div>}
        <Btn className="mt-3" block loading={busy} disabled={hypothesis.trim().length < 15} onClick={start}>
          {busy ? "Готовлю проект…" : "Взять миссию"}
        </Btn>
        {hypothesis.trim().length < 15 && <div className="mt-2 text-center text-xs text-[var(--dp-muted)]">Напиши хотя бы одно предложение</div>}
      </Panel>
    </>
  );
}

/* ───────────── 2. работа: тесты, подсказки, наставник ───────────── */

function Work({ m, s }: { m: Mission; s: WithDoc<MissionState> }) {
  const { run, busy, running } = useRunner();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const check = async () => {
    setError(null);
    const r = await run({ kind: "check", mission: m.id });
    if (r.status === "error" || !r.result) return setError(r.error ?? "Хаб не вернул результат");
    const last = { ...r.result, at: Date.now() };
    const today = dayKey();
    if (s.lastCheckDay !== today) await award("mission", 15, { topicId: m.topics[0], note: m.id });
    const patch = { last, checks: s.checks + 1, lastCheckDay: today };
    if (r.result.ok) {
      await missionsDb.update(m.id, { ...patch, stage: "debrief", solvedAt: Date.now() });
      sfx.win();
      celebrate(undefined, true);
    } else {
      await missionsDb.update(m.id, patch);
      sfx.wrong();
    }
  };

  const open = async (file?: string, line?: number) => {
    setOpening(true);
    const r = await run({ kind: "open", mission: m.id, file, line });
    setOpening(false);
    if (r.status === "error") toast(r.error ?? "Не открылось", "error");
    else toast("Открыто в VS Code на компьютере", "success");
  };

  const copyPath = async () => {
    if (!s.path) return;
    await navigator.clipboard.writeText(s.path).catch(() => {});
    toast("Путь скопирован");
  };

  return (
    <>
      <Story m={m} open={false} />
      {s.hypothesis && (
        <Panel className="mb-4 !p-3 text-sm">
          <span className="text-[var(--dp-muted)]">Твоя гипотеза:</span> {s.hypothesis}
        </Panel>
      )}

      <Panel glow className="mb-4">
        <div className="font-bold">💻 Проект</div>
        <button className="dp-mono mt-2 block w-full truncate rounded-xl bg-[#0b1020] px-3 py-2 text-left text-xs" onClick={copyPath} title="Скопировать путь">
          {s.path ?? "…"}
        </button>
        <div className="mt-1 text-xs text-[var(--dp-muted)]">
          Открой папку в VS Code, правь код и жми «Проверить». Тесты в <code>tests/</code> хаб перезаписывает перед каждой проверкой.
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Btn tone="ghost" loading={opening} onClick={() => open()}>Открыть в VS Code</Btn>
          <Btn loading={busy && !opening} onClick={check}>{running ? "Гоняю тесты…" : "▶ Проверить"}</Btn>
        </div>
        {busy && !opening && <div className="mt-2 text-center text-xs text-[var(--dp-muted)]">Первая проверка дольше: dotnet восстанавливает пакеты.</div>}
        {error && <div className="mt-3 text-sm text-[var(--dp-red)]">{error}</div>}
      </Panel>

      {s.last && <RunView result={s.last} onOpen={(f, l) => open(f, l)} />}

      <Hints m={m} s={s} />
      <MentorBox m={m} s={s} />

      <Primer m={m} open={false} />
      {m.topics[0] && (
        <details className="dp-panel mb-4 p-4">
          <summary className="cursor-pointer font-bold">🎬 Видео по теме</summary>
          <div className="mt-3"><Videos topicId={m.topics[0]} compact /></div>
        </details>
      )}

      <ResetLink m={m} />
    </>
  );
}

function Hints({ m, s }: { m: Mission; s: WithDoc<MissionState> }) {
  if (!m.hints.length) return null;
  const labels = ["Наводящий вопрос", "Направление", "Почти решение"];
  const reveal = async () => {
    if (s.hints === m.hints.length - 1 && !(await confirm("Последняя подсказка почти раскрывает решение. Точно?", { confirmText: "Показать" }))) return;
    await missionsDb.update(m.id, { hints: s.hints + 1 });
  };
  return (
    <Panel className="mb-4">
      <div className="flex items-center justify-between">
        <div className="font-bold">💡 Подсказки</div>
        <div className="text-xs text-[var(--dp-muted)]">опыт за миссию: {missionXp(m, s.hints)} XP</div>
      </div>
      <div className="mt-3 space-y-2">
        {m.hints.slice(0, s.hints).map((h, k) => (
          <div key={k} className="dp-pop rounded-2xl border border-[var(--dp-gold)]/30 bg-[var(--dp-gold)]/10 p-3 text-sm">
            <div className="mb-1 text-xs font-bold text-[var(--dp-gold)]">{labels[k] ?? `Подсказка ${k + 1}`}</div>
            <Md text={h} />
          </div>
        ))}
      </div>
      {s.hints < m.hints.length && (
        <button className="mt-2 text-sm text-[var(--dp-gold)]" onClick={reveal}>
          💡 {labels[s.hints] ?? "Подсказка"} ({s.hints + 1}/{m.hints.length})
        </button>
      )}
    </Panel>
  );
}

/** Контекст для нейронки: гипотеза, падающие тесты, diff ученика. */
async function contextFor(m: Mission, s: MissionState, run: ReturnType<typeof useRunner>["run"]) {
  const d = await run({ kind: "diff", mission: m.id });
  const failing = (s.last?.tests ?? []).filter((t) => !t.ok).map((t) => `${t.name}${t.message ? ` — ${t.message.split("\n")[0]}` : ""}`);
  const errors = (s.last?.errors ?? []).map((e) => `ошибка сборки ${e.file}:${e.line} ${e.message}`);
  return { title: m.title, story: m.story, task: m.task, hypothesis: s.hypothesis, failing: [...errors, ...failing], diff: d.diff ?? "" };
}

function MentorBox({ m, s }: { m: Mission; s: MissionState }) {
  const [q, setQ] = useState("");
  const ai = useAi();
  const { run } = useRunner();
  const ask = async () => {
    const ctx = await contextFor(m, s, run);
    await ai.run(missionMentorPrompt(ctx, q.trim()), { system: WORKSHOP_MENTOR });
  };
  return (
    <details className="dp-panel mb-4 p-4">
      <summary className="cursor-pointer font-bold">🧑‍🏫 Спросить наставника</summary>
      <div className="mt-1 text-xs text-[var(--dp-muted)]">
        Видит твою гипотезу, изменения в коде и упавшие тесты. Наводит вопросами — готового кода не даёт.
      </div>
      <textarea className="dp-input mt-3 min-h-20" placeholder="Например: почему тест 4 падает, если я уже поменял…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Btn tone="ghost" className="mt-2" loading={ai.loading} onClick={ask}>Спросить</Btn>
      {ai.error && <div className="mt-3"><AiError error={ai.error} /></div>}
      {ai.text && <div className="mt-3 rounded-2xl bg-[var(--dp-panel-2)] p-3 text-sm"><Md text={ai.text} /></div>}
    </details>
  );
}

function ResetLink({ m }: { m: Mission }) {
  const { run, busy } = useRunner();
  const reset = async () => {
    if (!(await confirm("Начать миссию заново? Текущая папка проекта переедет в ~/DevPath/.old, прогресс миссии сбросится.", { danger: true, confirmText: "Начать заново" }))) return;
    const r = await run({ kind: "reset", mission: m.id });
    if (r.status === "error") return toast(r.error ?? "Не получилось", "error");
    await missionsDb.remove(m.id);
  };
  return (
    <div className="mt-6 text-center">
      <button className="text-sm text-[var(--dp-muted)] hover:text-white disabled:opacity-50" disabled={busy} onClick={reset}>↺ Начать миссию заново</button>
    </div>
  );
}

/* ───────────── 3. разбор «почему» ───────────── */

function Debrief({ m, s }: { m: Mission; s: WithDoc<MissionState> }) {
  const [quizDone, setQuizDone] = useState<number | null>(s.quiz ?? null);
  const [takeaway, setTakeaway] = useState(s.takeaway ?? "");
  const [finishing, setFinishing] = useState(false);
  const done = s.stage === "done";

  const finish = async () => {
    setFinishing(true);
    try {
      if (takeaway.trim()) await missionsDb.update(m.id, { takeaway: takeaway.trim() });
      const xp = await completeMission(m, s, quizDone ?? 0);
      sfx.win();
      celebrate(xp, true);
    } finally {
      setFinishing(false);
    }
  };

  return (
    <>
      <Panel glow className="mb-4 text-center">
        <div className="text-4xl">{done ? "🏆" : "✅"}</div>
        <div className="mt-1 text-lg font-bold">{done ? "Миссия пройдена" : "Тесты зелёные!"}</div>
        <div className="text-sm text-[var(--dp-muted)]">
          {s.checks} {plural(s.checks, ["проверка", "проверки", "проверок"])} · подсказок: {s.hints}
          {s.solvedAt && ` · ${Math.max(1, Math.round((s.solvedAt - s.startedAt) / 60000))} мин`}
        </div>
        {!done && <div className="mt-2 text-sm">Теперь главное: <b>почему</b> так, и когда так нельзя.</div>}
      </Panel>

      {s.hypothesis && (
        <Panel className="mb-4">
          <div className="text-sm font-bold">🤔 Ты предполагал</div>
          <div className="mt-1 text-sm text-[var(--dp-muted)]">{s.hypothesis}</div>
          <div className="mt-2 text-xs text-[var(--dp-muted)]">Сравни с разбором ниже: что угадал, что упустил?</div>
        </Panel>
      )}

      {m.debrief.map((sec) => (
        <Panel key={sec.title} className="mb-3">
          <div className="mb-2 font-bold">{sec.title}</div>
          <Md text={sec.md} terms />
        </Panel>
      ))}

      <ReviewBox m={m} s={s} />

      {!done && m.quiz.length > 0 && quizDone === null && (
        <Panel className="mb-4">
          <div className="mb-3 font-bold">❓ Проверь понимание</div>
          <StepPlayer
            steps={m.quiz}
            topicId={m.topics[0]}
            exit={`/mission/${m.id}`}
            onFinish={(r) => setQuizDone(Math.round((r.correct / Math.max(1, r.total)) * 100))}
          />
        </Panel>
      )}

      {!done && (quizDone !== null || !m.quiz.length) && (
        <Panel className="mb-4">
          {quizDone !== null && <div className="mb-3 text-sm">Вопросы: <b>{quizDone}%</b> верно</div>}
          <div className="font-bold">📝 Главный вывод — своими словами</div>
          <div className="mt-1 text-xs text-[var(--dp-muted)]">Одна-две фразы: что запомнить на будущее. Сформулировать самому — самый сильный способ запомнить.</div>
          <textarea className="dp-input mt-2 min-h-20" value={takeaway} onChange={(e) => setTakeaway(e.target.value)} placeholder="В следующий раз, когда увижу …, я …" />
          <Btn className="mt-3" block loading={finishing} onClick={finish}>Завершить миссию · +{missionXp(m, s.hints)} XP</Btn>
        </Panel>
      )}

      {done && s.takeaway && (
        <Panel className="mb-4 text-sm">
          <span className="text-[var(--dp-muted)]">Твой вывод:</span> {s.takeaway}
        </Panel>
      )}

      {done && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link to="/train" className="dp-btn dp-btn-primary">К тренировкам</Link>
        </div>
      )}
      <ResetLink m={m} />
    </>
  );
}

function ReviewBox({ m, s }: { m: Mission; s: WithDoc<MissionState> }) {
  const ai = useAi();
  const { run } = useRunner();
  const shown = ai.text || s.review;
  const review = async () => {
    const text = await ai.run(missionReviewPrompt(await contextFor(m, s, run)), { system: WORKSHOP_REVIEWER });
    if (text) await missionsDb.update(m.id, { review: text });
  };
  return (
    <Panel className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold">👀 Код-ревью твоего решения</div>
        <Btn tone="ghost" className="!min-h-9 !px-3 text-sm" loading={ai.loading} onClick={review}>{shown ? "Ещё раз" : "Попросить"}</Btn>
      </div>
      <div className="mt-1 text-xs text-[var(--dp-muted)]">Нейронка смотрит твой diff как тимлид: что сломается в жизни, какие были альтернативы.</div>
      {ai.error && <div className="mt-3"><AiError error={ai.error} /></div>}
      {shown && <div className={cn("mt-3 rounded-2xl bg-[var(--dp-panel-2)] p-3 text-sm")}><Md text={shown} /></div>}
    </Panel>
  );
}

