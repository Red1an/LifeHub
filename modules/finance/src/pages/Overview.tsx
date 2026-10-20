import { useMemo } from "react";
import { Button, EmptyState, Link, Loading, cn, monthKey, plural, useNavigate } from "@lifehub/sdk";
import { categoryAverages, monthStats, pace } from "../lib/analytics.ts";
import { upcomingPayments } from "../lib/accounts.ts";
import { dayTitle, monthTitle, shortDate } from "../lib/dates.ts";
import { buildInsights, totalSaving } from "../lib/insights.ts";
import { rub, short } from "../lib/money.ts";
import { useFinance } from "../lib/store.tsx";
import { isDebtAccount } from "../lib/types.ts";
import { BankMark, Bar, Card, InsightCard, MoreLink, TxRow } from "../components/ui.tsx";
import { newExpense, useTxSheet } from "../components/TxSheet.tsx";
import { TidySuggestions } from "../components/TidySuggestions.tsx";
import { PayWithCard } from "../components/Cashback.tsx";

export function Overview() {
  const f = useFinance();
  const sheet = useTxSheet();
  const nav = useNavigate();
  const month = monthKey();

  const ms = useMemo(() => monthStats(f.txs, month), [f.txs, month]);
  const p = useMemo(() => pace(f.txs, month, f.budget), [f.txs, month, f.budget]);
  const avg = useMemo(() => categoryAverages(f.txs, month), [f.txs, month]);
  const { insights } = useMemo(
    () =>
      buildInsights({
        txs: f.txs, month, budget: f.budget, states: f.states, plans: f.plans, debts: f.debts, people: f.people,
        fixedCategories: f.categories.filter((c) => c.fixed).map((c) => c.name),
      }),
    [f.txs, f.states, f.plans, f.debts, f.people, f.budget, f.categories],
  );
  const upcoming = useMemo(() => upcomingPayments(f.states, f.plans, 14), [f.states, f.plans]);
  const review = f.txs.filter((t) => t.review).length;
  const owed = f.debts.filter((d) => d.dir === "owed" && d.amount - d.paid > 0.5);
  const owedSum = owed.reduce((s, d) => s + d.amount - d.paid, 0);
  const recent = [...f.txs].sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? "").localeCompare(a.time ?? "") || b.createdAt - a.createdAt).slice(0, 6);
  const top = insights.filter((i) => i.priority <= 1 && !f.prefs.hidden.includes(i.id)).slice(0, 3);
  const savings = totalSaving(insights.filter((i) => !f.prefs.hidden.includes(i.id)));

  if (f.loading) return <Loading />;

  if (!f.txs.length && !f.accounts.length) return <Welcome />;

  const ratio = p.budget ? ms.spent / p.budget : 0;
  const dayMark = (p.day / p.days) * 100;
  const vsLast = p.lastMonthSameDay ? ms.spent - p.lastMonthSameDay : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 sm:px-6 sm:pt-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <div className="fin-label">{monthTitle(month)}</div>
          <h1 className="text-2xl font-bold tracking-tight">Финансы</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => sheet.open(newExpense())}>
            + Трата
          </Button>
        </div>
      </div>

      <section className="fin-hero relative mb-4 overflow-hidden p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="fin-label">Потрачено в {monthIn(month)}</div>
            <div className="fin-num mt-1 text-[38px] font-extrabold leading-none tracking-tight">{rub(ms.spent)}</div>
            {vsLast !== null && (
              <div className="mt-2 text-[13.5px] text-emerald-50/80">
                {vsLast > 0 ? "▲" : "▼"} {rub(Math.abs(vsLast))} {vsLast > 0 ? "больше" : "меньше"}, чем к {p.day}-му числу прошлого месяца
              </div>
            )}
          </div>
          {p.perDay !== null && (
            <div className="shrink-0 rounded-2xl bg-white/12 px-3 py-2 text-right backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-50/75">Можно сегодня</div>
              <div className="fin-num text-xl font-bold">{rub(Math.round(p.perDay / 10) * 10)}</div>
            </div>
          )}
        </div>
        {p.budget > 0 && (
          <div className="mt-5">
            <div className="relative">
              <div className="fin-hero-track">
                <div className={cn("fin-hero-bar", ratio > 1 && "over")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
              </div>
              <div className="fin-hero-mark" style={{ left: `${dayMark}%` }} title="Сегодня" />
            </div>
            <div className="mt-2 flex justify-between text-[13px] text-emerald-50/80">
              <span>
                {p.budgetIsAuto ? "Обычно в месяц" : "Бюджет"} {short(p.budget)}
              </span>
              <span>прогноз {short(Math.round(p.forecast / 100) * 100)}</span>
            </div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 text-[13px]">
          <div className="rounded-2xl bg-white/10 px-3 py-2">
            <div className="text-emerald-50/70">Доходы</div>
            <div className="fin-num text-base font-semibold">{rub(ms.income)}</div>
          </div>
          <div className="rounded-2xl bg-white/10 px-3 py-2">
            <div className="text-emerald-50/70">Остаётся</div>
            <div className="fin-num text-base font-semibold">{rub(ms.income - ms.spent)}</div>
          </div>
        </div>
      </section>

      <div className="mb-4 space-y-2">
        <TidySuggestions />
        {review > 0 && (
          <Link to="/ops?review=1" className="flex items-center gap-3 rounded-[18px] bg-[var(--fin-amber-soft)] p-3.5">
            <span className="text-2xl">🏷️</span>
            <span className="flex-1">
              <span className="block font-semibold">
                {review} {plural(review, ["операция", "операции", "операций"])} без точной категории
              </span>
              <span className="text-[13.5px] text-muted">Разберите за минуту — модуль запомнит продавцов</span>
            </span>
            <span className="text-muted">›</span>
          </Link>
        )}
        {top.map((i) => (
          <InsightCard key={i.id} i={i} onHide={() => f.setPrefs({ ...f.prefs, hidden: [...f.prefs.hidden, i.id] })} />
        ))}
        {savings >= 500 && (
          <Link to="/analytics?tab=save" className="flex items-center gap-3 rounded-[18px] bg-[var(--fin-green-soft)] p-3.5">
            <span className="text-2xl">💡</span>
            <span className="flex-1">
              <span className="block font-semibold">Можно экономить ≈ {rub(Math.round(savings / 500) * 500)} в месяц</span>
              <span className="text-[13.5px] text-muted">Подписки, доставка, такси и другие находки</span>
            </span>
            <span className="text-muted">›</span>
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {ms.byCategory.length > 0 && (
          <Card title="Куда уходят деньги" action={<MoreLink to="/analytics" />} className="sm:col-span-2">
            <div className="space-y-3">
              {ms.byCategory.slice(0, 5).map((c, i) => {
                const base = avg.get(c.name);
                const cat = f.categories.find((x) => x.name === c.name && x.kind === "expense");
                const lim = cat?.limit;
                // Обязательные траты (аренда) списываются разом — их не растягиваем на месяц.
                const proj = cat?.fixed ? c.value : c.value * (p.days / p.day);
                return (
                  <Link key={c.name} to={`/ops?cat=${encodeURIComponent(c.name)}`} className="block">
                    <div className="mb-1 flex items-center gap-2 text-[14.5px]">
                      <span>{f.categoryIcon(c.name)}</span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {base !== undefined && base > 0 && p.day >= 7 && (
                        <span className={cn("text-[12px]", proj > base * 1.15 ? "fin-down" : "text-muted")}>
                          обычно {short(base)}
                        </span>
                      )}
                      <span className="fin-num font-semibold">{rub(c.value)}</span>
                    </div>
                    <Bar value={c.value} max={lim ?? ms.byCategory[0].value} color={lim && c.value > lim ? "var(--fin-red)" : ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#06b6d4"][i]} />
                  </Link>
                );
              })}
            </div>
          </Card>
        )}

        <PayWithCard />

        {upcoming.length > 0 && (
          <Card title="Скоро платить" action={<MoreLink to="/accounts" />}>
            <div className="space-y-2.5">
              {upcoming.slice(0, 4).map((u) => (
                <div key={u.id} className="flex items-center gap-3">
                  <span className={cn("fin-icon size-10 text-base", u.days <= 2 && "bg-[var(--fin-amber-soft)]")}>{u.kind === "split" ? "🧩" : u.kind === "grace" ? "⏳" : "💳"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium">{u.title}</span>
                    <span className="text-[13px] text-muted">{u.days === 0 ? "сегодня" : u.days === 1 ? "завтра" : u.days < 0 ? "просрочено" : shortDate(u.date)}</span>
                  </span>
                  <span className="fin-num font-semibold">{rub(u.amount)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {owed.length > 0 && (
          <Card title="Вам должны" action={<MoreLink to="/shared" />}>
            <div className="fin-num text-2xl font-bold">{rub(owedSum)}</div>
            <div className="mt-1 text-[13.5px] text-muted">
              {[...new Set(owed.map((d) => (d.person ? f.personName(d.person) : "без имени")))].slice(0, 4).join(", ")}
            </div>
          </Card>
        )}

        {f.states.some((s) => !s.account.archived) && (
          <Card title="Счета" action={<MoreLink to="/accounts" />} className={cn(owed.length === 0 && upcoming.length === 0 && "sm:col-span-2")}>
            <div className="space-y-2">
              {f.states
                .filter((s) => !s.account.archived)
                .slice(0, 5)
                .map((s) => (
                  <Link key={s.account.id} to={`/account/${s.account.id}`} className="flex items-center gap-3">
                    <BankMark account={s.account} size={32} />
                    <span className="min-w-0 flex-1 truncate text-[14.5px]">{s.account.name}</span>
                    <span className={cn("fin-num font-semibold", isDebtAccount(s.account) && s.debt > 0 && "fin-down")}>
                      {isDebtAccount(s.account) ? (s.debt > 0 ? "−" + rub(s.debt) : "0 ₽") : s.balance === null ? "—" : rub(s.balance)}
                    </span>
                  </Link>
                ))}
            </div>
          </Card>
        )}
      </div>

      <Card title="Последние операции" action={<MoreLink to="/ops" />} className="mt-4" padded={false}>
        <div className="px-1 pb-2">
          {recent.map((t, i) => (
            <div key={t.id}>
              {(i === 0 || recent[i - 1].date !== t.date) && <div className="fin-label px-3 pb-1 pt-2">{dayTitle(t.date)}</div>}
              <TxRow tx={t} onClick={() => sheet.open(t)} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** «в октябре», «в мае», «в марте». */
const monthIn = (month: string) => monthTitle(month, false).toLowerCase().replace(/[ьй]$/, "е").replace(/т$/, "те");

function Welcome() {
  const nav = useNavigate();
  const sheet = useTxSheet();
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-8">
      <section className="fin-hero mb-5 p-6">
        <div className="text-4xl">💰</div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Все деньги в одном месте</h1>
        <p className="mt-2 text-[15px] text-emerald-50/85">
          Карты Сбера, Яндекса, Озона, кредитки и сплиты. Операции приходят сами из уведомлений банков и выписок — модуль раскладывает их по
          категориям, подсказывает, где сэкономить, и следит, кто не скинул за общий счёт.
        </p>
      </section>
      <div className="space-y-2">
        <StepLink n={1} title="Добавьте счета" text="Карты, кредитки, Сплит — с последними цифрами карт" onClick={() => nav("/accounts?add=1")} />
        <StepLink n={2} title="Подключите уведомления банков" text="Телефон будет пересылать пуши — операции появятся сами" onClick={() => nav("/import?tab=push")} />
        <StepLink n={3} title="Загрузите выписки" text="PDF из Сбера, Яндекса, Озона, CSV из Т-Банка — за прошлые месяцы" onClick={() => nav("/import?tab=file")} />
      </div>
      <EmptyState className="mt-6" icon="✍️" title="Или просто запишите трату" action={<Button onClick={() => sheet.open(newExpense())}>+ Трата</Button>} />
    </div>
  );
}

function StepLink({ n, title, text, onClick }: { n: number; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="fin-card flex w-full items-center gap-3 p-4 text-left transition hover:border-accent">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent">{n}</span>
      <span className="flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="text-[13.5px] text-muted">{text}</span>
      </span>
      <span className="text-muted">›</span>
    </button>
  );
}
