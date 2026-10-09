import { confirm, toast } from "@lifehub/sdk";
import { useState } from "react";
import { Avatar, Btn, Field, NumInput, Panel } from "../components/ui.tsx";
import { fmtDate } from "../lib/dates.ts";
import { errorText } from "../lib/http.ts";
import { money, pct } from "../lib/fmt.ts";
import { quotes, resolveSecurity } from "../lib/moex.ts";
import { useInvest } from "../lib/store.tsx";
import type { WatchItem } from "../lib/types.ts";

/*
 * Список наблюдения (как в Snowball и Stock Events): бумаги, которые хочется купить по своей цене.
 * Цены — с Мосбиржи по кнопке «Обновить» (и при каждом добавлении). Дошла до цели — появляется в «Что делать».
 */
export function WatchTab() {
  const { watch, setWatch, screener, report } = useInvest();
  const [ticker, setTicker] = useState("");
  const [target, setTarget] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const held = new Set(report.holdings.map((h) => h.instrument.ticker.toUpperCase()));

  async function refresh(list: WatchItem[]): Promise<WatchItem[]> {
    const out = [...list];
    for (const mkt of ["shares", "bonds"] as const) {
      const group = out.filter((w) => w.market === mkt);
      if (!group.length) continue;
      const q = await quotes(group.map((w) => w.ticker), mkt);
      for (const w of group) if (q[w.ticker]) Object.assign(w, { price: q[w.ticker].price, priceAt: new Date().toISOString() });
    }
    return out;
  }

  async function add() {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setBusy(true);
    try {
      const info = await resolveSecurity(t);
      if (!info) throw new Error(`Не нашёл «${t}» на Мосбирже`);
      const mkt = info.market === "bonds" ? "bonds" : "shares";
      const [item] = await refresh([{ ticker: info.secid, name: info.shortName, market: mkt, target: target || undefined, note: note.trim() || undefined, addedAt: new Date().toISOString() }]);
      item.addedPrice = item.price;
      setWatch((prev) => [...prev.filter((w) => w.ticker !== item.ticker), item]);
      setTicker("");
      setTarget(0);
      setNote("");
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Добавить бумагу" info="Запишите, что хотите купить и по какой цене. Когда цена дойдёт до цели, пункт появится в «Что делать». Заметка поможет вспомнить, почему вы её выбрали, — это защищает от импульсивных покупок.">
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <Field label="Тикер или ISIN">
            <input className="inv-input uppercase" placeholder="например, MGNT" value={ticker} onChange={(e) => setTicker(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          </Field>
          <Field label="Куплю по цене">
            <NumInput value={target} onChange={setTarget} suffix="₽" min={0} />
          </Field>
        </div>
        <input className="inv-input mt-3" placeholder="Почему хочу купить (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Btn main className="mt-3" loading={busy} disabled={!ticker.trim()} onClick={add}>
          Добавить
        </Btn>
      </Panel>
      <Panel
        title={`Наблюдаю (${watch.length})`}
        right={
          watch.length ? (
            <Btn
              small
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const next = await refresh(watch.map((w) => ({ ...w })));
                  setWatch(next);
                } catch (e) {
                  toast(errorText(e), "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Обновить цены
            </Btn>
          ) : undefined
        }
      >
        {!watch.length && <div className="inv-muted py-3 text-sm">Пока пусто. Добавьте бумагу, которую присматриваете.</div>}
        {watch.map((w) => {
          const reached = w.target && w.price && w.price <= w.target;
          const toTarget = w.target && w.price ? w.target / w.price - 1 : null;
          const scr = screener?.rows.find((s) => s.ticker === w.ticker);
          return (
            <div key={w.ticker} className="inv-row items-start">
              <Avatar ticker={w.ticker} type={w.market === "bonds" ? "bond" : undefined} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-bold">{w.name}</span>
                  {reached && <span className="inv-tag inv-tag-green">🎯 цена дошла</span>}
                  {held.has(w.ticker) && <span className="inv-tag inv-tag-blue">есть в портфеле</span>}
                </div>
                <div className="inv-muted text-xs">
                  {w.ticker}
                  {w.target ? ` · цель ${money(w.target)}` : ""}
                  {toTarget != null && !reached ? ` · ещё ${pct(-toTarget, { digits: 0 })} до цели` : ""}
                  {scr ? ` · дивиденды ${pct(scr.yield)}, рейтинг ${scr.score.toFixed(1).replace(".", ",")}` : ""}
                </div>
                {w.note && <div className="mt-0.5 text-xs">«{w.note}»</div>}
                <div className="inv-faint text-[11px]">
                  добавлена {fmtDate(w.addedAt)}
                  {w.addedPrice && w.price ? ` по ${money(w.addedPrice)} · с тех пор ${pct(w.price / w.addedPrice - 1, { signed: true })}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="inv-num text-sm font-extrabold">{w.price ? money(w.price) : "—"}</div>
                <button
                  className="inv-faint mt-1 text-xs"
                  onClick={async () => {
                    if (await confirm(`Убрать ${w.name} из списка?`)) setWatch((prev) => prev.filter((x) => x.ticker !== w.ticker));
                  }}
                >
                  убрать
                </button>
              </div>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}
