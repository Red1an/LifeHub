import { useState } from "react";
import { Link, Loading, cn, confirm, dayKey, plural, toast, useAi, useCollection, useParams, useStore, type WithDoc } from "@lifehub/sdk";
import { BUILD_PROJECTS, buildProjectById, type BuildProject } from "../data/projects-build.ts";
import { topicById } from "../data/curriculum.ts";
import { buildsDb, finishStage, stageXp, useRunner } from "../lib/workshop.ts";
import { WORKSHOP_MENTOR, missionMentorPrompt } from "../lib/ai.ts";
import { award, useDev } from "../lib/store.ts";
import type { Stage } from "../lib/workshop-parse.ts";
import type { BuildState, RunResult, WorkshopEnv } from "../lib/types.ts";
import { sfx } from "../lib/sfx.ts";
import { Screen, Header, Panel, Btn, Pill, Bar, AiError, celebrate } from "../components/kit.tsx";
import { Md } from "../components/Md.tsx";
import { Videos } from "../components/Videos.tsx";
import { StepPlayer } from "../components/StepPlayer.tsx";
import { RunView } from "../components/RunView.tsx";
import { DefenseGate, DesignDoc, ReviewGate, StageSteps, defensePassed, reviewPassed, type StepId } from "./StageGates.tsx";

const PROJECT = BUILD_PROJECTS[0];

/* ───────────── главный экран: проект и дорожная карта ───────────── */

export function ProjectHome() {
  const dev = useDev();
  const builds = useCollection<BuildState>("builds");
  const [env] = useStore<WorkshopEnv | null>("env", null);
  if (builds.loading || dev.loading) return <Screen><Loading /></Screen>;
  const p = PROJECT;
  const state = builds.items.find((b) => b.id === p.id);
  const current = state ? p.stages.find((s) => s.n === state.stage) : p.stages[0];
  const done = state?.finished.length ?? 0;

  return (
    <Screen>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-[var(--dp-muted)]">Учимся на своём проекте</div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {p.icon} <span className="dp-grad-text">{p.title}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Pill color="#fb923c" className="!px-3 !py-1.5 !text-sm">
            <span className={cn(dev.streak > 0 && "dp-flame")}>🔥</span> {dev.streak}
          </Pill>
          <Pill color="#fbbf24" className="!px-3 !py-1.5 !text-sm">⚡ {dev.xp}</Pill>
        </div>
      </div>

      <EnvWarning env={env} />

      {current ? (
        <Link to={`/build/${p.id}/${current.n}`} className="dp-panel dp-glow mb-5 block p-4 transition hover:-translate-y-0.5">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--dp-cyan)]">
            {state ? `Этап ${current.n} из ${p.roadmap.length}` : "Начать проект"}
          </div>
          <div className="mt-1 text-lg font-bold">{current.title}</div>
          <div className="mt-1 text-sm text-[var(--dp-muted)]">{p.roadmap.find((r) => r.n === current.n)?.tech}</div>
          {state?.last && state.last.stage === current.n && (
            <div className="mt-2 text-xs text-[var(--dp-muted)]">последняя проверка: {state.last.passed}/{state.last.total} тестов</div>
          )}
        </Link>
      ) : (
        <Panel className="mb-5">
          <div className="font-bold">Все готовые этапы пройдены 🏆</div>
          <div className="text-sm text-[var(--dp-muted)]">Следующие этапы появятся в новых версиях модуля. Пока — тренировки и собеседование по пройденному.</div>
        </Panel>
      )}

      {!state && (
        <Panel className="mb-5">
          <Md text={p.intro} />
        </Panel>
      )}

      <Panel className="mb-5 !p-3">
        <div className="flex items-center justify-between text-sm">
          <span>Пройдено этапов <b>{done}/{p.roadmap.length}</b></span>
          {state?.path && <span className="dp-mono truncate pl-3 text-xs text-[var(--dp-muted)]">{state.path}</span>}
        </div>
        <Bar value={done / p.roadmap.length} className="mt-2" color="linear-gradient(90deg,#8b5cf6,#22d3ee)" />
      </Panel>

      <h2 className="mb-2 text-lg font-bold">Дорожная карта</h2>
      <div className="space-y-2">
        {p.roadmap.map((r) => {
          const ready = p.stages.some((s) => s.n === r.n);
          const finished = state?.finished.includes(r.n);
          const open = ready && (r.n === 1 || (state && r.n <= state.stage));
          const body = (
            <>
              <div className={cn("grid size-10 shrink-0 place-items-center rounded-2xl text-sm font-bold", finished ? "bg-[var(--dp-green)]/20" : open ? "bg-[var(--dp-violet)]/25" : "bg-[var(--dp-panel-2)] text-[var(--dp-muted)]")}>
                {finished ? "✅" : r.n}
              </div>
              <div className="min-w-0 flex-1">
                <div className={cn("truncate font-semibold", !open && "text-[var(--dp-muted)]")}>{r.title}</div>
                <div className="truncate text-xs text-[var(--dp-muted)]">{r.tech}</div>
              </div>
              {!ready ? <Pill>скоро</Pill> : !open ? <span className="text-[var(--dp-muted)]">🔒</span> : null}
            </>
          );
          return open ? (
            <Link key={r.n} to={`/build/${p.id}/${r.n}`} className="dp-panel flex items-center gap-3 p-3 transition hover:-translate-y-0.5">{body}</Link>
          ) : (
            <div key={r.n} className="dp-panel flex items-center gap-3 p-3 opacity-70">{body}</div>
          );
        })}
      </div>
    </Screen>
  );
}

