import { detectBank, localDay, parseDate, parseNum, REFUND_RE, SPLIT_RE, type ParsedOp } from "./common.ts";

/*
 * Уведомления и SMS банков → операция. Форматы у банков разные и меняются, поэтому разбор
 * не по шаблонам, а по признакам: сумма с валютой (не после «Баланс/Доступно»), слова операции,
 * карта, время, продавец — текст рядом с суммой.
 *
 *  Сбер SMS:    MIR-1234 12:34 Покупка 1250р PYATEROCHKA Баланс: 10500.50р
 *  Сбер push:   Покупка 350 ₽ KOFEMANIYA · MIR •• 1234 Баланс 12 345,67 ₽
 *  Яндекс:      Покупка 350 ₽ в Кофемания / −350 ₽ · Кофемания
 *  Озон:        Оплата 350,00 ₽. Kofemaniya. Карта *1234. Доступно 1 234 ₽
 *  Т-Банк:      Покупка, карта *1234. 350 RUB. KOFEMANIYA. Доступно 12345.67 RUB
 */

/** Коды, входы, рекламу и отказы не сохраняем вообще. */
const IGNORE_RE =
  /код(а)? (подтвержден|для|:)|никому не (сообщ|говор)|пароль|parol|вход в (приложение|сбербанк онлайн|онлайн)|отказ|отклонен|недостаточно средств|не прошл|не выполнен|ожидает подтвержд|одобрен(а|ы)? (кредит|заявк)|предодобрен|акци(я|и)\b|скидк|ставк[аи] по вклад|оформите|подключите|узнайте/i;

const INCOME_RE =
  /зачислен|поступлен|пополнен|перев[её]л\(?а?\)? вам|вам перевели|перевод от|получен(о|ы)? перевод|входящий перевод|кэшб[эе]к|кешб[эе]к|начислен|выплат|возврат|зарплат|\+\s?\d/i;
const EXPENSE_RE = /покупк|оплат|списан|списали|снят|выдач|платеж|платёж|перевод|оплатили|покупка/i;

// \b не работает с кириллицей — границу слова проверяем явно.
const CURRENCY = String.raw`(₽|руб\.?|р\.?(?![а-яёa-z])|rub(?![a-z])|rur(?![a-z])|\$|usd|€|eur)`;
const AMOUNT_RE = new RegExp(String.raw`([+−–-]\s?)?(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s?` + CURRENCY, "gi");
const BALANCE_WORD = /(баланс|доступно|остаток|лимит|доступный|на счете|на счёте)[:\s]*$/i;

export interface NotifyInput {
  text: string;
  title?: string;
  app?: string;
  receivedAt?: number;
}

