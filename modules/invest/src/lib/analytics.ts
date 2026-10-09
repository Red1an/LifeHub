import { DAY, addDays, addYears, ms, startOfDayMs, yearsBetween } from "./dates.ts";
import { ASSET_TITLE, BROKER_TITLE, normCurrency, type Account, type Instrument, type Market, type PayEvent, type Portfolio, type PricePoint, type Settings, type Snapshot, type Tx } from "./types.ts";

/*
 * Главный расчёт: позиции по средней цене, стоимость, прибыль, доходность в год (XIRR),
 * прогноз выплат на 2 года, история стоимости по неделям и рост «самих бумаг» (TWR).
 */

export type TxT = Tx & { t: number };

export interface Holding {
  id: string;
  instrument: Instrument;
  quantity: number;
  /** Средняя цена покупки в валюте инструмента. */
  avgPrice: number;
  /** Себестоимость, ₽. */
  cost: number;
  /** Текущая цена в валюте инструмента. */
  price: number;
  /** Стоимость с НКД, ₽. */
  value: number;
  dayChange: number;
  weight: number;
  /** Реализованная прибыль от продаж, ₽. */
  realized: number;
  /** Полученные выплаты, ₽ (на руки по факту). */
  income: number;
  /** Ожидаемые выплаты за 12 месяцев до налога, ₽. */
  forwardIncome: number;
  /** Дата первой покупки. */
  firstBuy?: number;
  byAccount: Record<string, number>;
}

export const profitOf = (h: Holding) => h.value - h.cost;
export const profitPctOf = (h: Holding) => (h.cost > 0 ? (h.value - h.cost) / h.cost : 0);
export const yieldOf = (h: Holding) => (h.value > 0 ? h.forwardIncome / h.value : 0);
export const yocOf = (h: Holding) => (h.cost > 0 ? h.forwardIncome / h.cost : 0);
export const totalReturnOf = (h: Holding) => h.value - h.cost + h.realized + h.income;

export interface HistoryPoint {
  t: number;
  value: number;
  invested: number;
  /** Накопленный рост самих бумаг (TWR), 1 = 0 %. */
  index: number;
}

export interface Upcoming {
  id: string;
  event: PayEvent;
  instrument: Instrument;
  quantity: number;
  /** ₽ до налога. */
  gross: number;
  /** ₽ на руки. */
  net: number;
  pay: number;
}

export interface Report {
  accounts: Account[];
  holdings: Holding[];
  /** Все строки, включая проданные бумаги (для реализованной прибыли и выплат). */
  allRows: Holding[];
  cashByCurrency: Record<string, number>;
  cashRUB: number;
  cashByAccount: Record<string, number>;
  securitiesValue: number;
  totalValue: number;
  invested: number;
  unrealized: number;
  realized: number;
  dividends: number;
  coupons: number;
  fees: number;
  tradeFees: number;
  taxes: number;
  dayChange: number;
  xirr: number | null;
  forwardIncome: number;
  forwardIncomeNet: number;
  history: HistoryPoint[];
  upcoming: Upcoming[];
  transactions: TxT[];
  fx: Record<string, number>;
  taxRate: number;
}

export const reportProfit = (r: Report) => r.totalValue - r.invested;
export const reportProfitPct = (r: Report) => (r.invested > 0 ? (r.totalValue - r.invested) / r.invested : 0);
export const reportYield = (r: Report) => (r.securitiesValue > 0 ? r.forwardIncome / r.securitiesValue : 0);

export function scopeAccounts(p: Portfolio, scope: string): Account[] {
  if (scope.startsWith("account:")) return p.accounts.filter((a) => a.id === scope.slice(8));
  if (scope.startsWith("broker:")) return p.accounts.filter((a) => a.broker === scope.slice(7) && a.included);
  if (scope === "iis") return p.accounts.filter((a) => a.kind === "iis" && a.included);
  if (scope === "everything") return p.accounts;
  return p.accounts.filter((a) => a.included);
}

export const instrumentOf = (id: string, p: Portfolio): Instrument =>
  p.instruments[id] ?? { id, ticker: id, name: id, type: "share", currency: "RUB" };

