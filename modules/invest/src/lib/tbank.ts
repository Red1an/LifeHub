import { addDays, addYears, ms, parseDate } from "./dates.ts";
import { HttpError, arr, pool, postJSON, quotation, str, type J } from "./http.ts";
import { tbankSector } from "./reference.ts";
import { normCurrency, type Account, type AccountKind, type AssetType, type Cash, type Instrument, type PayEvent, type Position, type Tx, type TxType } from "./types.ts";

/*
 * T-Invest API (REST-шлюз gRPC): https://developer.tbank.ru/invest/api
 * Нужен токен «только чтение» (Т-Инвестиции → Настройки → Токены T-Invest API).
 */

const HOSTS = ["https://invest-public-api.tbank.ru/rest/", "https://invest-public-api.tinkoff.ru/rest/"];
const PKG = "tinkoff.public.invest.api.contract.v1.";

export interface TBankResult {
  accounts: Account[];
  instruments: Record<string, Instrument>;
  transactions: Tx[];
  positions: Position[];
  cash: Cash[];
  events: PayEvent[];
  dividendHistory: Record<string, PayEvent[]>;
  lastPrices: Record<string, number>;
  accrued: Record<string, number>;
  log: string[];
}

export class TBankClient {
  constructor(private token: string) {}

  async call(service: string, method: string, body: J): Promise<J> {
    let last: unknown;
    for (const host of HOSTS) {
      try {
        return await postJSON<J>(host + PKG + service + "/" + method, body, { authorization: `Bearer ${this.token}` });
      } catch (e) {
        if (e instanceof HttpError) throw e; // сервер ответил — второй хост не поможет
        last = e;
      }
    }
    throw last;
  }

  async sync(progress: (s: string) => void): Promise<TBankResult> {
    const r: TBankResult = { accounts: [], instruments: {}, transactions: [], positions: [], cash: [], events: [], dividendHistory: {}, lastPrices: {}, accrued: {}, log: [] };
    progress("Т-Банк: список счетов…");
    const accs = arr(await this.call("UsersService", "GetAccounts", {}), "accounts");
    const uidTypes: Record<string, string> = {};
    const opened: Record<string, string | null> = {};
    const now = new Date().toISOString();

    for (const a of accs) {
      const id = str(a, "id");
      if (!id || (str(a, "status") ?? "").includes("CLOSED")) continue;
      const type = str(a, "type") ?? "";
      const kind: AccountKind = type.includes("IIS") ? "iis" : type.includes("INVEST_BOX") ? "other" : "broker";
      const name = str(a, "name") || (kind === "iis" ? "ИИС" : "Брокерский");
      r.accounts.push({ id: `tbank:${id}`, broker: "tbank", externalId: id, name: `Т-Банк · ${name}`, kind, included: true, lastSync: now });
      opened[id] = parseDate(str(a, "openedDate"));
    }

    for (const acc of r.accounts) {
      progress(`Т-Банк: портфель «${acc.name}»…`);
      const p = await this.call("OperationsService", "GetPortfolio", { accountId: acc.externalId, currency: "RUB" });
      for (const pos of arr(p, "positions")) {
        const itype = str(pos, "instrumentType") ?? "";
        const qty = quotation(pos.quantity) ?? Number(pos.quantity ?? 0);
        const uid = str(pos, "instrumentUid") || str(pos, "figi") || "";
        if (itype === "currency") {
          r.cash.push({ accountId: acc.id, currency: currencyFromFigi(str(pos, "figi") ?? "", str(pos, "ticker")), amount: qty });
          continue;
        }
        if (!qty || !uid) continue;
        uidTypes[uid] = itype;
        r.positions.push({
          accountId: acc.id,
          instrumentId: "uid:" + uid,
          quantity: qty,
          avgPrice: quotation(pos.averagePositionPrice) ?? 0,
          currentPrice: quotation(pos.currentPrice),
          accrued: quotation(pos.currentNkd),
        });
      }
    }

    for (const acc of r.accounts) {
      progress(`Т-Банк: операции «${acc.name}»…`);
      const from = opened[acc.externalId] ?? "2015-01-01";
      let cursor = "";
      let page = 0;
      do {
        const resp = await this.call("OperationsService", "GetOperationsByCursor", {
          accountId: acc.externalId,
          from: new Date(addDays(from, -1)).toISOString(),
          to: new Date(addDays(Date.now(), 1)).toISOString(),
          cursor,
          limit: 1000,
          state: "OPERATION_STATE_EXECUTED",
          withoutCommissions: false,
          withoutTrades: true,
          withoutOvernights: true,
        });
        for (const it of arr(resp, "items")) {
          const tx = mapOperation(it, acc.id);
          if (!tx) continue;
          if (tx.instrumentId?.startsWith("uid:")) {
            const raw = tx.instrumentId.slice(4);
            uidTypes[raw] = uidTypes[raw] ?? str(it, "instrumentType") ?? "";
          }
          r.transactions.push(tx);
        }
        cursor = resp.hasNext ? str(resp, "nextCursor") ?? "" : "";
        page++;
      } while (cursor && page < 200);
    }

    const uids = Object.keys(uidTypes);
    progress(`Т-Банк: справочник бумаг (${uids.length})…`);
    const uidToKey: Record<string, string> = {};
    await pool(uids, 4, async (uid) => {
      try {
        const inst = await this.instrument(uid, uidTypes[uid]);
        uidToKey[uid] = inst.id;
        r.instruments[inst.id] = inst;
      } catch {
        /* бумага без описания останется под uid */
      }
    });
    const key = (raw?: string) => (raw?.startsWith("uid:") ? uidToKey[raw.slice(4)] ?? raw : raw);
    r.positions = r.positions.map((p) => {
      const out = { ...p, instrumentId: key(p.instrumentId)! };
      const inst = r.instruments[out.instrumentId];
      // Защита: цена облигации в % от номинала — переводим в деньги
      if (inst?.type === "bond" && inst.nominal && out.currentPrice && out.currentPrice < inst.nominal * 0.25 && out.avgPrice > inst.nominal * 0.4) {
        out.currentPrice = (out.currentPrice * inst.nominal) / 100;
      }
      return out;
    });
    r.transactions = r.transactions.map((t) => ({ ...t, instrumentId: key(t.instrumentId) }));
    for (const p of r.positions) {
      if (p.currentPrice != null) r.lastPrices[p.instrumentId] = p.currentPrice;
      if (p.accrued != null) r.accrued[p.instrumentId] = p.accrued;
    }

    progress("Т-Банк: дивиденды и купоны…");
    const held = new Set(r.positions.map((p) => p.instrumentId));
    const insts = Object.values(r.instruments).filter((i) => held.has(i.id) && i.uid);
    await pool(insts, 4, async (inst) => {
      try {
        if (inst.type === "share" || inst.type === "etf") {
          const divs = await this.dividends(inst.uid!, inst.id, inst.currency);
          r.dividendHistory[inst.id] = divs.filter((d) => d.status === "paid");
          r.events.push(...divs.filter((d) => d.status !== "paid"));
        } else if (inst.type === "bond") {
          r.events.push(...(await this.coupons(inst.uid!, inst.id, inst.currency)));
        }
      } catch {
        /* без выплат — прогноз возьмётся из истории */
      }
    });
    r.log.push(`Т-Банк: счетов ${r.accounts.length}, позиций ${r.positions.length}, операций ${r.transactions.length}`);
    return r;
  }

