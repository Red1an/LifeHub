import { request } from "./core.ts";

/*
 * Запросы в интернет (разрешение "network"). Идут через сервер хаба, поэтому
 * работают с любыми сайтами, даже без CORS, и с телефона. Локальная сеть недоступна.
 */

export interface NetFetchOptions {
  method?: "GET" | "POST" | "HEAD";
  /** Разрешены accept, accept-language, authorization, content-type, referer, user-agent, x-requested-with. */
  headers?: Record<string, string>;
  /** Тело POST-запроса строкой (JSON.stringify или URLSearchParams.toString()). */
  body?: string;
}

export interface NetResponse {
  status: number;
  ok: boolean;
  /** Адрес после перенаправлений. */
  url: string;
  contentType: string;
  text: string;
}

export class NetRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function createNet(module: string) {
  async function fetchUrl(url: string, opts: NetFetchOptions = {}): Promise<NetResponse> {
    try {
      const r = await request<Omit<NetResponse, "ok">>("POST", `/api/net/${module}/fetch`, { module, body: { url, ...opts } });
      return { ...r, ok: r.status >= 200 && r.status < 300 };
    } catch (e) {
      throw new NetRequestError((e as Error).message, (e as { status?: number }).status ?? 500);
    }
  }
  async function text(url: string, opts?: NetFetchOptions): Promise<string> {
    const r = await fetchUrl(url, opts);
    if (!r.ok) throw new NetRequestError(`Сайт ответил ошибкой ${r.status}`, r.status);
    return r.text;
  }
  return {
    /** Полный ответ: { status, ok, url, contentType, text }. Ошибка HTTP не бросает исключение. */
    fetch: fetchUrl,
    /** Текст страницы; бросает NetRequestError, если статус не 2xx. */
    text,
    /** Ответ в JSON. */
    json: async <T = any>(url: string, opts?: NetFetchOptions): Promise<T> => JSON.parse(await text(url, opts)) as T,
  };
}

export type Net = ReturnType<typeof createNet>;
