import { guessCategory, isGenericKey, nameMatches, personFromText, prettyMerchant } from "./categorize.ts";
import { daysBetween } from "./dates.ts";
import { detectBank } from "./parse/common.ts";
import { cleanStatementText, ozonMerchant } from "./parse/statement.ts";
import { BANKS, TRANSFER_CATEGORY, type Account, type AccountDoc, type BankId, type Category, type DebtDoc, type PersonDoc, type Rule, type Tx, type TxDoc } from "./types.ts";

/*
 * Наведение порядка в уже записанных операциях — модуль делает это сам после загрузки и импорта:
 *  1. точные дубли (та же строка банка: дата, время, сумма и текст с остатком) — лишние копии удаляются;
 *  2. карты, по которым много операций, становятся счетами; операции раскладываются по ним;
 *  3. переводы себе: списание с одной своей карты и зачисление на другую (тот же банк или другой) с той же суммой
 *     почти в то же время склеиваются в один перевод — это не трата и не доход.
 */

/** Ключ строки банка. Остаток после операции в тексте делает его уникальным для настоящих операций. */
export const rowKey = (t: Pick<Tx, "date" | "time" | "amount" | "raw">) => (t.raw ? `${t.date}|${t.time ?? ""}|${Math.abs(t.amount)}|${t.raw.trim()}` : null);

export function exactDuplicates(txs: TxDoc[]): string[] {
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const t of [...txs].sort((a, b) => a.createdAt - b.createdAt)) {
    const k = rowKey(t);
    if (!k) continue;
    if (seen.has(k)) extra.push(t.id);
    else seen.add(k);
  }
  return extra;
}

/** Банк операции: по полю, по тексту, по формулировкам Сбера («Операция по карте ****1234»). */
export function bankOf(t: Tx): BankId | undefined {
  if (t.bank) return t.bank;
  const raw = t.raw ?? "";
  return detectBank(raw) ?? (/операция по (карте|сч[её]ту) \*{4}\d{4}/i.test(raw) ? "sber" : undefined);
}

/**
 * Карты, которые явно мои: на них много операций, а счёта для них ещё нет.
 * Сбер в выписке пишет покупки «по карте ****8383», а переводы — «по счёту ****2580»: это один счёт,
 * поэтому номер счёта присоединяется к единственной карте того же банка, с которой операции идут в те же даты.
 */
export function newCardAccounts(txs: TxDoc[], accounts: AccountDoc[]): Account[] {
  const known = new Set(accounts.flatMap((a) => a.cards ?? []));
  const info = new Map<string, { n: number; bank?: BankId; isAccount: boolean; from: string; to: string }>();
  for (const t of txs) {
    if (!t.card || t.account || t.toAccount || known.has(t.card)) continue;
    const c = info.get(t.card) ?? { n: 0, bank: undefined, isAccount: false, from: t.date, to: t.date };
    c.n++;
    c.bank ??= bankOf(t);
    if (new RegExp(`по сч[её]ту \\*+${t.card}`, "i").test(t.raw ?? "")) c.isAccount = true;
    if (t.date < c.from) c.from = t.date;
    if (t.date > c.to) c.to = t.date;
    info.set(t.card, c);
  }
  const mine = [...info.entries()].filter(([, c]) => c.n >= 8);
  const out: Account[] = [];
  const joined = new Set<string>();
  for (const [card, c] of mine) {
    if (c.isAccount) continue;
    const single = mine.filter(([, x]) => !x.isAccount && x.bank === c.bank).length === 1;
    const extra = single ? mine.filter(([n, x]) => x.isAccount && x.bank === c.bank && !joined.has(n) && x.from <= c.to && c.from <= x.to).map(([n]) => n) : [];
    extra.forEach((n) => joined.add(n));
    out.push({ name: `${BANKS[c.bank ?? "other"].name} •${card}`, bank: c.bank ?? "other", type: "card", cards: [card, ...extra] });
  }
  for (const [card, c] of mine) {
    if (c.isAccount && !joined.has(card)) out.push({ name: `${BANKS[c.bank ?? "other"].name} •${card}`, bank: c.bank ?? "other", type: "card", cards: [card] });
  }
  return out;
}

/** Направление перевода, записанного без счетов: «+» в строке банка — зачисление. */
const incoming = (t: Tx) => /(^|\s)\+\s?\d/.test(t.raw ?? "");