export function build(p: Portfolio, market: Market, settings: Settings, snapshots: Snapshot[] = [], today = Date.now()): Report {
  const accounts = scopeAccounts(p, settings.scope);
  const accIds = new Set(accounts.map((a) => a.id));
  const txs: TxT[] = p.transactions
    .filter((t) => accIds.has(t.accountId))
    .map((t) => ({ ...t, t: ms(t.date) }))
    .sort((a, b) => a.t - b.t);
  const fx = (c: string) => p.fx[normCurrency(c)] ?? 1;
  const tax = settings.taxRate / 100;
  const r: Report = {
    accounts, holdings: [], allRows: [], cashByCurrency: {}, cashRUB: 0, cashByAccount: {}, securitiesValue: 0, totalValue: 0, invested: 0,
    unrealized: 0, realized: 0, dividends: 0, coupons: 0, fees: 0, tradeFees: 0, taxes: 0, dayChange: 0, xirr: null,
    forwardIncome: 0, forwardIncomeNet: 0, history: [], upcoming: [], transactions: txs, fx: p.fx, taxRate: settings.taxRate,
  };

  // Состояние по (счёт, бумага) — метод средней цены
  interface Lot { qty: number; cost: number; realized: number; income: number; lastPrice: number; firstBuy?: number }
  const newLot = (): Lot => ({ qty: 0, cost: 0, realized: 0, income: 0, lastPrice: 0 });
  const lots: Record<string, Record<string, Lot>> = {};
  const deposits: Record<string, number> = {};
  const hasDeposits = new Set<string>();
  const cashCalc: Record<string, Record<string, number>> = {};

  for (const t of txs) {
    const rate = fx(t.currency);
    const cashEffect = t.amount - t.fee;
    const cc = (cashCalc[t.accountId] ??= {});
    cc[t.currency] = (cc[t.currency] ?? 0) + cashEffect;
    switch (t.type) {
      case "deposit":
        deposits[t.accountId] = (deposits[t.accountId] ?? 0) + Math.abs(t.amount) * rate;
        hasDeposits.add(t.accountId);
        break;
      case "withdrawal":
        deposits[t.accountId] = (deposits[t.accountId] ?? 0) - Math.abs(t.amount) * rate;
        hasDeposits.add(t.accountId);
        break;
      case "fee":
        r.fees += Math.abs(cashEffect) * rate;
        break;
      case "tax":
        r.taxes += Math.abs(cashEffect) * rate;
        break;
      case "dividend":
        r.dividends += t.amount * rate;
        r.taxes += t.fee * rate;
        break;
      case "coupon":
        r.coupons += t.amount * rate;
        r.taxes += t.fee * rate;
        break;
    }
    if (t.type === "buy" || t.type === "sell") {
      r.fees += t.fee * rate;
      r.tradeFees += t.fee * rate;
    }
    if (!t.instrumentId) continue;
    const accLots = (lots[t.accountId] ??= {});
    const lot = (accLots[t.instrumentId] ??= newLot());
    switch (t.type) {
      case "buy":
        lot.qty += t.quantity;
        lot.cost += Math.abs(t.amount) + t.fee;
        if (t.price > 0) lot.lastPrice = t.price;
        lot.firstBuy ??= t.t;
        break;
      case "sell": {
        const avg = lot.qty > 0 ? lot.cost / lot.qty : 0;
        const q = Math.min(t.quantity, Math.max(lot.qty, 0));
        lot.realized += (Math.abs(t.amount) - t.fee - avg * q) * rate;
        lot.cost -= avg * q;
        lot.qty -= t.quantity;
        if (t.price > 0) lot.lastPrice = t.price;
        if (lot.qty <= 1e-9) {
          lot.qty = 0;
          lot.cost = 0;
        }
        break;
      }
      case "amortization":
        lot.cost = Math.max(0, lot.cost - Math.abs(t.amount));
        break;
      case "repayment":
        lot.realized += (Math.abs(t.amount) - lot.cost) * rate;
        lot.qty = 0;
        lot.cost = 0;
        break;
      case "dividend":
      case "coupon":
        lot.income += cashEffect * rate;
        break;
    }
  }

  // Снимки позиций из API важнее расчёта по операциям
  const snapshotAccounts = new Set([...p.positions.map((x) => x.accountId), ...p.cash.map((x) => x.accountId)]);
  const posByAcc: Record<string, Record<string, (typeof p.positions)[number]>> = {};
  for (const pos of p.positions) if (accIds.has(pos.accountId)) (posByAcc[pos.accountId] ??= {})[pos.instrumentId] = pos;

  const rows: Record<string, Holding> = {};
  const accountValue: Record<string, number> = {};
  for (const acc of accounts) {
    const accLots: Record<string, Lot> = { ...(lots[acc.id] ?? {}) };
    if (snapshotAccounts.has(acc.id)) {
      const snap = posByAcc[acc.id] ?? {};
      for (const iid of Object.keys(accLots)) if (!snap[iid]) accLots[iid] = { ...accLots[iid], qty: 0, cost: 0 };
      for (const [iid, pos] of Object.entries(snap)) {
        const lot = { ...(accLots[iid] ?? newLot()) };
        lot.qty = pos.quantity;
        lot.cost = pos.avgPrice * pos.quantity;
        if (pos.currentPrice != null) lot.lastPrice = pos.currentPrice;
        accLots[iid] = lot;
      }
    }
    for (const [iid, lot] of Object.entries(accLots)) {
      const inst = instrumentOf(iid, p);
      const rate = fx(inst.currency);
      const row = (rows[iid] ??= {
        id: iid, instrument: inst, quantity: 0, avgPrice: 0, cost: 0, price: 0, value: 0, dayChange: 0, weight: 0,
        realized: 0, income: 0, forwardIncome: 0, byAccount: {},
      });
      row.realized += lot.realized;
      row.income += lot.income;
      if (lot.firstBuy && (!row.firstBuy || lot.firstBuy < row.firstBuy)) row.firstBuy = lot.firstBuy;
      if (lot.qty > 1e-9) {
        const pos = posByAcc[acc.id]?.[iid];
        const price = p.lastPrices[iid] ?? pos?.currentPrice ?? lot.lastPrice;
        const accrued = p.accrued[iid] ?? pos?.accrued ?? 0;
        const value = (price + accrued) * lot.qty * rate;
        row.quantity += lot.qty;
        row.cost += lot.cost * rate;
        row.price = price;
        row.value += value;
        row.byAccount[acc.id] = (row.byAccount[acc.id] ?? 0) + value;
        const prev = p.prevClose[iid];
        if (prev && prev > 0) row.dayChange += (price - prev) * lot.qty * rate;
        accountValue[acc.id] = (accountValue[acc.id] ?? 0) + value;
      }
    }
    let accCash = 0;
    if (snapshotAccounts.has(acc.id)) {
      for (const c of p.cash) {
        if (c.accountId !== acc.id) continue;
        r.cashByCurrency[c.currency] = (r.cashByCurrency[c.currency] ?? 0) + c.amount;
        accCash += c.amount * fx(c.currency);
      }
    } else if (hasDeposits.has(acc.id)) {
      for (const [c, v] of Object.entries(cashCalc[acc.id] ?? {})) {
        r.cashByCurrency[c] = (r.cashByCurrency[c] ?? 0) + v;
        accCash += v * fx(c);
      }
    }
    r.cashByAccount[acc.id] = accCash;
    accountValue[acc.id] = (accountValue[acc.id] ?? 0) + accCash;
    r.cashRUB += accCash;
  }
  for (const row of Object.values(rows)) {
    if (row.quantity > 0 && row.cost > 0) row.avgPrice = row.cost / row.quantity / fx(row.instrument.currency);
  }

  // Выплаты на 2 года вперёд; в «прогноз на 12 мес.» идут дивиденды и купоны за год
  const horizon = addDays(today, 365);
  const near = (a: string, b: number) => Math.abs(ms(a) - b) < 75 * DAY;
  const upcoming: Upcoming[] = [];
  for (const row of Object.values(rows)) {
    if (row.quantity <= 0) continue;
    const inst = row.instrument;
    const iid = row.id;
    // Уже выплаченные события не ожидаем: они есть в операциях
    const declared = p.events.filter(
      (e) => e.instrumentId === iid && e.status !== "paid" && ms(e.payDate) >= addDays(today, -1) && (ms(e.payDate) <= addDays(today, 730) || e.kind === "maturity"),
    );
    const evs: PayEvent[] = declared.filter((e) => (e.kind === "dividend" ? ms(e.recordDate) >= addDays(today, -1) : true));
    if (inst.type === "share" || inst.type === "etf") {
      const declaredDivs = evs.filter((e) => e.kind === "dividend");
      const hist = p.dividendHistory[iid] ?? [];
      // Как в Snowball: повторяем выплаты последних 12 месяцев; если их не было — выплаты годом ранее
      let shift = 1;
      let base = hist.filter((e) => ms(e.recordDate) >= addDays(today, -395) && ms(e.recordDate) < today);
      if (!base.length) {
        base = hist.filter((e) => ms(e.recordDate) >= addDays(today, -760) && ms(e.recordDate) < addDays(today, -395));
        shift = 2;
      }
      for (const e of base) {
        const rec = addYears(e.recordDate, shift);
        if (rec <= today || rec > horizon || declaredDivs.some((d) => near(d.recordDate, rec))) continue;
        evs.push({ ...e, recordDate: new Date(rec).toISOString(), payDate: new Date(addYears(e.payDate, shift)).toISOString(), status: "forecast" });
      }
      // Второй год — повтор первого, если на эту дату ничего не объявлено
      for (const f of evs.filter((e) => e.kind === "dividend" && ms(e.recordDate) > today && ms(e.recordDate) <= horizon)) {
        const rec = addYears(f.recordDate, 1);
        if (rec > addDays(today, 730) || declaredDivs.some((d) => near(d.recordDate, rec))) continue;
        evs.push({ ...f, recordDate: new Date(rec).toISOString(), payDate: new Date(addYears(f.payDate, 1)).toISOString(), status: "forecast" });
      }
    }
    for (const e of evs) {
      const gross = e.perUnit * row.quantity * fx(e.currency);
      const taxed = e.kind === "dividend" || e.kind === "coupon";
      const pay = ms(e.payDate);
      upcoming.push({ id: `${iid}|${e.kind}|${e.recordDate.slice(0, 10)}`, event: e, instrument: inst, quantity: row.quantity, gross, net: taxed ? gross * (1 - tax) : gross, pay });
      if (taxed && pay <= horizon) row.forwardIncome += gross;
    }
  }
  r.upcoming = upcoming.sort((a, b) => a.pay - b.pay);
  const next12 = r.upcoming.filter((u) => u.pay <= horizon && (u.event.kind === "dividend" || u.event.kind === "coupon"));
  r.forwardIncome = next12.reduce((s, u) => s + u.gross, 0);
  r.forwardIncomeNet = next12.reduce((s, u) => s + u.net, 0);

  // Итоги
  const all = Object.values(rows);
  r.securitiesValue = all.reduce((s, h) => s + h.value, 0);
  r.totalValue = r.securitiesValue + r.cashRUB;
  for (const h of all) h.weight = r.totalValue > 0 ? h.value / r.totalValue : 0;
  r.allRows = all;
  r.holdings = all.filter((h) => h.quantity > 0).sort((a, b) => b.value - a.value);
  r.unrealized = r.holdings.reduce((s, h) => s + profitOf(h), 0);
  r.realized = all.reduce((s, h) => s + h.realized, 0);
  r.dayChange = r.holdings.reduce((s, h) => s + h.dayChange, 0);
  let invested = 0;
  for (const acc of accounts) {
    if (hasDeposits.has(acc.id)) invested += deposits[acc.id] ?? 0;
    else {
      // Нет истории пополнений — берём себестоимость позиций + кэш
      invested += r.holdings.reduce((s, h) => {
        const v = h.byAccount[acc.id];
        return v && h.value > 0 ? s + (h.cost * v) / h.value : s;
      }, 0);
      invested += r.cashByAccount[acc.id] ?? 0;
    }
  }
  r.invested = invested;

  // XIRR: пополнения/выводы, а для счетов без них — сделки и выплаты
  const flows: [number, number][] = [];
  for (const t of txs) if (hasDeposits.has(t.accountId) && (t.type === "deposit" || t.type === "withdrawal")) flows.push([t.t, -t.amount * fx(t.currency)]);
  for (const acc of accounts) {
    if (hasDeposits.has(acc.id)) continue;
    for (const t of txs) {
      if (t.accountId !== acc.id) continue;
      if (["buy", "sell", "dividend", "coupon", "repayment", "amortization"].includes(t.type)) flows.push([t.t, (t.amount - t.fee) * fx(t.currency)]);
    }
    if (!txs.some((t) => t.accountId === acc.id && t.type === "buy") && (accountValue[acc.id] ?? 0) > 0) {
      const costHere = r.holdings.reduce((s, h) => s + (h.byAccount[acc.id] ?? 0) * (h.value > 0 ? h.cost / h.value : 0), 0);
      flows.push([addDays(today, -365), -(r.cashByAccount[acc.id] ?? 0) - costHere]);
    }
  }
  flows.push([today, r.totalValue]);
  r.xirr = xirr(flows);

  r.history = history(p, market, txs, hasDeposits, r, snapshots, today);
  return r;
}

