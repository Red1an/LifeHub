import { Link, Loading, cn } from "@lifehub/sdk";
import { useMemo, useState } from "react";
import { Columns, Legend, ShareBars, TimeChart, Waterfall, type Column } from "../components/charts.tsx";
import { Avatar, Bar, Btn, Details, Empty, Field, Header, NumInput, Panel, PctTone, Screen, Seg, Stat, Toggle, useTab } from "../components/ui.tsx";
import { addMonths, fmtDate, monthAxis, monthName, monthOf, ms, startOfDayMs, yearOf } from "../lib/dates.ts";
import { duration, num, pct, rub, shortRub } from "../lib/fmt.ts";
import { backtestError, buildIncome, goalPlan, goalYield, isIncomeTax, per100k, scenario, yearTotal, type Payment } from "../lib/income.ts";
import { useInvest } from "../lib/store.tsx";
import { PAYMENT_TITLE, STATUS_TITLE, normCurrency } from "../lib/types.ts";

const TABS = ["overview", "calendar", "goal"] as const;

export function IncomePage() {
  const { loading, hasData } = useInvest();
  const [tab, setTab] = useTab<(typeof TABS)[number]>("overview", TABS);
  if (loading) return <Loading />;
  return (
    <Screen>
      <Header title="Мой доход" question="Сколько я получаю и получу — на руки, после налога">
        <Seg value={tab} onChange={setTab} options={[["overview", "Обзор"], ["calendar", "Календарь"], ["goal", "Цель"]]} />
      </Header>
      {!hasData ? (
        <Empty icon="💰" title="Пока нет данных" text="Подключите счета, чтобы увидеть выплаты." action={<Link to="/settings" className="inv-btn inv-btn-main">Подключить</Link>} />
      ) : tab === "overview" ? (
        <IncomeOverview />
      ) : tab === "calendar" ? (
        <CalendarTab />
      ) : (
        <GoalTab />
      )}
    </Screen>
  );
}

/* ───────────── обзор ───────────── */

