import { detectBank, parseDate, parseNum, REFUND_RE, SPLIT_RE, type ParsedOp } from "./common.ts";
import type { BankId } from "../types.ts";

/*
 * Выписки банков → операции.
 *
 *  • Таблицы (CSV/XLSX: Т-Банк, Альфа, выгрузки из Excel) — ищем строку заголовков и колонки по названиям.
 *  • Текст PDF (Сбер, Яндекс, Озон, ВТБ…) — построчно: операция начинается строкой с датой и суммой
 *    с копейками, следующие строки без суммы — её продолжение (описание). Знак: «+» — доход, «−» — трата;
 *    без знака — по тому, как банк пишет остальные суммы, и по словам («зачисление», «перевод от»).
 */

export interface StatementResult {
  bank?: BankId;
  ops: ParsedOp[];
  /** Последние 4 цифры карты/счёта, если нашлись в шапке. */
  card?: string;
  /** Конечный остаток выписки — чтобы выставить баланс счёта (у кредитки — долг). */
  closing?: { amount: number; date?: string };
  /** Выписка по кредитной карте. */
  credit?: boolean;
  /** Владелец счёта из шапки: «Пронь Максим Сергеевич». */
  owner?: string;
  warnings: string[];
}

export type Grid = string[][];

const INCOME_WORDS = /зачислен|поступлен|пополнен|перевод от|входящий|возврат|кэшб[эе]к|кешб[эе]к|начислен|зарплат|выплат|refund|credit/i;

/* ───────────── таблицы ───────────── */

const COLS = {
  date: /^(дата( и время)? операции|дата операции|дата|date|transaction date|дата транзакции)$/i,
  amount: /^(сумма операции|сумма платежа|сумма|сумма в валюте (счета|счёта|карты)|amount|сумма в рублях)$/i,
  income: /^(приход|поступлени[ея]|зачислени[ея]|кредит|credit|доход)$/i,
  expense: /^(расход|списани[ея]|дебет|debit)$/i,
  desc: /^(описание|описание операции|назначение( платежа)?|наименование|контрагент|получатель|description|детали|комментарий)$/i,
  category: /^(категория|category)$/i,
  card: /^(номер карты|карта|card)$/i,
  status: /^(статус|status)$/i,
  currency: /^(валюта операции|валюта)$/i,
  mcc: /^mcc$/i,
};

export function parseGrid(grid: Grid, hint = ""): StatementResult | null {
  for (let h = 0; h < Math.min(grid.length, 40); h++) {
    const head = grid[h].map((x) => x.trim().toLowerCase().replace(/\s+/g, " "));
    const col = (re: RegExp) => head.findIndex((x) => re.test(x));
    const c = {
      date: col(COLS.date), amount: col(COLS.amount), income: col(COLS.income), expense: col(COLS.expense), desc: col(COLS.desc),
      category: col(COLS.category), card: col(COLS.card), status: col(COLS.status), currency: col(COLS.currency), mcc: col(COLS.mcc),
    };
    if (c.date < 0 || (c.amount < 0 && c.income < 0 && c.expense < 0)) continue;
    const ops: ParsedOp[] = [];
    const bank = detectBank(hint + " " + grid.slice(0, h).flat().join(" ")) ?? (head.includes("кэшбэк") && head.includes("mcc") ? "tbank" : undefined);
    for (const r of grid.slice(h + 1)) {
      const v = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
      const date = parseDate(v(c.date));
      if (!date) continue;
      if (/fail|отклон|отмен/i.test(v(c.status))) continue;
      let value: number | null = null;
      if (c.amount >= 0) value = parseNum(v(c.amount));
      if (value === null || value === 0) {
        const inc = parseNum(v(c.income));
        const exp = parseNum(v(c.expense));
        if (inc) value = Math.abs(inc);
        else if (exp) value = -Math.abs(exp);
      }
      if (!value) continue;
      const desc = v(c.desc);
      const time = v(c.date).match(/(\d{1,2}):(\d{2})/);
      const cur = v(c.currency).toUpperCase();
      ops.push({
        kind: value > 0 ? "income" : "expense",
        amount: Math.abs(value),
        date,
        time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined,
        merchant: desc.slice(0, 80) || undefined,
        raw: r.filter(Boolean).join(" | ").slice(0, 400),
        bankCategory: v(c.category) || undefined,
        card: v(c.card).match(/(\d{4})\s*$/)?.[1],
        bank,
        refund: value > 0 && REFUND_RE.test(desc + " " + v(c.category)) ? true : undefined,
        split: SPLIT_RE.test(desc) || undefined,
        currency: cur && !/^(RUB|RUR|₽)$/.test(cur) ? cur : undefined,
      });
    }
    // T-Банк пишет траты с минусом, а Альфа — без знака в колонке «Сумма» с отдельным «Тип»: если минусов нет, но
    // есть слова расходов — оставляем как есть (большинство выгрузок со знаком).
    if (ops.length) return { bank, ops, warnings: [] };
  }
  return null;
}

/* ───────────── текст PDF ───────────── */

