import { useEffect, useRef } from "react";
import { confirm, formatDate, formatDuration, Link, Loading, useDoc, useLocation, useNavigate, useParams } from "@lifehub/sdk";
import { CHAIN, EX } from "../data/library.ts";
import { doneSets, isMain } from "../lib/analysis.ts";
import { rankFor } from "../lib/game.ts";
import { useFit } from "../lib/store.ts";
import type { Workout } from "../lib/types.ts";
import { Btn, celebrate, Panel, Screen, Section } from "../components/kit.tsx";
import { planText } from "../components/Editor.tsx";

const PRAISE = ["Мощно! 💥", "Красавчик! 🔥", "Так держать! 💪", "Ещё один кирпич в форму 🧱", "Сделано! ✅", "Огонь! 🚀"];

/** Итоги тренировки (сразу после неё — с праздником) и просмотр из истории. */
export function SummaryPage() {
  const { id } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const fresh = loc.pathname.includes("/done/");
  const fit = useFit();
  const { doc: w, update, remove } = useDoc<Workout>("workouts", id ?? "");
  const shown = useRef(false);

  useEffect(() => {
    if (fresh && w && !shown.current) {
      shown.current = true;
      celebrate(true);
    }
  }, [fresh, w]);

  if (!w) return <Screen><Loading /></Screen>;

  const main = w.items.filter(isMain);
  const sets = main.reduce((n, it) => n + doneSets(it).length, 0);
  const reps = main.reduce((n, it) => n + doneSets(it).reduce((a, s) => a + (s.reps ?? 0), 0), 0);
  const tonnage = main.reduce((n, it) => n + doneSets(it).reduce((a, s) => a + (s.reps ?? 0) * (s.kg ?? 0) * (EX.get(it.ex)?.load === "dumbbell" ? 2 : 1), 0), 0);
  const before = rankFor(fit.xp - (w.xp ?? 0));
  const rankUp = fresh && before.rank.title !== fit.rank.rank.title;
  const praise = PRAISE[(w.startedAt ?? 0) % PRAISE.length];

  return (
    <Screen>
      <div className="ft-pop text-center">
        <div className="text-6xl">{w.kind === "workout" ? "🏆" : w.kind === "break" ? "🧘" : w.kind === "morning" ? "🌅" : "🌙"}</div>
        <h1 className="ft-display mt-3 text-3xl font-extrabold">{fresh ? praise : w.title}</h1>
        <div className="mt-1 text-sm text-[var(--ft-muted)]">{fresh ? w.title : formatDate(w.finishedAt ?? w.startedAt, "datetime")}</div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <Stat big={formatDuration(w.seconds ?? 0)} label="время" />
        <Stat big={`+${w.xp ?? 0}`} label="XP" color="var(--ft-lime)" />
        <Stat big={w.kind === "workout" ? String(sets) : String(w.items.length)} label={w.kind === "workout" ? "подходов" : "упражнений"} />
      </div>
      {w.kind === "workout" && (reps > 0 || tonnage > 0) && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat big={String(reps)} label="повторов" />
          <Stat big={tonnage ? `${Math.round(tonnage)} кг` : "—"} label="тоннаж" />
        </div>
      )}

      {rankUp && (
        <Panel className="ft-pop mt-4 border-[var(--ft-lime)]/60 text-center">
          <div className="text-4xl">{fit.rank.rank.icon}</div>
          <div className="mt-1 font-extrabold">Новый ранг: {fit.rank.rank.title}!</div>
        </Panel>
      )}

      {!!w.prs?.length && (
        <Section title="📈 Личные рекорды">
          <div className="space-y-1.5">
            {w.prs.map((p) => <div key={p} className="ft-pop rounded-2xl bg-[var(--ft-lime)]/12 px-4 py-2.5 font-bold text-[var(--ft-lime)]">🥇 {p}</div>)}
          </div>
        </Section>
      )}

      {!!w.ups?.length && (
        <Section title="🆙 Новая ступень">
          <div className="space-y-1.5">
            {w.ups.map((u) => (
              <Link key={u.chain} to={`/ex/${u.to}`} className="ft-pop block rounded-2xl bg-[var(--ft-orange)]/12 px-4 py-2.5">
                <div className="text-xs text-[var(--ft-muted)]">{CHAIN.get(u.chain)?.icon} {CHAIN.get(u.chain)?.name}: ступень освоена</div>
                <div className="font-bold text-[var(--ft-orange)]">{EX.get(u.from)?.name} → {EX.get(u.to)?.icon} {EX.get(u.to)?.name}</div>
              </Link>
            ))}
          </div>
          <div className="mt-2 text-xs text-[var(--ft-muted)]">В следующий раз будет упражнение сложнее. Если рано — верни ступень на странице упражнения.</div>
        </Section>
      )}

      {w.kind === "workout" && (
        <Section title="Как тренировка?">
          <div className="flex justify-center gap-2">
            {([1, 2, 3, 4, 5] as const).map((r) => (
              <button key={r} onClick={() => void update({ rating: r })} className="text-3xl transition hover:scale-110" style={{ filter: (w.rating ?? 0) >= r ? "none" : "grayscale(1) opacity(0.35)" }}>⭐</button>
            ))}
          </div>
        </Section>
      )}

      {w.kind === "workout" && (
        <Section title="Что сделано">
          <div className="space-y-1.5">
            {main.map((it, i) => {
              const e = EX.get(it.ex);
              const d = doneSets(it);
              return (
                <div key={i} className="flex items-center gap-3 rounded-2xl bg-[var(--ft-panel)] px-3 py-2">
                  <span className="text-xl">{e?.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{e?.name}</span>
                    <span className="block text-xs text-[var(--ft-muted)]">план {planText(it)}</span>
                  </span>
                  <span className="ft-num text-right text-xs font-bold">
                    {d.length ? d.map((s) => (e?.mode === "time" ? `${s.sec}с` : `${s.reps}${s.kg ? `×${s.kg}` : ""}`)).join(" ") : <span className="text-[var(--ft-muted)]">пропущено</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Заметка">
        <textarea className="ft-input min-h-20" placeholder="Самочувствие, что болело, что понравилось…" defaultValue={w.note ?? ""} onBlur={(e) => void update({ note: e.target.value })} />
      </Section>

      <div className="mt-6 flex flex-wrap gap-2">
        <Btn onClick={() => nav("/")}>На главную</Btn>
        {!fresh && <Btn tone="red" onClick={async () => { if (await confirm("Удалить запись о тренировке?", { danger: true })) { await remove(); nav("/progress"); } }}>Удалить</Btn>}
      </div>
    </Screen>
  );
}

function Stat({ big, label, color }: { big: string; label: string; color?: string }) {
  return (
    <div className="ft-panel p-3 text-center">
      <div className="ft-num text-xl font-extrabold" style={{ color }}>{big}</div>
      <div className="text-[11px] text-[var(--ft-muted)]">{label}</div>
    </div>
  );
}
