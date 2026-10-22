import { Link, Loading, cn, toast } from "@lifehub/sdk";
import { useMemo, useState } from "react";
import { AiReview } from "../components/AiReview.tsx";
import { Avatar, Btn, Details, Field, Header, NumInput, Panel, Screen, Seg, Stat, Toggle, useTab } from "../components/ui.tsx";
import { fmtDate, ms } from "../lib/dates.ts";
import { errorText } from "../lib/http.ts";
import { money, num, pct, qty, rub, shortRub } from "../lib/fmt.ts";
import { CLASS_SHORT, CLASS_TITLE, RISK_HINT, RISK_TITLE } from "../lib/health.ts";
import { buildIdeas } from "../lib/ideas.ts";
import { corpList, ofzList } from "../lib/moex.ts";
import { BondsAdvisor } from "./Bonds.tsx";
import { BestTab } from "./Best.tsx";
import { WatchTab } from "./Watch.tsx";
import { loadScreener } from "../lib/screener.ts";
import { saveBonds, saveScreener, useInvest } from "../lib/store.tsx";
import { ASSET_TITLE, type AssetType } from "../lib/types.ts";

const TABS = ["best", "plan", "bonds", "stocks", "watch", "targets"] as const;

export function IdeasPage() {
  const { loading } = useInvest();
  const [tab, setTab] = useTab<(typeof TABS)[number]>("best", TABS);
  if (loading) return <Loading />;
  return (
    <Screen>
      <Header title="Идеи" question="Во что сейчас разумно вложить следующие деньги">
        <Seg value={tab} onChange={setTab} options={[["best", "Лучшее сейчас"], ["plan", "Под мой портфель"], ["bonds", "Облигации"], ["stocks", "Дивиденды"], ["watch", "Наблюдаю"], ["targets", "Свои доли"]]} />
      </Header>
      {tab === "best" ? <BestTab /> : tab === "plan" ? <PlanTab /> : tab === "stocks" ? <StocksTab /> : tab === "bonds" ? <BondsAdvisor /> : tab === "watch" ? <WatchTab /> : <TargetsTab />}
      <p className="inv-faint mt-6 text-center text-xs leading-relaxed">
        Это расчёт по вашим целям и открытым данным биржи, а не индивидуальная инвестиционная рекомендация. Перед покупкой проверьте свежие новости компании.
      </p>
    </Screen>
  );
}

/* ── загрузка рыночных данных для идей ── */

export function useMarketLoaders() {
  const { settings } = useInvest();
  const [busy, setBusy] = useState<"stocks" | "bonds" | null>(null);
  const [status, setStatus] = useState("");
  async function stocks() {
    setBusy("stocks");
    try {
      await saveScreener(await loadScreener(settings.tbankToken.trim(), setStatus));
    } catch (e) {
      toast(`Не удалось загрузить: ${errorText(e)}`, "error");
    } finally {
      setBusy(null);
      setStatus("");
    }
  }
  async function bonds() {
    setBusy("bonds");
    try {
      const [rows, corp] = await Promise.all([ofzList(), corpList().catch(() => [])]);
      await saveBonds({ rows, corp, updatedAt: new Date().toISOString() });
    } catch (e) {
      toast(`Не удалось загрузить ОФЗ: ${errorText(e)}`, "error");
    } finally {
      setBusy(null);
    }
  }
  return { busy, status, stocks, bonds };
}

