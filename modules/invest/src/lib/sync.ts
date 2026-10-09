import { kv } from "@lifehub/sdk";
import { useSyncExternalStore } from "react";
import { build } from "./analytics.ts";
import { syncBcs } from "./bcs.ts";
import { addDays, addYears, day, ms, startOfDayMs } from "./dates.ts";
import { errorText, pool } from "./http.ts";
import { generateDemo } from "./demo.ts";
import { importFile } from "./importers.ts";
import { bondSchedule, cbrRates, corpList, ofzList, indexHistory, keyRate, priceHistory, quotes, resolveSecurity } from "./moex.ts";
import { referenceDividends, sectorFor } from "./reference.ts";
import { TBankClient } from "./tbank.ts";
import { defaultSettings, emptyMarket, emptyPortfolio, type Instrument, type Market, type PayEvent, type Portfolio, type Settings, type Snapshot } from "./types.ts";

/*
 * Синхронизация со счетами и биржей. Работает в браузере (и на телефоне), запросы идут через хаб.
 * Состояние «идёт обновление» живёт в модуле, а не в компоненте: можно уходить со страницы.
 */

export const KEYS = { portfolio: "portfolio", market: "market", settings: "settings", snapshots: "snapshots", log: "log" } as const;

/* ── состояние фоновой работы ── */

interface RunState {
  busy: boolean;
  status: string;
}
let run: RunState = { busy: false, status: "" };
const listeners = new Set<() => void>();
function setRun(next: Partial<RunState>) {
  run = { ...run, ...next };
  listeners.forEach((l) => l());
}
export function useRun(): RunState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => run,
  );
}

async function note(lines: string[]) {
  if (!lines.length) return;
  const stamp = new Date().toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const log = await kv.get<string[]>(KEYS.log, []);
  await kv.set(KEYS.log, [...lines.map((l) => `${stamp} — ${l}`), ...log].slice(0, 150));
}

async function loadState() {
  const [portfolio, market, settings, snapshots] = await Promise.all([
    kv.get<Portfolio>(KEYS.portfolio, emptyPortfolio()),
    kv.get<Market>(KEYS.market, emptyMarket()),
    kv.get<Partial<Settings>>(KEYS.settings, {}),
    kv.get<Snapshot[]>(KEYS.snapshots, []),
  ]);
  return { p: { ...emptyPortfolio(), ...portfolio }, m: { ...emptyMarket(), ...market }, s: { ...defaultSettings(), ...settings }, snaps: snapshots };
}

/** Обёртка: одна задача за раз, ошибки — в журнал. */
async function task(title: string, body: (progress: (s: string) => void, log: string[]) => Promise<void>): Promise<boolean> {
  if (run.busy) return false;
  setRun({ busy: true, status: title });
  const log: string[] = [];
  let ok = true;
  try {
    await body((s) => setRun({ status: s }), log);
  } catch (e) {
    ok = false;
    log.push(`Ошибка: ${errorText(e)}`);
  } finally {
    await note(log).catch(() => {});
    setRun({ busy: false, status: "" });
  }
  return ok;
}

/* ── полное обновление ── */

export function syncAll(): Promise<boolean> {
  return task("Обновление…", async (progress, log) => {
    let { p, m, s, snaps } = await loadState();
    const tbankToken = s.tbankToken.trim();
    const bcsToken = s.bcsRefreshToken.trim();
    if (tbankToken) {
      try {
        p = await syncTBank(p, tbankToken, progress, log);
      } catch (e) {
        log.push(`Т-Банк: ${errorText(e)}`);
      }
    }
    if (bcsToken) {
      try {
        const res = await syncBcsInto(p, s, bcsToken, progress, log);
        p = res.p;
        if (res.newToken && res.newToken !== bcsToken) {
          s = { ...s, bcsRefreshToken: res.newToken };
          await kv.set(KEYS.settings, s);
        }
      } catch (e) {
        log.push(`БКС: ${errorText(e)}`);
      }
    }
    if (!tbankToken && !bcsToken) log.push("Токены не заданы — обновляю только котировки");
    await kv.set(KEYS.portfolio, p);
    ({ p, m, snaps } = await refreshMarketData(p, m, s, snaps, progress, log));
    await Promise.all([kv.set(KEYS.portfolio, p), kv.set(KEYS.market, m), kv.set(KEYS.snapshots, snaps)]);
  });
}

