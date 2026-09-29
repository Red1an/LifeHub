import { useEffect, useRef } from "react";
import { dayKey, Link, Loading, plural, useCollection, cn } from "@lifehub/sdk";
import { useDev, type Dev } from "../lib/store.ts";
import { buildPlan } from "../lib/daily.ts";
import type { DayPlan } from "../lib/types.ts";
import { Screen, Panel, Bar, Ring, Pill, Tile, Btn } from "../components/kit.tsx";
import { TRACKS } from "../data/curriculum.ts";

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Ночной кодинг? 🌙" : h < 12 ? "Доброе утро ☀️" : h < 18 ? "Добрый день 👋" : "Добрый вечер 🌆";
};

export function Today() {
  const dev = useDev();
  const today = dayKey();
  const days = useCollection<DayPlan>("days");
  const plan = { doc: days.items.find((d) => d.id === today), loading: days.loading, update: (p: DayPlan) => days.put(today, p) };
  const creating = useRef(false);

  useEffect(() => {
    if (dev.loading || plan.loading || plan.doc || creating.current) return;
    creating.current = true;
    void plan.update({ quests: buildPlan(dev) }).catch(() => {}).finally(() => (creating.current = false));
  }, [dev.loading, plan.loading, plan.doc]);

  if (dev.loading || plan.loading) return <Screen><Loading /></Screen>;

  const quests = plan.doc?.quests ?? [];
  const done = quests.filter((q) => q.done).length;
  const goalP = dev.todayXp / dev.settings.goal;
  const { rank, next, progress } = dev.rank;
  const newbie = dev.topics.items.length === 0;

  const refresh = async () => {
    const fresh = buildPlan(dev);
    const doneIds = new Set(quests.filter((q) => q.done).map((q) => q.id));
    await plan.update({ quests: fresh.map((q) => ({ ...q, done: doneIds.has(q.id) })) });
  };

  return (
    <Screen>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-[var(--dp-muted)]">{greeting()}</div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="dp-grad-text">DevPath</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Pill color="#fb923c" className="!px-3 !py-1.5 !text-sm">
            <span className={cn(dev.streak > 0 && "dp-flame")}>🔥</span> {dev.streak}
          </Pill>
          <Pill color="#fbbf24" className="!px-3 !py-1.5 !text-sm">⚡ {dev.xp}</Pill>
        </div>
      </div>

      {/* Ранг и цель дня */}
      <Panel glow className="mb-5 flex items-center gap-4">
        <Ring value={goalP} size={76} stroke={8} color={goalP >= 1 ? "var(--dp-green)" : "var(--dp-violet)"}>
          <div className="text-center leading-tight">
            <div className="text-base">{dev.todayXp}</div>
            <div className="text-[10px] font-medium text-[var(--dp-muted)]">/ {dev.settings.goal}</div>
          </div>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-lg font-bold">
            <span className="text-2xl">{rank.icon}</span> {rank.title}
          </div>
          <Bar value={progress} className="mt-2" color="linear-gradient(90deg,#8b5cf6,#22d3ee)" />
          <div className="mt-1 text-xs text-[var(--dp-muted)]">
            {next ? `${next.xp - dev.xp} XP до ранга ${next.icon} ${next.title}` : "Максимальный ранг!"}
            {goalP >= 1 ? " · цель дня выполнена ✅" : ` · до цели дня ${dev.settings.goal - dev.todayXp} XP`}
          </div>
        </div>
      </Panel>

      <GoalCard dev={dev} />

      {newbie && (
        <Panel className="mb-5 border-[var(--dp-violet)]/50">
          <div className="text-lg font-bold">Добро пожаловать! 🚀</div>
          <p className="mt-1 text-sm text-[var(--dp-muted)]">
            Каждый день здесь появляются задания: урок новой темы, повторение карточек, практика, «найди баг» и вопрос с собеседования.
            Выполняй цель дня — растёт серия и ранг. Сначала выбери треки, на которых сфокусироваться, и свой уровень.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/profile" className="dp-btn dp-btn-primary">Настроить фокус</Link>
            <Link to="/map" className="dp-btn dp-btn-ghost">Смотреть карту знаний</Link>
          </div>
        </Panel>
      )}

      {/* Квесты дня */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">
          Задания дня <span className="text-[var(--dp-muted)]">{done}/{quests.length}</span>
        </h2>
        <button className="text-sm text-[var(--dp-muted)] hover:text-white" onClick={refresh}>
          ↻ обновить
        </button>
      </div>
      <div className="space-y-3">
        {quests.map((q, k) => (
          <Link
            key={q.id}
            to={q.to}
            className={cn("dp-panel dp-slide flex items-center gap-3 p-3.5 transition hover:-translate-y-0.5", q.done && "opacity-60")}
            style={{ animationDelay: `${k * 60}ms` }}
          >
            <div className={cn("grid size-12 shrink-0 place-items-center rounded-2xl text-2xl", q.done ? "bg-[var(--dp-green)]/20" : "bg-[var(--dp-panel-2)]")}>
              {q.done ? "✅" : q.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className={cn("truncate font-semibold", q.done && "line-through")}>{q.title}</div>
              <div className="truncate text-sm text-[var(--dp-muted)]">{q.subtitle}</div>
            </div>
            <Pill color="#fbbf24">+{q.xp}</Pill>
          </Link>
        ))}
        {quests.length === 0 && (
          <Panel className="text-center text-[var(--dp-muted)]">
            Заданий нет — выбери треки в фокусе в профиле или открой любую тему на карте.
          </Panel>
        )}
      </div>
      {quests.length > 0 && done === quests.length && (
        <Panel className="dp-pop mt-4 text-center">
          <div className="text-4xl">🏆</div>
          <div className="mt-1 font-bold">Все задания дня выполнены!</div>
          <div className="text-sm text-[var(--dp-muted)]">Хочешь ещё — загляни на Арену.</div>
        </Panel>
      )}

      {/* Быстрые действия */}
      <h2 className="mb-3 mt-7 text-lg font-bold">Быстро</h2>
      <div className="grid grid-cols-2 gap-3">
        <Tile to="/review" icon="🔁" title="Карточки" text={`${dev.due.length} к повторению · ${dev.fresh.length} новых`} color="#8b5cf6" />
        <Tile to="/arena" icon="⚔️" title="Арена" text="Блиц, баги, боссы" color="#f43f5e" />
        <Tile to="/mentor" icon="💬" title="Наставник" text="Спросить что угодно" color="#22d3ee" />
        <Tile to="/map" icon="🗺️" title="Карта" text={`${TRACKS.length} треков знаний`} color="#34d399" />
      </div>

      <Panel className="mt-5 flex items-center gap-3 !p-3">
        <div className="text-2xl">🎯</div>
        <div className="flex-1 text-sm text-[var(--dp-muted)]">
          Выучено надолго: <b className="text-white">{dev.learned}</b> {plural(dev.learned, ["карточка", "карточки", "карточек"])} · тем закрыто:{" "}
          <b className="text-white">{dev.topics.items.filter((t) => t.status === "done").length}</b>
        </div>
        <Link to="/profile"><Btn tone="ghost" className="!min-h-9 !px-3 text-sm">Прогресс</Btn></Link>
      </Panel>
    </Screen>
  );
}

/** Карточка цели: прогресс против графика. Без цели — предложение её поставить. */
function GoalCard({ dev }: { dev: Dev }) {
  const r = dev.roadmap;
  if (!dev.goal || !r) {
    return (
      <Link to="/goal" className="dp-panel mb-5 flex items-center gap-3 p-4 transition hover:-translate-y-0.5">
        <div className="text-3xl">🧭</div>
        <div className="min-w-0 flex-1">
          <div className="font-bold">Поставь цель</div>
          <div className="text-sm text-[var(--dp-muted)]">«Senior .NET за 6 месяцев» — план по неделям и контроль отставания</div>
        </div>
        <span className="text-[var(--dp-muted)]">→</span>
      </Link>
    );
  }
  const color = r.done >= r.total || r.lag <= 0 ? "#34d399" : r.lag <= r.perWeek ? "#fbbf24" : "#f87171";
  return (
    <Link to="/goal" className="dp-panel mb-5 block p-4 transition hover:-translate-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate font-bold">🧭 {dev.goal.title}</div>
        <Pill color={color}>{r.done >= r.total ? "готово" : r.lag > 0 ? `отстаёшь на ${r.lag}` : r.lag < 0 ? `впереди на ${-r.lag}` : "по графику"}</Pill>
      </div>
      <Bar value={r.total ? r.done / r.total : 0} className="mt-2" color={color} />
      <div className="mt-1 text-xs text-[var(--dp-muted)]">
        {r.done}/{r.total} тем · неделя {r.currentWeek + 1} из {r.weeks.length} · осталось {r.daysLeft} {plural(r.daysLeft, ["день", "дня", "дней"])}
      </div>
    </Link>
  );
}
