import { Link, cn } from "@lifehub/sdk";
import { useMemo, useState } from "react";
import { Avatar, Panel, PctTone, Seg, Stat } from "../components/ui.tsx";
import { pct, shortRub, signedShortRub } from "../lib/fmt.ts";
import { assetPerformance, perfPeriods, perfTotals, type AssetPerf } from "../lib/perf.ts";
import { useInvest } from "../lib/store.tsx";

type Sort = "result" | "ret" | "income" | "bought";
type Filter = "all" | "held" | "sold";

/** «Сколько я заработал на каждой бумаге» за выбранный период. */
export function Earnings() {
  const { portfolio: p, market, report: r } = useInvest();
  const periods = useMemo(() => perfPeriods(r), [r]);
  const [key, setKey] = useState("all");
  const [sort, setSort] = useState<Sort>("result");
  const [filter, setFilter] = useState<Filter>("all");
  const period = periods.find((x) => x.key === key) ?? periods[0];
  const list = useMemo(() => assetPerformance(p, market, r, period.from, period.to), [p, market, r, period]);
  const totals = useMemo(() => perfTotals(list, r, period.from, period.to), [list, r, period]);
  const shown = list
    .filter((x) => filter === "all" || (filter === "held" ? x.held : !x.held))
    .sort((a, b) => {
      const k: Record<Sort, (x: AssetPerf) => number> = { result: (x) => x.result, ret: (x) => x.ret ?? -9, income: (x) => x.income, bought: (x) => x.bought };
      return k[sort](b) - k[sort](a);
    });
  const best = [...list].sort((a, b) => b.result - a.result)[0];
  const worst = [...list].sort((a, b) => a.result - b.result)[0];
  const winners = list.filter((x) => x.result > 0).length;
  const priceResult = totals.result - totals.income;
  const all = key === "all";

  return (
    <div className="space-y-4">
      <section className="inv-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">Период:</span>
          <select className="inv-input !min-h-9 !w-auto !text-sm font-semibold" value={key} onChange={(e) => setKey(e.target.value)}>
            {periods.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4">
          <div className="inv-label">Заработано на бумагах · {period.label.toLowerCase()}</div>
          <div className={cn("inv-num mt-1 text-4xl font-extrabold tracking-tight", totals.result >= 0 ? "inv-up" : "inv-down")}>{signedShortRub(totals.result)}</div>
          <div className="mt-1 text-sm">
            <PctTone value={totals.ret} /> <span className="inv-muted">к средней стоимости портфеля за период</span>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Рост и падение цен" value={<span className={priceResult >= 0 ? "inv-up" : "inv-down"}>{signedShortRub(priceResult)}</span>} hint="вместе с прибылью от продаж" />
          <Stat label="Дивиденды и купоны" value={<span className="inv-gold">+{shortRub(totals.income)}</span>} hint="на руки" />
          <Stat label="Купил бумаг на" value={shortRub(totals.bought)} hint={`продал на ${shortRub(totals.sold)}`} />
          <Stat label={all ? "Стоят сейчас" : "Стоимость"} value={shortRub(totals.endValue)} hint={all ? "бумаги без свободных денег" : `в начале ${shortRub(totals.startValue)}`} />
        </div>
        {list.length > 1 && best && worst && (
          <p className="mt-4 text-sm leading-relaxed">
            В плюсе {winners} из {list.length} бумаг. Больше всего {best.result >= 0 ? "заработали" : "потеряли"} на{" "}
            <Link to={`/asset/${encodeURIComponent(best.id)}`} className="font-bold hover:underline">
              {best.instrument.name}
            </Link>{" "}
            ({signedShortRub(best.result)})
            {worst.result < 0 && worst.id !== best.id && (
              <>
                , больше всего потеряли на{" "}
                <Link to={`/asset/${encodeURIComponent(worst.id)}`} className="font-bold hover:underline">
                  {worst.instrument.name}
                </Link>{" "}
                ({signedShortRub(worst.result)})
              </>
            )}
            .
          </p>
        )}
      </section>

      <Panel
        title="По каждой бумаге"
        info="Итог = стоимость в конце периода − стоимость в начале − (купил − продал) + выплаты на руки. Процент — к средней сумме, вложенной в бумагу, пока она была в портфеле: так частые докупки и продажи его не искажают. «В год» — доходность с учётом того, когда вы докупали (как у портфеля в целом). Плата за обслуживание счёта и налог с продаж к конкретной бумаге не относятся и сюда не входят."
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <Seg value={filter} onChange={setFilter} options={[["all", "Все"], ["held", "В портфеле"], ["sold", "Проданные"]]} />
          <Seg value={sort} onChange={setSort} options={[["result", "Итог"], ["ret", "%"], ["income", "Выплаты"], ["bought", "Вложено"]]} />
        </div>
        {shown.map((x) => (
          <Link key={x.id} to={`/asset/${encodeURIComponent(x.id)}`} className="inv-row inv-link-row items-start">
            <Avatar ticker={x.instrument.ticker} type={x.instrument.type} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold">{x.instrument.name}</span>
                {!x.held && <span className="inv-tag flex-none">сейчас нет</span>}
              </div>
              <div className="inv-muted text-xs leading-relaxed">
                купил на {shortRub(x.bought)}
                {x.sold > 0 ? ` · продал на ${shortRub(x.sold)}` : ""}
                {x.endValue > 0 ? ` · ${all || key === "ytd" || key === "12m" ? "стоит" : "на конец года"} ${shortRub(x.endValue)}` : ""}
                {x.startValue > 0 && !all ? ` · в начале ${shortRub(x.startValue)}` : ""}
              </div>
              <div className="text-xs leading-relaxed">
                <span className={x.priceResult >= 0 ? "inv-up" : "inv-down"}>цена {signedShortRub(x.priceResult)}</span>
                {x.income > 0 && <span className="inv-gold"> · выплаты +{shortRub(x.income)}</span>}
              </div>
            </div>
            <div className="text-right">
              <div className={cn("inv-num text-sm font-extrabold", x.result >= 0 ? "inv-up" : "inv-down")}>{signedShortRub(x.result)}</div>
              <div className="text-xs">
                <PctTone value={x.ret} />
              </div>
              {x.annual != null && <div className="inv-muted text-[11px]">{pct(x.annual, { signed: true, digits: 0 })} в год</div>}
            </div>
          </Link>
        ))}
        {!shown.length && <div className="inv-muted py-3 text-sm">За этот период операций и бумаг нет.</div>}
      </Panel>
    </div>
  );
}
