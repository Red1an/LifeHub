import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn, confirm, formatDuration, Link, Loading, plural, toast, useNavigate } from "@lifehub/sdk";
import { EX, MUSCLES, neighbours, videoUrl } from "../data/library.ts";
import { alternatives, makeItem } from "../lib/generator.ts";
import { buildSteps, saveFinished, type Step } from "../lib/session.ts";
import { say, sfx, unlockAudio } from "../lib/sfx.ts";
import { useFit, type Fit, type Active } from "../lib/store.ts";
import type { Exercise, Workout, WorkoutItem } from "../lib/types.ts";
import { Btn, Pill, Ring, Stepper } from "../components/kit.tsx";

function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Не даём экрану погаснуть во время тренировки. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const get = () => { if (document.visibilityState === "visible") nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {}); };
    get();
    document.addEventListener("visibilitychange", get);
    return () => {
      document.removeEventListener("visibilitychange", get);
      void lock?.release().catch(() => {});
    };
  }, []);
}

export function PlayerPage() {
  const fit = useFit();
  if (fit.loading) return <Loading />;
  if (!fit.active) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div>
          <div className="text-5xl">🏁</div>
          <div className="mt-3 font-bold">Сейчас нет активной тренировки</div>
          <Link to="/" className="ft-btn ft-btn-lime mt-4">На главную</Link>
        </div>
      </div>
    );
  }
  return <Player fit={fit} active={fit.active} />;
}

interface Timer { phase: "prep" | "run"; end: number; total: number; paused?: number }

const workSec = (e: Exercise | undefined, it: WorkoutItem) => (it.plan.sec ?? 30) * (e?.sides ? 2 : 1);

