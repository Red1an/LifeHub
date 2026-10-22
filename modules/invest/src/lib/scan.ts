import { DAY, ms } from "./dates.ts";
import { num, pct, shortRub } from "./fmt.ts";
import { arr, numv, str, type J } from "./http.ts";
import { ofzYieldAt, years } from "./bonds.ts";
import { corpAll, ofzList, sharesBoard, type OfzRow } from "./moex.ts";
import { tbankSector } from "./reference.ts";
import { TBankClient } from "./tbank.ts";

/*
 * «Лучшее сейчас»: подборка по всему рынку, а не по моему портфелю.
 *
 * Акции — все бумаги основного режима Мосбиржи с нормальной ликвидностью. Мультипликаторы и дивиденды —
 * из T-Invest API (GetAssetFundamentals), цены и обороты — с MOEX. Каждая акция получает оценку 0–10
 * по четырём направлениям (процентиль среди всех: выше — лучше), итог взвешен под долгосрочное накопление:
 * дивиденды 30 %, качество бизнеса 30 %, оценка (дёшево/дорого) 25 %, рост 15 %. Тревожные признаки
 * (убыток, большой долг, выплаты больше прибыли, подозрительно высокая доходность) снижают итог.
 *
 * Облигации — ОФЗ и корпоративные с биржевой доходностью, кредитными рейтингами АКРА/Эксперт РА/НКР/НРА
 * и уровнем риска брокера; бессрочные, субординированные и только для квалифицированных — исключены.
 * В T-Invest нули обычно означают «нет данных», поэтому 0 трактуется как пропуск.
 */

export interface StockMetrics {
  pe?: number;
  pb?: number;
  evEbitda?: number;
  ndEbitda?: number;
  roe?: number;
  dy?: number;
  dy5?: number;
  payout?: number;
  rev5?: number;
  eps5?: number;
  rev1?: number;
  fcf?: number;
  cap?: number;
  high52?: number;
  low52?: number;
  beta?: number;
}

export interface StockPick {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  lot: number;
  /** Средний оборот в день, ₽. */
  liquidity: number;
  m: StockMetrics;
  scores: { div: number; quality: number; value: number; growth: number };
  total: number;
  pros: string[];
  cons: string[];
  /** Серьёзные тревожные признаки. */
  red: number;
}

export type RatingTier = 1 | 2 | 3 | 4 | 5 | 6;
export const TIER_LABEL: Record<RatingTier, [string, string]> = {
  1: ["наивысший", "inv-tag-green"],
  2: ["высокий", "inv-tag-green"],
  3: ["хороший", "inv-tag-gold"],
  4: ["средний", "inv-tag-orange"],
  5: ["низкий", "inv-tag-red"],
  6: ["очень низкий", "inv-tag-red"],
};

export type BondCategory = "ofz" | "reliable" | "higher" | "floater" | "avoid";
export const CATEGORY_INFO: Record<BondCategory, { title: string; hint: string }> = {
  ofz: { title: "ОФЗ — самые надёжные", hint: "Долг государства. Лучшая доходность в каждом сроке: до 1 года, 1–3, 3–7 и больше 7 лет." },
  reliable: { title: "Надёжные компании", hint: "Рейтинг AAA–AA-, премия к ОФЗ небольшая. Чуть больше дохода почти без лишнего риска." },
  higher: { title: "Повышенная доходность", hint: "Рейтинг A+…A-. Доходность заметно выше, но и риск выше. Держите на одну компанию не больше 3–5 % портфеля." },
  floater: { title: "Флоатеры — если ставка останется высокой", hint: "Купон пересчитывается по ставке ЦБ, цена почти не меняется. Выигрывают, если ставку долго не снижают." },
  avoid: { title: "Высокая доходность — почему осторожно", hint: "Рейтинг BBB и ниже или доходность намного выше ОФЗ: рынок опасается, что компания не расплатится. Это ставка на выживание, а не надёжный доход." },
};

