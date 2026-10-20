import { useMemo, useState } from "react";
import { BarChart, Button, Heatmap, Link, Loading, Tabs, cn, useAi, useCollection, useSearchParams } from "@lifehub/sdk";
import { categoryAverages, monthStats, monthsTrend, pace } from "../lib/analytics.ts";
import { monthShort, monthTitle, parse, shortDate, today } from "../lib/dates.ts";
import { buildInsights, totalSaving } from "../lib/insights.ts";
import { pct, rub, short } from "../lib/money.ts";
import { useFinance } from "../lib/store.tsx";
import { isExpense } from "../lib/analytics.ts";
import { Bar, CAT_COLORS, Card, InsightCard, MonthSwitcher, useMonth } from "../components/ui.tsx";

type Tab = "spend" | "trend" | "save" | "subs";

export function Analytics() {
  const f = useFinance();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "spend";
  const [month, setMonth] = useMonth();

  if (f.loading) return <Loading />;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Анализ</h1>
        {(tab === "spend" || tab === "save") && <MonthSwitcher month={month} onChange={setMonth} />}
      </div>
      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={(t) => setParams({ tab: t === "spend" ? null : t })}
        tabs={[
          { id: "spend", label: "Траты" },
          { id: "trend", label: "Динамика" },
          { id: "save", label: "Экономия" },
          { id: "subs", label: "Подписки" },
        ]}
      />
      {tab === "spend" && <Spend month={month} />}
      {tab === "trend" && <Trend />}
      {tab === "save" && <Save month={month} />}
      {tab === "subs" && <Subs />}
    </div>
  );
}

