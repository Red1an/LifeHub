import { useState } from "react";
import { formatDate, LineChart, Link, Loading, toast, useCollection, useNavigate, useParams } from "@lifehub/sdk";
import { CHAIN, EQUIP, EX, LIMITS, MUSCLES, PATTERNS, neighbours, videoUrl } from "../data/library.ts";
import { doneSets, isMain } from "../lib/analysis.ts";
import { useFit } from "../lib/store.ts";
import type { Muscle } from "../lib/types.ts";
import { useHowTo } from "../lib/media.ts";
import { defaultItem, type MyRoutine } from "../lib/custom.ts";
import { BodyMap } from "../components/BodyMap.tsx";
import { ExVisual } from "../components/Visual.tsx";
import { blankRoutine } from "./MyRoutine.tsx";
import { Sheet } from "./Player.tsx";
import { Btn, Header, Panel, Pill, Screen, Section } from "../components/kit.tsx";

export function ExercisePage() {
  const { id } = useParams();
  const fit = useFit();
  const e = EX.get(decodeURIComponent(id ?? ""));
  const how = useHowTo(e);
  const [adding, setAdding] = useState(false);
  if (fit.loading) return <Screen><Loading /></Screen>;
  if (!e) return <Screen><Header title="Упражнение не найдено" back="/catalog" /></Screen>;

  const values: Partial<Record<Muscle, number>> = {};
  for (const m of e.secondary ?? []) values[m] = 0.5;
  for (const m of e.muscles) values[m] = 1;

  const chain = e.chain ? CHAIN.get(e.chain) : undefined;
  const { easier, harder } = neighbours(e.id);
  const isCurrent = chain && fit.levels[chain.id] === e.id;
  const hidden = fit.hidden.includes(e.id);

  // История: лучший подход в каждой тренировке.
  const history = fit.hist
    .map((w) => {
      const sets = w.items.filter((it) => it.ex === e.id && isMain(it)).flatMap(doneSets);
      if (!sets.length) return null;
      const value = e.load ? Math.max(...sets.map((s) => s.kg ?? 0)) : e.mode === "time" ? Math.max(...sets.map((s) => s.sec ?? 0)) : Math.max(...sets.map((s) => s.reps ?? 0));
      return { at: w.finishedAt!, value, sets };
    })
    .filter((x) => x !== null);
  const unit = e.load ? "кг" : e.mode === "time" ? "с" : "повт.";

  return (
    <Screen>
      <Header back="/catalog" title={<span>{e.icon} {e.name}</span>} subtitle={`${PATTERNS[e.pattern]} · сложность ${e.level}/10`} />

      <ExVisual ex={e} className="mb-4 h-64 w-full sm:h-80" />

      <div className="grid gap-4 sm:grid-cols-[1fr_1.3fr]">
        <Panel>
          <BodyMap values={values} className="h-56" />
          <div className="mt-3 flex flex-wrap gap-1">
            {e.muscles.map((m) => <Pill key={m} color="#c8f031">{MUSCLES[m]}</Pill>)}
            {e.secondary?.map((m) => <Pill key={m}>{MUSCLES[m]}</Pill>)}
          </div>
        </Panel>
        <div className="space-y-3">
          <Panel className="!p-4">
            <div className="text-xs font-extrabold uppercase tracking-widest text-[var(--ft-muted)]">Нужно</div>
            <div className="mt-1 text-sm">{e.equip.length ? e.equip.map((q) => `${EQUIP[q].icon} ${EQUIP[q].name}`).join(" · ") : "Ничего — только своё тело"}</div>
            <div className="mt-3 text-xs font-extrabold uppercase tracking-widest text-[var(--ft-muted)]">Формат</div>
            <div className="mt-1 text-sm">{e.mode === "time" ? "На время" : "На повторы"}{e.sides ? ", на каждую сторону" : ""}{e.load ? ", с весом" : ""}</div>
            {e.avoid?.length ? (
              <div className="mt-3 rounded-xl bg-[var(--ft-orange)]/10 px-3 py-2 text-sm">⚠️ Осторожно при проблемах: {e.avoid.map((l) => LIMITS[l].toLowerCase()).join(", ")}</div>
            ) : null}
          </Panel>
          <Btn block onClick={() => setAdding(true)}>⭐ В свой комплекс</Btn>
          <a href={videoUrl(e)} target="_blank" rel="noreferrer" className="ft-btn ft-btn-ghost w-full">▶ Видео с техникой на YouTube</a>
        </div>
      </div>

      <Section title="Как делать" right={how.busy ? <span className="text-xs text-[var(--ft-muted)]">перевожу…</span> : null}>
        {how.english && (
          <div className="mb-3 rounded-xl bg-[var(--ft-panel)] px-3 py-2 text-xs text-[var(--ft-muted)]">
            {how.busy ? "Пока перевод готовится, показываю оригинал на английском." : `Оригинал на английском${how.error ? ` — перевести не получилось: ${how.error}` : ""}.`}
          </div>
        )}
        {!how.steps.length && <div className="text-sm text-[var(--ft-muted)]">{how.error ?? "Загружаю технику…"}</div>}
        <ol className="space-y-2">
          {how.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="ft-num grid size-7 shrink-0 place-items-center rounded-full bg-[var(--ft-lime)] text-xs font-bold text-[#0a0b0d]">{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
      </Section>

      {(e.cues.length > 0 || e.mistakes.length > 0) && <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Panel>
          <div className="mb-2 text-xs font-extrabold uppercase tracking-widest text-[var(--ft-lime)]">✓ Ключевое</div>
          <ul className="space-y-1.5 text-sm">{e.cues.map((c, i) => <li key={i}>{c}</li>)}</ul>
          {e.breathe && <div className="mt-3 text-sm text-[var(--ft-muted)]">🌬️ {e.breathe}</div>}
        </Panel>
        <Panel>
          <div className="mb-2 text-xs font-extrabold uppercase tracking-widest text-[var(--ft-orange)]">✗ Частые ошибки</div>
          <ul className="space-y-1.5 text-sm">{e.mistakes.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </Panel>
      </div>}

      {chain && (
        <Section title={`${chain.icon} Лестница «${chain.name}»`}>
          <div className="grid grid-cols-2 gap-2">
            {easier ? <Link to={`/ex/${easier.id}`} className="ft-panel p-3 text-sm"><div className="text-xs text-[var(--ft-muted)]">← легче</div><div className="font-bold">{easier.icon} {easier.name}</div></Link> : <div />}
            {harder ? <Link to={`/ex/${harder.id}`} className="ft-panel p-3 text-right text-sm"><div className="text-xs text-[var(--ft-muted)]">сложнее →</div><div className="font-bold">{harder.icon} {harder.name}</div></Link> : <div />}
          </div>
          {isCurrent
            ? <div className="mt-3 text-sm text-[var(--ft-lime)]">✓ Это твоя текущая ступень</div>
            : <Btn tone="ghost" className="mt-3" onClick={() => { fit.setLevels({ ...fit.levels, [chain.id]: e.id }); toast(`Ступень «${chain.name}»: ${e.name}`, "success"); }}>Сделать текущей ступенью</Btn>}
        </Section>
      )}

      <Section title="Моя история">
        {history.length ? (
          <>
            {history.length > 1 && (
              <Panel className="mb-3">
                <LineChart labels={history.map((h) => formatDate(h.at, "short"))} series={[{ name: `Лучший подход, ${unit}`, points: history.map((h) => h.value), color: "#c8f031" }]} height={160} />
              </Panel>
            )}
            <div className="space-y-1.5">
              {history.slice(-6).reverse().map((h, i) => (
                <div key={i} className="flex items-center justify-between rounded-2xl bg-[var(--ft-panel)] px-3 py-2 text-sm">
                  <span className="text-[var(--ft-muted)]">{formatDate(h.at, "short")}</span>
                  <span className="ft-num font-bold">
                    {h.sets.map((s) => (e.mode === "time" ? `${s.sec}с` : `${s.reps}${s.kg ? `×${s.kg}` : ""}`)).join("  ")}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : <div className="text-sm text-[var(--ft-muted)]">Ещё не делал в основной части тренировки.</div>}
      </Section>

      {adding && <AddToMine exId={e.id} onClose={() => setAdding(false)} />}

      {!e.ext && <div className="mt-8">
        <Btn tone={hidden ? "ghost" : "red"} onClick={() => fit.setHidden(hidden ? fit.hidden.filter((x) => x !== e.id) : [...fit.hidden, e.id])}>
          {hidden ? "Вернуть в подборки" : "🚫 Не предлагать это упражнение"}
        </Btn>
      </div>}
    </Screen>
  );
}

/** Добавить упражнение в свой комплекс или начать новый. */
function AddToMine({ exId, onClose }: { exId: string; onClose: () => void }) {
  const mine = useCollection<MyRoutine>("mine");
  const nav = useNavigate();
  const add = async (r?: MyRoutine & { id: string }) => {
    if (r) {
      await mine.update(r.id, { items: [...r.items, defaultItem(exId, r)] });
      toast(`Добавлено в «${r.title}»`, "success");
      onClose();
    } else {
      // Силовое — сразу тренировка с подходами, растяжка — растяжка, остальное — зарядка по таймеру.
      const p = EX.get(exId)?.pattern;
      const kind = p === "stretch" ? "stretch" : p === "mobility" || p === "cardio" ? "morning" : "workout";
      const base = { ...blankRoutine(), kind, rest: kind === "workout" ? 60 : 0 } as MyRoutine;
      const doc = await mine.add({ ...base, items: [defaultItem(exId, base)] });
      nav(`/my/${doc.id}`);
    }
  };
  return (
    <Sheet onClose={onClose}>
      <div className="ft-display mb-3 text-lg font-bold">В какой комплекс?</div>
      <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
        {mine.items.map((r) => (
          <button key={r.id} onClick={() => void add(r)} className="flex w-full items-center gap-3 rounded-2xl bg-[var(--ft-panel-2)] px-3 py-2.5 text-left hover:brightness-125">
            <span className="text-2xl">{r.icon}</span>
            <span className="min-w-0 flex-1 truncate font-bold">{r.title}</span>
            <span className="text-xs text-[var(--ft-muted)]">{r.items.length} упр.</span>
          </button>
        ))}
        <button onClick={() => void add()} className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-[var(--ft-line)] px-3 py-2.5 text-left font-bold text-[var(--ft-lime)]">
          ＋ Новый комплекс
        </button>
      </div>
    </Sheet>
  );
}
