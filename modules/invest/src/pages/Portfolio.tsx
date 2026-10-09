import { Link, Loading, cn } from "@lifehub/sdk";
import { useMemo, useState } from "react";
import { Legend, PALETTE, ShareBars, TimeChart } from "../components/charts.tsx";
import { VerdictTag } from "../components/Verdict.tsx";
import { Earnings } from "./Earnings.tsx";
import { Avatar, Details, Empty, Header, Panel, PctTone, Screen, Seg, Stat, useTab } from "../components/ui.tsx";
import { DIMENSION_TITLE, allocation, profitOf, profitPctOf, reportProfit, risk, sameMoneyInIndex, yieldOf, type Dimension, type Holding } from "../lib/analytics.ts";
import { addYears, ms } from "../lib/dates.ts";
import { num, pct, qty, rub, shortRub, signedShortRub } from "../lib/fmt.ts";
import { CLASS_SHORT, RISK_TITLE, type AssetClass } from "../lib/health.ts";
import { useInvest } from "../lib/store.tsx";

const TABS = ["holdings", "earnings", "structure", "result"] as const;

export function PortfolioPage() {
  const { loading, hasData } = useInvest();
  const [tab, setTab] = useTab<(typeof TABS)[number]>("holdings", TABS);
  if (loading) return <Loading />;
  return (
    <Screen>
      <Header title="Портфель" question="Что у меня есть, сколько я заработал на каждой бумаге и из чего состоит портфель">
        <Seg value={tab} onChange={setTab} options={[["holdings", "Бумаги"], ["earnings", "Заработок"], ["structure", "Структура"], ["result", "Итоги"]]} />
      </Header>
      {!hasData ? (
        <Empty icon="💼" title="Пока пусто" text="Подключите счета или загрузите выписку." action={<Link to="/settings" className="inv-btn inv-btn-main">Подключить</Link>} />
      ) : tab === "holdings" ? (
        <Holdings />
      ) : tab === "earnings" ? (
        <Earnings />
      ) : tab === "structure" ? (
        <Structure />
      ) : (
        <Result />
      )}
    </Screen>
  );
}

type SortKey = "value" | "profit" | "yield" | "income";