function EnvWarning({ env }: { env: WorkshopEnv | null }) {
  if (env && env.dotnet && env.git) return null;
  return (
    <Panel className="mb-5 border-[var(--dp-gold)]/40 text-sm">
      <div className="font-semibold text-[var(--dp-gold)]">{env ? `На компьютере с хабом нет: ${[!env.dotnet && ".NET SDK", !env.git && "git"].filter(Boolean).join(", ")}` : "Хаб ещё не проверил компьютер"}</div>
      <div className="mt-1 text-[var(--dp-muted)]">Проект проверяет хаб на компьютере, где работает: нужны .NET SDK, git и Docker Desktop.</div>
    </Panel>
  );
}

/* ───────────── этап ───────────── */

export function StagePage() {
  const { project = "", n = "1" } = useParams();
  const p = buildProjectById(project);
  const s = p?.stages.find((x) => x.n === Number(n));
  const builds = useCollection<BuildState>("builds");
  if (!p || !s) return <Screen><Header title="Этап не найден" back="/" /></Screen>;
  if (builds.loading) return <Screen><Loading /></Screen>;
  const state = builds.items.find((b) => b.id === p.id);
  const locked = s.n > (state?.stage ?? 1);
  // План (у открытых этапов — принятый архитектором дизайн) → код и тесты → обязательное ревью → защита → разбор.
  const step: StepId =
    !state || !state.design[s.n] || !state.startCommit?.[s.n] ? "design"
    : !state.passed.includes(s.n) ? "code"
    : state.finished.includes(s.n) ? "debrief"
    : !reviewPassed(state, s.n) ? "review"
    : !defensePassed(state, s.n) ? "defense"
    : "debrief";

  return (
    <Screen>
      <Header title={<>Этап {s.n}. {s.title}</>} subtitle={`${p.icon} ${p.title} · ~${s.hours} ч · ${p.roadmap.find((r) => r.n === s.n)?.tech ?? ""}${s.open ? " · проектируешь сам" : ""}`} back="/" />
      {locked ? (
        <Panel className="text-center text-[var(--dp-muted)]">🔒 Сначала пройди этап {s.n - 1}: проект растёт по порядку, и тесты прошлых этапов проверяются каждый раз.</Panel>
      ) : (
        <>
          <StageSteps current={state?.finished.includes(s.n) ? "debrief" : step} />
          {step === "design" ? (
            <Design p={p} s={s} state={state} />
          ) : step === "code" ? (
            <Work p={p} s={s} state={state!} />
          ) : step === "review" ? (
            <>
              {state!.last && <StageRun result={state!.last} n={s.n} onOpen={() => {}} />}
              <ReviewGate p={p} s={s} state={state!} />
            </>
          ) : step === "defense" ? (
            <DefenseGate p={p} s={s} state={state!} />
          ) : (
            <Debrief p={p} s={s} state={state!} />
          )}
        </>
      )}
    </Screen>
  );
}

