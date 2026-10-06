import { Link, plural } from "@lifehub/sdk";
import { EXERCISES } from "../data/exercises";
import { PATHS } from "../data/paths";
import { Bar, Header, Panel, Screen, Section } from "../components/kit";
import { useLibrary } from "../lib/songs";
import { currentStreak, dayKey, loadDayLog, loadStats } from "../lib/train-stats";
import { useLearn } from "./Learn";

const WEEKS = 15;

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-10 text-xs text-[var(--gt-muted)]">мало данных</div>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 160},${36 - ((v - min) / span) * 32}`).join(" ");
  return (
    <svg viewBox="0 0 160 40" className="h-10 w-full">
      <polyline points={points} fill="none" stroke="var(--gt-green)" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

export function ProgressPage() {
  const stats = loadStats();
  const log = loadDayLog();
  const lib = useLibrary();
  const learn = useLearn();
  const streak = currentStreak(log);
  const activeDays = Object.values(log).filter((ids) => ids.length > 0).length;
  const metas = [...lib.meta.values()];
  const learned = metas.filter((m) => m.status === "learned").length;
  const learning = metas.filter((m) => m.status === "learning").length;

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
  const shade = (n: number) => (n === 0 ? "#2a2420" : n < 3 ? "rgba(52,211,153,0.35)" : n < 6 ? "rgba(52,211,153,0.65)" : "var(--gt-green)");

  return (
    <Screen>
      <Header title="Прогресс" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { v: streak, l: `${plural(streak, ["день", "дня", "дней"])} подряд`, c: "var(--gt-brass)" },
          { v: activeDays, l: "дней занятий", c: "var(--gt-green)" },
          { v: learned, l: `${plural(learned, ["песня выучена", "песни выучены", "песен выучено"])}`, c: "var(--gt-sky)" },
          { v: learning, l: "учу сейчас", c: "var(--gt-copper)" },
        ].map((s) => (
          <Panel key={s.l} className="text-center">
            <div className="gt-num text-4xl font-bold" style={{ color: s.c }}>{s.v}</div>
            <div className="text-xs text-[var(--gt-muted)]">{s.l}</div>
          </Panel>
        ))}
      </div>

      <Section title="Календарь">
        <Panel className="overflow-x-auto">
          <div className="grid w-max grid-flow-col grid-rows-7 gap-1">
            {days.map((d) => (
              <div key={d.key} title={`${d.key}: ${d.count}`} className="size-3.5 rounded-[4px]" style={{ background: d.future ? "transparent" : shade(d.count) }} />
            ))}
          </div>
        </Panel>
      </Section>

      <Section title="Учёба">
        <div className="grid gap-2 sm:grid-cols-2">
          {PATHS.map((p) => (
            <Link key={p.id} to={`/learn/${p.id}`} className="gt-panel block !rounded-2xl p-3">
              <div className="mb-1.5 flex justify-between text-sm">
                <span>{p.icon} {p.title}</span>
                <span className="text-[var(--gt-muted)]">{Math.round(learn.progress(p) * 100)}%</span>
              </div>
              <Bar value={learn.progress(p)} color={p.color} height={6} />
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Результаты тренажёров">
        {scored.length === 0 ? (
          <Panel className="text-sm text-[var(--gt-muted)]">Пока пусто — пройди пару упражнений, и здесь появятся графики.</Panel>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {scored.map((e) => {
              const stat = stats[e.id];
              const values = (stat.history ?? []).map((p) => p.score);
              const recent = values.slice(-3);
              const avg = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
              const first = values[0];
              const unit = e.scoreUnit ?? "%";
              return (
                <Link key={e.id} to={e.href} className="gt-panel block p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">{e.icon} {e.title}</span>
                    <span className="text-xs text-[var(--gt-muted)]">{stat.attempts} {plural(stat.attempts, ["раунд", "раунда", "раундов"])}</span>
                  </div>
                  <Sparkline values={values} />
                  <div className="flex justify-between text-xs text-[var(--gt-muted)]">
                    <span>сейчас ~{avg}{unit}</span>
                    <span>лучший {stat.best}{unit}</span>
                    {first !== undefined && values.length > 2 && (
                      <span style={{ color: avg >= first ? "var(--gt-green)" : "var(--gt-copper)" }}>
                        {avg >= first ? "▲" : "▼"} {Math.abs(avg - first)}{unit}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
    </Screen>
  );
}