export function refreshMarket(): Promise<boolean> {
  return task("Обновление котировок…", async (progress, log) => {
    const st = await loadState();
    const { p, m, snaps } = await refreshMarketData(st.p, st.m, st.s, st.snaps, progress, log);
    await Promise.all([kv.set(KEYS.portfolio, p), kv.set(KEYS.market, m), kv.set(KEYS.snapshots, snaps)]);
  });
}

function dropDemo(p: Portfolio, log: string[]): Portfolio {
  if (!p.isDemo) return p;
  log.push("Демо-данные удалены — подключены реальные счета");
  return emptyPortfolio();
}

async function syncTBank(p0: Portfolio, token: string, progress: (s: string) => void, log: string[]): Promise<Portfolio> {
  const r = await new TBankClient(token).sync(progress);
  let p = dropDemo(p0, log);
  p = structuredClone(p);
  const ids = new Set(r.accounts.map((a) => a.id));
  const old = Object.fromEntries(p.accounts.map((a) => [a.id, a]));
  p.accounts = p.accounts.filter((a) => a.broker !== "tbank");
  for (const a of r.accounts) p.accounts.push(old[a.id] ? { ...a, included: old[a.id].included, name: old[a.id].name || a.name } : a);
  p.positions = p.positions.filter((x) => !ids.has(x.accountId) && !x.accountId.startsWith("tbank:")).concat(r.positions);
  p.cash = p.cash.filter((x) => !x.accountId.startsWith("tbank:")).concat(r.cash);
  p.transactions = p.transactions.filter((t) => t.source !== "tbank").concat(r.transactions);
  for (const [k, inst] of Object.entries(r.instruments)) {
    const ex = p.instruments[k];
    p.instruments[k] = ex ? { ...inst, market: ex.market, board: ex.board ?? inst.board } : inst;
  }
  const tb = new Set(Object.keys(r.instruments));
  p.events = p.events.filter((e) => !(tb.has(e.instrumentId) && e.kind === "dividend")).concat(r.events);
  Object.assign(p.dividendHistory, r.dividendHistory);
  Object.assign(p.lastPrices, r.lastPrices);
  Object.assign(p.accrued, r.accrued);
  log.push(...r.log);
  return p;
}

async function syncBcsInto(p0: Portfolio, s: Settings, token: string, progress: (s: string) => void, log: string[]) {
  const r = await syncBcs(token, s.bcsAccountName, progress);
  const p = structuredClone(dropDemo(p0, log));
  const old = p.accounts.find((a) => a.id === r.account.id);
  p.accounts = p.accounts.filter((a) => a.id !== r.account.id);
  p.accounts.push(old ? { ...r.account, included: old.included, name: old.name } : r.account);
  p.positions = p.positions.filter((x) => x.accountId !== r.account.id).concat(r.positions);
  p.cash = p.cash.filter((x) => x.accountId !== r.account.id).concat(r.cash);
  p.transactions = p.transactions.filter((t) => t.source !== "bcs").concat(r.transactions);
  for (const [ticker, info] of Object.entries(r.tickers)) {
    if (p.instruments[ticker]) continue;
    p.instruments[ticker] = { id: ticker, ticker, name: info.name, type: info.type, currency: info.currency, sector: sectorFor(ticker, info.type), nominal: info.face };
  }
  Object.assign(p.lastPrices, r.lastPrices);
  Object.assign(p.accrued, r.accrued);
  log.push(...r.log);
  return { p, newToken: r.newRefreshToken };
}

