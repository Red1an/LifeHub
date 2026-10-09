import { addYears, ms } from "./dates.ts";
import type { AssetType, PayEvent } from "./types.ts";

/*
 * Встроенные справочники. Нужны, когда точных данных из API нет:
 * ручной импорт, БКС без отраслей, работа без токена Т-Банка, демо и подбор акций.
 */

const SECTOR_GROUPS: Record<string, string[]> = {
  Финансы: ["SBER", "SBERP", "VTBR", "MOEX", "T", "TCSG", "BSPB", "SFIN", "CBOM", "SVCB", "RENI", "AFKS", "SPBE", "MBNK", "LEAS", "ZAYM"],
  Энергетика: ["LKOH", "ROSN", "GAZP", "NVTK", "TATN", "TATNP", "SNGS", "SNGSP", "SIBN", "TRNFP", "BANE", "BANEP", "RNFT"],
  "Сырьё и материалы": ["GMKN", "PLZL", "CHMF", "NLMK", "MAGN", "ALRS", "PHOR", "AKRN", "RUAL", "UGLD", "SELG", "MTLR", "MTLRP", "RASP", "ENPG", "TRMK", "SGZH", "KZOS", "NKNC", "NKNCP"],
  "Потребительский сектор": ["MGNT", "X5", "FIVE", "LENT", "OZON", "MVID", "BELU", "FIXP", "ABRD", "GCHE", "AQUA", "WUSH", "HNFG", "VSEH", "EUTR", "SVAV", "KROT"],
  Телеком: ["MTSS", "RTKM", "RTKMP", "MGTSP"],
  IT: ["YDEX", "HEAD", "POSI", "ASTR", "VKCO", "DIAS", "SOFL", "IVAT", "CIAN", "DATA", "DELI"],
  Электроэнергетика: ["IRAO", "HYDR", "FEES", "UPRO", "MSNG", "OGKB", "TGKA", "MRKP", "LSNGP", "ELFV", "MRKC", "MRKV", "MSRS"],
  Промышленность: ["AFLT", "FLOT", "NMTP", "KMAZ", "GLTR", "FESH", "UWGN", "NKHP"],
  Недвижимость: ["SMLT", "PIKK", "LSRG", "ETLN"],
  Здравоохранение: ["MDMG", "GEMC", "OZPH", "LIFE", "PRMD"],
};

export const SECTORS: Record<string, string> = Object.fromEntries(
  Object.entries(SECTOR_GROUPS).flatMap(([s, list]) => list.map((t) => [t, s])),
);

/** Отрасли из справочника Т-Банка → русские названия. */
const TBANK_SECTORS: Record<string, string> = {
  financial: "Финансы", energy: "Энергетика", materials: "Сырьё и материалы", consumer: "Потребительский сектор",
  telecom: "Телеком", it: "IT", utilities: "Электроэнергетика", industrials: "Промышленность",
  real_estate: "Недвижимость", health_care: "Здравоохранение", green_energy: "Зелёная энергетика",
  electrocars: "Электромобили", ecomaterials: "Экоматериалы", green_buildings: "Зелёные здания",
  government: "Госбумаги", municipal: "Муниципальные", other: "Прочее",
};

export function tbankSector(code?: string): string | undefined {
  const c = code?.toLowerCase();
  if (!c) return undefined;
  return TBANK_SECTORS[c] ?? c[0].toUpperCase() + c.slice(1);
}

export function sectorFor(ticker: string, type: AssetType, moexGroup?: string): string | undefined {
  const s = SECTORS[ticker.toUpperCase()];
  if (s) return s;
  switch (type) {
    case "bond":
      if (ticker.startsWith("SU") || moexGroup?.includes("ofz")) return "Госбумаги";
      if (moexGroup?.includes("subfederal") || moexGroup?.includes("municipal")) return "Муниципальные";
      return "Корпоративные облигации";
    case "etf":
      return "Фонды";
    case "currency":
      return "Валюта";
    default:
      return undefined;
  }
}

/** Что за фонд — по тикеру. Нужно, чтобы понимать, защищает ли фонд портфель (деньги, золото, облигации). */
export const FUND_KIND: Record<string, "money" | "gold" | "bonds" | "shares" | "mixed"> = {
  LQDT: "money", AKMM: "money", SBMM: "money", TMON: "money", GOLD: "gold", TGLD: "gold", SBGD: "gold", AKGD: "gold",
  TMOS: "shares", SBMX: "shares", EQMX: "shares", AKME: "shares", TDIV: "shares", DIVD: "shares", MKBD: "shares",
  OBLG: "bonds", SBGB: "bonds", AKMB: "bonds", TOFZ: "bonds", TBRU: "bonds", SBRB: "bonds", INFL: "bonds",
  TRUR: "mixed", TPAY: "bonds", AKFB: "bonds",
};

/** Тикеры для «Подбора акций» (аналог «Топ дивидендных акций» в Snowball). */
export const SCREENER_TICKERS = [
  "SBER", "SBERP", "LKOH", "ROSN", "TATN", "TATNP", "SNGSP", "NVTK", "TRNFP", "GMKN", "PLZL", "CHMF", "NLMK", "MAGN",
  "PHOR", "MGNT", "X5", "MTSS", "RTKM", "MOEX", "VTBR", "BSPB", "T", "YDEX", "HEAD", "IRAO", "HYDR", "AFLT", "GAZP", "ALRS",
  "AKRN", "BELU", "MDMG", "SMLT", "PIKK", "ASTR", "POSI", "UPRO", "FEES", "OGKB", "SIBN", "MBNK", "LSNGP", "NMTP", "FLOT",
];

