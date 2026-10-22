import { Loading, cn, confirm, toast, useCollection, useSearchParams } from "@lifehub/sdk";
import { useEffect, useMemo, useState } from "react";
import { Avatar, Btn, Details, Field, Header, NumInput, Panel, Screen, Seg } from "../components/ui.tsx";
import { fmtDate } from "../lib/dates.ts";
import { errorText } from "../lib/http.ts";
import { money, pct, qty, shortRub } from "../lib/fmt.ts";
import { quotes } from "../lib/moex.ts";
import { useInvest } from "../lib/store.tsx";
import { VERDICT_STYLE, checkTrade, type CheckResult, type Side, type Tone } from "../lib/tradecheck.ts";

/** Запись журнала решений: что проверяли, что ответил модуль и что вы сделали. */
interface Decision {
  side: Side;
  ticker: string;
  name: string;
  market: "shares" | "bonds";
  price: number;
  units: number;
  sum: number;
  verdict: CheckResult["verdict"];
  headline: string;
  /** Что сделали: купили/продали или передумали. */
  status?: "done" | "skipped";
}

const TONE_ICON: Record<Tone, string> = { bad: "🛑", warn: "⚠️", good: "✅", info: "ℹ️" };
const TONE_COLOR: Record<Tone, string> = { bad: "var(--inv-red)", warn: "var(--inv-orange)", good: "var(--inv-green)", info: "var(--inv-muted)" };

export function CheckPage() {
  const ctx = useInvest();
  const [params] = useSearchParams();
  const [side, setSide] = useState<Side>(params.get("side") === "sell" ? "sell" : "buy");
  const [query, setQuery] = useState(params.get("t") ?? "");
  const [amount, setAmount] = useState(10_000);
  const [sellAll, setSellAll] = useState(true);
  const [units, setUnits] = useState(1);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ r: CheckResult; docId?: string } | null>(null);
  const journal = useCollection<Decision>("decisions");

  const suggestions = useMemo(() => {
    const set = new Map<string, string>();
    for (const h of ctx.report.holdings) set.set(h.instrument.ticker, h.instrument.name);
    for (const w of ctx.watch) set.set(w.ticker, w.name);
    for (const s of ctx.screener?.rows ?? []) if (!set.has(s.ticker)) set.set(s.ticker, s.name);
    return [...set.entries()];
  }, [ctx.report.holdings, ctx.watch, ctx.screener]);

  if (ctx.loading) return <Loading />;

  async function run() {
    if (!query.trim()) return;
    setBusy(true);
    setRes(null);
    try {
      const r = await checkTrade(
        { side, query, amount: side === "buy" ? amount : undefined, units: side === "sell" && !sellAll ? units : undefined },
        { p: ctx.portfolio, market: ctx.market, r: ctx.report, settings: ctx.settings, mistakes: ctx.mistakes, advice: ctx.advice, screener: ctx.screener?.rows ?? [], ofz: ctx.bonds?.rows ?? [], corp: ctx.bonds?.corp ?? [], keyRate: ctx.keyRate, tax: ctx.tax, other: ctx.other },
      );
      const doc = await journal.add({ side, ticker: r.ticker, name: r.name, market: r.kind === "bond" ? "bonds" : "shares", price: r.price, units: r.units, sum: r.sum, verdict: r.verdict, headline: r.headline });
      setRes({ r, docId: doc.id });
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Header title="Проверить сделку" question="Перед покупкой или продажей — короткая проверка по вашим данным" />
      <section className="inv-panel p-4 sm:p-5">
        <Seg value={side} onChange={(v) => { setSide(v); setRes(null); }} options={[["buy", "Хочу купить"], ["sell", "Хочу продать"]]} />
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field label="Бумага" hint="тикер, ISIN или название">
            <input className="inv-input uppercase" list="inv-check-list" placeholder="например, SBER" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
            <datalist id="inv-check-list">
              {suggestions.map(([t, n]) => (
                <option key={t} value={t}>
                  {n}
                </option>
              ))}
            </datalist>
          </Field>
          {side === "buy" ? (
            <Field label="На сумму">
              <NumInput value={amount} onChange={setAmount} suffix="₽" min={0} />
            </Field>
          ) : (
            <Field label="Сколько продать">
              <Seg value={sellAll ? "all" : "part"} onChange={(v) => setSellAll(v === "all")} options={[["all", "Всё"], ["part", "Часть"]]} />
              {!sellAll && <NumInput className="mt-2" value={units} onChange={setUnits} suffix="шт" min={1} />}
            </Field>
          )}
        </div>
        <Btn main className="mt-4 w-full sm:w-auto" loading={busy} disabled={!query.trim()} onClick={run}>
          Проверить
        </Btn>
        <p className="inv-faint mt-2 text-xs">Проверка смотрит на ваш портфель, налоги, цену за год, дивиденды и вашу историю сделок. Это правила, а не прогноз цены.</p>
      </section>

      {res && <ResultCard res={res.r} onStatus={async (status) => { if (res.docId) await journal.update(res.docId, { status }); toast(status === "done" ? "Записал в журнал" : "Записал: передумали", "success"); }} />}

      <Journal items={journal.items} remove={(id) => journal.remove(id)} />
    </Screen>
  );
}