/* ── история стоимости ── */

function sortedPrices(market: Market): Record<string, { t: number; c: number }[]> {
  const out: Record<string, { t: number; c: number }[]> = {};
  for (const [k, pts] of Object.entries(market.prices)) out[k] = pts.map(([d, c]) => ({ t: ms(d), c })).sort((a, b) => a.t - b.t);
  return out;
}

export function priceAt(pts: { t: number; c: number }[] | undefined, at: number): number | null {
  if (!pts?.length) return null;
  let lo = 0;
  let hi = pts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= at) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? pts[found].c : null;
}

/** Цена бумаги на дату в деньгах (облигации — из % номинала). */
export function makePriceLookup(p: Portfolio, market: Market) {
  const sorted = sortedPrices(market);
  return (iid: string, at: number): number | null => {
    const c = priceAt(sorted[iid], at);
    if (c == null) return null;
    const inst = p.instruments[iid];
    return inst?.type === "bond" ? (c * (inst.nominal ?? 1000)) / 100 : c;
  };
}

function history(p: Portfolio, market: Market, txs: TxT[], hasDeposits: Set<string>, report: Report, snapshots: Snapshot[], today: number): HistoryPoint[] {
  if (!txs.length) {
    const pts = [...snapshots]
      .sort((a, b) => ms(a.date) - ms(b.date))
      .map((s) => ({ t: ms(s.date), value: s.value, invested: s.invested, index: 1 }));
    pts.push({ t: today, value: report.totalValue, invested: report.invested, index: 1 });
    return withIndex(pts);
  }
  const fx = (c: string) => p.fx[normCurrency(c)] ?? 1;
  const price = makePriceLookup(p, market);
  const dates: number[] = [];
  for (let d = startOfDayMs(txs[0].t); d < today; d = addDays(d, 7)) dates.push(d);
  dates.push(today);
  const qty: Record<string, number> = {};
  const lastTrade: Record<string, number> = {};
  let cash = 0;
  let invested = 0;
  let i = 0;
  const pts: HistoryPoint[] = [];
  for (const date of dates) {
    const end = addDays(date, 1);
    while (i < txs.length && txs[i].t < end) {
      const t = txs[i];
      const rate = fx(t.currency);
      const dep = hasDeposits.has(t.accountId);
      if (dep) cash += (t.amount - t.fee) * rate;
      if ((t.type === "deposit" || t.type === "withdrawal") && dep) invested += t.amount * rate;
      if ((t.type === "buy" || t.type === "sell") && !dep) invested += -(t.amount - t.fee) * rate;
      if (t.instrumentId) {
        if (t.type === "buy") qty[t.instrumentId] = (qty[t.instrumentId] ?? 0) + t.quantity;
        if (t.type === "sell") qty[t.instrumentId] = (qty[t.instrumentId] ?? 0) - t.quantity;
        if (t.type === "repayment") qty[t.instrumentId] = 0;
        if (t.price > 0 && (t.type === "buy" || t.type === "sell")) lastTrade[t.instrumentId] = t.price;
      }
      i++;
    }
    let value = cash;
    for (const [iid, q] of Object.entries(qty)) {
      if (q <= 1e-9) continue;
      const pr = price(iid, date) ?? lastTrade[iid] ?? p.lastPrices[iid] ?? 0;
      value += q * pr * fx(p.instruments[iid]?.currency ?? "RUB");
    }
    pts.push({ t: date, value, invested, index: 1 });
  }
  const last = pts[pts.length - 1];
  last.value = report.totalValue;
  last.invested = report.invested;
  return withIndex(pts);
}