function Spend({ month }: { month: string }) {
  const f = useFinance();
  const ms = useMemo(() => monthStats(f.txs, month), [f.txs, month]);
  const avg = useMemo(() => categoryAverages(f.txs, month), [f.txs, month]);
  const p = useMemo(() => pace(f.txs, month, f.budget), [f.txs, month, f.budget]);
  const scale = month === today().slice(0, 7) && p.day ? p.days / p.day : 1;
  const [open, setOpen] = useState<string | null>(null);

  if (!ms.byCategory.length) return <p className="py-10 text-center text-muted">В {monthTitle(month).toLowerCase()} трат нет</p>;
  return (
    <div className="space-y-4">
      <Card>
        <div className="fin-label">Всего за месяц</div>
        <div className="fin-num mt-1 text-3xl font-extrabold">{rub(ms.spent)}</div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full">
          {ms.byCategory
            .filter((c) => c.value > 0)
            .map((c, i) => (
              <div key={c.name} title={`${c.name}: ${rub(c.value)}`} style={{ width: `${(c.value / ms.spent) * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
            ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted">
          {ms.byCategory.slice(0, 6).map((c, i) => (
            <span key={c.name} className="flex items-center gap-1">
              <span className="fin-dot" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />
              {c.name} {Math.round((c.value / ms.spent) * 100)}%
            </span>
          ))}
        </div>
      </Card>
      <Card title="По категориям" padded={false}>
        <div className="px-1 pb-2">
          {ms.byCategory.map((c, i) => {
            const base = avg.get(c.name) ?? 0;
            const fixed = f.categories.find((x) => x.name === c.name && x.kind === "expense")?.fixed;
            const proj = fixed ? c.value : c.value * scale;
            const diff = base > 0 ? proj / base - 1 : 0;
            const lim = f.categories.find((x) => x.name === c.name && x.kind === "expense")?.limit;
            const merchants = ms.byMerchant.filter((m) => m.category === c.name).slice(0, 6);
            return (
              <div key={c.name}>
                <button type="button" className="fin-row" onClick={() => setOpen(open === c.name ? null : c.name)}>
                  <span className="fin-icon">{f.categoryIcon(c.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="text-[12px] text-muted">{c.count} шт</span>
                    </span>
                    <Bar className="mt-1.5" value={c.value} max={lim ?? ms.byCategory[0].value} color={lim && c.value > lim ? "var(--fin-red)" : CAT_COLORS[i % CAT_COLORS.length]} />
                    <span className="mt-1 block text-[12px] text-muted">
                      {lim ? `лимит ${rub(lim)} · ` : ""}
                      {base > 0 ? (
                        <>
                          обычно {short(base)}{" "}
                          {Math.abs(diff) >= 0.1 && <span className={diff > 0 ? "fin-down" : "fin-up"}>{pct(diff)}</span>}
                        </>
                      ) : (
                        "новое"
                      )}
                    </span>
                  </span>
                  <span className="fin-num self-start font-semibold">{rub(c.value)}</span>
                </button>
                {open === c.name && (
                  <div className="mx-3 mb-2 rounded-2xl bg-surface-2 p-2">
                    {merchants.map((m) => (
                      <div key={m.name} className="flex justify-between px-2 py-1 text-[13.5px]">
                        <span className="truncate">
                          {m.name} <span className="text-muted">×{m.count}</span>
                        </span>
                        <span className="fin-num">{rub(m.value)}</span>
                      </div>
                    ))}
                    <Link to={`/ops?cat=${encodeURIComponent(c.name)}&month=${month}`} className="block px-2 pt-1 text-[13px] font-medium text-accent">
                      Все операции ›
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Где тратите чаще всего">
        <div className="space-y-2">
          {ms.byMerchant.slice(0, 8).map((m) => (
            <div key={m.name} className="flex items-center gap-3 text-[14.5px]">
              <span>{f.categoryIcon(m.category)}</span>
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="text-[12.5px] text-muted">{m.count} раз</span>
              <span className="fin-num w-24 text-right font-semibold">{rub(m.value)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Trend() {
  const f = useFinance();
  const month = today().slice(0, 7);
  const trend = useMemo(() => monthsTrend(f.txs, month, 12).filter((m, i, a) => m.spent || m.income || i >= a.length - 3), [f.txs, month]);
  const heat = useMemo(() => {
    const v: Record<string, number> = {};
    for (const t of f.txs) if (isExpense(t)) v[t.date] = (v[t.date] ?? 0) + (t.share ?? t.amount);
    return v;
  }, [f.txs]);
  const weekdays = useMemo(() => {
    const sums = Array(7).fill(0);
    const days = new Set<string>();
    for (const [d, v] of Object.entries(heat)) {
      if (d < trend[0]?.month) continue;
      sums[(parse(d).getDay() + 6) % 7] += v;
      days.add(d);
    }
    const weeks = Math.max(1, days.size / 7);
    return ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label, i) => ({ label, value: Math.round(sums[i] / weeks) }));
  }, [heat, trend]);
  const avgSpent = trend.filter((m) => m.spent).reduce((s, m, _, a) => s + m.spent / a.length, 0);
  const avgIncome = trend.filter((m) => m.income).reduce((s, m, _, a) => s + m.income / a.length, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="fin-label">Тратите в месяц</div>
          <div className="fin-num mt-1 text-xl font-bold">{short(avgSpent)}</div>
        </Card>
        <Card>
          <div className="fin-label">Получаете</div>
          <div className="fin-num mt-1 text-xl font-bold fin-up">{short(avgIncome)}</div>
        </Card>
      </div>
      <Card title="Траты по месяцам">
        <BarChart data={trend.map((m) => ({ label: monthShort(m.month), value: Math.round(m.spent), color: m.month === month ? "var(--lh-accent)" : undefined }))} format={(v) => short(v)} />
      </Card>
      <Card title="Сколько осталось (доход − траты)">
        <Diverging data={trend.map((m) => ({ label: monthShort(m.month), value: Math.round(m.income - m.spent) }))} />
      </Card>
      <Card title="По дням недели (в среднем)">
        <BarChart data={weekdays} format={(v) => short(v)} height={140} />
      </Card>
      <Card title="Календарь трат">
        <Heatmap values={heat} weeks={20} />
      </Card>
    </div>
  );
}

/** Столбики вверх (плюс) и вниз (минус) от нуля. */
function Diverging({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const h = 70;
  return (
    <div>
      <div className="flex gap-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col" title={`${d.label}: ${rub(d.value)}`}>
            <div className="flex flex-col justify-end" style={{ height: h }}>
              {d.value > 0 && <div className="rounded-t-md bg-[var(--fin-green)]" style={{ height: (d.value / max) * h }} />}
            </div>
            <div className="h-px bg-line" />
            <div style={{ height: h }}>{d.value < 0 && <div className="rounded-b-md bg-[var(--fin-red)]" style={{ height: (-d.value / max) * h }} />}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {data.map((d) => (
          <div key={d.label} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function Save({ month }: { month: string }) {
  const f = useFinance();
  const { insights } = useMemo(
    () =>
      buildInsights({
        txs: f.txs, month, budget: f.budget, states: f.states, plans: f.plans, debts: f.debts, people: f.people,
        fixedCategories: f.categories.filter((c) => c.fixed).map((c) => c.name),
      }),
    [f.txs, f.states, f.plans, f.debts, f.people, f.budget, f.categories, month],
  );
  const [showHidden, setShowHidden] = useState(false);
  const visible = insights.filter((i) => showHidden || !f.prefs.hidden.includes(i.id));
  const total = totalSaving(visible.filter((i) => !f.prefs.hidden.includes(i.id)));
  return (
    <div className="space-y-4">
      {total >= 300 && (
        <section className="fin-hero p-5">
          <div className="fin-label">Можно сэкономить</div>
          <div className="fin-num mt-1 text-3xl font-extrabold">≈ {rub(Math.round(total / 100) * 100)} в месяц</div>
          <div className="mt-1 text-[13.5px] text-emerald-50/80">≈ {short(total * 12)} в год, если поработать над находками ниже</div>
        </section>
      )}
      <div className="space-y-2">
        {visible.map((i) => (
          <InsightCard key={i.id} i={i} onHide={f.prefs.hidden.includes(i.id) ? undefined : () => f.setPrefs({ ...f.prefs, hidden: [...f.prefs.hidden, i.id] })} />
        ))}
        {!visible.length && <p className="py-6 text-center text-muted">Пока находок нет — нужно больше операций (лучше за 2–3 месяца).</p>}
        {f.prefs.hidden.length > 0 && (
          <button type="button" className="text-sm text-muted underline" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? "Не показывать скрытые" : `Показать скрытые (${f.prefs.hidden.length})`}
          </button>
        )}
      </div>
      <AiReview month={month} />
    </div>
  );
}

interface Review {
  month: string;
  text: string;
  at: number;
}

/** Разбор месяца нейронкой: получает только сводку (категории, продавцы, подписки), без выписок. */
function AiReview({ month }: { month: string }) {
  const f = useFinance();
  const reviews = useCollection<Review>("reviews");
  const saved = reviews.items.filter((r) => r.month === month).sort((a, b) => b.at - a.at)[0];
  const { run, text, loading, error } = useAi();

  const go = async () => {
    const ms = monthStats(f.txs, month);
    const avg = categoryAverages(f.txs, month);
    const { insights, recurring } = buildInsights({
      txs: f.txs, month, budget: f.budget, states: f.states, plans: f.plans, debts: f.debts, people: f.people,
      fixedCategories: f.categories.filter((c) => c.fixed).map((c) => c.name),
    });
    const summary = {
      месяц: monthTitle(month),
      потрачено: Math.round(ms.spent),
      доход: Math.round(ms.income),
      бюджет: f.budget || null,
      категории: ms.byCategory.map((c) => ({ название: c.name, сумма: Math.round(c.value), раз: c.count, обычно: Math.round(avg.get(c.name) ?? 0) })),
      частые_места: ms.byMerchant.slice(0, 15).map((m) => ({ где: m.name, сумма: Math.round(m.value), раз: m.count })),
      подписки: recurring.map((r) => ({ что: r.name, в_месяц: Math.round(r.monthly) })),
      долги_по_кредиткам_и_сплитам: f.states.filter((s) => s.debt > 0).map((s) => ({ счёт: s.account.name, долг: Math.round(s.debt) })),
      находки: insights.map((i) => i.title),
    };
    const answer = await run(
      `Вот сводка моих финансов за месяц (JSON):\n${JSON.stringify(summary)}\n\nРазбери: на что уходят деньги, что выбивается из обычного, 3–5 конкретных шагов, как тратить меньше без потери качества жизни (с суммами), и что сделать с долгами. Коротко, по пунктам, без воды.`,
      { system: "Ты внимательный финансовый помощник. Пишешь по-русски, просто и конкретно, с цифрами из данных. Не придумываешь данных, которых нет. Не даёшь инвестиционных советов.", model: "smart" },
    );
    if (answer) await reviews.add({ month, text: answer, at: Date.now() });
  };

  const shown = loading ? text : text || saved?.text;
  return (
    <Card
      title="🤖 Разбор месяца"
      action={
        <Button size="sm" variant={shown ? "secondary" : "primary"} loading={loading} onClick={go}>
          {shown ? "Обновить" : "Разобрать"}
        </Button>
      }
    >
      {error && <p className="text-sm text-danger">{error}</p>}
      {shown ? (
        <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{shown}</div>
      ) : (
        <p className="text-[13.5px] text-muted">Нейронка посмотрит на сводку месяца (без самих выписок) и предложит, где сократить траты.</p>
      )}
      {saved && !loading && !text && <p className="mt-2 text-[12px] text-muted">от {shortDate(new Date(saved.at).toISOString().slice(0, 10))}</p>}
    </Card>
  );
}

function Subs() {
  const f = useFinance();
  const { recurring } = useMemo(
    () => buildInsights({ txs: f.txs, month: today().slice(0, 7), budget: f.budget, states: f.states, plans: f.plans, debts: f.debts, people: f.people, fixedCategories: [] }),
    [f.txs, f.states, f.plans, f.debts, f.people, f.budget],
  );
  const monthly = recurring.reduce((s, r) => s + r.monthly, 0);
  return (
    <div className="space-y-4">
      <section className="fin-hero p-5">
        <div className="fin-label">Регулярные списания</div>
        <div className="fin-num mt-1 text-3xl font-extrabold">{rub(Math.round(monthly))} в месяц</div>
        <div className="mt-1 text-[13.5px] text-emerald-50/80">{rub(Math.round(monthly * 12))} в год · {recurring.length} шт.</div>
      </section>
      {recurring.length === 0 ? (
        <p className="py-6 text-center text-muted">Регулярных платежей пока не видно — нужно хотя бы 2 месяца операций.</p>
      ) : (
        <Card padded={false}>
          <div className="px-1 py-1">
            {recurring.map((r) => (
              <Link key={r.key} to={`/ops?q=${encodeURIComponent(r.name)}`} className="fin-row">
                <span className="fin-icon">{f.categoryIcon(r.category)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="text-[13px] text-muted">
                    {r.period === "month" ? "каждый месяц" : r.period === "year" ? "раз в год" : "каждую неделю"} · следующее ≈ {shortDate(r.next)}
                    {r.raised && <span className="fin-down"> · подорожало на {rub(r.raised)}</span>}
                  </span>
                </span>
                <span className="text-right">
                  <span className="fin-num block font-semibold">{rub(r.amount)}</span>
                  {r.period !== "month" && <span className="text-[12px] text-muted">{rub(Math.round(r.monthly))}/мес</span>}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}
      <p className={cn("text-[13px] text-muted")}>
        Подписки ищутся по повторяющимся списаниям у одного продавца с похожей суммой. Не пользуетесь — отмените в приложении сервиса или банка.
      </p>
    </div>
  );
}
