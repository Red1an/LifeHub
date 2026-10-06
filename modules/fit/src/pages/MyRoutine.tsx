import { useEffect, useState } from "react";
import { cn, confirm, Loading, toast, useCollection, useNavigate, useParams } from "@lifehub/sdk";
import { EX } from "../data/library.ts";
import { defaultItem, KINDS, myRoutineSeconds, myWorkout, timed, type MyItem, type MyRoutine } from "../lib/custom.ts";
import { unlockAudio } from "../lib/sfx.ts";
import { useFit } from "../lib/store.ts";
import { Btn, Chip, Header, Screen } from "../components/kit.tsx";
import { ExThumb } from "../components/Visual.tsx";
import { CatalogList } from "./Catalog.tsx";
import { Sheet } from "./Player.tsx";

const ICONS = ["⭐", "🌞", "🔥", "💪", "🧘", "🦵", "🏃", "🎯", "⚡", "🌙", "🤸", "🥊"];
const REST_TIMED = [0, 10, 15, 20, 30];
const REST_SETS = [30, 45, 60, 90, 120];

export const blankRoutine = (): MyRoutine => ({ title: "Мой комплекс", icon: "⭐", kind: "morning", rounds: 1, rest: 0, items: [] });

export function MyRoutinePage() {
  const { id = "new" } = useParams();
  const fit = useFit();
  const nav = useNavigate();
  const mine = useCollection<MyRoutine>("mine");
  const existing = mine.items.find((r) => r.id === id);
  const [r, setR] = useState<MyRoutine | null>(null);
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (mine.loading || r) return;
    if (id === "new") setR(blankRoutine());
    else if (existing) { const { id: _, createdAt: __, updatedAt: ___, ...rest } = existing; setR(rest); }
  }, [mine.loading, id, !!existing]);

  if (fit.loading || mine.loading) return <Screen><Loading /></Screen>;
  if (!r) return <Screen><Header title="Комплекс не найден" back="/breaks" /></Screen>;

  const patch = (p: Partial<MyRoutine>) => { setR({ ...r, ...p }); setDirty(true); };
  const setItem = (i: number, p: Partial<MyItem>) => patch({ items: r.items.map((it, k) => (k === i ? { ...it, ...p } : it)) });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= r.items.length) return;
    const items = [...r.items];
    [items[i], items[j]] = [items[j], items[i]];
    patch({ items });
  };
  const setKind = (kind: MyRoutine["kind"]) => {
    const was = timed(r), now = kind !== "workout";
    patch({ kind, ...(was !== now ? { rest: now ? 0 : 60, rounds: 1, items: r.items.map((it) => defaultItem(it.ex, { kind })) } : {}) });
  };

  const save = async () => {
    if (!r.items.length) { toast("Добавь хотя бы одно упражнение", "error"); return null; }
    const data = { ...r, title: r.title.trim() || "Мой комплекс" };
    if (id === "new") {
      const doc = await mine.add(data);
      setDirty(false);
      nav(`/my/${doc.id}`, { replace: true });
      return doc.id;
    }
    await mine.put(id, data);
    setDirty(false);
    return id;
  };

  const start = async () => {
    unlockAudio();
    if (!(await save())) return;
    fit.setActive({ w: myWorkout(r, fit.profile, fit.hist), step: 0 });
    nav("/play");
  };

  const del = async () => {
    if (id !== "new" && !(await confirm(`Удалить «${r.title}»?`, { danger: true, confirmText: "Удалить" }))) return;
    if (id !== "new") await mine.remove(id);
    nav("/breaks", { replace: true });
  };

  const t = timed(r);
  const min = Math.max(1, Math.round(myRoutineSeconds(r) / 60));

  return (
    <Screen className="!pb-0">
      <Header back="/breaks" title={id === "new" ? "Новый комплекс" : "Свой комплекс"} subtitle={r.items.length ? `${r.items.length} упражнений · ~${min} мин` : "Собери из любых упражнений каталога"} />

      <div className="flex gap-2">
        <input className="ft-input ft-display flex-1 !text-lg font-bold" value={r.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Название" />
      </div>
      <div className="ft-scroll-x mt-2">
        {ICONS.map((ic) => <Chip key={ic} on={r.icon === ic} onClick={() => patch({ icon: ic })} className="!min-h-9 !px-2.5 text-lg">{ic}</Chip>)}
      </div>

      <div className="mt-4 mb-2 text-xs font-extrabold uppercase tracking-widest text-[var(--ft-muted)]">Что это</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {KINDS.map((k) => (
          <button key={k.kind} onClick={() => setKind(k.kind)}
            className={cn("rounded-2xl border p-2.5 text-left", r.kind === k.kind ? "border-[var(--ft-lime)] bg-[var(--ft-lime)]/12" : "border-[var(--ft-line)] bg-[var(--ft-panel)]")}>
            <div className="text-sm font-extrabold">{k.icon} {k.name}</div>
            <div className="text-[11px] leading-tight text-[var(--ft-muted)]">{k.text}</div>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {t && (
          <div className="flex items-center gap-2">
            <span className="text-[var(--ft-muted)]">Кругов</span>
            <Mini value={r.rounds} onChange={(v) => patch({ rounds: Math.max(1, Math.min(8, v)) })} />
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--ft-muted)]">{t ? "Отдых между упражнениями" : "Отдых между подходами"}</span>
          <div className="flex gap-1">
            {(t ? REST_TIMED : REST_SETS).map((s) => <Chip key={s} on={r.rest === s} onClick={() => patch({ rest: s })} className="!min-h-8 !px-2.5 !text-xs">{s ? `${s} с` : "без"}</Chip>)}
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {r.items.map((it, i) => {
          const e = EX.get(it.ex);
          if (!e) return null;
          return (
            <div key={i} className="ft-panel flex items-center gap-3 p-2.5">
              <ExThumb ex={e} className="size-12" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{e.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  {t ? (
                    <Mini value={it.sec ?? 30} step={5} suffix={`с${e.sides ? "/стор." : ""}`} onChange={(v) => setItem(i, { sec: Math.max(5, v) })} />
                  ) : (
                    <>
                      <Mini value={it.sets ?? 3} suffix="×" onChange={(v) => setItem(i, { sets: Math.max(1, Math.min(10, v)) })} />
                      {e.mode === "time"
                        ? <Mini value={it.sec ?? 30} step={5} suffix="с" onChange={(v) => setItem(i, { sec: Math.max(5, v) })} />
                        : <Mini value={it.reps ?? 10} suffix="повт." onChange={(v) => setItem(i, { reps: Math.max(1, v) })} />}
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col">
                <button className="grid size-7 place-items-center rounded-lg text-[var(--ft-muted)] hover:bg-[var(--ft-panel-2)]" onClick={() => move(i, -1)} aria-label="Выше">↑</button>
                <button className="grid size-7 place-items-center rounded-lg text-[var(--ft-muted)] hover:bg-[var(--ft-panel-2)]" onClick={() => move(i, 1)} aria-label="Ниже">↓</button>
              </div>
              <button className="grid size-9 shrink-0 place-items-center rounded-xl text-[var(--ft-muted)] hover:bg-[var(--ft-panel-2)]" onClick={() => patch({ items: r.items.filter((_, k) => k !== i) })} aria-label="Убрать">✕</button>
            </div>
          );
        })}
        <button className="ft-btn ft-btn-ghost w-full border-dashed" onClick={() => setPicking(true)}>＋ Добавить упражнения</button>
      </div>

      <div className="mt-6 flex justify-between">
        <button className="text-sm font-bold text-[var(--ft-red)]" onClick={() => void del()}>{id === "new" ? "Отменить" : "Удалить комплекс"}</button>
        {dirty && id !== "new" && <button className="text-sm font-bold text-[var(--ft-lime)]" onClick={() => void save().then((ok) => ok && toast("Сохранено", "success"))}>Сохранить</button>}
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-2 px-4 pb-4 pt-8" style={{ background: "linear-gradient(transparent, var(--ft-bg) 45%)" }}>
        <div className="flex gap-2">
          {(dirty || id === "new") && <Btn tone="ghost" className="!min-h-14" disabled={!r.items.length} onClick={() => void save().then((ok) => ok && toast("Сохранено", "success"))}>💾</Btn>}
          <Btn block className="!min-h-14 flex-1 text-lg" disabled={!r.items.length} onClick={() => void start()}>▶ Начать</Btn>
        </div>
      </div>

      {picking && (
        <Sheet onClose={() => setPicking(false)}>
          <div className="mb-3 flex items-center justify-between">
            <div className="ft-display text-lg font-bold">Добавить</div>
            <Btn className="!min-h-9 text-sm" onClick={() => setPicking(false)}>Готово · {r.items.length}</Btn>
          </div>
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <CatalogList fit={fit} picked={r.items.map((x) => x.ex)}
              onPick={(e) => { patch({ items: [...r.items, defaultItem(e.id, r)] }); toast(`+ ${e.name}`); }} />
          </div>
        </Sheet>
      )}
    </Screen>
  );
}

function Mini({ value, onChange, step = 1, suffix }: { value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <span className="inline-flex items-center rounded-xl bg-[var(--ft-panel-2)]">
      <button className="px-2 py-1 font-bold text-[var(--ft-lime)]" onClick={() => onChange(value - step)} aria-label="Меньше">−</button>
      <span className="ft-num min-w-6 text-center text-xs font-bold">{value}{suffix ? <span className="ml-0.5 font-sans font-normal text-[var(--ft-muted)]">{suffix}</span> : null}</span>
      <button className="px-2 py-1 font-bold text-[var(--ft-lime)]" onClick={() => onChange(value + step)} aria-label="Больше">+</button>
    </span>
  );
}
