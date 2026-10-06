import { useMemo, useState } from "react";
import { cn, Link, Loading, useStore } from "@lifehub/sdk";
import { CATALOG, EQUIP, EXERCISES, MUSCLES, hasEquip } from "../data/library.ts";
import { useFit, type Fit } from "../lib/store.ts";
import type { Equip, Exercise, Muscle } from "../lib/types.ts";
import { BodyMap } from "../components/BodyMap.tsx";
import { Chip, Header, Screen } from "../components/kit.tsx";
import { ExThumb } from "../components/Visual.tsx";

export const GROUPS: { id: string; name: string; muscles: Muscle[] }[] = [
  { id: "chest", name: "Грудь", muscles: ["chest"] },
  { id: "back", name: "Спина", muscles: ["lats", "upperback", "lowerback"] },
  { id: "delts", name: "Плечи", muscles: ["delts"] },
  { id: "arms", name: "Руки", muscles: ["biceps", "triceps", "forearms"] },
  { id: "core", name: "Пресс", muscles: ["abs", "obliques"] },
  { id: "glutes", name: "Ягодицы", muscles: ["glutes"] },
  { id: "legs", name: "Ноги", muscles: ["quads", "hams", "adductors", "calves"] },
  { id: "neck", name: "Шея", muscles: ["neck"] },
];

const TYPES = [
  { id: "all", name: "Все" },
  { id: "strength", name: "💪 Сила" },
  { id: "cardio", name: "🏃 Кардио" },
  { id: "mobility", name: "🔄 Разминка" },
  { id: "stretch", name: "🧘 Растяжка" },
] as const;
type TypeId = (typeof TYPES)[number]["id"];
const typeOf = (e: Exercise): TypeId => (e.pattern === "cardio" || e.pattern === "mobility" || e.pattern === "stretch" ? e.pattern : "strength");

interface Filter { q: string; group: string; muscle: string; type: TypeId; equip: string }
const EMPTY: Filter = { q: "", group: "", muscle: "", type: "all", equip: "any" };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[_-]/g, " ");

