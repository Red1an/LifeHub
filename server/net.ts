import dns from "node:dns/promises";
import net from "node:net";
import { HubError } from "./registry.ts";

/*
 * Запросы модулей в интернет через хаб (разрешение "network").
 * Браузер не пускает модуль на чужие сайты без CORS (сайты с аккордами, поиск YouTube),
 * поэтому страницу забирает сервер и отдаёт текстом. Ходить можно только на публичные
 * адреса: локальная сеть и сам компьютер с хабом модулям недоступны.
 */

export interface NetRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface NetResponse {
  status: number;
  /** Адрес после перенаправлений. */
  url: string;
  contentType: string;
  text: string;
}

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const ALLOWED_HEADERS = new Set(["accept", "accept-language", "content-type", "referer", "user-agent", "x-requested-with"]);
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function checkHost(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HubError("Можно только http и https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new HubError("Локальные адреса модулям недоступны", 403);
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((x) => x.address);
  if (!ips.length) throw new HubError(`Сайт ${host} не найден`, 502);
  if (ips.some(privateIp)) throw new HubError("Локальные адреса модулям недоступны", 403);
}

export async function netFetch(permissions: string[], req: NetRequest): Promise<NetResponse> {
  if (!permissions.includes("network")) throw new HubError('Модулю нужно разрешение "network" в lifehub.json', 403);
  const method = (req.method ?? "GET").toUpperCase();
  if (!["GET", "POST", "HEAD"].includes(method)) throw new HubError("Неверный метод");
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    throw new HubError("Неверный адрес");
  }

  const headers: Record<string, string> = { "user-agent": BROWSER_UA, "accept-language": "ru-RU,ru;q=0.9,en;q=0.8" };
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (ALLOWED_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = String(v);
  }

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  for (let hop = 0; ; hop++) {
    await checkHost(url);
    try {
      res = await fetch(url, { method, headers, body: method === "POST" ? req.body : undefined, redirect: "manual", signal });
    } catch (e) {
      const msg = (e as Error).name === "TimeoutError" ? "сайт не ответил вовремя" : (e as Error).message;
      throw new HubError(`Не удалось загрузить ${url.hostname}: ${msg}`, 502);
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop >= MAX_REDIRECTS) throw new HubError("Слишком много перенаправлений", 502);
      url = new URL(loc, url);
      continue;
    }
    break;
  }

  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new HubError("Ответ слишком большой", 502);
      }
      chunks.push(value);
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  return { status: res.status, url: url.href, contentType: res.headers.get("content-type") ?? "", text };
}