  async instrument(uid: string, type: string): Promise<Instrument> {
    const method = type === "share" ? "ShareBy" : type === "bond" ? "BondBy" : type === "etf" ? "EtfBy" : "GetInstrumentBy";
    const isFigi = uid.startsWith("figi:");
    const idBody = isFigi ? { idType: "INSTRUMENT_ID_TYPE_FIGI", id: uid.slice(5) } : { idType: "INSTRUMENT_ID_TYPE_UID", id: uid };
    let resp: J;
    try {
      resp = await this.call("InstrumentsService", method, idBody);
    } catch {
      resp = await this.call("InstrumentsService", "GetInstrumentBy", idBody);
    }
    const i: J = resp.instrument ?? {};
    const isin = str(i, "isin") || undefined;
    const ticker = str(i, "ticker") ?? uid;
    const t = str(i, "instrumentType") ?? type;
    const assetType: AssetType = (["share", "bond", "etf", "currency", "futures"] as const).find((x) => x === t) ?? "other";
    return {
      id: isin ?? ticker,
      ticker,
      isin,
      figi: str(i, "figi"),
      uid: str(i, "uid") ?? (isFigi ? undefined : uid),
      name: str(i, "name") ?? ticker,
      type: assetType,
      currency: normCurrency(str(i, "currency")),
      sector: tbankSector(str(i, "sector")) ?? (assetType === "etf" ? "Фонды" : undefined),
      country: str(i, "countryOfRiskName") || undefined,
      nominal: quotation(i.nominal),
      maturityDate: parseDate(str(i, "maturityDate")) ?? undefined,
      lot: typeof i.lot === "number" ? i.lot : undefined,
      board: str(i, "classCode"),
    };
  }

  /** Поиск uid по тикеру (бумаги из БКС, ручного импорта, подбора акций). */
  async findUid(ticker: string): Promise<string | undefined> {
    const r = await this.call("InstrumentsService", "FindInstrument", { query: ticker, apiTradeAvailableFlag: false });
    const exact = arr(r, "instruments").filter((x) => (str(x, "ticker") ?? "").toUpperCase() === ticker.toUpperCase() || str(x, "isin") === ticker);
    const pref = exact.find((x) => ["TQBR", "TQTF", "TQOB", "TQCB", "TQIR"].includes(str(x, "classCode") ?? "")) ?? exact[0];
    return str(pref, "uid");
  }

