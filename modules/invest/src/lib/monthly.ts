import { addMonths, monthName, ms, startOfMonthMs } from "./dates.ts";
import { priceAt, type Report } from "./analytics.ts";
import { isIncomeTax } from "./income.ts";
import { normCurrency, type Market, type Portfolio } from "./types.ts";

/*
 * «Итоги месяца» — короткий отчёт, ради которого хочется возвращаться (Snowball присылает похожие обзоры):
 * сколько пришло выплат, сколько внесли, как изменилась стоимость, кто вырос и упал сильнее всего.
 */

export interface MonthSummary {
  title: string;
  from: number;
  to: number;
  income: number;
  incomeCount: number;
  deposits: number;
  valueStart: number;
  valueEnd: number;
  /** Изменение стоимости без учёта пополнений. */
  marketChange: number;
  best?: { id: string; name: string; change: number };
  worst?: { id: string; name: string; change: number };
}

export function monthSummary(p: Portfolio, market: Market, r: Report, offset = -1, today = Date.now()): MonthSummary | null {
  const from = addMonths(startOfMonthMs(today), offset);
  const to = Math.min(addMonths(from, 1), today);
  const fx = (c: string) => p.fx[normCurrency(c)] ?? 1;
  const hist = r.history;
  if (hist.length < 3 || hist[0].t > from) return null;
  const at = (t: number) => hist.reduce((a, h) => (h.t <= t ? h : a), hist[0]);
  const s = at(from);
  const e = to >= today ? hist[hist.length - 1] : at(to);
  let income = 0;
  let incomeCount = 0;
  let deposits = 0;
  for (const t of r.transactions) {
    if (t.t < from || t.t >= to) continue;
    const v = (t.amount - t.fee) * fx(t.currency);
    if (t.type === "dividend" || t.type === "coupon") {
      income += v;
      incomeCount++;
    } else if (isIncomeTax(t)) income += v;
    else if (t.type === "deposit") deposits += Math.abs(v);
    else if (t.type === "withdrawal") deposits -= Math.abs(v);
  }
  const moves: { id: string; name: string; change: number }[] = [];
  for (const h of r.holdings) {
    if (h.instrument.type !== "share" && h.instrument.type !== "etf") continue;
    const pts = (market.prices[h.id] ?? []).map(([d, c]) => ({ t: ms(d), c }));
    const a = priceAt(pts, from);
    const b = to >= today ? h.price : priceAt(pts, to);
    if (a && b) moves.push({ id: h.id, name: h.instrument.name, change: b / a - 1 });
  }
  moves.sort((a, b) => b.change - a.change);
  const d = new Date(from);
  return {
    title: offset === 0 ? `${monthName(d.getMonth() + 1)} (пока)` : monthName(d.getMonth() + 1),
    from, to, income, incomeCount, deposits, valueStart: s.value, valueEnd: e.value,
    marketChange: e.value - s.value - (e.invested - s.invested),
    best: moves[0],
    worst: moves.length > 1 ? moves[moves.length - 1] : undefined,
  };
}
