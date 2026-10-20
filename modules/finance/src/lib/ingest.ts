import { CASH_RE, guessCategory, merchantKey, nameMatches, personFromText, prettyMerchant } from "./categorize.ts";
import { daysBetween } from "./dates.ts";
import { round2 } from "./money.ts";
import type { ParsedOp } from "./parse/common.ts";
import {
  REPAY_CATEGORY, TRANSFER_CATEGORY,
  type AccountDoc, type Category, type DebtDoc, type PersonDoc, type PlanDoc, type Rule, type Source, type Tx, type TxDoc,
} from "./types.ts";

/*
 * Распознанная операция → запись. Чистые функции: всё, что нужно, передаётся в контексте,
 * а запись в базу делает store.tsx.
 */

export interface IngestContext {
  accounts: AccountDoc[];
  categories: Category[];
  rules: Rule[];
  txs: TxDoc[];
  people: PersonDoc[];
  debts: DebtDoc[];
  plans: PlanDoc[];
  /** Как меня зовут в переводах — входящий «от меня» значит перевод между своими счетами. */
  myNames: string[];
}

export interface Draft {
  tx: Tx;
  /** Похожая запись уже есть. */
  duplicateOf?: string;
  /** Долги, которые закрывает этот входящий перевод. */
  repays?: { debt: string; amount: number }[];
  /** Платёж по сплиту: какой план продвинуть. */
  planPayment?: string;
  /** Покупка Сплитом: создать план. */
  newPlan?: boolean;
  /** Обновить баланс счёта по уведомлению. */
  balance?: { account: string; value: number };
}

export function findAccount(op: Pick<ParsedOp, "card" | "bank" | "split">, accounts: AccountDoc[]): AccountDoc | undefined {
  const live = accounts.filter((a) => !a.archived);
  if (op.card) {
    const byCard = live.find((a) => a.cards?.includes(op.card!));
    if (byCard) return byCard;
  }
  if (op.bank) {
    const ofBank = live.filter((a) => a.bank === op.bank);
    if (op.split) {
      const split = ofBank.find((a) => a.type === "split");
      if (split) return split;
    }
    // Без цифр карты: единственная дебетовая карта банка, иначе единственная карта вообще.
    const debit = ofBank.filter((a) => a.type === "card");
    if (debit.length === 1) return debit[0];
    const cards = ofBank.filter((a) => a.type === "card" || a.type === "credit");
    if (cards.length === 1) return cards[0];
    if (ofBank.length === 1) return ofBank[0];
  }
  return undefined;
}

export function draftFromOp(op: ParsedOp, source: Source, ctx: IngestContext, accountOverride?: string): Draft {
  const account = accountOverride ? ctx.accounts.find((a) => a.id === accountOverride) : findAccount(op, ctx.accounts);
  // Переводы подписываем именем человека, а не «Перевод от …».
  const person = /перевод|сбп|перев[её]л/i.test(op.raw) ? personFromText(op.raw) : null;
  const merchant = person ?? (op.merchant ? prettyMerchant(op.merchant) : undefined);
  const known = (kind: "expense" | "income", name: string) => ctx.categories.some((c) => c.kind === kind && c.name === name);

  // Возврат покупки — минус к тратам той же категории, а не доход.
  const kindForGuess = op.refund ? "expense" : op.kind;
  const g = guessCategory({ kind: kindForGuess, merchant, raw: op.raw, bankCategory: op.bankCategory }, ctx.rules, known);

  const tx: Tx = {
    kind: g.kind,
    amount: op.refund ? -op.amount : op.amount,
    category: g.category,
    date: op.date,
    time: op.time,
    merchant,
    account: account?.id,
    source,
    raw: op.raw,
    bankCategory: op.bankCategory,
    card: op.card,
    bank: op.bank ?? account?.bank,
  };
  if (op.currency) tx.note = `В валюте: ${op.currency}`;
  const draft: Draft = { tx };

  const text = `${merchant ?? ""} ${op.raw}`;
  const cash = ctx.accounts.find((a) => a.type === "cash" && !a.archived);
  if (op.kind === "expense" && CASH_RE.test(text.toLowerCase())) {
    if (cash) Object.assign(tx, { kind: "transfer", toAccount: cash.id, category: TRANSFER_CATEGORY });
    else tx.category = known("expense", "Другое") ? "Другое" : tx.category;
  }

  if (tx.kind === "transfer") {
    tx.category = TRANSFER_CATEGORY;
    tx.amount = Math.abs(tx.amount);
    if (g.toAccount) tx.toAccount = g.toAccount;
    // Входящий перевод — деньги пришли на этот счёт: account — откуда (неизвестно), toAccount — сюда.
    if (op.kind === "income" && account) {
      tx.toAccount = account.id;
      tx.account = undefined;
    }
    // Платёж по сплиту/рассрочке: продвигаем ближайший план с подходящей суммой.
    if (op.kind === "expense" && /сплит|split|рассрочк|долями|частями/i.test(text)) {
      const plan = matchPlan(op.amount, op.date, ctx.plans, account);
      if (plan) {
        draft.planPayment = plan.id;
        tx.toAccount = plan.account;
        tx.plan = plan.id;
        // Платёж списывается с обычной карты того же банка, а не со сплита.
        if (account?.type === "split") tx.account = ctx.accounts.find((a) => a.bank === account.bank && a.type === "card" && !a.archived)?.id;
      }
    }
  } else if (g.by === "none") tx.review = true;

  // Перевод от меня самого или себе (на свою карту в другом банке) — между своими счетами.
  if (tx.kind !== "transfer" && ctx.myNames.length && /перевод|сбп|отправитель|получатель/i.test(op.raw)) {
    const who = personFromText(op.raw) ?? "";
    if (who && nameMatches(who, ctx.myNames)) {
      if (op.kind === "income") Object.assign(tx, { kind: "transfer", category: TRANSFER_CATEGORY, toAccount: account?.id, account: undefined });
      else Object.assign(tx, { kind: "transfer", category: TRANSFER_CATEGORY, review: false });
    }
  }

  // Покупка Сплитом / в рассрочку.
  if (op.split && tx.kind === "expense" && tx.amount > 0 && !/платеж|платёж|списали/i.test(op.raw)) draft.newPlan = true;

  // Входящий перевод от друга — возможно, вернул долг.
  if (tx.kind === "income" && !op.refund) {
    const repays = matchRepayment(op, merchant, ctx);
    if (repays) {
      draft.repays = repays;
      tx.excluded = true;
      tx.category = REPAY_CATEGORY;
      tx.review = false;
    }
  }

  const dup = findDuplicate(tx, op, ctx.txs);
  if (dup) draft.duplicateOf = dup.id;
  if (account && op.balance !== undefined && source === "push" && (account.type === "card" || account.type === "savings")) {
    draft.balance = { account: account.id, value: op.balance };
  }
  return draft;
}

