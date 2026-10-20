import type { WithDoc } from "@lifehub/sdk";
import type { Cashback } from "./cashback.ts";

/*
 * Формат данных модуля. Коллекция transactions открыта другим модулям (Джарвис читает траты),
 * поэтому поля только добавляются: старые записи { kind, amount, category, date, note } остаются валидными.
 */

export type Kind = "expense" | "income" | "transfer";

export type Source = "manual" | "push" | "statement" | "share" | "jarvis";

export interface Tx {
  kind: Kind;
  /** Полная сумма операции, всегда положительная. */
  amount: number;
  category: string;
  /** YYYY-MM-DD */
  date: string;
  note?: string;
  /** HH:MM */
  time?: string;
  /** Продавец или человек — как в банке, но почищено (KOFEMANIYA → Kofemaniya). */
  merchant?: string;
  /** id счёта (карты, кредитки, сплита). */
  account?: string;
  /** Перевод: куда (свой счёт). */
  toAccount?: string;
  /** Моя доля, если трату делили (общак). Для трат считается она, а не amount. */
  share?: number;
  /** Не учитывать в доходах и расходах (возврат долга, отмена). */
  excluded?: boolean;
  source?: Source;
  /** Исходный текст уведомления или строки выписки — для проверки и повторного разбора. */
  raw?: string;
  /** Категория, которую дал банк (Сбер: «Супермаркеты»). */
  bankCategory?: string;
  /** Последние 4 цифры карты из уведомления. */
  card?: string;
  /** Банк, из которого пришла операция (уведомление, выписка). */
  bank?: BankId;
  /** Категорию угадали — стоит проверить. */
  review?: boolean;
  /** Фото к операции (id файлов модуля): чек, что купили. */
  photos?: string[];
  /** Что прочитала нейронка на чеке. */
  receipt?: Receipt;
  /** Возврат долга отмечен автоматически по сумме и времени (в выписке нет имени) — можно отменить. */
  repayGuess?: boolean;
  /** id рассрочки/сплита, к которому относится покупка. */
  plan?: string;
}

export type AccountType = "card" | "credit" | "split" | "cash" | "savings";

export interface Account {
  name: string;
  bank: BankId;
  type: AccountType;
  /** Последние 4 цифры карт этого счёта — по ним уведомления раскладываются по счетам. */
  cards?: string[];
  /** Баланс (для кредитки и сплита — долг) на момент balanceAt. Дальше считается по операциям. */
  balance?: number;
  balanceAt?: string;
  /** Когда баланс сверили (мс): операции, записанные позже в тот же день, ещё не учтены в нём. */
  balanceTs?: number;
  /** Кредитка и сплит: лимит. */
  limit?: number;
  /** Кредитка: беспроцентный период, дней (если периоды не заданы явно). */
  graceDays?: number;
  /**
   * Кредитка: льготные периоды, как их показывает банк (у Озона — свой срок у покупок каждого месяца).
   * month — месяц покупок YYYY-MM (без него периоды достаются месяцам по порядку), amount — сумма из приложения банка.
   */
  graces?: Grace[];
  /** Кредитка: день месяца, когда формируется выписка. */
  statementDay?: number;
  /** Кредитка: день месяца, до которого вносить платёж. */
  dueDay?: number;
  /** Ставка после льготного периода, % годовых. */
  rate?: number;
  archived?: boolean;
  color?: string;
  /** Кэшбэк: базовый процент и повышенные категории (см. lib/cashback.ts). */
  cashback?: Cashback;
}

export interface Receipt {
  merchant?: string;
  total?: number;
  category?: string;
  items: { name: string; price: number; qty?: number }[];
  at: number;
}

export interface Grace {
  until: string;
  month?: string;
  amount?: number;
}

export type BankId = "sber" | "yandex" | "ozon" | "tbank" | "alfa" | "vtb" | "gazprom" | "raif" | "mts" | "pochta" | "cash" | "other";

export interface Person {
  name: string;
  /** Как человек подписан в переводах: «Иван Иванович И.», телефон. */
  aliases?: string[];
  phone?: string;
  emoji?: string;
}

/** Долг: кто-то должен мне (owed) или я должен (owe). */
export interface Debt {
  /** id человека; "" — без имени («нас было трое»). */
  person: string;
  dir: "owed" | "owe";
  amount: number;
  /** Сколько уже вернули. */
  paid: number;
  date: string;
  note?: string;
  /** Трата, которую делили. */
  tx?: string;
  /** Переводы, которыми долг вернули. */
  repaidBy?: string[];
  closedAt?: string;
}

/** Рассрочка / Сплит: покупка, разбитая на платежи. */
export interface Plan {
  account: string;
  title: string;
  total: number;
  /** Дата первого платежа (YYYY-MM-DD). */
  start: string;
  parts: number;
  /** Интервал между платежами. */
  every: "2w" | "1m";
  /** Сколько платежей уже внесено. */
  paidParts: number;
  /** Комиссия за весь сплит (если долгий). */
  fee?: number;
  tx?: string;
}