export function parseNotification(input: NotifyInput): ParsedOp | null {
  const text = [input.title, input.text].filter(Boolean).join(". ").replace(/\s+/g, " ").trim();
  if (!text || IGNORE_RE.test(text)) return null;

  // Суммы: первая, которая не «Баланс: …»
  type Hit = { value: number; sign: string; index: number; end: number; currency: string };
  const hits: Hit[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const before = text.slice(Math.max(0, m.index! - 22), m.index!);
    if (BALANCE_WORD.test(before)) continue;
    const value = parseNum(m[2] + (m[3] ? "." + m[3] : ""));
    if (!value || value <= 0) continue;
    hits.push({ value, sign: (m[1] ?? "").trim(), index: m.index!, end: m.index! + m[0].length, currency: m[4].toLowerCase() });
  }
  if (!hits.length) return null;
  const hit = hits[0];

  const lower = text.toLowerCase();
  const refund = REFUND_RE.test(lower);
  let kind: "expense" | "income";
  if (hit.sign === "+") kind = "income";
  else if (/[−–-]/.test(hit.sign)) kind = "expense";
  else if (refund) kind = "income";
  else {
    // Ключевое слово, ближайшее к сумме слева, решает: «Перевод от …» — доход, «Покупка» — трата.
    const head = lower.slice(0, hit.index);
    const inc = lastIndex(head, INCOME_RE);
    const exp = lastIndex(head, EXPENSE_RE);
    kind = inc > exp ? "income" : exp >= 0 ? "expense" : INCOME_RE.test(lower) && !EXPENSE_RE.test(lower) ? "income" : "expense";
    if (/перевод от|перев[её]л\(?а?\)? вам|вам перевели|от\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\./i.test(text)) kind = "income";
  }

  const time = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const dateM = text.match(/\b(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)\b(?!\s?(₽|р|руб))/);
  const fallback = localDay(input.receivedAt ?? Date.now());
  let date = (dateM && parseDate(dateM[1])) || fallback;
  if (date > fallback) date = fallback;

  const card = text.match(/(?:\*{1,4}|•+\s?|·{2}\s?|\b(?:mir|visa|ecmc|maestro|mc|сч[её]т|карта|карты|card)[-\s*]*)(\d{4})\b/i)?.[1];

  const currency = /^(₽|р|р\.|руб|руб\.|rub|rur)$/.test(hit.currency) ? undefined : hit.currency.toUpperCase().replace("$", "USD").replace("€", "EUR");

  return {
    kind,
    amount: Math.round(hit.value * 100) / 100,
    date,
    time: time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined,
    merchant: merchantNear(text, hit.index, hit.end, kind),
    raw: text.slice(0, 500),
    card,
    bank: detectBank([input.app, input.title, text].filter(Boolean).join(" ")),
    balance: balanceOf(text),
    refund: refund || undefined,
    split: SPLIT_RE.test(text) || undefined,
    currency,
  };
}

function lastIndex(s: string, re: RegExp): number {
  const g = new RegExp(re.source, "gi");
  let last = -1;
  for (const m of s.matchAll(g)) last = m.index!;
  return last;
}

function balanceOf(text: string): number | undefined {
  const m = text.match(/(?:баланс|доступно|остаток)[:\s]*([+−–-]?\d[\d   ]*(?:[.,]\d{1,2})?)/i);
  const n = m ? parseNum(m[1]) : null;
  return n ?? undefined;
}

const STOP = /(?:\.\s|\s·\s|\s(?:по|через)\s+сбп|баланс|доступно|остаток|карта|карты|счет|счёт|mir|visa|ecmc|кэшб[эе]к|подробнее|$)/i;
const NOISE = /^(покупка|оплата|списание|перевод|зачисление|пополнение|поступление|возврат|в|на|у|от|по|для|·|,|\.|-|—|–|\s)+/i;

/** Продавец или человек: текст сразу после суммы до «Баланс…»; если там пусто — перед суммой. */
function merchantNear(text: string, start: number, end: number, kind: "expense" | "income"): string | undefined {
  const person =
    text.match(/(?:от|отправитель:?)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.)/) ??
    text.match(/([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.)\s+перев[её]л/);
  if (kind === "income" && person) return person[1];
  const after = text.slice(end).replace(/^[\s.,:;·•)]+/, "");
  const stop = after.search(STOP);
  let m = cleanup(after.slice(0, stop < 0 ? undefined : stop));
  if (!m) {
    const before = text.slice(0, start);
    const parts = before.split(/[.,:;·•]\s/).map(cleanup).filter(Boolean);
    m = parts.reverse().find((p) => !/^(покупка|оплата|списание|перевод|зачисление|пополнение)$/i.test(p) && !/\d{2}:\d{2}/.test(p)) ?? "";
  }
  if (!m && person) return person[1];
  return m || undefined;
}

function cleanup(s: string): string {
  return s
    .replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g, "")
    .replace(/[*•]+\s?\d{4}/g, "")
    .replace(/(?:mir|visa|ecmc|maestro|сч[её]т)[-\s]?\d{4}(?!\d)/gi, "")
    .trim()
    .replace(/\s\d{4,}$/, "")
    .replace(NOISE, "")
    .replace(/[\s.,;:·•—–-]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 60);
}