/* ── рыночные данные ── */

export async function refreshMarketData(p0: Portfolio, m0: Market, s: Settings, snaps0: Snapshot[], progress: (s: string) => void, log: string[]) {
  const p = structuredClone(p0);
  const m = structuredClone(m0);
  progress("MOEX: справочник бумаг…");
  await normalizeInstruments(p, s, progress);

  const ids = new Set([...p.transactions.map((t) => t.instrumentId).filter((x): x is string => !!x), ...p.positions.map((x) => x.instrumentId)]);
  const insts = [...ids].map((id) => p.instruments[id]).filter((i): i is Instrument => !!i && !!i.market && i.market !== "-");

  progress("MOEX: котировки…");
  for (const market of ["shares", "bonds"] as const) {
    const group = insts.filter((i) => i.market === market);
    if (!group.length) continue;
    const q = await quotes(group.map((i) => i.ticker), market).catch(() => ({}) as Awaited<ReturnType<typeof quotes>>);
    for (const inst of group) {
      const x = q[inst.ticker];
      if (!x) continue;
      p.lastPrices[inst.id] = x.price;
      if (x.prevClose != null) p.prevClose[inst.id] = x.prevClose;
      if (x.accrued != null) p.accrued[inst.id] = x.accrued;
      if (inst.type === "bond" && x.faceValue) p.instruments[inst.id].nominal = x.faceValue;
      if (x.lot && !inst.lot) p.instruments[inst.id].lot = x.lot;
    }
  }

  progress("ЦБ: курсы валют и ключевая ставка…");
  try {
    const rates = await cbrRates();
    if (Object.keys(rates).length > 1) p.fx = rates;
  } catch {
    log.push("ЦБ: курсы валют не обновились");
  }
  try {
    const k = await keyRate();
    if (k) {
      m.keyRate = k.rate;
      m.keyRateDate = k.date;
    }
  } catch {
    /* возьмём ставку из настроек */
  }

  // Облигации рынка — для подбора и оценки риска облигаций, которые уже есть
  try {
    const [rows, corp] = await Promise.all([ofzList(), corpList()]);
    if (rows.length) await kv.set("bonds", { rows, corp, updatedAt: new Date().toISOString() });
  } catch {
    log.push("MOEX: список облигаций не обновился");
  }

  // История цен по неделям
  const firstTx = Math.min(...p.transactions.map((t) => ms(t.date)), addYears(Date.now(), -3));
  const from = addDays(Math.min(firstTx, addYears(Date.now(), -3)), -14);
  const stale = insts.filter((inst) => {
    const h = m.prices[inst.id] ?? [];
    return !(h.length && ms(h[h.length - 1][0]) > addDays(Date.now(), -4) && ms(h[0][0]) <= addDays(from, 30));
  });
  let done = 0;
  await pool(stale, 4, async (inst) => {
    try {
      const h = await priceHistory(inst.ticker, inst.market ?? "shares", inst.board, from);
      if (h.length) m.prices[inst.id] = h;
    } catch {
      /* без истории график в этой точке возьмёт цену сделки */
    }
    progress(`MOEX: история цен ${++done}/${stale.length}…`);
  });
  progress("MOEX: индексы…");
  for (const idx of ["IMOEX", "MCFTR", "RGBITR"]) {
    try {
      const h = await indexHistory(idx, from);
      if (h.length) m.benchmarks[idx] = h;
    } catch {
      /* сравнение с индексом просто не покажется */
    }
  }

  // Купоны и погашения
  const everything = { ...s, scope: "everything" };
  const held = new Set([...build(p, m, everything).holdings.map((h) => h.id), ...p.positions.map((x) => x.instrumentId)]);
  const bonds = insts.filter((i) => i.type === "bond" && held.has(i.id));
  await pool(bonds, 4, async (inst) => {
    progress(`MOEX: купоны ${inst.ticker}…`);
    try {
      const ev = await bondSchedule(inst.ticker, inst.id);
      if (ev.length) p.events = p.events.filter((e) => !(e.instrumentId === inst.id && e.kind !== "dividend")).concat(ev);
    } catch {
      /* купоны из API Т-Банка, если были */
    }
  });

  // Дивиденды: Т-Банк → встроенный справочник
  const tbank = s.tbankToken.trim() ? new TBankClient(s.tbankToken.trim()) : null;
  const shares = insts.filter((i) => (i.type === "share" || i.type === "etf") && held.has(i.id));
  await pool(shares, 4, async (inst) => {
    if (p.dividendHistory[inst.id]?.length && !p.isDemo && !tbank) return;
    progress(`Дивиденды ${inst.ticker}…`);
    let divs: PayEvent[] = [];
    if (tbank) {
      try {
        const uid = inst.uid ?? (await tbank.findUid(inst.ticker));
        if (uid) divs = await tbank.dividends(uid, inst.id, inst.currency);
      } catch {
        /* справочник ниже */
      }
    }
    if (!divs.length) divs = referenceDividends(inst.ticker, inst.id, p.isDemo ? Date.now() : undefined);
    p.dividendHistory[inst.id] = divs.filter((d) => d.status === "paid");
    p.events = p.events.filter((e) => !(e.instrumentId === inst.id && e.kind === "dividend")).concat(divs.filter((d) => d.status !== "paid"));
  });

  p.updatedAt = new Date().toISOString();
  m.updatedAt = p.updatedAt;
  // Ежедневный снимок стоимости: история копится и для счетов без операций
  const all = build(p, m, everything);
  const today = day(startOfDayMs());
  const snaps = snaps0.filter((x) => x.date !== today).concat({ date: today, value: all.totalValue, invested: all.invested }).slice(-2000);
  log.push(`Рыночные данные обновлены: ${insts.length} бумаг`);
  return { p, m, snaps };
}