export interface BondScanRow {
  secid: string;
  name: string;
  yield: number;
  end: string;
  years: number;
  price: number;
  face: number;
  couponPct?: number;
  couponsPerYear?: number;
  rating?: { agency: string; level: string };
  tier?: RatingTier;
  risk?: "low" | "moderate" | "high";
  spread: number | null;
  floating: boolean;
  amortization: boolean;
  category: BondCategory;
  why: string[];
  warn: string[];
}

export interface ScanData {
  stocks: StockPick[];
  bonds: BondScanRow[];
  updatedAt: string;
  keyRate?: number;
}

const pos = (v: number | undefined) => (v != null && Number.isFinite(v) && v !== 0 ? v : undefined);

/** Процентиль значения среди списка (0–10). invert — чем меньше, тем лучше. */
function ranker(values: (number | undefined)[], invert = false) {
  const sorted = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  return (v: number | undefined): number | undefined => {
    if (v == null || !sorted.length) return undefined;
    let lo = 0;
    while (lo < sorted.length && sorted[lo] < v) lo++;
    const p = sorted.length > 1 ? lo / (sorted.length - 1) : 0.5;
    return (invert ? 1 - p : p) * 10;
  };
}
const avg = (xs: (number | undefined)[], fallback = 5) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : fallback;
};

export function tierOf(level: string): RatingTier | undefined {
  const l = level.toUpperCase().replace(/\(.*?\)|RU|\.RU|\s/g, "");
  if (!l) return undefined;
  if (l.startsWith("AAA")) return 1;
  if (l.startsWith("AA")) return 2;
  if (l.startsWith("A")) return 3;
  if (l.startsWith("BBB")) return 4;
  if (l.startsWith("BB")) return 5;
  return 6;
}