function Player({ fit, active }: { fit: Fit; active: Active }) {
  const nav = useNavigate();
  const [w, setW] = useState<Workout>(active.w);
  const [idx, setIdx] = useState(active.step);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [sheet, setSheet] = useState<"exit" | "swap" | "list" | null>(null);
  const [tech, setTech] = useState(false);
  const steps = useMemo(() => buildSteps(w), [w]);
  const step = steps[idx] as Step | undefined;
  const now = useNow();
  const finishing = useRef(false);
  const beeped = useRef(-1);
  const sided = useRef(false);
  useWakeLock();

  // Сохраняем прогресс, чтобы продолжить после перезагрузки или с другого устройства.
  useEffect(() => { fit.setActive({ w, step: idx }); }, [w, idx]);

  const item = step ? w.items[step.i] : undefined;
  const ex = item ? EX.get(item.ex) : undefined;

  // Вход в новый шаг: запускаем нужный таймер.
  useEffect(() => {
    if (!step || !item) return;
    beeped.current = -1;
    sided.current = false;
    setTech(false);
    if (step.t === "rest") {
      setTimer({ phase: "run", end: Date.now() + step.sec * 1000, total: step.sec });
      const next = steps[idx + 1];
      const nEx = next && EX.get(w.items[next.i].ex);
      say(step.round ? "Отдых между кругами" : `Отдых. Далее ${nEx?.name ?? ""}`);
    } else if (step.auto) {
      const prevRest = steps[idx - 1]?.t === "rest";
      const prep = prevRest ? 0 : 5;
      if (prep) setTimer({ phase: "prep", end: Date.now() + prep * 1000, total: prep });
      else setTimer({ phase: "run", end: Date.now() + workSec(ex, item) * 1000, total: workSec(ex, item) });
      say(ex?.name ?? "");
    } else {
      setTimer(null);
      if (step.s === 0) say(ex?.name ?? "");
    }
  }, [idx, steps.length]);

  const left = timer ? (timer.paused ?? Math.max(0, timer.end - now)) / 1000 : 0;

  // Тики таймера: 3-2-1, смена стороны, завершение.
  useEffect(() => {
    if (!timer || timer.paused != null || !step || !item) return;
    const sec = Math.ceil(left);
    if (sec <= 3 && sec > 0 && beeped.current !== sec) { beeped.current = sec; sfx.tick(); }
    if (timer.phase === "run" && step.t === "work" && ex?.sides && !sided.current && left <= timer.total / 2) {
      sided.current = true;
      sfx.side();
      say("Смена стороны");
    }
    if (left > 0) return;
    if (timer.phase === "prep") {
      sfx.go();
      beeped.current = -1;
      setTimer({ phase: "run", end: Date.now() + workSec(ex, item) * 1000, total: workSec(ex, item) });
    } else if (step.t === "work") {
      sfx.done();
      completeSet({ sec: item.plan.sec });
    } else {
      sfx.go();
      next();
    }
  }, [now]);

  const next = () => {
    setTimer(null);
    if (idx + 1 >= steps.length) void finish();
    else setIdx(idx + 1);
  };

  const patchItem = (i: number, fn: (it: WorkoutItem) => WorkoutItem) =>
    setW((cur) => ({ ...cur, items: cur.items.map((x, k) => (k === i ? fn(x) : x)) }));

  const completeSet = (vals: { reps?: number; kg?: number; sec?: number }) => {
    if (!step || step.t !== "work") return;
    patchItem(step.i, (it) => ({ ...it, sets: it.sets.map((s, k) => (k === step.s ? { ...s, ...vals, done: true } : s)) }));
    next();
  };

  const finish = async () => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      const saved = await saveFinished(w, fit.hist);
      if (saved.ups?.length) fit.setLevels((l) => ({ ...l, ...Object.fromEntries(saved.ups!.map((u) => [u.chain, u.to])) }));
      fit.setActive(null);
      sfx.win();
      say("Тренировка завершена. Отличная работа!");
      nav(`/done/${saved.id}`, { replace: true });
    } catch (e) {
      finishing.current = false;
      toast((e as Error).message, "error");
    }
  };

  const quit = async () => {
    if (!(await confirm("Выйти без сохранения? Сделанные подходы не запишутся.", { danger: true, confirmText: "Выйти" }))) return;
    fit.setActive(null);
    nav("/", { replace: true });
  };

  const swap = (to: string) => {
    if (!step || !item) return;
    const i = step.i;
    const doneCount = item.sets.filter((s) => s.done).length;
    const fresh = makeItem(to, item.block, fit.profile, fit.hist);
    const remaining = Math.max(1, item.sets.length - doneCount);
    const repl: WorkoutItem = { ...fresh, plan: { ...fresh.plan, sets: remaining }, sets: fresh.sets.slice(0, remaining).concat(Array.from({ length: Math.max(0, remaining - fresh.sets.length) }, () => ({ ...fresh.sets[0] }))) };
    const items = [...w.items];
    if (doneCount) items.splice(i, 1, { ...item, plan: { ...item.plan, sets: doneCount }, sets: item.sets.filter((s) => s.done) }, repl);
    else items.splice(i, 1, repl);
    const nw = { ...w, items };
    const ni = doneCount ? i + 1 : i;
    const ns = buildSteps(nw).findIndex((st) => st.t === "work" && st.i === ni && st.s === 0);
    setW(nw);
    setIdx(Math.max(0, ns));
    setSheet(null);
    toast(`Заменено на «${EX.get(to)?.name}»`, "success");
  };

  const jumpTo = (i: number) => {
    const it = w.items[i];
    const s = Math.max(0, it.sets.findIndex((x) => !x.done));
    const k = steps.findIndex((st) => st.t === "work" && st.i === i && st.s === s);
    if (k >= 0) setIdx(k);
    setSheet(null);
  };

  const togglePause = () => {
    unlockAudio();
    if (!timer) return;
    setTimer(timer.paused != null ? { ...timer, end: Date.now() + timer.paused, paused: undefined } : { ...timer, paused: Math.max(0, timer.end - Date.now()) });
  };

  if (!step || !item || !ex) {
    return (
      <div className="ft-player ft-root grid place-items-center">
        <Btn onClick={() => void finish()}>Завершить</Btn>
      </div>
    );
  }

  const mainIdx = w.items.map((it, i) => (it.block === "main" ? i : -1)).filter((i) => i >= 0);
  const blockLabel = item.block === "warmup" ? "Разминка" : item.block === "cooldown" ? "Заминка" : w.circuit
    ? `Круг ${(step.t === "work" ? step.round ?? 0 : step.s) + 1} из ${w.circuit.rounds}`
    : w.kind === "workout" ? `Упражнение ${mainIdx.indexOf(step.i) + 1} из ${mainIdx.length}` : w.title;
  const progress = idx / steps.length;
  const anyDone = w.items.some((it) => it.block === "main" && it.sets.some((s) => s.done));

  return (
    <div className="ft-player ft-root" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Верхняя панель */}
      <div className="flex items-center gap-2 px-3 pt-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <button className="ft-btn ft-btn-ghost !min-h-10 !px-3" onClick={() => setSheet("exit")} aria-label="Выйти">✕</button>
        <div className="flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-[#23262d]">
            <div className="h-full rounded-full bg-[var(--ft-lime)] transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-[var(--ft-muted)]">
            <span>{blockLabel}</span>
            <span className="ft-num">{formatDuration((now - w.startedAt) / 1000)}</span>
          </div>
        </div>
        <button className="ft-btn ft-btn-ghost !min-h-10 !px-3" onClick={() => setSheet("list")} aria-label="План">☰</button>
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col overflow-y-auto px-4 pb-4 pt-3">
        {step.t === "rest" ? (
          <RestView step={step} steps={steps} idx={idx} w={w} left={left} timer={timer}
            onFeel={(f) => patchItem(step.i, (it) => ({ ...it, feel: f }))}
            onAdd={() => timer && setTimer({ ...timer, end: timer.end + 15000, total: timer.total + 15 })}
            onSkip={next} onPause={togglePause} />
        ) : (
          <>
            <div key={idx} className="ft-slide">
              <div className="flex items-start gap-3">
                <div className="grid size-16 shrink-0 place-items-center rounded-3xl bg-[var(--ft-panel-2)] text-4xl">{ex.icon}</div>
                <div className="min-w-0 flex-1">
                  <h1 className="ft-display text-xl font-bold leading-tight sm:text-2xl">{ex.name}</h1>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {ex.muscles.map((m) => <Pill key={m} color="#c8f031">{MUSCLES[m]}</Pill>)}
                    {ex.sides && <Pill color="#38d6f5">на каждую сторону</Pill>}
                  </div>
                </div>
              </div>

              <button className="mt-3 w-full rounded-2xl bg-[var(--ft-panel)] px-4 py-3 text-left" onClick={() => setTech(!tech)}>
                <div className="flex items-center justify-between text-sm font-bold">
                  <span>🎓 {tech ? "Техника" : ex.cues[0]}</span>
                  <span className="text-[var(--ft-muted)]">{tech ? "▴" : "▾"}</span>
                </div>
                {tech && <Technique ex={ex} />}
              </button>
            </div>

            {step.auto ? (
              <AutoView ex={ex} item={item} timer={timer} left={left} onPause={togglePause} onSkip={() => completeSet({ sec: item.plan.sec })} />
            ) : ex.mode === "time" ? (
              <TimedSet key={idx} ex={ex} item={item} s={step.s} timer={timer} left={left}
                onStart={() => { unlockAudio(); setTimer({ phase: "prep", end: Date.now() + 3000, total: 3 }); }}
                onStop={() => { const sec = Math.round((timer?.total ?? 0) - left); sfx.done(); completeSet({ sec: timer?.phase === "run" ? sec : 0 }); }} />
            ) : (
              <RepSet key={idx} ex={ex} item={item} s={step.s} onDone={(reps, kg) => { unlockAudio(); sfx.done(); completeSet({ reps, kg }); }} />
            )}

            {!step.auto && (
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <button className="ft-btn ft-btn-ghost !min-h-10 text-sm" onClick={() => setSheet("swap")}>🔁 Заменить</button>
                <button className="ft-btn ft-btn-ghost !min-h-10 text-sm" onClick={() => {
                  const after = w.items.findIndex((it, i) => i > step.i && it.sets.some((x) => !x.done));
                  if (after >= 0) jumpTo(after);
                  else void finish();
                }}>⏭ Пропустить</button>
              </div>
            )}
          </>
        )}
      </div>

      {sheet && (
        <Sheet onClose={() => setSheet(null)}>
          {sheet === "exit" && (
            <div className="space-y-2">
              <div className="ft-display mb-3 text-lg font-bold">Закончить тренировку?</div>
              {anyDone || w.kind !== "workout" ? (
                <Btn block onClick={() => { setSheet(null); void finish(); }}>✅ Завершить и сохранить</Btn>
              ) : null}
              <Btn block tone="ghost" onClick={() => setSheet(null)}>Продолжить</Btn>
              <Btn block tone="red" onClick={() => void quit()}>Выйти без сохранения</Btn>
            </div>
          )}
          {sheet === "swap" && <SwapList current={ex} fit={fit} exclude={w.items.map((i) => i.ex)} onPick={swap} />}
          {sheet === "list" && (
            <div>
              <div className="ft-display mb-3 text-lg font-bold">План</div>
              <div className="space-y-1.5">
                {w.items.map((it, i) => {
                  const e = EX.get(it.ex);
                  const d = it.sets.filter((s) => s.done).length;
                  return (
                    <button key={i} onClick={() => jumpTo(i)}
                      className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left", i === step.i ? "bg-[var(--ft-lime)]/15" : "bg-[var(--ft-panel-2)]")}>
                      <span className="text-xl">{d >= it.sets.length ? "✅" : e?.icon}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e?.name}</span>
                      <span className="text-xs text-[var(--ft-muted)]">{it.block === "main" ? `${d}/${it.sets.length}` : it.block === "warmup" ? "разминка" : "заминка"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

function Technique({ ex }: { ex: Exercise }) {
  return (
    <div className="mt-3 space-y-3 text-sm font-normal" onClick={(e) => e.stopPropagation()}>
      <ol className="list-decimal space-y-1 pl-5">{ex.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <div>
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--ft-lime)]">Ключевое</div>
        <ul className="space-y-0.5">{ex.cues.map((c, i) => <li key={i}>✓ {c}</li>)}</ul>
      </div>
      <div>
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--ft-orange)]">Частые ошибки</div>
        <ul className="space-y-0.5">{ex.mistakes.map((c, i) => <li key={i}>✗ {c}</li>)}</ul>
      </div>
      {ex.breathe && <div className="text-[var(--ft-muted)]">🌬️ {ex.breathe}</div>}
      <a href={videoUrl(ex)} target="_blank" rel="noreferrer" className="inline-block text-[var(--ft-cyan)] underline underline-offset-2">▶ Видео с техникой на YouTube</a>
    </div>
  );
}

function SetDots({ item, s }: { item: WorkoutItem; s: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {item.sets.map((x, k) => (
        <span key={k} className={cn("h-2 rounded-full transition-all", k === s ? "w-6 bg-[var(--ft-lime)]" : x.done ? "w-2 bg-[var(--ft-lime)]/60" : "w-2 bg-[#2b2f37]")} />
      ))}
    </div>
  );
}

function Target({ item, ex }: { item: WorkoutItem; ex: Exercise }) {
  const r = item.plan.reps;
  return (
    <div className="text-center">
      <div className="ft-num text-4xl font-extrabold">
        {ex.mode === "time" ? `${item.plan.sec} с` : r ? (r[0] === r[1] ? r[0] : `${r[0]}–${r[1]}`) : "—"}
        {item.plan.kg ? <span className="text-[var(--ft-lime)]"> × {item.plan.kg} кг</span> : null}
      </div>
      <div className="text-sm text-[var(--ft-muted)]">{ex.mode === "time" ? "удержание" : "повторов"}{ex.sides ? " на сторону" : ""}</div>
      {item.note && <div className="mx-auto mt-2 max-w-sm rounded-xl bg-[var(--ft-panel)] px-3 py-1.5 text-xs text-[var(--ft-muted)]">📈 {item.note}</div>}
    </div>
  );
}

function RepSet({ ex, item, s, onDone }: { ex: Exercise; item: WorkoutItem; s: number; onDone: (reps: number, kg?: number) => void }) {
  const set = item.sets[s];
  const [reps, setReps] = useState(set.reps ?? item.plan.reps?.[0] ?? 10);
  const [kg, setKg] = useState(set.kg ?? item.plan.kg ?? 0);
  const inc = ex.load === "barbell" ? 2.5 : 1;
  return (
    <div className="mt-6 flex flex-1 flex-col">
      <div className="text-center text-sm font-bold text-[var(--ft-muted)]">Подход {s + 1} из {item.sets.length}</div>
      <div className="mt-2"><SetDots item={item} s={s} /></div>
      <div className="mt-5"><Target item={item} ex={ex} /></div>
      <div className="mt-6 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--ft-muted)]">Сделал повторов</div>
        <Stepper value={reps} onChange={setReps} suffix={plural(reps, ["повтор", "повтора", "повторов"])} />
        {ex.load && (
          <>
            <div className="pt-2 text-xs font-bold uppercase tracking-wider text-[var(--ft-muted)]">Вес{ex.load === "dumbbell" ? " одной гантели" : ""}</div>
            <Stepper value={kg} onChange={setKg} step={inc} suffix="кг" />
          </>
        )}
      </div>
      <div className="flex-1" />
      <Btn block className="ft-pulse mt-6 !min-h-16 text-lg" onClick={() => onDone(reps, ex.load ? kg : undefined)}>Готово ✓</Btn>
    </div>
  );
}

function TimedSet({ ex, item, s, timer, left, onStart, onStop }: { ex: Exercise; item: WorkoutItem; s: number; timer: Timer | null; left: number; onStart: () => void; onStop: () => void }) {
  const total = workSec(ex, item);
  return (
    <div className="mt-6 flex flex-1 flex-col items-center">
      <div className="text-center text-sm font-bold text-[var(--ft-muted)]">Подход {s + 1} из {item.sets.length}</div>
      <div className="mt-2"><SetDots item={item} s={s} /></div>
      <div className="mt-4"><Target item={item} ex={ex} /></div>
      <div className="mt-6">
        <Ring value={timer ? left / timer.total : 1} size={200} stroke={14} color={timer?.phase === "prep" ? "var(--ft-orange)" : "var(--ft-lime)"}>
          <div>
            <div className="ft-num text-5xl font-extrabold">{timer ? Math.ceil(left) : total}</div>
            <div className="text-xs text-[var(--ft-muted)]">{timer?.phase === "prep" ? "приготовься" : timer ? "держи!" : "секунд"}</div>
          </div>
        </Ring>
      </div>
      <div className="flex-1" />
      {!timer ? (
        <Btn block className="ft-pulse mt-6 !min-h-16 text-lg" onClick={onStart}>▶ Старт</Btn>
      ) : (
        <Btn block tone="ghost" className="mt-6 !min-h-16 text-lg" onClick={onStop}>⏹ Стоп — сколько смог</Btn>
      )}
    </div>
  );
}

function AutoView({ ex, item, timer, left, onPause, onSkip }: { ex: Exercise; item: WorkoutItem; timer: Timer | null; left: number; onPause: () => void; onSkip: () => void }) {
  const prep = timer?.phase === "prep";
  const reps = item.plan.reps?.[0];
  return (
    <div className="mt-6 flex flex-1 flex-col items-center">
      <Ring value={timer ? left / timer.total : 0} size={220} stroke={14} color={prep ? "var(--ft-orange)" : "var(--ft-lime)"}>
        <div>
          <div className="ft-num text-6xl font-extrabold">{Math.ceil(left)}</div>
          <div className="text-xs text-[var(--ft-muted)]">
            {timer?.paused != null ? "пауза" : prep ? "приготовься" : reps ? `≈ ${reps} ${plural(reps, ["повтор", "повтора", "повторов"])}${ex.sides ? " на сторону" : ""}` : ex.sides ? (left > (timer?.total ?? 0) / 2 ? "первая сторона" : "вторая сторона") : "работаем"}
          </div>
        </div>
      </Ring>
      <div className="flex-1" />
      <div className="mt-6 grid w-full grid-cols-2 gap-2">
        <Btn tone="ghost" className="!min-h-14" onClick={onPause}>{timer?.paused != null ? "▶ Дальше" : "⏸ Пауза"}</Btn>
        <Btn tone="ghost" className="!min-h-14" onClick={onSkip}>⏭ Следующее</Btn>
      </div>
    </div>
  );
}

function RestView({ step, steps, idx, w, left, timer, onFeel, onAdd, onSkip, onPause }: {
  step: Extract<Step, { t: "rest" }>; steps: Step[]; idx: number; w: Workout; left: number; timer: Timer | null;
  onFeel: (f: 1 | 2 | 3) => void; onAdd: () => void; onSkip: () => void; onPause: () => void;
}) {
  const prevItem = w.items[step.i];
  const nextStep = steps[idx + 1];
  const nextItem = nextStep ? w.items[nextStep.i] : undefined;
  const nextEx = nextItem && EX.get(nextItem.ex);
  const lastSetOfItem = !w.circuit && step.s === prevItem.sets.length - 1;
  return (
    <div className="ft-slide flex flex-1 flex-col items-center pt-4">
      <div className="ft-display text-2xl font-bold">{step.round ? "Отдых между кругами" : "Отдых"}</div>
      <div className="mt-5">
        <Ring value={timer ? left / timer.total : 0} size={210} stroke={14} color="var(--ft-cyan)">
          <div>
            <div className="ft-num text-5xl font-extrabold">{formatDuration(Math.ceil(left))}</div>
            {timer?.paused != null && <div className="text-xs text-[var(--ft-muted)]">пауза</div>}
          </div>
        </Ring>
      </div>
      <div className="mt-4 flex gap-2">
        <Btn tone="ghost" onClick={onAdd}>+15 с</Btn>
        <Btn tone="ghost" onClick={onPause}>{timer?.paused != null ? "▶" : "⏸"}</Btn>
        <Btn tone="ghost" onClick={onSkip}>Пропустить ⏭</Btn>
      </div>

      {lastSetOfItem && prevItem.block === "main" && (
        <div className="mt-6 w-full">
          <div className="mb-2 text-center text-sm font-bold">Как было «{EX.get(prevItem.ex)?.name}»?</div>
          <div className="grid grid-cols-3 gap-2">
            {([[1, "😌", "Легко"], [2, "💪", "Норм"], [3, "🥵", "Тяжело"]] as const).map(([f, icon, label]) => (
              <button key={f} onClick={() => onFeel(f)}
                className={cn("rounded-2xl border px-2 py-3 text-center transition", prevItem.feel === f ? "border-[var(--ft-lime)] bg-[var(--ft-lime)]/15" : "border-[var(--ft-line)] bg-[var(--ft-panel)]")}>
                <div className="text-2xl">{icon}</div>
                <div className="text-xs font-bold">{label}</div>
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-center text-[11px] text-[var(--ft-muted)]">От ответа зависит, поднимем ли нагрузку в следующий раз</div>
        </div>
      )}

      <div className="flex-1" />
      {nextEx && nextItem && nextStep?.t === "work" && (
        <div className="mt-6 flex w-full items-center gap-3 rounded-2xl bg-[var(--ft-panel)] p-3">
          <div className="text-3xl">{nextEx.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-[var(--ft-muted)]">Далее{w.circuit ? "" : ` · подход ${nextStep.s + 1} из ${nextItem.sets.length}`}</div>
            <div className="truncate font-bold">{nextEx.name}</div>
          </div>
          <div className="text-right text-sm font-bold text-[var(--ft-lime)]">
            {nextEx.mode === "time" ? `${nextItem.plan.sec} с` : nextItem.plan.reps ? `${nextItem.plan.reps[0]}–${nextItem.plan.reps[1]}` : ""}
            {nextItem.plan.kg ? ` × ${nextItem.plan.kg}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

export function SwapList({ current, fit, exclude, onPick }: { current: Exercise; fit: Fit; exclude: string[]; onPick: (id: string) => void }) {
  const list = alternatives(current.id, { place: fit.place, profile: fit.profile, levels: fit.levels, hidden: fit.hidden, hist: fit.hist }, exclude);
  const { easier, harder } = neighbours(current.id);
  const Row = ({ e, tag }: { e: Exercise; tag?: string }) => (
    <button onClick={() => onPick(e.id)} className="flex w-full items-center gap-3 rounded-2xl bg-[var(--ft-panel-2)] px-3 py-2.5 text-left hover:brightness-125">
      <span className="text-2xl">{e.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{e.name}</span>
        <span className="block truncate text-xs text-[var(--ft-muted)]">{e.muscles.map((m) => MUSCLES[m]).join(", ")} · сложность {e.level}</span>
      </span>
      {tag && <Pill color="#38d6f5">{tag}</Pill>}
    </button>
  );
  return (
    <div>
      <div className="ft-display mb-3 text-lg font-bold">Заменить «{current.name}»</div>
      <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
        {easier && <Row e={easier} tag="легче" />}
        {harder && <Row e={harder} tag="сложнее" />}
        {list.filter((e) => e.id !== easier?.id && e.id !== harder?.id).map((e) => <Row key={e.id} e={e} />)}
        {!list.length && !easier && !harder && <div className="text-sm text-[var(--ft-muted)]">Нет подходящих замен для этого места.</div>}
      </div>
    </div>
  );
}

export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="ft-root ft-slide w-full max-w-lg rounded-t-3xl border border-[var(--ft-line)] p-5 sm:rounded-3xl"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))", minHeight: 0 }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