  async dividends(uid: string, instrumentId: string, currency: string): Promise<PayEvent[]> {
    const resp = await this.call("InstrumentsService", "GetDividends", {
      instrumentId: uid,
      from: new Date(addYears(Date.now(), -6)).toISOString(),
      to: new Date(addYears(Date.now(), 2)).toISOString(),
    });
    const now = Date.now();
    const out: PayEvent[] = [];
    for (const d of arr(resp, "dividends")) {
      // dividendType = "Cancelled" — выплату отменили
      if ((str(d, "dividendType") ?? "").toLowerCase().includes("cancel")) continue;
      const v = quotation(d.dividendNet);
      if (!v || v <= 0) continue;
      const record = parseDate(str(d, "recordDate")) ?? parseDate(str(d, "lastBuyDate"));
      if (!record) continue;
      const pay = parseDate(str(d, "paymentDate")) ?? new Date(addDays(record, 14)).toISOString();
      out.push({
        instrumentId,
        kind: "dividend",
        recordDate: record,
        payDate: pay,
        perUnit: v,
        currency: normCurrency(str(d.dividendNet, "currency") ?? currency),
        status: ms(record) < now ? "paid" : "declared",
      });
    }
    return out;
  }

  async coupons(uid: string, instrumentId: string, currency: string): Promise<PayEvent[]> {
    const resp = await this.call("InstrumentsService", "GetBondCoupons", {
      instrumentId: uid,
      from: new Date().toISOString(),
      to: new Date(addYears(Date.now(), 3)).toISOString(),
    });
    const out: PayEvent[] = [];
    for (const e of arr(resp, "events")) {
      const pay = parseDate(str(e, "couponDate"));
      const v = quotation(e.payOneBond);
      if (!pay || !v) continue;
      out.push({
        instrumentId,
        kind: "coupon",
        recordDate: parseDate(str(e, "fixDate")) ?? new Date(addDays(pay, -1)).toISOString(),
        payDate: pay,
        perUnit: v,
        currency: normCurrency(str(e.payOneBond, "currency") ?? currency),
        status: "declared",
      });
    }
    return out;
  }
}

function mapOperation(it: J, accountId: string): Tx | null {
  const type = str(it, "type") ?? "";
  const date = parseDate(str(it, "date"));
  if (!date) return null;
  const payment = quotation(it.payment) ?? 0;
  const currency = normCurrency(str(it.payment, "currency") ?? str(it.price, "currency"));
  const qty = Number(str(it, "quantity") ?? 0) || 0;
  const price = quotation(it.price) ?? 0;
  const uid = str(it, "instrumentUid") ? "uid:" + str(it, "instrumentUid") : str(it, "figi") ? "uid:figi:" + str(it, "figi") : undefined;

  let t: TxType;
  if (type.includes("BUY") || type === "OPERATION_TYPE_INPUT_SECURITIES") t = "buy";
  else if (type.includes("SELL") || type === "OPERATION_TYPE_OUTPUT_SECURITIES") t = "sell";
  else if (type.includes("TAX")) t = "tax";
  else if (type.includes("DIVIDEND") || type === "OPERATION_TYPE_DIV_EXT") t = "dividend";
  else if (type === "OPERATION_TYPE_COUPON") t = "coupon";
  else if (type === "OPERATION_TYPE_BOND_REPAYMENT") t = "amortization";
  else if (type === "OPERATION_TYPE_BOND_REPAYMENT_FULL") t = "repayment";
  else if (type.includes("FEE") || type.includes("STAMP_DUTY")) t = "fee";
  else if (type.startsWith("OPERATION_TYPE_INPUT") || type === "OPERATION_TYPE_INP_MULTI") t = "deposit";
  else if (type.startsWith("OPERATION_TYPE_OUTPUT") || type === "OPERATION_TYPE_OUT_MULTI") t = "withdrawal";
  else t = "other";
  if (t === "other" && payment === 0) return null;
  let amount = payment;
  if ((t === "buy" || t === "sell") && qty > 0 && price > 0 && payment === 0 && !type.includes("SECURITIES")) {
    amount = (t === "buy" ? -1 : 1) * qty * price;
  }
  return {
    id: "tbank:" + (str(it, "id") ?? crypto.randomUUID()),
    accountId,
    date,
    type: t,
    instrumentId: t === "deposit" || t === "withdrawal" ? undefined : uid,
    quantity: qty,
    price,
    amount,
    currency,
    fee: 0,
    source: "tbank",
    note: str(it, "name") ?? str(it, "description"),
  };
}

function currencyFromFigi(figi: string, ticker?: string): string {
  const map: Record<string, string> = {
    RUB000UTSTOM: "RUB", BBG0013HGFT4: "USD", BBG0013HJJ31: "EUR", BBG0013HRTL0: "CNY",
    BBG0013HQ5F0: "CHF", BBG0013J7Y00: "HKD", BBG0013HG026: "TRY",
  };
  if (map[figi]) return map[figi];
  if (ticker && ticker.length >= 3) return ticker.slice(0, 3).toUpperCase();
  return "RUB";
}
