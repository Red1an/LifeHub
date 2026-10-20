import { addDaysKey, addMonthsKey, daysBetween, nextMonthDay, today } from "./dates.ts";
import { round2 } from "./money.ts";
import { isDebtAccount, type AccountDoc, type Plan, type PlanDoc, type TxDoc } from "./types.ts";

/*
 * Балансы и долги по счетам. Баланс задаётся вручную (или приходит из уведомления «Баланс: …»)
 * на дату balanceAt, дальше двигается операциями после неё. Для кредитки и сплита баланс — долг.
 */

export interface AccountState {
  account: AccountDoc;
  /** Деньги на счёте (для долговых — со знаком минус). */
  balance: number | null;
  /** Долг по кредитке/сплиту (положительный). */
  debt: number;
  /** Кредитка: когда кончается льготный период по самой старой непогашенной покупке. */
  graceEnd?: string;
  /** Сколько внести до graceEnd, чтобы не платить проценты. */
  graceAmount?: number;
  /** Все льготные периоды кредитки: до какого числа, сколько, за покупки каких месяцев. */
  graces?: { until: string; amount: number; months: string[]; manual: boolean }[];
  /** Месяцы покупок, для которых период ещё не указан. */
  graceMissing?: string[];
  /** Непогашенные покупки по месяцам (FIFO). */
  openByMonth?: Record<string, number>;
  /** Следующая дата платежа по кредитке. */
  dueDate?: string;
  /** Траты по счёту в этом месяце. */
  monthSpent: number;
  /** Сколько процентов набежит за месяц, если не погасить (по ставке). */
  interestRisk?: number;
}

/** Операция меняет счёт: +приход, −расход. Для долгового счёта знак обратный (трата увеличивает долг). */
function delta(tx: TxDoc, accountId: string): number {
  if (tx.kind === "transfer") {
    if (tx.account === accountId) return -tx.amount;
    if (tx.toAccount === accountId) return tx.amount;
    return 0;
  }
  if (tx.account !== accountId) return 0;
  return tx.kind === "income" ? tx.amount : -tx.amount;
}

export function accountStates(accounts: AccountDoc[], txs: TxDoc[], month: string): AccountState[] {
  const t = today();
  return accounts.map((a) => {
    const own = txs.filter((x) => x.account === a.id || x.toAccount === a.id);
    const after = own.filter((x) => !a.balanceAt || x.date > a.balanceAt || (x.date === a.balanceAt && x.createdAt > (a.balanceTs ?? Date.parse(a.balanceAt + "T23:59"))));
    const moved = after.reduce((s, x) => s + delta(x, a.id), 0);
    const debtAcc = isDebtAccount(a);
    const base = a.balance === undefined ? null : debtAcc ? -a.balance : a.balance;
    const balance = base === null ? (own.length ? round2(moved) : null) : round2(base + moved);
    const debt = debtAcc ? Math.max(0, -(balance ?? 0)) : 0;
    const monthSpent = own.filter((x) => x.kind === "expense" && x.account === a.id && x.date.startsWith(month)).reduce((s, x) => s + x.amount, 0);
    const st: AccountState = { account: a, balance, debt, monthSpent };

    if (a.type === "credit" && debt > 0) {
      // Какие покупки ещё не погашены: платежи гасят самые старые (FIFO).
      const fifo = (list: TxDoc[], start: { date: string; left: number }[]) => {
        const purchases = [...start];
        for (const x of [...list].sort((p, q) => (p.date + (p.time ?? "")).localeCompare(q.date + (q.time ?? "")))) {
          const d = delta(x, a.id);
          if (d < 0) purchases.push({ date: x.date, left: -d });
          else {
            let pay = d;
            for (const p of purchases) {
              const take = Math.min(p.left, pay);
              p.left -= take;
              pay -= take;
              if (pay <= 0) break;
            }
          }
        }
        return purchases.filter((p) => p.left > 0.5);
      };
      // Вся история счёта сходится с долгом (выписка с нуля) — покупки известны поштучно; иначе долг на дату сверки — одним куском.
      let open = fifo(own, []);
      if (Math.abs(open.reduce((s, p) => s + p.left, 0) - debt) > 1) open = fifo(after, a.balance && a.balance > 0 ? [{ date: a.balanceAt ?? t, left: a.balance }] : []);
      const byMonth: Record<string, number> = {};
      for (const p of open) byMonth[p.date.slice(0, 7)] = round2((byMonth[p.date.slice(0, 7)] ?? 0) + p.left);
      st.openByMonth = byMonth;
      if (a.graces?.length && open.length) {
        // Периоды, привязанные к месяцу, берут его покупки; остальные — свободные месяцы по порядку.
        const months = Object.keys(byMonth).sort();
        const sorted = [...a.graces].sort((x, y) => x.until.localeCompare(y.until));
        const taken = new Set(sorted.map((g) => g.month).filter(Boolean) as string[]);
        const free = months.filter((m) => !taken.has(m));
        st.graces = sorted
          .map((g) => {
            const ms = g.month ? [g.month] : free.length ? [free.shift()!] : [];
            const auto = round2(ms.reduce((s, m) => s + (byMonth[m] ?? 0), 0));
            return { until: g.until, amount: g.amount ?? auto, months: ms, manual: g.amount !== undefined };
          })
          .filter((g) => g.amount > 0.5 && g.until >= addDaysKey(t, -45));
        st.graceMissing = free;
        const next = st.graces.find((g) => g.until >= t) ?? st.graces[0];
        if (next) {
          st.graceEnd = next.until;
          st.graceAmount = next.amount;
        }
      } else if (a.graceDays && open.length) {
        const end = addDaysKey(open[0].date, a.graceDays);
        st.graceEnd = end;
        st.graceAmount = round2(open.filter((p) => addDaysKey(p.date, a.graceDays!) <= addDaysKey(end, 31)).reduce((s, p) => s + p.left, 0));
      }
      if (a.dueDay) st.dueDate = nextMonthDay(t, a.dueDay);
      if (a.rate) st.interestRisk = Math.round((debt * a.rate) / 100 / 12);
    }
    return st;
  });
}

