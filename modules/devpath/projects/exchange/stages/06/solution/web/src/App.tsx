import { useState, type FormEvent } from "react";
import { api, ApiError, type Level, type Order, type Side } from "./api";
import { useTerminal } from "./useTerminal";

const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function readUrl() {
  const p = new URLSearchParams(location.search);
  return { account: p.get("account") ?? "", ticker: p.get("ticker") ?? "SBER" };
}

export function App() {
  const [{ account, ticker }, setUrl] = useState(readUrl);

  const choose = (t: string) => {
    const p = new URLSearchParams(location.search);
    p.set("ticker", t);
    // Адрес — часть состояния: ссылку можно отправить, перезагрузка не сбрасывает инструмент.
    history.replaceState(null, "", `?${p}`);
    setUrl({ account, ticker: t });
  };

  if (!account) return <div className="app-error" data-testid="app-error">Откройте терминал со счётом: ?account=…</div>;
  return <Terminal accountId={account} ticker={ticker} onTicker={choose} />;
}

function Terminal({ accountId, ticker, onTicker }: { accountId: string; ticker: string; onTicker: (t: string) => void }) {
  const t = useTerminal(accountId, ticker);
  if (t.error && !t.account) return <div className="app-error" data-testid="app-error">{t.error}</div>;
  if (t.loading && !t.account) return <div className="loading">Загрузка…</div>;
  const a = t.account!;
  const q = t.quote;

  return (
    <div className="terminal">
      <header>
        <div className="title">
          📈 {a.name}{" "}
          <span className={`connection ${t.connection}`} data-testid="connection" data-state={t.connection} title="Связь с биржей">
            {t.connection === "online" ? "● онлайн" : t.connection === "connecting" ? "○ подключение…" : "○ нет связи, переподключаюсь"}
          </span>
        </div>
        <nav className="tickers">
          {t.instruments.map((i) => (
            <button key={i.ticker} data-testid={`ticker-${i.ticker}`} aria-pressed={i.ticker === ticker} onClick={() => onTicker(i.ticker)}>
              {i.ticker}
            </button>
          ))}
        </nav>
      </header>

      <section className="card balance">
        <div>Деньги <b data-testid="cash" data-value={a.cash}>{money(a.cash)} ₽</b></div>
        <div>В резерве <b data-testid="reserved-cash" data-value={a.reservedCash}>{money(a.reservedCash)} ₽</b></div>
        <div data-testid="positions" className="positions">
          {a.positions.map((p) => (
            <span key={p.ticker} data-testid="position" data-ticker={p.ticker} data-qty={p.qty} data-reserved={p.reserved}>
              {p.ticker}: {p.qty}{p.reserved ? ` (${p.reserved} в заявках)` : ""}
            </span>
          ))}
        </div>
      </section>

      <section className="card quote">
        <Num id="quote-bid" label="Покупка" value={q?.bid ?? null} />
        <Num id="quote-ask" label="Продажа" value={q?.ask ?? null} />
        <Num id="quote-last" label="Последняя" value={q?.last ?? null} />
      </section>

      <div className="grid">
        <section className="card">
          <h2>Стакан {ticker}</h2>
          <Levels id="asks" levels={t.book.asks} kind="ask" />
          <Levels id="bids" levels={t.book.bids} kind="bid" />
        </section>

        <OrderForm accountId={accountId} ticker={ticker} onPlaced={t.refresh} />
      </div>

      <section className="card">
        <h2>Мои заявки</h2>
        <MyOrders orders={t.orders.filter((o) => o.ticker === ticker)} onChanged={t.refresh} />
      </section>

      <section className="card">
        <h2>Сделки</h2>
        <ul data-testid="trades" className="trades">
          {t.trades.map((x) => (
            <li key={x.id} data-testid="trade" data-price={x.price} data-qty={x.qty}>
              {money(x.price)} × {x.qty} <time>{new Date(x.at).toLocaleTimeString("ru-RU")}</time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Num({ id, label, value }: { id: string; label: string; value: number | null }) {
  return (
    <div>
      <div className="label">{label}</div>
      <b data-testid={id} data-value={value ?? ""}>{value === null ? "—" : money(value)}</b>
    </div>
  );
}

function Levels({ id, levels, kind }: { id: string; levels: Level[]; kind: "bid" | "ask" }) {
  // В разметке — порядок API (покупки по убыванию, продажи по возрастанию); продажи сверху переворачивает CSS.
  return (
    <div data-testid={id} className={`levels ${kind}`}>
      {levels.map((l) => (
        <div key={l.price} data-testid="level" data-price={l.price} data-qty={l.qty} className="level">
          <span>{money(l.price)}</span>
          <span>{l.qty}</span>
        </div>
      ))}
    </div>
  );
}

function OrderForm({ accountId, ticker, onPlaced }: { accountId: string; ticker: string; onPlaced: () => Promise<void> }) {
  const [side, setSide] = useState<Side>("buy");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Проверка до запроса: сервер всё равно проверит, но человеку не нужно ждать ответа, чтобы узнать про опечатку.
    const p = Number(price.replace(",", "."));
    const n = Number(qty);
    if (!Number.isFinite(p) || p <= 0 || Math.round(p * 100) !== p * 100) return setError("Цена — больше нуля, шаг 0,01");
    if (!Number.isInteger(n) || n <= 0) return setError("Количество — целое больше нуля");
    setError(null);
    setBusy(true);
    try {
      await api.place({ accountId, ticker, side, price: p, qty: n });
      setQty("");
      await onPlaced();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card order-form" onSubmit={submit} noValidate>
      <h2>Заявка</h2>
      <div className="sides">
        <button type="button" data-testid="side-buy" aria-pressed={side === "buy"} className="buy" onClick={() => setSide("buy")}>Купить</button>
        <button type="button" data-testid="side-sell" aria-pressed={side === "sell"} className="sell" onClick={() => setSide("sell")}>Продать</button>
      </div>
      <label>Цена <input data-testid="order-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label>Количество <input data-testid="order-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      {error && <div className="form-error" data-testid="form-error" role="alert">{error}</div>}
      <button data-testid="order-submit" disabled={busy} className={side}>{side === "buy" ? "Купить" : "Продать"} {ticker}</button>
    </form>
  );
}

const STATUS: Record<Order["status"], string> = { new: "активна", partial: "частично", filled: "исполнена", cancelled: "отменена" };

function MyOrders({ orders, onChanged }: { orders: Order[]; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const cancel = async (id: string) => {
    try {
      await api.cancel(id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await onChanged();
  };
  if (!orders.length) return <div data-testid="orders" className="empty">Заявок нет</div>;
  return (
    <>
      {error && <div className="form-error">{error}</div>}
      <ul data-testid="orders" className="orders">
        {orders.map((o) => (
          <li key={o.id} data-testid="order" data-id={o.id} data-status={o.status} className={o.side}>
            <span>{o.side === "buy" ? "Покупка" : "Продажа"} {o.filled}/{o.qty} по {money(o.price)}</span>
            <span className="status">{STATUS[o.status]}</span>
            {(o.status === "new" || o.status === "partial") && (
              <button data-testid="order-cancel" onClick={() => cancel(o.id)}>Отменить</button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
