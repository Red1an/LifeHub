import { useMemo, useState } from "react";
import { addDays, BarChart, cn, dayKey, formatDate, Heatmap, LineChart, Link, Loading, prompt, startOfWeek, toast, useCollection } from "@lifehub/sdk";
import { EX, MAJOR, MUSCLES } from "../data/library.ts";
import { activeByDay, bests, doneSets, isMain, minutesOf, pushPull, weekVolume } from "../lib/analysis.ts";
import { achievements } from "../lib/game.ts";
import { useFit, type Fit } from "../lib/store.ts";
import type { Benchmark, BodyEntry } from "../lib/types.ts";
import { Bar, Btn, Header, Panel, Pill, Screen, Section } from "../components/kit.tsx";

const TESTS: { id: string; name: string; icon: string; unit: string }[] = [
  { id: "pushups", name: "Отжимания за подход", icon: "💪", unit: "раз" },
  { id: "pullups", name: "Подтягивания за подход", icon: "🧗", unit: "раз" },
  { id: "squats", name: "Приседания за минуту", icon: "🦵", unit: "раз" },
  { id: "plank", name: "Планка", icon: "🪵", unit: "сек" },
];

export function ProgressPage() {
  const fit = useFit();
  if (fit.loading) return <Screen><Loading /></Screen>;
  return (
    <Screen>
      <Header title="Прогресс" subtitle="Всё, что ты уже сделал" />
      <Overview fit={fit} />
      <Activity fit={fit} />
      <Balance fit={fit} />
      <Records fit={fit} />
      <Tests />
      <Body />
      <Achievements fit={fit} />
      <History fit={fit} />
    </Screen>
  );
}

function Overview({ fit }: { fit: Fit }) {
  const { rank, next, progress } = fit.rank;
  const workouts = fit.hist.filter((w) => w.kind === "workout");
  const minutes = fit.hist.reduce((n, w) => n + minutesOf(w), 0);
  return (
    <>
      <div className="ft-hero p-5">
        <div className="relative z-10 flex items-center gap-4">
          <div className="text-5xl">{rank.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-extrabold uppercase tracking-widest opacity-70">Уровень {fit.rank.level}</div>
            <div className="ft-display text-2xl font-extrabold">{rank.title}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/15">
              <div className="h-full rounded-full bg-[#0a0b0d]" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="mt-1 text-xs font-bold opacity-70">{fit.xp} XP{next ? ` · до «${next.title}» ${next.xp - fit.xp}` : ""}</div>
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini icon="📅" big={fit.week.streak} label="недель подряд" />
        <Mini icon="🔥" big={fit.days} label="дней в движении" />
        <Mini icon="🏋️" big={workouts.length} label="тренировок" />
        <Mini icon="⏱️" big={minutes} label="минут всего" />
      </div>
    </>
  );
}

function Mini({ icon, big, label }: { icon: string; big: number | string; label: string }) {
  return (
    <div className="ft-panel p-3">
      <div className="text-xl">{icon}</div>
      <div className="ft-num mt-1 text-xl font-extrabold">{big}</div>
      <div className="text-[11px] text-[var(--ft-muted)]">{label}</div>
    </div>
  );
}

function Activity({ fit }: { fit: Fit }) {
  const byDay = useMemo(() => activeByDay(fit.hist), [fit.hist]);
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = addDays(startOfWeek(), -7 * (7 - i));
    const end = addDays(start, 7).getTime();
    const mins = fit.hist.filter((w) => w.finishedAt! >= start.getTime() && w.finishedAt! < end).reduce((n, w) => n + minutesOf(w), 0);
    return { label: formatDate(start, "short").replace(/\s\d{4}.*/, ""), value: mins, color: mins >= 150 ? "#c8f031" : "#ff7a2f" };
  });
  return (
    <Section title="Активность">
      <Panel>
        <Heatmap values={byDay} weeks={20} />
        <div className="mt-4 text-xs font-bold text-[var(--ft-muted)]">Минут в неделю (норма ВОЗ — 150)</div>
        <BarChart data={weeks} height={140} />
      </Panel>
    </Section>
  );
}