function IncomeOverview() {
  const { report: r, income: inc0, settings, portfolio, previousVisit } = useInvest();
  const [mode, setMode] = useState<"years" | "ytd">("years");
  const [bridgeYear, setBridgeYear] = useState<number | null>(null);
  const inc = useMemo(
    () => (bridgeYear && bridgeYear !== inc0.bridgeTo ? buildIncome(portfolio, r, settings, previousVisit, bridgeYear) : inc0),
    [bridgeYear, inc0, portfolio, r, settings, previousVisit],
  );
  const cy = inc.currentYear;
  const current = inc.years.find((y) => y.kind === "current");
  const next = inc.years.find((y) => y.kind === "next");
  const plan = goalPlan(settings, r);
  const nowMonthly = next ? next.forecast / 12 : 0;
  const goalShare = settings.goalMonthlyIncome > 0 ? nowMonthly / settings.goalMonthlyIncome : 0;

  // «С начала года»: сколько пришло к этой же дате в каждом году
  const ytdByYear = useMemo(() => {
    const now = new Date();
    const out: Record<number, number> = {};
    for (const t of r.transactions) {
      if (!(t.type === "dividend" || t.type === "coupon" || isIncomeTax(t))) continue;
      const d = new Date(t.t);
      const sameOrBefore = d.getMonth() < now.getMonth() || (d.getMonth() === now.getMonth() && d.getDate() <= now.getDate());
      if (!sameOrBefore) continue;
      out[d.getFullYear()] = (out[d.getFullYear()] ?? 0) + (t.amount - t.fee) * (portfolio.fx[normCurrency(t.currency)] ?? 1);
    }
    return out;
  }, [r.transactions, portfolio.fx]);

  const cols: Column[] =
    mode === "years"
      ? inc.years.map((y) => ({
          key: String(y.year),
          label: String(y.year),
          sub: y.kind === "current" ? "ожид." : y.kind === "next" ? "прогноз" : undefined,
          segments: [
            { value: y.received, color: "var(--inv-gold)" },
            { value: y.expected, color: "var(--inv-gold)", pale: true },
            { value: y.forecast, color: "var(--inv-muted)", hatch: true },
          ],
          range: y.kind === "next" && y.high > y.low ? [y.low, y.high] : undefined,
        }))
      : inc.years.filter((y) => y.kind !== "next").map((y) => ({ key: String(y.year), label: String(y.year), segments: [{ value: ytdByYear[y.year] ?? 0, color: y.year === cy ? "var(--inv-gold)" : "var(--inv-faint)" }] }));

  const past = inc.years.filter((y) => y.kind === "past");
  const lastFull = past[past.length - 1];
  const prevFull = past[past.length - 2];
  let verdict = "";
  if (lastFull && prevFull && yearTotal(prevFull) > 0) {
    const g = yearTotal(lastFull) / yearTotal(prevFull) - 1;
    const a = per100k(prevFull);
    const b = per100k(lastFull);
    verdict = `В ${lastFull.year} доход ${g >= 0 ? "вырос" : "снизился"} на ${pct(Math.abs(g), { digits: 0 })}.`;
    if (a && b) verdict += ` Каждые 100 тыс. вложенных принесли ${shortRub(b)} против ${shortRub(a)} годом раньше — ${b >= a ? "деньги стали работать лучше" : "рост в основном за счёт пополнений, а не компаний"}.`;
  }
  const bridgeYears = inc.years.filter((y) => y.kind !== "next" && inc.years.some((z) => z.year === y.year - 1)).map((y) => y.year);
  const top = inc.payers[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Panel title={`Получено в ${cy}`} info="Все дивиденды и купоны, которые пришли на счёт с 1 января, за вычетом налога. Сравнение — с этой же датой прошлого года, чтобы было честно.">
          <div className="inv-num inv-gold text-3xl font-extrabold">{shortRub(inc.ytd)}</div>
          <div className="inv-muted mt-1 text-sm">
            {inc.ytdPrev > 0 ? (
              <>
                к {fmtDate(Date.now(), { year: "never" })} {cy - 1}: {shortRub(inc.ytdPrev)} · <PctTone value={inc.ytd / inc.ytdPrev - 1} digits={0} />
              </>
            ) : (
              "за всё время — " + shortRub(inc.allTime)
            )}
          </div>
          {current && current.expected > 0 && (
            <div className="inv-soft mt-3 px-3 py-2 text-[13px]">
              ещё придёт до 31 декабря: <b className="inv-num">{shortRub(current.expected)}</b>
            </div>
          )}
        </Panel>
        <Panel
          title={`Получу в ${cy + 1}`}
          info={`Прогноз = объявленные дивиденды + купоны по графику (это известно точно) + оценка «компании заплатят столько же, сколько в ${cy}». Диапазон — реальная ошибка такого прогноза на ваших бумагах в прошлые годы. Суммы — после НДФЛ ${settings.taxRate} %.`}
        >
          <div className="inv-num text-3xl font-extrabold">{next ? shortRub(next.forecast) : "—"}</div>
          {next && next.forecast > 0 && (
            <>
              <div className="inv-muted mt-1 text-sm">
                ≈ {shortRub(next.forecast / 12)} в месяц · от {shortRub(next.low)} до {shortRub(next.high)}
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="inv-muted">известно точно</span>
                  <b className="inv-num">{pct(inc.nextGuaranteed / next.forecast, { digits: 0 })}</b>
                </div>
                <Bar value={inc.nextGuaranteed} max={next.forecast} />
                <div className="inv-faint mt-1 text-xs">
                  {inc.nextDeclared > 0 ? `объявлено дивидендов ${shortRub(inc.nextDeclared)}, ` : "дивиденды на следующий год ещё не объявляли, "}купоны {shortRub(inc.nextCoupons)}
                </div>
              </div>
            </>
          )}
        </Panel>
        <Link to="/income?tab=goal" className="inv-panel block p-4 transition-colors hover:border-[var(--inv-faint)] sm:p-5">
          <div className="mb-3 text-[15px] font-extrabold">Цель: {shortRub(settings.goalMonthlyIncome)} в месяц</div>
          <div className="inv-num text-3xl font-extrabold">{pct(Math.min(goalShare, 9.99), { digits: 0 })}</div>
          <Bar value={goalShare} className="mt-2" color="var(--inv-gold)" />
          <div className="inv-muted mt-2 text-sm">
            {plan.reachedMonth != null
              ? plan.reachedMonth === 0
                ? "Цель уже достигнута 🎉"
                : `Дойдёте через ${duration(plan.reachedMonth)} при пополнении ${shortRub(settings.goalMonthlyContribution)} в месяц`
              : "При текущих пополнениях за 40 лет не дойти — увеличьте пополнения"}
          </div>
        </Link>
      </div>

      <Panel
        title="Как менялся доход"
        info="Золотой — уже пришло, бледный — придёт до конца года (объявлено или ожидается), штрихованный — прогноз с диапазоном. «С начала года» сравнивает годы на одну и ту же дату. «С каждых 100 тыс.» — доход на вложенные деньги: он убирает эффект пополнений. Если он растёт — деньги работают лучше."
        right={<Seg value={mode} onChange={setMode} options={[["years", "По годам"], ["ytd", "С начала года"]]} />}
      >
        <Columns cols={cols} height={170} />
        {mode === "years" && (
          <Legend className="mt-2" items={[{ color: "var(--inv-gold)", label: "получено" }, { color: "var(--inv-gold)", label: "ещё придёт", pale: true }, { color: "var(--inv-muted)", label: "прогноз", dashed: true }]} />
        )}
        {verdict && <p className="mt-3 text-sm leading-relaxed">{verdict}</p>}
        <Details summary="Таблица по годам" className="mt-2">
          <div className="inv-scroll-x">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Год</th>
                  <th className="r">На руки</th>
                  <th className="r">В месяц</th>
                  <th className="r">Рост</th>
                  <th className="r">С 100 тыс.</th>
                </tr>
              </thead>
              <tbody>
                {inc.years.map((y, i) => {
                  const prev = inc.years[i - 1];
                  const g = prev && yearTotal(prev) > 0 ? yearTotal(y) / yearTotal(prev) - 1 : null;
                  const p100 = per100k(y);
                  return (
                    <tr key={y.year}>
                      <td className="font-bold">
                        {y.year} <span className="inv-faint text-xs">{y.kind === "current" ? "ожид." : y.kind === "next" ? "прогноз" : ""}</span>
                      </td>
                      <td className="r inv-num font-bold">{shortRub(yearTotal(y))}</td>
                      <td className="r inv-num">{shortRub(yearTotal(y) / 12)}</td>
                      <td className="r">{g != null ? <PctTone value={g} digits={0} /> : "—"}</td>
                      <td className="r inv-num">{p100 ? shortRub(p100) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Details>
      </Panel>

      {inc.bridge.length > 2 && (
        <Panel
          title="Почему доход изменился"
          info="Изменение дохода между годами разложено на причины. «Докупили» — эффект ваших пополнений. «Компании изменили выплаты» — как изменился дивиденд на одну акцию у бумаг, которые были у вас оба года: заслуга (или вина) самих компаний. Годы считаются по дате выплаты: если компания перенесла выплату с декабря на январь, это выглядит как падение в одном году и рост в следующем."
          right={
            bridgeYears.length > 1 ? (
              <Seg value={String(inc.bridgeTo)} onChange={(v) => setBridgeYear(+v)} options={bridgeYears.slice(-4).map((y) => [String(y), `${y - 1}→${String(y).slice(2)}`] as [string, string])} />
            ) : undefined
          }
        >
          <Waterfall steps={inc.bridge} />
          <p className="mt-4 text-sm leading-relaxed">{inc.bridgeSummary}</p>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Кто платит больше всего в ${cy}`} info="Сколько каждая бумага принесла в этом году на руки: получено + ожидается до конца года.">
          {top && top.share > 0.25 && inc.payers.length > 1 && (
            <div className="mb-3 rounded-xl bg-[var(--inv-orange-soft)] px-3 py-2 text-[13px] text-[var(--inv-orange)]">
              ⚠ {top.name} даёт {pct(top.share, { digits: 0 })} дохода — если компания урежет выплаты, доход заметно просядет.
            </div>
          )}
          {inc.payers.length ? (
            <ShareBars rows={inc.payers.map((x) => ({ name: x.name, value: x.amount, share: x.share, color: "var(--inv-gold)" }))} limit={8} />
          ) : (
            <div className="inv-muted text-sm">В этом году выплат пока нет.</div>
          )}
        </Panel>
        <Panel title="Последние поступления">
          <Payments list={inc.recent.slice(0, 8)} />
        </Panel>
      </div>

      <Panel title="Ближайшие выплаты" right={<Link to="/income?tab=calendar" className="text-sm font-bold text-[var(--inv-green)]">Календарь →</Link>}>
        <Payments list={inc.soon.slice(0, 8)} future />
      </Panel>

      <Panel title="Насколько точен прогноз" info="Мы проверили тот же метод «как в прошлом году» на вашей истории: брали дивиденд на акцию за год Y−1 и сравнивали с тем, что компании реально заплатили в год Y, на текущем количестве бумаг.">
        {inc.backtest.length ? (
          <>
            <p className="text-sm leading-relaxed">
              В среднем метод ошибался на <b>±{pct(inc.averageError ?? 0, { digits: 0 })}</b> в год. Поэтому прогноз на {cy + 1} — ориентир: российские компании часто меняют и отменяют дивиденды, но по портфелю ошибки частично гасятся.
            </p>
            <div className="inv-scroll-x mt-3">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Год</th>
                    <th className="r">Прогноз</th>
                    <th className="r">Факт</th>
                    <th className="r">Ошибка</th>
                  </tr>
                </thead>
                <tbody>
                  {inc.backtest.map((b) => (
                    <tr key={b.year}>
                      <td>{b.year}</td>
                      <td className="r inv-num">{shortRub(b.predicted)}</td>
                      <td className="r inv-num">{shortRub(b.actual)}</td>
                      <td className="r">
                        <PctTone value={backtestError(b)} digits={0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="inv-muted text-sm">Мало истории, чтобы проверить метод. Диапазон взят ±25 % от оценочной части.</p>
        )}
        <Details summary={`Прогноз на ${cy + 1} по бумагам`} className="mt-2">
          <div className="inv-scroll-x">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Бумага</th>
                  <th className="r">До налога</th>
                  <th>Откуда</th>
                </tr>
              </thead>
              <tbody>
                {inc.assets
                  .filter((a) => a.nextYear > 0 || a.type === "share")
                  .map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/asset/${encodeURIComponent(a.id)}`} className="font-semibold hover:underline">
                          {a.name}
                        </Link>
                      </td>
                      <td className="r inv-num font-bold">{a.nextYear > 0 ? shortRub(a.nextYear) : "—"}</td>
                      <td className="inv-muted text-xs">{a.source}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Details>
      </Panel>
    </div>
  );
}

function Payments({ list, future }: { list: Payment[]; future?: boolean }) {
  const { portfolio } = useInvest();
  if (!list.length) return <div className="inv-muted py-3 text-sm">{future ? "Пока ничего не ожидается." : "Выплат ещё не было."}</div>;
  return (
    <div>
      {list.map((p) => {
        const inst = portfolio.instruments[p.instrumentId ?? ""];
        return (
          <div key={p.key} className="inv-row">
            <Avatar ticker={inst?.ticker ?? p.name} type={inst?.type} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{p.name}</div>
              <div className="inv-muted text-xs">
                {fmtDate(p.t)} · {p.kind}
              </div>
            </div>
            <div className="text-right">
              <div className={cn("inv-num text-sm font-extrabold", !future && "inv-gold")}>
                {future ? "" : "+"}
                {rub(p.amount)}
              </div>
              {p.status && <span className={cn("inv-tag", p.status === "declared" && "inv-tag-green")}>{STATUS_TITLE[p.status]}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── календарь ───────────── */

function CalendarTab() {
  const { report: r } = useInvest();
  const [net, setNet] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(start.getTime(), i));
  const today = startOfDayMs();
  const fx = (c: string) => r.fx[normCurrency(c)] ?? 1;

  // Пришедшее в этом месяце + ожидаемое на 2 года
  const items = [
    ...r.transactions
      .filter((t) => (t.type === "dividend" || t.type === "coupon") && t.t >= start.getTime() && t.t < today + 86_400_000)
      .map((t) => ({
        key: t.id,
        t: t.t,
        name: r.allRows.find((h) => h.id === t.instrumentId)?.instrument.name ?? t.instrumentId ?? "—",
        kind: t.type === "dividend" ? "Дивиденды" : "Купон",
        status: "paid" as const,
        gross: t.amount * fx(t.currency),
        net: (t.amount - t.fee) * fx(t.currency),
        record: undefined as number | undefined,
        perUnit: undefined as number | undefined,
        qty: undefined as number | undefined,
      })),
    ...r.upcoming
      .filter((u) => u.pay >= today && u.pay < addMonths(start.getTime(), 24))
      .map((u) => ({ key: u.id, t: u.pay, name: u.instrument.name, kind: PAYMENT_TITLE[u.event.kind], status: u.event.status, gross: u.gross, net: u.net, record: ms(u.event.recordDate), perUnit: u.event.perUnit, qty: u.quantity })),
  ];
  const keyOf = (t: number) => `${yearOf(t)}-${monthOf(t)}`;
  const isIncome = (k: string) => k === "Дивиденды" || k === "Купон";
  const cols: Column[] = months.map((m) => {
    const k = keyOf(m);
    const inMonth = items.filter((i) => keyOf(i.t) === k && isIncome(i.kind));
    const v = (st: string) => inMonth.filter((i) => i.status === st).reduce((a, i) => a + (net ? i.net : i.gross), 0);
    return {
      key: k,
      label: monthAxis(monthOf(m)),
      sub: monthOf(m) === 1 || m === months[0] ? String(yearOf(m)) : undefined,
      segments: [
        { value: v("paid"), color: "var(--inv-gold)" },
        { value: v("declared"), color: "var(--inv-gold)", pale: true },
        { value: v("forecast"), color: "var(--inv-muted)", hatch: true },
      ],
    };
  });
  const total12 = cols.reduce((a, c) => a + c.segments.reduce((b, s) => b + s.value, 0), 0);
  const shown = items.filter((i) => (sel ? keyOf(i.t) === sel : true)).sort((a, b) => a.t - b.t);
  const groups: Record<string, typeof shown> = {};
  for (const i of shown) (groups[keyOf(i.t)] ??= []).push(i);

  return (
    <div className="space-y-4">
      <Panel
        title="12 месяцев"
        info="Золотой — уже пришло в этом месяце, бледный — объявлено компанией или известно по графику купонов, штрихованный — прогноз по прошлым выплатам. Нажмите на месяц, чтобы увидеть его выплаты. Погашения облигаций в столбики не входят — это возврат ваших же денег."
        right={<Seg value={net ? "net" : "gross"} onChange={(v) => setNet(v === "net")} options={[["net", "На руки"], ["gross", "До налога"]]} />}
      >
        <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
          <Stat label="За 12 месяцев" value={<span className="inv-gold">{shortRub(total12)}</span>} />
          <Stat label="В среднем в месяц" value={shortRub(total12 / 12)} />
        </div>
        <Columns cols={cols} height={150} selected={sel} onSelect={(k) => setSel(sel === k ? null : k)} />
        <Legend className="mt-2" items={[{ color: "var(--inv-gold)", label: "пришло" }, { color: "var(--inv-gold)", label: "объявлено", pale: true }, { color: "var(--inv-muted)", label: "прогноз", dashed: true }]} />
      </Panel>
      <Panel title={sel ? `${monthName(+sel.split("-")[1])} ${sel.split("-")[0]}` : "Все выплаты на 2 года"} right={sel ? <Btn small onClick={() => setSel(null)}>Показать все</Btn> : undefined}>
        {!shown.length && <div className="inv-muted py-3 text-sm">Выплат нет.</div>}
        {Object.entries(groups).map(([k, list]) => (
          <div key={k} className="mb-3">
            <div className="inv-label mb-1 mt-2 flex justify-between">
              <span>
                {monthName(+k.split("-")[1])} {k.split("-")[0]}
              </span>
              <span className="inv-num">{shortRub(list.filter((i) => isIncome(i.kind)).reduce((a, i) => a + (net ? i.net : i.gross), 0))}</span>
            </div>
            {list.map((i) => (
              <div key={i.key} className="inv-row">
                <div className="w-10 flex-none text-center">
                  <div className="text-lg font-extrabold leading-none">{new Date(i.t).getDate()}</div>
                  <div className="inv-faint text-[10px]">{monthAxis(monthOf(i.t))}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{i.name}</div>
                  <div className="inv-muted text-xs">
                    {i.kind}
                    {i.perUnit ? ` · ${num(i.perUnit, 2)} ₽ × ${num(i.qty ?? 0)}` : ""}
                    {i.record && i.kind === "Дивиденды" && i.status !== "paid" ? ` · отсечка ${fmtDate(i.record)}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="inv-num text-sm font-extrabold">{rub(net ? i.net : i.gross)}</div>
                  <span className={cn("inv-tag", i.status === "paid" && "inv-tag-gold", i.status === "declared" && "inv-tag-green")}>{STATUS_TITLE[i.status]}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </Panel>
    </div>
  );
}

/* ───────────── цель ───────────── */

function GoalTab() {
  const { report: r, income: inc, settings: s, setSettings } = useInvest();
  const plan = goalPlan(s, r);
  const autoYield = goalYield({ ...s, goalYieldOverride: null }, r);
  const sc = scenario(inc, s.goalMonthlyContribution, s.goalReinvest);
  const next = inc.years.find((y) => y.kind === "next");
  const nowMonthly = (next?.forecast ?? 0) / 12;
  const avgDep = Math.round(inc.averageMonthlyDeposit / 1000) * 1000;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Panel
          title="Условия"
          info="Расчёт помесячный и в сегодняшних деньгах: инфляция «съедает» будущие суммы, а пополнения раз в год растут вместе с ней. Доходность по умолчанию — как у вашего портфеля сейчас (выплаты за 12 месяцев ÷ стоимость бумаг), поэтому цифры сходятся с прогнозом дохода."
        >
          <div className="space-y-3">
            <Field label="Хочу получать в месяц, на руки">
              <NumInput value={s.goalMonthlyIncome} onChange={(v) => setSettings({ goalMonthlyIncome: v })} suffix="₽" min={0} />
            </Field>
            <Field
              label="Пополняю в месяц"
              hint={
                avgDep > 0 ? (
                  <button type="button" className="font-bold text-[var(--inv-green)]" onClick={() => setSettings({ goalMonthlyContribution: avgDep })}>
                    Как в среднем за год: {shortRub(avgDep)}
                  </button>
                ) : undefined
              }
            >
              <NumInput value={s.goalMonthlyContribution} onChange={(v) => setSettings({ goalMonthlyContribution: v })} suffix="₽" min={0} />
            </Field>
            <Toggle checked={s.goalReinvest} onChange={(v) => setSettings({ goalReinvest: v })} label="Реинвестирую выплаты" />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Дивдоходность"
                hint={
                  s.goalYieldOverride == null ? (
                    "как у портфеля"
                  ) : (
                    <button type="button" className="font-bold text-[var(--inv-green)]" onClick={() => setSettings({ goalYieldOverride: null })}>
                      Как у портфеля: {num(autoYield, 1)} %
                    </button>
                  )
                }
              >
                <NumInput value={+plan.yieldPct.toFixed(1)} onChange={(v) => setSettings({ goalYieldOverride: v })} suffix="%" step={0.1} />
              </Field>
              <Field label="Рост цены бумаг" hint="в год, сверх выплат">
                <NumInput value={s.goalCapitalGrowth} onChange={(v) => setSettings({ goalCapitalGrowth: v })} suffix="%" step={0.5} />
              </Field>
              <Field label="Инфляция">
                <NumInput value={s.goalInflation} onChange={(v) => setSettings({ goalInflation: v })} suffix="%" step={0.5} />
              </Field>
              <Field label="НДФЛ">
                <NumInput value={s.taxRate} onChange={(v) => setSettings({ taxRate: v })} suffix="%" />
              </Field>
            </div>
          </div>
        </Panel>
        <Panel title="Результат">
          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="Дойду до цели"
              value={plan.reachedMonth == null ? "не за 40 лет" : plan.reachedMonth === 0 ? "уже 🎉" : duration(plan.reachedMonth)}
              hint={plan.reachedMonth ? fmtDate(addMonths(Date.now(), plan.reachedMonth), { year: "always" }) : undefined}
            />
            <Stat label="Нужен капитал" value={shortRub(plan.neededCapital)} hint={`сейчас ${shortRub(r.totalValue)} · ${pct(r.totalValue / Math.max(plan.neededCapital, 1), { digits: 0 })}`} />
            <Stat label="Сейчас в месяц" value={<span className="inv-gold">{shortRub(nowMonthly)}</span>} hint="прогноз на след. год ÷ 12" />
            <Stat label="Осталось добрать" value={shortRub(Math.max(0, s.goalMonthlyIncome - nowMonthly))} hint="в месяц" />
          </div>
          <div className="mt-4">
            <TimeChart
              height={180}
              series={[
                { name: "Доход в месяц", color: "var(--inv-gold)", area: true, points: plan.points.map((p) => [p.t, p.income] as [number, number]) },
                { name: "Цель", color: "var(--inv-muted)", dashed: true, points: plan.points.map((p) => [p.t, s.goalMonthlyIncome] as [number, number]) },
              ]}
            />
            <Legend className="mt-1" items={[{ color: "var(--inv-gold)", label: "доход в месяц, в сегодняшних деньгах" }, { color: "var(--inv-muted)", label: "цель", dashed: true }]} />
          </div>
        </Panel>
      </div>
      <Panel
        title={`А если продолжать вкладывать — сколько получу в ${inc.currentYear + 1}?`}
        info="Новые деньги приносят столько же на руки, сколько портфель сейчас, но только с выплат после покупки: вложенное в декабре почти ничего не даст в этом году, вложенное весной успеет к летним дивидендам. Распределение выплат по месяцам взято из вашей истории."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Уже есть" value={shortRub(sc.base)} />
          <Stat label="От пополнений" value={<span className="inv-up">+{shortRub(sc.fromDeposits)}</span>} hint={`${shortRub(s.goalMonthlyContribution)} в месяц`} />
          <Stat label="От реинвестирования" value={<span className="inv-up">+{shortRub(sc.fromReinvest)}</span>} hint={s.goalReinvest ? "выплаты докупаются" : "выключено"} />
          <Stat label="Итого" value={<span className="inv-gold">{shortRub(sc.total)}</span>} hint={`≈ ${shortRub(sc.total / 12)} в месяц`} />
        </div>
      </Panel>
    </div>
  );
}