function withIndex(pts: HistoryPoint[]): HistoryPoint[] {
  let idx = 1;
  return pts.map((pt, k) => {
    if (k > 0) {
      const prev = pts[k - 1];
      const flow = pt.invested - prev.invested;
      if (prev.value > 1) {
        const ret = (pt.value - flow) / prev.value - 1;
        if (Number.isFinite(ret) && Math.abs(ret) < 0.6) idx *= 1 + ret;
      }
    }
    return { ...pt, index: idx };
  });
}

/* ── XIRR ── */

export function xirr(flowsIn: [number, number][]): number | null {
  const f = flowsIn.filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]);
  if (f.length < 2 || !f.some(([, v]) => v < 0) || !f.some(([, v]) => v > 0)) return null;
  const t0 = f[0][0];
  const ts = f.map(([t]) => yearsBetween(t0, t));
  const npv = (rate: number) => f.reduce((s, [, v], i) => s + v / (1 + rate) ** ts[i], 0);
  let lo = -0.99;
  let hi = 10;
  let flo = npv(lo);
  if (flo * npv(hi) >= 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-6) return mid;
    if (fm < 0 === flo < 0) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ── структура портфеля ── */

export type Dimension = "type" | "sector" | "currency" | "account" | "broker" | "asset";
export const DIMENSION_TITLE: Record<Dimension, string> = {
  type: "Классы",
  sector: "Отрасли",
  currency: "Валюты",
  account: "Счета",
  broker: "Брокеры",
  asset: "Бумаги",
};