/** Разрешает тикеры через MOEX и приводит ключи к ISIN — так одна бумага у разных брокеров склеивается. */
async function normalizeInstruments(p: Portfolio, s: Settings, progress: (s: string) => void) {
  const referenced = new Set([...p.transactions.map((t) => t.instrumentId).filter((x): x is string => !!x), ...p.positions.map((x) => x.instrumentId)]);
  for (const id of referenced) if (!p.instruments[id]) p.instruments[id] = { id, ticker: id, name: id, type: "other", currency: "RUB" };
  const todo = Object.keys(p.instruments).filter((id) => {
    const i = p.instruments[id];
    return i.market == null || (i.market !== "-" && i.type === "other" && (i.name === i.id || i.name === i.ticker));
  });
  await pool(todo, 4, async (id) => {
    const inst = p.instruments[id];
    if (!inst) return;
    progress(`MOEX: ${inst.ticker}…`);
    let info = await resolveSecurity(inst.ticker).catch(() => null);
    if (!info && inst.isin) info = await resolveSecurity(inst.isin).catch(() => null);
    if (!info) {
      inst.market = "-";
      return;
    }
    inst.isin ??= info.isin;
    if (inst.name === inst.ticker || inst.name === id) inst.name = info.shortName;
    inst.ticker = info.secid;
    if (inst.type === "other") inst.type = info.assetType;
    if (inst.type === "bond") {
      inst.nominal ??= info.faceValue;
      inst.maturityDate ??= info.matDate;
      if (info.faceUnit) inst.currency = info.faceUnit === "SUR" ? "RUB" : info.faceUnit;
    }
    inst.sector ??= sectorFor(info.secid, inst.type, info.group);
    inst.board = info.board;
    inst.market = info.market === "bonds" ? "bonds" : "shares";
    inst.country ??= "Россия";
  });
  // Ключ → ISIN (после всех запросов, чтобы не менять словарь во время обхода)
  for (const id of Object.keys(p.instruments)) {
    const inst = p.instruments[id];
    if (!inst) continue;
    const newKey = inst.isin ?? inst.ticker;
    if (newKey !== id) rekey(p, s, id, newKey);
  }
}

