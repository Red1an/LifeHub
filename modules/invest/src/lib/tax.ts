import { addDays, addYears, fmtDate, yearOf } from "./dates.ts";
import { shortRub } from "./fmt.ts";
import { profitOf, type Report } from "./analytics.ts";
import { isIncomeTax } from "./income.ts";
import type { Mistakes } from "./mistakes.ts";
import { normCurrency, type Portfolio, type Settings } from "./types.ts";

/*
 * Налоги текущего года — как налоговые отчёты в Sharesight/Intelinvest, но простыми словами:
 * сколько налога набежало с продаж, сколько уже удержали с выплат, что можно сделать до 31 декабря.
 * Брокер считает и удерживает налог сам; это оценка, чтобы не было сюрпризов и чтобы платить меньше законно.
 */

export interface TaxYear {
  year: number;
  /** Прибыль от продаж, которая облагается (владение меньше 3 лет, не ИИС). */
  gains: number;
  /** Убытки от продаж в этом году (уменьшают налог). */
  losses: number;
  taxSales: number;
  /** Налог с дивидендов и купонов, уже удержанный. */
  taxIncome: number;
  /** Сколько налога можно сэкономить, продав убыточные бумаги до конца года. */
  harvest: { id: string; name: string; loss: number; saved: number }[];
  harvestSaved: number;
  /** Пополнения ИИС в этом году и вычет, который можно получить (13 %, не больше 52 000 ₽). */
  iisDeposits: number;
  iisDeduction: number;
  hasIis: boolean;
  ldvSoon: { id: string; name: string; date: number; tax: number }[];
}

export function buildTax(p: Portfolio, r: Report, m: Mistakes, s: Settings, today = Date.now()): TaxYear {
  const year = yearOf(today);
  const rate = s.taxRate / 100;
  const iis = new Set(p.accounts.filter((a) => a.kind === "iis").map((a) => a.id));
  const fx = (c: string) => p.fx[normCurrency(c)] ?? 1;
  const sales = m.sells.filter((x) => yearOf(x.t) === year && !x.iis);
  const gains = sales.filter((x) => x.taxPaid > 0).reduce((a, x) => a + x.realized, 0);
  const losses = -sales.filter((x) => x.realized < 0).reduce((a, x) => a + x.realized, 0);
  const net = Math.max(0, gains - losses);
  let taxIncome = 0;
  for (const t of r.transactions) {
    if (yearOf(t.t) !== year) continue;
    if ((t.type === "dividend" || t.type === "coupon") && t.fee > 0) taxIncome += t.fee * fx(t.currency);
    if (isIncomeTax(t)) taxIncome += -(t.amount - t.fee) * fx(t.currency);
  }
  // Кандидаты на продажу с убытком (только вне ИИС): уменьшают налог с прибыльных продаж
  let left = net;
  const harvest: TaxYear["harvest"] = [];
  for (const h of [...r.holdings].sort((a, b) => profitOf(a) - profitOf(b))) {
    const pr = profitOf(h);
    if (pr >= -1000 || left <= 0) continue;
    const outsideShare = Object.entries(h.byAccount).filter(([a]) => !iis.has(a)).reduce((a, [, v]) => a + v, 0) / (h.value || 1);
    const loss = -pr * outsideShare;
    if (loss < 1000) continue;
    const used = Math.min(loss, left);
    left -= used;
    harvest.push({ id: h.id, name: h.instrument.name, loss, saved: used * rate });
  }
  const iisDeposits = r.transactions.filter((t) => t.type === "deposit" && iis.has(t.accountId) && yearOf(t.t) === year).reduce((a, t) => a + Math.abs(t.amount) * fx(t.currency), 0);
  const ldvSoon = r.holdings
    .filter((h) => h.firstBuy && profitOf(h) > 5000 && addYears(h.firstBuy, 3) > today && addYears(h.firstBuy, 3) < addDays(today, 365))
    .map((h) => ({ id: h.id, name: h.instrument.name, date: addYears(h.firstBuy!, 3), tax: profitOf(h) * rate }))
    .sort((a, b) => a.date - b.date);
  return {
    year, gains, losses, taxSales: net * rate, taxIncome, harvest, harvestSaved: harvest.reduce((a, x) => a + x.saved, 0),
    iisDeposits, iisDeduction: Math.min(iisDeposits, 400_000) * 0.13, hasIis: iis.size > 0, ldvSoon,
  };
}

export const ldvText = (x: { name: string; date: number; tax: number }) => `${x.name}: с ${fmtDate(x.date, { year: "always" })}, налог сейчас ≈ ${shortRub(x.tax)}`;
