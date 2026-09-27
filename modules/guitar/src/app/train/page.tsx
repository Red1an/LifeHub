import { useEffect, useState } from "react";
import { Link } from "@lifehub/sdk";
import { CATEGORIES, exercisesByCategory, ExerciseCategory } from "../../data/exercises";
import { DayLog, StatsMap, currentStreak, dayKey, loadDayLog, loadStats } from "../../lib/train-stats";
import { buildDailyPlan, PlanItem } from "../../lib/daily-plan";
import { pluralRu } from "../../lib/plural";

const ACCENT: Record<ExerciseCategory, string> = {
  improv: "hover:border-sky-500",
  guitar: "hover:border-emerald-500",
  ear: "hover:border-violet-500",
  rhythm: "hover:border-amber-500",
  vocal: "hover:border-rose-500",
};

const DOT: Record<ExerciseCategory, string> = {
  improv: "bg-sky-500",
  guitar: "bg-emerald-500",
  ear: "bg-violet-500",
  rhythm: "bg-amber-500",
  vocal: "bg-rose-500",
};

export default function TrainPage() {
  const [stats, setStats] = useState<StatsMap>({});
  const [log, setLog] = useState<DayLog>({});
  const [plan, setPlan] = useState<PlanItem[]>([]);

  useEffect(() => {
    const loaded = loadStats();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage after mount
    setStats(loaded);
    setLog(loadDayLog());
    setPlan(buildDailyPlan(loaded, dayKey()));
  }, []);

  const doneToday = new Set(log[dayKey()] ?? []);
  const planDone = plan.filter((p) => doneToday.has(p.exercise.id)).length;
  const planMinutes = plan.reduce((s, p) => s + p.exercise.minutes, 0);
  const streak = currentStreak(log);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-24 sm:py-10 sm:pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Тренажёры</h1>
          <p className="mt-2 max-w-xl text-zinc-500">
            Гитара и голос: техника, слух, ритм, подбор и импровизация.
            Упражнения с микрофоном слушают твою игру и пение и разбирают ошибки.
          </p>
        </div>
        <Link to="/progress" className="rounded-xl border border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
          🔥 {streak} {pluralRu(streak, "день", "дня", "дней")} подряд · Прогресс →
        </Link>
      </div>

      {plan.length > 0 && (
        <section className="mt-8 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">План на сегодня</h2>
            <span className="text-sm text-zinc-500">
              {planDone}/{plan.length} · ~{planMinutes} мин
            </span>
          </div>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full bg-emerald-500" style={{ width: `${(planDone / plan.length) * 100}%` }} />
          </div>
          <ol className="flex flex-col gap-1.5">
            {plan.map((item, i) => {
              const done = doneToday.has(item.exercise.id);
              return (
                <li key={item.exercise.id}>
                  <Link to={item.exercise.href} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${done ? "bg-emerald-600 text-white" : "border border-zinc-300 dark:border-zinc-700"}`}>
                      {done ? "✓" : i + 1}
                    </span>
                    <span className="text-lg">{item.exercise.icon}</span>
                    <span className={`flex-1 ${done ? "text-zinc-400 line-through" : ""}`}>{item.exercise.title}</span>
                    <span className="hidden text-xs text-zinc-500 sm:inline">{item.reason}</span>
                    <span className="text-xs text-zinc-500">{item.exercise.minutes} мин</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="mt-10 flex flex-col gap-10">
        {CATEGORIES.map((category) => (
          <section key={category.id}>
            <div className="mb-1 flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${DOT[category.id]}`} />
              <h2 className="text-lg font-semibold">{category.title}</h2>
            </div>
            <p className="mb-4 text-sm text-zinc-500">{category.description}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {exercisesByCategory(category.id).map((exercise) => {
                const stat = stats[exercise.id];
                return (
                  <Link
                    key={exercise.id}
                    to={exercise.href}
                    className={`group flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 transition-colors dark:border-zinc-800 ${ACCENT[category.id]}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-2xl">{exercise.icon}</span>
                      <div className="flex items-center gap-1.5">
                        {exercise.needsMic && (
                          <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">микрофон</span>
                        )}
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">{exercise.level}</span>
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">{exercise.title}</div>
                      <div className="mt-0.5 text-sm text-zinc-500">{exercise.summary}</div>
                    </div>
                    {stat && !exercise.unscored && (
                      <div className="mt-1 text-xs text-zinc-500">
                        Лучший результат:{" "}
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {stat.best}
                          {exercise.scoreUnit ?? "%"}
                        </span>{" "}
                        · попыток: {stat.attempts}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