function useFiltered(f: Filter, fit: Fit) {
  return useMemo(() => {
    const q = norm(f.q.trim());
    const muscles = f.muscle ? [f.muscle as Muscle] : GROUPS.find((g) => g.id === f.group)?.muscles;
    const list = CATALOG.filter((e) => {
      if (muscles && !e.muscles.some((m) => muscles.includes(m)) && !(f.muscle && e.secondary?.includes(f.muscle as Muscle))) return false;
      if (f.type !== "all" && typeOf(e) !== f.type) return false;
      if (f.equip === "none" && e.equip.some((q) => q !== "wall" && q !== "chair")) return false;
      if (f.equip === "here" && !hasEquip(e, fit.place.equip)) return false;
      if (f.equip !== "any" && f.equip !== "none" && f.equip !== "here" && !e.equip.includes(f.equip as Equip)) return false;
      if (q) {
        const hay = norm(`${e.name} ${e.photo ?? ""} ${e.muscles.map((m) => MUSCLES[m]).join(" ")}`);
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    // Сначала свои (с техникой на русском), основная мышца важнее вспомогательной, потом проще.
    const main = (e: Exercise) => (muscles && !e.muscles.some((m) => muscles.includes(m)) ? 1 : 0);
    return list.sort((a, b) => main(a) - main(b) || Number(!!a.ext) - Number(!!b.ext) || (q ? Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)) : 0) || a.level - b.level);
  }, [f, fit.place]);
}

/** Поиск по всей базе с фильтрами. onPick — режим выбора (для своих комплексов). */
export function CatalogList({ fit, onPick, picked = [] }: { fit: Fit; onPick?: (e: Exercise) => void; picked?: string[] }) {
  const [saved, setSaved] = useStore<Filter>("catalogFilter", EMPTY);
  const [local, setLocal] = useState<Filter>(EMPTY);
  // На странице каталога фильтры запоминаются, в окне выбора — нет.
  const f = onPick ? local : { ...EMPTY, ...saved };
  const set = (p: Partial<Filter>) => (onPick ? setLocal({ ...f, ...p }) : setSaved({ ...f, ...p }));
  const [limit, setLimit] = useState(40);
  const list = useFiltered(f, fit);
  const group = GROUPS.find((g) => g.id === f.group);
  const values: Partial<Record<Muscle, number>> = {};
  for (const m of f.muscle ? [f.muscle as Muscle] : group?.muscles ?? []) values[m] = 1;

  return (
    <div>
      <input className="ft-input" placeholder="Поиск: присед, бицепс, plank…" value={f.q} onChange={(e) => { set({ q: e.target.value }); setLimit(40); }} />

      <div className="mt-3 flex gap-3">
        {!onPick && (
          <BodyMap values={values} className="hidden w-36 shrink-0 sm:block" />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="ft-scroll-x">
            <Chip on={!f.group} onClick={() => set({ group: "", muscle: "" })}>Все мышцы</Chip>
            {GROUPS.map((g) => <Chip key={g.id} on={f.group === g.id} onClick={() => set({ group: f.group === g.id ? "" : g.id, muscle: "" })}>{g.name}</Chip>)}
          </div>
          {group && group.muscles.length > 1 && (
            <div className="ft-scroll-x">
              {group.muscles.map((m) => <Chip key={m} on={f.muscle === m} onClick={() => set({ muscle: f.muscle === m ? "" : m })} className="!min-h-8 !text-xs">{MUSCLES[m]}</Chip>)}
            </div>
          )}
          <div className="ft-scroll-x">
            {TYPES.map((t) => <Chip key={t.id} on={f.type === t.id} onClick={() => set({ type: t.id })} className="!min-h-8 !text-xs">{t.name}</Chip>)}
          </div>
          <div className="ft-scroll-x">
            <Chip on={f.equip === "any"} onClick={() => set({ equip: "any" })} className="!min-h-8 !text-xs">Любой инвентарь</Chip>
            <Chip on={f.equip === "none"} onClick={() => set({ equip: "none" })} className="!min-h-8 !text-xs">🙌 Без инвентаря</Chip>
            <Chip on={f.equip === "here"} onClick={() => set({ equip: "here" })} className="!min-h-8 !text-xs">{fit.place.icon} {fit.place.name}</Chip>
            {(Object.keys(EQUIP) as Equip[]).filter((q) => q !== "mat" && q !== "chair" && q !== "wall").map((q) => (
              <Chip key={q} on={f.equip === q} onClick={() => set({ equip: q })} className="!min-h-8 !text-xs">{EQUIP[q].icon} {EQUIP[q].name}</Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-[var(--ft-muted)]">
        <span>Нашлось: {list.length}</span>
        {(f.q || f.group || f.type !== "all" || f.equip !== "any") && <button className="font-bold text-[var(--ft-lime)]" onClick={() => set(EMPTY)}>сбросить</button>}
      </div>

      <div className="mt-2 space-y-1.5">
        {list.slice(0, limit).map((e) => {
          const added = picked.filter((x) => x === e.id).length;
          const body = (
            <>
              <ExThumb ex={e} className="size-14" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold leading-tight">{e.name}</span>
                <span className="mt-0.5 block truncate text-xs text-[var(--ft-muted)]">
                  {e.muscles.map((m) => MUSCLES[m]).join(", ")}{e.secondary?.length ? <span className="opacity-60"> · {e.secondary.map((m) => MUSCLES[m]).join(", ")}</span> : null}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--ft-muted)]">
                  <Level n={e.level} />
                  {e.equip.length ? <span>{e.equip.map((q) => EQUIP[q].icon).join(" ")}</span> : null}
                  {e.mode === "time" && <span>⏱</span>}
                </span>
              </span>
            </>
          );
          return onPick ? (
            <button key={e.id} onClick={() => onPick(e)} className="flex w-full items-center gap-3 rounded-2xl bg-[var(--ft-panel-2)] p-2 pr-3 text-left hover:brightness-125">
              {body}
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-lg font-bold", added ? "bg-[var(--ft-lime)] text-[#0a0b0d]" : "bg-[var(--ft-panel)] text-[var(--ft-lime)]")}>{added ? `✓${added > 1 ? added : ""}` : "+"}</span>
            </button>
          ) : (
            <Link key={e.id} to={`/ex/${e.id}`} className="flex items-center gap-3 rounded-2xl bg-[var(--ft-panel)] p-2 pr-3 hover:brightness-125">{body}</Link>
          );
        })}
        {!list.length && <div className="py-8 text-center text-sm text-[var(--ft-muted)]">Ничего не нашлось — попробуй убрать фильтры</div>}
        {list.length > limit && (
          <button className="ft-btn ft-btn-ghost mt-2 w-full" onClick={() => setLimit(limit + 60)}>Показать ещё ({list.length - limit})</button>
        )}
      </div>
    </div>
  );
}

function Level({ n }: { n: number }) {
  const lvl = n <= 3 ? 1 : n <= 6 ? 2 : 3;
  return (
    <span className="inline-flex items-center gap-0.5" title={`Сложность ${n}/10`}>
      {[1, 2, 3].map((i) => <span key={i} className={cn("h-2 w-1.5 rounded-sm", i <= lvl ? "bg-[var(--ft-orange)]" : "bg-[#2b2f37]")} />)}
    </span>
  );
}

export function CatalogPage() {
  const fit = useFit();
  if (fit.loading) return <Screen><Loading /></Screen>;
  return (
    <Screen>
      <Header title="Упражнения" subtitle={`${CATALOG.length} упражнений: ${EXERCISES.length} с подробной техникой и анимацией, остальные — из открытой базы с фото`}
        right={<Link to="/skills" className="ft-btn ft-btn-ghost !min-h-10 !px-3 text-sm">🪜 Навыки</Link>} />
      <Link to="/my/new" className="ft-panel mb-4 flex items-center gap-3 p-3">
        <span className="text-2xl">⭐</span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">Собрать свой комплекс</span>
          <span className="block text-xs text-[var(--ft-muted)]">Зарядка, разминка или тренировка из любых упражнений</span>
        </span>
        <span className="text-[var(--ft-lime)]">→</span>
      </Link>
      <CatalogList fit={fit} />
    </Screen>
  );
}
