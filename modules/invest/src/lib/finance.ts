import { useEffect, useState } from "react";
import { kv } from "@lifehub/sdk";
import type { OtherAsset } from "./types.ts";

/*
 * Связь с модулем «Финансы» (разрешение read:finance): его сводка — средние траты в месяц по реальным операциям,
 * остатки на картах и накопительных счетах, долги по кредиткам и сплитам. Отсюда подушка безопасности считается
 * без ручного ввода. Формат чужой — читаем осторожно: любое поле может отсутствовать.
 */

export interface FinanceSummary {
  version?: number;
  updatedAt?: string;
  monthlyExpenses?: number;
  monthlyFixed?: number;
  monthlyIncome?: number;
  monthsCounted?: number;
  accounts?: { id: string; name: string; bank?: string; type?: string; balance?: number; balanceAt?: string }[];
  debts?: { id: string; name: string; type?: string; debt?: number; nextDue?: string }[];
}

export interface FinanceLink {
  summary: FinanceSummary;
  /** Средние траты в месяц (0 — мало данных). */
  expenses: number;
  /** Деньги на картах, накопительных и наличные — как «сбережения вне брокеров». */
  assets: OtherAsset[];
  /** Долги по кредиткам и сплитам. */
  debts: number;
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

function toLink(s: FinanceSummary | null): FinanceLink | null {
  if (!s || typeof s !== "object") return null;
  const assets: OtherAsset[] = (Array.isArray(s.accounts) ? s.accounts : [])
    .filter((a) => a && num(a.balance) > 0)
    .map((a) => ({ id: `fin:${a.id}`, name: a.name || "Счёт", kind: a.type === "savings" ? "deposit" : "cash", amount: num(a.balance), fromFinance: true }));
  const debts = (Array.isArray(s.debts) ? s.debts : []).reduce((t, d) => t + Math.max(0, num(d?.debt)), 0);
  return { summary: s, expenses: (s.monthsCounted ?? 0) > 0 ? Math.round(num(s.monthlyExpenses)) : 0, assets, debts };
}

let cache: FinanceLink | null | undefined;

/** Сводка «Финансов»; null — модуля нет, нет доступа или данных ещё нет. Обновляется при возврате на вкладку. */
export function useFinanceLink(): FinanceLink | null {
  const [link, setLink] = useState<FinanceLink | null>(cache ?? null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      kv
        .get<FinanceSummary | null>("summary", null, { from: "finance" })
        .then((s) => {
          cache = toLink(s);
          if (alive) setLink(cache);
        })
        .catch(() => {
          cache = null;
          if (alive) setLink(null);
        });
    load();
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
  return link;
}
