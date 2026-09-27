import { useEffect, useState } from "react";
import { Link } from "@lifehub/sdk";
import { EXERCISES } from "../../data/exercises";
import { DayLog, StatsMap, currentStreak, dayKey, loadDayLog, loadStats } from "../../lib/train-stats";
import { pluralRu } from "../../lib/plural";

const WEEKS = 12;

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-10 text-xs text-zinc-400">мало данных</div>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 160},${36 - ((v - min) / span) * 32}`)
    .join(" ");
  return (
    <svg viewBox="0 0 160 40" className="h-10 w-full">
      <polyline points={points} fill="none" className="stroke-emerald-500" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

export default function ProgressPage() {
  const [stats, setStats] = useState<StatsMap>({});
  const [log, setLog] = useState<DayLog>({});

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage after mount
    setStats(loadStats());
    setLog(loadDayLog());
  }, []);

  const streak = currentStreak(log);
  const activeDays = Object.values(log).filter((ids) => ids.length > 0).length;
  const totalRounds = Object.values(stats).reduce((s, x) => s + x.attempts, 0);

  // Calendar: last WEEKS weeks, Monday-first columns.
  const today = new Date();
  const days: { key: string; count: number; future: boolean }[] = [];
  const cursor = new Date(today);
  cursor.setDate(cursor.getDate() - ((today.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  for (let i = 0; i < WEEKS * 7; i++) {
    const key = dayKey(cursor);
    days.push({ key, count: log[key]?.length ?? 0, future: cursor > today });
    cursor.setDate(cursor.getDate() + 1);
  }

  const scored = EXERCISES.filter((e) => !e.unscored && stats[e.id]);
  const untouched = EXERCISES.filter((e) => !stats[e.id] && !(log[dayKey()] ?? []).includes(e.id));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 pb-24 sm:py-10 sm:pb-12">
      <Link to="/train" className="text-sm text-emerald-600 underline dark:text-emerald-400">← Тренажёры</Link>
      <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Прогресс</h1>

      <div className="mt-6 grid grid-cols-3 gap-3 text-center">
        {[
          { label: "подряд", value: `${streak}`, sub: pluralRu(streak, "день", "дня", "дней") },
          { label: "занятий", value: `${activeDays}`, sub: pluralRu(activeDays, "день", "дня", "дней") },
          { label: "раундов", value: `${totalRounds}`, sub: "всего" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="text-3xl font-bold tabular-nums">{s.value}</div>
            <div className="text-xs text-zinc-500">{s.sub} {s.label}</div>
          </div>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-semibold">Календарь занятий</h2>
        <div className="overflow-x-auto">
          <div className="grid w-max grid-flow-col grid-rows-7 gap-1">
            {days.map((d) => (
              <div
                key={d.key}
                title={`${d.key}: ${d.count} упражнений`}
                className={`h-3.5 w-3.5 rounded-sm ${
                  d.future
                    ? "bg-transparent"
                    : d.count === 0
                      ? "bg-zinc-200 dark:bg-zinc-800"
                      : d.count < 3
                        ? "bg-emerald-300 dark:bg-emerald-800"
                        : d.count < 6
                          ? "bg-emerald-500"
                          : "bg-emerald-700 dark:bg-emerald-400"
                }`}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-semibold">Результаты по упражнениям</h2>
        {scored.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока пусто — пройди пару упражнений, и здесь появятся графики.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {scored.map((e) => {
              const stat = stats[e.id];
              const values = (stat.history ?? []).map((p) => p.score);
              const first = values[0];
              const recent = values.slice(-3);
              const recentAvg = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
              const unit = e.scoreUnit ?? "%";
              return (
                <Link key={e.id} to={e.href} className="rounded-2xl border border-zinc-200 p-4 hover:border-emerald-500 dark:border-zinc-800">
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium">{e.icon} {e.title}</span>
                    <span className="text-xs text-zinc-500">{stat.attempts} {pluralRu(stat.attempts, "раунд", "раунда", "раундов")}</span>
                  </div>
                  <Sparkline values={values} />
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>сейчас ~{recentAvg}{unit}</span>
                    <span>лучший {stat.best}{unit}</span>
                    {first !== undefined && values.length > 2 && (
                      <span className={recentAvg >= first ? "text-emerald-600" : "text-amber-600"}>
                        {recentAvg >= first ? "▲" : "▼"} {Math.abs(recentAvg - first)}{unit} с начала
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {untouched.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-semibold">Ещё не пробовал</h2>
          <div className="flex flex-wrap gap-2">
            {untouched.map((e) => (
              <Link key={e.id} to={e.href} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm dark:bg-zinc-800">
                {e.icon} {e.title}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
