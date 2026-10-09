import { cn } from "@lifehub/sdk";
import { VERDICT, type Advice, type Verdict } from "../lib/advice.ts";

export function VerdictTag({ v, className }: { v: Verdict; className?: string }) {
  return <span className={cn("inv-tag", VERDICT[v].tag, className)}>{VERDICT[v].short}</span>;
}

const SCORE_COLOR = (s: number) => (s >= 4 ? "var(--inv-green)" : s >= 2.5 ? "var(--inv-gold)" : "var(--inv-red)");

/** «Что делать с этой бумагой»: вердикт, плюсы и минусы, шаги и оценка по направлениям. */
export function VerdictCard({ a }: { a: Advice }) {
  const v = VERDICT[a.verdict];
  return (
    <section className="inv-panel overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--inv-line)] bg-[var(--inv-panel-2)] px-4 py-3 sm:px-5">
        <span className="text-2xl">{v.icon}</span>
        <div className="min-w-0">
          <div className="inv-label">Что делать с бумагой</div>
          <div className="text-lg font-extrabold leading-tight">{v.title}</div>
        </div>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <p className="text-[15px] leading-relaxed">{a.summary}</p>
        {(a.pros.length > 0 || a.cons.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {a.pros.length > 0 && (
              <div>
                <div className="inv-label mb-1 !text-[var(--inv-green)]">За</div>
                <ul className="space-y-1 text-sm">
                  {a.pros.map((x) => (
                    <li key={x} className="flex gap-2">
                      <span className="inv-up">+</span>
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {a.cons.length > 0 && (
              <div>
                <div className="inv-label mb-1 !text-[var(--inv-red)]">Против</div>
                <ul className="space-y-1 text-sm">
                  {a.cons.map((x) => (
                    <li key={x} className="flex gap-2">
                      <span className="inv-down">−</span>
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {a.steps.length > 0 && (
          <div className="inv-soft p-3">
            <div className="inv-label mb-1">Что сделать</div>
            <ul className="space-y-1.5 text-sm">
              {a.steps.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="text-[var(--inv-green)]">→</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {a.scores.length > 0 && (
          <div>
            <div className="inv-label mb-2">Оценка по направлениям (0–5)</div>
            <div className="space-y-2">
              {a.scores.map((s) => (
                <div key={s.name} className="text-[13px]">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{s.name}</span>
                    <span className="inv-muted truncate text-xs">{s.note}</span>
                  </div>
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} className="h-2 flex-1 rounded-full" style={{ background: i < s.score ? SCORE_COLOR(s.score) : "var(--inv-panel-3)" }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="inv-faint text-xs">Расчёт по правилам и вашим данным, не прогноз цены и не индивидуальная рекомендация.</p>
      </div>
    </section>
  );
}
