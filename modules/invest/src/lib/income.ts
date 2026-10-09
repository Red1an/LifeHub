import { DAY, addDays, addYears, ms, monthOf, startOfDayMs, yearOf } from "./dates.ts";
import { shortRub, pct, signedShortRub } from "./fmt.ts";
import type { Report, TxT } from "./analytics.ts";
import { TX_TITLE, normCurrency, type PayEvent, type PaymentStatus, type Portfolio, type Settings } from "./types.ts";

/*
 * «Мой доход» простыми словами: сколько пришло на руки, сколько придёт в следующем году и почему доход меняется.
 * Все суммы — на руки (после НДФЛ): фактические — как пришли на счёт минус налог, удержанный отдельной операцией;
 * ожидаемые и прогнозные — за вычетом ставки налога из настроек.
 *
 * Прогноз на следующий год:
 *  1) объявленные дивиденды и купоны по графику — точные данные;
 *  2) для необъявленного — «как в этом году» (наивный прогноз, так делают Snowball и Sharesight);
 *  3) диапазон — реальная ошибка этого же метода в прошлые годы на бумагах портфеля (бэктест).
 */

export interface YearRow {
  year: number;
  kind: "past" | "current" | "next";
  received: number;
  expected: number;
  forecast: number;
  low: number;
  high: number;
  averageInvested: number;
}
export const yearTotal = (y: YearRow) => y.received + y.expected + y.forecast;
/** Сколько принесли каждые 100 000 ₽ вложенных — убирает эффект пополнений. */
export const per100k = (y: YearRow) => (y.averageInvested > 1000 && yearTotal(y) > 0 ? (yearTotal(y) / y.averageInvested) * 100_000 : null);

export interface BridgeStep {
  title: string;
  value: number;
  total: boolean;
  hint: string;
}

export interface Payment {
  key: string;
  t: number;
  name: string;
  instrumentId?: string;
  kind: string;
  amount: number;
  status?: PaymentStatus;
}

export interface AssetForecast {
  id: string;
  name: string;
  ticker: string;
  type: string;
  quantity: number;
  nextYear: number;
  source: string;
  /** Дивиденд на акцию по году выплаты. */
  dps: Record<number, number>;
}

export interface BacktestRow {
  year: number;
  predicted: number;
  actual: number;
}
export const backtestError = (b: BacktestRow) => (b.actual > 0 ? b.predicted / b.actual - 1 : b.predicted > 0 ? 1 : 0);

export interface MonthCell {
  year: number;
  month: number;
  amount: number;
  forecast: boolean;
}

export interface Income {
  currentYear: number;
  years: YearRow[];
  monthly: MonthCell[];
  allTime: number;
  ytd: number;
  ytdPrev: number;
  remainingThisYear: number;
  nextDeclared: number;
  nextCoupons: number;
  nextEstimated: number;
  nextGuaranteed: number;
  assets: AssetForecast[];
  backtest: BacktestRow[];
  averageError: number | null;
  bridgeFrom: number;
  bridgeTo: number;
  bridge: BridgeStep[];
  bridgeSummary: string;
  payers: { id: string; name: string; amount: number; share: number }[];
  recent: Payment[];
  soon: Payment[];
  averageMonthlyDeposit: number;
  /** Сколько на руки в год приносит 1 ₽ портфеля по прогнозу. */
  forwardYield: number;
  seasonality: number[];
  sinceVisitCount: number;
  sinceVisitAmount: number;
  /** Налог, удержанный с выплат (факт), ₽ — за всё время. */
  taxPaid: number;
}

/** Налог, удержанный именно с дивидендов и купонов (а не с продажи бумаг). */
export function isIncomeTax(t: TxT): boolean {
  if (t.type !== "tax") return false;
  const n = (t.note ?? "").toLowerCase();
  if (/дивиденд|купон|dividend|coupon/.test(n)) return true;
  if (/сдел|продаж|trade/.test(n)) return false;
  return t.instrumentId != null;
}

