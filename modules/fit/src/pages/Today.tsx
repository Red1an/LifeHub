import { useMemo } from "react";
import { addDays, cn, dayKey, formatRelative, Link, Loading, startOfWeek, useNavigate } from "@lifehub/sdk";
import { EX } from "../data/library.ts";
import { ROUTINES, type Routine } from "../data/routines.ts";
import { recovery, FOCUS_INFO, type Hist } from "../lib/analysis.ts";
import { achievements } from "../lib/game.ts";
import { routineWorkout, useFit, type Fit } from "../lib/store.ts";
import { unlockAudio } from "../lib/sfx.ts";
import { BodyMap } from "../components/BodyMap.tsx";
import { Bar, Btn, Pill, Ring, Screen, Section, Tile } from "../components/kit.tsx";
import { useDraft } from "./Build.tsx";
import { useMorning } from "./Breaks.tsx";
import { Welcome } from "./Welcome.tsx";

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Не спится? 🌙" : h < 12 ? "Доброе утро ☀️" : h < 18 ? "Добрый день 👋" : "Добрый вечер 🌆";
};

/** Разминка, которую давно не делали (зарядка — по утрам). */
export function pickRoutine(hist: Hist[], kind: Routine["kind"]): Routine {
  const list = ROUTINES.filter((r) => r.kind === kind);
  const lastAt = (r: Routine) => hist.filter((w) => w.title === r.title).reduce((m, w) => Math.max(m, w.finishedAt ?? 0), 0);
  return [...list].sort((a, b) => lastAt(a) - lastAt(b))[0];
}

export function startRoutine(fit: Fit, r: Routine) {
  unlockAudio();
  fit.setActive({ w: { ...routineWorkout(r), startedAt: Date.now() }, step: 0 });
}

