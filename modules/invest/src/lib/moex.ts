import { addDays, day, ms } from "./dates.ts";
import { getJSON, getText, numv, str, type J } from "./http.ts";
import { normCurrency, type AssetType, type PayEvent, type PricePoint } from "./types.ts";

/*
 * Публичный ISS API Московской биржи — без токена: котировки, недельная история, купоны и погашения,
 * индексы, тикер ↔ ISIN, доходности ОФЗ. Плюс ЦБ: курсы валют и ключевая ставка.
 */

const BASE = "https://iss.moex.com/iss/";

async function tables(path: string, query: Record<string, string> = {}): Promise<Record<string, J[]>> {
  const q = new URLSearchParams({ "iss.meta": "off", ...query });
  const root = await getJSON<J>(`${BASE}${path}?${q}`);
  const out: Record<string, J[]> = {};
  for (const [name, t] of Object.entries(root ?? {})) {
    if (!t || !Array.isArray(t.columns) || !Array.isArray(t.data)) continue;
    const cols = (t.columns as string[]).map((c) => c.toLowerCase());
    out[name] = (t.data as unknown[][]).map((row) => {
      const d: J = {};
      cols.forEach((c, i) => {
        if (row[i] !== null) d[c] = row[i];
      });
      return d;
    });
  }
  return out;
}

export interface SecurityInfo {
  secid: string;
  isin?: string;
  name: string;
  shortName: string;
  group: string;
  board?: string;
  market: string;
  faceValue?: number;
  faceUnit?: string;
  matDate?: string;
  assetType: AssetType;
}

function assetTypeOf(group: string): AssetType {
  if (group.includes("bond")) return "bond";
  if (group.includes("etf") || group.includes("ppif")) return "etf";
  if (group.includes("currency")) return "currency";
  if (group.includes("futures")) return "futures";
  if (group.includes("share") || group.includes("dr")) return "share";
  return "other";
}

async function describe(secid: string): Promise<{ info: SecurityInfo; traded: boolean } | null> {
  const t = await tables(`securities/${encodeURIComponent(secid)}.json`, { "iss.only": "description,boards" });
  const desc: Record<string, string> = {};
  for (const r of t.description ?? []) if (r.name && r.value != null && !(r.name in desc)) desc[r.name] = String(r.value);
  if (!Object.keys(desc).length) return null;
  const boards = t.boards ?? [];
  const traded = (b: J) => b.is_traded === 1;
  const primary =
    boards.find((b) => b.is_primary === 1 && traded(b)) ??
    boards.find((b) => traded(b) && ["shares", "bonds"].includes(b.market)) ??
    boards.find((b) => b.is_primary === 1) ??
    boards[0];
  const group = desc.GROUP ?? "";
  return {
    info: {
      secid: desc.SECID ?? secid,
      isin: desc.ISIN,
      name: desc.NAME ?? desc.SHORTNAME ?? secid,
      shortName: desc.SHORTNAME ?? secid,
      group,
      board: primary?.boardid,
      market: primary?.market ?? "shares",
      faceValue: desc.FACEVALUE ? Number(desc.FACEVALUE) : undefined,
      faceUnit: desc.FACEUNIT,
      matDate: desc.MATDATE,
      assetType: assetTypeOf(group),
    },
    traded: boards.some(traded),
  };
}

/** Тикер (SECID) или ISIN → описание бумаги. */
export async function resolveSecurity(query: string): Promise<SecurityInfo | null> {
  const q = query.trim().toUpperCase();
  if (!q) return null;
  const direct = await describe(q).catch(() => null);
  if (direct?.traded) return direct.info;
  const t = await tables("securities.json", { q, "securities.columns": "secid,isin,is_traded,group", limit: "20" });
  const rows = (t.securities ?? []).filter((r) => String(r.isin ?? "").toUpperCase() === q || String(r.secid ?? "").toUpperCase() === q);
  const best = rows.find((r) => r.is_traded === 1) ?? rows[0];
  if (!best?.secid || best.secid === q) return direct?.info ?? null;
  return (await describe(best.secid).catch(() => null))?.info ?? direct?.info ?? null;
}

export interface Quote {
  secid: string;
  price: number;
  prevClose?: number;
  accrued?: number;
  faceValue?: number;
  currency: string;
  shortName?: string;
  lot?: number;
}

const PREFERRED_BOARDS = ["TQBR", "TQTF", "TQOB", "TQCB", "TQIR", "TQPI", "TQTD", "TQIF", "TQRD", "TQOD", "TQOE", "TQOY", "TQBD", "TQTE"];