function matchPlan(amount: number, date: string, plans: PlanDoc[], account?: AccountDoc): PlanDoc | undefined {
  return plans
    .filter((p) => p.paidParts < p.parts && (!account || account.type !== "split" || p.account === account.id))
    .map((p) => ({ p, part: (p.total + (p.fee ?? 0)) / p.parts }))
    .filter(({ part }) => Math.abs(part - amount) <= Math.max(2, part * 0.02))
    .sort((a, b) => a.p.start.localeCompare(b.p.start))
    .find(({ p }) => p.start <= date)?.p;
}

/** Та же операция уже есть (пришла уведомлением, а теперь — в выписке). */
export function findDuplicate(tx: Tx, op: ParsedOp, txs: TxDoc[]): TxDoc | undefined {
  const mk = merchantKey(tx.merchant ?? "");
  return txs.find((x) => {
    if (x.raw && x.raw === op.raw && x.date === tx.date) return true;
    if (Math.abs(Math.abs(x.amount) - Math.abs(tx.amount)) > 0.01) return false;
    if (Math.abs(daysBetween(x.date, tx.date)) > 1) return false;
    if (x.account && tx.account && x.account !== tx.account && x.toAccount !== tx.toAccount) return false;
    if (x.time && tx.time && x.date === tx.date && Math.abs(minutes(x.time) - minutes(tx.time)) > 5) return false;
    // Та же сумма в ту же минуту на том же счёте — та же операция, как бы ни был записан продавец.
    if (x.time && tx.time && x.date === tx.date && minutes(x.time) === minutes(tx.time) && (!x.account || !tx.account || x.account === tx.account)) return true;
    const xk = merchantKey(x.merchant ?? "");
    if (mk && xk && !(mk.startsWith(xk.split(" ")[0]) || xk.startsWith(mk.split(" ")[0]))) {
      // Разные продавцы с одинаковой суммой — разные покупки, если обе пришли из одного источника.
      if (x.source === "statement" || x.source === tx.source) return false;
    }
    const sameDirection = x.kind === tx.kind || x.kind === "transfer" || tx.kind === "transfer";
    return sameDirection;
  });
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Входящий перевод совпал с открытыми долгами человека: точная сумма одного долга или всех сразу. */
export function matchRepayment(op: Pick<ParsedOp, "amount" | "raw" | "date">, merchant: string | undefined, ctx: Pick<IngestContext, "people" | "debts">) {
  const who = personFromText(op.raw) ?? merchant ?? "";
  if (!who) return null;
  const person = ctx.people.find((p) => nameMatches(who, [p.name, ...(p.aliases ?? [])]));
  if (!person) return null;
  const open = ctx.debts
    .filter((d) => d.person === person.id && d.dir === "owed" && d.amount - d.paid > 0.5 && d.date <= op.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!open.length) return null;
  const left = (d: DebtDoc) => round2(d.amount - d.paid);
  const exact = open.find((d) => Math.abs(left(d) - op.amount) < 1);
  if (exact) return [{ debt: exact.id, amount: op.amount }];
  const total = open.reduce((s, d) => s + left(d), 0);
  // Сумма покрывает несколько долгов — гасим по порядку, начиная со старых (но не больше суммы перевода).
  if (op.amount <= total + 1) {
    const out: { debt: string; amount: number }[] = [];
    let rest = op.amount;
    for (const d of open) {
      if (rest <= 0.5) break;
      const take = Math.min(left(d), rest);
      out.push({ debt: d.id, amount: round2(take) });
      rest -= take;
    }
    return out;
  }
  return null;
}

/** Текст из запроса вебхука: MacroDroid, Tasker, «Команды» шлют разные поля. */
export function hookText(doc: Record<string, unknown>): { text: string; title?: string; app?: string } | null {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = doc[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };
  const text = pick("text", "message", "body", "notification", "sms", "content", "msg", "bigtext", "big_text");
  if (!text) return null;
  return { text, title: pick("title", "subject", "sender", "from"), app: pick("app", "package", "app_name", "appName", "source") };
}
