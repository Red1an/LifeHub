import { merchantKey } from "./categorize.ts";
import { addDaysKey, daysBetween, daysInMonth, shiftMonth, today } from "./dates.ts";
import { earned, spent, type Category, type TxDoc } from "./types.ts";

/*
 * Аналитика: месяц, категории, продавцы, прогноз, «можно тратить в день», подписки.
 * Траты считаются по моей доле (share) и без исключённых — см. spent() в types.ts.
 */

export interface MonthStats {
  month: string;
  spent: number;
  income: number;
  byCategory: { name: string; value: number; count: number }[];
  byMerchant: { name: string; value: number; count: number; category: string }[];
  byDay: Record<string, number>;
  count: number;
}

export const isExpense = (t: TxDoc) => t.kind === "expense" && !t.excluded;

export function monthStats(txs: TxDoc[], month: string): MonthStats {
  const list = txs.filter((t) => t.date.startsWith(month));
  const cat = new Map<string, { value: number; count: number }>();
  const mer = new Map<string, { name: string; value: number; count: number; category: string }>();
  const byDay: Record<string, number> = {};
  let s = 0;
  let inc = 0;
  for (const t of list) {
    inc += earned(t);
    const v = spent(t);
    if (!v) continue;
    s += v;
    byDay[t.date] = (byDay[t.date] ?? 0) + v;
    const c = cat.get(t.category) ?? { value: 0, count: 0 };
    c.value += v;
    c.count++;
    cat.set(t.category, c);
    const name = t.merchant || t.note || t.category;
    const k = merchantKey(name) || name;
    const m = mer.get(k) ?? { name, value: 0, count: 0, category: t.category };
    m.value += v;
    m.count++;
    mer.set(k, m);
  }
  return {
    month,
    spent: s,
    income: inc,
    byCategory: [...cat.entries()].map(([name, x]) => ({ name, ...x })).filter((x) => Math.abs(x.value) > 0.5).sort((a, b) => b.value - a.value),
    byMerchant: [...mer.values()].sort((a, b) => b.value - a.value),
    byDay,
    count: list.length,
  };
}

/** Средние траты по категориям за n полных месяцев до month. */
export function categoryAverages(txs: TxDoc[], month: string, n = 3): Map<string, number> {
  const out = new Map<string, number>();
  const months = Array.from({ length: n }, (_, i) => shiftMonth(month, -(i + 1)));
  const has = months.filter((m) => txs.some((t) => t.date.startsWith(m)));
  if (!has.length) return out;
  for (const m of has) for (const c of monthStats(txs, m).byCategory) out.set(c.name, (out.get(c.name) ?? 0) + c.value / has.length);
  return out;
}

export interface Pace {
  /** Прошло дней месяца (с сегодняшним). */
  day: number;
  days: number;
  /** Прогноз трат на конец месяца. */
  forecast: number;
  /** Столько же дней прошлого месяца — сколько было потрачено. */
  lastMonthSameDay: number;
  lastMonth: number;
  /** Можно тратить в день до конца месяца, чтобы уложиться в бюджет. */
  perDay: number | null;
  /** Бюджет: заданный или средний за 3 месяца. */
  budget: number;
  budgetIsAuto: boolean;
}