const DATE_START = /^(\d{2}\.\d{2}\.\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4})(?:\s*(?:г\.)?\s*,?\s*(\d{1,2}:\d{2})(?::\d{2})?)?/i;
/** Сумма с копейками и необязательной валютой — так банки пишут все суммы в выписках. */
const MONEY = /(^|\s)([+−–-]\s?)?(\d{1,3}(?:[   ]\d{3})+|\d+)[.,](\d{2})(?:\s?(₽|руб\.?|RUB|RUR|р\.?)(?![а-яa-z]))?(?=\s|$)/gi;

/** Строки, которые не относятся к операциям: шапки таблиц, колонтитулы, итоги. */
const NOISE =
  /^(дата( операции| обработки)?|категория|описание|сумма( операции| в валюте| платежа)|остаток|итого|всего|страница|стр\.|продолжение|выписка|период|за период|баланс на|входящий остаток|исходящий остаток|поступления|расходы|списания|дата формирования|пао |ао |ооо |\d+ из \d+$|генеральная лицензия|www\.|тел\.|телефон|клиент|владелец|номер (счета|счёта|карты|договора)|валюта|расшифровка|в валюте|код авторизации|дата и время|документ|назначение)/i;
/** Строка закрывает список операций (дальше — итоги, реквизиты). */
const END = /^(итого|всего (поступлений|списаний|расходов)|остаток (на|средств на) конец|исходящий остаток|дата формирования документа)/i;

interface Money {
  value: number;
  sign: "" | "+" | "-";
  index: number;
  end: number;
}

function moneyIn(line: string): Money[] {
  const out: Money[] = [];
  for (const m of line.matchAll(MONEY)) {
    const value = parseNum(m[3] + "." + m[4]);
    if (value === null) continue;
    const s = (m[2] ?? "").trim();
    out.push({ value, sign: s === "+" ? "+" : s ? "-" : "", index: m.index! + m[1].length, end: m.index! + m[0].length });
  }
  return out;
}

