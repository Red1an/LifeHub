import { addDays, ms, yearOf } from "./dates.ts";
import { pool } from "./http.ts";
import { quotes } from "./moex.ts";
import { SCREENER_TICKERS, SECTORS, referenceDividends } from "./reference.ts";
import { TBankClient } from "./tbank.ts";
import type { PayEvent } from "./types.ts";

/*
 * Подбор дивидендных акций (аналог «Топ дивидендных акций» в Snowball).
 * Рейтинг 0–10: доходность (до 4), стабильность выплат за 5 лет (до 3), рост выплат (до 3).
 */

export interface ScreenerRow {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  lot: number;
  /** Выплаты на акцию за 12 мес. (или за последний год с выплатами). */
  ttm: number;
  basis: string;
  yield: number;
  nextAmount?: number;
  nextDate?: string;
  yearsPaid: number;
  growth: number | null;
  score: number;
}

export interface ScreenerData {
  rows: ScreenerRow[];
  source: "tbank" | "reference";
  updatedAt: string;
}

export function screenerRow(ticker: string, name: string, price: number, lot: number, dividends: PayEvent[], sector: string): ScreenerRow {
  const now = Date.now();
  const next = dividends.filter((d) => ms(d.recordDate) > now).sort((a, b) => ms(a.recordDate) - ms(b.recordDate))[0];
  const byYear: Record<number, number> = {};
  for (const d of dividends) if (ms(d.recordDate) <= now) byYear[yearOf(d.recordDate)] = (byYear[yearOf(d.recordDate)] ?? 0) + d.perUnit;
  let ttm = dividends.filter((d) => ms(d.recordDate) <= now && ms(d.recordDate) > addDays(now, -365)).reduce((s, d) => s + d.perUnit, 0);
  let basis = "12 мес.";
  const cy = yearOf(now);
  if (!ttm) {
    const last = Object.entries(byYear).filter(([y, v]) => v > 0 && +y >= cy - 2).map(([y]) => +y).sort().pop();
    if (last) {
      ttm = byYear[last];
      basis = `${last} г.`;
    }
  }
  const window: number[] = [];
  for (let y = cy - 5; y < cy; y++) window.push(y);
  const paidYears = window.filter((y) => (byYear[y] ?? 0) > 0);
  let growth: number | null = null;
  if (paidYears.length >= 2) {
    const a = paidYears[0];
    const b = paidYears[paidYears.length - 1];
    if (b > a && byYear[a] > 0) growth = (byYear[b] / byYear[a]) ** (1 / (b - a)) - 1;
  }
  const y = price > 0 ? ttm / price : 0;
  const score = Math.min(y / 0.12, 1) * 4 + (paidYears.length / 5) * 3 + (growth != null ? Math.min(Math.max(growth, 0) / 0.15, 1) * 3 : 0);
  return { ticker, name, sector, price, lot, ttm, basis, yield: y, nextAmount: next?.perUnit, nextDate: next?.recordDate, yearsPaid: paidYears.length, growth, score };
}

export async function loadScreener(token: string, progress: (s: string) => void): Promise<ScreenerData> {
  progress("Подбор акций: котировки MOEX…");
  const q = await quotes(SCREENER_TICKERS, "shares");
  const tbank = token ? new TBankClient(token) : null;
  let usedApi = false;
  const rows = await pool(SCREENER_TICKERS, 4, async (t) => {
    const quote = q[t];
    if (!quote) return null;
    let divs: PayEvent[] = [];
    if (tbank) {
      try {
        const uid = await tbank.findUid(t);
        if (uid) {
          divs = await tbank.dividends(uid, t, "RUB");
          usedApi = true;
        }
      } catch {
        /* справочник ниже */
      }
    }
    if (!divs.length && !usedApi) divs = referenceDividends(t, t);
    progress(`Подбор акций: ${t}…`);
    return screenerRow(t, quote.shortName ?? t, quote.price, quote.lot ?? 1, divs, SECTORS[t] ?? "—");
  });
  return {
    rows: rows.filter((r): r is ScreenerRow => !!r).sort((a, b) => b.score - a.score),
    source: usedApi ? "tbank" : "reference",
    updatedAt: new Date().toISOString(),
  };
}