export function buildIncome(p: Portfolio, r: Report, settings: Settings, previousVisit: number | null, bridgeToYear?: number, today = Date.now()): Income {
  const cy = yearOf(today);
  const keep = 1 - settings.taxRate / 100;
  const fx = (c: string) => p.fx[normCurrency(c)] ?? 1;
  const startToday = startOfDayMs(today);
  const lastYearToday = addYears(today, -1);
  const name = (iid: string) => p.instruments[iid]?.name ?? iid;
  const inc: Income = {
    currentYear: cy, years: [], monthly: [], allTime: 0, ytd: 0, ytdPrev: 0, remainingThisYear: 0, nextDeclared: 0, nextCoupons: 0,
    nextEstimated: 0, nextGuaranteed: 0, assets: [], backtest: [], averageError: null, bridgeFrom: 0, bridgeTo: 0, bridge: [],
    bridgeSummary: "", payers: [], recent: [], soon: [], averageMonthlyDeposit: 0, forwardYield: 0,
    seasonality: Array(12).fill(1 / 12), sinceVisitCount: 0, sinceVisitAmount: 0, taxPaid: 0,
  };

  // 1. Фактически пришло на руки
  const received: Record<number, number> = {};
  const byInstrument: Record<string, Record<number, number>> = {};
  const incomeTx = r.transactions.filter((t) => (t.type === "dividend" || t.type === "coupon" || isIncomeTax(t)) && t.t <= today);
  const grossMonth: Record<string, MonthCell> = {};
  for (const t of incomeTx) {
    const v = (t.amount - t.fee) * fx(t.currency);
    if (t.type === "tax") inc.taxPaid += -v;
    else inc.taxPaid += t.fee * fx(t.currency);
    const y = yearOf(t.t);
    received[y] = (received[y] ?? 0) + v;
    inc.allTime += v;
    if (y === cy) inc.ytd += v;
    if (y === cy - 1 && t.t <= lastYearToday) inc.ytdPrev += v;
    if (t.instrumentId) {
      const b = (byInstrument[t.instrumentId] ??= {});
      b[y] = (b[y] ?? 0) + v;
    }
    if (previousVisit && t.t > previousVisit) {
      inc.sinceVisitAmount += v;
      if (t.type !== "tax") inc.sinceVisitCount++;
    }
    const k = `${y}-${monthOf(t.t)}-f`;
    (grossMonth[k] ??= { year: y, month: monthOf(t.t), amount: 0, forecast: false }).amount += v;
  }

  // 2. Ещё придёт до конца года
  const isIncome = (k: string) => k === "dividend" || k === "coupon";
  const rest = r.upcoming.filter((u) => isIncome(u.event.kind) && u.pay >= startToday && yearOf(u.pay) === cy);
  inc.remainingThisYear = rest.reduce((s, u) => s + u.net, 0);
  for (const u of rest) {
    const b = (byInstrument[u.instrument.id] ??= {});
    b[cy] = (b[cy] ?? 0) + u.net;
    const k = `${cy}-${monthOf(u.pay)}-t`;
    (grossMonth[k] ??= { year: cy, month: monthOf(u.pay), amount: 0, forecast: true }).amount += u.net;
  }
  // Следующий год по месяцам — для календаря
  for (const u of r.upcoming.filter((x) => isIncome(x.event.kind) && yearOf(x.pay) === cy + 1)) {
    const k = `${cy + 1}-${monthOf(u.pay)}-t`;
    (grossMonth[k] ??= { year: cy + 1, month: monthOf(u.pay), amount: 0, forecast: true }).amount += u.net;
  }
  inc.monthly = Object.values(grossMonth).sort((a, b) => a.year - b.year || a.month - b.month);

  // 3. Прогноз на следующий год по каждой бумаге
  const ny = cy + 1;
  const dpsPaid: Record<string, Record<number, number>> = {};
  for (const h of r.holdings) {
    const inst = h.instrument;
    const row: AssetForecast = { id: h.id, name: inst.name, ticker: inst.ticker, type: inst.type, quantity: h.quantity, nextYear: 0, source: "—", dps: {} };
    if (inst.type === "share" || inst.type === "etf") {
      for (const e of p.dividendHistory[h.id] ?? []) {
        if (ms(e.payDate) > today) continue;
        const y = yearOf(e.payDate);
        row.dps[y] = (row.dps[y] ?? 0) + e.perUnit * fx(e.currency);
      }
      dpsPaid[h.id] = { ...row.dps };
      const declared = p.events.filter((e) => e.instrumentId === h.id && e.kind === "dividend" && e.status === "declared" && yearOf(e.payDate) === ny);
      const declaredSum = declared.reduce((s, e) => s + e.perUnit * fx(e.currency), 0) * h.quantity;
      let base: PayEvent[] = (p.dividendHistory[h.id] ?? []).filter((e) => yearOf(e.payDate) === cy && ms(e.payDate) <= today);
      base = base.concat(r.upcoming.filter((u) => u.instrument.id === h.id && u.event.kind === "dividend" && yearOf(u.pay) === cy).map((u) => u.event));
      let shift = 1;
      if (!base.length) {
        base = (p.dividendHistory[h.id] ?? []).filter((e) => yearOf(e.payDate) === cy - 1);
        shift = 2;
      }
      let estimated = 0;
      for (const e of base) {
        const d = addYears(e.payDate, shift);
        if (yearOf(d) !== ny) continue;
        if (declared.some((x) => Math.abs(ms(x.payDate) - d) < 75 * DAY)) continue;
        estimated += e.perUnit * fx(e.currency) * h.quantity;
      }
      row.nextYear = declaredSum + estimated;
      row.source =
        declaredSum > 0 && estimated > 0 ? "Объявлено + оценка"
        : declaredSum > 0 ? "Объявлено"
        : estimated > 0 ? `Как в ${shift === 1 ? cy : cy - 1}`
        : "Нет выплат";
      inc.nextDeclared += declaredSum;
      inc.nextEstimated += estimated;
      const cyDps = base.filter((e) => yearOf(e.payDate) === cy).reduce((s, e) => s + e.perUnit * fx(e.currency), 0);
      if (cyDps > 0) row.dps[cy] = cyDps;
    } else if (inst.type === "bond") {
      const cpn = p.events.filter((e) => e.instrumentId === h.id && e.kind === "coupon" && yearOf(e.payDate) === ny).reduce((s, e) => s + e.perUnit * fx(e.currency), 0) * h.quantity;
      row.nextYear = cpn;
      row.source = cpn > 0 ? "Купоны по графику" : "—";
      inc.nextCoupons += cpn;
    }
    inc.assets.push(row);
  }
  inc.assets.sort((a, b) => b.nextYear - a.nextYear);

  // 4. Бэктест наивного прогноза DPS(Y) ≈ DPS(Y−1) на текущих бумагах — с года, когда история есть у большинства
  const firstYears = Object.values(dpsPaid).map((d) => Math.min(...Object.entries(d).filter(([, v]) => v > 0).map(([y]) => +y))).filter(Number.isFinite).sort((a, b) => a - b);
  const firstYear = firstYears.length ? firstYears[firstYears.length >> 1] : cy;
  for (let y = firstYear + 1; y <= cy - 1; y++) {
    let pred = 0;
    let act = 0;
    for (const a of inc.assets) {
      const d = dpsPaid[a.id];
      if (!d) continue;
      pred += (d[y - 1] ?? 0) * a.quantity;
      act += (d[y] ?? 0) * a.quantity;
    }
    if (act > 0 || pred > 0) inc.backtest.push({ year: y, predicted: pred, actual: act });
  }
  inc.averageError = inc.backtest.length ? inc.backtest.reduce((s, b) => s + Math.abs(backtestError(b)), 0) / inc.backtest.length : null;

  // 5. Годы
  const inv: Record<number, [number, number]> = {};
  for (const h of r.history) {
    const y = yearOf(h.t);
    const s = (inv[y] ??= [0, 0]);
    s[0] += h.invested;
    s[1]++;
  }
  const avgInvested = (y: number) => (inv[y] ? inv[y][0] / Math.max(inv[y][1], 1) : 0);
  const positiveYears = Object.entries(received).filter(([, v]) => v > 0).map(([y]) => +y);
  const startYear = Math.min(positiveYears.length ? Math.min(...positiveYears) : cy, cy);
  for (let y = startYear; y <= cy; y++) {
    inc.years.push({
      year: y, kind: y === cy ? "current" : "past", received: received[y] ?? 0, expected: y === cy ? inc.remainingThisYear : 0,
      forecast: 0, low: 0, high: 0, averageInvested: avgInvested(y),
    });
  }
  const total = inc.nextDeclared + inc.nextCoupons + inc.nextEstimated;
  const err = inc.averageError ?? 0.25;
  inc.years.push({
    year: ny, kind: "next", received: 0, expected: 0, forecast: total * keep,
    low: (total - inc.nextEstimated * err) * keep, high: (total + inc.nextEstimated * err) * keep, averageInvested: r.invested,
  });
  inc.nextDeclared *= keep;
  inc.nextCoupons *= keep;
  inc.nextEstimated *= keep;
  inc.nextGuaranteed = inc.nextDeclared + inc.nextCoupons;

  // 6. Сезонность выплат и доходность нового рубля
  const months = Array(12).fill(0);
  for (const c of inc.monthly) if (!c.forecast && (c.year === cy || c.year === cy - 1)) months[c.month - 1] += c.amount;
  for (const c of inc.monthly) if (c.forecast && c.year === cy) months[c.month - 1] += c.amount;
  const msum = months.reduce((s, x) => s + x, 0);
  if (msum > 0) inc.seasonality = months.map((x) => x / msum);
  inc.forwardYield = r.totalValue > 0 ? (total * keep) / r.totalValue : 0;
  const yearAgo = addDays(today, -365);
  const netDeposits = r.transactions
    .filter((t) => t.t > yearAgo)
    .reduce((s, t) => s + (t.type === "deposit" ? Math.abs(t.amount) : t.type === "withdrawal" ? -Math.abs(t.amount) : 0) * fx(t.currency), 0);
  inc.averageMonthlyDeposit = Math.max(0, netDeposits / 12);

  // 7. Почему изменился доход
  const bridgeYears = inc.years.filter((y) => y.kind !== "next" && inc.years.some((z) => z.year === y.year - 1)).map((y) => y.year);
  const to = bridgeToYear && bridgeYears.includes(bridgeToYear) ? bridgeToYear : bridgeYears[bridgeYears.length - 1];
  if (to) {
    inc.bridgeFrom = to - 1;
    inc.bridgeTo = to;
    const res = bridge(to - 1, to, inc, byInstrument, p, r, today);
    inc.bridge = res.steps;
    inc.bridgeSummary = res.text;
  }

  // 8. Кто платит больше всего в этом году
  const thisYear = Object.entries(byInstrument).map(([id, v]) => ({ id, amount: v[cy] ?? 0 })).filter((x) => x.amount > 0);
  const totalCY = thisYear.reduce((s, x) => s + x.amount, 0);
  inc.payers = thisYear.sort((a, b) => b.amount - a.amount).map((x) => ({ id: x.id, name: name(x.id), amount: x.amount, share: totalCY > 0 ? x.amount / totalCY : 0 }));

  // 9. Последние поступления (с налогом, удержанным отдельно) и ближайшие выплаты
  const taxes = incomeTx.filter(isIncomeTax);
  const merged: Record<string, Payment> = {};
  for (const t of incomeTx) {
    if (t.type === "tax") continue;
    const linked = taxes.filter((x) => x.instrumentId === t.instrumentId && x.accountId === t.accountId && Math.abs(x.t - t.t) < 3 * DAY);
    const v = (t.amount - t.fee) * fx(t.currency) + linked.reduce((s, x) => s + (x.amount - x.fee) * fx(x.currency), 0);
    const key = `${t.instrumentId ?? "-"}|${t.date.slice(0, 10)}|${t.type}`;
    (merged[key] ??= { key, t: t.t, name: name(t.instrumentId ?? "—"), instrumentId: t.instrumentId, kind: TX_TITLE[t.type], amount: 0 }).amount += v;
  }
  inc.recent = Object.values(merged).sort((a, b) => b.t - a.t);
  inc.soon = r.upcoming
    .filter((u) => isIncome(u.event.kind) && u.pay >= startToday)
    .map((u) => ({ key: u.id, t: u.pay, name: u.instrument.name, instrumentId: u.instrument.id, kind: u.event.kind === "dividend" ? "Дивиденды" : "Купон", amount: u.net, status: u.event.status }));
  return inc;
}

