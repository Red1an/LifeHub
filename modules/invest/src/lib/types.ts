/*
 * Модель данных. Всё хранится как простой JSON (даты — ISO-строки), см. lib/store.ts.
 */

export type Broker = "tbank" | "bcs" | "manual";
export const BROKER_TITLE: Record<Broker, string> = { tbank: "Т-Банк", bcs: "БКС", manual: "Вручную" };

export type AccountKind = "broker" | "iis" | "other";
export const ACCOUNT_KIND_TITLE: Record<AccountKind, string> = { broker: "Брокерский", iis: "ИИС", other: "Прочий" };

export interface Account {
  id: string;
  broker: Broker;
  externalId: string;
  name: string;
  kind: AccountKind;
  /** Учитывать в общем портфеле. */
  included: boolean;
  lastSync?: string;
}

export type AssetType = "share" | "bond" | "etf" | "currency" | "futures" | "other";
export const ASSET_TITLE: Record<AssetType, string> = {
  share: "Акции",
  bond: "Облигации",
  etf: "Фонды",
  currency: "Валюта и кэш",
  futures: "Фьючерсы",
  other: "Прочее",
};

export interface Instrument {
  /** Ключ: ISIN, если известен, иначе тикер. По нему склеиваются позиции разных брокеров. */
  id: string;
  ticker: string;
  isin?: string;
  figi?: string;
  uid?: string;
  name: string;
  type: AssetType;
  currency: string;
  sector?: string;
  country?: string;
  nominal?: number;
  maturityDate?: string;
  lot?: number;
  board?: string;
  /** Рынок MOEX (shares/bonds); "-" — на бирже не нашли. */
  market?: string;
}

export type TxType =
  | "buy" | "sell" | "dividend" | "coupon" | "amortization" | "repayment"
  | "deposit" | "withdrawal" | "fee" | "tax" | "other";

export const TX_TITLE: Record<TxType, string> = {
  buy: "Покупка",
  sell: "Продажа",
  dividend: "Дивиденды",
  coupon: "Купон",
  amortization: "Амортизация",
  repayment: "Погашение",
  deposit: "Пополнение",
  withdrawal: "Вывод",
  fee: "Комиссия",
  tax: "Налог",
  other: "Прочее",
};

export const isIncomeType = (t: TxType) => t === "dividend" || t === "coupon";

export interface Tx {
  id: string;
  accountId: string;
  /** ISO-дата или дата-время. */
  date: string;
  type: TxType;
  instrumentId?: string;
  quantity: number;
  price: number;
  /** Денежный поток со знаком (в валюте currency), без учёта fee. */
  amount: number;
  currency: string;
  /** Удержанная комиссия или налог по операции (положительное число). */
  fee: number;
  source: string;
  note?: string;
}

/** Снимок позиции из API брокера. */
export interface Position {
  accountId: string;
  instrumentId: string;
  quantity: number;
  avgPrice: number;
  currentPrice?: number;
  accrued?: number;
}

export interface Cash {
  accountId: string;
  currency: string;
  amount: number;
}

export type PaymentKind = "dividend" | "coupon" | "amortization" | "maturity";
export const PAYMENT_TITLE: Record<PaymentKind, string> = {
  dividend: "Дивиденды",
  coupon: "Купон",
  amortization: "Амортизация",
  maturity: "Погашение",
};

export type PaymentStatus = "paid" | "declared" | "forecast";
export const STATUS_TITLE: Record<PaymentStatus, string> = { paid: "Выплачено", declared: "Объявлено", forecast: "Прогноз" };

export interface PayEvent {
  instrumentId: string;
  kind: PaymentKind;
  recordDate: string;
  payDate: string;
  perUnit: number;
  currency: string;
  status: PaymentStatus;
}

export const eventId = (e: PayEvent) => `${e.instrumentId}|${e.kind}|${e.recordDate.slice(0, 10)}`;

/** Цена закрытия недели: [день "YYYY-MM-DD", цена]. Для облигаций — в % от номинала. */
export type PricePoint = [string, number];