function About({ s, open }: { s: Stage; open: boolean }) {
  return (
    <>
      <details className="dp-panel mb-4 p-4" open={open}>
        <summary className="cursor-pointer font-bold">🎯 Зачем этот этап</summary>
        <div className="mt-3"><Md text={s.story} terms /></div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.topics.map((t) => topicById(t) && (
            <Link key={t} to={`/topic/${t}`}><Pill color="#8b5cf6">📚 {topicById(t)!.title}</Pill></Link>
          ))}
        </div>
      </details>
      <details className="dp-panel mb-4 p-4" open={open}>
        <summary className="cursor-pointer font-bold">📋 Что должно работать</summary>
        <div className="mt-3"><Md text={s.task} /></div>
      </details>
    </>
  );
}

function Primer({ s, open = false }: { s: Stage; open?: boolean }) {
  if (!s.primer) return null;
  return (
    <details className="dp-panel mb-4 border-[var(--dp-cyan)]/30 p-4" open={open}>
      <summary className="cursor-pointer font-bold">🧭 Минимум, чтобы начать: {s.primer.title}</summary>
      <div className="mt-1 text-xs text-[var(--dp-muted)]">Разобранный пример на другом коде — не решение этапа.</div>
      <div className="mt-3"><Md text={s.primer.md} terms /></div>
    </details>
  );
}

/** Шаг 1: продумать решение до кода. На первом этапе — ещё и выдать проект. */
function Design({ p, s, state }: { p: BuildProject; s: Stage; state?: WithDoc<BuildState> }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useRunner();

  const start = async (plan: string) => {
    setError(null);
    let path = state?.path;
    if (!state) {
      const r = await run({ kind: "start", project: p.id });
      if (r.status === "error") return setError(r.error ?? "Не получилось");
      path = r.path;
    }
    // Снимок кода на старте этапа: ревью и защита смотрят только изменения этого этапа.
    const snap = await run({ kind: "snapshot", project: p.id, message: `Этап ${s.n}: начало` });
    if (snap.status === "error" || !snap.commit) return setError(snap.error ?? "Не получилось сделать снимок проекта");
    if (!state) {
      await buildsDb.put(p.id, {
        stage: 1, passed: [], finished: [], design: { [s.n]: plan }, hints: {}, takeaways: {}, quiz: {}, checks: 0, path, startedAt: Date.now(),
        startCommit: { [s.n]: snap.commit },
      });
    } else {
      await buildsDb.update(p.id, { design: { ...state.design, [s.n]: plan }, startCommit: { ...state.startCommit, [s.n]: snap.commit } });
    }
    sfx.right();
  };

  if (s.open) {
    return (
      <>
        <About s={s} open />
        <Primer s={s} />
        <DesignDoc p={p} s={s} state={state} busy={busy} onAccepted={start} />
        {error && <div className="mb-4 text-sm text-[var(--dp-red)]">{error}</div>}
      </>
    );
  }

  return (
    <>
      <About s={s} open />
      <Primer s={s} />
      <Panel glow className="mb-4">
        <div className="font-bold">📐 Сначала продумай</div>
        <div className="mt-1 text-sm text-[var(--dp-muted)]">{s.design}</div>
        <textarea className="dp-input mt-3 min-h-32" placeholder="Я сделаю … потому что … Риск вижу в …" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 text-xs text-[var(--dp-muted)]">
          Так работают сеньоры: сначала решение и его компромиссы, потом код. После этапа сравнишь план с тем, что получилось.
        </div>
        {error && <div className="mt-3 text-sm text-[var(--dp-red)]">{error}</div>}
        <Btn className="mt-3" block loading={busy} disabled={text.trim().length < 30} onClick={() => start(text.trim())}>
          {busy ? "Готовлю проект…" : state ? "Начать этап" : "Создать проект и начать"}
        </Btn>
        {text.trim().length < 30 && <div className="mt-2 text-center text-xs text-[var(--dp-muted)]">Хотя бы пара предложений</div>}
      </Panel>
    </>
  );
}