export async function runScan(token: string, keyRate: number, progress: (s: string) => void): Promise<ScanData> {
  const tb = new TBankClient(token);
  progress("Список акций…");
  const [sharesResp, board] = await Promise.all([tb.call("InstrumentsService", "Shares", { instrumentStatus: "INSTRUMENT_STATUS_BASE" }), sharesBoard()]);
  const shares = arr(sharesResp, "instruments").filter(
    (i) => str(i, "classCode") === "TQBR" && (str(i, "currency") ?? "rub").toLowerCase() === "rub" && !i.forQualInvestorFlag && board[str(i, "ticker") ?? ""],
  );
  progress(`Мультипликаторы ${shares.length} компаний…`);
  const fund: Record<string, J> = {};
  for (let i = 0; i < shares.length; i += 100) {
    const resp = await tb.call("InstrumentsService", "GetAssetFundamentals", { assets: shares.slice(i, i + 100).map((s) => str(s, "assetUid")).filter(Boolean) });
    for (const f of arr(resp, "fundamentals")) fund[str(f, "assetUid") ?? ""] = f;
  }

  // Сырые метрики
  const raw = shares
    .map((s) => {
      const ticker = str(s, "ticker")!;
      const f = fund[str(s, "assetUid") ?? ""];
      const b = board[ticker];
      if (!f || !b) return null;
      const n = (k: string) => numv(f, k);
      let roe = pos(n("roe"));
      if (roe != null && (roe < -100 || roe > 150)) roe = undefined; // отрицательный капитал и т.п. — показатель бессмысленный
      const vol = (n("averageDailyVolumeLast4Weeks") ?? 0) * b.price;
      const m: StockMetrics = {
        pe: pos(n("peRatioTtm")), pb: pos(n("priceToBookTtm")), evEbitda: pos(n("evToEbitdaMrq")), ndEbitda: pos(n("netDebtToEbitda")), roe,
        dy: pos(n("dividendYieldDailyTtm")), dy5: pos(n("fiveYearsAverageDividendYield")), payout: pos(n("dividendPayoutRatioFy")),
        rev5: pos(n("revenueChangeFiveYears")), eps5: pos(n("epsChangeFiveYears")), rev1: pos(n("oneYearAnnualRevenueGrowthRate")),
        fcf: pos(n("freeCashFlowTtm")), cap: pos(n("marketCapitalization")), high52: pos(n("highPriceLast52Weeks")), low52: pos(n("lowPriceLast52Weeks")), beta: pos(n("beta")),
      };
      const loss = (n("netIncomeTtm") ?? 0) < 0 || (m.pe == null && (roe ?? 0) < 0);
      return { ticker, name: str(s, "name") ?? ticker, sector: tbankSector(str(s, "sector")) ?? "—", price: b.price, lot: numv(s, "lot") ?? 1, liquidity: Math.max(vol, b.volume), m, loss };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.liquidity > 20_000_000);

  // Процентили по всему списку
  const capDy = (v?: number) => (v == null ? undefined : Math.min(v, 18));
  const rDy = ranker(raw.map((x) => capDy(x.m.dy)));
  const rDy5 = ranker(raw.map((x) => capDy(x.m.dy5)));
  const rRoe = ranker(raw.map((x) => x.m.roe));
  const rNd = ranker(raw.map((x) => x.m.ndEbitda), true);
  const rPe = ranker(raw.map((x) => (x.loss ? undefined : x.m.pe)), true);
  const rPb = ranker(raw.map((x) => x.m.pb), true);
  const rEv = ranker(raw.map((x) => x.m.evEbitda), true);
  const rRev = ranker(raw.map((x) => x.m.rev5));
  const rEps = ranker(raw.map((x) => x.m.eps5));
  const rRev1 = ranker(raw.map((x) => x.m.rev1));
  const k = keyRate;

  const stocks: StockPick[] = raw.map((x) => {
    const m = x.m;
    const pros: string[] = [];
    const cons: string[] = [];
    let red = 0;
    const payoutScore = m.payout == null ? undefined : m.payout > 100 ? 2 : m.payout >= 25 ? 9 : 6;
    const div = m.dy == null && m.dy5 == null ? 0 : avg([rDy(capDy(m.dy) ?? 0), rDy5(capDy(m.dy5)), payoutScore]);
    const quality = avg([rRoe(m.roe), rNd(m.ndEbitda), m.fcf == null ? undefined : m.fcf > 0 ? 8 : 2, x.loss ? 0 : undefined]);
    const value = x.loss ? Math.min(3, avg([rPb(m.pb), rEv(m.evEbitda)], 3)) : avg([rPe(m.pe), rPb(m.pb), rEv(m.evEbitda)]);
    const growth = avg([rRev(m.rev5), rEps(m.eps5), rRev1(m.rev1)]);

    if (m.dy != null && m.dy >= k) pros.push(`дивиденды ${num(m.dy, 1)} % за год — не ниже ключевой ставки`);
    else if (m.dy != null && m.dy >= 6) pros.push(`дивиденды ${num(m.dy, 1)} % за год`);
    if (m.dy5 != null && m.dy5 >= 8) pros.push(`в среднем ${num(m.dy5, 1)} % дивидендов за 5 лет`);
    if (m.roe != null && m.roe >= 20) pros.push(`высокая рентабельность капитала: ${num(m.roe, 0)} %`);
    if (m.pe != null && !x.loss && m.pe < 6) pros.push(`дёшево: P/E ${num(m.pe, 1)} (окупаемость ~${Math.round(m.pe)} лет прибыли)`);
    if (m.ndEbitda != null && m.ndEbitda < 1) pros.push("долг небольшой (чистый долг < 1 EBITDA)");
    if (m.rev5 != null && m.rev5 > 15) pros.push(`выручка растёт: +${num(m.rev5, 0)} % за 5 лет`);
    if (m.fcf != null && m.fcf > 0 && m.cap) pros.push(`свободный денежный поток ${pct(m.fcf / m.cap, { digits: 0 })} от капитализации`);

    if (x.loss) {
      cons.push("компания в убытке за последний год");
      red++;
    }
    if (m.ndEbitda != null && m.ndEbitda > 3.5) {
      cons.push(`большой долг: чистый долг ${num(m.ndEbitda, 1)} EBITDA`);
      red++;
    }
    if (m.payout != null && m.payout > 100) {
      cons.push(`платит дивидендами больше прибыли (${num(m.payout, 0)} %) — долго так не бывает`);
      red++;
    }
    if (m.dy != null && m.dy > 18) cons.push(`доходность ${num(m.dy, 0)} % подозрительно высокая — возможно, разовая выплата`);
    if (m.fcf != null && m.fcf < 0) cons.push("отрицательный свободный денежный поток — тратит больше, чем зарабатывает");
    if (m.eps5 != null && m.eps5 < -10) cons.push(`прибыль на акцию падает: ${num(m.eps5, 0)} % за 5 лет`);
    if (m.dy == null && m.dy5 == null) cons.push("не платит дивиденды");
    if (m.pe != null && m.pe > 25) cons.push(`дорого: P/E ${num(m.pe, 0)}`);
    if (m.high52 && x.price < m.high52 * 0.7) cons.push(`цена на ${pct(1 - x.price / m.high52, { digits: 0 })} ниже максимума за год — выясните почему`);

    const total = Math.max(0, div * 0.3 + quality * 0.3 + value * 0.25 + growth * 0.15 - red * 1.2);
    return { ticker: x.ticker, name: x.name, sector: x.sector, price: x.price, lot: x.lot, liquidity: x.liquidity, m, scores: { div, quality, value, growth }, total, pros, cons, red };
  });
  stocks.sort((a, b) => b.total - a.total);

  // Облигации
  progress("Облигации: рейтинги и доходности…");
  const [bondsResp, ofz, corp] = await Promise.all([tb.call("InstrumentsService", "Bonds", { instrumentStatus: "INSTRUMENT_STATUS_BASE" }), ofzList(), corpAll()]);
  const info = new Map<string, J>();
  for (const b of arr(bondsResp, "instruments")) {
    const t = str(b, "ticker");
    if (t) info.set(t, b);
  }
  const bonds: BondScanRow[] = [];
  for (const b of [...ofz, ...corp]) bonds.push(...rateBond(b, info.get(b.secid), ofz));
  return { stocks, bonds, updatedAt: new Date().toISOString(), keyRate };
}

function rateBond(b: OfzRow, ti: J | undefined, ofz: OfzRow[]): BondScanRow[] {
  const gov = b.secid.startsWith("SU");
  if (ti && (ti.forQualInvestorFlag || ti.perpetualFlag || ti.subordinatedFlag)) return [];
  if (!gov && !ti) return []; // без данных брокера о бумаге не советуем
  const floating = (b.kind ?? (b.secid.startsWith("SU29") ? "floater" : "fixed")) === "floater" || !!ti?.floatingCouponFlag;
  const linker = b.secid.startsWith("SU52") || b.kind === "linker";
  if (linker) return [];
  const end = b.offerDate && ms(b.offerDate) > Date.now() && ms(b.offerDate) < ms(b.matDate) ? b.offerDate : b.matDate;
  const y = years(end);
  if (y < 0.15) return [];
  const ratings = (Array.isArray(ti?.ratings) ? (ti!.ratings as J[]) : []).map((r) => ({ agency: str(r, "agencyName") ?? "", level: str(r, "ratingLevel") ?? "" })).filter((r) => r.level);
  const tiers = ratings.map((r) => ({ r, t: tierOf(r.level) })).filter((x) => x.t != null) as { r: { agency: string; level: string }; t: RatingTier }[];
  const worst = tiers.sort((a, c) => c.t - a.t)[0];
  const riskRaw = str(ti, "riskLevel") ?? "";
  const risk = riskRaw.includes("LOW") ? "low" : riskRaw.includes("MODERATE") ? "moderate" : riskRaw.includes("HIGH") ? "high" : undefined;
  const base = ofzYieldAt(ofz, y);
  const spread = !gov && !floating && base != null ? b.yield - base : null;

  let category: BondCategory;
  if (gov) category = floating ? "floater" : "ofz";
  else if (!worst) return [];
  else if (worst.t >= 4 || (spread != null && spread > 0.06)) category = "avoid";
  else if (floating) category = worst.t <= 2 ? "floater" : "avoid";
  else if (worst.t <= 2 && (spread == null || spread <= 0.03)) category = "reliable";
  else if (worst.t <= 3 && (spread == null || spread <= 0.05)) category = "higher";
  else category = "avoid";

  const why: string[] = [];
  const warn: string[] = [];
  if (gov) why.push("гарантия государства");
  if (worst) why.push(`рейтинг ${worst.r.level} (${worst.r.agency})`);
  if (!floating) why.push(`доходность ${pct(b.yield)} в год, если держать до ${end === b.matDate ? "погашения" : "оферты"}`);
  else why.push(`купон сейчас ${b.couponPct ? pct(b.couponPct) : "≈ ключевая ставка"} и меняется вместе со ставкой ЦБ`);
  if (spread != null) (spread <= 0.03 ? why : warn).push(`на ${num(spread * 100, 1)} п.п. выше ОФЗ того же срока`);
  if (ti?.amortizationFlag) warn.push("амортизация: номинал возвращается частями до погашения");
  if (end !== b.matDate) warn.push(`оферта ${new Date(ms(end)).toLocaleDateString("ru-RU")}: компания может выкупить облигации или поменять купон`);
  if (risk === "high" && category !== "avoid") warn.push("брокер относит к высокому риску");
  if (category === "avoid") warn.push(worst && worst.t >= 4 ? `рейтинг ${worst.r.level}: заметный риск дефолта` : "доходность намного выше ОФЗ — рынок опасается дефолта");
  const cpy = numv(ti, "couponQuantityPerYear");
  return [
    {
      secid: b.secid, name: b.name, yield: b.yield, end, years: y, price: b.price, face: b.face, couponPct: b.couponPct, couponsPerYear: cpy,
      rating: worst?.r, tier: worst?.t, risk, spread, floating, amortization: !!ti?.amortizationFlag, category, why, warn,
    },
  ];
}

/** Лучшие облигации в каждой категории. */
export function bestBonds(rows: BondScanRow[]): Record<BondCategory, BondScanRow[]> {
  const out: Record<BondCategory, BondScanRow[]> = { ofz: [], reliable: [], higher: [], floater: [], avoid: [] };
  const ofz = rows.filter((r) => r.category === "ofz");
  for (const [a, b] of [[0, 1], [1, 3], [3, 7], [7, 30]] as const) {
    const best = ofz.filter((r) => r.years > a && r.years <= b).sort((x, y) => y.yield - x.yield)[0];
    if (best) out.ofz.push(best);
  }
  const issuer = (n: string) => n.split(/[\s-]/)[0];
  const pickUnique = (list: BondScanRow[], n: number) => {
    const seen = new Set<string>();
    const res: BondScanRow[] = [];
    for (const r of list) {
      if (seen.has(issuer(r.name))) continue;
      seen.add(issuer(r.name));
      res.push(r);
      if (res.length >= n) break;
    }
    return res;
  };
  // Обычные облигации выше ипотечных и прочих с амортизацией: для накопления проще, когда номинал возвращается в конце
  out.reliable = pickUnique(rows.filter((r) => r.category === "reliable").sort((a, b) => Number(a.amortization) - Number(b.amortization) || b.yield - a.yield), 6);
  out.higher = pickUnique(rows.filter((r) => r.category === "higher").sort((a, b) => b.yield - a.yield), 5);
  out.floater = pickUnique(rows.filter((r) => r.category === "floater").sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (b.couponPct ?? 0) - (a.couponPct ?? 0)), 4);
  out.avoid = pickUnique(rows.filter((r) => r.category === "avoid").sort((a, b) => b.yield - a.yield), 6);
  return out;
}

export const scanAge = (d?: ScanData | null) => (d ? (Date.now() - ms(d.updatedAt)) / DAY : Infinity);
export const fmtCap = (v?: number) => (v ? shortRub(v) : "—");
