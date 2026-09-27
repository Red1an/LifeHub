import { useMemo, useState } from "react";
import {
  defineModule, Page, Section, Card, Button, Input, Field, Modal, EmptyState, Heatmap, Loading, IconButton, Badge,
  useCollection, useParams, useNavigate, Link, confirm, dayKey, addDays, plural, cn,
} from "@lifehub/sdk";

interface Habit {
  name: string;
  icon: string;
  /** Дни недели: 0 = понедельник … 6 = воскресенье. Пусто — каждый день. */
  days: number[];
  archived?: boolean;
}

interface Check {
  habitId: string;
  date: string;
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const weekday = (d: Date) => (d.getDay() + 6) % 7;
const isPlanned = (h: Habit, d: Date) => !h.days?.length || h.days.includes(weekday(d));

/** Серия: сколько запланированных дней подряд выполнено (сегодня можно ещё не отметить). */
function streak(h: Habit & { id: string }, done: Set<string>) {
  let n = 0;
  let d = new Date();
  if (!done.has(`${h.id}_${dayKey(d)}`)) d = addDays(d, -1);
  for (let i = 0; i < 400; i++) {
    if (isPlanned(h, d)) {
      if (!done.has(`${h.id}_${dayKey(d)}`)) break;
      n++;
    }
    d = addDays(d, -1);
  }
  return n;
}

function useHabits() {
  const habits = useCollection<Habit>("habits");
  const checks = useCollection<Check>("checks");
  const done = useMemo(() => new Set(checks.items.map((c) => c.id)), [checks.items]);
  const toggle = async (habitId: string, date: string) => {
    const id = `${habitId}_${date}`;
    if (done.has(id)) await checks.remove(id);
    else await checks.put(id, { habitId, date });
  };
  return { habits, checks, done, toggle, loading: habits.loading || checks.loading };
}

function Today() {
  const { habits, done, toggle, loading } = useHabits();
  const [creating, setCreating] = useState(false);
  const today = new Date();
  const key = dayKey(today);
  const active = habits.items.filter((h) => !h.archived);
  const planned = active.filter((h) => isPlanned(h, today));
  const other = active.filter((h) => !isPlanned(h, today));
  const completed = planned.filter((h) => done.has(`${h.id}_${key}`)).length;

  // Последние 7 дней для полоски под каждой привычкой.
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  const row = (h: Habit & { id: string }) => {
    const isDone = done.has(`${h.id}_${key}`);
    const s = streak(h, done);
    return (
      <Card key={h.id} padding="sm" className="flex items-center gap-3">
        <button
          onClick={() => toggle(h.id, key)}
          aria-label={isDone ? "Снять отметку" : "Отметить"}
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-2xl text-2xl transition active:scale-90",
            isDone ? "bg-accent text-accent-fg shadow" : "bg-surface-2 grayscale-[0.6]",
          )}
        >
          {isDone ? "✓" : h.icon}
        </button>
        <Link to={`/h/${h.id}`} className="min-w-0 flex-1">
          <div className={cn("truncate font-medium", isDone && "text-muted line-through")}>{h.name}</div>
          <div className="mt-1 flex gap-1">
            {week.map((d) => (
              <span
                key={d.toISOString()}
                className={cn(
                  "size-2 rounded-full",
                  done.has(`${h.id}_${dayKey(d)}`) ? "bg-accent" : isPlanned(h, d) ? "bg-line" : "bg-transparent border border-line",
                )}
              />
            ))}
          </div>
        </Link>
        {s > 0 && (
          <Badge tone="warning">
            🔥 {s} {plural(s, ["день", "дня", "дней"])}
          </Badge>
        )}
      </Card>
    );
  };

  return (
    <Page
      title="Сегодня"
      subtitle={planned.length ? `Выполнено ${completed} из ${planned.length}` : undefined}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Привычка
        </Button>
      }
    >
      {loading ? (
        <Loading />
      ) : active.length === 0 ? (
        <EmptyState
          icon="🌱"
          title="Начните с одной привычки"
          text="Маленькие ежедневные действия — стакан воды утром, 10 минут чтения, зарядка."
          action={<Button variant="primary" onClick={() => setCreating(true)}>Добавить привычку</Button>}
        />
      ) : (
        <>
          <div className="space-y-2">{planned.map(row)}</div>
          {other.length > 0 && (
            <Section title="Не сегодня" className="mt-7">
              <div className="space-y-2 opacity-70">{other.map(row)}</div>
            </Section>
          )}
        </>
      )}
      <HabitModal open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

function HabitModal({ open, onClose, habit }: { open: boolean; onClose: () => void; habit?: Habit & { id: string } }) {
  if (!open) return null;
  return <HabitForm key={habit?.id ?? "new"} onClose={onClose} habit={habit} />;
}