/** Операции без счёта, но с картой, у которой счёт есть. */
export function accountByCard(txs: TxDoc[], accounts: AccountDoc[]): { id: string; patch: Partial<Tx> }[] {
  const out: { id: string; patch: Partial<Tx> }[] = [];
  for (const t of txs) {
    if (t.account || t.toAccount || !t.card) continue;
    const a = accounts.find((x) => x.cards?.includes(t.card!));
    if (!a) continue;
    // Перевод, записанный без счетов: зачисление — «куда», списание — «откуда».
    out.push({ id: t.id, patch: t.kind === "transfer" && incoming(t) ? { toAccount: a.id } : { account: a.id } });
  }
  return out;
}

const TRANSFER_LIKE = /перевод|сбп|с карты|на карту|пополнен|зачислен|transfer|sbol|между|себе|t-bank|yandex|яндекс|т-банк|тинькофф|озон|ozon/i;
const TRANSFER_CATS = ["Переводы людям", "Переводы от людей", TRANSFER_CATEGORY, "Другое"];

function looksTransfer(t: TxDoc) {
  if (/qr|оплата по|покупк/i.test(t.raw ?? "")) return false;
  return TRANSFER_CATS.includes(t.category) && TRANSFER_LIKE.test(`${t.raw ?? ""} ${t.merchant ?? ""} ${t.bankCategory ?? ""}`);
}