/** Текущие котировки. Цена облигаций переводится из % номинала в деньги. */
export async function quotes(secids: string[], market: "shares" | "bonds"): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  for (let i = 0; i < secids.length; i += 10) {
    const chunk = secids.slice(i, i + 10);
    const t = await tables(`engines/stock/markets/${market}/securities.json`, {
      securities: chunk.join(","),
      "iss.only": "securities,marketdata",
      "securities.columns": "SECID,BOARDID,PREVPRICE,FACEVALUE,ACCRUEDINT,CURRENCYID,FACEUNIT,SHORTNAME,LOTSIZE",
      "marketdata.columns": "SECID,BOARDID,LAST,MARKETPRICE,LCURRENTPRICE",
    });
    const secs = t.securities ?? [];
    const md = t.marketdata ?? [];
    for (const secid of chunk) {
      const rows = secs.filter((r) => r.secid === secid);
      const boards = rows.map((r) => r.boardid as string);
      const board = PREFERRED_BOARDS.find((b) => boards.includes(b)) ?? boards[0];
      const s = rows.find((r) => r.boardid === board);
      if (!s) continue;
      const m = md.find((r) => r.secid === secid && r.boardid === board) ?? {};
      let price = numv(m, "last") ?? numv(m, "lcurrentprice") ?? numv(m, "marketprice") ?? numv(s, "prevprice");
      if (price == null) continue;
      let prev = numv(s, "prevprice");
      const face = numv(s, "facevalue");
      if (market === "bonds" && face) {
        price = (price * face) / 100;
        prev = prev != null ? (prev * face) / 100 : undefined;
      }
      out[secid] = {
        secid, price, prevClose: prev, accrued: numv(s, "accruedint"), faceValue: face,
        currency: normCurrency(str(s, "faceunit") ?? str(s, "currencyid")), shortName: str(s, "shortname"), lot: numv(s, "lotsize"),
      };
    }
  }
  return out;
}

/** Недельные свечи (закрытие). Для облигаций — в % от номинала. */
async function weekly(secid: string, market: string, board: string | undefined, from: number, engine = "stock"): Promise<PricePoint[]> {
  const path = board
    ? `engines/${engine}/markets/${market}/boards/${board}/securities/${encodeURIComponent(secid)}/candles.json`
    : `engines/${engine}/markets/${market}/securities/${encodeURIComponent(secid)}/candles.json`;
  const out: PricePoint[] = [];
  for (let start = 0; ; ) {
    const t = await tables(path, { from: day(from), interval: "7", start: String(start), "candles.columns": "begin,close" });
    const rows = t.candles ?? [];
    for (const r of rows) if (r.begin && r.close != null) out.push([String(r.begin).slice(0, 10), Number(r.close)]);
    if (rows.length < 500) break;
    start += rows.length;
  }
  return out;
}

/** История с учётом переезда бумаги между режимами торгов (БПИФ: TQTF → TQBR). */
export async function priceHistory(secid: string, market: string, board: string | undefined, from: number): Promise<PricePoint[]> {
  let hist = await weekly(secid, market, board, from);
  if (market === "shares" && (hist.length ? ms(hist[0][0]) : Infinity) > addDays(from, 60)) {
    for (const alt of ["TQTF", "TQBR"]) {
      if (alt === board) continue;
      const older = await weekly(secid, market, alt, from).catch(() => [] as PricePoint[]);
      const cutoff = hist.length ? ms(hist[0][0]) : Infinity;
      hist = [...older.filter((p) => ms(p[0]) < cutoff), ...hist];
    }
  }
  return hist;
}

export const indexHistory = (secid: string, from: number) => weekly(secid, "index", undefined, from);

/** Купоны, амортизации и погашение облигации. */
export async function bondSchedule(secid: string, instrumentId: string, from = addDays(Date.now(), -1)): Promise<PayEvent[]> {
  const t = await tables(`statistics/engines/stock/markets/bonds/bondization/${encodeURIComponent(secid)}.json`, {
    "iss.only": "coupons,amortizations",
    limit: "unlimited",
  });
  const now = Date.now();
  const out: PayEvent[] = [];
  for (const c of t.coupons ?? []) {
    if (!c.coupondate || ms(c.coupondate) < from || c.value == null) continue;
    out.push({
      instrumentId, kind: "coupon", recordDate: c.recorddate ?? day(addDays(c.coupondate, -1)), payDate: c.coupondate,
      perUnit: Number(c.value), currency: normCurrency(c.faceunit), status: ms(c.coupondate) < now ? "paid" : "declared",
    });
  }
  for (const a of t.amortizations ?? []) {
    if (!a.amortdate || ms(a.amortdate) < from || a.value == null) continue;
    out.push({
      instrumentId, kind: a.data_source === "maturity" ? "maturity" : "amortization", recordDate: day(addDays(a.amortdate, -1)),
      payDate: a.amortdate, perUnit: Number(a.value), currency: normCurrency(a.faceunit), status: "declared",
    });
  }
  return out;
}

/** Облигации с доходностью к погашению — для подбора «в какие облигации вложить». */
export type BondKind = "fixed" | "floater" | "linker" | "other";

