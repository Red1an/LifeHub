import { useState } from "react";
import { cn, Link } from "@lifehub/sdk";
import { EX, EXERCISES, MUSCLES, PATTERNS, hasEquip } from "../data/library.ts";
import { makeItem, workoutSeconds } from "../lib/generator.ts";
import type { Fit } from "../lib/store.ts";
import type { Workout, WorkoutItem } from "../lib/types.ts";
import { Sheet, SwapList } from "../pages/Player.tsx";
import { Pill } from "./kit.tsx";

export const planText = (it: WorkoutItem) => {
  const e = EX.get(it.ex);
  if (!e) return "";
  const side = e.sides ? " /стор." : "";
  if (it.block !== "main" || (it.plan.sets === 1 && it.plan.sec)) return `${it.plan.sec} с${side}`;
  const r = it.plan.reps;
  const work = e.mode === "time" || !r ? `${it.plan.sec} с` : r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`;
  return `${it.plan.sets} × ${work}${side}${it.plan.kg ? ` · ${it.plan.kg} кг` : ""}`;
};

/** Просмотр и правка тренировки перед стартом: замена, удаление, подходы, добавление. */
export function Editor({ w, onChange, fit }: { w: Workout; onChange: (w: Workout) => void; fit: Fit }) {
  const [swapAt, setSwapAt] = useState<number | null>(null);
  const [adding, setAdding] = useState<WorkoutItem["block"] | null>(null);
  const setItems = (items: WorkoutItem[]) => onChange({ ...w, items });

  const remove = (i: number) => setItems(w.items.filter((_, k) => k !== i));
  const sets = (i: number, d: number) => setItems(w.items.map((it, k) => {
    if (k !== i) return it;
    const n = Math.max(1, Math.min(8, it.plan.sets + d));
    return { ...it, plan: { ...it.plan, sets: n }, sets: Array.from({ length: n }, (_, j) => it.sets[j] ?? { ...it.sets[0], done: false }) };
  }));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= w.items.length || w.items[j].block !== w.items[i].block) return;
    const items = [...w.items];
    [items[i], items[j]] = [items[j], items[i]];
    setItems(items);
  };
  const swap = (id: string) => {
    if (swapAt == null) return;
    const old = w.items[swapAt];
    setItems(w.items.map((it, k) => (k === swapAt ? makeItem(id, old.block, fit.profile, fit.hist) : it)));
    setSwapAt(null);
  };
  const add = (id: string) => {
    if (!adding) return;
    const it = makeItem(id, adding, fit.profile, fit.hist);
    const last = w.items.map((x) => x.block).lastIndexOf(adding);
    const at = last >= 0 ? last + 1 : adding === "warmup" ? 0 : adding === "main" ? w.items.filter((x) => x.block === "warmup").length : w.items.length;
    const items = [...w.items];
    items.splice(at, 0, w.circuit && adding === "main" ? { ...it, plan: { sets: w.circuit.rounds, sec: w.circuit.work, rest: w.circuit.rest }, sets: Array.from({ length: w.circuit.rounds }, () => ({ done: false, sec: w.circuit!.work })) } : it);
    setItems(items);
    setAdding(null);
  };

  const blocks: [WorkoutItem["block"], string][] = [["warmup", "Разминка"], ["main", w.circuit ? `Круг × ${w.circuit.rounds} · ${w.circuit.work}/${w.circuit.rest} с` : "Основная часть"], ["cooldown", "Заминка"]];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <Pill color="#c8f031" className="!px-3 !py-1 !text-sm">⏱ ~{Math.round(workoutSeconds(w) / 60)} мин</Pill>
        <Pill color="#38d6f5" className="!px-3 !py-1 !text-sm">{w.items.filter((i) => i.block === "main").length} упражнений</Pill>
      </div>
      {blocks.map(([block, label]) => {
        const idx = w.items.map((it, i) => (it.block === block ? i : -1)).filter((i) => i >= 0);
        if (!idx.length && block !== "main") return null;
        return (
          <div key={block} className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-extrabold uppercase tracking-widest text-[var(--ft-muted)]">{label}</div>
              <button className="text-xs font-bold text-[var(--ft-lime)]" onClick={() => setAdding(block)}>+ добавить</button>
            </div>
            <div className="space-y-2">
              {idx.map((i) => {
                const it = w.items[i];
                const e = EX.get(it.ex);
                if (!e) return null;
                const main = block === "main";
                return (
                  <div key={`${i}-${it.ex}`} className={cn("ft-panel flex items-center gap-3", main ? "p-3" : "px-3 py-2")}>
                    <Link to={`/ex/${e.id}`} className={cn("grid shrink-0 place-items-center rounded-2xl bg-[var(--ft-panel-2)]", main ? "size-12 text-2xl" : "size-9 text-lg")}>{e.icon}</Link>
                    <div className="min-w-0 flex-1">
                      <Link to={`/ex/${e.id}`} className={cn("block truncate font-bold", !main && "text-sm")}>{e.name}</Link>
                      <div className="truncate text-xs text-[var(--ft-muted)]">
                        <span className="font-bold text-[var(--ft-lime)]">{planText(it)}</span>
                        {main && ` · ${e.muscles.map((m) => MUSCLES[m]).join(", ")}`}
                      </div>
                      {main && it.note && <div className="mt-0.5 truncate text-[11px] text-[var(--ft-muted)]">📈 {it.note}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {main && !w.circuit && (
                        <div className="mr-1 hidden items-center rounded-xl bg-[var(--ft-panel-2)] sm:flex">
                          <button className="px-2 py-1 text-[var(--ft-lime)]" onClick={() => sets(i, -1)} aria-label="Меньше подходов">−</button>
                          <span className="text-xs">{it.plan.sets}</span>
                          <button className="px-2 py-1 text-[var(--ft-lime)]" onClick={() => sets(i, 1)} aria-label="Больше подходов">+</button>
                        </div>
                      )}
                      {main && <button className="grid size-9 place-items-center rounded-xl text-[var(--ft-muted)] hover:bg-[var(--ft-panel-2)]" onClick={() => move(i, -1)} aria-label="Выше">↑</button>}
                      <button className="grid size-9 place-items-center rounded-xl hover:bg-[var(--ft-panel-2)]" onClick={() => setSwapAt(i)} aria-label="Заменить">🔁</button>
                      <button className="grid size-9 place-items-center rounded-xl text-[var(--ft-muted)] hover:bg-[var(--ft-panel-2)]" onClick={() => remove(i)} aria-label="Убрать">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {swapAt != null && EX.get(w.items[swapAt]?.ex) && (
        <Sheet onClose={() => setSwapAt(null)}>
          <SwapList current={EX.get(w.items[swapAt].ex)!} fit={fit} exclude={w.items.map((i) => i.ex)} onPick={swap} />
        </Sheet>
      )}
      {adding && (
        <Sheet onClose={() => setAdding(null)}>
          <AddList fit={fit} block={adding} exclude={w.items.map((i) => i.ex)} onPick={add} />
        </Sheet>
      )}
    </div>
  );
}

function AddList({ fit, block, exclude, onPick }: { fit: Fit; block: WorkoutItem["block"]; exclude: string[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const list = EXERCISES.filter((e) => !exclude.includes(e.id))
    .filter((e) => (block === "main" ? e.pattern !== "stretch" : block === "warmup" ? e.pattern === "mobility" || e.pattern === "cardio" : e.pattern === "stretch" || e.pattern === "mobility"))
    .filter((e) => all || hasEquip(e, fit.place.equip))
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="ft-display mb-3 text-lg font-bold">Добавить упражнение</div>
      <input className="ft-input" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <label className="mt-2 flex items-center gap-2 text-xs text-[var(--ft-muted)]">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> показать и то, для чего здесь нет инвентаря
      </label>
      <div className="mt-3 max-h-[55vh] space-y-1.5 overflow-y-auto">
        {list.map((e) => (
          <button key={e.id} onClick={() => onPick(e.id)} className="flex w-full items-center gap-3 rounded-2xl bg-[var(--ft-panel-2)] px-3 py-2 text-left hover:brightness-125">
            <span className="text-xl">{e.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{e.name}</span>
              <span className="block truncate text-xs text-[var(--ft-muted)]">{PATTERNS[e.pattern]} · {e.muscles.map((m) => MUSCLES[m]).join(", ")}</span>
            </span>
          </button>
        ))}
        {!list.length && <div className="py-4 text-center text-sm text-[var(--ft-muted)]">Ничего не нашлось</div>}
      </div>
    </div>
  );
}