export function parseText(text: string, hint = ""): StatementResult {
  const lines = text
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const bank = detectBank(hint + " " + lines.slice(0, 30).join(" "));
  const warnings: string[] = [];

  // Карта/счёт, владелец, тип и конечный остаток — из шапки и итогов.
  const head = lines.slice(0, 40).join(" ");
  const owner = head.match(/(?:владелец|клиент|фио)[:\s]+([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/i)?.[1];
  const credit = /кредитн(ой|ая|ую|ым) карт|-KK-|договор[^.]{0,40}\bKK\b/i.test(head + " " + lines.slice(0, 120).join(" "));
  let card = head.match(/(?:карт[аы]|card)[^\d*•]{0,20}[*•]{0,4}\s?\d{0,4}[*•\s]+(\d{4})\b/i)?.[1] ?? head.match(/сч[её]т[^\d]{0,15}\d{16}(\d{4})\b/i)?.[1];
  let closing: StatementResult["closing"];
  for (const l of lines) {
    const m = l.match(/(?:остаток (?:средств )?на (?:конец периода|(\d{2}\.\d{2}\.\d{4}))|исходящий остаток|конечный остаток)[^\d+−–-]*([+−–-]?\s?\d[\d   ]*[.,]\d{2})/i);
    if (m) closing = { amount: parseNum(m[2]) ?? 0, date: m[1] ? parseDate(m[1]) ?? undefined : undefined };
  }

  type Rec = { date: string; time?: string; first: string; money: Money[]; more: string[] };
  const recs: Rec[] = [];
  let cur: Rec | null = null;
  let ended = false;
  for (const line of lines) {
    const d = line.match(DATE_START);
    const money = d ? moneyIn(line.slice(d[0].length)) : [];
    if (d && money.length) {
      const date = parseDate(d[1]);
      if (date) {
        ended = false;
        cur = { date, time: d[2], first: line.slice(d[0].length), money, more: [] };
        recs.push(cur);
        continue;
      }
    }
    if (END.test(line)) {
      ended = true;
      cur = null;
      continue;
    }
    if (!cur || ended || NOISE.test(line)) continue;
    if (moneyIn(line).length >= 2) continue; // итоговая строка таблицы
    cur.more.push(line.replace(DATE_START, "").trim());
  }

  // Как банк пишет знак: если есть «+», то суммы без знака — траты; если есть «−», то без знака — доходы.
  const signs = recs.map((r) => r.money[0].sign);
  const hasPlus = signs.includes("+");
  const hasMinus = signs.includes("-");

  const ops: ParsedOp[] = [];
  for (const r of recs) {
    const m = r.money[0];
    // Внутренние проводки банка (перенос долга на просрочку) — не операции.
    if (/вынос на просрочку|перенос на просроч|списание с просрочки/i.test(r.first + " " + r.more.join(" "))) continue;
    const firstText = (r.first.slice(0, m.index) + " " + r.first.slice(m.end).replace(MONEY, " ")).replace(/\s+/g, " ").trim();
    // Код авторизации (6 цифр) в начале — Сбер.
    const rest = firstText.replace(/^\d{4,8}\s+/, "");
    // Сбер: вторая строка — дата обработки и код авторизации перед описанием.
    const more = r.more.join(" ").replace(/\s+/g, " ").trim().replace(/^\d{6}\s+/, "");
    const all = (rest + " " + more).trim();
    let kind: "expense" | "income";
    if (m.sign === "+") kind = "income";
    else if (m.sign === "-") kind = "expense";
    else if (hasPlus) kind = "expense";
    else if (hasMinus) kind = "income";
    else kind = INCOME_WORDS.test(all) ? "income" : "expense";

    // Сбер: в первой строке — категория банка, во второй — продавец «PYATEROCHKA 1234 Sankt-Peterbu RUS. Операция по карте ****1234».
    let bankCategory: string | undefined;
    let merchant = all;
    if (bank === "sber" && rest && more && rest.length < 40 && !/\d{3,}/.test(rest)) {
      bankCategory = rest;
      merchant = more;
    }
    merchant = ozonMerchant(merchant) ?? cleanStatementText(merchant);
    merchant = merchant
      .replace(/^\d{7,}\s+/, "")
      .replace(/\.?\s*(операция по (карте|сч[её]ту)|оплата по сбп|по номеру телефона)[^.]*$/i, "")
      .replace(/^(оплата товаров и услуг|покупка|оплата|списание|платеж|платёж)[\s.:,-]+/i, "")
      .trim();
    const cardN = (more + " " + rest).match(/[*•]{2,}\s?(\d{4})/)?.[1] ?? (more + " " + rest).match(/карт[еаы]\s+(\d{4})\b/i)?.[1];
    ops.push({
      kind,
      amount: m.value,
      date: r.date,
      time: r.time ? r.time.padStart(5, "0").slice(0, 5) : undefined,
      merchant: merchant.slice(0, 80) || bankCategory,
      raw: (r.first + " " + more).slice(0, 400),
      bankCategory,
      card: cardN ?? card,
      bank,
      refund: kind === "income" && REFUND_RE.test(all) ? true : undefined,
      split: SPLIT_RE.test(all) || undefined,
    });
  }
  if (!ops.length) warnings.push("В тексте не нашлось строк с датой и суммой.");
  // В шапке карты нет — берём ту, что встречается в операциях чаще всего (у кредитки Озона «по кредитной карте 7720»).
  if (!card && ops.length) {
    const n = new Map<string, number>();
    for (const o of ops) if (o.card) n.set(o.card, (n.get(o.card) ?? 0) + 1);
    const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && (n.size === 1 || top[1] >= ops.length / 3)) {
      card = top[0];
      for (const o of ops) o.card ??= card;
    }
  }
  return { bank, ops, card, closing, warnings, credit, owner };
}

/**
 * Озон: «14387589113 Оплата товаров по 8 кредитной карте 7720 сумма 320.70 в SEZON SANKT-PETERBU RU дата …» → «SEZON»;
 * «Оплата товаров/услуг на Платформе Ozon, заказ № …» → «Ozon»; «Перевод № … через QR СБП» → «Оплата по QR (СБП)».
 */
/**
 * Описание из строки выписки без служебного: дата обработки, номер карты и время (Т-Банк пишет
 * «16.12.2025 Оплата в SEZON SANKT- 0013 21:53 03:12 PETERBU»), город и страна в конце.
 */
export function cleanStatementText(s: string): string {
  let t = s
    .replace(/^\s*\d{1,2}\.\d{1,2}\.\d{2,4}\s+/, "")
    .replace(/\s\d{4}\s+\d{1,2}:\d{2}(?:\s+\d{1,2}:\d{2})?/g, " ")
    .replace(/\s+\d{1,2}:\d{2}(?::\d{2})?/g, " ")
    .replace(/^(оплата|покупка) в\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const city = t.search(/\s+(?:SANKT-?|SAINT|MOSKVA|MOSCOW|PETERBU|g\.\s|RUS?\b)/i);
  if (city > 2) t = t.slice(0, city);
  return t.trim();
}

export function ozonMerchant(s: string): string | null {
  const t = s.replace(/^\d{7,}\s+/, "").replace(/\b(по|услуг)\s\d\s/g, "$1 ");
  const shop = t.match(/сумма\s+[\d.,]+\s+в\s+(.+)/i);
  if (shop) {
    // Дальше — город, страна, «дата … время …»: отрезаем по первому из них.
    const cut = shop[1].search(/\s+(?:SANKT|MOSKVA|MOSCOW|g\.\s|RU\b|дата\b|\d{1,2}:\d{2})/i);
    return (cut > 0 ? shop[1].slice(0, cut) : shop[1]).trim();
  }
  if (/на платформе ozon/i.test(t)) return "Ozon";
  if (/^перевод №.*через\s+qr/i.test(t)) return "QR-оплата (СБП)";
  const repay = t.match(/^(погашение(?: просроченной задолженности)? (?:кредита|по кредиту))/i);
  if (repay) return repay[1].replace(/^п/, "П");
  return null;
}

/* ───────────── CSV ───────────── */

export function parseCsv(text: string): Grid {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].reduce((a, b) => (first.split(b).length > first.split(a).length ? b : a), ",");
  const rows: Grid = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((x) => x.trim()));
}