export function pace(txs: TxDoc[], month: string, budgetSet: number): Pace {
  const t = today();
  const days = daysInMonth(month);
  const current = t.startsWith(month);
  const day = current ? Number(t.slice(8, 10)) : days;
  const ms = monthStats(txs, month);
  // Прогноз без крупных разовых трат: они не повторятся каждый день.
  const daily = Object.values(ms.byDay).sort((a, b) => a - b);
  const big = daily.length >= 5 ? daily[Math.floor(daily.length * 0.9)] * 2 : Infinity;
  const regular = Object.values(ms.byDay).reduce((s, v) => s + Math.min(v, big), 0);
  const forecast = current ? ms.spent + (regular / day) * (days - day) : ms.spent;
  const prev = shiftMonth(month, -1);
  const prevStats = monthStats(txs, prev);
  const lastMonthSameDay = Object.entries(prevStats.byDay).filter(([d]) => Number(d.slice(8, 10)) <= day).reduce((s, [, v]) => s + v, 0);
  let budget = budgetSet;
  let budgetIsAuto = false;
  if (!budget) {
    const months = [1, 2, 3].map((i) => monthStats(txs, shiftMonth(month, -i)).spent).filter((v) => v > 0);
    if (months.length) {
      budget = Math.round(months.reduce((s, v) => s + v, 0) / months.length / 1000) * 1000;
      budgetIsAuto = true;
    }
  }
  const left = days - day + 1;
  return {
    day, days, forecast, lastMonthSameDay, lastMonth: prevStats.spent, budget, budgetIsAuto,
    perDay: budget && current ? Math.max(0, (budget - ms.spent + (ms.byDay[t] ?? 0)) / left) : null,
  };
}

/* ───────────── подписки и регулярные платежи ───────────── */

export interface Recurring {
  key: string;
  name: string;
  category: string;
  /** Обычная сумма. */
  amount: number;
  period: "month" | "year" | "week";
  /** В пересчёте на месяц. */
  monthly: number;
  last: string;
  next: string;
  count: number;
  /** Цена выросла по сравнению с прошлым разом. */
  raised?: number;
}

export function findRecurring(txs: TxDoc[]): Recurring[] {
  const groups = new Map<string, TxDoc[]>();
  const since = addDaysKey(today(), -400);
  for (const t of txs) {
    if (!isExpense(t) || t.amount <= 0 || t.date < since) continue;
    const k = merchantKey(t.merchant || t.note || "");
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: Recurring[] = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const last = list[list.length - 1];
    // Похожие суммы (±20 % от последней) — та же подписка; разные — обычные покупки в одном месте.
    const same = list.filter((x) => Math.abs(x.amount - last.amount) <= last.amount * 0.2 + 1);
    if (same.length < 2) continue;
    const gaps = same.slice(1).map((x, i) => daysBetween(same[i].date, x.date));
    const med = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    let period: Recurring["period"] | null = null;
    if (med >= 26 && med <= 35) period = "month";
    else if (med >= 350 && med <= 380) period = "year";
    else if (med >= 6 && med <= 8 && same.length >= 4) period = "week";
    if (!period) continue;
    // Регулярность: большинство промежутков около медианы.
    const okGaps = gaps.filter((g) => Math.abs(g - med) <= (period === "year" ? 20 : period === "week" ? 2 : 6)).length;
    if (okGaps < Math.ceil(gaps.length * 0.6)) continue;
    const step = period === "month" ? 30 : period === "year" ? 365 : 7;
    const next = addDaysKey(last.date, med);
    // Давно не было списаний — подписку отменили.
    if (daysBetween(last.date, today()) > step * 1.6) continue;
    const prev = same[same.length - 2];
    out.push({
      key: k,
      name: last.merchant || last.note || last.category,
      category: last.category,
      amount: last.amount,
      period,
      monthly: period === "month" ? last.amount : period === "year" ? last.amount / 12 : (last.amount * 52) / 12,
      last: last.date,
      next,
      count: same.length,
      raised: last.amount > prev.amount * 1.05 ? last.amount - prev.amount : undefined,
    });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/** Траты по месяцам: последние n месяцев до month включительно. */
export function monthsTrend(txs: TxDoc[], month: string, n = 6) {
  return Array.from({ length: n }, (_, i) => shiftMonth(month, i - n + 1)).map((m) => {
    const s = monthStats(txs, m);
    return { month: m, spent: s.spent, income: s.income };
  });
}

export function categoryIcon(cats: Category[], name: string, kind: "expense" | "income" = "expense") {
  return cats.find((c) => c.name === name && c.kind === kind)?.icon ?? cats.find((c) => c.name === name)?.icon ?? (kind === "income" ? "💰" : "💸");
}
