import { Loading, Modal, cn, confirm, useStore } from "@lifehub/sdk";
import { useMemo, useState } from "react";
import { Btn, Field, Header, NumInput, Panel, Screen } from "../components/ui.tsx";
import { day, fmtDate, monthName, monthOf, yearOf } from "../lib/dates.ts";
import { money, qty } from "../lib/fmt.ts";
import { useInvest } from "../lib/store.tsx";
import { KEYS, refreshMarket } from "../lib/sync.ts";
import { TX_TITLE, type Portfolio, type Tx, type TxType } from "../lib/types.ts";

const PAGE = 150;

export function OperationsPage() {
  const { loading, portfolio, report } = useInvest();
  const [, setPortfolio] = useStore<Portfolio>(KEYS.portfolio, portfolio);
  const [type, setType] = useState<TxType | "">("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const name = (id?: string) => (id ? portfolio.instruments[id]?.name ?? id : "");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...report.transactions]
      .reverse()
      .filter((t) => (!type || t.type === type) && (!s || name(t.instrumentId).toLowerCase().includes(s) || (portfolio.instruments[t.instrumentId ?? ""]?.ticker ?? "").toLowerCase().includes(s) || (t.note ?? "").toLowerCase().includes(s)));
  }, [report.transactions, type, q]);
  if (loading) return <Loading />;
  const shown = list.slice(0, limit);
  let lastKey = "";
  return (
    <Screen>
      <Header title="Операции" question="Все сделки, пополнения и выплаты" />
      <Panel
        right={
          <Btn small main onClick={() => setAdding(true)}>
            + Добавить
          </Btn>
        }
        title={`${list.length} операций`}
      >
        <div className="mb-3 grid grid-cols-2 gap-2">
          <input className="inv-input !text-sm" placeholder="Поиск: тикер, название" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="inv-input !text-sm" value={type} onChange={(e) => setType(e.target.value as TxType | "")}>
            <option value="">Все типы</option>
            {(Object.keys(TX_TITLE) as TxType[]).map((t) => (
              <option key={t} value={t}>
                {TX_TITLE[t]}
              </option>
            ))}
          </select>
        </div>
        {shown.map((t) => {
          const key = `${yearOf(t.t)}-${monthOf(t.t)}`;
          const header = key !== lastKey;
          lastKey = key;
          const cash = t.amount - t.fee;
          const own = t.source === "manual" || t.source === "import";
          return (
            <div key={t.id}>
              {header && (
                <div className="inv-label mb-1 mt-3">
                  {monthName(monthOf(t.t))} {yearOf(t.t)}
                </div>
              )}
              <div className="inv-row !py-2.5">
                <div className="w-8 flex-none text-center text-sm font-extrabold">{new Date(t.t).getDate()}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">
                    {TX_TITLE[t.type]} {t.instrumentId && <span className="inv-muted font-semibold">· {name(t.instrumentId)}</span>}
                  </div>
                  <div className="inv-muted truncate text-xs">
                    {t.quantity && (t.type === "buy" || t.type === "sell") ? `${qty(t.quantity)} × ${money(t.price, t.currency)} · ` : ""}
                    {portfolio.accounts.find((a) => a.id === t.accountId)?.name}
                    {t.fee ? ` · ${t.type === "dividend" || t.type === "coupon" ? "налог" : "комиссия"} ${money(t.fee, t.currency)}` : ""}
                  </div>
                </div>
                <div className={cn("inv-num text-sm font-bold", cash > 0 && "inv-up")}>{money(cash, t.currency)}</div>
                {own && (
                  <button
                    className="inv-faint px-1 text-sm"
                    aria-label="Удалить операцию"
                    onClick={async () => {
                      if (await confirm("Удалить эту операцию?", { danger: true })) setPortfolio((p) => ({ ...p, transactions: p.transactions.filter((x) => x.id !== t.id) }));
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {list.length > limit && (
          <Btn className="mt-3 w-full" onClick={() => setLimit(limit + PAGE)}>
            Показать ещё
          </Btn>
        )}
      </Panel>
      {adding && <AddTx onClose={() => setAdding(false)} />}
    </Screen>
  );
}

function AddTx({ onClose }: { onClose: () => void }) {
  const { portfolio } = useInvest();
  const [, setPortfolio] = useStore<Portfolio>(KEYS.portfolio, portfolio);
  const [accountId, setAccountId] = useState(portfolio.accounts.find((a) => a.broker === "manual")?.id ?? portfolio.accounts[0]?.id ?? "");
  const [type, setType] = useState<TxType>("buy");
  const [date, setDate] = useState(day());
  const [ticker, setTicker] = useState("");
  const [count, setCount] = useState(1);
  const [price, setPrice] = useState(0);
  const [fee, setFee] = useState(0);
  const trade = type === "buy" || type === "sell";
  const needsTicker = trade || type === "dividend" || type === "coupon" || type === "repayment" || type === "amortization";

  function save() {
    const sym = ticker.trim().toUpperCase();
    const amount = trade ? (type === "buy" ? -1 : 1) * count * price : ["withdrawal", "fee", "tax"].includes(type) ? -Math.abs(price) : Math.abs(price);
    const tx: Tx = {
      id: `manual:${crypto.randomUUID()}`, accountId, date, type, instrumentId: needsTicker && sym ? sym : undefined,
      quantity: trade ? count : 0, price: trade ? price : 0, amount, currency: "RUB", fee, source: "manual",
    };
    setPortfolio((p) => ({ ...p, transactions: [...p.transactions, tx] }));
    onClose();
    if (needsTicker && sym && !portfolio.instruments[sym]) setTimeout(() => refreshMarket(), 400);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Новая операция"
      footer={
        <Btn main disabled={!accountId || (needsTicker && !ticker.trim()) || !price} onClick={save}>
          Добавить
        </Btn>
      }
    >
      <div className="inv-root -m-1 space-y-3 rounded-xl p-1">
        <Field label="Счёт">
          <select className="inv-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {portfolio.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Тип">
            <select className="inv-input" value={type} onChange={(e) => setType(e.target.value as TxType)}>
              {(Object.keys(TX_TITLE) as TxType[]).map((t) => (
                <option key={t} value={t}>
                  {TX_TITLE[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Дата">
            <input className="inv-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {needsTicker && (
          <Field label="Тикер или ISIN" hint="например, SBER или SU26238RMFS4">
            <input className="inv-input uppercase" value={ticker} onChange={(e) => setTicker(e.target.value)} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          {trade && (
            <Field label="Количество, шт">
              <NumInput value={count} onChange={setCount} min={0} />
            </Field>
          )}
          <Field label={trade ? "Цена за штуку" : "Сумма"}>
            <NumInput value={price} onChange={setPrice} suffix="₽" min={0} />
          </Field>
          <Field label={type === "dividend" || type === "coupon" ? "Налог удержан" : "Комиссия"}>
            <NumInput value={fee} onChange={setFee} suffix="₽" min={0} />
          </Field>
        </div>
        <p className="inv-faint text-xs">Добавлено {fmtDate(Date.now())}. Ручные операции можно удалить крестиком в списке.</p>
      </div>
    </Modal>
  );
}