export interface Portfolio {
  accounts: Account[];
  instruments: Record<string, Instrument>;
  transactions: Tx[];
  positions: Position[];
  cash: Cash[];
  /** Объявленные будущие выплаты (из API или расписания купонов MOEX). */
  events: PayEvent[];
  /** История дивидендов на одну акцию (для прогноза), ключ — id инструмента. */
  dividendHistory: Record<string, PayEvent[]>;
  /** Последняя цена одной бумаги в валюте инструмента (облигации — в деньгах). */
  lastPrices: Record<string, number>;
  prevClose: Record<string, number>;
  accrued: Record<string, number>;
  fx: Record<string, number>;
  isDemo?: boolean;
  updatedAt?: string;
}

export const emptyPortfolio = (): Portfolio => ({
  accounts: [],
  instruments: {},
  transactions: [],
  positions: [],
  cash: [],
  events: [],
  dividendHistory: {},
  lastPrices: {},
  prevClose: {},
  accrued: {},
  fx: { RUB: 1 },
});

/** Недельные цены и индексы — отдельным ключом: они большие и меняются реже. */
export interface Market {
  prices: Record<string, PricePoint[]>;
  benchmarks: Record<string, PricePoint[]>;
  /** Ключевая ставка ЦБ, %. */
  keyRate?: number;
  keyRateDate?: string;
  updatedAt?: string;
}

export const emptyMarket = (): Market => ({ prices: {}, benchmarks: {} });

export interface Snapshot {
  date: string;
  value: number;
  invested: number;
}

export type RiskProfile = "careful" | "balanced" | "bold";

export interface Settings {
  tbankToken: string;
  bcsRefreshToken: string;
  bcsAccountName: string;
  /** Целевые доли для ребалансировки (ключ — id инструмента или "type:<тип>"). */
  targets: Record<string, number>;
  rebalanceByClass: boolean;
  riskFreeRate: number;
  taxRate: number;
  goalMonthlyIncome: number;
  goalMonthlyContribution: number;
  goalCapitalGrowth: number;
  /** Доходность для цели вручную; null — как у портфеля. */
  goalYieldOverride: number | null;
  goalInflation: number;
  goalReinvest: boolean;
  /** all | iis | broker:<b> | account:<id> */
  scope: string;
  benchmark: string;
  risk: RiskProfile;
  /** Ставка, если ЦБ недоступен. */
  keyRateFallback: number;
  /** Расходы семьи в месяц — для подушки безопасности и «доход покрывает N % расходов». 0 — не задано. */
  monthlyExpenses: number;
}

/** Сбережения вне брокерских счетов: вклады, наличные, недвижимость (как внебиржевые активы в Snowball). */
export type OtherKind = "deposit" | "cash" | "realty" | "other";
export const OTHER_TITLE: Record<OtherKind, string> = { deposit: "Вклад / накопительный счёт", cash: "Наличные / карта", realty: "Недвижимость", other: "Другое" };
export interface OtherAsset {
  id: string;
  name: string;
  kind: OtherKind;
  amount: number;
  /** Ставка вклада, % годовых. */
  rate?: number;
}

/** Список наблюдения: бумага, которую хочется купить по своей цене. */
export interface WatchItem {
  ticker: string;
  name: string;
  market: "shares" | "bonds";
  target?: number;
  note?: string;
  price?: number;
  priceAt?: string;
  addedAt: string;
  addedPrice?: number;
}

export const defaultSettings = (): Settings => ({
  tbankToken: "",
  bcsRefreshToken: "",
  bcsAccountName: "БКС · Брокерский",
  targets: {},
  rebalanceByClass: true,
  riskFreeRate: 14,
  taxRate: 13,
  goalMonthlyIncome: 50_000,
  goalMonthlyContribution: 30_000,
  goalCapitalGrowth: 5,
  goalYieldOverride: null,
  goalInflation: 6,
  goalReinvest: true,
  scope: "all",
  benchmark: "MCFTR",
  risk: "balanced",
  keyRateFallback: 14,
  monthlyExpenses: 0,
});

export function normCurrency(c?: string | null): string {
  const u = (c ?? "RUB").toUpperCase();
  return u === "SUR" || u === "RUR" || !u ? "RUB" : u;
}

export function currencySymbol(c: string): string {
  switch (c.toUpperCase()) {
    case "RUB":
    case "SUR":
    case "RUR":
      return "₽";
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "CNY":
      return "¥";
    default:
      return c;
  }
}
