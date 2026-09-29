import { useState } from "react";
import { Link, Loading, useStore, formatDate, plural, confirm, cn, dayKey, addDays } from "@lifehub/sdk";
import { TRACKS, trackById, LEVEL_NAMES } from "../data/curriculum.ts";
import { useDev } from "../lib/store.ts";
import { PRESETS, goalFromPreset, goalTopics, type Goal } from "../lib/roadmap.ts";
import { Screen, Header, Panel, Btn, Bar, Ring, Pill } from "../components/kit.tsx";

export function GoalPage() {
  const dev = useDev();
  const [goal, setGoal] = useStore<Goal | null>("roadmap", null);
  const [editing, setEditing] = useState(false);
  if (dev.loading) return <Screen><Loading /></Screen>;
  if (!goal || editing) return <GoalEditor initial={goal} onSave={(g) => { setGoal(g); setEditing(false); }} onCancel={goal ? () => setEditing(false) : undefined} />;

  const r = dev.roadmap!;
  const pct = r.total ? r.done / r.total : 0;
  const expectedPct = r.total ? r.expected / r.total : 0;
  const week = r.weeks[r.currentWeek];
  const weekDone = week ? week.topics.filter((t) => r.isDone(t.id)).length : 0;
  const status =
    r.done >= r.total ? { t: "Цель достигнута! 🏆", c: "#34d399" } :
    r.lag <= 0 ? { t: r.lag < 0 ? `Опережаешь график на ${-r.lag} ${plural(-r.lag, ["тему", "темы", "тем"])} 🚀` : "Идёшь точно по графику ✅", c: "#34d399" } :
    r.lag <= r.perWeek ? { t: `Небольшое отставание: ${r.lag} ${plural(r.lag, ["тема", "темы", "тем"])}`, c: "#fbbf24" } :
    { t: `Отставание: ${r.lag} ${plural(r.lag, ["тема", "темы", "тем"])} — нужно наверстать`, c: "#f87171" };

  return (
    <Screen>
      <Header title="🧭 Моя цель" subtitle={goal.title} back="/" right={<Btn tone="ghost" className="!min-h-9 !px-3 text-sm" onClick={() => setEditing(true)}>Изменить</Btn>} />

      <Panel glow className="mb-4">
        <div className="flex items-center gap-4">
          <Ring value={pct} size={88} stroke={9} color="var(--dp-green)">
            <div className="text-center leading-tight">
              <div className="text-lg">{Math.round(pct * 100)}%</div>
              <div className="text-[10px] text-[var(--dp-muted)]">{r.done}/{r.total}</div>
            </div>
          </Ring>
          <div className="min-w-0 flex-1">
            <div className="font-bold" style={{ color: status.c }}>{status.t}</div>
            <div className="mt-1 text-sm text-[var(--dp-muted)]">
              До дедлайна {r.daysLeft} {plural(r.daysLeft, ["день", "дня", "дней"])} · {formatDate(goal.deadline, "long")}
            </div>
            {r.forecast && r.done < r.total && (
              <div className="mt-1 text-sm text-[var(--dp-muted)]">
                При текущем темпе закончишь {formatDate(r.forecast, "long")}
                {r.forecast > goal.deadline ? " — позже дедлайна" : " — успеваешь"}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <div className="flex justify-between text-xs text-[var(--dp-muted)]"><span>Факт</span><span>{r.done}</span></div>
          <Bar value={pct} color="var(--dp-green)" />
          <div className="flex justify-between text-xs text-[var(--dp-muted)]"><span>По графику к сегодня</span><span>{r.expected}</span></div>
          <Bar value={expectedPct} color="#475569" height={6} />
        </div>
        <div className="mt-3 text-xs text-[var(--dp-muted)]">
          Темп плана: {r.perWeek} {plural(r.perWeek, ["тема", "темы", "тем"])} в неделю. Тема считается пройденной, когда отмечена изученной — после урока и теста или вручную.
        </div>
      </Panel>

      {/* Недели */}
      <Panel className="mb-4">
        <div className="mb-2 font-bold">Недели</div>
        <div className="flex flex-wrap gap-1">
          {r.weeks.map((w) => {
            const d = w.topics.filter((t) => r.isDone(t.id)).length;
            const full = w.topics.length > 0 && d === w.topics.length;
            const past = w.index < r.currentWeek;
            return (
              <div
                key={w.index}
                title={`Неделя ${w.index + 1}: ${d}/${w.topics.length}`}
                className={cn("grid size-7 place-items-center rounded-md text-[10px] font-bold", w.index === r.currentWeek && "ring-2 ring-[var(--dp-violet)]")}
                style={{ background: full ? "#34d39966" : past ? (d ? "#fbbf2455" : "#f8717155") : d ? "#34d39933" : "#1b2440" }}
              >
                {w.index + 1}
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-[var(--dp-muted)]">🟩 выполнена · 🟨 частично · 🟥 пропущена · рамка — текущая</div>
      </Panel>

      {week && (
        <Panel className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-bold">Эта неделя · {week.index + 1} из {r.weeks.length}</div>
            <Pill color={weekDone === week.topics.length ? "#34d399" : undefined}>{weekDone}/{week.topics.length}</Pill>
          </div>
          <TopicList topics={week.topics} isDone={r.isDone} />
        </Panel>
      )}

      {r.lag > 0 && (
        <Panel className="mb-4 border-[#f87171]/40">
          <div className="mb-2 font-bold">⏰ Долги прошлых недель</div>
          <TopicList topics={r.weeks.slice(0, r.currentWeek).flatMap((w) => w.topics).filter((t) => !r.isDone(t.id))} isDone={r.isDone} />
        </Panel>
      )}

      <details className="dp-panel mb-4 p-4">
        <summary className="cursor-pointer font-bold">Весь план по неделям</summary>
        <div className="mt-3 space-y-4">
          {r.weeks.map((w) => (
            <div key={w.index}>
              <div className="mb-1 text-xs font-semibold text-[var(--dp-muted)]">
                Неделя {w.index + 1} · {formatDate(w.start, "short")} – {formatDate(w.end, "short")}
              </div>
              <TopicList topics={w.topics} isDone={r.isDone} compact />
            </div>
          ))}
        </div>
      </details>

      <button
        className="w-full text-center text-sm text-[var(--dp-muted)] hover:text-[var(--dp-red)]"
        onClick={async () => { if (await confirm("Удалить цель? Прогресс по темам останется.", { danger: true })) setGoal(null); }}
      >
        Удалить цель
      </button>
    </Screen>
  );
}

function TopicList({ topics, isDone, compact }: { topics: { id: string; title: string; trackId: string }[]; isDone: (id: string) => boolean; compact?: boolean }) {
  if (!topics.length) return <div className="text-sm text-[var(--dp-muted)]">Нет тем</div>;
  return (
    <div className={cn("space-y-1.5", compact && "space-y-1")}>
      {topics.map((t) => (
        <Link key={t.id} to={`/topic/${t.id}`} className={cn("flex items-center gap-2 rounded-xl bg-[var(--dp-panel-2)] px-3 text-sm transition hover:brightness-125", compact ? "py-1.5" : "py-2.5")}>
          <span>{isDone(t.id) ? "✅" : "⬜"}</span>
          <span className="text-base">{trackById(t.trackId)?.icon}</span>
          <span className={cn("min-w-0 flex-1 truncate", isDone(t.id) && "text-[var(--dp-muted)] line-through")}>{t.title}</span>
        </Link>
      ))}
    </div>
  );
}

function GoalEditor({ initial, onSave, onCancel }: { initial: Goal | null; onSave: (g: Goal) => void; onCancel?: () => void }) {
  const [g, setG] = useState<Goal>(initial ?? goalFromPreset(PRESETS[0]));
  const [custom, setCustom] = useState(!!initial);
  const count = goalTopics(g).length;
  const weeks = Math.max(1, Math.ceil((new Date(g.deadline).getTime() - new Date(g.start).getTime()) / (7 * 86_400_000)));

  return (
    <Screen>
      <Header title="🧭 Поставь цель" subtitle="План по неделям до дедлайна и контроль, успеваешь ли ты" back={onCancel ? undefined : "/"} />
      {!custom && (
        <div className="mb-4 grid gap-2">
          {PRESETS.map((p) => (
            <button key={p.id} className="dp-option flex items-start gap-3 !p-4" onClick={() => { setG(goalFromPreset(p)); setCustom(true); }}>
              <span className="text-3xl">{p.icon}</span>
              <span>
                <span className="block font-bold">{p.title}</span>
                <span className="block text-sm text-[var(--dp-muted)]">{p.text}</span>
              </span>
            </button>
          ))}
          <Btn tone="ghost" onClick={() => { setG({ ...g, title: "Моя цель" }); setCustom(true); }}>Своя цель</Btn>
        </div>
      )}
      {custom && (
        <Panel>
          <label className="block text-sm">
            <div className="mb-1 font-semibold">Название</div>
            <input className="dp-input" value={g.title} onChange={(e) => setG({ ...g, title: e.target.value })} />
          </label>
          <div className="mt-4 mb-1 text-sm font-semibold">Треки</div>
          <div className="flex flex-wrap gap-2">
            {TRACKS.map((t) => {
              const on = g.tracks.includes(t.id);
              return (
                <button
                  key={t.id}
                  className={cn("rounded-full border px-3 py-1.5 text-sm transition", on ? "border-[var(--dp-violet)] bg-[var(--dp-violet)]/20" : "border-[var(--dp-line)] text-[var(--dp-muted)]")}
                  onClick={() => setG({ ...g, tracks: on ? g.tracks.filter((x) => x !== t.id) : [...g.tracks, t.id] })}
                >
                  {t.icon} {t.title}
                </button>
              );
            })}
          </div>
          <div className="mt-4 mb-1 text-sm font-semibold">Глубина</div>
          <div className="grid grid-cols-3 gap-2">
            {([1, 2, 3] as const).map((l) => (
              <button key={l} className="dp-option !p-2.5 text-center text-sm" data-state={g.level === l ? "selected" : undefined} onClick={() => setG({ ...g, level: l })}>
                до {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="mb-1 font-semibold">Начало</div>
              <input type="date" className="dp-input" value={g.start} onChange={(e) => e.target.value && setG({ ...g, start: e.target.value })} />
            </label>
            <label className="text-sm">
              <div className="mb-1 font-semibold">Дедлайн</div>
              <input type="date" className="dp-input" value={g.deadline} min={dayKey(addDays(new Date(g.start), 7))} onChange={(e) => e.target.value && setG({ ...g, deadline: e.target.value })} />
            </label>
          </div>
          <div className="mt-4 rounded-2xl bg-[var(--dp-panel-2)] p-3 text-sm">
            {count} {plural(count, ["тема", "темы", "тем"])} за {weeks} {plural(weeks, ["неделю", "недели", "недель"])} —
            <b> {Math.ceil(count / weeks)} {plural(Math.ceil(count / weeks), ["тема", "темы", "тем"])} в неделю</b>.
            {count / weeks > 5 && <div className="mt-1 text-[var(--dp-gold)]">⚠️ Это интенсивный темп (≈1 час в день и больше). Можно сдвинуть дедлайн или сузить треки.</div>}
          </div>
          <div className="mt-4 flex gap-2">
            {(onCancel || !initial) && <Btn tone="ghost" onClick={() => (onCancel ? onCancel() : setCustom(false))}>Назад</Btn>}
            <Btn className="flex-1" disabled={!g.tracks.length || !count || !g.title.trim()} onClick={() => onSave(g)}>Сохранить цель</Btn>
          </div>
        </Panel>
      )}
    </Screen>
  );
}
