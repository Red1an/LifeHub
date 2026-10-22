import { Link, defineModule, useStore, type ModuleSummary } from "@lifehub/sdk";
import type { Snapshot } from "./lib/types.ts";
import type { ReactNode } from "react";
import "./styles.css";
import { InvestProvider, useInvest } from "./lib/store.tsx";
import { shortRub } from "./lib/fmt.ts";
import { PctTone } from "./components/ui.tsx";
import { Overview } from "./pages/Overview.tsx";
import { IncomePage } from "./pages/Income.tsx";
import { PortfolioPage } from "./pages/Portfolio.tsx";
import { AssetPage } from "./pages/Asset.tsx";
import { ActionsPage } from "./pages/Actions.tsx";
import { CheckPage } from "./pages/Check.tsx";
import { IdeasPage } from "./pages/Ideas.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { OperationsPage } from "./pages/Operations.tsx";
import { GlossaryPage } from "./pages/Glossary.tsx";

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="inv-root flex min-h-full flex-1 flex-col">
      <InvestProvider>{children}</InvestProvider>
    </div>
  );
}

/** Виджет на главной хаба: стоимость, доходность и дивиденды в этом году. */
function SummaryWidget() {
  return (
    <InvestProvider>
      <WidgetBody />
    </InvestProvider>
  );
}

function WidgetBody() {
  const { report: r, income, hasData, loading } = useInvest();
  return (
    <Link to="/" className="inv-root -m-4 flex h-[calc(100%+2rem)] flex-col rounded-[inherit] p-4">
      <div className="inv-muted text-xs font-bold uppercase tracking-wide">📈 Инвестиции</div>
      {loading ? null : !hasData ? (
        <div className="inv-muted mt-2 text-sm">Подключите счета Т-Банка и БКС</div>
      ) : (
        <>
          <div className="inv-num mt-1 text-2xl font-extrabold tracking-tight">{shortRub(r.totalValue)}</div>
          <div className="text-xs">
            <PctTone value={r.xirr} /> <span className="inv-muted">в год</span>
          </div>
          <div className="mt-auto text-xs">
            <span className="inv-muted">Выплаты в {income.currentYear}: </span>
            <b className="inv-gold inv-num">{shortRub(income.ytd)}</b>
          </div>
        </>
      )}
    </Link>
  );
}

const NO_SNAPS: Snapshot[] = [];

/** Сводка для главной хаба: стоимость по последнему снимку (без пересчёта всего портфеля). */
function useSummary(): ModuleSummary | null {
  const [snaps] = useStore<Snapshot[]>("snapshots", NO_SNAPS);
  const last = snaps[snaps.length - 1];
  if (!last) return null;
  const gain = last.value - last.invested;
  return { value: shortRub(last.value), text: `${gain >= 0 ? "+" : "−"}${shortRub(Math.abs(gain))} к вложенному` };
}

export default defineModule({
  routes: {
    "/": Overview,
    "/income": IncomePage,
    "/portfolio": PortfolioPage,
    "/asset/:id": AssetPage,
    "/actions": ActionsPage,
    "/check": CheckPage,
    "/review": ActionsPage,
    "/ideas": IdeasPage,
    "/settings": SettingsPage,
    "/operations": OperationsPage,
    "/glossary": GlossaryPage,
    "*": Overview,
  },
  nav: [
    { to: "/", label: "Обзор", icon: "📈" },
    { to: "/actions", label: "Что делать", icon: "✅" },
    { to: "/portfolio", label: "Портфель", icon: "💼" },
    { to: "/income", label: "Доход", icon: "💰" },
    { to: "/ideas", label: "Идеи", icon: "💡" },
  ],
  widgets: {
    summary: { title: "Инвестиции", size: "sm", component: SummaryWidget },
  },
  summary: useSummary,
  layout: Layout,
  theme: "dark",
});
