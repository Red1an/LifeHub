import { addDays, day, parseDate } from "./dates.ts";
import { getJSON, numv, postForm, postJSON, str, type J } from "./http.ts";
import { normCurrency, type Account, type AssetType, type Cash, type Position, type Tx, type TxType } from "./types.ts";

/*
 * БКС Торговое API: https://trade-api.bcs.ru
 * refresh-токен (90 дней) из веб-версии «БКС Мир инвестиций» → access-токен (сутки).
 * Сервер выдаёт новый refresh-токен при каждом обмене — сохраняем его, чтобы срок продлевался.
 */

const AUTH = "https://be.broker.ru/trade-api-keycloak/realms/tradeapi/protocol/openid-connect/token";
const PORTFOLIO = "https://be.broker.ru/trade-api-bff-portfolio/api/v1/portfolio";
const TRADES = "https://be.broker.ru/trade-api-bff-trade-details/api/v1/trades/search";
const OPERATIONS = "https://be.broker.ru/trade-api-bff-nontrade-operations/api/v1/operations/search";

export interface BcsResult {
  account: Account;
  positions: Position[];
  cash: Cash[];
  transactions: Tx[];
  tickers: Record<string, { type: AssetType; currency: string; name: string; face?: number }>;
  lastPrices: Record<string, number>;
  accrued: Record<string, number>;
  newRefreshToken?: string;
  log: string[];
}

export async function syncBcs(refreshToken: string, accountName: string, progress: (s: string) => void): Promise<BcsResult> {
  progress("БКС: авторизация…");
  const tok = await postForm<J>(AUTH, { client_id: "trade-api-read", grant_type: "refresh_token", refresh_token: refreshToken });
  const access = str(tok, "access_token");
  if (!access) throw new Error("БКС: не удалось получить access-токен — возможно, refresh-токен истёк (живёт 90 дней)");
  const auth = { authorization: `Bearer ${access}` };
  const account: Account = { id: "bcs:main", broker: "bcs", externalId: "main", name: accountName, kind: "broker", included: true, lastSync: new Date().toISOString() };
  const r: BcsResult = { account, positions: [], cash: [], transactions: [], tickers: {}, lastPrices: {}, accrued: {}, newRefreshToken: str(tok, "refresh_token"), log: [] };

  progress("БКС: портфель…");
  const rows = await getJSON<J[]>(PORTFOLIO, auth);
  // Одна бумага приходит несколькими строками с разными сроками расчётов — берём одну по приоритету.
  const rank: Record<string, number> = { T2: 0, T1: 1, T0: 2, T365: 3 };
  const best: Record<string, J> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const type = str(row, "type") ?? "";
    if (type !== "depoLimit" && type !== "moneyLimit") continue;
    const key = type + "|" + (str(row, "ticker") ?? str(row, "currency") ?? "");
    const cur = best[key];
    if (cur && (rank[str(cur, "term") ?? ""] ?? 9) <= (rank[str(row, "term") ?? ""] ?? 9)) continue;
    best[key] = row;
  }
  for (const row of Object.values(best)) {
    const qty = numv(row, "quantity") ?? 0;
    if (str(row, "type") === "moneyLimit") {
      r.cash.push({ accountId: account.id, currency: normCurrency(str(row, "currency") ?? str(row, "ticker")), amount: qty });
      continue;
    }
    const ticker = str(row, "ticker");
    if (!ticker || !qty) continue;
    const it = (str(row, "instrumentType") ?? "").toLowerCase();
    const face = numv(row, "faceValue");
    const type: AssetType =
      it.includes("bond") || it.includes("облиг") || it.includes("note") ? "bond"
      : it.includes("etf") || it.includes("fund") || it.includes("пиф") ? "etf"
      : it.includes("currency") ? "currency" : "share";
    let price = numv(row, "currentPrice");
    let avg = numv(row, "balancePrice") ?? 0;
    if (type === "bond" && face) {
      if (price != null) price = bondPriceToMoney(price, face);
      avg = bondPriceToMoney(avg, face);
    }
    r.tickers[ticker] = { type, currency: normCurrency(str(row, "currency")), name: str(row, "displayName") ?? ticker, face };
    const accrued = numv(row, "accruedIncome");
    r.positions.push({ accountId: account.id, instrumentId: ticker, quantity: qty, avgPrice: avg, currentPrice: price, accrued });
    if (price != null) r.lastPrices[ticker] = price;
    if (accrued != null) r.accrued[ticker] = accrued;
  }

  progress("БКС: сделки…");
  try {
    r.transactions.push(...(await trades(auth, account.id)));
  } catch (e) {
    r.log.push(`БКС: сделки не загружены — ${(e as Error).message}`);
  }
  progress("БКС: пополнения и выплаты…");
  try {
    r.transactions.push(...(await operations(auth, account.id)));
  } catch (e) {
    r.log.push(`БКС: неторговые операции не загружены — ${(e as Error).message}`);
  }
  r.log.push(`БКС: позиций ${r.positions.length}, операций ${r.transactions.length}`);
  return r;
}