function ResultCard({ res, onStatus }: { res: CheckResult; onStatus: (s: "done" | "skipped") => void }) {
  const st = VERDICT_STYLE[res.verdict];
  const [marked, setMarked] = useState<"done" | "skipped" | null>(null);
  return (
    <section className="inv-panel inv-fade-in mt-4 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-4 sm:px-5" style={{ background: st.soft }}>
        <span className="text-3xl">{st.icon}</span>
        <div className="min-w-0">
          <div className="text-lg font-extrabold leading-tight" style={{ color: st.color }}>
            {res.headline}
          </div>
          <div className="text-sm">
            {res.side === "buy" ? "Купить" : "Продать"} {res.name} · {qty(res.units)} шт × {money(res.price)} = <b className="inv-num">{shortRub(res.sum)}</b>
            {res.lot > 1 ? ` (лот ${res.lot} шт)` : ""}
          </div>
        </div>
      </div>
      <div className="space-y-2 p-4 sm:p-5">
        {res.flags.map((f, i) => (
          <div key={i} className="flex gap-3">
            <span className="mt-0.5 flex-none">{TONE_ICON[f.tone]}</span>
            <div className="min-w-0">
              <div className="text-sm font-bold" style={{ color: f.tone === "info" ? undefined : TONE_COLOR[f.tone] }}>
                {f.title}
              </div>
              {f.text && <div className="inv-muted text-[13px] leading-relaxed">{f.text}</div>}
            </div>
          </div>
        ))}
        {res.next && <div className="inv-soft mt-2 px-3 py-2 text-[13px]">→ {res.next}</div>}
        <div className="inv-hr mt-3 flex flex-wrap items-center gap-2 pt-3">
          <span className="inv-muted text-[13px]">Что решили?</span>
          <Btn small main={marked === "done"} onClick={() => { setMarked("done"); onStatus("done"); }}>
            {res.side === "buy" ? "Купил" : "Продал"}
          </Btn>
          <Btn small main={marked === "skipped"} onClick={() => { setMarked("skipped"); onStatus("skipped"); }}>
            Передумал
          </Btn>
          <span className="inv-faint text-xs">Через время журнал покажет, было ли решение удачным.</span>
        </div>
      </div>
    </section>
  );
}

/** Журнал решений: цена тогда и сейчас — видно, помогла ли проверка. */
function Journal({ items, remove }: { items: (Decision & { id: string; createdAt: number })[]; remove: (id: string) => void }) {
  const [now, setNow] = useState<Record<string, number>>({});
  const list = [...items].sort((a, b) => b.createdAt - a.createdAt);
  const keyList = list.map((d) => `${d.market}:${d.ticker}`).join(",");
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, number> = {};
      for (const m of ["shares", "bonds"] as const) {
        const t = [...new Set(list.filter((d) => d.market === m).map((d) => d.ticker))];
        if (!t.length) continue;
        try {
          const q = await quotes(t, m);
          for (const [k, v] of Object.entries(q)) out[k] = v.price;
        } catch {
          /* без текущих цен — просто список */
        }
      }
      if (alive) setNow(out);
    })();
    return () => {
      alive = false;
    };
  }, [keyList]);
  if (!list.length) return null;
  const decided = list.filter((d) => d.status && now[d.ticker]);
  const helped = decided.filter((d) => outcome(d, now[d.ticker])?.good).length;
  return (
    <Panel title="Журнал решений" className="mt-4" info="Каждая проверка сохраняется. Отметьте, что сделали, — и со временем станет видно, где проверка уберегла от ошибки, а где нет. Ориентир — цена бумаги сейчас против цены в момент проверки.">
      {decided.length >= 3 && (
        <p className="mb-2 text-sm">
          Удачных решений: <b>{helped}</b> из {decided.length} (по изменению цены после решения).
        </p>
      )}
      {list.slice(0, 30).map((d) => {
        const cur = now[d.ticker];
        const o = cur ? outcome(d, cur) : null;
        return (
          <div key={d.id} className="inv-row items-start">
            <Avatar ticker={d.ticker} type={d.market === "bonds" ? "bond" : undefined} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">
                {d.side === "buy" ? "Купить" : "Продать"} {d.name}
              </div>
              <div className="inv-muted text-xs">
                {fmtDate(d.createdAt)} · {shortRub(d.sum)} по {money(d.price)} · модуль: {VERDICT_STYLE[d.verdict].icon} · {d.status === "done" ? (d.side === "buy" ? "купил" : "продал") : d.status === "skipped" ? "передумал" : "не отмечено"}
              </div>
              {o && <div className={cn("text-xs font-semibold", o.good ? "inv-up" : "inv-down")}>{o.text}</div>}
            </div>
            <button className="inv-faint text-xs" aria-label="Удалить запись" onClick={async () => (await confirm("Удалить запись из журнала?")) && remove(d.id)}>
              ✕
            </button>
          </div>
        );
      })}
      {list.length > 30 && <Details summary={`Ещё ${list.length - 30}`}><div className="inv-muted text-xs">Показаны последние 30 проверок.</div></Details>}
    </Panel>
  );
}

function outcome(d: Decision, cur: number): { good: boolean; text: string } | null {
  if (!d.status || !d.price) return null;
  const ch = cur / d.price - 1;
  if (Math.abs(ch) < 0.01) return { good: true, text: "цена почти не изменилась" };
  const money = Math.abs(ch) * d.sum;
  const f = `${pct(ch, { signed: true, digits: 1 })} (${ch > 0 ? "+" : "−"}${shortRub(money)})`;
  if (d.side === "buy") return d.status === "done" ? { good: ch > 0, text: `с покупки ${f}` } : { good: ch < 0, text: ch < 0 ? `хорошо, что не купили: ${f}` : `упущено: ${f}` };
  return d.status === "done" ? { good: ch < 0, text: ch < 0 ? `продали вовремя: ${f}` : `после продажи выросла: ${f}` } : { good: ch > 0, text: ch > 0 ? `хорошо, что не продали: ${f}` : `с тех пор ${f}` };
}