function HabitForm({ onClose, habit }: { onClose: () => void; habit?: Habit & { id: string } }) {
  const habits = useCollection<Habit>("habits");
  const [name, setName] = useState(habit?.name ?? "");
  const [icon, setIcon] = useState(habit?.icon ?? "💧");
  const [days, setDays] = useState<number[]>(habit?.days ?? []);
  const save = async () => {
    if (!name.trim()) return;
    const data = { name: name.trim(), icon: icon || "⭐", days };
    if (habit) await habits.update(habit.id, data);
    else await habits.add(data);
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={habit ? "Привычка" : "Новая привычка"}
      footer={
        <Button variant="primary" onClick={save} disabled={!name.trim()}>
          Сохранить
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid grid-cols-[72px_1fr] gap-3">
          <Field label="Иконка">
            <Input value={icon} onChange={(e) => setIcon(e.target.value)} className="text-center text-xl" />
          </Field>
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Выпить стакан воды" />
          </Field>
        </div>
        <Field label="Дни" hint={days.length ? undefined : "Каждый день"}>
          <div className="flex gap-1.5">
            {WEEKDAYS.map((w, i) => (
              <button
                key={w}
                type="button"
                onClick={() => setDays(days.includes(i) ? days.filter((d) => d !== i) : [...days, i].sort())}
                className={cn(
                  "h-10 flex-1 rounded-xl border text-sm font-medium transition",
                  days.includes(i) ? "border-accent bg-accent-soft text-accent" : "border-line",
                )}
              >
                {w}
              </button>
            ))}
          </div>
        </Field>
      </form>
    </Modal>
  );
}

function HabitDetails() {
  const { id } = useParams<{ id: string }>();
  const { habits, checks, done, toggle, loading } = useHabits();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const habit = habits.items.find((h) => h.id === id);
  if (loading) return <Loading />;
  if (!habit) return <Page back="/"><EmptyState icon="🤷" title="Привычка не найдена" /></Page>;

  const values: Record<string, number> = {};
  for (const c of checks.items) if (c.habitId === id) values[c.date] = 1;
  const total = Object.keys(values).length;
  const s = streak(habit, done);

  let best = 0;
  let cur = 0;
  for (let d = addDays(new Date(), -365); d <= new Date(); d = addDays(d, 1)) {
    if (!isPlanned(habit, d)) continue;
    cur = done.has(`${habit.id}_${dayKey(d)}`) ? cur + 1 : 0;
    best = Math.max(best, cur);
  }

  return (
    <Page
      back="/"
      title={
        <span>
          {habit.icon} {habit.name}
        </span>
      }
      subtitle={habit.days?.length ? habit.days.map((d) => WEEKDAYS[d]).join(", ") : "каждый день"}
      actions={
        <>
          <IconButton label="Изменить" onClick={() => setEditing(true)}>
            ✏️
          </IconButton>
          <IconButton
            label="В архив"
            onClick={async () => {
              if (await confirm("Убрать привычку в архив? Отметки сохранятся.")) {
                await habits.update(habit.id, { archived: true });
                navigate("/");
              }
            }}
          >
            🗄️
          </IconButton>
        </>
      }
    >
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Card className="text-center">
          <div className="text-2xl font-semibold">{s}</div>
          <div className="text-xs text-muted">серия сейчас</div>
        </Card>
        <Card className="text-center">
          <div className="text-2xl font-semibold">{best}</div>
          <div className="text-xs text-muted">лучшая серия</div>
        </Card>
        <Card className="text-center">
          <div className="text-2xl font-semibold">{total}</div>
          <div className="text-xs text-muted">всего раз</div>
        </Card>
      </div>
      <Section title="Последние 4 месяца">
        <Card>
          <Heatmap values={values} weeks={17} />
        </Card>
      </Section>
      <Section title="Отметить прошедший день">
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 14 }, (_, i) => addDays(new Date(), i - 13)).map((d) => {
            const k = dayKey(d);
            const isDone = done.has(`${habit.id}_${k}`);
            return (
              <button
                key={k}
                onClick={() => toggle(habit.id, k)}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center rounded-xl border text-xs transition",
                  isDone ? "border-accent bg-accent text-accent-fg" : "border-line",
                  !isPlanned(habit, d) && !isDone && "opacity-40",
                )}
              >
                <span>{WEEKDAYS[weekday(d)]}</span>
                <span className="font-semibold">{d.getDate()}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <HabitModal open={editing} onClose={() => setEditing(false)} habit={habit} />
    </Page>
  );
}

function Archive() {
  const habits = useCollection<Habit>("habits");
  const archived = habits.items.filter((h) => h.archived);
  return (
    <Page title="Архив">
      {archived.length === 0 ? (
        <EmptyState icon="🗄️" title="Архив пуст" />
      ) : (
        <div className="space-y-2">
          {archived.map((h) => (
            <Card key={h.id} padding="sm" className="flex items-center gap-3">
              <span className="text-2xl">{h.icon}</span>
              <span className="flex-1">{h.name}</span>
              <Button size="sm" onClick={() => habits.update(h.id, { archived: false })}>
                Вернуть
              </Button>
              <IconButton
                label="Удалить"
                onClick={async () => {
                  if (await confirm(`Удалить «${h.name}» навсегда?`, { danger: true })) await habits.remove(h.id);
                }}
              >
                ✕
              </IconButton>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

function TodayWidget() {
  const { habits, done, toggle, loading } = useHabits();
  if (loading) return null;
  const key = dayKey();
  const planned = habits.items.filter((h) => !h.archived && isPlanned(h, new Date()));
  if (!planned.length) return <p className="text-sm text-muted">На сегодня привычек нет</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {planned.map((h) => {
        const isDone = done.has(`${h.id}_${key}`);
        return (
          <button
            key={h.id}
            onClick={() => toggle(h.id, key)}
            title={h.name}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition active:scale-95",
              isDone ? "border-accent bg-accent text-accent-fg" : "border-line",
            )}
          >
            <span>{isDone ? "✓" : h.icon}</span>
            <span className="max-w-32 truncate">{h.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export default defineModule({
  routes: {
    "/": Today,
    "/h/:id": HabitDetails,
    "/archive": Archive,
  },
  nav: [
    { to: "/", label: "Сегодня", icon: "✅" },
    { to: "/archive", label: "Архив", icon: "🗄️" },
  ],
  widgets: {
    today: { title: "Привычки на сегодня", size: "md", component: TodayWidget },
  },
});
