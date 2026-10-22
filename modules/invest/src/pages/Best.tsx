import { Link, cn, toast, useStore } from "@lifehub/sdk";
import { useEffect, useMemo, useState } from "react";
import { Avatar, Btn, Panel, Seg } from "../components/ui.tsx";
import { fmtDate, ms } from "../lib/dates.ts";
import { errorText } from "../lib/http.ts";
import { money, num, pct, shortRub } from "../lib/fmt.ts";
import { CATEGORY_INFO, TIER_LABEL, bestBonds, runScan, scanAge, type BondCategory, type BondScanRow, type ScanData, type StockPick } from "../lib/scan.ts";
import { useInvest } from "../lib/store.tsx";

type SortKey = "total" | "div" | "quality" | "value" | "growth";
const SCORE_NAME: Record<Exclude<SortKey, "total">, string> = { div: "Дивиденды", quality: "Качество бизнеса", value: "Дёшево / дорого", growth: "Рост" };

/** «Лучшее сейчас»: подборка акций и облигаций по всему рынку, чтобы посмотреть и решить самому. */
export function BestTab() {
  const { settings, keyRate, report, advice } = useInvest();
  const [scan, setScan, scanState] = useStore<ScanData | null>("scan", null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [part, setPart] = useState<"stocks" | "bonds">("stocks");
  const token = settings.tbankToken.trim();

  async function refresh() {
    if (!token) return;
    setBusy(true);
    try {
      setScan(await runScan(token, keyRate, setStatus));
    } catch (e) {
      toast(`Не удалось собрать подборку: ${errorText(e)}`, "error");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }
  // Подборка устаревает за пару дней — обновляем сами при открытии
  useEffect(() => {
    if (!scanState.loading && token && scanAge(scan) > 2 && !busy) refresh();
  }, [token, scanState.loading]);

  const held = useMemo(() => new Map(report.holdings.map((h) => [h.instrument.ticker.toUpperCase(), h])), [report.holdings]);

  if (!token)
    return (
      <Panel>
        <div className="py-4 text-sm leading-relaxed">
          Для подборки нужен токен Т-Банка: мультипликаторы компаний (P/E, рентабельность, долг, дивиденды) и рейтинги облигаций берутся из его API.{" "}
          <Link to="/settings" className="font-bold text-[var(--inv-green)]">
            Подключить →
          </Link>
        </div>
      </Panel>
    );

  return (
    <div className="space-y-4">
      <section className="inv-panel p-4 sm:p-5">
        <p className="text-sm leading-relaxed">
          Модуль разобрал <b>{scan ? scan.stocks.length : "все ликвидные"}</b> акций Мосбиржи и <b>{scan ? scan.bonds.length : "сотни"}</b> облигаций по десятку показателей и отобрал лучшие для долгосрочного накопления. Это список <b>для изучения</b>: откройте, посмотрите плюсы и минусы, прочитайте новости — и решайте сами.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Seg value={part} onChange={setPart} options={[["stocks", "Акции"], ["bonds", "Облигации"]]} />
          <Btn small loading={busy} onClick={refresh}>
            Обновить
          </Btn>
          <span className="inv-faint text-xs">{busy ? status : scan ? `данные от ${fmtDate(ms(scan.updatedAt))}` : ""}</span>
        </div>
      </section>
      {!scan && busy && <Panel><div className="inv-muted py-4 text-sm">Собираю подборку — это около минуты…</div></Panel>}
      {scan && part === "stocks" && <Stocks scan={scan} held={held} advice={advice} />}
      {scan && part === "bonds" && <Bonds scan={scan} heldTickers={new Set(held.keys())} />}
      <p className="inv-faint text-center text-xs leading-relaxed">Оценка — по формальным показателям за прошлый год, не прогноз цены и не индивидуальная рекомендация. Мультипликаторы — из T-Invest API, цены — Мосбиржа.</p>
    </div>
  );
}

function Stocks({ scan, held, advice }: { scan: ScanData; held: Map<string, ReturnType<typeof useInvest>["report"]["holdings"][number]>; advice: ReturnType<typeof useInvest>["advice"] }) {
  const [sort, setSort] = useState<SortKey>("total");
  const [sector, setSector] = useState("");
  const [clean, setClean] = useState(true);
  const [hideHeld, setHideHeld] = useState(false);
  const [limit, setLimit] = useState(20);
  const [open, setOpen] = useState<string | null>(null);
  const sectors = [...new Set(scan.stocks.map((s) => s.sector))].sort();
  // Обычные и привилегированные акции одной компании — одна строка (лучшая по выбранному признаку)
  const issuer = (t: string) => (t.length === 5 && t.endsWith("P") ? t.slice(0, 4) : t);
  const seen = new Map<string, StockPick>();
  const list = scan.stocks
    .filter((s) => (!sector || s.sector === sector) && (!clean || s.red === 0) && (!hideHeld || !held.has(s.ticker)))
    .sort((a, b) => (sort === "total" ? b.total - a.total : b.scores[sort] - a.scores[sort]))
    .filter((s) => {
      const k = issuer(s.ticker);
      if (seen.has(k)) return false;
      seen.set(k, s);
      return true;
    });
  const twin = (s: StockPick) => scan.stocks.find((x) => x.ticker !== s.ticker && issuer(x.ticker) === issuer(s.ticker));
  return (
    <Panel
      title="Лучшие акции"
      info="Итог 0–10: дивиденды 30 %, качество бизнеса 30 % (рентабельность капитала, долг, денежный поток, прибыль), оценка 25 % (P/E, P/B, EV/EBITDA — чем ниже, тем дешевле), рост 15 % (выручка и прибыль за 5 лет и за год). Каждый показатель — место среди всех акций рынка. За тревожные признаки (убыток, большой долг, выплаты больше прибыли) итог снижается. «Без красных флагов» скрывает такие компании."
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <Seg value={sort} onChange={setSort} options={[["total", "Итог"], ["div", "Дивиденды"], ["quality", "Качество"], ["value", "Дёшево"], ["growth", "Рост"]]} />
        <select className="inv-input !min-h-9 !w-auto !text-sm" value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">Все отрасли</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className={cn("inv-tag !h-9 !px-3", clean && "inv-tag-green")} onClick={() => setClean(!clean)}>
          {clean ? "✓ " : ""}без красных флагов
        </button>
        <button className={cn("inv-tag !h-9 !px-3", hideHeld && "inv-tag-blue")} onClick={() => setHideHeld(!hideHeld)}>
          {hideHeld ? "✓ " : ""}скрыть мои
        </button>
      </div>
      {list.slice(0, limit).map((s, i) => (
        <StockRow key={s.ticker} s={s} twin={twin(s)} rank={i + 1} open={open === s.ticker} onToggle={() => setOpen(open === s.ticker ? null : s.ticker)} heldWeight={held.get(s.ticker)?.weight} verdict={held.get(s.ticker) ? advice.get(held.get(s.ticker)!.id)?.verdict : undefined} />
      ))}
      {list.length > limit && (
        <Btn className="mt-3 w-full" onClick={() => setLimit(limit + 20)}>
          Показать ещё ({list.length - limit})
        </Btn>
      )}
      {!list.length && <div className="inv-muted py-3 text-sm">Под фильтры ничего не подошло.</div>}
    </Panel>
  );
}

const scoreColor = (v: number) => (v >= 7 ? "var(--inv-green)" : v >= 4.5 ? "var(--inv-gold)" : "var(--inv-red)");

function StockRow({ s, twin, rank, open, onToggle, heldWeight, verdict }: { s: StockPick; twin?: StockPick; rank: number; open: boolean; onToggle: () => void; heldWeight?: number; verdict?: string }) {
  const m = s.m;
  const key = [m.dy != null ? `див ${num(m.dy, 1)} %` : "без дивидендов", m.pe != null ? `P/E ${num(m.pe, 1)}` : null, m.roe != null ? `ROE ${num(m.roe, 0)} %` : null].filter(Boolean).join(" · ");
  return (
    <div className="border-t border-[var(--inv-line)] first:border-t-0">
      <button onClick={onToggle} className="flex w-full items-center gap-3 py-3 text-left">
        <span className="inv-faint w-5 flex-none text-right text-xs font-bold">{rank}</span>
        <Avatar ticker={s.ticker} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold">{s.name}</span>
            {heldWeight != null && <span className="inv-tag inv-tag-blue flex-none">у вас {pct(heldWeight, { digits: 0 })}</span>}
          </div>
          <div className="inv-muted truncate text-xs">
            {s.sector} · {key}
          </div>
        </div>
        <div className="grid size-10 flex-none place-items-center rounded-xl text-sm font-extrabold" style={{ background: "var(--inv-panel-3)", color: scoreColor(s.total) }}>
          {num(s.total, 1)}
        </div>
      </button>
      {open && (
        <div className="inv-fade-in mb-3 space-y-3 pl-8">
          <div className="space-y-1.5">
            {(Object.keys(SCORE_NAME) as (keyof typeof SCORE_NAME)[]).map((k) => (
              <div key={k} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-2 text-[13px]">
                <span className="font-semibold">{SCORE_NAME[k]}</span>
                <div className="inv-bar !h-1.5">
                  <div style={{ width: `${s.scores[k] * 10}%`, background: scoreColor(s.scores[k]) }} />
                </div>
                <span className="inv-num text-right text-xs">{num(s.scores[k], 1)}</span>
              </div>
            ))}
          </div>
          {s.pros.length > 0 && (
            <ul className="space-y-0.5 text-[13px]">
              {s.pros.map((x) => (
                <li key={x} className="flex gap-2">
                  <span className="inv-up">+</span>
                  {x}
                </li>
              ))}
            </ul>
          )}
          {s.cons.length > 0 && (
            <ul className="space-y-0.5 text-[13px]">
              {s.cons.map((x) => (
                <li key={x} className="flex gap-2">
                  <span className="inv-down">−</span>
                  {x}
                </li>
              ))}
            </ul>
          )}
          <div className="inv-soft grid grid-cols-1 gap-x-6 gap-y-1 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <Metric k="Цена" v={money(s.price)} />
            <Metric k="Лот" v={`${s.lot} шт · ${shortRub(s.price * s.lot)}`} />
            <Metric k="Капитализация" v={m.cap ? shortRub(m.cap) : "—"} />
            <Metric k="Оборот в день" v={shortRub(s.liquidity)} />
            <Metric k="P/E" v={m.pe != null ? num(m.pe, 1) : "—"} />
            <Metric k="P/B" v={m.pb != null ? num(m.pb, 2) : "—"} />
            <Metric k="EV/EBITDA" v={m.evEbitda != null ? num(m.evEbitda, 1) : "—"} />
            <Metric k="Долг/EBITDA" v={m.ndEbitda != null ? num(m.ndEbitda, 1) : "—"} />
            <Metric k="ROE" v={m.roe != null ? `${num(m.roe, 0)} %` : "—"} />
            <Metric k="Див. за год" v={m.dy != null ? `${num(m.dy, 1)} %` : "—"} />
            <Metric k="Див. за 5 лет" v={m.dy5 != null ? `${num(m.dy5, 1)} %` : "—"} />
            <Metric k="Payout" v={m.payout != null ? `${num(m.payout, 0)} %` : "—"} />
            <Metric k="Выручка 5 лет" v={m.rev5 != null ? `${num(m.rev5, 0)} %` : "—"} />
            <Metric k="Прибыль 5 лет" v={m.eps5 != null ? `${num(m.eps5, 0)} %` : "—"} />
            <Metric k="Год: мин–макс" v={m.low52 && m.high52 ? `${num(m.low52, 0)}–${num(m.high52, 0)}` : "—"} />
            <Metric k="Бета" v={m.beta != null ? num(m.beta, 2) : "—"} />
          </div>
          {twin && (
            <div className="inv-soft px-3 py-2 text-[13px]">
              Есть и {twin.name.toLowerCase().includes("прив") ? "привилегированные" : "обычные"} акции ({twin.ticker}): итог {num(twin.total, 1)}, дивиденды {twin.m.dy != null ? `${num(twin.m.dy, 1)} %` : "—"}. Привилегированные обычно дешевле и с понятной дивидендной политикой, но без права голоса.
            </div>
          )}
          {verdict && <div className="text-[13px]">У вас уже есть — по правилам модуля: <b>{verdict === "buy" ? "можно докупать" : verdict === "hold" ? "держать" : verdict === "nobuy" ? "не докупать" : verdict === "trim" ? "сократить" : "перепроверить"}</b>.</div>}
          <div className="flex flex-wrap gap-2">
            <Link to={`/check?side=buy&t=${s.ticker}`} className="inv-btn inv-btn-sm inv-btn-main">
              Проверить покупку
            </Link>
            <WatchButton ticker={s.ticker} name={s.name} price={s.price} />
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="inv-muted">{k}</span>
      <span className="inv-num font-semibold">{v}</span>
    </div>
  );
}

function WatchButton({ ticker, name, price, market = "shares" }: { ticker: string; name: string; price: number; market?: "shares" | "bonds" }) {
  const { watch, setWatch } = useInvest();
  const has = watch.some((w) => w.ticker === ticker);
  return (
    <Btn
      small
      disabled={has}
      onClick={() => {
        setWatch((prev) => [...prev, { ticker, name, market, price, priceAt: new Date().toISOString(), addedAt: new Date().toISOString(), addedPrice: price }]);
        toast("Добавлено в «Наблюдаю»", "success");
      }}
    >
      {has ? "В списке наблюдения" : "В список наблюдения"}
    </Btn>
  );
}

function Bonds({ scan, heldTickers }: { scan: ScanData; heldTickers: Set<string> }) {
  const best = useMemo(() => bestBonds(scan.bonds), [scan.bonds]);
  const order: BondCategory[] = ["ofz", "reliable", "higher", "floater", "avoid"];
  return (
    <>
      {order.map((c) =>
        best[c].length ? (
          <Panel key={c} title={CATEGORY_INFO[c].title}>
            <p className="inv-muted -mt-1 mb-2 text-[13px] leading-relaxed">{CATEGORY_INFO[c].hint}</p>
            {best[c].map((b) => (
              <BondRow key={b.secid} b={b} held={heldTickers.has(b.secid)} avoid={c === "avoid"} />
            ))}
          </Panel>
        ) : null,
      )}
      <p className="inv-muted text-center text-xs">
        Подобрать облигации под свою сумму и срок — во вкладке{" "}
        <Link to="/ideas?tab=bonds" className="font-bold text-[var(--inv-green)]">
          «Облигации»
        </Link>
        .
      </p>
    </>
  );
}

function BondRow({ b, held, avoid }: { b: BondScanRow; held: boolean; avoid: boolean }) {
  const [open, setOpen] = useState(false);
  const unit = (b.price * b.face) / 100;
  return (
    <div className="border-t border-[var(--inv-line)] first:border-t-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 py-3 text-left">
        <Avatar ticker={b.secid} type="bond" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold">{b.name}</span>
            {held && <span className="inv-tag inv-tag-blue flex-none">есть</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {b.rating && b.tier ? <span className={cn("inv-tag", TIER_LABEL[b.tier][1])}>{b.rating.level}</span> : b.secid.startsWith("SU") ? <span className="inv-tag inv-tag-green">государство</span> : null}
            <span className="inv-muted">{b.years < 1 ? `${Math.round(b.years * 12)} мес.` : `${num(b.years, 1)} г.`}{b.couponsPerYear ? ` · купон ${b.couponsPerYear}× в год` : ""}</span>
          </div>
        </div>
        <div className="text-right">
          <div className={cn("inv-num text-sm font-extrabold", avoid ? "inv-down" : "inv-gold")}>{b.floating ? (b.couponPct ? pct(b.couponPct) : "плав.") : pct(b.yield)}</div>
          <div className="inv-muted text-[11px]">{b.floating ? "купон" : "в год"}</div>
        </div>
      </button>
      {open && (
        <div className="inv-fade-in mb-3 space-y-2 pl-12">
          <ul className="space-y-0.5 text-[13px]">
            {b.why.map((x) => (
              <li key={x}>• {x}</li>
            ))}
          </ul>
          {b.warn.map((x) => (
            <div key={x} className="text-xs text-[var(--inv-orange)]">
              ⚠ {x}
            </div>
          ))}
          <div className="inv-muted text-xs">
            Цена {num(b.price, 2)} % · одна облигация ≈ {money(unit)} · {b.end ? `до ${fmtDate(b.end, { year: "always" })}` : ""} · код {b.secid}
          </div>
          {!avoid && (
            <div className="flex flex-wrap gap-2">
              <Link to={`/check?side=buy&t=${b.secid}`} className="inv-btn inv-btn-sm inv-btn-main">
                Проверить покупку
              </Link>
              <WatchButton ticker={b.secid} name={b.name} price={unit} market="bonds" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
