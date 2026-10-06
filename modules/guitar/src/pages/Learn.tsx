import { useMemo, useState } from "react";
import { cn, Link, useCollection, useParams } from "@lifehub/sdk";
import { findExercise } from "../data/exercises";
import { PATHS, pathById, type LearnPath, type Step } from "../data/paths";
import { TopicVideos } from "../components/Videos";
import { Bar, Btn, celebrate, Empty, Header, Panel, Rich, Screen } from "../components/kit";
import { markPractice } from "../lib/train-stats";

interface Done {
  at: number;
  path: string;
}

export function useLearn() {
  const col = useCollection<Done>("learn");
  const done = useMemo(() => new Set(col.items.map((d) => d.id)), [col.items]);
  const progress = (p: LearnPath) => p.steps.filter((s) => done.has(s.id)).length / p.steps.length;
  const nextStep = (p: LearnPath) => p.steps.find((s) => !done.has(s.id)) ?? null;
  /** Путь, который сейчас проходишь: последний тронутый и не законченный. */
  const current = useMemo(() => {
    const last = [...col.items].sort((a, b) => b.at - a.at).map((d) => pathById(d.path)).find((p) => p && p.steps.some((s) => !done.has(s.id)));
    return last ?? PATHS[0];
  }, [col.items, done]);
  return { col, done, progress, nextStep, current, loading: col.loading };
}

const KIND: Record<Step["kind"], { icon: string; label: string }> = {
  lesson: { icon: "📖", label: "Урок" },
  video: { icon: "▶", label: "Видео" },
  exercise: { icon: "🎯", label: "Тренажёр" },
  practice: { icon: "🎸", label: "Практика" },
  song: { icon: "🎵", label: "Песня" },
};

export const stepTitle = (s: Step) => (s.kind === "exercise" ? s.title ?? findExercise(s.exercise)?.title ?? s.exercise : s.title);

export function LearnPage() {
  const learn = useLearn();
  return (
    <Screen>
      <Header title="Учёба" subtitle="Пути от простого к сложному: короткие уроки, лучшие видео, тренажёры и задания на гитаре." />
      <div className="grid gap-3 sm:grid-cols-2">
        {PATHS.map((p) => {
          const v = learn.progress(p);
          const next = learn.nextStep(p);
          return (
            <Link key={p.id} to={`/learn/${p.id}`} className="gt-panel group relative block overflow-hidden p-4 transition hover:-translate-y-0.5">
              <div className="absolute -right-8 -top-8 size-28 rounded-full opacity-20 blur-2xl transition group-hover:opacity-40" style={{ background: p.color }} />
              <div className="flex items-start justify-between">
                <span className="text-3xl">{p.icon}</span>
                <span className="text-xs text-[var(--gt-muted)]">{p.level}</span>
              </div>
              <div className="mt-2 font-bold">{p.title}</div>
              <div className="mt-0.5 text-sm leading-snug text-[var(--gt-muted)]">{p.summary}</div>
              <Bar value={v} color={p.color} className="mt-3" height={6} />
              <div className="mt-1.5 flex justify-between text-xs text-[var(--gt-muted)]">
                <span>{v >= 1 ? "пройден ✅" : next ? `дальше: ${stepTitle(next)}` : ""}</span>
                <span>
                  {p.steps.filter((s) => learn.done.has(s.id)).length}/{p.steps.length}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </Screen>
  );
}

export function LearnPathPage() {
  const { id } = useParams<{ id: string }>();
  const path = pathById(id);
  const learn = useLearn();
  const next = path ? learn.nextStep(path) : null;
  const [open, setOpen] = useState<string | null>(null);
  if (!path) return <Screen><Empty icon="🧭" title="Нет такого пути" /></Screen>;
  const active = open ?? next?.id ?? null;

  const toggle = async (s: Step) => {
    if (learn.done.has(s.id)) return learn.col.remove(s.id);
    await learn.col.put(s.id, { at: Date.now(), path: path.id });
    markPractice(`learn:${path.id}`);
    const left = path.steps.filter((x) => !learn.done.has(x.id) && x.id !== s.id);
    if (!left.length) celebrate();
    const after = path.steps[path.steps.findIndex((x) => x.id === s.id) + 1];
    setOpen(after && !learn.done.has(after.id) ? after.id : null);
  };

  return (
    <Screen>
      <Header back="/learn" title={`${path.icon} ${path.title}`} subtitle={path.summary} />
      <Bar value={learn.progress(path)} color={path.color} className="mb-5" />
      <ol className="relative space-y-2">
        <span className="absolute bottom-4 left-[19px] top-4 w-px bg-[var(--gt-line)]" />
        {path.steps.map((s, i) => {
          const done = learn.done.has(s.id);
          const isOpen = active === s.id;
          return (
            <li key={s.id} className="relative">
              <div className={cn("gt-panel overflow-hidden transition", isOpen && "border-[var(--gt-brass)]/50")}>
                <button onClick={() => setOpen(isOpen ? "" : s.id)} className="flex w-full items-center gap-3 p-3 text-left">
                  <span
                    className={cn(
                      "relative z-10 grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold",
                      done ? "bg-[var(--gt-green)] text-black" : s.id === next?.id ? "bg-[var(--gt-brass)] text-black" : "bg-[var(--gt-panel-2)] text-[var(--gt-muted)]",
                    )}
                  >
                    {done ? "✓" : KIND[s.kind].icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] uppercase tracking-wider text-[var(--gt-muted)]">
                      {i + 1}. {KIND[s.kind].label}
                    </span>
                    <span className={cn("block font-semibold leading-snug", done && "text-[var(--gt-muted)]")}>{stepTitle(s)}</span>
                  </span>
                  <span className={cn("text-[var(--gt-muted)] transition", isOpen && "rotate-180")}>⌄</span>
                </button>
                {isOpen && (
                  <div className="gt-slide border-t border-[var(--gt-line)] p-4">
                    <StepBody step={s} />
                    <Btn tone={done ? "ghost" : "green"} className="mt-4" onClick={() => toggle(s)}>
                      {done ? "Отменить отметку" : "✓ Готово"}
                    </Btn>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Screen>
  );
}

function StepBody({ step }: { step: Step }) {
  if (step.kind === "lesson") return <Rich text={step.text} className="text-[15px] text-[var(--gt-fg)]/90" />;
  if (step.kind === "video") return <TopicVideos topic={step.topic} limit={4} compact />;
  if (step.kind === "exercise") {
    const ex = findExercise(step.exercise);
    return (
      <div>
        {ex && <div className="text-sm text-[var(--gt-muted)]">{ex.goal}</div>}
        <Panel className="mt-3 !rounded-2xl !p-3 text-sm">
          <span className="text-[var(--gt-brass)]">🎯 Цель:</span> {step.target}
        </Panel>
        {ex && (
          <Link to={ex.href} className="gt-btn gt-btn-brass mt-3">
            {ex.icon} Открыть «{ex.title}»
          </Link>
        )}
      </div>
    );
  }
  if (step.kind === "practice")
    return (
      <div>
        <Rich text={step.text} className="text-[15px]" />
        {step.link && (
          <Link to={step.link.to} className="gt-btn gt-btn-brass mt-3">
            {step.link.label}
          </Link>
        )}
      </div>
    );
  return (
    <div>
      <Rich text={step.text} className="text-[15px]" />
      <Link to={`/songs?q=${encodeURIComponent(step.query)}`} className="gt-btn gt-btn-brass mt-3">
        🔎 Найти: {step.query}
      </Link>
    </div>
  );
}
