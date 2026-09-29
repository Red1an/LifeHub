import { useState } from "react";
import { Link, Loading, useAi, useCollection, useParams, cn, toast } from "@lifehub/sdk";
import { PROJECTS, projectById } from "../data/projects.ts";
import { LEVEL_NAMES, topicById, trackById } from "../data/curriculum.ts";
import { award } from "../lib/store.ts";
import { REVIEWER, parseScore } from "../lib/ai.ts";
import { sfx } from "../lib/sfx.ts";
import type { ProjectState } from "../lib/types.ts";
import { Screen, Header, Panel, Bar, Pill, Btn, AiError, celebrate } from "../components/kit.tsx";
import { Md } from "../components/Md.tsx";

const XP_STAGE = 80;

export function ProjectsPage() {
  const states = useCollection<ProjectState>("projects");
  if (states.loading) return <Screen><Loading /></Screen>;
  return (
    <Screen wide>
      <Header
        title="🏗️ Проекты"
        subtitle="Настоящие pet-проекты по этапам. Знания из уроков превращаются в навык, а в портфолио — код, который не стыдно показать."
        back="/arena"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {PROJECTS.map((p) => {
          const st = states.items.find((s) => s.id === p.id);
          const done = st?.done.length ?? 0;
          return (
            <Link key={p.id} to={`/project/${p.id}`} className="dp-panel block p-4 transition hover:-translate-y-0.5">
              <div className="flex items-start gap-3">
                <div className="text-4xl">{p.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{p.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Pill color={p.level === 1 ? "#34d399" : p.level === 2 ? "#60a5fa" : "#f472b6"}>{LEVEL_NAMES[p.level]}</Pill>
                    {p.tracks.map((t) => <Pill key={t}>{trackById(t)?.icon} {trackById(t)?.title}</Pill>)}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-sm text-[var(--dp-muted)]">{p.summary}</p>
              <div className="mt-3 flex items-center gap-2">
                <Bar value={done / p.stages.length} className="flex-1" color="linear-gradient(90deg,#f59e0b,#f43f5e)" />
                <span className="text-xs text-[var(--dp-muted)]">{done}/{p.stages.length}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </Screen>
  );
}

export function ProjectPage() {
  const { id = "" } = useParams();
  const p = projectById(id);
  const states = useCollection<ProjectState>("projects");
  const [open, setOpen] = useState<number | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [answer, setAnswer] = useState("");
  const review = useAi();
  if (!p) return <Screen><Header title="Проект не найден" back="/projects" /></Screen>;
  if (states.loading) return <Screen><Loading /></Screen>;
  const st = states.items.find((s) => s.id === id);
  const done = new Set(st?.done ?? []);
  const current = p.stages.findIndex((_, k) => !done.has(k));
  const shown = open ?? (current >= 0 ? current : 0);
  const stage = p.stages[shown];

  const save = (patch: Partial<ProjectState>) =>
    st ? states.update(id, patch) : states.put(id, { done: [], startedAt: Date.now(), ...patch });

  const complete = async (k: number) => {
    await save({ done: [...done, k] });
    await award("project", XP_STAGE, { note: `${p.id}:${k}` });
    sfx.win();
    celebrate(XP_STAGE, true);
    toast(`Этап «${p.stages[k].title}» завершён`, "success");
    setChecks({});
    setOpen(null);
    review.reset();
    setAnswer("");
  };

  const allChecked = stage.check.every((_, k) => checks[`${shown}-${k}`]);

  return (
    <Screen>
      <Header title={<span>{p.icon} {p.title}</span>} subtitle={p.summary} back="/projects" />

      <Panel className="mb-4">
        <div className="mb-2 text-sm font-semibold">Ссылка на репозиторий</div>
        <input
          key={st?.repo ?? ""}
          className="dp-input"
          placeholder="https://github.com/…"
          defaultValue={st?.repo ?? ""}
          onBlur={(e) => e.target.value !== (st?.repo ?? "") && save({ repo: e.target.value })}
        />
      </Panel>

      {/* Этапы */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {p.stages.map((s, k) => (
          <button
            key={k}
            onClick={() => setOpen(k)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition",
              k === shown ? "border-[var(--dp-violet)] bg-[var(--dp-violet)]/15" : "border-[var(--dp-line)]",
            )}
          >
            <span className={cn("grid size-6 place-items-center rounded-full text-xs font-bold", done.has(k) ? "bg-[var(--dp-green)] text-black" : "bg-[var(--dp-panel-2)]")}>
              {done.has(k) ? "✓" : k + 1}
            </span>
            <span className="max-w-40 truncate">{s.title}</span>
          </button>
        ))}
      </div>

      <Panel glow className="mb-4">
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--dp-cyan)]">Этап {shown + 1} из {p.stages.length}</div>
        <h2 className="mt-1 text-xl font-extrabold">{stage.title}</h2>
        <Md text={stage.md} className="mt-3" />
        {stage.topics && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="text-xs text-[var(--dp-muted)]">Пригодится:</span>
            {stage.topics.map((t) => (
              <Link key={t} to={`/topic/${t}`} className="rounded-full bg-[var(--dp-panel-2)] px-2.5 py-0.5 text-xs hover:brightness-125">
                {topicById(t)?.title ?? t}
              </Link>
            ))}
          </div>
        )}
        <div className="mt-4 font-semibold">Критерии готовности</div>
        <div className="mt-2 space-y-2">
          {stage.check.map((c, k) => {
            const key = `${shown}-${k}`;
            const on = done.has(shown) || !!checks[key];
            return (
              <button
                key={key}
                disabled={done.has(shown)}
                onClick={() => setChecks({ ...checks, [key]: !checks[key] })}
                className={cn("flex w-full items-start gap-3 rounded-xl border p-2.5 text-left text-sm transition", on ? "border-[var(--dp-green)]/50 bg-[var(--dp-green)]/10" : "border-[var(--dp-line)]")}
              >
                <span>{on ? "✅" : "⬜"}</span>
                <span>{c}</span>
              </button>
            );
          })}
        </div>
        {done.has(shown) ? (
          <div className="mt-4 font-semibold text-[var(--dp-green)]">Этап завершён ✓</div>
        ) : (
          <Btn block className="mt-4" disabled={!allChecked} onClick={() => complete(shown)}>
            {allChecked ? `Завершить этап · +${XP_STAGE} XP` : "Отметь все критерии"}
          </Btn>
        )}
      </Panel>

      <Panel>
        <div className="font-bold">👨‍💻 Ревью от нейронки (по желанию)</div>
        <div className="mt-1 text-sm text-[var(--dp-muted)]">Вставь ключевой код этапа или опиши решение — тимлид проверит по критериям.</div>
        <textarea className="dp-editor mt-3 !min-h-40" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="// код или описание решения" spellCheck={false} />
        <Btn
          className="mt-3"
          tone="ghost"
          loading={review.loading}
          disabled={answer.trim().length < 20}
          onClick={() =>
            review.run(`Проект: ${p.title}. Этап: ${stage.title}\n${stage.md}\nКритерии: ${stage.check.join("; ")}\n\nРешение:\n${answer}`, { system: REVIEWER })
          }
        >
          Отправить на ревью
        </Btn>
        {review.error && <div className="mt-3"><AiError error={review.error} /></div>}
        {review.text && (
          <div className="dp-slide mt-4">
            {parseScore(review.text) !== undefined && <Pill color="#fbbf24">{parseScore(review.text)! / 10}/10</Pill>}
            <Md text={review.text.replace(/^\s*ОЦЕНКА:.*$/im, "").trim()} className="mt-2" />
          </div>
        )}
      </Panel>
    </Screen>
  );
}