export interface Slice {
  name: string;
  value: number;
  share: number;
}

export function allocation(r: Report, dim: Dimension, includeCash = true): Slice[] {
  const m: Record<string, number> = {};
  const add = (k: string, v: number) => (m[k] = (m[k] ?? 0) + v);
  const accName = Object.fromEntries(r.accounts.map((a) => [a.id, a]));
  for (const h of r.holdings) {
    if (h.value <= 0) continue;
    const i = h.instrument;
    switch (dim) {
      case "type": add(ASSET_TITLE[i.type], h.value); break;
      case "sector": add(i.sector ?? (i.type === "bond" ? "Облигации" : "Не указана"), h.value); break;
      case "currency": add(i.currency, h.value); break;
      case "asset": add(i.name, h.value); break;
      case "account": for (const [a, v] of Object.entries(h.byAccount)) add(accName[a]?.name ?? a, v); break;
      case "broker": for (const [a, v] of Object.entries(h.byAccount)) add(accName[a] ? BROKER_TITLE[accName[a].broker] : "?", v); break;
    }
  }
  if (includeCash && r.cashRUB > 0.5) {
    switch (dim) {
      case "type": add(ASSET_TITLE.currency, r.cashRUB); break;
      case "sector":
      case "asset": add("Свободные деньги", r.cashRUB); break;
      case "currency": for (const [c, v] of Object.entries(r.cashByCurrency)) if (v > 0) add(c, v * (r.fx[c] ?? 1)); break;
      case "account": for (const [a, v] of Object.entries(r.cashByAccount)) if (v > 0) add(accName[a]?.name ?? a, v); break;
      case "broker": for (const [a, v] of Object.entries(r.cashByAccount)) if (v > 0) add(accName[a] ? BROKER_TITLE[accName[a].broker] : "?", v); break;
    }
  }
  const total = Object.values(m).reduce((s, v) => s + v, 0);
  return Object.entries(m)
    .map(([name, value]) => ({ name, value, share: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

/* ── риск ── */

export interface Risk {
  annualReturn?: number;
  volatility?: number;
  sharpe?: number;
  maxDrawdown?: number;
  beta?: number;
  benchmarkReturn?: number;
}

export function risk(r: Report, benchmark: PricePoint[] | undefined, riskFree: number, since?: number): Risk {
  const pts = r.history.filter((p) => since == null || p.t >= since);
  if (pts.length <= 8) return {};
  const rets: number[] = [];
  for (let i = 1; i < pts.length; i++) if (pts[i - 1].index > 0) rets.push(pts[i].index / pts[i - 1].index - 1);
  const years = Math.max(yearsBetween(pts[0].t, pts[pts.length - 1].t), 0.01);
  const ann = (pts[pts.length - 1].index / pts[0].index) ** (1 / years) - 1;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
  const vol = Math.sqrt(variance) * Math.sqrt(52);
  let peak = pts[0].index;
  let mdd = 0;
  for (const p of pts) {
    peak = Math.max(peak, p.index);
    mdd = Math.min(mdd, p.index / peak - 1);
  }
  const out: Risk = { annualReturn: ann, volatility: vol, sharpe: vol > 0 ? (ann - riskFree / 100) / vol : undefined, maxDrawdown: mdd };
  const bench = (benchmark ?? []).map(([d, c]) => ({ t: ms(d), c })).sort((a, b) => a.t - b.t);
  if (bench.length > 8) {
    const pr: number[] = [];
    const br: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const b0 = priceAt(bench, pts[i - 1].t);
      const b1 = priceAt(bench, pts[i].t);
      if (!b0 || !b1 || pts[i - 1].index <= 0) continue;
      pr.push(pts[i].index / pts[i - 1].index - 1);
      br.push(b1 / b0 - 1);
    }
    if (pr.length > 8) {
      const mp = pr.reduce((s, x) => s + x, 0) / pr.length;
      const mb = br.reduce((s, x) => s + x, 0) / br.length;
      let cov = 0;
      let vb = 0;
      pr.forEach((x, i) => {
        cov += (x - mp) * (br[i] - mb);
        vb += (br[i] - mb) ** 2;
      });
      if (vb > 0) out.beta = cov / vb;
    }
    const b0 = priceAt(bench, pts[0].t);
    const b1 = bench[bench.length - 1].c;
    if (b0) out.benchmarkReturn = (b1 / b0) ** (1 / years) - 1;
  }
  return out;
}

/**
 * «Если бы те же пополнения шли в индекс»: каждое изменение суммы вложений — покупка или продажа
 * индекса по цене той же недели. Возвращает стоимость «паёв» сейчас и доходность в год.
 */
export function sameMoneyInIndex(r: Report, benchmark: PricePoint[] | undefined): { value: number; xirr: number | null } | null {
  const bench = (benchmark ?? []).map(([d, c]) => ({ t: ms(d), c })).sort((a, b) => a.t - b.t);
  if (bench.length < 8 || r.history.length < 8) return null;
  let units = 0;
  let prevInv = 0;
  const flows: [number, number][] = [];
  for (const pt of r.history) {
    const flow = pt.invested - prevInv;
    prevInv = pt.invested;
    if (Math.abs(flow) < 1) continue;
    const px = priceAt(bench, pt.t);
    if (!px) continue;
    units += flow / px;
    flows.push([pt.t, -flow]);
  }
  const last = bench[bench.length - 1].c;
  const value = units * last;
  flows.push([Date.now(), value]);
  return { value, xirr: xirr(flows) };
}
