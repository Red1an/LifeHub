import { addYears, startOfDayMs, yearOf } from "./dates.ts";
import { instrumentOf, makePriceLookup, xirr, type Report, type TxT } from "./analytics.ts";
import { isIncomeTax } from "./income.ts";
import { normCurrency, type Instrument, type Market, type Portfolio } from "./types.ts";

/*
 * Результат по каждой бумаге за период: сколько вложил, сколько вернул, сколько получил выплат и сколько заработал.
 *
 *   результат = стоимость в конце − стоимость в начале − (покупки − продажи) + выплаты на руки
 *
 * Стоимость в начале периода — количество по операциям × недельная цена MOEX на ту дату (для «всё время» — ноль).
 * В конце периода для текущей даты берётся фактическая стоимость позиции (с НКД), иначе — цена на конец периода.
 * Курс валют — текущий (как во всём модуле).
 */

export interface AssetPerf {
  id: string;
  instrument: Instrument;
  /** Купил за период (с комиссиями), ₽. */
  bought: number;
  /** Получил от продаж, погашений и амортизации за период, ₽. */
  sold: number;
  /** Дивиденды и купоны на руки за период, ₽. */
  income: number;
  startValue: number;
  endValue: number;
  /** Итог за период, ₽. */
  result: number;
  /** Часть итога от изменения цены (включая прибыль от продаж). */
  priceResult: number;
  /** База для процента — средние вложенные деньги за период (метод Дитца): частые покупки и продажи не раздувают её. */
  base: number;
  ret: number | null;
  /** Доходность в год с учётом дат покупок (XIRR), только для периода «всё время» и длиннее 3 месяцев. */
  annual: number | null;
  held: boolean;
  trades: number;
}

export interface PerfPeriod {
  key: string;
  label: string;
  from: number | null;
  to: number;
}

export function perfPeriods(r: Report, today = Date.now()): PerfPeriod[] {
  const cy = yearOf(today);
  const first = r.transactions[0]?.t ?? today;
  const out: PerfPeriod[] = [
    { key: "all", label: "Всё время", from: null, to: today },
    { key: "ytd", label: `С начала ${cy}`, from: new Date(cy, 0, 1).getTime(), to: today },
    { key: "12m", label: "12 месяцев", from: addYears(today, -1), to: today },
  ];
  for (let y = cy - 1; y >= yearOf(first); y--) out.push({ key: String(y), label: `${y} год`, from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() - 1 });
  return out;
}

