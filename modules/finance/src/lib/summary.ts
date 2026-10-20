import { monthStats } from "./analytics.ts";
import type { AccountState } from "./accounts.ts";
import { shiftMonth, today } from "./dates.ts";
import { round2 } from "./money.ts";
import { isDebtAccount, type BankId, type Category, type TxDoc } from "./types.ts";

/*
 * Сводка для других модулей (ключ useStore "summary", открыт в exports.stores).
 * «Инвестиции» берут из неё расходы в месяц и деньги на счетах для подушки безопасности.
 * Формат только расширяется; version — на случай несовместимых изменений.
 */

export interface FinanceSummary {
  version: 1;
  /** Когда посчитано (ISO). */
  updatedAt: string;
  /** Средние траты в месяц за полные месяцы (моя доля в общих, без переводов себе и возвратов долгов). */
  monthlyExpenses: number;
  /** Из них обязательные — категории, отмеченные 📌 (жильё, связь). */
  monthlyFixed: number;
  monthlyIncome: number;
  /** За сколько полных месяцев среднее (0–3). */
  monthsCounted: number;
  /** Какие месяцы (YYYY-MM). */
  months: string[];
  /** Деньги на дебетовых, накопительных счетах и наличные — только с известным балансом. */
  accounts: { id: string; name: string; bank: BankId; type: "card" | "savings" | "cash"; balance: number; balanceAt?: string }[];
  /** Долги по кредиткам и сплитам. */
  debts: { id: string; name: string; bank: BankId; type: "credit" | "split"; debt: number; nextDue?: string; nextAmount?: number }[];
}

export function buildSummary(txs: TxDoc[], states: AccountState[], categories: Category[]): FinanceSummary {
  const cur = today().slice(0, 7);
  // Полные месяцы с операциями (до трёх последних), текущий не берём — он неполный.
  const months: string[] = [];
  for (let i = 1; i <= 12 && months.length < 3; i++) {
    const m = shiftMonth(cur, -i);
    if (txs.some((t) => t.date.startsWith(m))) months.push(m);
  }
  const fixed = new Set(categories.filter((c) => c.kind === "expense" && c.fixed).map((c) => c.name));
  let spent = 0;
  let fixedSum = 0;
  let income = 0;
  for (const m of months) {
    const s = monthStats(txs, m);
    spent += s.spent;
    income += s.income;
    fixedSum += s.byCategory.filter((c) => fixed.has(c.name)).reduce((a, c) => a + c.value, 0);
  }
  const n = months.length || 1;
  const live = states.filter((s) => !s.account.archived);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    monthlyExpenses: Math.round(spent / n),
    monthlyFixed: Math.round(fixedSum / n),
    monthlyIncome: Math.round(income / n),
    monthsCounted: months.length,
    months,
    accounts: live
      .filter((s) => !isDebtAccount(s.account) && s.balance !== null)
      .map((s) => ({
        id: s.account.id,
        name: s.account.name,
        bank: s.account.bank,
        type: s.account.type as "card" | "savings" | "cash",
        balance: round2(s.balance ?? 0),
        balanceAt: s.account.balanceAt,
      })),
    debts: live
      .filter((s) => isDebtAccount(s.account) && s.debt > 0.5)
      .map((s) => ({
        id: s.account.id,
        name: s.account.name,
        bank: s.account.bank,
        type: s.account.type as "credit" | "split",
        debt: round2(s.debt),
        nextDue: s.graceEnd ?? s.dueDate,
        nextAmount: s.graceAmount,
      })),
  };
}

/** Сравнение без времени расчёта — чтобы не переписывать ключ на каждый рендер. */
export const summaryKey = (s: FinanceSummary | null) => (s ? JSON.stringify({ ...s, updatedAt: "" }) : "");