/** Время: из поля или из строки банка (у Т-Банка оно стоит после описания). */
function minutesOf(t: TxDoc): number | null {
  const m = t.time?.match(/^(\d{2}):(\d{2})/) ?? (t.raw ?? "").match(/(?:^|\s)([01]\d|2[0-3]):([0-5]\d)(?=\s|$)/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** «Откуда» и «куда»: обычные трата/приход, похожие на перевод, или перевод, записанный только с одной стороны. */
const outSide = (t: TxDoc) =>
  !t.excluded && t.amount > 0 && ((t.kind === "expense" && !!t.account && looksTransfer(t)) || (t.kind === "transfer" && !!t.account && !t.toAccount));
const incSide = (t: TxDoc) => !t.excluded && ((t.kind === "income" && !!t.account && looksTransfer(t)) || (t.kind === "transfer" && !!t.toAccount && !t.account));
const accOf = (t: TxDoc) => t.account ?? t.toAccount;

export interface SelfPair {
  out: TxDoc;
  inc: TxDoc;
}

/**
 * Переводы себе: трата на одном своём счёте + приход на другом, та же сумма, тот же день (или соседний),
 * при известном времени — не дальше 30 минут. Входящий от знакомого человека (из «Общака») — не пара.
 */
export function findSelfPairs(txs: TxDoc[], opts: { myNames: string[]; people: PersonDoc[]; accounts?: AccountDoc[] }): SelfPair[] {
  const outs = txs.filter(outSide);
  const incs = txs.filter(incSide);
  const bankOfAcc = (id?: string) => opts.accounts?.find((a) => a.id === id)?.bank;
  const byAmount = new Map<number, TxDoc[]>();
  for (const t of incs) byAmount.set(Math.round(t.amount * 100), [...(byAmount.get(Math.round(t.amount * 100)) ?? []), t]);

  const cands: { out: TxDoc; inc: TxDoc; gap: number }[] = [];
  for (const o of outs) {
    for (const i of byAmount.get(Math.round(o.amount * 100)) ?? []) {
      if (i.id === o.id || accOf(i) === accOf(o)) continue;
      const days = daysBetween(o.date, i.date);
      if (days < -1 || days > 1) continue;
      const mo = minutesOf(o);
      const mi = minutesOf(i);
      const sameBank = (bankOfAcc(accOf(o)) ?? bankOf(o)) === (bankOfAcc(accOf(i)) ?? bankOf(i));
      let gap = Math.abs(days) * 1440 + 600;
      if (mo !== null && mi !== null) {
        const g = days * 1440 + mi - mo;
        // Разные банки пишут время по-разному (МСК или UTC) — допускаем сдвиг на 3 часа.
        gap = sameBank ? Math.abs(g) : Math.min(Math.abs(g), Math.abs(g - 180), Math.abs(g + 180));
        if (gap > 30) continue;
      } else if (days !== 0) continue;
      // Друг из «Общака» вернул ту же сумму — это не перевод себе.
      const who = personFromText(i.raw ?? "") ?? i.merchant ?? "";
      const friend = opts.people.some((p) => nameMatches(who, [p.name, ...(p.aliases ?? [])]));
      if (friend && !nameMatches(who, opts.myNames)) continue;
      // Если имя получателя известно и это не я — тоже не пара.
      const to = personFromText(o.raw ?? "");
      if (opts.myNames.length && to && !nameMatches(to, opts.myNames)) continue;
      cands.push({ out: o, inc: i, gap });
    }
  }
  cands.sort((a, b) => a.gap - b.gap);
  const used = new Set<string>();
  const pairs: SelfPair[] = [];
  for (const c of cands) {
    if (used.has(c.out.id) || used.has(c.inc.id)) continue;
    used.add(c.out.id);
    used.add(c.inc.id);
    pairs.push({ out: c.out, inc: c.inc });
  }
  return pairs;
}

/** Склейка пары: списание становится переводом на счёт зачисления, зачисление удаляется. */
export function mergePair(p: SelfPair): { id: string; patch: Partial<Tx> } {
  return {
    id: p.out.id,
    patch: {
      kind: "transfer",
      category: TRANSFER_CATEGORY,
      toAccount: accOf(p.inc),
      review: false,
      raw: `${p.out.raw ?? ""}\n↳ ${p.inc.raw ?? p.inc.merchant ?? ""}`.slice(0, 900),
    },
  };
}

/**
 * Перевод в свой банк, выписки которого ещё нет: Сбер пишет «Перевод СБП … Яндекс», а у пользователя заведён
 * счёт Яндекса — это перевод на него (видна одна сторона). Только если счёт этого банка один и в строке нет имени.
 */
export function transfersByBank(txs: TxDoc[], accounts: AccountDoc[]): { id: string; patch: Partial<Tx> }[] {
  const out: { id: string; patch: Partial<Tx> }[] = [];
  const live = accounts.filter((a) => !a.archived && (a.type === "card" || a.type === "savings"));
  for (const t of txs) {
    if (t.excluded || !t.account || (t.kind !== "expense" && t.kind !== "income") || !looksTransfer(t)) continue;
    if (!/перевод/i.test(t.raw ?? "") || /qr|оплат|возврат покупки/i.test(t.raw ?? "") || personFromText(t.raw ?? "")) continue;
    const own = accounts.find((a) => a.id === t.account)?.bank;
    const target = detectBank((t.raw ?? "").replace(/операция по (карте|сч[её]ту).*/i, ""));
    if (!target || target === own) continue;
    const accs = live.filter((a) => a.bank === target);
    if (accs.length !== 1) continue;
    out.push({
      id: t.id,
      patch:
        t.kind === "expense"
          ? { kind: "transfer", category: TRANSFER_CATEGORY, toAccount: accs[0].id, review: false }
          : { kind: "transfer", category: TRANSFER_CATEGORY, account: accs[0].id, toAccount: t.account, review: false },
    });
  }
  return out;
}

/* ───────────── свои номера телефонов ───────────── */

const PHONE_RE = /(?:\+7|(?<!\d)8)[\s(-]*(\d{3})[\s)-]*(\d{3})[\s-]*(\d{2})[\s-]*(\d{2})(?!\d)/;

/** Номер из строки банка в виде +79991234567. */
export function phoneOf(s: string): string | null {
  const m = s.match(PHONE_RE);
  return m ? `+7${m[1]}${m[2]}${m[3]}${m[4]}` : null;
}

export const prettyPhone = (p: string) => p.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2-$3-$4");

/** Номера, на которые вы часто переводите (5+ раз), — кандидаты в «мой номер». */
export function frequentPhones(txs: TxDoc[], decided: string[]): { phone: string; count: number; sum: number }[] {
  const m = new Map<string, { count: number; sum: number }>();
  for (const t of txs) {
    if (t.kind !== "expense" || t.excluded) continue;
    const p = phoneOf(t.raw ?? "");
    if (!p || decided.includes(p)) continue;
    const x = m.get(p) ?? { count: 0, sum: 0 };
    x.count++;
    x.sum += t.amount;
    m.set(p, x);
  }
  return [...m.entries()].filter(([, x]) => x.count >= 5).map(([phone, x]) => ({ phone, ...x })).sort((a, b) => b.count - a.count);
}

/** Переводы на свой номер (в другой свой банк) — не траты. */
export function transfersToMyPhones(txs: TxDoc[], myPhones: string[]): { id: string; patch: Partial<Tx> }[] {
  if (!myPhones.length) return [];
  return txs
    .filter((t) => t.kind === "expense" && !t.excluded && myPhones.includes(phoneOf(t.raw ?? "") ?? ""))
    .map((t) => ({ id: t.id, patch: { kind: "transfer" as const, category: TRANSFER_CATEGORY, review: false } }));
}

/** Имена продавцов из старых импортов: «11542152787 Погашение …» → «Погашение кредита», «… сумма 320.70 в SEZON …» → «SEZON». */
export function cleanMerchants(txs: TxDoc[]): { id: string; patch: Partial<Tx> }[] {
  const out: { id: string; patch: Partial<Tx> }[] = [];
  for (const t of txs) {
    if (!t.merchant) continue;
    // Т-Банк: имя начинается с даты и содержит номер карты и время.
    if (/^\d{1,2}\.\d{1,2}\.\d{2,4}\s/.test(t.merchant)) {
      const better = prettyMerchant(cleanStatementText(t.merchant));
      if (better && better !== t.merchant) out.push({ id: t.id, patch: { merchant: better.slice(0, 80) } });
      continue;
    }
    if (!/^\d{6,}\s/.test(t.merchant)) continue;
    const firstLine = (t.raw ?? "").replace(/^\s*\d{1,2}\.\d{1,2}\.\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?\s*/, "");
    const better = ozonMerchant(firstLine.replace(/[+−–-]\s?[\d\s]+[.,]\d{2}\s?₽/g, " ").replace(/\s+/g, " ")) ?? t.merchant.replace(/^\d{6,}\s+/, "");
    if (better && better !== t.merchant) out.push({ id: t.id, patch: { merchant: better.slice(0, 80) } });
  }
  return out;
}

/** Переводы на своё имя или от себя («Перевод для П. Максим Сергеевич», «Отправитель: Максим Сергеевич П.») — не траты и не доходы. */
export function transfersByName(txs: TxDoc[], myNames: string[]): { id: string; patch: Partial<Tx> }[] {
  if (!myNames.length) return [];
  const out: { id: string; patch: Partial<Tx> }[] = [];
  for (const t of txs) {
    if ((t.kind !== "expense" && t.kind !== "income") || t.excluded || !/перевод|сбп|отправитель|получатель/i.test(t.raw ?? "")) continue;
    const who = personFromText(t.raw ?? "");
    if (!who || !nameMatches(who, myNames)) continue;
    out.push({
      id: t.id,
      patch: t.kind === "expense" ? { kind: "transfer", category: TRANSFER_CATEGORY, review: false } : { kind: "transfer", category: TRANSFER_CATEGORY, toAccount: t.account, account: NONE, review: false },
    });
  }
  return out;
}

/** Убрать поле при слиянии на сервере (undefined в JSON теряется, null — нет; в коде null читается как «нет»). */
const NONE = null as unknown as undefined;

/* ───────────── возвраты долгов без имени ───────────── */

/** Не похоже на перевод от человека: зарплата, кэшбэк, проценты, возврат покупки. */
const NOT_FROM_PERSON = ["Зарплата", "Кэшбэк и бонусы", "Проценты по вкладам", "Подработка"];

/**
 * В выписках часто не видно, кто перевёл. Тогда возврат узнаётся по сумме и времени: после траты, которую поделили,
 * в течение 14 дней пришёл перевод на сумму чьей-то доли (точно или округлив вверх до 50/100 ₽) или на все оставшиеся доли траты сразу.
 * Ближайшие по времени — первыми; каждый долг и каждый перевод — один раз.
 */
export function autoRepayments(
  txs: TxDoc[],
  debts: DebtDoc[],
  opts: { people: PersonDoc[]; myNames: string[]; hidden: string[] },
): { tx: TxDoc; repays: { debt: string; amount: number }[] }[] {
  const left = (d: DebtDoc) => Math.max(0, d.amount - d.paid);
  const open = debts.filter((d) => d.dir === "owed" && left(d) > 0.5);
  if (!open.length) return [];
  const spentAt = new Map(txs.map((t) => [t.id, t]));
  const used = new Set<string>();
  const out: { tx: TxDoc; repays: { debt: string; amount: number }[] }[] = [];
  const incomes = txs
    .filter((t) => t.kind === "income" && !t.excluded && !NOT_FROM_PERSON.includes(t.category) && !opts.hidden.includes(`repay:${t.id}`))
    .filter((t) => /перевод|сбп|пополнен|зачислен|transfer/i.test(`${t.raw ?? ""} ${t.merchant ?? ""}`) && !/возврат (покупки|оплаты)/i.test(t.raw ?? ""))
    .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
  for (const inc of incomes) {
    const who = personFromText(inc.raw ?? "");
    if (who && nameMatches(who, opts.myNames)) continue;
    const named = who ? opts.people.find((p) => nameMatches(who, [p.name, ...(p.aliases ?? [])])) : undefined;
    // Долги, которые этот перевод мог вернуть: после траты, не позже 14 дней; известное имя — только его долги.
    const fits = open.filter((d) => {
      if (used.has(d.id)) return false;
      if (named ? d.person !== named.id : who && d.person) return false;
      const days = daysBetween(d.date, inc.date);
      if (days < 0 || days > 14) return false;
      const spend = d.tx ? spentAt.get(d.tx) : undefined;
      if (days === 0 && spend?.time && inc.time && inc.time < spend.time) return false;
      return true;
    });
    if (!fits.length) continue;
    const near = (d: DebtDoc) => daysBetween(d.date, inc.date);
    // Чья-то одна доля.
    // Точно (±1 ₽) или округлили вверх до круглой суммы («должен 1 070 — кинул 1 100»), не больше чем на 100 ₽ и 10 %.
    const diff = (d: DebtDoc) => Math.abs(left(d) - inc.amount);
    const roundedUp = (d: DebtDoc) => inc.amount > left(d) && inc.amount % 50 === 0 && inc.amount - left(d) <= Math.min(100, left(d) * 0.1);
    const one = fits.filter((d) => diff(d) <= 1 || roundedUp(d)).sort((a, b) => diff(a) - diff(b) || near(a) - near(b))[0];
    if (one) {
      used.add(one.id);
      out.push({ tx: inc, repays: [{ debt: one.id, amount: Math.min(inc.amount, left(one)) }] });
      continue;
    }
    // Один перевёл за всех (все оставшиеся доли одной траты).
    const byTx = new Map<string, DebtDoc[]>();
    for (const d of fits) if (d.tx) byTx.set(d.tx, [...(byTx.get(d.tx) ?? []), d]);
    for (const group of byTx.values()) {
      const all = open.filter((d) => d.tx === group[0].tx && !used.has(d.id));
      if (all.length < 2 || all.length !== group.length) continue;
      const sum = all.reduce((s, d) => s + left(d), 0);
      if (Math.abs(sum - inc.amount) > 1) continue;
      all.forEach((d) => used.add(d.id));
      out.push({ tx: inc, repays: all.map((d) => ({ debt: d.id, amount: left(d) })) });
      break;
    }
  }
  return out;
}

/* ───────────── правила и категории ───────────── */

/** Правила, которые не про продавца: по дате («18 10 оплата»), по способу оплаты («qr оплата сбп»), слишком короткие. */
export const badRule = (r: Rule) => !r.match || isGenericKey(r.match);

/**
 * Пересчёт категорий после чистки правил: только там, где категорию теперь уверенно даёт правило, словарь или банк,
 * а QR-оплаты, попавшие в «Переводы людям», — в «Другое» на проверку. Переводы, возвраты долгов и общак не трогаем.
 */
export function recategorize(txs: TxDoc[], rules: Rule[], categories: Category[]): { id: string; patch: Partial<Tx> }[] {
  const known = (k: "expense" | "income", name: string) => categories.some((c) => c.kind === k && c.name === name);
  const out: { id: string; patch: Partial<Tx> }[] = [];
  for (const t of txs) {
    if ((t.kind !== "expense" && t.kind !== "income") || t.excluded || t.share !== undefined || t.source === "manual") continue;
    const g = guessCategory({ kind: t.amount < 0 ? "expense" : t.kind, merchant: t.merchant, raw: t.raw, bankCategory: t.bankCategory }, rules, known);
    if (g.kind !== t.kind) continue;
    if ((g.by === "rule" || g.by === "dict" || g.by === "bank") && g.category && g.category !== t.category) out.push({ id: t.id, patch: { category: g.category, review: false } });
    else if (t.category === "Переводы людям" && /qr/i.test(`${t.raw ?? ""} ${t.bankCategory ?? ""} ${t.merchant ?? ""}`)) out.push({ id: t.id, patch: { category: g.category || "Другое", review: true } });
  }
  return out;
}
