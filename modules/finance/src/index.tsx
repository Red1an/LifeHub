import { useMemo, type ReactNode } from "react";
import { Link, defineModule, monthKey, useCollection, type ModuleSummary } from "@lifehub/sdk";
import "./styles.css";
import { FinanceProvider, useFinance } from "./lib/store.tsx";
import { monthStats, pace } from "./lib/analytics.ts";
import { accountStates, upcomingPayments } from "./lib/accounts.ts";
import { rub, short } from "./lib/money.ts";
import type { AccountDoc, PlanDoc, TxDoc } from "./lib/types.ts";
import { TxSheetProvider } from "./components/TxSheet.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Operations } from "./pages/Operations.tsx";
import { Analytics } from "./pages/Analytics.tsx";
import { Shared } from "./pages/Shared.tsx";
import { AccountPage, Accounts } from "./pages/Accounts.tsx";
import { Import } from "./pages/Import.tsx";
import { Inbox, SettingsPage } from "./pages/Settings.tsx";

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="fin-root flex min-h-full flex-1 flex-col">
      <FinanceProvider>
        <TxSheetProvider>
          <TopLinks />
          {children}
        </TxSheetProvider>
      </FinanceProvider>
    </div>
  );
}

/** Импорт и настройки — не в нижнем меню (там 5 разделов), а маленькими ссылками сверху. */
function TopLinks() {
  return (
    <div className="mx-auto flex w-full max-w-3xl justify-end gap-1 px-4 pt-2 sm:px-6">
      <Link to="/import" className="rounded-full px-2.5 py-1 text-[13px] text-muted hover:bg-surface-2" activeClassName="bg-surface-2 text-fg">
        📥 Импорт
      </Link>
      <Link to="/settings" className="rounded-full px-2.5 py-1 text-[13px] text-muted hover:bg-surface-2" activeClassName="bg-surface-2 text-fg">
        ⚙️ Настройки
      </Link>
    </div>
  );
}

/** Виджет на главной хаба: потрачено, можно сегодня, ближайший платёж, долги. */
function MonthWidget() {
  return (
    <FinanceProvider>
      <WidgetBody />
    </FinanceProvider>
  );
}

function WidgetBody() {
  const f = useFinance();
  const month = monthKey();
  const ms = useMemo(() => monthStats(f.txs, month), [f.txs, month]);
  const p = useMemo(() => pace(f.txs, month, f.budget), [f.txs, month, f.budget]);
  const next = useMemo(() => upcomingPayments(f.states, f.plans, 7)[0], [f.states, f.plans]);
  const owed = f.debts.filter((d) => d.dir === "owed").reduce((s, d) => s + Math.max(0, d.amount - d.paid), 0);
  if (f.loading) return null;
  return (
    <Link to="/" className="fin-root flex h-full flex-col">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">💰 Потрачено в этом месяце</div>
      <div className="fin-num mt-0.5 text-2xl font-bold">{rub(ms.spent)}</div>
      {p.budget > 0 && (
        <div className="fin-bar mt-1.5">
          <div style={{ width: `${Math.min(100, (ms.spent / p.budget) * 100)}%`, background: ms.spent > p.budget ? "var(--fin-red)" : "var(--lh-accent)" }} />
        </div>
      )}
      <div className="mt-auto space-y-0.5 pt-2 text-[12.5px] text-muted">
        {p.perDay !== null && (
          <div>
            Можно сегодня: <b className="fin-num text-fg">{rub(Math.round(p.perDay / 10) * 10)}</b>
          </div>
        )}
        {next && (
          <div className="truncate">
            {next.days <= 0 ? "Сегодня" : `Через ${next.days} дн.`}: {next.title} · {short(next.amount)}
          </div>
        )}
        {owed > 0.5 && <div>Вам должны: {short(owed)}</div>}
      </div>
    </Link>
  );
}

/** Сводка для главной хаба: потрачено за месяц и ближайший платёж (если в течение недели). */
function useSummary(): ModuleSummary | null {
  const txs = useCollection<TxDoc>("transactions");
  const accounts = useCollection<AccountDoc>("accounts");
  const plans = useCollection<PlanDoc>("plans");
  const month = monthKey();
  const ms = useMemo(() => monthStats(txs.items, month), [txs.items, month]);
  const next = useMemo(
    () => upcomingPayments(accountStates(accounts.items, txs.items, month), plans.items, 7)[0],
    [accounts.items, txs.items, plans.items, month],
  );
  if (txs.loading || accounts.loading) return null;
  const monthName = new Date().toLocaleString("ru-RU", { month: "long" });
  return {
    value: rub(ms.spent),
    text: next ? `${next.days <= 0 ? "сегодня" : next.days === 1 ? "завтра" : `через ${next.days} дн.`} платёж ${short(next.amount)}` : `потрачено за ${monthName}`,
  };
}

export default defineModule({
  routes: {
    "/": Overview,
    "/ops": Operations,
    "/analytics": Analytics,
    "/shared": Shared,
    "/accounts": Accounts,
    "/account/:id": AccountPage,
    "/import": Import,
    "/inbox": Inbox,
    "/settings": SettingsPage,
    "*": Overview,
  },
  nav: [
    { to: "/", label: "Главная", icon: "💰" },
    { to: "/ops", label: "Операции", icon: "💳" },
    { to: "/analytics", label: "Анализ", icon: "📊" },
    { to: "/shared", label: "Общак", icon: "🤝" },
    { to: "/accounts", label: "Счета", icon: "🏦" },
  ],
  widgets: {
    month: { title: "Финансы", component: MonthWidget },
  },
  summary: useSummary,
  layout: Layout,
});