function PlanTab() {
  const { report: r, income, settings, setSettings, screener, bonds, keyRate, health } = useInvest();
  const def = Math.max(10_000, Math.round((income.averageMonthlyDeposit || 50_000) / 5000) * 5000);
  const [amount, setAmount] = useState<number>(def);
  const loaders = useMarketLoaders();
  const plan = useMemo(() => buildIdeas(r, settings.risk, amount, screener?.rows ?? [], bonds?.rows ?? [], keyRate), [r, settings.risk, amount, screener, bonds, keyRate]);
  const afterTotal = Object.values(plan.after).reduce((a, b) => a + b, 0);
  const idle = Math.max(0, r.cashRUB);
  const stale = (iso?: string) => !iso || Date.now() - ms(iso) > 3 * 86_400_000;

  return (
    <div className="space-y-4">
      <section className="inv-panel p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Сколько хочу вложить" hint={idle > 1000 ? <button type="button" className="font-bold text-[var(--inv-green)]" onClick={() => setAmount(Math.round(idle / 1000) * 1000)}>На счетах свободно {shortRub(idle)} — подставить</button> : `в среднем вы пополняете ${shortRub(income.averageMonthlyDeposit)} в месяц`}>
            <NumInput value={amount} onChange={setAmount} suffix="₽" min={0} />
          </Field>
          <Field label="Отношение к риску" hint={RISK_HINT[settings.risk]}>
            <Seg value={settings.risk} onChange={(v) => setSettings({ risk: v })} options={[["careful", RISK_TITLE.careful], ["balanced", RISK_TITLE.balanced], ["bold", RISK_TITLE.bold]]} />
          </Field>
        </div>
        <div className="inv-soft mt-4 p-3 text-[13px] leading-relaxed">
          Ключевая ставка ЦБ — <b>{num(keyRate, keyRate % 1 ? 2 : 0)} %</b>. {keyRate >= 12 ? "При высокой ставке облигации и фонды денежного рынка дают почти столько же, сколько акции в среднем, но без риска — поэтому план не торопится вкладывать всё в акции." : "При невысокой ставке акции становятся привлекательнее облигаций."}
        </div>
        {(stale(screener?.updatedAt) || stale(bonds?.updatedAt)) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="inv-muted">Для конкретных бумаг нужны свежие данные биржи:</span>
            {stale(screener?.updatedAt) && <Btn small loading={loaders.busy === "stocks"} onClick={loaders.stocks}>Загрузить акции</Btn>}
            {stale(bonds?.updatedAt) && <Btn small loading={loaders.busy === "bonds"} onClick={loaders.bonds}>Загрузить облигации</Btn>}
            {loaders.status && <span className="inv-muted">{loaders.status}</span>}
          </div>
        )}
      </section>

      {health.issues.some((i) => i.id === "idle-cash") && (
        <div className="rounded-2xl border border-[var(--inv-orange-soft)] bg-[var(--inv-orange-soft)] p-3 text-[13px] text-[var(--inv-orange)]">
          💤 На счетах лежат {shortRub(idle)} без дохода. Пока решаете, что купить, их стоит держать в фонде денежного рынка (LQDT) — он даёт ≈ ключевую ставку.
        </div>
      )}

      {plan.plans.map((p) => (
        <Panel
          key={p.cls}
          title={
            <>
              {CLASS_TITLE[p.cls]} <span className="inv-num text-[var(--inv-green)]">· {shortRub(p.amount)}</span>
            </>
          }
          right={
            <span className="inv-muted text-xs">
              сейчас {pct(p.now, { digits: 0 })} → цель {pct(p.target, { digits: 0 })}
            </span>
          }
        >
          {p.note && <p className="inv-muted mb-3 text-[13.5px] leading-relaxed">{p.note}</p>}
          <div className="space-y-2">
            {p.candidates.map((c) => (
              <div key={c.ticker} className="inv-soft p-3">
                <div className="flex items-center gap-3">
                  <Avatar ticker={c.ticker} type={p.cls === "bonds" ? "bond" : undefined} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-extrabold">
                      {c.name} <span className="inv-muted font-semibold">{c.ticker}</span>
                    </div>
                    {c.inPortfolio && <span className="inv-tag inv-tag-blue">уже есть</span>}
                  </div>
                  <div className="text-right">
                    <div className="inv-num text-sm font-extrabold">{shortRub(c.amount)}</div>
                    {c.units ? <div className="inv-muted text-xs">{qty(c.units)} шт × {money(c.price ?? 0)}</div> : null}
                  </div>
                </div>
                <ul className="mt-2 space-y-0.5 text-[13px]">
                  {c.why.map((w) => (
                    <li key={w}>• {w}</li>
                  ))}
                </ul>
                {c.risk && <div className="mt-1 text-xs text-[var(--inv-orange)]">Риск: {c.risk}</div>}
              </div>
            ))}
          </div>
        </Panel>
      ))}

      {plan.plans.length > 0 && (
        <Panel title="Портфель после покупок">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["shares", "bonds", "money", "gold"] as const).map((c) => (
              <Stat key={c} label={CLASS_SHORT[c]} value={pct(afterTotal > 0 ? plan.after[c] / afterTotal : 0, { digits: 0 })} hint={`цель ${pct(health.target[c], { digits: 0 })}`} />
            ))}
          </div>
        </Panel>
      )}

      <AiReview mode="ideas" amount={amount} />
    </div>
  );
}