function bridge(y0: number, y1: number, inc: Income, byInstrument: Record<string, Record<number, number>>, p: Portfolio, r: Report, today: number) {
  const cy = yearOf(today);
  const startToday = startOfDayMs(today);
  const fx = (c: string) => p.fx[normCurrency(c)] ?? 1;
  const dps = (iid: string, y: number) => {
    let s = (p.dividendHistory[iid] ?? []).filter((e) => yearOf(e.payDate) === y && ms(e.payDate) <= today).reduce((a, e) => a + e.perUnit * fx(e.currency), 0);
    if (y === cy) {
      s += r.upcoming.filter((u) => u.instrument.id === iid && u.event.kind === "dividend" && u.pay >= startToday && yearOf(u.pay) === cy).reduce((a, u) => a + u.event.perUnit * fx(u.event.currency), 0);
    }
    return s;
  };
  const held = new Set(r.holdings.map((h) => h.id));
  let buys = 0;
  let sells = 0;
  let rate = 0;
  let coupons = 0;
  for (const [iid, ys] of Object.entries(byInstrument)) {
    const i0 = ys[y0] ?? 0;
    const i1 = ys[y1] ?? 0;
    if (!i0 && !i1) continue;
    if (p.instruments[iid]?.type === "bond") {
      coupons += i1 - i0;
      continue;
    }
    const d0 = dps(iid, y0);
    const d1 = dps(iid, y1);
    let volume = i1 - i0;
    if (i0 > 0 && i1 > 0 && d0 > 0 && d1 > 0) {
      const ratio = d1 / d0;
      rate += i0 * (ratio - 1);
      volume = i1 - i0 * ratio;
    } else if (i0 > 0 && i1 <= 0 && held.has(iid) && d1 === 0) {
      rate -= i0; // бумага осталась, а компания в этом году не заплатила
      volume = 0;
    }
    if (volume >= 0) buys += volume;
    else sells += volume;
  }
  const row = (y: number) => inc.years.find((x) => x.year === y);
  const t0 = row(y0) ? yearTotal(row(y0)!) : 0;
  const t1 = row(y1) ? yearTotal(row(y1)!) : 0;
  const other = t1 - t0 - (buys + sells + rate + coupons);
  const steps: BridgeStep[] = [{ title: String(y0), value: t0, total: true, hint: `Получено на руки за ${y0}` }];
  const threshold = Math.max(1000, t0 * 0.01);
  const add = (title: string, v: number, hint: string) => {
    if (Math.abs(v) >= threshold) steps.push({ title, value: v, total: false, hint });
  };
  add("Докупили бумаги", buys, "Вы купили новые бумаги или докупили старые — выплат стало больше. Это эффект ваших пополнений.");
  add(rate >= 0 ? "Компании повысили выплаты" : "Компании снизили выплаты", rate, "Как изменился дивиденд на одну акцию у бумаг, которые были у вас в оба года. Это «заслуга» самих компаний, а не ваших покупок.");
  add("Продали бумаги", sells, "По проданным бумагам выплаты прекратились или уменьшились.");
  add("Купоны облигаций", coupons, "Изменение купонов: покупки, продажи и погашения облигаций.");
  add("Прочее", other, "Выплаты без привязки к бумаге, налоговые корректировки и неточности данных.");
  steps.push({ title: y1 === cy ? `${y1} ожид.` : String(y1), value: t1, total: true, hint: y1 === cy ? "Получено + ожидается до 31 декабря, на руки" : `Получено на руки за ${y1}` });

  const diff = t1 - t0;
  let text = `${y1 === cy ? `В ${y1} году ожидается` : `В ${y1} году пришло`} ${shortRub(t1)} — `;
  text += t0 > 0 ? `${diff >= 0 ? "на " + shortRub(diff) + " больше" : "на " + shortRub(-diff) + " меньше"}, чем в ${y0} (${pct(diff / t0, { signed: true })}).` : `в ${y0} выплат почти не было.`;
  const deltas = steps.filter((s) => !s.total);
  const main = deltas.reduce<BridgeStep | null>((m, s) => (!m || Math.abs(s.value) > Math.abs(m.value) ? s : m), null);
  if (main) text += ` Главная причина — ${main.title.toLowerCase()} (${signedShortRub(main.value)}).`;
  if (Math.abs(rate) >= threshold && main && !main.title.startsWith("Компании")) {
    text += rate < 0 ? ` Сами компании заплатили на акцию меньше, чем годом раньше (${signedShortRub(rate)}).` : ` Сами компании тоже повысили выплаты на акцию (${signedShortRub(rate)}).`;
  }
  if (buys >= threshold && t0 > 0) text += ` Без новых покупок доход был бы ${shortRub(t1 - buys)} (${pct((t1 - buys) / t0 - 1, { signed: true })} к ${y0}).`;
  return { steps, text };
}

