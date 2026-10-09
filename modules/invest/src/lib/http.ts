import { net } from "@lifehub/sdk";

/*
 * Запросы к API брокеров и биржи идут через хаб (разрешение "network"): браузер сам туда не пустит,
 * а хаб знает корневой сертификат Минцифры, которым подписан API Т-Банка.
 */

export class HttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `HTTP ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

async function send(url: string, method: "GET" | "POST", body?: string, headers: Record<string, string> = {}): Promise<string> {
  let lastErr: unknown;
  // Сеть иногда моргает — один повтор для ошибок соединения и 429/5xx.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await net.fetch(url, { method, body, headers: { accept: "application/json", ...headers } });
      if (r.ok) return r.text;
      if ((r.status === 429 || r.status >= 500) && attempt === 0) {
        await sleep(r.status === 429 ? 2500 : 800);
        continue;
      }
      throw new HttpError(r.status, r.text);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      lastErr = e;
      if (attempt === 0) await sleep(600);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const sleep = (msec: number) => new Promise((r) => setTimeout(r, msec));

export async function getJSON<T = any>(url: string, headers?: Record<string, string>): Promise<T> {
  return JSON.parse(await send(url, "GET", undefined, headers)) as T;
}

export async function postJSON<T = any>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const text = await send(url, "POST", JSON.stringify(body), { "content-type": "application/json", ...headers });
  return (text ? JSON.parse(text) : {}) as T;
}

export async function postForm<T = any>(url: string, form: Record<string, string>): Promise<T> {
  const text = await send(url, "POST", new URLSearchParams(form).toString(), { "content-type": "application/x-www-form-urlencoded" });
  return JSON.parse(text) as T;
}

export async function getText(url: string): Promise<string> {
  const r = await net.fetch(url, { headers: { accept: "text/html,*/*" } });
  if (!r.ok) throw new HttpError(r.status, r.text);
  return r.text;
}

/* ── разбор нетипизированного JSON ── */

export type J = Record<string, any>;

export function str(o: J | undefined, k: string): string | undefined {
  const v = o?.[k];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/** Quotation/MoneyValue Т-Банка: {units: "12", nano: 500000000}. */
export function quotation(q: unknown): number | undefined {
  if (!q || typeof q !== "object") return undefined;
  const o = q as J;
  if (o.units === undefined && o.nano === undefined) return undefined;
  return Number(o.units ?? 0) + Number(o.nano ?? 0) / 1e9;
}

export function numv(o: J | undefined, k: string): number | undefined {
  const v = o?.[k];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  if (v && typeof v === "object") return quotation(v);
  return undefined;
}

export const arr = (o: J | undefined, k: string): J[] => (Array.isArray(o?.[k]) ? o![k] : []);

/** Выполняет задачи параллельно, не больше limit одновременно. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Понятный текст ошибки для журнала. */
export function errorText(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 401 || e.status === 403) return "токен не подошёл или у него нет доступа (401/403)";
    try {
      const j = JSON.parse(e.body);
      if (j.message) return `${j.message} (${e.status})`;
    } catch {
      /* не JSON */
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