export interface OfzRow {
  secid: string;
  name: string;
  matDate: string;
  /** Доходность к погашению (или к оферте), доля. Для флоатеров — ориентир по текущему купону. */
  yield: number;
  /** Дюрация, дни. */
  duration: number;
  /** Цена в % от номинала. */
  price: number;
  coupon: number;
  couponPeriod: number;
  face: number;
  /** Нет в старых сохранённых данных — тогда тип определяется по номеру выпуска (bondKind). */
  kind?: BondKind;
  couponPct?: number;
  /** Корпоративная облигация (не ОФЗ). */
  corp?: boolean;
  listLevel?: number;
  offerDate?: string;
  /** Оборот за день, ₽ — чтобы не советовать то, что сложно купить. */
  volume?: number;
  fullName?: string;
}

/** Тип облигации: по данным биржи, а для старых сохранённых данных — по номеру выпуска ОФЗ. */
export function bondKind(b: OfzRow): BondKind {
  if (b.kind) return b.kind;
  if (b.secid.startsWith("SU29")) return "floater";
  if (b.secid.startsWith("SU52")) return "linker";
  return "fixed";
}

function kindOf(type: unknown): BondKind {
  const t = String(type ?? "").toLowerCase();
  if (t.includes("плавающ")) return "floater";
  if (t.includes("линкер") || t.includes("индексир")) return "linker";
  if (t.includes("фиксир") || t.includes("дисконт") || t.includes("амортиз")) return "fixed";
  return "other";
}

async function boardBonds(board: "TQOB" | "TQCB"): Promise<OfzRow[]> {
  const t = await tables(`engines/stock/markets/bonds/boards/${board}/securities.json`, {
    "iss.only": "securities,marketdata",
    "securities.columns": "SECID,SHORTNAME,SECNAME,MATDATE,COUPONVALUE,COUPONPERIOD,COUPONPERCENT,FACEVALUE,PREVPRICE,FACEUNIT,LISTLEVEL,BONDTYPE,OFFERDATE",
    "marketdata.columns": "SECID,LAST,YIELD,DURATION,VALTODAY",
  });
  const md = new Map((t.marketdata ?? []).map((r) => [r.secid, r]));
  return (t.securities ?? [])
    .filter((s) => normCurrency(s.faceunit) === "RUB")
    .map((s) => {
      const m = md.get(s.secid) ?? {};
      return {
        secid: s.secid, name: s.shortname, fullName: s.secname, matDate: s.matdate, yield: Number(m.yield ?? 0) / 100, duration: Number(m.duration ?? 0),
        price: Number(m.last ?? s.prevprice ?? 0), coupon: Number(s.couponvalue ?? 0), couponPeriod: Number(s.couponperiod ?? 0), face: Number(s.facevalue ?? 1000),
        kind: kindOf(s.bondtype), couponPct: s.couponpercent != null ? Number(s.couponpercent) / 100 : undefined, corp: board === "TQCB",
        listLevel: s.listlevel != null ? Number(s.listlevel) : undefined, offerDate: s.offerdate || undefined, volume: Number(m.valtoday ?? 0),
      };
    })
    .filter((r) => r.matDate && r.price > 0 && ms(r.matDate) > addDays(Date.now(), 60));
}

/** ОФЗ всех видов (фиксированный купон, флоатеры, линкеры). */
export async function ofzList(): Promise<OfzRow[]> {
  return (await boardBonds("TQOB")).filter((r) => r.secid.startsWith("SU") && (r.kind !== "fixed" || r.yield > 0));
}

/** Корпоративные облигации первого уровня листинга с фиксированным купоном, которые реально торгуются. */
export async function corpList(): Promise<OfzRow[]> {
  return (await boardBonds("TQCB")).filter((r) => r.listLevel === 1 && r.kind === "fixed" && r.yield > 0 && (r.volume ?? 0) > 300_000);
}

/** Курсы ЦБ: валюта → рублей за 1 единицу. */
export async function cbrRates(): Promise<Record<string, number>> {
  const root = await getJSON<J>("https://www.cbr-xml-daily.ru/daily_json.js");
  const out: Record<string, number> = { RUB: 1 };
  for (const [code, v] of Object.entries((root?.Valute ?? {}) as Record<string, J>)) {
    if (v.Value && v.Nominal) out[code] = v.Value / v.Nominal;
  }
  return out;
}

/** Ключевая ставка ЦБ (из таблицы на cbr.ru). */
export async function keyRate(): Promise<{ rate: number; date: string } | null> {
  const html = await getText("https://www.cbr.ru/hd_base/KeyRate/");
  const m = /<td>(\d{2})\.(\d{2})\.(\d{4})<\/td>\s*<td>([\d,]+)<\/td>/.exec(html);
  if (!m) return null;
  return { rate: Number(m[4].replace(",", ".")), date: `${m[3]}-${m[2]}-${m[1]}` };
}