function rekey(p: Portfolio, s: Settings, old: string, key: string) {
  const inst = { ...p.instruments[old], id: key };
  const ex = p.instruments[key];
  if (ex) {
    const placeholder = ex.type === "other" || ex.name === ex.id || ex.name === ex.ticker;
    if (placeholder) {
      if (ex.name === ex.id || ex.name === ex.ticker) ex.name = inst.name;
      if (ex.type === "other") ex.type = inst.type;
      if (ex.ticker === ex.id) ex.ticker = inst.ticker;
      ex.isin ??= inst.isin;
      ex.maturityDate ??= inst.maturityDate;
    }
    ex.market ??= inst.market;
    ex.board ??= inst.board;
    ex.sector ??= inst.sector;
    ex.nominal ??= inst.nominal;
  } else p.instruments[key] = inst;
  delete p.instruments[old];
  for (const t of p.transactions) if (t.instrumentId === old) t.instrumentId = key;
  for (const x of p.positions) if (x.instrumentId === old) x.instrumentId = key;
  for (const e of p.events) if (e.instrumentId === old) e.instrumentId = key;
  for (const dict of [p.lastPrices, p.prevClose, p.accrued] as Record<string, number>[]) {
    if (old in dict) {
      if (!(key in dict)) dict[key] = dict[old];
      delete dict[old];
    }
  }
  if (p.dividendHistory[old]) {
    p.dividendHistory[key] = p.dividendHistory[old].map((e) => ({ ...e, instrumentId: key }));
    delete p.dividendHistory[old];
  }
  if (s.targets[old] != null) {
    s.targets[key] = s.targets[old];
    delete s.targets[old];
  }
}

/* ── импорт и демо ── */

export function runImport(file: File, accountId: string): Promise<boolean> {
  return task(`Импорт ${file.name}…`, async (progress, log) => {
    const res = await importFile(file, accountId);
    const st = await loadState();
    const existing = new Set(st.p.transactions.map((t) => t.id));
    const fresh = res.transactions.filter((t) => !existing.has(t.id));
    const p = { ...st.p, transactions: st.p.transactions.concat(fresh) };
    log.push(...res.warnings, `Импорт ${file.name}: добавлено операций ${fresh.length}`);
    await kv.set(KEYS.portfolio, p);
    const out = await refreshMarketData(p, st.m, st.s, st.snaps, progress, log);
    await Promise.all([kv.set(KEYS.portfolio, out.p), kv.set(KEYS.market, out.m), kv.set(KEYS.snapshots, out.snaps)]);
  });
}

export function loadDemo(): Promise<boolean> {
  return task("Собираю демо-портфель…", async (progress, log) => {
    const st = await loadState();
    const { p, m } = await generateDemo(progress);
    log.push(`Загружен демо-портфель: ${p.accounts.length} счёта, ${p.transactions.length} операций`);
    let s = st.s;
    if (!Object.keys(s.targets).length) s = { ...s, targets: { "type:share": 55, "type:bond": 30, "type:etf": 15 }, rebalanceByClass: true };
    await kv.set(KEYS.settings, { ...s, scope: "all" });
    const out = await refreshMarketData(p, m, s, [], progress, log);
    await Promise.all([kv.set(KEYS.portfolio, out.p), kv.set(KEYS.market, out.m), kv.set(KEYS.snapshots, out.snaps)]);
  });
}

export async function clearAll() {
  await Promise.all([kv.set(KEYS.portfolio, emptyPortfolio()), kv.set(KEYS.market, emptyMarket()), kv.set(KEYS.snapshots, [])]);
  await note(["Все данные портфеля удалены"]);
}