export function assetPerformance(p: Portfolio, market: Market, r: Report, from: number | null, to: number, onlyId?: string, today = Date.now()): AssetPerf[] {
  const fx = (c: string) => p.fx[normCurrency(c)] ?? 1;
  const price = makePriceLookup(p, market);
  const isNow = to >= startOfDayMs(today);
  const byId = new Map<string, TxT[]>();
  for (const t of r.transactions) {
    if (!t.instrumentId || (onlyId && t.instrumentId !== onlyId)) continue;
    (byId.get(t.instrumentId) ?? byId.set(t.instrumentId, []).get(t.instrumentId)!).push(t);
  }
  const out: AssetPerf[] = [];
  for (const [id, txs] of byId) {
    const inst = instrumentOf(id, p);
    if (inst.type === "currency") continue;
    const rate = fx(inst.currency);
    const valueAt = (q: number, at: number, fallback: number) => (q > 0 ? q * (price(id, at) ?? (fallback || p.lastPrices[id] || 0)) * rate : 0);
    // 1. Что было на начало периода
    let qty = 0;
    let lastTrade = 0;
    for (const t of txs) {
      if (from == null || t.t >= from) break;
      if (t.type === "buy") qty += t.quantity;
      else if (t.type === "sell") qty -= t.quantity;
      else if (t.type === "repayment") qty = 0;
      if ((t.type === "buy" || t.type === "sell") && t.price > 0) lastTrade = t.price;
      if (qty < 1e-9) qty = 0;
    }
    const startValue = from == null ? 0 : valueAt(qty, from, lastTrade);

    // 2. Операции периода. Параллельно считаем, сколько денег в среднем было вложено в бумагу, пока она была
    //    в портфеле (база для процента): частые покупки и продажи её не раздувают, а время без бумаги не размывает.
    let bought = 0;
    let sold = 0;
    let income = 0;
    let trades = 0;
    let cost = startValue;
    let integral = 0;
    let heldTime = 0;
    let lastT = from ?? txs[0].t;
    const flows: [number, number][] = [];
    const tick = (now: number) => {
      if (qty > 0 && now > lastT) {
        integral += cost * (now - lastT);
        heldTime += now - lastT;
      }
      lastT = Math.max(lastT, now);
    };
    for (const t of txs) {
      if (from != null && t.t < from) continue;
      if (t.t > to) break;
      const cash = (t.amount - t.fee) * fx(t.currency);
      if (t.type === "buy") {
        tick(t.t);
        qty += t.quantity;
        cost += -cash;
        bought += -cash;
        trades++;
        flows.push([t.t, cash]);
      } else if (t.type === "sell") {
        tick(t.t);
        const q = Math.min(t.quantity, qty);
        cost -= qty > 0 ? (cost / qty) * q : 0;
        qty -= t.quantity;
        sold += cash;
        trades++;
        flows.push([t.t, cash]);
      } else if (t.type === "repayment" || t.type === "amortization") {
        tick(t.t);
        if (t.type === "repayment") {
          qty = 0;
          cost = 0;
        } else cost = Math.max(0, cost - cash);
        sold += cash;
        flows.push([t.t, cash]);
      } else if (t.type === "dividend" || t.type === "coupon" || isIncomeTax(t)) {
        income += cash;
        flows.push([t.t, cash]);
      }
      if ((t.type === "buy" || t.type === "sell") && t.price > 0) lastTrade = t.price;
      if (qty < 1e-9) {
        qty = 0;
        cost = 0;
      }
    }
    tick(Math.min(to, today));
    const holding = r.holdings.find((h) => h.id === id);
    const endValue = isNow ? holding?.value ?? valueAt(qty, to, lastTrade) : valueAt(qty, to, lastTrade);
    if (!bought && !sold && !income && !startValue && !endValue) continue;
    const result = endValue - startValue - (bought - sold) + income;
    const base = heldTime > 0 ? integral / heldTime : Math.max(startValue, bought);
    let annual: number | null = null;
    const first = flows[0]?.[0];
    if (from == null && first && to - first > 90 * 86_400_000) {
      annual = xirr([...flows, [Math.min(to, today), endValue]]);
      if (annual != null && Math.abs(annual) > 5) annual = null;
    }
    out.push({
      id, instrument: inst, bought, sold, income, startValue, endValue, result, priceResult: result - income, base,
      ret: base > 1 ? result / base : null, annual, held: (holding?.quantity ?? 0) > 0, trades,
    });
  }
  return out;
}

export interface PerfTotals {
  base: number;
  bought: number;
  sold: number;
  income: number;
  startValue: number;
  endValue: number;
  result: number;
  ret: number | null;
}

/** Итог по всем бумагам. База для процента — средняя стоимость портфеля за период (по недельной истории). */
export function perfTotals(list: AssetPerf[], r: Report, from: number | null, to: number): PerfTotals {
  const t = list.reduce(
    (a, x) => ({ bought: a.bought + x.bought, sold: a.sold + x.sold, income: a.income + x.income, startValue: a.startValue + x.startValue, endValue: a.endValue + x.endValue, result: a.result + x.result }),
    { bought: 0, sold: 0, income: 0, startValue: 0, endValue: 0, result: 0 },
  );
  const pts = r.history.filter((h) => (from == null || h.t >= from) && h.t <= to && h.value > 0);
  const base = pts.length ? pts.reduce((a, h) => a + h.value, 0) / pts.length : t.startValue + t.bought;
  return { ...t, base, ret: base > 1 ? t.result / base : null };
}

/** Результат одной бумаги по календарным годам — для карточки бумаги. */
export function assetByYear(p: Portfolio, market: Market, r: Report, id: string, today = Date.now()): { year: number; perf: AssetPerf }[] {
  const txs = r.transactions.filter((t) => t.instrumentId === id);
  if (!txs.length) return [];
  const out: { year: number; perf: AssetPerf }[] = [];
  for (let y = yearOf(txs[0].t); y <= yearOf(today); y++) {
    const from = new Date(y, 0, 1).getTime();
    const to = y === yearOf(today) ? today : new Date(y + 1, 0, 1).getTime() - 1;
    const perf = assetPerformance(p, market, r, y === yearOf(txs[0].t) ? null : from, to, id, today)[0];
    if (perf) out.push({ year: y, perf });
  }
  return out;
}
