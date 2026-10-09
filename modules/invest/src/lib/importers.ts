import { strFromU8, unzipSync } from "fflate";
import { classifyOperation } from "./bcs.ts";
import { day, ms, parseDate } from "./dates.ts";
import { isIncomeType, normCurrency, type Instrument, type Tx, type TxType } from "./types.ts";

/*
 * Ручные выгрузки — запасной путь, если API недоступно:
 *  • CSV в формате импорта Snowball (Event,Date,Symbol,Price,Quantity,Currency,FeeTax,…);
 *  • XLSX/CSV отчёты брокеров (Т-Банк, БКС) — эвристический поиск таблиц сделок и движения денег.
 */

export interface ImportResult {
  transactions: Tx[];
  warnings: string[];
}

type Grid = string[][];

export async function importFile(file: File, accountId: string): Promise<ImportResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const grids: Grid[] = ext === "xlsx" || ext === "xlsm" ? readXlsx(buf) : [parseCsv(decodeText(buf))];
  for (const g of grids) {
    const r = snowball(g, accountId);
    if (r) return r;
  }
  const res: ImportResult = { transactions: [], warnings: [] };
  for (const g of grids) res.transactions.push(...brokerTrades(g, accountId), ...brokerCash(g, accountId));
  if (!res.transactions.length) res.warnings.push("Не удалось распознать таблицы в файле. Попробуйте шаблон CSV (формат Snowball).");
  const seen = new Set<string>();
  res.transactions = res.transactions.filter((t) => !seen.has(t.id) && seen.add(t.id));
  return res;
}

function decodeText(buf: Uint8Array): string {
  const utf = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  // Если в UTF-8 много «�» — файл в Windows-1251 (выгрузки из Excel)
  return (utf.match(/�/g)?.length ?? 0) > 3 ? new TextDecoder("windows-1251").decode(buf) : utf.replace(/^﻿/, "");
}

/* ── CSV ── */

export function parseCsv(text: string): Grid {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].reduce((a, b) => (first.split(b).length > first.split(a).length ? b : a), ",");
  const rows: Grid = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((x) => x.trim()));
}

export function num(s?: string): number | null {
  let t = (s ?? "").replace(/[  \s]/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.replace(/,/g, "");
  else t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/* ── XLSX (zip + XML) ── */

function readXlsx(buf: Uint8Array): Grid[] {
  const files = unzipSync(buf);
  const xml = (p: string) => (files[p] ? new DOMParser().parseFromString(strFromU8(files[p]), "application/xml") : null);
  const tags = (d: Document | Element, name: string) => Array.from(d.getElementsByTagName(name));
  const shared = xml("xl/sharedStrings.xml");
  const strings = shared ? tags(shared, "si").map((si) => tags(si, "t").map((t) => t.textContent ?? "").join("")) : [];
  const sheetPaths = Object.keys(files).filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p)).sort();
  const out: Grid[] = [];
  for (const p of sheetPaths) {
    const doc = xml(p);
    if (!doc) continue;
    const grid: Grid = [];
    for (const row of tags(doc, "row")) {
      const r = Number(row.getAttribute("r") ?? grid.length + 1);
      while (grid.length + 1 < r) grid.push([]); // пустые строки в XLSX не хранятся — восстанавливаем
      const cells: string[] = [];
      for (const c of tags(row, "c")) {
        const ref = c.getAttribute("r") ?? "";
        const col = colIndex(ref.replace(/\d+/g, ""));
        while (cells.length < col) cells.push("");
        const type = c.getAttribute("t");
        const v = tags(c, "v")[0]?.textContent ?? "";
        let value = v;
        if (type === "s") value = strings[Number(v)] ?? "";
        else if (type === "inlineStr") value = tags(c, "t").map((t) => t.textContent ?? "").join("");
        cells.push(value.trim());
      }
      grid.push(cells);
    }
    out.push(grid);
  }
  return out;
}

const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/* ── Snowball CSV ── */

