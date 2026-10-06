import { dayKey, formatRelative, Link, Loading, useCollection, useNavigate, useStore } from "@lifehub/sdk";
import { CATALOG, EX, EXERCISES } from "../data/library.ts";
import { dailyMorning, type Length } from "../data/morning.ts";
import { ROUTINES, type Routine } from "../data/routines.ts";
import { myRoutineSeconds, myWorkout, KINDS, type MyRoutine } from "../lib/custom.ts";
import { unlockAudio } from "../lib/sfx.ts";
import { useFit } from "../lib/store.ts";
import { Bar, Chip, Header, Pill, Screen, Section } from "../components/kit.tsx";
import { ExThumb } from "../components/Visual.tsx";
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

/** Настройки зарядки дня: длина и «перемешать» (номер варианта на сегодня). */
export function useMorning() {
  const [opts, setOpts, meta] = useStore<{ length: Length; day?: string; shuffle?: number }>("morningOpts", { length: 10 });
  const today = dayKey();
  const shuffle = opts.day === today ? opts.shuffle ?? 0 : 0;
  return {
    loading: meta.loading,
    length: opts.length,
    setLength: (length: Length) => setOpts({ ...opts, length }),
    reshuffle: () => setOpts({ ...opts, day: today, shuffle: shuffle + 1 }),
    routine: (limits: Parameters<typeof dailyMorning>[2]) => dailyMorning(today, opts.length, limits, shuffle),
  };
}

export function BreaksPage() {
  const fit = useFit();
  const nav = useNavigate();
  const mine = useCollection<MyRoutine>("mine");
  const m = useMorning();
  if (fit.loading || m.loading) return <Screen><Loading /></Screen>;
  const daily = m.routine(fit.profile.limits);
  const startMine = (r: MyRoutine) => { unlockAudio(); fit.setActive({ w: myWorkout(r, fit.profile, fit.hist), step: 0 }); nav("/play"); };
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

      <Section title="⭐ Мои комплексы" right={<Link to="/catalog" className="text-sm font-bold text-[var(--ft-lime)]">каталог →</Link>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {mine.items.map((r) => (
            <div key={r.id} className="ft-panel flex items-center gap-3 p-3">
              <Link to={`/my/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="text-3xl">{r.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold">{r.title}</span>
                  <span className="block truncate text-xs text-[var(--ft-muted)]">
                    {KINDS.find((k) => k.kind === r.kind)?.name} · {r.items.length} упр. · ~{Math.max(1, Math.round(myRoutineSeconds(r) / 60))} мин
                  </span>
                </span>
              </Link>
              <button onClick={() => startMine(r)} className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--ft-lime)] text-[#0a0b0d]" aria-label="Начать">▶</button>
            </div>
          ))}
          <Link to="/my/new" className="ft-panel flex items-center gap-3 border-dashed p-3 text-[var(--ft-lime)]">
            <span className="text-2xl">＋</span>
            <span>
              <span className="block font-bold">Собрать свой</span>
              <span className="block text-xs text-[var(--ft-muted)]">из {CATALOG.length} упражнений каталога</span>
            </span>
          </Link>
        </div>
      </Section>

      <Section title="🪑 У рабочего места">
        <div className="grid gap-3 sm:grid-cols-2">{ROUTINES.filter((r) => r.kind === "break").map((r) => <Card key={r.id} r={r} />)}</div>
      </Section>
      <Section title="🌅 Зарядка — всё стоя, без пола">
        <div className="ft-panel relative mb-3 overflow-hidden p-4">
          <div className="absolute -right-10 -top-10 size-36 rounded-full bg-[#fbbf24] opacity-20 blur-2xl" />
          <div className="relative flex items-start gap-3">
            <div className="text-4xl">🌞</div>
            <div className="min-w-0 flex-1">
              <div className="ft-display font-extrabold">Зарядка дня</div>
              <div className="text-sm text-[var(--ft-muted)]">Каждый день новая: суставы сверху вниз, разогрев и пара силовых</div>
            </div>
          </div>
          <div className="relative mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {daily.items.map(([id], i) => { const e = EX.get(id); return e ? <ExThumb key={i} ex={e} className="size-11" /> : null; })}
          </div>
          <div className="relative mt-3 flex flex-wrap items-center gap-2">
            {([5, 10, 15] as Length[]).map((l) => <Chip key={l} on={m.length === l} onClick={() => m.setLength(l)} className="!min-h-9">{l} мин</Chip>)}
            <button className="text-sm font-bold text-[var(--ft-lime)]" onClick={m.reshuffle}>🔀 другая</button>
            <div className="flex-1" />
            <button onClick={() => go(daily)} className="ft-btn ft-btn-lime !min-h-10">▶ Начать</button>
          </div>
        </div>
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
