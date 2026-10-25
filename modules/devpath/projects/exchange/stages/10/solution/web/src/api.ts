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

/* ───────────── вход ───────────── */

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
}

const AUTH_KEY = "exchange.auth";

export const auth = {
  get(): Tokens | null {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null") as Tokens | null;
    } catch {
      return null;
    }
  },
  set(t: Tokens | null) {
    if (t) localStorage.setItem(AUTH_KEY, JSON.stringify(t));
    else localStorage.removeItem(AUTH_KEY);
    window.dispatchEvent(new Event("exchange-auth"));
  },
};

/** Одно обновление на всех: десять запросов получили 401 одновременно — refresh уходит один раз. */
let refreshing: Promise<boolean> | null = null;

function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const t = auth.get();
    if (!t?.refreshToken) return false;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: t.refreshToken }) });
      if (!res.ok) return false;
      auth.set(await res.json());
      return true;
    } catch {
      return false;
    }
  })().finally(() => (refreshing = null));
  return refreshing;
}

async function call<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  let res: Response;
  const token = auth.get()?.accessToken;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError("Сервер недоступен", 0);
  }
  // Access-токен короткий: истёк — тихо обновляем и повторяем запрос. Не вышло — сессия закончилась, нужен вход.
  if (res.status === 401 && token && !retried) {
    if (await refresh()) return call<T>(path, init, true);
    auth.set(null);
  }
  if (!res.ok) throw new ApiError(await problemText(res), res.status);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface Me {
  id: string;
  login: string;
  roles: string[];
  accounts: { id: string; name: string }[];
}

export const api = {
  login: async (login: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login, password }) }).catch(() => null);
    if (!res) throw new ApiError("Сервер недоступен", 0);
    if (!res.ok) throw new ApiError(await problemText(res), res.status);
    auth.set(await res.json());
  },
  logout: async () => {
    const t = auth.get();
    if (t?.refreshToken) await call("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: t.refreshToken }) }).catch(() => {});
    auth.set(null);
  },
  me: () => call<Me>("/me"),
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