/** Сколько можно получить в следующем году, если пополнять monthly ₽ в месяц и реинвестировать выплаты. */
export function scenario(inc: Income, monthly: number, reinvest: boolean, today = Date.now()) {
  const next = inc.years.find((y) => y.kind === "next");
  const base = next?.forecast ?? 0;
  const month = monthOf(today);
  const after = (k: number) => (k >= 12 ? 0 : inc.seasonality.slice(k).reduce((s, x) => s + x, 0));
  const monthsLeft = 12 - month;
  let inside = 0;
  for (let k = 1; k <= 12; k++) inside += after(k);
  const fromDeposits = Math.max(0, monthly) * inc.forwardYield * (monthsLeft + inside);
  let fromReinvest = 0;
  if (reinvest) {
    fromReinvest += inc.remainingThisYear * inc.forwardYield;
    for (let m = 1; m <= 12; m++) fromReinvest += base * inc.seasonality[m - 1] * inc.forwardYield * after(m);
  }
  return { base, fromDeposits, fromReinvest, total: base + fromDeposits + fromReinvest };
}

/* ── цель по пассивному доходу ── */

export interface GoalPlan {
  points: { month: number; t: number; capital: number; income: number }[];
  reachedMonth: number | null;
  yieldPct: number;
  neededCapital: number;
}

