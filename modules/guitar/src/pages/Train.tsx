import { useMemo, useState } from "react";
import { cn, Link } from "@lifehub/sdk";
import { CATEGORIES, EXERCISES, type ExerciseCategory, type ExerciseMeta } from "../data/exercises";
import { Bar, Header, Panel, Pill, Screen, Section } from "../components/kit";
import { buildDailyPlan } from "../lib/daily-plan";
import { dayKey, loadDayLog, loadStats, type StatsMap } from "../lib/train-stats";

export function useDaily() {
  const stats = loadStats();
  const log = loadDayLog();
  const plan = buildDailyPlan(stats, dayKey());
  const doneToday = new Set(log[dayKey()] ?? []);
  return { stats, log, plan, doneToday };
}

export function PlanList({ compact }: { compact?: boolean }) {
  const { plan, doneToday } = useDaily();
  const done = plan.filter((p) => doneToday.has(p.exercise.id)).length;
  const minutes = plan.reduce((s, p) => s + p.exercise.minutes, 0);
  return (
    <Panel>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-bold">План тренажёров на сегодня</div>
        <div className="text-sm text-[var(--gt-muted)]">
          {done}/{plan.length} · ~{minutes} мин
        </div>
      </div>
      <Bar value={plan.length ? done / plan.length : 0} color="var(--gt-green)" className="mb-2" height={6} />
      <ol className="flex flex-col">
        {plan.slice(0, compact ? 4 : undefined).map((item, i) => {
          const ok = doneToday.has(item.exercise.id);
          return (
            <li key={item.exercise.id}>
              <Link to={item.exercise.href} className="flex items-center gap-3 rounded-xl px-1 py-2 transition hover:bg-[var(--gt-panel-2)]">
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", ok ? "bg-[var(--gt-green)] text-black" : "border border-[var(--gt-line)] text-[var(--gt-muted)]")}>{ok ? "✓" : i + 1}</span>
                <span className="text-lg">{item.exercise.icon}</span>
                <span className={cn("min-w-0 flex-1 truncate", ok && "text-[var(--gt-muted)] line-through")}>{item.exercise.title}</span>
                <span className="hidden text-xs text-[var(--gt-muted)] sm:inline">{item.reason}</span>
                <span className="text-xs text-[var(--gt-muted)]">{item.exercise.minutes}′</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function ExerciseCard({ e, stats, color }: { e: ExerciseMeta; stats: StatsMap; color: string }) {
  const stat = stats[e.id];
  return (
    <Link to={e.href} className="gt-panel group relative flex flex-col gap-1.5 overflow-hidden p-4 transition hover:-translate-y-0.5">
      <div className="absolute -right-6 -top-6 size-20 rounded-full opacity-15 blur-2xl transition group-hover:opacity-35" style={{ background: color }} />
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl">{e.icon}</span>
        <span className="flex flex-wrap justify-end gap-1">
          {e.needsMic && <Pill color="var(--gt-rose)">🎤 микрофон</Pill>}
          <Pill>{e.level}</Pill>
        </span>
      </div>
      <div className="font-bold leading-snug">{e.title}</div>
      <div className="text-sm leading-snug text-[var(--gt-muted)]">{e.summary}</div>
      {stat && !e.unscored ? (
        <div className="mt-auto pt-1 text-xs text-[var(--gt-muted)]">
          Лучший: <b className="text-[var(--gt-green)]">{stat.best}{e.scoreUnit ?? "%"}</b> · попыток {stat.attempts}
        </div>
      ) : (
        <div className="mt-auto pt-1 text-xs text-[var(--gt-muted)]">~{e.minutes} мин</div>
      )}
    </Link>
  );
}

export function TrainPage() {
  const [cat, setCat] = useState<ExerciseCategory | "all">("all");
  const { stats } = useDaily();
  const cats = useMemo(() => (cat === "all" ? CATEGORIES : CATEGORIES.filter((c) => c.id === cat)), [cat]);

  return (
    <Screen>
      <Header title="Тренажёры" subtitle="Гитара и голос: техника, слух, ритм, подбор и импровизация. У каждого — инструкция и видеоурок." />

      <div className="grid grid-cols-3 gap-2">
        {[
          { to: "/tools?t=tuner", icon: "🎚️", label: "Тюнер" },
          { to: "/tools?t=metronome", icon: "⏱️", label: "Метроном" },
          { to: "/tools?t=recorder", icon: "⏺️", label: "Запись" },
        ].map((x) => (
          <Link key={x.to} to={x.to} className="gt-panel flex flex-col items-center gap-1 !rounded-2xl py-3 text-sm font-semibold transition hover:-translate-y-0.5">
            <span className="text-xl">{x.icon}</span>
            {x.label}
          </Link>
        ))}
      </div>

      <Section title="Сегодня">
        <PlanList />
      </Section>

      <div className="gt-scroll-x mt-7">
        <button data-on={cat === "all"} onClick={() => setCat("all")} className="gt-chip">
          Все · {EXERCISES.length}
        </button>
        {CATEGORIES.map((c) => (
          <button key={c.id} data-on={cat === c.id} onClick={() => setCat(c.id)} className="gt-chip">
            {c.icon} {c.title}
          </button>
        ))}
      </div>

      {cats.map((c) => (
        <Section key={c.id} title={<span style={{ color: c.color }}>{c.icon} {c.title}</span>}>
          <p className="-mt-1 mb-3 text-sm text-[var(--gt-muted)]">{c.description}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {EXERCISES.filter((e) => e.category === c.id).map((e) => (
              <ExerciseCard key={e.id} e={e} stats={stats} color={c.color} />
            ))}
          </div>
        </Section>
      ))}
    </Screen>
  );
}
