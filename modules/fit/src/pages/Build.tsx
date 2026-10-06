import { useEffect, useRef } from "react";
import { cn, dayKey, Link, Loading, useNavigate, useStore } from "@lifehub/sdk";
import { autoFocus, FOCUS_INFO } from "../lib/analysis.ts";
import { generate } from "../lib/generator.ts";
import { unlockAudio } from "../lib/sfx.ts";
import { useFit, type Fit } from "../lib/store.ts";
import type { Focus, Workout } from "../lib/types.ts";
import { Editor } from "../components/Editor.tsx";
import { Btn, Chip, Header, Screen } from "../components/kit.tsx";

export interface BuildOpts { focus: Focus; minutes?: number }
interface Draft { key: string; w: Workout; seed: number }

const MINUTES = [10, 15, 20, 30, 45, 60];
const FOCUSES: Focus[] = ["auto", "full", "upper", "lower", "push", "pull", "core", "hiit", "mobility"];

/** Черновик тренировки: пересобирается при смене места, времени, фокуса и каждый новый день. */
export function useDraft(fit: Fit) {
  const [opts, setOpts, oMeta] = useStore<BuildOpts>("buildOpts", { focus: "auto" });
  const [draft, setDraft, dMeta] = useStore<Draft | null>("draft", null);
  const minutes = opts.minutes ?? fit.profile.minutes;
  const key = `${dayKey()}|${opts.focus}|${minutes}|${fit.place.id}|${fit.hist.filter((h) => h.kind === "workout").length}|${fit.profile.goal}|${fit.profile.experience}`;
  const loading = fit.loading || oMeta.loading || dMeta.loading;
  const busy = useRef("");

  const regen = (seed = Date.now()) => {
    const w = generate({ focus: opts.focus, minutes, place: fit.place, profile: fit.profile, levels: fit.levels, hidden: fit.hidden, hist: fit.hist, seed });
    setDraft({ key, w, seed });
  };

  useEffect(() => {
    if (loading || draft?.key === key || busy.current === key) return;
    busy.current = key;
    regen();
  }, [loading, key]);

  const start = (w: Workout) => {
    unlockAudio();
    fit.setActive({ w: { ...w, startedAt: Date.now(), items: w.items.map((it) => ({ ...it, sets: it.sets.map((s) => ({ ...s, done: false })) })) }, step: 0 });
  };

  return {
    loading: loading || !draft || draft.key !== key,
    opts: { ...opts, minutes },
    setOpts: (o: Partial<BuildOpts>) => setOpts({ ...opts, ...o }),
    w: draft?.w,
    setW: (w: Workout) => draft && setDraft({ ...draft, w }),
    regen,
    start,
  };
}

export function BuildPage() {
  const fit = useFit();
  const d = useDraft(fit);
  const nav = useNavigate();
  if (fit.loading) return <Screen><Loading /></Screen>;
  const resolved = d.opts.focus === "auto" ? autoFocus(fit.hist, fit.profile.perWeek) : null;

  return (
    <Screen className="!pb-0">
      <Header title="Тренировка" subtitle="Собери под место, время и настроение" right={<Link to="/coach" className="ft-btn ft-btn-ghost !min-h-10 !px-3 text-sm">🤖 Тренер</Link>} />

      {fit.active && (
        <Link to="/play" className="ft-panel mb-4 flex items-center gap-3 border-[var(--ft-orange)]/50 p-3">
          <span className="text-2xl">⏯️</span>
          <span className="flex-1 font-bold">Незаконченная тренировка: {fit.active.w.title}</span>
          <span className="text-[var(--ft-orange)]">→</span>
        </Link>
      )}

      <div className="mb-2 text-xs font-extrabold uppercase tracking-widest text-[var(--ft-muted)]">Где</div>
      <div className="ft-scroll-x mb-4">
        {fit.profile.places.map((p) => (
          <Chip key={p.id} on={p.id === fit.place.id} onClick={() => fit.setProfile({ ...fit.profile, place: p.id })}>{p.icon} {p.name}</Chip>
        ))}
        <Link to="/profile" className="ft-chip">⚙️ Инвентарь</Link>
      </div>

      <div className="mb-2 text-xs font-extrabold uppercase tracking-widest text-[var(--ft-muted)]">Сколько времени</div>
      <div className="ft-scroll-x mb-4">
        {MINUTES.map((m) => <Chip key={m} on={m === d.opts.minutes} onClick={() => d.setOpts({ minutes: m })}>{m} мин</Chip>)}
      </div>

      <div className="mb-2 text-xs font-extrabold uppercase tracking-widest text-[var(--ft-muted)]">Что тренируем</div>
      <div className="mb-6 grid grid-cols-3 gap-2">
        {FOCUSES.map((f) => {
          const info = FOCUS_INFO[f];
          const on = f === d.opts.focus;
          return (
            <button key={f} onClick={() => d.setOpts({ focus: f })}
              className={cn("rounded-2xl border p-2.5 text-left transition", on ? "border-[var(--ft-lime)] bg-[var(--ft-lime)]/12" : "border-[var(--ft-line)] bg-[var(--ft-panel)] hover:brightness-125")}>
              <div className="text-xl">{info.icon}</div>
              <div className="mt-1 text-sm font-extrabold leading-tight">{info.title}</div>
              <div className="mt-0.5 hidden text-[11px] leading-tight text-[var(--ft-muted)] sm:block">{info.text}</div>
            </button>
          );
        })}
      </div>
      {resolved && (
        <div className="-mt-3 mb-5 text-sm text-[var(--ft-muted)]">
          ✨ Сегодня по восстановлению: <b className="text-[var(--ft-fg)]">{FOCUS_INFO[resolved].icon} {FOCUS_INFO[resolved].title}</b>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="ft-display text-base font-bold">{d.w?.title ?? "Подбираю…"}</h2>
        <button className="text-sm font-bold text-[var(--ft-lime)]" onClick={() => d.regen()}>🎲 Другая подборка</button>
      </div>
      {d.loading || !d.w ? <Loading /> : <Editor w={d.w} onChange={d.setW} fit={fit} />}

      <div className="sticky bottom-0 z-20 -mx-4 px-4 pb-4 pt-8" style={{ background: "linear-gradient(transparent, var(--ft-bg) 45%)" }}>
        <div>
          <Btn block className="!min-h-14 text-lg" disabled={!d.w || !d.w.items.length} onClick={() => { d.start(d.w!); nav("/play"); }}>
            ▶ Начать тренировку
          </Btn>
        </div>
      </div>
    </Screen>
  );
}