export function goalYield(s: Settings, r: Report): number {
  if (s.goalYieldOverride != null) return s.goalYieldOverride;
  const y = r.securitiesValue > 0 ? r.forwardIncome / r.securitiesValue : 0;
  return y > 0 ? y * 100 : 9;
}

export function goalPlan(s: Settings, r: Report, today = Date.now()): GoalPlan {
  const y = goalYield(s, r);
  const tax = s.taxRate / 100;
  const plan: GoalPlan = { points: [], reachedMonth: null, yieldPct: y, neededCapital: y > 0 ? (s.goalMonthlyIncome * 12) / ((y / 100) * (1 - tax)) : 0 };
  let capital = r.totalValue;
  const growth = s.goalCapitalGrowth / 100 / 12;
  const yieldM = y / 100 / 12;
  const infl = s.goalInflation / 100;
  let contribution = s.goalMonthlyContribution;
  for (let m = 0; m <= 40 * 12; m++) {
    const deflator = (1 + infl) ** (m / 12);
    const income = capital * yieldM * (1 - tax);
    if (m % 3 === 0) plan.points.push({ month: m, t: addDays(today, m * 30.44), capital: capital / deflator, income: income / deflator });
    if (plan.reachedMonth == null && income / deflator >= s.goalMonthlyIncome) plan.reachedMonth = m;
    if (plan.reachedMonth != null && m > plan.reachedMonth + 36) break;
    capital *= 1 + growth;
    if (s.goalReinvest) capital += income;
    capital += contribution;
    if (m % 12 === 11) contribution *= 1 + infl;
  }
  return plan;
}
