import type { BankId } from "../types.ts";

/** Операция, распознанная в уведомлении или выписке, — ещё не запись. */
export interface ParsedOp {
  kind: "expense" | "income";
  /** Положительная сумма. */
  amount: number;
  date: string;
  time?: string;
  merchant?: string;
  /** Исходный текст. */
  raw: string;
  bankCategory?: string;
  card?: string;
  bank?: BankId;
  /** Остаток после операции (если банк написал). */
  balance?: number;
  /** Возврат покупки: уменьшает траты, а не доход. */
  refund?: boolean;
  /** Покупка Сплитом / в рассрочку / долями. */
  split?: boolean;
  /** Валюта, если не рубли. */
  currency?: string;
}

/** YYYY-MM-DD по местному времени. */
export function localDay(ts: number | Date = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** «1 234,56» / «1234.56» / «1,234.56» → число. */
export function parseNum(s: string): number | null {
  let t = s.replace(/[\s  ']/g, "").replace(/[−–—]/g, "-");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];

/** Дата из строки: 05.10.2026, 05.10.26, 2026-10-05, 5 октября 2026, Excel-число. */
export function parseDate(s: string, fallbackYear = new Date().getFullYear()): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : fallbackYear;
    const mo = Number(m[2]);
    const d = Number(m[1]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = t.toLowerCase().match(/^(\d{1,2})\s+([а-я]+)\.?(?:\s+(\d{4}))?/);
  if (m) {
    const mo = MONTHS.findIndex((x) => m![2].startsWith(x));
    if (mo >= 0) return `${m[3] ?? fallbackYear}-${String(mo + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const serial = Number(t);
    if (serial > 30000 && serial < 70000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

export function detectBank(s: string): BankId | undefined {
  const t = s.toLowerCase();
  if (/сбер|sber|\b900\b|ru\.sberbank/.test(t)) return "sber";
  if (/яндекс|yandex/.test(t)) return "yandex";
  if (/озон|ozon/.test(t)) return "ozon";
  if (/т-банк|t-bank|tbank|тинькофф|tinkoff|idmobile|com\.idamob/.test(t)) return "tbank";
  if (/альфа|alfa/.test(t)) return "alfa";
  if (/втб|vtb/.test(t)) return "vtb";
  if (/газпромбанк|gazprombank/.test(t)) return "gazprom";
  if (/райффайзен|raiffeisen/.test(t)) return "raif";
  if (/мтс.?банк|mtsbank|mts bank/.test(t)) return "mts";
  if (/почта.?банк|pochtabank/.test(t)) return "pochta";
  return undefined;
}

export const SPLIT_RE = /сплит|split|рассрочк|оплата частями|частями|долями|dolyami|подели/i;
export const REFUND_RE = /возврат( покупки| средств| товара|)|отмена (покупки|операции)|refund/i;