function Balance({ fit }: { fit: Fit }) {
  const vol = weekVolume(fit.hist);
  const target = fit.profile.goal === "muscle" ? 12 : fit.profile.goal === "health" ? 6 : 9;
  const { push, pull } = pushPull(fit.hist);
  const ratio = pull ? push / pull : push ? 9 : 1;
  const verdict = !push && !pull ? "Пока нет данных" : ratio > 1.3 ? "Жимов больше, чем тяг — добавь подтягивания и тяги, плечам и осанке будет лучше" : ratio < 0.7 ? "Тяг заметно больше жимов — добавь отжимания" : "Жимы и тяги в балансе 👍";
  const weak = MAJOR.filter((m) => (vol[m] ?? 0) < target / 2);
  return (
    <Section title="Баланс недели" right={<span className="text-xs text-[var(--ft-muted)]">цель ~{target} подходов на мышцу</span>}>
      <Panel>
        <div className="space-y-2">
          {MAJOR.map((m) => {
            const v = Math.round((vol[m] ?? 0) * 10) / 10;
            return (
              <div key={m} className="flex items-center gap-3 text-sm">
                <div className="w-28 shrink-0 truncate text-[var(--ft-muted)]">{MUSCLES[m]}</div>
                <Bar value={v / target} className="flex-1" color={v >= target ? "var(--ft-lime)" : v >= target / 2 ? "#e3c33a" : "var(--ft-orange)"} />
                <div className="ft-num w-8 text-right text-xs">{v}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[var(--ft-panel-2)] p-3">
          <div className="text-center">
            <div className="ft-num text-lg font-extrabold">{push}:{pull}</div>
            <div className="text-[10px] text-[var(--ft-muted)]">жимы : тяги<br />за 4 недели</div>
          </div>
          <div className="flex-1 text-sm">{verdict}</div>
        </div>
        {weak.length > 0 && weak.length < MAJOR.length && (
          <div className="mt-2 text-xs text-[var(--ft-muted)]">Мало внимания на этой неделе: {weak.map((m) => MUSCLES[m].toLowerCase()).join(", ")}. «Умный выбор» учтёт это.</div>
        )}
      </Panel>
    </Section>
  );
}

function Records({ fit }: { fit: Fit }) {
  const ids = [...new Set(fit.hist.flatMap((w) => w.items.filter((it) => isMain(it) && doneSets(it).length).map((it) => it.ex)))];
  if (!ids.length) return null;
  const rows = ids.map((id) => ({ e: EX.get(id)!, b: bests(fit.hist, id) })).filter((r) => r.e && r.e.pattern !== "mobility" && r.e.pattern !== "stretch" && r.e.pattern !== "cardio");
  return (
    <Section title="🥇 Лучшие результаты">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {rows.map(({ e, b }) => (
          <Link key={e.id} to={`/ex/${e.id}`} className="flex items-center gap-3 rounded-2xl bg-[var(--ft-panel)] px-3 py-2">
            <span className="text-xl">{e.icon}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.name}</span>
            <span className="ft-num text-sm font-bold text-[var(--ft-lime)]">{e.load ? `${b.kg} кг` : e.mode === "time" ? `${b.sec} с` : `${b.reps}`}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

function Tests() {
  const tests = useCollection<Benchmark>("tests");
  const [open, setOpen] = useState(TESTS[0].id);
  const add = async (id: string) => {
    const t = TESTS.find((x) => x.id === id)!;
    const v = await prompt(`${t.name}: сколько (${t.unit})?`, "");
    const n = Number(v?.replace(",", "."));
    if (!v || !Number.isFinite(n) || n < 0) return;
    await tests.add({ test: id, value: n, date: dayKey() });
    const prev = tests.items.filter((x) => x.test === id);
    toast(prev.length && n > Math.max(...prev.map((x) => x.value)) ? "Рекорд! 🥇" : "Записано", "success");
  };
  const cur = TESTS.find((t) => t.id === open)!;
  const list = tests.items.filter((x) => x.test === open).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Section title="🧪 Тесты силы" right={<span className="text-xs text-[var(--ft-muted)]">раз в 4 недели</span>}>
      <Panel>
        <div className="ft-scroll-x">
          {TESTS.map((t) => {
            const last = tests.items.filter((x) => x.test === t.id).sort((a, b) => b.date.localeCompare(a.date))[0];
            return (
              <button key={t.id} data-on={open === t.id} className="ft-chip" onClick={() => setOpen(t.id)}>
                {t.icon} {last ? `${last.value}` : "—"}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="font-bold">{cur.icon} {cur.name}</div>
          <Btn tone="ghost" className="!min-h-9 text-sm" onClick={() => void add(open)}>+ Результат</Btn>
        </div>
        {list.length > 1 ? (
          <LineChart labels={list.map((x) => formatDate(x.date, "short"))} series={[{ name: cur.unit, points: list.map((x) => x.value), color: "#c8f031" }]} height={140} className="mt-2" />
        ) : (
          <div className="mt-2 text-sm text-[var(--ft-muted)]">{list.length ? `Первый результат: ${list[0].value} ${cur.unit}. Повтори тест через месяц — увидишь рост.` : "Сделай тест на максимум и запиши результат — это точка отсчёта."}</div>
        )}
      </Panel>
    </Section>
  );
}

function Body() {
  const body = useCollection<BodyEntry>("body");
  const list = [...body.items].sort((a, b) => a.date.localeCompare(b.date));
  const add = async () => {
    const v = await prompt("Вес тела, кг", list[list.length - 1]?.weight ? String(list[list.length - 1].weight) : "");
    const n = Number(v?.replace(",", "."));
    if (!v || !Number.isFinite(n) || n <= 0) return;
    await body.put(dayKey(), { date: dayKey(), weight: n });
  };
  const first = list[0]?.weight;
  const last = list[list.length - 1]?.weight;
  return (
    <Section title="⚖️ Вес тела" right={<Btn tone="ghost" className="!min-h-9 text-sm" onClick={() => void add()}>+ Записать</Btn>}>
      <Panel>
        {list.length ? (
          <>
            <div className="flex items-baseline gap-3">
              <div className="ft-num text-2xl font-extrabold">{last} кг</div>
              {list.length > 1 && <Pill color={last! <= first! ? "#c8f031" : "#ff7a2f"}>{last! - first! > 0 ? "+" : ""}{Math.round((last! - first!) * 10) / 10} кг с {formatDate(list[0].date, "short")}</Pill>}
            </div>
            {list.length > 1 && <LineChart labels={list.map((x) => formatDate(x.date, "short"))} series={[{ name: "кг", points: list.map((x) => x.weight), color: "#38d6f5" }]} height={120} className="mt-2" />}
          </>
        ) : <div className="text-sm text-[var(--ft-muted)]">Необязательно. Взвешивайся утром, раз в неделю — так видно тренд, а не колебания воды.</div>}
      </Panel>
    </Section>
  );
}

function Achievements({ fit }: { fit: Fit }) {
  const list = achievements(fit.hist, fit.week.streak, fit.days, fit.levels);
  const done = list.filter((a) => a.done).length;
  return (
    <Section title={`🏅 Достижения ${done}/${list.length}`}>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {list.map((a) => (
          <div key={a.id} className={cn("ft-panel flex flex-col items-center p-3 text-center", !a.done && "opacity-50")} title={a.text}>
            <div className={cn("text-3xl", !a.done && "grayscale")}>{a.icon}</div>
            <div className="mt-1 text-xs font-bold leading-tight">{a.title}</div>
            <div className="mt-0.5 text-[10px] leading-tight text-[var(--ft-muted)]">{a.text}</div>
            {!a.done && (a.progress ?? 0) > 0 && <Bar value={a.progress ?? 0} className="mt-1.5 w-full" height={4} color="var(--ft-orange)" />}
          </div>
        ))}
      </div>
    </Section>
  );
}

function History({ fit }: { fit: Fit }) {
  const [n, setN] = useState(15);
  const list = [...fit.hist].reverse();
  if (!list.length) return null;
  const icon = { workout: "🏋️", break: "🪑", morning: "🌅", stretch: "🌙" } as const;
  return (
    <Section title="📜 История">
      <div className="space-y-1.5">
        {list.slice(0, n).map((w) => (
          <Link key={w.id} to={`/w/${w.id}`} className="flex items-center gap-3 rounded-2xl bg-[var(--ft-panel)] px-3 py-2.5">
            <span className="text-xl">{icon[w.kind]}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{w.title}</span>
              <span className="block text-xs text-[var(--ft-muted)]">{formatDate(w.finishedAt!, "datetime")} · {minutesOf(w)} мин{w.prs?.length ? ` · 🥇${w.prs.length}` : ""}</span>
            </span>
            <span className="text-xs font-bold text-[var(--ft-lime)]">+{w.xp ?? 0}</span>
          </Link>
        ))}
      </div>
      {list.length > n && <Btn tone="ghost" block className="mt-2" onClick={() => setN(n + 30)}>Показать ещё</Btn>}
    </Section>
  );
}