function Work({ p, s, state }: { p: BuildProject; s: Stage; state: WithDoc<BuildState> }) {
  const { run, busy, running } = useRunner();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const last = state.last?.stage === s.n ? state.last : undefined;

  const check = async () => {
    setError(null);
    const r = await run({ kind: "check", project: p.id, stage: s.n });
    if (r.status === "error" || !r.result) return setError(r.error ?? "Хаб не вернул результат");
    const today = dayKey();
    if (state.lastCheckDay !== today) await award("build", 20, { topicId: s.topics[0], note: `${p.id}:${s.n}` });
    const patch = { last: { ...r.result, at: Date.now(), stage: s.n }, checks: state.checks + 1, lastCheckDay: today };
    if (r.result.ok) {
      await buildsDb.update(p.id, { ...patch, passed: [...new Set([...state.passed, s.n])] });
      sfx.win();
      celebrate(undefined, true);
    } else {
      await buildsDb.update(p.id, patch);
      sfx.wrong();
    }
  };

  const open = async (file?: string, line?: number) => {
    setOpening(true);
    const r = await run({ kind: "open", project: p.id, file, line });
    setOpening(false);
    if (r.status === "error") toast(r.error ?? "Не открылось", "error");
    else toast("Открыто в VS Code на компьютере", "success");
  };

  return (
    <>
      <About s={s} open={false} />
      <Panel className="mb-4 !p-3 text-sm">
        <span className="text-[var(--dp-muted)]">Твой план:</span> {state.design[s.n]}
      </Panel>

      <Panel glow className="mb-4">
        <div className="font-bold">💻 Проект</div>
        <button
          className="dp-mono mt-2 block w-full truncate rounded-xl bg-[#0b1020] px-3 py-2 text-left text-xs"
          onClick={async () => { await navigator.clipboard.writeText(state.path ?? "").catch(() => {}); toast("Путь скопирован"); }}
        >
          {state.path ?? "…"}
        </button>
        <div className="mt-1 text-xs text-[var(--dp-muted)]">
          Тесты хаба — в <code>hub/</code> (хаб обновляет их сам), твои — в <code>tests/</code>. Проверка гоняет тесты всех открытых этапов и поднимает Docker.
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Btn tone="ghost" loading={opening} onClick={() => open()}>Открыть в VS Code</Btn>
          <Btn loading={busy && !opening} onClick={check}>{running ? "Проверяю…" : "▶ Проверить"}</Btn>
        </div>
        {busy && !opening && <div className="mt-2 text-center text-xs text-[var(--dp-muted)]">Поднимаю инфраструктуру и гоняю тесты — первый раз может занять несколько минут.</div>}
        {error && <div className="mt-3 text-sm text-[var(--dp-red)]">{error}</div>}
      </Panel>

      {last && <StageRun result={last} n={s.n} onOpen={open} />}

      {s.steps && (
        <details className="dp-panel mb-4 p-4">
          <summary className="cursor-pointer font-bold">🪜 Как идти</summary>
          <div className="mt-3"><Md text={s.steps} /></div>
        </details>
      )}
      <Primer s={s} />
      <StageHints p={p} s={s} state={state} />
      <StageMentor p={p} s={s} state={state} />
      {s.breaks && (
        <details className="dp-panel mb-4 p-4">
          <summary className="cursor-pointer font-bold">💥 Сломай и посмотри</summary>
          <div className="mt-1 text-xs text-[var(--dp-muted)]">Эксперименты руками: так понимают, зачем нужна защита, лучше любой теории.</div>
          <div className="mt-3"><Md text={s.breaks} /></div>
        </details>
      )}
      {s.topics[0] && (
        <details className="dp-panel mb-4 p-4">
          <summary className="cursor-pointer font-bold">🎬 Видео по теме</summary>
          <div className="mt-3"><Videos topicId={s.topics[0]} compact /></div>
        </details>
      )}
      {s.n === 1 && <ResetProject p={p} />}
    </>
  );
}

