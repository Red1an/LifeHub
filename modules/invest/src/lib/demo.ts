import { addDays, day, ms, yearOf, monthOf } from "./dates.ts";
import { pool } from "./http.ts";
import { bondSchedule, priceHistory } from "./moex.ts";
import { referenceDividends, sectorFor } from "./reference.ts";
import { emptyMarket, emptyPortfolio, type Account, type AssetType, type Market, type PayEvent, type Portfolio, type PricePoint, type Tx, type TxType } from "./types.ts";

/*
 * Демо-портфель: 3 счёта Т-Банка (брокерский, ИИС, дивидендный) + БКС.
 * Сделки моделируются по реальным недельным котировкам MOEX, дивиденды — по справочнику, купоны — по расписанию MOEX.
 * Специально есть «ошибки»: продажа Газпрома, покупки после роста — чтобы разбор было на чём показать.
 */

const CATALOG: Record<string, [AssetType, "shares" | "bonds", number]> = {
  SBER: ["share", "shares", 250], LKOH: ["share", "shares", 6500], GAZP: ["share", "shares", 160], TATN: ["share", "shares", 600],
  MTSS: ["share", "shares", 250], NVTK: ["share", "shares", 1200], CHMF: ["share", "shares", 1300], AFLT: ["share", "shares", 50],
  YDEX: ["share", "shares", 3800], MOEX: ["share", "shares", 180], MGNT: ["share", "shares", 5500], PHOR: ["share", "shares", 6500],
  SNGSP: ["share", "shares", 50], TRNFP: ["share", "shares", 1300], HEAD: ["share", "shares", 4000], ROSN: ["share", "shares", 500],
  T: ["share", "shares", 3000], TMOS: ["etf", "shares", 6], LQDT: ["etf", "shares", 1.5], GOLD: ["etf", "shares", 2],
  SU26238RMFS4: ["bond", "bonds", 60], SU26240RMFS0: ["bond", "bonds", 65], SU26243RMFS4: ["bond", "bonds", 75],
};

interface Plan {
  account: Account;
  start: string;
  monthly: number;
  initial: number;
  tickers: string[];
  feeRate: number;
}

const acc = (id: string, broker: "tbank" | "bcs", name: string, kind: "broker" | "iis"): Account => ({ id, broker, externalId: id, name, kind, included: true });

const PLANS: Plan[] = [
  { account: acc("tbank:demo-broker", "tbank", "Т-Банк · Брокерский", "broker"), start: "2022-06-01", monthly: 45_000, initial: 150_000, tickers: ["SBER", "LKOH", "TATN", "GAZP", "MTSS", "NVTK", "CHMF", "AFLT", "YDEX", "TMOS"], feeRate: 0.0005 },
  { account: acc("tbank:demo-iis", "tbank", "Т-Банк · ИИС", "iis"), start: "2023-02-01", monthly: 35_000, initial: 200_000, tickers: ["SU26238RMFS4", "SBER", "SU26240RMFS0", "MOEX", "SU26243RMFS4", "LQDT"], feeRate: 0.0003 },
  { account: acc("tbank:demo-div", "tbank", "Т-Банк · Дивидендный", "broker"), start: "2024-03-01", monthly: 25_000, initial: 100_000, tickers: ["MGNT", "PHOR", "SNGSP", "TRNFP", "HEAD", "TATN"], feeRate: 0.0005 },
  { account: acc("bcs:demo", "bcs", "БКС · Брокерский", "broker"), start: "2023-09-01", monthly: 20_000, initial: 80_000, tickers: ["SBER", "LKOH", "ROSN", "GOLD", "T", "NVTK"], feeRate: 0.0003 },
];

const LOTS: Record<string, number> = { GAZP: 10, MOEX: 10, MTSS: 10, SNGSP: 10, TMOS: 100, LQDT: 1000, GOLD: 100 };

