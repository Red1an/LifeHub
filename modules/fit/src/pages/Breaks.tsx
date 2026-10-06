import { formatRelative, Loading, useNavigate } from "@lifehub/sdk";
import { EX, EXERCISES } from "../data/library.ts";
import { ROUTINES, type Routine } from "../data/routines.ts";
import { useFit } from "../lib/store.ts";
import { Bar, Header, Pill, Screen, Section } from "../components/kit.tsx";
import { startRoutine } from "./Today.tsx";

const minutes = (r: Routine) => Math.max(1, Math.round(r.items.reduce((n, [id, sec]) => n + sec * (EX.get(id)?.sides ? 2 : 1), 0) / 60));

/** Случайная разминка у стола: шея, спина, ноги, кисти — по одному. */
function randomDesk(): Routine {
  const desk = EXERCISES.filter((e) => e.tags?.includes("desk"));
  const groups = [["neck", "upperback"], ["lowerback", "obliques", "chest"], ["quads", "glutes", "hams", "calves"], ["forearms", "delts"]];
  const items: Routine["items"] = [];
  for (const g of groups) {
    const pool = desk.filter((e) => e.muscles.some((m) => g.includes(m)) && !items.some(([id]) => id === e.id));
    const e = pool[Math.floor(Math.random() * pool.length)];
    if (e) items.push([e.id, e.mode === "reps" ? 30 : 40, e.mode === "reps" ? 10 : undefined]);
  }
  items.push(["eyes-20", 20]);
  return { id: "desk-random", kind: "break", title: "Случайная у стола", icon: "🎲", color: "#c8f031", text: "", items };
}

export function BreaksPage() {
  const fit = useFit();
  const nav = useNavigate();
  if (fit.loading) return <Screen><Loading /></Screen>;
  const go = (r: Routine) => { startRoutine(fit, r); nav("/play"); };
  const done = (r: Routine) => fit.hist.filter((w) => w.title === r.title).length;

  const Card = ({ r }: { r: Routine }) => (
    <button onClick={() => go(r)} className="ft-panel group relative w-full overflow-hidden p-4 text-left transition hover:-translate-y-0.5">
      <div className="absolute -right-8 -top-8 size-28 rounded-full opacity-20 blur-2xl transition group-hover:opacity-40" style={{ background: r.color }} />
      <div className="flex items-start gap-3">
        <div className="text-3xl">{r.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-extrabold">{r.title}</div>
            <Pill color={r.color}>{minutes(r)} мин</Pill>
          </div>
          <div className="text-sm text-[var(--ft-muted)]">{r.text}</div>
          <div className="mt-2 flex flex-wrap gap-1 text-lg">{r.items.map(([id], i) => <span key={i} title={EX.get(id)?.name}>{EX.get(id)?.icon}</span>)}</div>
          {done(r) > 0 && <div className="mt-1 text-[11px] text-[var(--ft-muted)]">сделано {done(r)} раз</div>}
        </div>
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--ft-lime)] text-[#0a0b0d]">▶</div>
      </div>
    </button>
  );

  return (
    <Screen>
      <Header title="Разминки" subtitle="Короткие комплексы для тех, кто много сидит" />

      <div className="ft-panel p-4">
        <div className="flex items-center justify-between">
          <div className="font-bold">Сегодня: {fit.breaksToday} из {fit.profile.breaksPerDay}</div>
          <div className="text-xs text-[var(--ft-muted)]">{fit.lastMoveAt ? `двигался ${formatRelative(fit.lastMoveAt)}` : "ещё не двигался"}</div>
        </div>
        <Bar value={fit.breaksToday / fit.profile.breaksPerDay} className="mt-2" color="var(--ft-cyan)" />
        <div className="mt-2 text-xs text-[var(--ft-muted)]">
          {fit.profile.remindEvery ? `Напомню каждые ${fit.profile.remindEvery} мин с ${fit.profile.workFrom}:00 до ${fit.profile.workTo}:00, пока хаб открыт.` : "Напоминания выключены — включить можно в настройках."}
        </div>
      </div>

      <button onClick={() => go(randomDesk())} className="ft-hero mt-4 flex w-full items-center gap-4 p-5 text-left">
        <div className="relative z-10 text-4xl">🎲</div>
        <div className="relative z-10 flex-1">
          <div className="ft-display text-lg font-extrabold">Размяться прямо сейчас</div>
          <div className="text-sm font-semibold opacity-75">~3 минуты, случайный набор: шея, спина, ноги, кисти</div>
        </div>
      </button>

      <Section title="🪑 У рабочего места">
        <div className="grid gap-3 sm:grid-cols-2">{ROUTINES.filter((r) => r.kind === "break").map((r) => <Card key={r.id} r={r} />)}</div>
      </Section>
      <Section title="🌅 Зарядка">
        <div className="grid gap-3 sm:grid-cols-2">{ROUTINES.filter((r) => r.kind === "morning").map((r) => <Card key={r.id} r={r} />)}</div>
      </Section>
      <Section title="🌙 Растяжка">
        <div className="grid gap-3 sm:grid-cols-2">{ROUTINES.filter((r) => r.kind === "stretch").map((r) => <Card key={r.id} r={r} />)}</div>
      </Section>

      <div className="mt-6 rounded-2xl bg-[var(--ft-panel)] p-4 text-sm text-[var(--ft-muted)]">
        💡 Исследования сидячей работы сходятся: важнее <b className="text-[var(--ft-fg)]">часто</b> прерывать сидение, чем один раз
        интенсивно потренироваться. 2–3 минуты движения каждые 30–60 минут заметно снижают вред от долгого сидения.
      </div>
    </Screen>
  );
}
