import { useMemo, type ReactNode } from "react";
import { BarChart, DonutChart, cn, dayKey, startOfWeek, useCollection, useSearchParams } from "@lifehub/sdk";
import { Btn, ConnectCard, ErrorBox, Panel, Skeleton } from "../components/kit.tsx";
import { useEvents, usePrefs } from "../lib/gcal.ts";
import { blocksTime, busyFromEvents, freeSlots } from "../lib/slots.ts";
import { CATEGORIES, type CalEvent, type Category, type Task } from "../lib/types.ts";
import { WEEKDAYS, dayLabel, fromKey, shiftKey } from "../lib/time.ts";

const h = (m: number) => Math.round(m / 6) / 10;

/** Минуты события внутри дня k (многодневные режутся по дням). */
function minutesOn(e: CalEvent, k: string) {
  const s = fromKey(k).getTime();
  const end = s + 86_400_000;
  return Math.max(0, (Math.min(end, e.end.getTime()) - Math.max(s, e.start.getTime())) / 60_000);
}

export function StatsPage() {
  const [params, setParams] = useSearchParams();
  const anchor = params.get("w") ?? dayKey();
  const weekStart = dayKey(startOfWeek(fromKey(anchor)));
  const from = useMemo(() => fromKey(weekStart), [weekStart]);
  const to = useMemo(() => fromKey(shiftKey(weekStart, 7)), [weekStart]);
  const { events, error, google } = useEvents(from, to);
  const { prefs } = usePrefs();
  const tasks = useCollection<Task>("tasks");
  const days = Array.from({ length: 7 }, (_, i) => shiftKey(weekStart, i));

  const stats = useMemo(() => {
    if (!events) return null;
    const timed = events.filter(blocksTime);
    const byCat = new Map<Category | "google", number>();
    const perDay = days.map((k) => timed.reduce((s, e) => s + minutesOn(e, k), 0));
    for (const e of timed) {
      const c: Category | "google" = e.ours ? (e.category ?? "other") : "google";
      byCat.set(c, (byCat.get(c) ?? 0) + days.reduce((s, k) => s + minutesOn(e, k), 0));
    }
    const dayLen = ((prefs.dayEnd === "00:00" ? 1440 : Number(prefs.dayEnd.slice(0, 2)) * 60 + Number(prefs.dayEnd.slice(3))) - (Number(prefs.dayStart.slice(0, 2)) * 60 + Number(prefs.dayStart.slice(3)))) * 7;
    // Свободное — внутри активного дня, с учётом перерывов между событиями.
    const free = freeSlots(busyFromEvents(events), from, to, { ...prefs, buffer: 0 }).reduce((s, x) => s + (x.end - x.start), 0);
    const busiest = perDay.indexOf(Math.max(...perDay));
    const reminders = events.filter((e) => e.kind === "reminder").length;
    return { byCat, perDay, total: perDay.reduce((a, b) => a + b, 0), dayLen, free, busiest, reminders };
  }, [events, prefs]);

  const taskWeek = useMemo(() => {
    let doneMin = 0;
    let planned = 0;
    for (const t of tasks.items)
      for (const b of t.blocks)
        if (b.date >= weekStart && b.date < shiftKey(weekStart, 7)) {
          planned += b.minutes;
          if (b.done) doneMin += b.minutes;
        }
    const deadlines = tasks.items.filter((t) => !t.done && t.deadline >= weekStart && t.deadline < shiftKey(weekStart, 7));
    return { doneMin, planned, deadlines };
  }, [tasks.items, weekStart]);

  const go = (d: number) => setParams({ w: shiftKey(weekStart, d) });

  let body: ReactNode;
  if (!google) body = <Skeleton />;
  else if (!google.connected) body = <ConnectCard configured={google.configured} />;
  else if (error) body = <ErrorBox text={error} />;
  else if (!stats) body = <Skeleton rows={4} />;
  else {
    const cats = [...stats.byCat.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    body = (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Занято" value={`${h(stats.total)} ч`} />
          <Tile label="Свободно" value={`${h(stats.free)} ч`} hint={`из ${h(stats.dayLen)} ч активного времени`} />
          <Tile label="Загруженнее всего" value={stats.perDay[stats.busiest] > 0 ? WEEKDAYS[stats.busiest] : "—"} hint={stats.perDay[stats.busiest] > 0 ? `${h(stats.perDay[stats.busiest])} ч` : undefined} />
          <Tile label="Напоминаний" value={String(stats.reminders)} />
        </div>

        <Panel>
          <div className="mb-3 font-semibold">По дням, часов</div>
          <BarChart
            height={150}
            data={stats.perDay.map((m, i) => ({ label: WEEKDAYS[i], value: h(m), color: i === stats.busiest && m > 0 ? "#ff7ab8" : "#8b7bff" }))}
            format={(v) => `${v} ч`}
          />
          {stats.perDay.some((m) => m > 10 * 60) && (
            <div className="mt-3 text-sm text-[#ffd166]">
              ⚠ Есть дни больше 10 часов занятости: {stats.perDay.map((m, i) => (m > 600 ? WEEKDAYS[i] : null)).filter(Boolean).join(", ")}. Подумайте, что можно перенести.
            </div>
          )}
        </Panel>

        <Panel>
          <div className="mb-3 font-semibold">На что уходит время</div>
          {cats.length ? (
            <DonutChart
              data={cats.map(([c, v]) => ({
                label: c === "google" ? "📅 Другие события" : `${CATEGORIES[c].icon} ${CATEGORIES[c].label}`,
                value: h(v),
                color: c === "google" ? "#5c6380" : CATEGORIES[c].color,
              }))}
              center={<span className="text-lg font-bold">{h(stats.total)} ч</span>}
              format={(v) => `${v} ч`}
            />
          ) : (
            <div className="pl-muted text-sm">На этой неделе событий нет</div>
          )}
        </Panel>

        {(taskWeek.planned > 0 || taskWeek.deadlines.length > 0) && (
          <Panel className="space-y-1 text-sm">
            <div className="mb-1 font-semibold">Задачи</div>
            {taskWeek.planned > 0 && (
              <div>
                Работа над задачами: сделано {h(taskWeek.doneMin)} из {h(taskWeek.planned)} ч запланированного
              </div>
            )}
            {taskWeek.deadlines.map((t) => (
              <div key={t.id} className="pl-muted">
                ⏰ {t.title} — {dayLabel(t.deadline).toLowerCase()}
              </div>
            ))}
          </Panel>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="pl-title text-2xl sm:text-3xl">Статистика</h1>
          <div className="pl-muted text-sm">
            {fromKey(weekStart).getDate()}.{String(fromKey(weekStart).getMonth() + 1).padStart(2, "0")} — {fromKey(shiftKey(weekStart, 6)).getDate()}.
            {String(fromKey(shiftKey(weekStart, 6)).getMonth() + 1).padStart(2, "0")}
          </div>
        </div>
        <div className="flex gap-1.5">
          <Btn className="pl-icon-btn" aria-label="Предыдущая неделя" onClick={() => go(-7)}>
            ‹
          </Btn>
          <Btn className="pl-icon-btn" aria-label="Следующая неделя" onClick={() => go(7)}>
            ›
          </Btn>
        </div>
      </div>
      {body}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cn("pl-panel p-3")}>
      <div className="pl-muted text-xs">{label}</div>
      <div className="pl-title mt-0.5 text-xl">{value}</div>
      {hint && <div className="pl-muted text-xs">{hint}</div>}
    </div>
  );
}