/**
 * Приблизительная история дивидендов (₽ на акцию, дата отсечки). Только для работы без токена
 * Т-Банка: с токеном все данные о дивидендах берутся из API.
 */
const DIVIDENDS: Record<string, [string, number][]> = {
  SBER: [["2021-05-12", 18.7], ["2023-05-11", 25], ["2024-07-11", 33.3], ["2025-07-18", 34.84], ["2026-07-17", 37.64]],
  SBERP: [["2021-05-12", 18.7], ["2023-05-11", 25], ["2024-07-11", 33.3], ["2025-07-18", 34.84], ["2026-07-17", 37.64]],
  LKOH: [["2023-06-01", 438], ["2023-12-19", 447], ["2024-06-03", 498], ["2024-12-17", 514], ["2025-06-03", 541], ["2026-01-12", 397]],
  ROSN: [["2023-07-09", 17.26], ["2023-10-11", 30.77], ["2024-07-17", 29.01], ["2024-10-14", 36.47], ["2025-07-07", 14.68], ["2025-10-13", 11.56]],
  TATN: [["2023-07-08", 27.54], ["2023-10-12", 35.17], ["2024-01-09", 37.25], ["2024-07-09", 38.2], ["2024-10-18", 38.49], ["2025-01-10", 38.49], ["2025-07-08", 21.47], ["2025-10-07", 14.61]],
  TATNP: [["2023-07-08", 27.54], ["2023-10-12", 35.17], ["2024-01-09", 37.25], ["2024-07-09", 38.2], ["2024-10-18", 38.49], ["2025-01-10", 38.49], ["2025-07-08", 21.47], ["2025-10-07", 14.61]],
  SNGSP: [["2023-07-18", 6.42], ["2024-07-18", 12.84], ["2025-07-17", 6.25]],
  NVTK: [["2023-05-02", 60.58], ["2023-10-11", 45], ["2024-05-07", 64.1], ["2024-10-16", 35.5], ["2025-05-06", 46.65], ["2025-10-14", 39]],
  TRNFP: [["2023-07-19", 107.05], ["2024-07-19", 175.98], ["2025-07-18", 177.17]],
  GMKN: [["2023-06-12", 9.15]],
  CHMF: [["2024-06-18", 191.51], ["2024-08-27", 39.15], ["2024-11-25", 49.06], ["2025-06-10", 31.31]],
  MAGN: [["2024-06-07", 2.36], ["2024-10-04", 2.17], ["2025-01-10", 1.82]],
  PHOR: [["2023-06-12", 264], ["2024-06-10", 117], ["2024-10-07", 273], ["2025-01-14", 387], ["2025-06-02", 117], ["2025-10-08", 300]],
  MGNT: [["2024-01-08", 412.13], ["2025-01-08", 436.79]],
  X5: [["2025-01-17", 648], ["2025-07-21", 368]],
  MTSS: [["2023-07-07", 34.29], ["2024-07-08", 35], ["2025-07-08", 35]],
  RTKM: [["2023-07-07", 5.45], ["2024-07-22", 2.71], ["2025-07-14", 2.71]],
  MOEX: [["2023-05-17", 4.84], ["2024-05-15", 17.35], ["2025-05-14", 26.11]],
  VTBR: [["2025-07-11", 25.58]],
  BSPB: [["2023-05-26", 23.37], ["2024-05-27", 33.5], ["2024-09-11", 20.3], ["2025-05-07", 43.12], ["2025-09-11", 14.47]],
  T: [["2025-07-03", 32.33], ["2025-10-10", 35]],
  YDEX: [["2025-07-07", 80], ["2025-10-10", 110]],
  HEAD: [["2025-07-15", 233]],
  IRAO: [["2023-06-14", 0.32], ["2024-07-17", 0.32], ["2025-06-30", 0.35]],
  HYDR: [["2023-07-07", 0.02], ["2024-07-24", 0.02]],
  AFLT: [["2025-07-10", 3.8]],
  ALRS: [["2024-07-10", 0.59]],
  AKRN: [["2024-06-21", 162]],
};

/**
 * История дивидендов по справочнику. extendTo — только для демо: пропуски в хвосте справочника
 * заполняются «как годом ранее», чтобы демо-портфель был согласованным.
 */
export function referenceDividends(ticker: string, instrumentId: string, extendTo?: number): PayEvent[] {
  const now = Date.now();
  const events: PayEvent[] = (DIVIDENDS[ticker.toUpperCase()] ?? [])
    .filter(([, v]) => v > 0)
    .map(([d, v]) => ({
      instrumentId,
      kind: "dividend" as const,
      recordDate: d,
      payDate: payDateFor(d),
      perUnit: v,
      currency: "RUB",
      status: ms(d) < now ? ("paid" as const) : ("declared" as const),
    }));
  if (extendTo && events.length) {
    const last = Math.max(...events.map((e) => new Date(ms(e.recordDate)).getFullYear()));
    const endYear = new Date(extendTo).getFullYear();
    for (let y = last; y <= endYear; y++) {
      for (const e of events.filter((x) => new Date(ms(x.recordDate)).getFullYear() === y - 1)) {
        const rec = addYears(e.recordDate, 1);
        if (rec > extendTo || events.some((x) => Math.abs(ms(x.recordDate) - rec) < 75 * 86_400_000)) continue;
        const recDay = new Date(rec).toISOString().slice(0, 10);
        events.push({ ...e, recordDate: recDay, payDate: payDateFor(recDay), status: "paid" });
      }
    }
  }
  return events.sort((a, b) => ms(a.recordDate) - ms(b.recordDate));
}

function payDateFor(record: string): string {
  const d = new Date(ms(record) + 14 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export const hasReferenceDividends = (ticker: string) => ticker.toUpperCase() in DIVIDENDS;