function Holdings() {
  const { report: r, advice } = useInvest();
  const [sort, setSort] = useState<SortKey>("value");
  const sorted = useMemo(() => {
    const key: Record<SortKey, (h: Holding) => number> = { value: (h) => h.value, profit: (h) => profitPctOf(h), yield: yieldOf, income: (h) => h.income };
    return [...r.holdings].sort((a, b) => key[sort](b) - key[sort](a));
  }, [r.holdings, sort]);
  const sold = r.allRows.filter((h) => h.quantity <= 0 && (Math.abs(h.realized) > 1 || h.income > 1)).sort((a, b) => b.realized + b.income - (a.realized + a.income));
  return (
    <div className="space-y-4">
      <Panel
        title={`${r.holdings.length} бумаг`}
        info="Значки: «Докупать» — подходит для следующих покупок; «Держать» — всё в порядке; «Не докупать» — её или её отрасли уже много; «Сократить» — слишком большая доля; «Проверить» — перестала платить или сильно упала. Прибыль — разница между текущей стоимостью и ценой покупки (с комиссиями). Доходность — ожидаемые выплаты за 12 месяцев ÷ текущая цена, до налога. «Получено» — дивиденды и купоны на руки за всё время."
        right={<Seg value={sort} onChange={setSort} options={[["value", "Доля"], ["profit", "Прибыль"], ["yield", "Див."], ["income", "Выплаты"]]} />}
      >
        <p className="inv-muted -mt-1 mb-2 text-[13px]">Значок у названия — что делать с бумагой. Нажмите на бумагу, чтобы увидеть почему и конкретные шаги.</p>
        {sorted.map((h) => (
          <Link key={h.id} to={`/asset/${encodeURIComponent(h.id)}`} className="inv-row inv-link-row">
            <Avatar ticker={h.instrument.ticker} type={h.instrument.type} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold">{h.instrument.name}</span>
                {advice.get(h.id) && <VerdictTag v={advice.get(h.id)!.verdict} className="flex-none" />}
              </div>
              <div className="inv-muted truncate text-xs">
                {qty(h.quantity)} шт · доля {pct(h.weight)}
                {sort === "yield" && yieldOf(h) > 0 && <> · <span className="inv-gold">{pct(yieldOf(h))}</span></>}
                {sort === "income" && h.income > 0 && <> · получено <span className="inv-gold">{shortRub(h.income)}</span></>}
              </div>
            </div>
            <div className="text-right">
              <div className="inv-num text-sm font-extrabold">{rub(h.value)}</div>
              <div className="text-xs">
                <PctTone value={profitPctOf(h)} /> <span className={cn("inv-num", profitOf(h) >= 0 ? "inv-up" : "inv-down")}>{signedShortRub(profitOf(h))}</span>
              </div>
            </div>
          </Link>
        ))}
        {r.cashRUB > 1 && (
          <div className="inv-row">
            <span className="inv-avatar">₽</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">Свободные деньги</div>
              <div className="inv-muted text-xs">
                {Object.entries(r.cashByCurrency)
                  .filter(([, v]) => Math.abs(v) > 0.5)
                  .map(([c, v]) => `${num(v, 0)} ${c}`)
                  .join(" · ")}
              </div>
            </div>
            <div className="inv-num text-sm font-extrabold">{rub(r.cashRUB)}</div>
          </div>
        )}
      </Panel>
      {sold.length > 0 && (
        <Panel>
          <Details summary={`Проданные и погашенные (${sold.length})`}>
            {sold.map((h) => (
              <Link key={h.id} to={`/asset/${encodeURIComponent(h.id)}`} className="inv-row inv-link-row">
                <Avatar ticker={h.instrument.ticker} type={h.instrument.type} />
                <div className="min-w-0 flex-1 truncate text-sm font-bold">{h.instrument.name}</div>
                <div className="text-right text-xs">
                  <div>
                    продажи <span className={cn("inv-num font-bold", h.realized >= 0 ? "inv-up" : "inv-down")}>{signedShortRub(h.realized)}</span>
                  </div>
                  {h.income > 0 && <div className="inv-gold inv-num">выплаты {shortRub(h.income)}</div>}
                </div>
              </Link>
            ))}
          </Details>
        </Panel>
      )}
    </div>
  );
}

