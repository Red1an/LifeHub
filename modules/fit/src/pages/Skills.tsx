import { useState } from "react";
import { cn, Link, Loading } from "@lifehub/sdk";
import { CHAINS, EX, EXERCISES, EQUIP, MUSCLES, PATTERNS, hasEquip } from "../data/library.ts";
import { lastPerformance, doneSets } from "../lib/analysis.ts";
import { masterySec } from "../lib/game.ts";
import { chainStep } from "../lib/generator.ts";
import { useFit, type Fit } from "../lib/store.ts";
import type { Equip, Pattern } from "../lib/types.ts";
import { Bar, Chip, Header, Pill, Screen } from "../components/kit.tsx";

/** Текущая ступень и прогресс до следующей. */
export function chainState(fit: Fit, chainId: string) {
  const c = CHAINS.find((x) => x.id === chainId)!;
  // Ступень независимо от места: сохранённая или стартовая по опыту.
  const cur = EX.get(fit.levels[chainId] ?? "") ?? chainStep(chainId, { levels: fit.levels, profile: fit.profile, hidden: [], place: { equip: Object.keys(EQUIP) as Equip[] } });
  const idx = cur ? c.steps.indexOf(cur.id) : 0;
  const last = cur ? lastPerformance(fit.hist, cur.id) : null;
  let progress = 0, text = "ещё не делал";
  if (cur && last) {
    const done = doneSets(last.item);
    if (cur.mode === "time") {
      const best = Math.max(0, ...done.map((s) => s.sec ?? 0));
      progress = best / masterySec(cur.level);
      text = `лучшее ${best} с из ${masterySec(cur.level)} с`;
    } else {
      const top = last.item.plan.reps?.[1] ?? 12;
      const min = Math.min(...done.map((s) => s.reps ?? 0));
      progress = min / top;
      text = `худший подход ${min} из ${top} повт.`;
    }
  }
  return { c, cur, idx, progress, text };
}

export function SkillsPage() {
  const fit = useFit();
  const [tab, setTab] = useState<"skills" | "library">("skills");
  if (fit.loading) return <Screen><Loading /></Screen>;
  return (
    <Screen>
      <Header title={tab === "skills" ? "Навыки" : "Упражнения"} subtitle={tab === "skills" ? "Лестницы прогрессии: освой ступень — откроется следующая" : `${EXERCISES.length} упражнений с техникой`} />
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-[var(--ft-panel)] p-1">
        {([["skills", "🪜 Лестницы"], ["library", "📚 Библиотека"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("rounded-xl py-2.5 text-sm font-bold transition", tab === k ? "bg-[var(--ft-lime)] text-[#0a0b0d]" : "text-[var(--ft-muted)]")}>{l}</button>
        ))}
      </div>
      {tab === "skills" ? <Ladders fit={fit} /> : <Library fit={fit} />}
    </Screen>
  );
}

function Ladders({ fit }: { fit: Fit }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ft-muted)]">
        Как в гимнастике: когда во всех подходах берёшь верх диапазона и не «тяжело» — ступень засчитана, и в следующий раз
        будет упражнение сложнее. Ступень можно выбрать и вручную — нажми на неё.
      </p>
      {CHAINS.map((ch) => {
        const { c, cur, idx, progress, text } = chainState(fit, ch.id);
        return (
          <div key={c.id} className="ft-panel p-4">
            <div className="flex items-center gap-3">
              <div className="text-3xl">{c.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="font-extrabold">{c.name}</div>
                  <Pill color="#c8f031">{idx + 1}/{c.steps.length}</Pill>
                </div>
                <div className="truncate text-xs text-[var(--ft-muted)]">{c.goal}</div>
              </div>
            </div>
            {cur && (
              <Link to={`/ex/${cur.id}`} className="mt-3 block rounded-2xl bg-[var(--ft-panel-2)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold">{cur.icon} {cur.name}</div>
                  <div className="text-xs text-[var(--ft-muted)]">сейчас</div>
                </div>
                <Bar value={progress} className="mt-2" height={6} />
                <div className="mt-1 text-[11px] text-[var(--ft-muted)]">{text} → следующая ступень</div>
              </Link>
            )}
            <div className="ft-scroll-x mt-3 !gap-1.5 pb-1">
              {c.steps.map((id, i) => {
                const e = EX.get(id)!;
                return (
                  <Link key={id} to={`/ex/${id}`} title={e.name}
                    className={cn("flex w-20 shrink-0 flex-col items-center rounded-2xl border px-1 py-2 text-center",
                      i === idx ? "border-[var(--ft-lime)] bg-[var(--ft-lime)]/12" : i < idx ? "border-transparent bg-[var(--ft-panel-2)]" : "border-dashed border-[var(--ft-line)] opacity-60")}>
                    <span className="text-xl">{i < idx ? "✅" : e.icon}</span>
                    <span className="mt-1 line-clamp-2 text-[10px] font-semibold leading-tight">{e.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const FILTERS: (Pattern | "all")[] = ["all", "push_h", "push_v", "pull_v", "pull_h", "dip", "squat", "lunge", "hinge", "core", "arms", "calves", "cardio", "mobility", "stretch"];

function Library({ fit }: { fit: Fit }) {
  const [q, setQ] = useState("");
  const [pat, setPat] = useState<Pattern | "all">("all");
  const [here, setHere] = useState(false);
  const list = EXERCISES
    .filter((e) => pat === "all" || e.pattern === pat)
    .filter((e) => !here || hasEquip(e, fit.place.equip))
    .filter((e) => !q || (e.name + " " + e.muscles.map((m) => MUSCLES[m]).join(" ")).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <input className="ft-input" placeholder="Поиск: «пресс», «гантели», «планка»…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ft-scroll-x mt-3">
        {FILTERS.map((f) => <Chip key={f} on={pat === f} onClick={() => setPat(f)}>{f === "all" ? "Все" : PATTERNS[f]}</Chip>)}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-[var(--ft-muted)]">
        <input type="checkbox" checked={here} onChange={(e) => setHere(e.target.checked)} /> только доступные в «{fit.place.name}»
      </label>
      <div className="mt-3 space-y-1.5">
        {list.map((e) => (
          <Link key={e.id} to={`/ex/${e.id}`} className={cn("flex items-center gap-3 rounded-2xl bg-[var(--ft-panel)] px-3 py-2.5", fit.hidden.includes(e.id) && "opacity-50")}>
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--ft-panel-2)] text-xl">{e.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{e.name}</span>
              <span className="block truncate text-xs text-[var(--ft-muted)]">
                {e.muscles.map((m) => MUSCLES[m]).join(", ")}{e.equip.length ? ` · ${e.equip.map((x) => EQUIP[x].icon).join("")}` : ""}
              </span>
            </span>
            <span className="flex gap-0.5">{Array.from({ length: Math.min(5, Math.ceil(e.level / 2)) }, (_, i) => <span key={i} className="h-3 w-1 rounded-full bg-[var(--ft-orange)]" />)}</span>
          </Link>
        ))}
        {!list.length && <div className="py-6 text-center text-sm text-[var(--ft-muted)]">Ничего не нашлось</div>}
      </div>
    </div>
  );
}