export async function generateDemo(progress: (s: string) => void): Promise<{ p: Portfolio; m: Market }> {
  const p = emptyPortfolio();
  const m = emptyMarket();
  p.isDemo = true;
  p.accounts = PLANS.map((x) => ({ ...x.account }));
  const today = Date.now();
  const from = ms("2022-01-01");
  const schedules: Record<string, PayEvent[]> = {};
  let done = 0;
  await pool(Object.keys(CATALOG), 4, async (ticker) => {
    const [type, market, base] = CATALOG[ticker];
    let hist = await priceHistory(ticker, market, market === "bonds" ? "TQOB" : "TQBR", from).catch(() => [] as PricePoint[]);
    if (!hist.length) hist = synthetic(base, from, today, ticker);
    m.prices[ticker] = hist;
    p.instruments[ticker] = { id: ticker, ticker, name: ticker, type, currency: "RUB", sector: sectorFor(ticker, type), nominal: type === "bond" ? 1000 : undefined };
    if (type === "bond") schedules[ticker] = await bondSchedule(ticker, ticker, from).catch(() => []);
    progress(`Демо: котировки ${++done}/${Object.keys(CATALOG).length}…`);
  });

  const sorted = Object.fromEntries(Object.entries(m.prices).map(([k, v]) => [k, v.map(([d, c]) => ({ t: ms(d), c }))]));
  const price = (ticker: string, t: number): number | null => {
    const h = sorted[ticker];
    let last: { t: number; c: number } | undefined;
    for (const x of h ?? []) {
      if (x.t <= t) last = x;
      else break;
    }
    if (!last || t - last.t > 21 * 86_400_000) return null; // бумага ещё не торговалась
    return CATALOG[ticker][0] === "bond" ? last.c * 10 : last.c;
  };

  const txs: Tx[] = [];
  let n = 0;
  const add = (t: Omit<Tx, "id" | "source" | "currency" | "fee" | "quantity" | "price"> & Partial<Tx>) =>
    txs.push({ quantity: 0, price: 0, currency: "RUB", fee: 0, source: "demo", ...t, id: `demo:${++n}` } as Tx);
  const divCache: Record<string, PayEvent[]> = {};

  for (const plan of PLANS) {
    progress(`Демо: сделки «${plan.account.name}»…`);
    const a = plan.account.id;
    let cash = 0;
    const qty: Record<string, number> = {};
    let rotation = 0;
    const pending: { t: number; type: TxType; ticker: string; amount: number; q: number }[] = [];
    let lastMonth = -1;
    const seenDiv = new Set<string>();
    const seenCpn = new Set<string>();
    let soldGazp = false;
    let soldPanic = false;
    for (let d = ms(plan.start); d <= today; d = addDays(d, 7)) {
      const month = monthOf(d);
      for (const [ticker, q] of Object.entries(qty)) {
        if (q <= 0) continue;
        for (const e of (divCache[ticker] ??= referenceDividends(ticker, ticker, today))) {
          const rt = ms(e.recordDate);
          if (rt > d || rt <= addDays(d, -7) || seenDiv.has(ticker + e.recordDate)) continue;
          seenDiv.add(ticker + e.recordDate);
          pending.push({ t: addDays(rt, 14), type: "dividend", ticker, amount: q * e.perUnit, q });
        }
        for (const c of schedules[ticker] ?? []) {
          const pt = ms(c.payDate);
          if (c.kind !== "coupon" || pt > d || pt <= addDays(d, -7) || seenCpn.has(ticker + c.payDate)) continue;
          seenCpn.add(ticker + c.payDate);
          pending.push({ t: pt, type: "coupon", ticker, amount: q * c.perUnit, q });
        }
      }
      for (const x of pending.filter((x) => x.t <= d && x.t <= today)) {
        const fee = Math.round(x.amount * 0.13);
        add({ accountId: a, date: day(x.t), type: x.type, instrumentId: x.ticker, quantity: x.q, price: x.amount / Math.max(x.q, 1), amount: Math.round(x.amount * 100) / 100, fee, note: x.type === "dividend" ? "Выплата дивидендов" : "Выплата купонов" });
        cash += x.amount - fee;
      }
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].t <= d) pending.splice(i, 1);

      if (month === lastMonth) continue;
      lastMonth = month;
      const first = !txs.some((t) => t.accountId === a && t.type === "deposit");
      const amount = first ? plan.initial : plan.monthly;
      add({ accountId: a, date: day(d), type: "deposit", amount, note: "Пополнение счёта" });
      cash += amount;
      const tradeDay = day(Math.min(addDays(d, 1), today));
      if (month === 1 && plan.account.kind === "broker" && yearOf(d) > yearOf(plan.start)) {
        add({ accountId: a, date: tradeDay, type: "fee", amount: -990, note: "Обслуживание счёта" });
        cash -= 990;
      }
      // Продажа Газпрома летом 2024 — пример реализованного результата
      if (a === "tbank:demo-broker" && !soldGazp && d >= ms("2024-07-01") && (qty.GAZP ?? 0) > 0) {
        const pr = price("GAZP", d);
        if (pr) {
          soldGazp = true;
          const q = qty.GAZP;
          const fee = Math.round(q * pr * plan.feeRate * 100) / 100;
          add({ accountId: a, date: tradeDay, type: "sell", instrumentId: "GAZP", quantity: q, price: pr, amount: q * pr, fee, note: "Продажа" });
          cash += q * pr - fee;
          qty.GAZP = 0;
        }
      }
      // Продажа части Сбера на осенней просадке 2024 — пример «продажи на панике»
      if (a === "bcs:demo" && !soldPanic && d >= ms("2024-11-25") && (qty.SBER ?? 0) > 20) {
        const pr = price("SBER", d);
        if (pr) {
          soldPanic = true;
          const q = Math.floor(qty.SBER / 2);
          const fee = Math.round(q * pr * plan.feeRate * 100) / 100;
          add({ accountId: a, date: tradeDay, type: "sell", instrumentId: "SBER", quantity: q, price: pr, amount: q * pr, fee, note: "Продажа" });
          cash += q * pr - fee;
          qty.SBER -= q;
        }
      }
      // Покупки: 2 бумаги по кругу на весь доступный кэш
      let attempts = 0;
      let bought = 0;
      while (bought < 2 && attempts < plan.tickers.length) {
        const ticker = plan.tickers[rotation++ % plan.tickers.length];
        attempts++;
        if (ticker === "GAZP" && soldGazp) continue;
        const pr = price(ticker, d);
        if (!pr) continue;
        const lot = LOTS[ticker] ?? 1;
        const budget = bought === 0 ? cash * 0.5 : cash * 0.97;
        const q = Math.floor(budget / (pr * lot * (1 + plan.feeRate))) * lot;
        if (q <= 0) continue;
        const fee = Math.round(q * pr * plan.feeRate * 100) / 100;
        add({ accountId: a, date: tradeDay, type: "buy", instrumentId: ticker, quantity: q, price: pr, amount: -(q * pr), fee, note: "Покупка" });
        cash -= q * pr + fee;
        qty[ticker] = (qty[ticker] ?? 0) + q;
        bought++;
      }
    }
  }
  p.transactions = txs.sort((x, y) => ms(x.date) - ms(y.date));
  p.updatedAt = new Date().toISOString();
  // История цен пересчитается под ISIN при обновлении рыночных данных; здесь она была нужна для сделок
  return { p, m: emptyMarket() };
}

function synthetic(base: number, from: number, to: number, seed: string): PricePoint[] {
  let state = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  let pr = base * 0.8;
  const out: PricePoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) {
    pr *= 1 + (rnd() - 0.48) * 0.06;
    out.push([day(d), Math.round(pr * 100) / 100]);
  }
  return out;
}