function Structure() {
  const { report: r, health, settings } = useInvest();
  const [dim, setDim] = useState<Dimension>("type");
  const dims: Dimension[] = ["type", "sector", "currency", "account", "broker", "asset"];
  const rows = allocation(r, dim);
  const classes = (Object.keys(health.target) as AssetClass[]).filter((c) => health.target[c] > 0 || health.classes[c] > 0);
  const total = Object.values(health.classes).reduce((a, b) => a + b, 0);
  const top5 = r.holdings.slice(0, 5).reduce((a, h) => a + h.weight, 0);
  return (
    <div className="space-y-4">
      <Panel title="Из чего состоит" right={<Seg value={dim} onChange={setDim} options={dims.map((d) => [d, DIMENSION_TITLE[d]] as [Dimension, string])} />}>
        <ShareBars rows={rows} limit={dim === "asset" ? 15 : 12} />
        {dim === "asset" && <p className="inv-muted mt-3 text-sm">Пять крупнейших позиций — {pct(top5, { digits: 0 })} портфеля.</p>}
      </Panel>
      <Panel
        title={`Против ориентира «${RISK_TITLE[settings.risk]}»`}
        info="Ориентир — разумное распределение для вашего отношения к риску: акции растут быстрее всего, но сильно падают; облигации дают предсказуемый доход; деньги — запас на покупки; золото страхует от падения рубля. Профиль меняется в «Идеях» или настройках."
        right={<Link to="/ideas" className="text-sm font-bold text-[var(--inv-green)]">Как выровнять →</Link>}
      >
        <div className="space-y-4">
          {classes.map((c, i) => {
            const now = total > 0 ? health.classes[c] / total : 0;
            const target = health.target[c];
            return (
              <div key={c}>
                <div className="mb-1 flex items-baseline gap-2 text-sm">
                  <span className="flex-1 font-bold">{CLASS_SHORT[c]}</span>
                  <span className="inv-num font-extrabold">{pct(now, { digits: 0 })}</span>
                  <span className="inv-muted inv-num w-24 text-right text-xs">цель {pct(target, { digits: 0 })}</span>
                </div>
                <div className="relative">
                  <div className="inv-bar">
                    <div style={{ width: `${Math.min(100, now * 100)}%`, background: PALETTE[i] }} />
                  </div>
                  <div className="absolute -top-1 h-4 w-0.5 rounded bg-[var(--inv-fg)]" style={{ left: `${target * 100}%` }} title="ориентир" />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function Result() {
  const { report: r, market, settings, income } = useInvest();
  const [range, setRange] = useState<"1y" | "3y" | "all">("all");
  const profit = reportProfit(r);
  const nonTradeFees = r.fees - r.tradeFees;
  const items = [
    { name: "Рост цены бумаг, которые сейчас есть", v: r.unrealized, hint: "если продать сегодня" },
    { name: "Прибыль от продаж", v: r.realized, hint: "уже зафиксирована" },
    { name: "Дивиденды", v: r.dividends, hint: "до налога" },
    { name: "Купоны", v: r.coupons, hint: "до налога" },
    { name: "Налоги", v: -r.taxes, hint: "с выплат и продаж" },
    { name: "Комиссии брокера", v: -nonTradeFees, hint: "обслуживание и прочее; за сделки — уже в цене покупки" },
  ];
  const other = profit - items.reduce((a, x) => a + x.v, 0);
  if (Math.abs(other) > Math.max(1000, Math.abs(profit) * 0.01)) items.push({ name: "Прочее", v: other, hint: "курсы валют, НКД, неточности данных брокера" });
  const max = Math.max(...items.map((x) => Math.abs(x.v)), 1);
  const bench = market.benchmarks[settings.benchmark];
  const idx = sameMoneyInIndex(r, bench);
  const since = range === "1y" ? addYears(Date.now(), -1) : range === "3y" ? addYears(Date.now(), -3) : 0;
  const hist = r.history.filter((h) => h.t >= since);
  const benchPts = useMemo(() => {
    if (!bench?.length || hist.length < 2) return [];
    const b = bench.map(([d, c]) => [ms(d), c] as [number, number]).filter(([t]) => t >= hist[0].t);
    if (!b.length) return [];
    return b.map(([t, c]) => [t, (c / b[0][1] - 1) * 100] as [number, number]);
  }, [bench, hist]);
  const rk = risk(r, bench, settings.riskFreeRate, since || undefined);
  const base = hist[0]?.index ?? 1;
  return (
    <div className="space-y-4">
      <Panel title="Из чего сложилась прибыль" info="Все статьи в сумме дают прибыль за всё время = стоимость портфеля − вложенные деньги. Комиссии за сделки здесь не вычитаются второй раз: они уже входят в цену покупки и в результат продаж.">
        <div className="space-y-3">
          {items.map((x) => (
            <div key={x.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
              <div className="min-w-0 text-sm font-semibold">
                {x.name} <span className="inv-faint text-xs font-normal">· {x.hint}</span>
              </div>
              <div className={cn("inv-num text-right text-sm font-extrabold", x.v >= 0 ? "inv-up" : "inv-down")}>{signedShortRub(x.v)}</div>
              <div className="col-span-2 inv-bar !h-1.5">
                <div style={{ width: `${(Math.abs(x.v) / max) * 100}%`, background: x.v >= 0 ? "var(--inv-green)" : "var(--inv-red)" }} />
              </div>
            </div>
          ))}
          <div className="inv-hr flex items-baseline justify-between pt-3">
            <span className="font-extrabold">Итого прибыль</span>
            <span className={cn("inv-num text-lg font-extrabold", profit >= 0 ? "inv-up" : "inv-down")}>{signedShortRub(profit)}</span>
          </div>
        </div>
      </Panel>

      <Panel
        title="Сравнение с рынком"
        info={`Доходность в год (XIRR) учитывает, когда и сколько вы вносили: это ваш реальный процент. Справа — что было бы, если те же пополнения в те же дни шли в индекс ${settings.benchmark} (с дивидендами). Линии на графике — рост самих бумаг без учёта пополнений (метод TWR), так их честно сравнивать с индексом.`}
        right={<Seg value={range} onChange={setRange} options={[["1y", "Год"], ["3y", "3 года"], ["all", "Всё"]]} />}
      >
        <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Ваша доходность в год" value={<PctTone value={r.xirr} />} />
          <Stat label={`${settings.benchmark} на те же деньги`} value={<PctTone value={idx?.xirr ?? null} />} hint={idx ? `было бы ${shortRub(idx.value)}` : undefined} />
          <Stat label="Вклад под ставку" value={pct(settings.riskFreeRate / 100, { digits: 0 })} hint="ориентир без риска" />
          <Stat label="Выплаты на руки" value={<span className="inv-gold">{shortRub(income.allTime)}</span>} hint="за всё время" />
        </div>
        <TimeChart
          height={200}
          format={(v) => `${v >= 0 ? "+" : ""}${num(v, 0)} %`}
          series={[
            { name: "Ваши бумаги", color: "var(--inv-green)", points: hist.map((h) => [h.t, (h.index / base - 1) * 100] as [number, number]) },
            ...(benchPts.length ? [{ name: settings.benchmark, color: "var(--inv-muted)", dashed: true, points: benchPts }] : []),
          ]}
        />
        <Legend className="mt-1" items={[{ color: "var(--inv-green)", label: "рост ваших бумаг" }, { color: "var(--inv-muted)", label: `индекс ${settings.benchmark}`, dashed: true }]} />
      </Panel>

      <Panel title="Риск">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Худшая просадка" value={<span className="inv-down">{rk.maxDrawdown != null ? pct(rk.maxDrawdown, { digits: 0 }) : "—"}</span>} hint="от пика до дна" />
          <Stat label="Колебания" value={rk.volatility != null ? `±${pct(rk.volatility, { digits: 0 })}` : "—"} hint="типичный размах за год" />
          <Stat label="Бета" value={rk.beta != null ? num(rk.beta, 2) : "—"} hint="1 — как рынок" />
          <Stat label="Шарп" value={rk.sharpe != null ? num(rk.sharpe, 2) : "—"} hint="доход за риск" />
        </div>
        <Details summary="Что это значит" className="mt-3">
          <div className="inv-muted space-y-2 text-sm leading-relaxed">
            <p><b className="text-[var(--inv-fg)]">Худшая просадка</b> — на сколько процентов бумаги падали от максимума до минимума. Это то, что нужно уметь пережить без паники.</p>
            <p><b className="text-[var(--inv-fg)]">Колебания (волатильность)</b> — насколько сильно портфель обычно «скачет» за год. У индекса Мосбиржи ≈ 20–25 %.</p>
            <p><b className="text-[var(--inv-fg)]">Бета</b> — как портфель реагирует на рынок: 1,2 — падает и растёт на 20 % сильнее индекса, 0,6 — спокойнее.</p>
            <p><b className="text-[var(--inv-fg)]">Коэффициент Шарпа</b> — сколько доходности сверх ставки вклада ({settings.riskFreeRate} %) вы получаете за единицу риска. Больше 0,5 — хорошо, меньше 0 — вклад был бы лучше.</p>
          </div>
        </Details>
      </Panel>
    </div>
  );
}