function snowball(grid: Grid, accountId: string): ImportResult | null {
  const headerIdx = grid.slice(0, 5).findIndex((r) => {
    const l = r.map((x) => x.toLowerCase());
    return l.includes("event") && l.includes("date") && l.includes("symbol");
  });
  if (headerIdx < 0) return null;
  const header = grid[headerIdx].map((x) => x.toLowerCase());
  const res: ImportResult = { transactions: [], warnings: [] };
  grid.slice(headerIdx + 1).forEach((r, i) => {
    const v = (n: string) => {
      const c = header.indexOf(n);
      return c >= 0 ? r[c] ?? "" : "";
    };
    const d = parseDate(v("date"));
    if (!d) return;
    const event = v("event").toLowerCase();
    const symbol = v("symbol").toUpperCase();
    const price = num(v("price")) ?? 0;
    const q = num(v("quantity")) ?? 0;
    const nkd = num(v("nkd")) ?? 0;
    const t: Tx = {
      id: `import:${accountId}:${i}:${d}:${symbol}`, accountId, date: d, type: "other", instrumentId: symbol || undefined,
      quantity: Math.abs(q), price, amount: 0, currency: normCurrency(v("currency")), fee: Math.abs(num(v("feetax")) ?? 0),
      source: "import", note: v("note") || undefined,
    };
    const total = q > 0 ? q * price : price;
    switch (event) {
      case "buy": t.type = "buy"; t.amount = -(Math.abs(q) * price + nkd); break;
      case "sell": t.type = "sell"; t.amount = Math.abs(q) * price + nkd; break;
      case "dividend": t.type = "dividend"; t.amount = total; break;
      case "coupon": t.type = "coupon"; t.amount = total; break;
      case "amortisation":
      case "amortization": t.type = "amortization"; t.amount = total; break;
      case "repayment": t.type = "repayment"; t.amount = total; break;
      case "cash_in": t.type = "deposit"; t.amount = price; t.instrumentId = undefined; break;
      case "cash_out": t.type = "withdrawal"; t.amount = -Math.abs(price); t.instrumentId = undefined; break;
      case "fee":
      case "cash_expense": t.type = "fee"; t.amount = -Math.abs(price); t.instrumentId = undefined; break;
      case "tax": t.type = "tax"; t.amount = -Math.abs(price); break;
      case "cash_gain": t.type = "other"; t.amount = Math.abs(price); t.instrumentId = undefined; break;
      default:
        res.warnings.push(`Строка ${i + headerIdx + 2}: неизвестное событие «${event}» пропущено`);
        return;
    }
    res.transactions.push(t);
  });
  return res;
}

export function exportSnowballCsv(txs: Tx[], instruments: Record<string, Instrument>): string {
  const lines = ["Event,Date,Symbol,Price,Quantity,Currency,FeeTax,Exchange,NKD,FeeCurrency,DoNotAdjustCash,Note"];
  for (const t of [...txs].sort((a, b) => ms(a.date) - ms(b.date))) {
    const sym = t.instrumentId ? instruments[t.instrumentId]?.ticker ?? t.instrumentId : "";
    let price = t.price;
    let q = t.quantity;
    const map: Record<TxType, string> = {
      buy: "Buy", sell: "Sell", dividend: "Dividend", coupon: "Coupon", amortization: "Amortisation", repayment: "Repayment",
      deposit: "Cash_In", withdrawal: "Cash_Out", fee: "Fee", tax: "Tax", other: t.amount >= 0 ? "Cash_Gain" : "Cash_Expense",
    };
    if (["dividend", "coupon", "amortization", "repayment"].includes(t.type)) {
      price = t.amount;
      q = 0;
    } else if (t.type !== "buy" && t.type !== "sell") price = Math.abs(t.amount);
    const note = (t.note ?? "").replace(/[,\n]/g, " ");
    lines.push([map[t.type], day(t.date), sym, String(+price.toPrecision(8)), String(+q.toPrecision(8)), t.currency, t.fee.toFixed(2), "", "", t.currency, "", note].join(","));
  }
  return lines.join("\n");
}

export const SNOWBALL_TEMPLATE =
  "Event,Date,Symbol,Price,Quantity,Currency,FeeTax,Exchange,NKD,FeeCurrency,DoNotAdjustCash,Note\n" +
  "Cash_In,2025-01-10,,100000,,RUB,,,,,,Пополнение\n" +
  "Buy,2025-01-11,SBER,280.5,100,RUB,14.03,,,,,\n" +
  "Dividend,2025-07-25,SBER,34.84,100,RUB,452.92,,,,,\n";

/* ── брокерские отчёты (эвристика) ── */

function headerMatch(row: string[], patterns: string[]): number | null {
  const lower = row.map((x) => x.toLowerCase());
  for (const p of patterns) {
    const i = lower.findIndex((x) => x.includes(p));
    if (i >= 0) return i;
  }
  return null;
}

