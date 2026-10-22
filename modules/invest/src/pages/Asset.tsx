import { Link, Loading, cn, useNavigate, useParams } from "@lifehub/sdk";
import { useMemo } from "react";
import { Columns, TimeChart } from "../components/charts.tsx";
import { Avatar, Btn, Empty, Panel, PctTone, Screen, Stat } from "../components/ui.tsx";
import { VerdictCard } from "../components/Verdict.tsx";
import { instrumentOf, profitOf, profitPctOf, yieldOf, yocOf } from "../lib/analytics.ts";
import { addYears, fmtDate, ms, yearOf } from "../lib/dates.ts";
import { money, pct, plural, qty, rub, shortRub, signedShortRub } from "../lib/fmt.ts";
import { assetByYear, assetPerformance } from "../lib/perf.ts";
import { classOf, CLASS_SHORT } from "../lib/health.ts";
import { useInvest } from "../lib/store.tsx";
import { ASSET_TITLE, PAYMENT_TITLE, STATUS_TITLE, TX_TITLE, normCurrency } from "../lib/types.ts";

export function AssetPage() {
  const { id: raw } = useParams<{ id: string }>();
  const id = decodeURIComponent(raw ?? "");
  const nav = useNavigate();
  const { loading, portfolio: p, market, report: r, settings, advice } = useInvest();
  const inst = instrumentOf(id, p);
  const h = r.allRows.find((x) => x.id === id);
  const txs = useMemo(() => r.transactions.filter((t) => t.instrumentId === id).sort((a, b) => b.t - a.t), [r.transactions, id]);
  const upcoming = r.upcoming.filter((u) => u.instrument.id === id).slice(0, 8);
  const hist = market.prices[id] ?? [];
  const fx = (c: string) => p.fx[normCurrency(c)] ?? 1;
  const dpsByYear = useMemo(() => {
    const out: Record<number, number> = {};
    for (const e of p.dividendHistory[id] ?? []) out[yearOf(e.payDate)] = (out[yearOf(e.payDate)] ?? 0) + e.perUnit * fx(e.currency);
    return out;
  }, [p.dividendHistory, id]);
  const perfAll = useMemo(() => assetPerformance(p, market, r, null, Date.now(), id)[0], [p, market, r, id]);
  const perfYears = useMemo(() => assetByYear(p, market, r, id), [p, market, r, id]);
  if (loading) return <Loading />;
  if (!h && !txs.length) return <Screen><Empty icon="🔍" title="Бумага не найдена" action={<Btn onClick={() => nav("/portfolio")}>К портфелю</Btn>} /></Screen>;

  const isBond = inst.type === "bond";
  const pricePts = hist.map(([d, c]) => [ms(d), isBond ? (c * (inst.nominal ?? 1000)) / 100 : c] as [number, number]);
  const years = Object.keys(dpsByYear).map(Number).sort();
  const firstYear = years[0];
  const yearCols = firstYear
    ? Array.from({ length: new Date().getFullYear() - firstYear + 1 }, (_, i) => firstYear + i).map((y) => ({ key: String(y), label: String(y), segments: [{ value: dpsByYear[y] ?? 0, color: "var(--inv-gold)" }], top: dpsByYear[y] ? money(dpsByYear[y]) : "" }))
    : [];
  const ldv = h?.firstBuy ? addYears(h.firstBuy, 3) : null;
  const target = settings.targets[id];

  return (
    <Screen>
      <button onClick={() => (history.length > 1 ? history.back() : nav("/portfolio"))} className="inv-muted mb-3 text-sm font-bold">
        ← Назад
      </button>
      <div className="mb-4 flex items-center gap-3">
        <Avatar ticker={inst.ticker} type={inst.type} />
        <div className="min-w-0">
          <h1 className="inv-title truncate text-2xl">{inst.name}</h1>
          <div className="inv-muted text-sm">
            {inst.ticker} · {ASSET_TITLE[inst.type]}
            {inst.sector ? ` · ${inst.sector}` : ""}
            {h && h.quantity > 0 && CLASS_SHORT[classOf(h)] !== ASSET_TITLE[inst.type] ? ` · ${CLASS_SHORT[classOf(h)]}` : ""}
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Link to={`/check?side=buy&t=${encodeURIComponent(inst.ticker)}`} className="inv-btn">
          Проверить покупку
        </Link>
        <Link to={`/check?side=sell&t=${encodeURIComponent(inst.ticker)}`} className={cn("inv-btn", !(h && h.quantity > 0) && "pointer-events-none opacity-40")}>
          Проверить продажу
        </Link>
      </div>

      {h && h.quantity > 0 && advice.get(id) && <VerdictCard a={advice.get(id)!} />}

      {h && h.quantity > 0 && (
        <section className="inv-panel mt-4 p-4 sm:p-5">
          <div className="inv-num text-3xl font-extrabold">{rub(h.value)}</div>
          <div className="mt-1 text-sm">
            <span className={cn("inv-num font-bold", profitOf(h) >= 0 ? "inv-up" : "inv-down")}>{signedShortRub(profitOf(h))}</span> <PctTone value={profitPctOf(h)} /> <span className="inv-muted">с покупки</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Количество" value={`${qty(h.quantity)} шт`} hint={`${pct(h.weight)} портфеля`} />
            <Stat label="Цена сейчас" value={money(h.price, inst.currency)} hint={`средняя покупки ${money(h.avgPrice, inst.currency)}`} />
            <Stat label="Выплаты за 12 мес." value={<span className="inv-gold">{shortRub(h.forwardIncome)}</span>} hint={`${pct(yieldOf(h))} к цене · ${pct(yocOf(h))} к покупке`} />
            <Stat label="Уже получено" value={<span className="inv-gold">{shortRub(h.income)}</span>} hint={h.realized ? `продажи ${signedShortRub(h.realized)}` : "на руки"} />
          </div>
          {ldv && (
            <div className="inv-soft mt-4 px-3 py-2 text-[13px]">
              {ldv > Date.now()
                ? `Без налога с прибыли можно будет продать с ${fmtDate(ldv, { year: "always" })} (3 года владения). Налог при продаже сейчас ≈ ${shortRub(Math.max(0, profitOf(h)) * (settings.taxRate / 100))}.`
                : "Владеете больше 3 лет — прибыль при продаже освобождена от НДФЛ (до 3 млн ₽ за каждый год владения)."}
              {target != null && ` Ваша цель по доле — ${target} %.`}
            </div>
          )}
          {isBond && inst.maturityDate && <div className="inv-soft mt-2 px-3 py-2 text-[13px]">Погашение {fmtDate(inst.maturityDate, { year: "always" })} · номинал {money(inst.nominal ?? 1000)}</div>}
        </section>
      )}

      {perfAll && (
        <Panel
          title="Сколько я заработал на этой бумаге"
          className="mt-4"
          info="Итог = сколько бумага стоит сейчас + сколько вы получили от продаж и выплат − сколько потратили на покупки. Процент — к средней сумме, которая была вложена в бумагу, пока она была у вас. «В год» учитывает, когда вы докупали. По годам: результат каждого календарного года, считая от стоимости на 1 января."
        >
          <div className={cn("inv-num text-3xl font-extrabold", perfAll.result >= 0 ? "inv-up" : "inv-down")}>{signedShortRub(perfAll.result)}</div>
          <div className="mt-1 text-sm">
            <PctTone value={perfAll.ret} /> <span className="inv-muted">за всё время</span>
            {perfAll.annual != null && (
              <>
                {" · "}
                <PctTone value={perfAll.annual} /> <span className="inv-muted">в год</span>
              </>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Купил всего на" value={shortRub(perfAll.bought)} hint={`${perfAll.trades} ${plural(perfAll.trades, ["сделка", "сделки", "сделок"])}`} />
            <Stat label="Продал на" value={shortRub(perfAll.sold)} hint="с погашениями" />
            <Stat label="Получил выплат" value={<span className="inv-gold">{shortRub(perfAll.income)}</span>} hint="на руки" />
            <Stat label="Стоит сейчас" value={shortRub(perfAll.endValue)} hint={perfAll.held ? "в портфеле" : "продана целиком"} />
          </div>
          <div className="inv-soft mt-4 px-3 py-2 text-[13px] leading-relaxed">
            Из итога: на изменении цены <b className={perfAll.priceResult >= 0 ? "inv-up" : "inv-down"}>{signedShortRub(perfAll.priceResult)}</b>, на выплатах <b className="inv-gold">+{shortRub(perfAll.income)}</b>.
          </div>
          {perfYears.length > 1 && (
            <div className="inv-scroll-x mt-4">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Год</th>
                    <th className="r">Докупил</th>
                    <th className="r">Выплаты</th>
                    <th className="r">Итог</th>
                    <th className="r">%</th>
                  </tr>
                </thead>
                <tbody>
                  {perfYears.map(({ year, perf }) => (
                    <tr key={year}>
                      <td className="font-bold">{year}</td>
                      <td className="r inv-num">{signedShortRub(perf.bought - perf.sold)}</td>
                      <td className="r inv-num inv-gold">{perf.income ? `+${shortRub(perf.income)}` : "—"}</td>
                      <td className={cn("r inv-num font-bold", perf.result >= 0 ? "inv-up" : "inv-down")}>{signedShortRub(perf.result)}</td>
                      <td className="r">
                        <PctTone value={perf.ret} digits={0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="inv-faint mt-1 text-xs">«Докупил» — купил минус продал за год; минус — продавали больше, чем покупали.</div>
            </div>
          )}
        </Panel>
      )}

      {pricePts.length > 2 && (
        <Panel title="Цена за 3+ года" className="mt-4">
          <TimeChart height={190} format={(v) => money(v, inst.currency)} series={[{ name: "Цена", color: "var(--inv-blue)", area: true, points: pricePts }]} />
          {h && h.avgPrice > 0 && <p className="inv-muted mt-2 text-xs">Ваша средняя цена покупки — {money(h.avgPrice, inst.currency)}.</p>}
        </Panel>
      )}

      {yearCols.length > 0 && (
        <Panel title="Дивиденд на акцию по годам" className="mt-4" info="Сумма выплат на одну акцию за календарный год (по дате выплаты). Видно, растут ли выплаты и были ли пропуски.">
          <Columns cols={yearCols} height={130} format={(v) => money(v)} />
        </Panel>
      )}

      {upcoming.length > 0 && (
        <Panel title="Ожидаемые выплаты" className="mt-4">
          {upcoming.map((u) => (
            <div key={u.id} className="inv-row">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{fmtDate(u.pay, { year: "always" })}</div>
                <div className="inv-muted text-xs">
                  {PAYMENT_TITLE[u.event.kind]} · {money(u.event.perUnit, u.event.currency)} на бумагу
                </div>
              </div>
              <div className="text-right">
                <div className="inv-num text-sm font-extrabold">{rub(u.net)}</div>
                <span className={cn("inv-tag", u.event.status === "declared" && "inv-tag-green")}>{STATUS_TITLE[u.event.status]}</span>
              </div>
            </div>
          ))}
        </Panel>
      )}

      {txs.length > 0 && (
        <Panel title={`Операции (${txs.length})`} className="mt-4">
          {txs.slice(0, 60).map((t) => (
            <div key={t.id} className="inv-row">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{TX_TITLE[t.type]}</div>
                <div className="inv-muted text-xs">
                  {fmtDate(t.t, { year: "always" })}
                  {t.quantity && (t.type === "buy" || t.type === "sell") ? ` · ${qty(t.quantity)} × ${money(t.price, t.currency)}` : ""}
                  {" · "}
                  {p.accounts.find((a) => a.id === t.accountId)?.name ?? ""}
                </div>
              </div>
              <div className={cn("inv-num text-sm font-bold", t.amount - t.fee >= 0 ? "inv-up" : "")}>{money(t.amount - t.fee, t.currency)}</div>
            </div>
          ))}
        </Panel>
      )}
    </Screen>
  );
}