/* ───────────── сплиты и рассрочки ───────────── */

export interface PlanPayment {
  plan: PlanDoc;
  n: number;
  date: string;
  amount: number;
  paid: boolean;
}

export function planSchedule(p: PlanDoc): PlanPayment[] {
  const part = round2((p.total + (p.fee ?? 0)) / p.parts);
  return Array.from({ length: p.parts }, (_, i) => ({
    plan: p,
    n: i + 1,
    date: p.every === "2w" ? addDaysKey(p.start, i * 14) : addMonthsKey(p.start, i),
    amount: i === p.parts - 1 ? round2(p.total + (p.fee ?? 0) - part * (p.parts - 1)) : part,
    paid: i < p.paidParts,
  }));
}

export const planLeft = (p: PlanDoc) => planSchedule(p).filter((x) => !x.paid).reduce((s, x) => s + x.amount, 0);

/** План по умолчанию для покупки Сплитом: 4 платежа раз в 2 недели, первый — сразу. */
export function defaultPlan(account: string, title: string, total: number, date: string, tx?: string): Plan {
  return { account, title, total, start: date, parts: 4, every: "2w", paidParts: 1, tx };
}

/* ───────────── ближайшие платежи ───────────── */

export interface Upcoming {
  id: string;
  date: string;
  title: string;
  amount: number;
  kind: "split" | "credit-due" | "grace" | "subscription";
  account?: string;
  /** Насколько срочно: дней до даты. */
  days: number;
  planId?: string;
}

export function upcomingPayments(states: AccountState[], plans: PlanDoc[], horizon = 45): Upcoming[] {
  const t = today();
  const limit = addDaysKey(t, horizon);
  const out: Upcoming[] = [];
  for (const p of plans) {
    for (const x of planSchedule(p)) {
      if (x.paid || x.date > limit) continue;
      out.push({ id: `${p.id}:${x.n}`, date: x.date, title: `${p.title} · ${x.n}/${p.parts}`, amount: x.amount, kind: "split", account: p.account, days: daysBetween(t, x.date), planId: p.id });
    }
  }
  for (const s of states) {
    if (s.account.archived) continue;
    if (s.graces?.length) {
      for (const g of s.graces) {
        if (g.until > limit) continue;
        out.push({ id: `grace:${s.account.id}:${g.until}`, date: g.until, title: `${s.account.name}: льготный период${g.months.length ? ` (${g.months.map(monthName).join(", ")})` : ""}`, amount: g.amount, kind: "grace", account: s.account.id, days: daysBetween(t, g.until) });
      }
    } else if (s.graceEnd && s.graceAmount && s.graceEnd <= limit) {
      out.push({ id: `grace:${s.account.id}`, date: s.graceEnd, title: `${s.account.name}: конец льготного периода`, amount: s.graceAmount, kind: "grace", account: s.account.id, days: daysBetween(t, s.graceEnd) });
    } else if (s.dueDate && s.debt > 0) {
      out.push({ id: `due:${s.account.id}`, date: s.dueDate, title: `${s.account.name}: платёж по кредитке`, amount: Math.max(round2(s.debt * 0.03), Math.min(s.debt, 300)), kind: "credit-due", account: s.account.id, days: daysBetween(t, s.dueDate) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** «покупки сентября». */
export function monthName(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const name = new Date(y, mo - 1, 1).toLocaleDateString("ru-RU", { month: "long" });
  return `покупки ${name.replace(/ь$/, "я").replace(/й$/, "я").replace(/т$/, "та")}`;
}