export interface Category {
  name: string;
  icon: string;
  kind: "expense" | "income";
  /** Лимит на месяц, ₽. */
  limit?: number;
  /** Обязательная трата (жильё, связь) — не «урезать». */
  fixed?: boolean;
}

/** Правило: продавец → категория (выучено по правкам пользователя). */
export interface Rule {
  match: string;
  category: string;
  kind?: Kind;
  /** Пометить как перевод на свой счёт. */
  toAccount?: string;
}

export type TxDoc = WithDoc<Tx>;
export type AccountDoc = WithDoc<Account>;
export type PersonDoc = WithDoc<Person>;
export type DebtDoc = WithDoc<Debt>;
export type PlanDoc = WithDoc<Plan>;

/** Сумма, которая считается тратой: моя доля, если делили. */
export const spent = (t: Tx) => (t.kind === "expense" && !t.excluded ? (t.share ?? t.amount) : 0);
export const earned = (t: Tx) => (t.kind === "income" && !t.excluded ? t.amount : 0);

export const DEFAULT_CATEGORIES: Category[] = [
  { name: "Продукты", icon: "🛒", kind: "expense" },
  { name: "Кафе", icon: "☕", kind: "expense" },
  { name: "Доставка еды", icon: "🛵", kind: "expense" },
  { name: "Транспорт", icon: "🚇", kind: "expense" },
  { name: "Такси", icon: "🚕", kind: "expense" },
  { name: "Авто", icon: "⛽", kind: "expense" },
  { name: "Дом", icon: "🏠", kind: "expense", fixed: true },
  { name: "Связь и интернет", icon: "📶", kind: "expense", fixed: true },
  { name: "Маркетплейсы", icon: "📦", kind: "expense" },
  { name: "Одежда", icon: "👕", kind: "expense" },
  { name: "Здоровье", icon: "💊", kind: "expense" },
  { name: "Красота", icon: "💇", kind: "expense" },
  { name: "Спорт", icon: "🏋️", kind: "expense" },
  { name: "Развлечения", icon: "🎮", kind: "expense" },
  { name: "Подписки", icon: "📱", kind: "expense" },
  { name: "Образование", icon: "🎓", kind: "expense" },
  { name: "Путешествия", icon: "✈️", kind: "expense" },
  { name: "Подарки", icon: "🎁", kind: "expense" },
  { name: "Переводы людям", icon: "👤", kind: "expense" },
  { name: "Проценты и комиссии", icon: "🧾", kind: "expense" },
  { name: "Другое", icon: "💸", kind: "expense" },
  { name: "Зарплата", icon: "💼", kind: "income" },
  { name: "Подработка", icon: "🧰", kind: "income" },
  { name: "Кэшбэк и бонусы", icon: "🪙", kind: "income" },
  { name: "Переводы от людей", icon: "🤝", kind: "income" },
  { name: "Проценты по вкладам", icon: "🏦", kind: "income" },
  { name: "Подарки", icon: "🎁", kind: "income" },
  { name: "Другое", icon: "💰", kind: "income" },
];

export const TRANSFER_CATEGORY = "Перевод между счетами";
export const REPAY_CATEGORY = "Возврат долга";

export const BANKS: Record<BankId, { name: string; color: string; short: string }> = {
  sber: { name: "Сбер", color: "#21a038", short: "С" },
  yandex: { name: "Яндекс Банк", color: "#fc3f1d", short: "Я" },
  ozon: { name: "Озон Банк", color: "#005bff", short: "O" },
  tbank: { name: "Т-Банк", color: "#ffdd2d", short: "Т" },
  alfa: { name: "Альфа-Банк", color: "#ef3124", short: "А" },
  vtb: { name: "ВТБ", color: "#0a2896", short: "В" },
  gazprom: { name: "Газпромбанк", color: "#0b3c8c", short: "Г" },
  raif: { name: "Райффайзен", color: "#fee600", short: "R" },
  mts: { name: "МТС Банк", color: "#e30611", short: "М" },
  pochta: { name: "Почта Банк", color: "#2a3f9d", short: "П" },
  cash: { name: "Наличные", color: "#6b7a5e", short: "₽" },
  other: { name: "Другой банк", color: "#7c8593", short: "•" },
};

export const ACCOUNT_TYPES: Record<AccountType, string> = {
  card: "Дебетовая карта",
  credit: "Кредитная карта",
  split: "Сплит / рассрочка",
  cash: "Наличные",
  savings: "Накопительный счёт",
};

/** Счёт-долг: баланс — это сколько я должен. */
export const isDebtAccount = (a: Account) => a.type === "credit" || a.type === "split";
