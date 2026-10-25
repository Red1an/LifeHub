import { useCallback, useEffect, useRef, useState } from "react";
import { api, API_URL, ApiError, type Account, type Book, type Instrument, type Order, type Quote, type Trade } from "./api";

export type Connection = "connecting" | "online" | "offline";

export interface TerminalState {
  instruments: Instrument[];
  account: Account | null;
  orders: Order[];
  book: Book;
  quote: Quote | null;
  trades: Trade[];
  error: string | null;
  loading: boolean;
}

const EMPTY: TerminalState = { instruments: [], account: null, orders: [], book: { bids: [], asks: [] }, quote: null, trades: [], error: null, loading: true };

/**
 * Данные терминала: снимок по REST, дальше — события по WebSocket.
 * Событие говорит «что-то изменилось», и мы перечитываем нужное. Пачку событий склеиваем в один запрос.
 */
export function useTerminal(accountId: string, ticker: string) {
  const [state, setState] = useState<TerminalState>(EMPTY);
  const [connection, setConnection] = useState<Connection>("connecting");

  const refresh = useCallback(async () => {
    try {
      const [account, orders, book, quote, trades] = await Promise.all([
        api.account(accountId),
        api.orders(accountId),
        api.book(ticker),
        api.quote(ticker),
        api.trades(ticker),
      ]);
      setState((s) => ({ ...s, account, orders, book, quote, trades, error: null, loading: false }));
    } catch (e) {
      const message = e instanceof ApiError && e.status === 404 ? "Счёт не найден" : e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, error: message, loading: false }));
    }
  }, [accountId, ticker]);

  // Последняя версия refresh для обработчиков сокета, чтобы не переподключаться при каждом рендере.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    api.instruments().then((instruments) => setState((s) => ({ ...s, instruments })), () => {});
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let syncTimer: ReturnType<typeof setTimeout> | undefined;

    const sync = () => {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => void refreshRef.current(), 50);
    };

    const connect = () => {
      setConnection(attempt === 0 ? "connecting" : "offline");
      ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws/quotes?ticker=${encodeURIComponent(ticker)}`);
      let first = true;
      ws.onopen = () => {
        // После обрыва что-то могло произойти без нас — перечитываем всё.
        if (attempt > 0) void refreshRef.current();
        attempt = 0;
        setConnection("online");
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data as string);
        if (m.type === "quote") setState((s) => ({ ...s, quote: m as Quote }));
        // Первое сообщение — снимок при подключении, его данные у нас уже есть.
        if (first) first = false;
        else sync();
      };
      ws.onclose = () => {
        if (stopped) return;
        setConnection("offline");
        attempt++;
        // Пауза растёт: 0,6 → 1,2 → 2,4 → … до 5 секунд, чтобы тысяча клиентов не добили упавший сервер.
        retryTimer = setTimeout(connect, Math.min(5000, 300 * 2 ** attempt) + Math.random() * 200);
      };
    };

    connect();
    return () => {
      // Смена инструмента или уход со страницы: старое соединение закрываем, иначе они копятся.
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(syncTimer);
      ws?.close();
    };
  }, [ticker]);

  return { ...state, connection, refresh };
}