export function Today() {
  const fit = useFit();
  const nav = useNavigate();
  const d = useDraft(fit);
  const rec = useMemo(() => recovery(fit.hist), [fit.hist]);
  const m = useMorning();

  if (fit.loading || m.loading) return <Screen><Loading /></Screen>;
  if (!fit.profile.onboarded) return <Welcome />;

  const { rank, next, progress } = fit.rank;
  const goalP = fit.week.thisWeek / fit.profile.perWeek;
  const breaksP = fit.breaksToday / fit.profile.breaksPerDay;
  const morning = new Date().getHours() < 11;
  const breakR = pickRoutine(fit.hist, "break");
  const morningR = m.routine(fit.profile.limits);
  const stretchR = pickRoutine(fit.hist, "stretch");
  const sinceMove = fit.lastMoveAt ? Date.now() - fit.lastMoveAt : Infinity;
  const nextAch = achievements(fit.hist, fit.week.streak, fit.days, fit.levels).filter((a) => !a.done).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0];

  const go = (r: Routine) => { startRoutine(fit, r); nav("/play"); };
  const main = d.w?.items.filter((i) => i.block === "main") ?? [];

  return (
    <Screen>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-[var(--ft-muted)]">{greeting()}</div>
          <h1 className="ft-display text-3xl font-extrabold"><span className="ft-grad-text">Форма</span></h1>
        </div>
        <div className="flex items-center gap-2">
          <Pill color="#ff7a2f" className="!px-3 !py-1.5 !text-sm" >
            <span className={cn(fit.days > 0 && "ft-flame")}>🔥</span> {fit.days}
          </Pill>
          <Link to="/profile" className="ft-btn ft-btn-ghost !min-h-9 !px-2.5" aria-label="Настройки">⚙️</Link>
        </div>
      </div>

      {/* Кольца недели и дня */}
      <div className="ft-panel mb-4 grid grid-cols-3 gap-2 p-4">
        <RingStat value={goalP} color="var(--ft-lime)" big={`${fit.week.thisWeek}/${fit.profile.perWeek}`} label="тренировок за неделю" />
        <RingStat value={breaksP} color="var(--ft-cyan)" big={`${fit.breaksToday}/${fit.profile.breaksPerDay}`} label="разминок сегодня" />
        <RingStat value={fit.minutesWeek / 150} color="var(--ft-orange)" big={`${fit.minutesWeek}`} label="мин из 150 (норма ВОЗ)" />
      </div>

      <WeekStrip hist={fit.hist} />

      {fit.active && (
        <Link to="/play" className="ft-panel ft-pulse mt-4 flex items-center gap-3 border-[var(--ft-orange)]/60 p-4">
          <span className="text-3xl">⏯️</span>
          <div className="min-w-0 flex-1">
            <div className="font-extrabold">Продолжить: {fit.active.w.title}</div>
            <div className="text-sm text-[var(--ft-muted)]">Тренировка не закончена</div>
          </div>
          <span className="text-xl text-[var(--ft-orange)]">→</span>
        </Link>
      )}

      {/* Тренировка дня */}
      <div className="ft-hero mt-4 p-5">
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <div className="text-xs font-extrabold uppercase tracking-widest opacity-70">Тренировка дня</div>
            <div className="text-xs font-bold opacity-70">{fit.place.icon} {fit.place.name} · {d.opts.minutes} мин</div>
          </div>
          <div className="ft-display mt-2 text-2xl font-extrabold leading-tight">
            {d.w?.focus ? `${FOCUS_INFO[d.w.focus].icon} ${FOCUS_INFO[d.w.focus].title}` : "Подбираю…"}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {main.slice(0, 6).map((it, i) => (
              <span key={i} className="rounded-full bg-black/10 px-2.5 py-1 text-xs font-bold">{EX.get(it.ex)?.icon} {EX.get(it.ex)?.name}</span>
            ))}
            {main.length > 6 && <span className="rounded-full bg-black/10 px-2.5 py-1 text-xs font-bold">+{main.length - 6}</span>}
          </div>
          <div className="mt-4 flex gap-2">
            <Btn tone="dark" className="flex-1 !min-h-12" disabled={!d.w} onClick={() => { d.start(d.w!); nav("/play"); }}>▶ Начать</Btn>
            <Link to="/build" className="ft-btn !min-h-12 bg-black/10 font-bold">Изменить</Link>
          </div>
        </div>
      </div>

      {/* Разминки */}
      <Section title="Движение между делом" right={<Link to="/breaks" className="text-sm font-bold text-[var(--ft-lime)]">все →</Link>}>
        {sinceMove > 60 * 60_000 && new Date().getHours() >= fit.profile.workFrom && new Date().getHours() < fit.profile.workTo && (
          <div className="mb-3 rounded-2xl bg-[var(--ft-cyan)]/10 px-4 py-3 text-sm">
            🪑 {fit.lastMoveAt ? `Последняя активность ${formatRelative(fit.lastMoveAt)}.` : "Сегодня ещё не двигался."} Встань на 3 минуты — спина скажет спасибо.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Tile onClick={() => go(breakR)} icon={breakR.icon} title={`У стола: ${breakR.title}`} text={`${Math.round(breakR.items.reduce((n, i) => n + i[1], 0) / 60)} мин · ${breakR.text}`} color={breakR.color} />
          {morning
            ? <Tile onClick={() => go(morningR)} icon={morningR.icon} title="Зарядка дня" text={`${m.length} мин стоя, каждый день новая`} color={morningR.color} />
            : <Tile onClick={() => go(stretchR)} icon={stretchR.icon} title={stretchR.title} text={stretchR.text} color={stretchR.color} />}
          <Tile to="/coach" icon="🤖" title="Тренер" text="Опиши ситуацию — соберёт тренировку" color="#a78bfa" />
          <Tile to="/catalog" icon="📚" title="Упражнения" text="Сотни упражнений по мышцам — собери своё" color="#ff7a2f" />
        </div>
      </Section>

      {/* Восстановление */}
      <Section title="Восстановление мышц" right={<span className="text-xs text-[var(--ft-muted)]">🟧 устали · 🟩 готовы</span>}>
        <div className="ft-panel p-4">
          <BodyMap values={rec} mode="recovery" className="h-64" />
        </div>
      </Section>

      {/* Ранг и цель */}
      <Section title="Прогресс">
        <Link to="/progress" className="ft-panel flex items-center gap-4 p-4">
          <div className="text-4xl">{rank.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-extrabold">{rank.title}</div>
              <div className="ft-num text-xs text-[var(--ft-muted)]">{fit.xp} XP</div>
            </div>
            <Bar value={progress} className="mt-2" color="linear-gradient(90deg,#c8f031,#ff7a2f)" />
            <div className="mt-1 text-xs text-[var(--ft-muted)]">
              {next ? `${next.xp - fit.xp} XP до «${next.title}»` : "Максимальный ранг"} · недель подряд: {fit.week.streak}
            </div>
          </div>
        </Link>
        {nextAch && (
          <div className="ft-panel mt-3 flex items-center gap-3 p-3">
            <div className="text-2xl grayscale">{nextAch.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">{nextAch.title}</div>
              <div className="text-xs text-[var(--ft-muted)]">{nextAch.text}</div>
              <Bar value={nextAch.progress ?? 0} className="mt-1.5" height={5} color="var(--ft-orange)" />
            </div>
          </div>
        )}
      </Section>
    </Screen>
  );
}

function RingStat({ value, color, big, label }: { value: number; color: string; big: string; label: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Ring value={value} size={74} stroke={8} color={value >= 1 ? "var(--ft-lime)" : color}>
        <div className="ft-num text-sm font-bold">{value >= 1 ? "✓" : big}</div>
      </Ring>
      <div className="mt-1.5 text-[11px] leading-tight text-[var(--ft-muted)]">{value >= 1 ? `${big} · ` : ""}{label}</div>
    </div>
  );
}

function WeekStrip({ hist }: { hist: Hist[] }) {
  const start = startOfWeek();
  const names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const today = dayKey();
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {names.map((n, i) => {
        const k = dayKey(addDays(start, i));
        const day = hist.filter((w) => dayKey(w.finishedAt!) === k);
        const workout = day.some((w) => w.kind === "workout");
        const other = day.length - day.filter((w) => w.kind === "workout").length;
        return (
          <div key={n} className={cn("rounded-2xl border py-2 text-center", k === today ? "border-[var(--ft-lime)]/60" : "border-transparent", "bg-[var(--ft-panel)]")}>
            <div className="text-[11px] text-[var(--ft-muted)]">{n}</div>
            <div className="mt-0.5 h-6 text-lg leading-6">{workout ? "💪" : other ? "🟢" : k < today ? "·" : ""}</div>
            {other > 0 && <div className="text-[10px] text-[var(--ft-cyan)]">+{other}</div>}
          </div>
        );
      })}
    </div>
  );
}