/** Таблицы сделок. Т-Банк: строка = сделка с кодом бумаги. БКС: сделки сгруппированы по бумагам, колонки «Куплено, шт»/«Продано, шт». */
function brokerTrades(grid: Grid, accountId: string): Tx[] {
  const out: Tx[] = [];
  let i = 0;
  while (i < grid.length) {
    const h = grid[i];
    const bought = headerMatch(h, ["куплено"]);
    const soldCol = headerMatch(h, ["продано"]);
    const dc = headerMatch(h, ["дата заключ", "дата сделки", "дата и время", "дата"]);
    const qc = bought ?? headerMatch(h, ["количество", "кол-во", "шт."]);
    const pc = headerMatch(h, ["цена за единицу", "цена"]);
    const sc = headerMatch(h, ["код актива", "тикер", "isin", "код ценной", "ценная бумага", "инструмент", "сокращенное наименование", "наименование"]);
    if (dc == null || qc == null || pc == null || (sc == null && bought == null)) {
      i++;
      continue;
    }
    const side = headerMatch(h, ["вид сделки", "направление", "тип сделки", "операция", "покупка/продажа"]);
    const after = (from: number | null, test: (s: string) => boolean) => (from == null ? null : h.findIndex((x, k) => k > from && test(x.toLowerCase())));
    const sellPrice = after(soldCol, (s) => s.includes("цена"));
    const sumc = headerMatch(h, ["сумма сделки", "сумма платежа", "объем", "сумма"]);
    const cleanSum = headerMatch(h, ["без нкд"]);
    const sellSum = after(soldCol, (s) => s.includes("сумма") || s.includes("выручк"));
    const feec = headerMatch(h, ["комиссия брокера", "комиссия"]);
    const idc = headerMatch(h, ["номер сделки", "№ сделки", "номер"]);
    let group: string | null = null;
    let j = i + 1;
    let blank = 0;
    for (; j < grid.length; j++) {
      const r = grid[j];
      const v = (c: number | null) => (c != null && c >= 0 ? r[c] ?? "" : "");
      if (r.every((x) => !x)) {
        if (++blank > 2) break;
        continue;
      }
      blank = 0;
      const d = parseDate(v(dc));
      if (!d) {
        const text = r.join(" ");
        if (text.toLowerCase().includes("итого")) continue;
        const sym = extractSymbol(text);
        if (sym && sc == null) {
          group = sym;
          continue;
        }
        if (headerMatch(r, ["дата"]) != null) break;
        continue;
      }
      const sideText = v(side).toLowerCase();
      let q = num(v(qc)) ?? 0;
      let price = num(v(pc)) ?? 0;
      let total = Math.abs(num(v(sumc)) ?? 0);
      let isSell = sideText.includes("прод") || sideText.includes("sell") || q < 0;
      const sq = num(v(soldCol));
      if (soldCol != null && sq && sq > 0 && !q) {
        q = sq;
        isSell = true;
        price = num(v(sellPrice)) ?? price;
        const ss = num(v(sellSum));
        if (ss != null) total = Math.abs(ss);
      }
      q = Math.abs(q);
      const symbol = (sc != null ? v(sc) : group ?? "").toUpperCase();
      if (!q || !symbol || !price) continue;
      if (!total) total = q * price;
      // Цена облигаций в отчётах — в % номинала: пересчитываем из суммы
      const base = Math.abs(num(v(cleanSum)) ?? total);
      if (Math.abs(base / q - price) / Math.max(price, 0.0001) > 0.5) price = base / q;
      const tradeId = v(idc) || `${j}-${symbol}-${d}`;
      out.push({
        id: `import:${accountId}:trade:${tradeId}`, accountId, date: d, type: isSell ? "sell" : "buy", instrumentId: symbol,
        quantity: q, price, amount: isSell ? total : -total, currency: "RUB", fee: Math.abs(num(v(feec)) ?? 0), source: "import", note: "Отчёт брокера",
      });
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

/** Таблицы движения денег: дата + описание + сумма (или зачисление/списание). */
function brokerCash(grid: Grid, accountId: string): Tx[] {
  const out: Tx[] = [];
  let i = 0;
  while (i < grid.length) {
    const h = grid[i];
    const dc = headerMatch(h, ["дата исполнения", "дата операции", "дата"]);
    const oc = headerMatch(h, ["операция", "описание", "содержание", "тип операции", "назначение"]);
    const inc = headerMatch(h, ["сумма зачисления", "зачислено", "приход"]);
    const outc = headerMatch(h, ["сумма списания", "списано", "расход"]);
    const sumc = headerMatch(h, ["сумма"]);
    if (dc == null || oc == null || (inc == null && sumc == null) || headerMatch(h, ["цена"]) != null) {
      i++;
      continue;
    }
    const curc = headerMatch(h, ["валюта"]);
    let j = i + 1;
    for (; j < grid.length; j++) {
      const r = grid[j];
      const v = (c: number | null) => (c != null ? r[c] ?? "" : "");
      if (r.every((x) => !x)) break;
      const d = parseDate(v(dc));
      if (!d) {
        if (headerMatch(r, ["дата"]) != null) break;
        continue;
      }
      const text = v(oc);
      let amount = 0;
      const a = num(v(inc));
      const b = num(v(outc));
      if (a) amount = Math.abs(a);
      if (b) amount = -Math.abs(b);
      if (!amount) amount = num(v(sumc)) ?? 0;
      if (!amount) continue;
      const lower = text.toLowerCase();
      if (lower.includes("покупк") || lower.includes("продаж") || lower.includes("сделк")) continue;
      const type = classifyOperation(lower, amount);
      const linked = isIncomeType(type) || type === "amortization" || type === "repayment";
      out.push({
        id: `import:${accountId}:cash:${j}:${d}:${amount}`, accountId, date: d, type,
        instrumentId: linked ? extractSymbol(r.join(" ")) ?? undefined : undefined,
        quantity: 0, price: 0,
        amount: type === "tax" || type === "fee" || type === "withdrawal" ? -Math.abs(amount) : amount,
        currency: normCurrency(v(curc) || "RUB"), fee: 0, source: "import", note: text,
      });
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

function extractSymbol(text: string): string | null {
  return /\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b/.exec(text)?.[0] ?? /\b[A-Z]{4,5}P?\b/.exec(text)?.[0] ?? null;
}