async function trades(auth: Record<string, string>, accountId: string): Promise<Tx[]> {
  const out: Tx[] = [];
  let totalPages = 1;
  for (let page = 0; page < totalPages && page < 500; page++) {
    const j = await postJSON<J>(`${TRADES}?page=${page}&size=100`, { startDateTime: "2010-01-01T00:00:00Z", endDateTime: new Date(addDays(Date.now(), 1)).toISOString() }, auth);
    totalPages = Number(j.totalPages ?? 1);
    for (const t of (j.records ?? []) as J[]) {
      const ticker = str(t, "ticker");
      const date = parseDate(str(t, "tradeDateTime"));
      if (!ticker || !date) continue;
      const side: TxType = str(t, "side") === "2" ? "sell" : "buy";
      const q = numv(t, "tradeQuantity") ?? 0;
      let price = numv(t, "price") ?? 0;
      const volume = numv(t, "volume") ?? numv(t, "contractAmount") ?? q * price;
      if (q > 0 && volume > 0 && Math.abs(volume / q - price) / Math.max(price, 0.0001) > 0.5) price = volume / q; // цена облигаций в %
      out.push({
        id: `bcs:trade:${str(t, "tradeNum") ?? crypto.randomUUID()}`,
        accountId, date, type: side, instrumentId: ticker, quantity: q, price,
        amount: side === "buy" ? -volume : volume,
        currency: normCurrency(str(t, "settlementCurrency") ?? str(t, "priceCurrency")),
        fee: 0, source: "bcs",
      });
    }
  }
  return out;
}

/** Схема ответа в документации не раскрыта — разбор эвристический (по названиям полей и тексту). */
async function operations(auth: Record<string, string>, accountId: string): Promise<Tx[]> {
  const out: Tx[] = [];
  let totalPages = 1;
  for (let page = 0; page < totalPages && page < 500; page++) {
    const any = await postJSON<any>(
      `${OPERATIONS}?page=${page}&size=100`,
      { startDateTime: "2010-01-01T00:00:00Z", endDateTime: new Date(addDays(Date.now(), 1)).toISOString(), dateFrom: "2010-01-01", dateTo: day() },
      auth,
    );
    totalPages = Number(any?.totalPages ?? 1);
    const records: J[] = Array.isArray(any) ? any : ["records", "content", "items", "operations", "data"].map((k) => any?.[k]).find((x) => Array.isArray(x) && x.length) ?? [];
    records.forEach((rec, i) => {
      const tx = heuristicOperation(rec, accountId, `bcs:op:${page}:${i}`);
      if (tx) out.push(tx);
    });
  }
  return out;
}

function heuristicOperation(rec: J, accountId: string, fallbackId: string): Tx | null {
  const find = (keys: string[]) => {
    for (const [k, v] of Object.entries(rec)) {
      if (!keys.some((x) => k.toLowerCase().includes(x))) continue;
      if (typeof v === "string" && v) return v;
      if (typeof v === "number") return String(v);
    }
    return undefined;
  };
  const date = parseDate(find(["date", "time"]));
  const amountStr = find(["amount", "sum", "value", "volume"]);
  if (!date || !amountStr) return null;
  let amount = Number(amountStr.replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  const text = [find(["type"]), find(["description", "comment", "name", "reason", "kind"])].filter(Boolean).join(" ").toLowerCase();
  const type = classifyOperation(text, amount);
  if (type === "withdrawal" || type === "fee" || type === "tax") amount = -Math.abs(amount);
  else if (["deposit", "dividend", "coupon", "amortization", "repayment"].includes(type)) amount = Math.abs(amount);
  const linked = type === "dividend" || type === "coupon" || type === "amortization" || type === "repayment";
  return {
    id: "bcs:" + (find(["id", "number"]) ?? fallbackId),
    accountId, date, type,
    instrumentId: linked ? find(["ticker", "seccode", "isin"]) : undefined,
    quantity: 0, price: 0, amount, currency: normCurrency(find(["currency"])), fee: 0, source: "bcs", note: text,
  };
}

export function classifyOperation(text: string, amount: number): TxType {
  const t = text.toLowerCase();
  if ((t.includes("налог") || t.includes("ндфл") || t.includes("tax")) && !t.includes("выплата") && !t.includes("за вычетом")) return "tax";
  if (t.includes("дивиденд") || t.includes("dividend")) return "dividend";
  if (t.includes("купон") || t.includes("coupon")) return "coupon";
  if (t.includes("амортиз") || t.includes("amortiz") || t.includes("частичн")) return "amortization";
  if (t.includes("погашен") || t.includes("redemption") || t.includes("repayment")) return "repayment";
  if (t.includes("налог") || t.includes("ндфл") || t.includes("tax")) return "tax";
  if (t.includes("комисс") || t.includes("fee") || t.includes("commission") || t.includes("плата за")) return "fee";
  if (t.includes("вывод") || t.includes("withdraw") || t.includes("output") || t.includes("списание")) return "withdrawal";
  if (t.includes("пополн") || t.includes("зачисл") || t.includes("ввод") || t.includes("deposit") || t.includes("input")) return "deposit";
  return amount >= 0 ? "deposit" : "withdrawal";
}

/** БКС присылает цену облигации то в % номинала, то в рублях: процент почти всегда меньше четверти номинала. */
export const bondPriceToMoney = (v: number, face: number) => (v > 0 && v < face * 0.25 ? (v * face) / 100 : v);
