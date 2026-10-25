/** Адрес API задаётся при сборке: VITE_API_URL=http://… npm run build. */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:5000";

export type Side = "buy" | "sell";

export interface Instrument {
  ticker: string;
  name: string;
  tick: number;
}

export interface Position {
  ticker: string;
  qty: number;
  reserved: number;
}

export interface Account {
  id: string;
  name: string;
  cash: number;
  reservedCash: number;
  positions: Position[];
}

export interface Order {
  id: string;
  ticker: string;
  side: Side;
  price: number;
  qty: number;
  filled: number;
  status: "new" | "partial" | "filled" | "cancelled";
}

export interface Level {
  price: number;
  qty: number;
}

export interface Book {
  bids: Level[];
  asks: Level[];
}

export interface Quote {
  ticker: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
}

export interface Trade {
  id: string;
  price: number;
  qty: number;
  at: string;
}

/** Ошибка API с понятным человеку текстом (из ProblemDetails). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function problemText(res: Response) {
  try {
    const p = await res.json();
    if (p.errors) return Object.values(p.errors as Record<string, string[]>).flat().join(". ");
    return p.detail ?? p.title ?? `Ошибка ${res.status}`;
  } catch {
    return `Ошибка ${res.status}`;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("Сервер недоступен", 0);
  }
  if (!res.ok) throw new ApiError(await problemText(res), res.status);
  return res.json() as Promise<T>;
}

export const api = {
  instruments: () => call<Instrument[]>("/instruments"),
  account: (id: string) => call<Account>(`/accounts/${id}`),
  orders: (accountId: string) => call<Order[]>(`/accounts/${accountId}/orders`),
  book: (ticker: string) => call<Book>(`/orderbook/${ticker}`),
  quote: (ticker: string) => call<Quote>(`/quotes/${ticker}`),
  trades: (ticker: string) => call<Trade[]>(`/trades?ticker=${ticker}`),
  place: (body: { accountId: string; ticker: string; side: Side; price: number; qty: number }) =>
    call<Order>("/orders", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) => call<Order>(`/orders/${id}`, { method: "DELETE" }),
};
