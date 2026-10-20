import { spent, type AccountDoc, type TxDoc } from "./types.ts";

/*
 * Кэшбэк по картам. У каждой карты — базовый процент и повышенные категории (наши категории трат),
 * которые банки дают выбирать каждый месяц (Сбер, Т-Банк, Озон, Яндекс). Отсюда:
 *  • какой картой платить в каждой категории;
 *  • сколько кэшбэка недополучено: заплатили картой с меньшим процентом, хотя была лучше.
 * Кредитки участвуют (у них тоже бывает кэшбэк), сплиты и наличные — нет.
 */

export interface Cashback {
  /** Базовый процент на всё, %. */
  base?: number;
  /** Повышенные категории: наша категория → %. */
  cats: { category: string; percent: number }[];
  /** Месяц, на который выбраны категории (YYYY-MM): в следующем — напомнить выбрать заново. */
  month?: string;
  /** Потолок кэшбэка в месяц, ₽. */
  limit?: number;
}

const usable = (a: AccountDoc) => !a.archived && (a.type === "card" || a.type === "credit") && !!a.cashback;

export function percentFor(a: AccountDoc, category: string): number {
  if (!a.cashback) return 0;
  return a.cashback.cats.find((c) => c.category === category)?.percent ?? a.cashback.base ?? 0;
}

/** Лучшая карта для категории (при равенстве — с повышенной категорией). */
export function bestFor(accounts: AccountDoc[], category: string): { account: AccountDoc; percent: number } | null {
  let best: { account: AccountDoc; percent: number } | null = null;
  for (const a of accounts.filter(usable)) {
    const p = percentFor(a, category);
    if (!best || p > best.percent) best = { account: a, percent: p };
  }
  return best && best.percent > 0 ? best : null;
}

export interface CashbackReport {
  /** Сколько кэшбэка уже получено по картам (по процентам). */
  got: number;
  /** Сколько можно было получить, платя лучшей картой. */
  possible: number;
  /** По категориям: где теряете больше всего. */
  byCategory: { category: string; spent: number; got: number; possible: number; best: AccountDoc; percent: number }[];
}

export function cashbackReport(txs: TxDoc[], accounts: AccountDoc[], month: string): CashbackReport {
  const byCat = new Map<string, { spent: number; got: number; possible: number; best: AccountDoc; percent: number }>();
  let got = 0;
  let possible = 0;
  if (!accounts.some(usable)) return { got, possible, byCategory: [] };
  for (const t of txs) {
    if (!t.date.startsWith(month) || t.kind !== "expense" || t.amount <= 0 || !t.account) continue;
    // Кэшбэк начисляют на всю сумму оплаты, а не на мою долю в общем счёте.
    const amount = t.amount;
    if (!spent(t) && !t.share) continue;
    if (/перевод|сбп.*перевод|снятие|комисси|проценты/i.test(`${t.category} ${t.raw ?? ""}`) && !/qr/i.test(t.raw ?? "")) continue;
    const acc = accounts.find((a) => a.id === t.account);
    const best = bestFor(accounts, t.category);
    if (!acc || !best) continue;
    const g = (amount * percentFor(acc, t.category)) / 100;
    const p = (amount * best.percent) / 100;
    got += g;
    possible += Math.max(g, p);
    const c = byCat.get(t.category) ?? { spent: 0, got: 0, possible: 0, best: best.account, percent: best.percent };
    c.spent += amount;
    c.got += g;
    c.possible += Math.max(g, p);
    byCat.set(t.category, c);
  }
  return {
    got: Math.round(got),
    possible: Math.round(possible),
    byCategory: [...byCat.entries()].map(([category, c]) => ({ category, ...c })).sort((a, b) => b.possible - b.got - (a.possible - a.got)),
  };
}