function StocksTab() {
  const { screener, report: r } = useInvest();
  const loaders = useMarketLoaders();
  const [minYield, setMinYield] = useState(0);
  const [minYears, setMinYears] = useState(0);
  const [sector, setSector] = useState("");
  const [hideHeld, setHideHeld] = useState(false);
  const held = new Set(r.holdings.map((h) => h.instrument.ticker.toUpperCase()));
  const rows = (screener?.rows ?? []).filter((x) => x.yield * 100 >= minYield && x.yearsPaid >= minYears && (!sector || x.sector === sector) && (!hideHeld || !held.has(x.ticker)));
  const sectors = [...new Set((screener?.rows ?? []).map((x) => x.sector))].sort();
  return (
    <div className="space-y-4">
      <Panel
        title="Подбор дивидендных акций"
        info="Рейтинг 0–10 складывается из трёх частей: дивидендная доходность за 12 месяцев (до 4 баллов, максимум при 12 %), стабильность — сколько лет из последних 5 компания платила (до 3), рост выплат (до 3, максимум при +15 % в год). Высокая доходность не всегда хорошо: иногда рынок уже ждёт, что компания урежет дивиденды."
        right={<Btn small loading={loaders.busy === "stocks"} onClick={loaders.stocks}>{screener ? "Обновить" : "Загрузить"}</Btn>}
      >
        {loaders.status && <div className="inv-muted mb-2 text-xs">{loaders.status}</div>}
        {screener ? (
          <>
            <div className="inv-muted mb-3 text-xs">
              {screener.source === "tbank" ? "Дивиденды из T-Invest API" : "Дивиденды из встроенного справочника (приблизительно) — для точных данных укажите токен Т-Банка"} · {fmtDate(ms(screener.updatedAt))}
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select className="inv-input !text-sm" value={minYield} onChange={(e) => setMinYield(+e.target.value)}>
                {[0, 5, 8, 10, 12].map((v) => (
                  <option key={v} value={v}>{v ? `Доход от ${v} %` : "Доход: любой"}</option>
                ))}
              </select>
              <select className="inv-input !text-sm" value={minYears} onChange={(e) => setMinYears(+e.target.value)}>
                {[0, 3, 4, 5].map((v) => (
                  <option key={v} value={v}>{v ? `Платит ${v}+ из 5 лет` : "Платит: любая"}</option>
                ))}
              </select>
              <select className="inv-input !text-sm" value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="">Все отрасли</option>
                {sectors.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <Toggle checked={hideHeld} onChange={setHideHeld} label="Скрыть мои" />
            </div>
            {rows.map((x) => (
              <div key={x.ticker} className="inv-row">
                <Avatar ticker={x.ticker} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">
                    {x.name} {held.has(x.ticker) && <span className="inv-tag inv-tag-blue">есть</span>}
                  </div>
                  <div className="inv-muted truncate text-xs">
                    {x.ticker} · {x.sector} · {money(x.price)} · платила {x.yearsPaid}/5
                    {x.growth != null ? ` · рост ${pct(x.growth, { signed: true, digits: 0 })}/год` : ""}
                    {x.nextDate && ms(x.nextDate) > Date.now() ? ` · отсечка ${fmtDate(x.nextDate)}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="inv-num inv-gold text-sm font-extrabold">{pct(x.yield)}</div>
                  <div className="inv-muted text-xs">{x.basis}</div>
                </div>
                <div className={cn("inv-num grid size-9 flex-none place-items-center rounded-lg text-sm font-extrabold", x.score >= 7 ? "bg-[var(--inv-green-soft)] text-[var(--inv-green)]" : x.score >= 4.5 ? "bg-[var(--inv-gold-soft)] text-[var(--inv-gold)]" : "bg-[var(--inv-panel-3)] text-[var(--inv-muted)]")}>
                  {num(x.score, 1)}
                </div>
              </div>
            ))}
            {!rows.length && <div className="inv-muted py-4 text-sm">Под фильтры ничего не подошло.</div>}
          </>
        ) : (
          <div className="inv-muted py-4 text-sm">Нажмите «Загрузить» — модуль соберёт цены с Мосбиржи и историю дивидендов по {45} крупным компаниям (около минуты).</div>
        )}
      </Panel>
    </div>
  );
}

/* ── свои целевые доли (ребалансировка) ── */

function TargetsTab() {
  const { report: r, settings, setSettings } = useInvest();
  const [add, setAdd] = useState(50_000);
  const [allowSell, setAllowSell] = useState(false);
  const [useCash, setUseCash] = useState(true);
  const byClass = settings.rebalanceByClass;
  const items = useMemo(() => {
    if (byClass) {
      const groups: Record<string, { value: number; n: number }> = {};
      for (const h of r.holdings) {
        const g = (groups[h.instrument.type] ??= { value: 0, n: 0 });
        g.value += h.value;
        g.n++;
      }
      return Object.entries(groups)
        .map(([t, g]) => ({ id: `type:${t}`, name: ASSET_TITLE[t as AssetType], detail: `${g.n} бум.`, value: g.value, unit: 0 }))
        .sort((a, b) => b.value - a.value);
    }
    return r.holdings.map((h) => ({ id: h.id, name: h.instrument.name, detail: h.instrument.ticker, value: h.value, unit: h.quantity > 0 ? (h.value / h.quantity) * (h.instrument.lot ?? 1) : 0 }));
  }, [r.holdings, byClass]);
  const base = items.reduce((a, i) => a + i.value, 0);
  const available = Math.max(0, add) + (useCash ? Math.max(0, r.cashRUB) : 0);
  const tSum = items.reduce((a, i) => a + (settings.targets[i.id] ?? 0), 0);
  const total = base + available;
  const rows = items.map((i) => {
    const target = settings.targets[i.id] ?? 0;
    const desired = tSum > 0 ? (target / tSum) * total : 0;
    return { ...i, target, diff: desired - i.value, trade: 0, units: 0 };
  });
  if (tSum > 0) {
    if (allowSell) for (const x of rows) x.trade = x.diff;
    else {
      const pos = rows.reduce((a, x) => a + Math.max(0, x.diff), 0);
      const k = pos > available && pos > 0 ? available / pos : 1;
      for (const x of rows) x.trade = Math.max(0, x.diff) * k;
    }
    for (const x of rows) {
      if (x.unit > 0) {
        x.units = Math.trunc(x.trade / x.unit);
        x.trade = x.units * x.unit;
      }
    }
  }
  const spent = rows.reduce((a, x) => a + x.trade, 0);
  const setTarget = (id: string, v: number) => {
    const t = { ...settings.targets };
    if (v > 0) t[id] = v;
    else delete t[id];
    setSettings({ targets: t });
  };
  return (
    <div className="space-y-4">
      <Panel title="Условия" info="Задайте, какую долю портфеля хотите держать в каждом классе или бумаге (например, 55 % акций, 30 % облигаций, 15 % фондов). Модуль посчитает, что докупить на сумму пополнения. «Только покупки» ничего не продаёт — просто направляет деньги туда, где недобор. «С продажами» выравнивает полностью, но продажа с прибылью может повлечь налог.">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Пополнение">
            <NumInput value={add} onChange={setAdd} suffix="₽" min={0} />
          </Field>
          <Field label="Цели по">
            <Seg value={byClass ? "class" : "asset"} onChange={(v) => setSettings({ rebalanceByClass: v === "class" })} options={[["class", "Классам"], ["asset", "Бумагам"]]} />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6">
          <Toggle checked={useCash} onChange={setUseCash} label={`Учитывать свободные ${shortRub(Math.max(0, r.cashRUB))}`} />
          <Toggle checked={allowSell} onChange={setAllowSell} label="С продажами" />
        </div>
      </Panel>
      <Panel
        title="Что сделать"
        right={<span className={cn("inv-tag", Math.abs(tSum - 100) < 0.5 ? "inv-tag-green" : "inv-tag-orange")}>сумма целей {num(tSum, 0)} %</span>}
      >
        <div className="mb-3 flex gap-6 text-sm">
          <span>
            Доступно <b className="inv-num">{rub(available)}</b>
          </span>
          <span>
            Останется <b className="inv-num">{rub(available - spent)}</b>
          </span>
        </div>
        {rows.map((x) => {
          const now = base > 0 ? x.value / base : 0;
          return (
            <div key={x.id} className="inv-row">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{x.name}</div>
                <div className="inv-muted text-xs">
                  {x.detail} · {shortRub(x.value)} · сейчас {pct(now, { digits: 1 })}
                </div>
                {tSum > 0 && Math.abs(x.trade) >= 1 && (
                  <div className={cn("mt-0.5 text-xs font-bold", x.trade > 0 ? "inv-up" : "inv-down")}>
                    {x.trade > 0 ? "Докупить" : "Продать"} {x.units ? `${qty(Math.abs(x.units))} лот. · ` : ""}
                    {shortRub(Math.abs(x.trade))}
                  </div>
                )}
              </div>
              <NumInput className="w-24 flex-none" value={x.target} onChange={(v) => setTarget(x.id, v)} suffix="%" min={0} />
            </div>
          );
        })}
        {!rows.length && <div className="inv-muted py-3 text-sm">Нет бумаг.</div>}
      </Panel>
      <Details summary="Готовые шаблоны долей по классам">
        <div className="flex flex-wrap gap-2">
          {[
            ["Осторожный", { "type:share": 25, "type:bond": 60, "type:etf": 15 }],
            ["Сбалансированный", { "type:share": 50, "type:bond": 35, "type:etf": 15 }],
            ["Смелый", { "type:share": 75, "type:bond": 15, "type:etf": 10 }],
          ].map(([name, t]) => (
            <Btn key={name as string} small onClick={() => setSettings({ targets: t as Record<string, number>, rebalanceByClass: true })}>
              {name as string}
            </Btn>
          ))}
          <Btn small ghost onClick={() => setSettings({ targets: {} })}>Сбросить</Btn>
        </div>
        <p className="inv-muted mt-2 text-xs">Фонды здесь — отдельный класс (БПИФ любых видов). Подробнее о том, что внутри фондов, — в «Плане».</p>
        <Link to="/portfolio?tab=structure" className="mt-2 inline-block text-sm font-bold text-[var(--inv-green)]">Посмотреть структуру →</Link>
      </Details>
    </div>
  );
}
