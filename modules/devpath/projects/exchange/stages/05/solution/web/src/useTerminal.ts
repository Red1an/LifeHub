import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Account, type Book, type Instrument, type Order, type Quote, type Trade } from "./api";

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
 * Все данные терминала. refresh() перечитывает то, что могло измениться после действия пользователя.
 * Своих данных не дублируем: источник правды — сервер.
 */
export function useTerminal(accountId: string, ticker: string) {
  const [state, setState] = useState<TerminalState>(EMPTY);

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

  useEffect(() => {
    api.instruments().then((instruments) => setState((s) => ({ ...s, instruments })), () => {});
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
