import { kv, useStore } from "@lifehub/sdk";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { buildActions, type Action } from "./actions.ts";
import { adviceMap, type Advice } from "./advice.ts";
import { build, type Report } from "./analytics.ts";
import { buildHealth, type Health } from "./health.ts";
import { buildIncome, type Income } from "./income.ts";
import { buildMistakes, type Mistakes } from "./mistakes.ts";
import { monthSummary, type MonthSummary } from "./monthly.ts";
import type { OfzRow } from "./moex.ts";
import type { ScreenerData } from "./screener.ts";
import { KEYS } from "./sync.ts";
import { buildTax, type TaxYear } from "./tax.ts";
import { defaultSettings, emptyMarket, emptyPortfolio, type Market, type OtherAsset, type Portfolio, type Settings, type Snapshot, type WatchItem } from "./types.ts";

/*
 * Данные модуля (useStore — хранится в хабе и синхронизируется между устройствами):
 *   portfolio  — счета, бумаги, операции, позиции, выплаты (Portfolio)
 *   market     — недельные цены, индексы, ключевая ставка (Market)
 *   settings   — токены, налог, цели, профиль риска (Settings)
 *   snapshots  — ежедневная стоимость портфеля
 *   screener   — подбор акций (ScreenerData), bonds — ОФЗ с доходностями
 *   visit      — время прошлого визита (для «с прошлого визита пришло…»)
 *   log        — журнал обновлений
 *   assets     — сбережения вне брокеров (OtherAsset[]), watchlist — список наблюдения (WatchItem[])
 *   done       — отмеченные «сделано» действия: id → время
 * Коллекция reviews — сохранённые разборы нейронки.
 */

const EMPTY_P = emptyPortfolio();
const EMPTY_M = emptyMarket();
const EMPTY_S: Partial<Settings> = {};
const EMPTY_SNAPS: Snapshot[] = [];
const EMPTY_OTHER: OtherAsset[] = [];
const EMPTY_WATCH: WatchItem[] = [];

export interface BondsData {
  rows: OfzRow[];
  /** Корпоративные облигации (нет в данных, загруженных до версии 1.1). */
  corp?: OfzRow[];
  updatedAt: string;
}

interface Ctx {
  loading: boolean;
  portfolio: Portfolio;
  market: Market;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  report: Report;
  income: Income;
  health: Health;
  mistakes: Mistakes;
  screener: ScreenerData | null;
  bonds: BondsData | null;
  keyRate: number;
  hasData: boolean;
  previousVisit: number | null;
  tax: TaxYear;
  advice: Map<string, Advice>;
  actions: Action[];
  other: OtherAsset[];
  setOther: (next: OtherAsset[]) => void;
  watch: WatchItem[];
  setWatch: (next: WatchItem[] | ((prev: WatchItem[]) => WatchItem[])) => void;
  done: Record<string, number>;
  setDone: (next: Record<string, number>) => void;
  lastMonth: MonthSummary | null;
  thisMonth: MonthSummary | null;
}

const InvestContext = createContext<Ctx | null>(null);

let visitMarked = false;

export function InvestProvider({ children }: { children: ReactNode }) {
  const [portfolio, , pl] = useStore<Portfolio>(KEYS.portfolio, EMPTY_P);
  const [market, , ml] = useStore<Market>(KEYS.market, EMPTY_M);
  const [raw, setRaw, sl] = useStore<Partial<Settings>>(KEYS.settings, EMPTY_S);
  const [snapshots] = useStore<Snapshot[]>(KEYS.snapshots, EMPTY_SNAPS);
  const [screener] = useStore<ScreenerData | null>("screener", null);
  const [bonds] = useStore<BondsData | null>("bonds", null);
  const [visit, setVisit, vl] = useStore<{ last?: number; prev?: number }>("visit", {});
  const [other, setOther] = useStore<OtherAsset[]>("assets", EMPTY_OTHER);
  const [watch, setWatch] = useStore<WatchItem[]>("watchlist", EMPTY_WATCH);
  const [done, setDone] = useStore<Record<string, number>>("done", {});

  // Прошлый визит фиксируется один раз за сессию; повторные заходы в течение часа его не сдвигают
  useEffect(() => {
    if (vl.loading || visitMarked) return;
    visitMarked = true;
    const now = Date.now();
    if (!visit.last || now - visit.last > 3_600_000) setVisit({ prev: visit.last, last: now });
  }, [vl.loading, visit.last, setVisit]);

  const settings = useMemo(() => ({ ...defaultSettings(), ...raw, targets: { ...(raw.targets ?? {}) } }), [raw]);
  const setSettings = useCallback((patch: Partial<Settings>) => setRaw((prev) => ({ ...defaultSettings(), ...prev, ...patch })), [setRaw]);
  const p = useMemo(() => ({ ...emptyPortfolio(), ...portfolio }), [portfolio]);
  const m = useMemo(() => ({ ...emptyMarket(), ...market }), [market]);
  const keyRate = m.keyRate ?? settings.keyRateFallback;

  const report = useMemo(() => build(p, m, settings, snapshots), [p, m, settings.scope, settings.taxRate, snapshots]);
  const previousVisit = visit.prev ?? null;
  const income = useMemo(() => buildIncome(p, report, settings, previousVisit), [p, report, settings.taxRate, previousVisit]);
  const health = useMemo(() => buildHealth(p, report, income, m, settings), [p, report, income, m, settings]);
  const mistakes = useMemo(() => buildMistakes(p, m, report, settings), [p, m, report, settings.taxRate, settings.benchmark, settings.riskFreeRate]);

  const tax = useMemo(() => buildTax(p, report, mistakes, settings), [p, report, mistakes, settings]);
  const advice = useMemo(
    () => adviceMap({ p, market: m, r: report, settings, screener: screener?.rows ?? [], bonds: bonds?.rows ?? [], corp: bonds?.corp ?? [], keyRate }),
    [p, m, report, settings, screener, bonds, keyRate],
  );
  const actions = useMemo(
    () => buildActions({ p, r: report, inc: income, health, mistakes, tax, advice, settings, other, watch, keyRate }),
    [p, report, income, health, mistakes, tax, advice, settings, other, watch, keyRate],
  );
  const lastMonth = useMemo(() => monthSummary(p, m, report, -1), [p, m, report]);
  const thisMonth = useMemo(() => monthSummary(p, m, report, 0), [p, m, report]);

  const value: Ctx = {
    loading: pl.loading || ml.loading || sl.loading,
    portfolio: p,
    market: m,
    settings,
    setSettings,
    report,
    income,
    health,
    mistakes,
    screener,
    bonds,
    keyRate,
    hasData: p.accounts.length > 0,
    previousVisit,
    tax,
    advice,
    actions,
    other,
    setOther,
    watch,
    setWatch,
    done,
    setDone,
    lastMonth,
    thisMonth,
  };
  return <InvestContext.Provider value={value}>{children}</InvestContext.Provider>;
}

export function useInvest(): Ctx {
  const c = useContext(InvestContext);
  if (!c) throw new Error("useInvest вне InvestProvider");
  return c;
}

export async function saveScreener(d: ScreenerData) {
  await kv.set("screener", d);
}
export async function saveBonds(d: BondsData) {
  await kv.set("bonds", d);
}