/** Результат с разбивкой: этот этап отдельно, прошлые — одной строкой (если не сломались). */
function StageRun({ result, n, onOpen }: { result: RunResult & { at: number }; n: number; onOpen: (f: string, l: number) => void }) {
  const isOld = (name: string) => /^Э(\d+)\./.test(name) && Number(name.match(/^Э(\d+)\./)![1]) < n;
  const old = result.tests.filter((t) => isOld(t.name));
  const oldBroken = old.filter((t) => !t.ok);
  const own = result.tests.filter((t) => t.source && t.source !== "Hub.Tests");
  const shown = { ...result, tests: result.tests.filter((t) => !isOld(t.name) && !(t.source && t.source !== "Hub.Tests")) };
  return (
    <>
      {old.length > 0 && (
        <Panel className={cn("mb-3 !p-3 text-sm", oldBroken.length > 0 && "border-[var(--dp-red)]/50")}>
          {oldBroken.length ? `❌ Сломались тесты прошлых этапов: ${oldBroken.length} из ${old.length}` : `✅ Прошлые этапы целы: ${old.length} тестов`}
          {oldBroken.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs">{oldBroken.map((t) => <li key={t.name}>{t.name}</li>)}</ul>}
        </Panel>
      )}
      {own.length > 0 && (
        <Panel className="mb-3 !p-3 text-sm">
          🧪 Твои тесты: {own.filter((t) => t.ok).length} из {own.length} зелёные
        </Panel>
      )}
      <RunView result={shown} onOpen={onOpen} />
    </>
  );
}

function StageHints({ p, s, state }: { p: BuildProject; s: Stage; state: WithDoc<BuildState> }) {
  const used = state.hints[s.n] ?? 0;
  if (!s.hints.length) return null;
  return (
    <Panel className="mb-4">
      <div className="flex items-center justify-between">
        <div className="font-bold">💡 Подсказки</div>
        <div className="text-xs text-[var(--dp-muted)]">опыт за этап: {stageXp(s, used)} XP</div>
      </div>
      <div className="mt-3 space-y-2">
        {s.hints.slice(0, used).map((h, k) => (
          <div key={k} className="dp-pop rounded-2xl border border-[var(--dp-gold)]/30 bg-[var(--dp-gold)]/10 p-3 text-sm"><Md text={h} /></div>
        ))}
      </div>
      {used < s.hints.length && (
        <button
          className="mt-2 text-sm text-[var(--dp-gold)]"
          onClick={async () => {
            if (used === s.hints.length - 1 && !(await confirm("Последняя подсказка почти раскрывает решение. Точно?", { confirmText: "Показать" }))) return;
            await buildsDb.update(p.id, { hints: { ...state.hints, [s.n]: used + 1 } });
          }}
        >
          💡 Подсказка {used + 1}/{s.hints.length}
        </button>
      )}
    </Panel>
  );
}

async function stageContext(p: BuildProject, s: Stage, state: BuildState, run: ReturnType<typeof useRunner>["run"]) {
  const d = await run({ kind: "diff", project: p.id });
  const last = state.last?.stage === s.n ? state.last : undefined;
  const failing = [
    ...(last?.errors ?? []).map((e) => `ошибка сборки ${e.file}:${e.line} ${e.message}`),
    ...(last?.tests ?? []).filter((t) => !t.ok).map((t) => `${t.name}${t.message ? ` — ${t.message.split("\n")[0]}` : ""}`),
  ];
  return { title: `${p.title}, этап ${s.n}: ${s.title}`, story: s.story, task: s.task, hypothesis: state.design[s.n] ?? "", failing, diff: d.diff ?? "" };
}

function StageMentor({ p, s, state }: { p: BuildProject; s: Stage; state: BuildState }) {
  const [q, setQ] = useState("");
  const ai = useAi();
  const { run } = useRunner();
  return (
    <details className="dp-panel mb-4 p-4">
      <summary className="cursor-pointer font-bold">🧑‍🏫 Спросить наставника</summary>
      <div className="mt-1 text-xs text-[var(--dp-muted)]">Видит твой план, изменения в коде и упавшие тесты. Наводит, но не пишет за тебя.</div>
      <textarea className="dp-input mt-3 min-h-20" placeholder="Например: как лучше хранить резерв — полем или считать по заявкам?" value={q} onChange={(e) => setQ(e.target.value)} />
      <Btn tone="ghost" className="mt-2" loading={ai.loading} onClick={async () => ai.run(missionMentorPrompt(await stageContext(p, s, state, run), q.trim()), { system: WORKSHOP_MENTOR })}>Спросить</Btn>
      {ai.error && <div className="mt-3"><AiError error={ai.error} /></div>}
      {ai.text && <div className="mt-3 rounded-2xl bg-[var(--dp-panel-2)] p-3 text-sm"><Md text={ai.text} /></div>}
    </details>
  );
}

function ResetProject({ p }: { p: BuildProject }) {
  const { run, busy } = useRunner();
  return (
    <div className="mt-6 text-center">
      <button
        className="text-sm text-[var(--dp-muted)] hover:text-white disabled:opacity-50"
        disabled={busy}
        onClick={async () => {
          if (!(await confirm("Начать проект с нуля? Папка проекта переедет в ~/DevPath/.old, прогресс проекта сбросится.", { danger: true, confirmText: "С нуля" }))) return;
          const r = await run({ kind: "reset", project: p.id });
          if (r.status === "error") return toast(r.error ?? "Не получилось", "error");
          await buildsDb.remove(p.id);
        }}
      >
        ↺ Начать проект заново
      </button>
    </div>
  );
}

/* ───────────── разбор этапа ───────────── */

function Debrief({ p, s, state }: { p: BuildProject; s: Stage; state: WithDoc<BuildState> }) {
  const done = state.finished.includes(s.n);
  const [quiz, setQuiz] = useState<number | null>(state.quiz[s.n] ?? null);
  const [takeaway, setTakeaway] = useState(state.takeaways[s.n] ?? "");
  const [finishing, setFinishing] = useState(false);
  const next = p.stages.find((x) => x.n === s.n + 1);

  return (
    <>
      <Panel glow className="mb-4 text-center">
        <div className="text-4xl">{done ? "🏆" : "✅"}</div>
        <div className="mt-1 text-lg font-bold">{done ? "Этап пройден" : "Тесты, ревью и защита пройдены!"}</div>
        <div className="text-sm text-[var(--dp-muted)]">
          {state.checks} {plural(state.checks, ["проверка", "проверки", "проверок"])} за проект · подсказок на этапе: {state.hints[s.n] ?? 0}
        </div>
        {!done && <div className="mt-2 text-sm">Теперь разбор: почему так, что ещё можно было, и что спросят на собеседовании.</div>}
      </Panel>

      <Panel className="mb-4">
        <div className="text-sm font-bold">📐 Твой план до кода</div>
        <div className="mt-1 text-sm text-[var(--dp-muted)]">{state.design[s.n]}</div>
        <div className="mt-2 text-xs text-[var(--dp-muted)]">Что пошло по плану, а что пришлось менять по ходу?</div>
      </Panel>

      {s.debrief.map((sec) => (
        <Panel key={sec.title} className="mb-3">
          <div className="mb-2 font-bold">{sec.title}</div>
          <Md text={sec.md} terms />
        </Panel>
      ))}

      {state.reviews?.[s.n] && (
        <details className="dp-panel mb-4 p-4">
          <summary className="cursor-pointer font-bold">👀 Ревью этапа · {state.reviews[s.n].score}/10</summary>
          <div className="mt-3 text-sm"><Md text={state.reviews[s.n].text} /></div>
        </details>
      )}
      {state.defense?.[s.n]?.score !== undefined && (
        <details className="dp-panel mb-4 p-4">
          <summary className="cursor-pointer font-bold">🎤 Защита · {state.defense[s.n].score}/10</summary>
          <div className="mt-3 text-sm"><Md text={state.defense[s.n].messages.at(-1)?.content ?? ""} /></div>
        </details>
      )}

      {!done && s.quiz.length > 0 && quiz === null && (
        <Panel className="mb-4">
          <div className="mb-3 font-bold">🎤 Вопросы с собеседований по этапу</div>
          <StepPlayer steps={s.quiz} topicId={s.topics[0]} exit={`/build/${p.id}/${s.n}`} onFinish={(r) => setQuiz(Math.round((r.correct / Math.max(1, r.total)) * 100))} />
        </Panel>
      )}

      {!done && (quiz !== null || !s.quiz.length) && (
        <Panel className="mb-4">
          {quiz !== null && <div className="mb-3 text-sm">Вопросы: <b>{quiz}%</b> верно</div>}
          <div className="font-bold">📝 Что вынес из этапа — своими словами</div>
          <textarea className="dp-input mt-2 min-h-20" value={takeaway} onChange={(e) => setTakeaway(e.target.value)} placeholder="Главное, что понял: …" />
          <Btn
            className="mt-3"
            block
            loading={finishing}
            disabled={takeaway.trim().length < 15}
            onClick={async () => {
              setFinishing(true);
              try {
                const xp = await finishStage(p, s, state, quiz ?? 0, takeaway.trim());
                sfx.win();
                celebrate(xp, true);
              } finally {
                setFinishing(false);
              }
            }}
          >
            Завершить этап · +{stageXp(s, state.hints[s.n] ?? 0)} XP
          </Btn>
        </Panel>
      )}

      {done && state.takeaways[s.n] && (
        <Panel className="mb-4 text-sm"><span className="text-[var(--dp-muted)]">Твой вывод:</span> {state.takeaways[s.n]}</Panel>
      )}
      {done && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {next ? <Link to={`/build/${p.id}/${next.n}`} className="dp-btn dp-btn-primary">Этап {next.n}: {next.title} →</Link> : <Link to="/" className="dp-btn dp-btn-primary">К проекту</Link>}
        </div>
      )}
    </>
  );
}
