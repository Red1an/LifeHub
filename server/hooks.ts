import crypto from "node:crypto";
import * as db from "./db.ts";
import { emit } from "./events.ts";
import { getSettings, updateSettings } from "./settings.ts";
import { ensureNgrokPolicy, ngrokStatus } from "./ngrok.ts";
import { tailscaleStatus } from "./tailscale.ts";

/*
 * Входящий вебхук модуля (разрешение "webhook").
 *
 * Внешний сервис или телефон (MacroDroid, Tasker, «Команды» iOS) шлёт запрос на
 * /hook/<модуль>/<секрет> — без входа, доступ держится на секрете в адресе. Хаб кладёт
 * запрос в коллекцию "webhook" модуля, а модуль разбирает её, когда открыт, и удаляет
 * разобранное. ngrok пропускает /hook/ без входа через Google (server/ngrok.ts).
 */

export const HOOK_COLLECTION = "webhook";
/** Неразобранных запросов больше этого — новые не принимаем, чтобы чужой не забил базу. */
const MAX_PENDING = 1000;
const MAX_BODY = 64 * 1024;

const newSecret = () => crypto.randomBytes(18).toString("base64url");

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function secretOf(module: string, create: boolean): string | null {
  const hooks = getSettings().hooks ?? {};
  if (hooks[module]) return hooks[module];
  if (!create) return null;
  const secret = newSecret();
  updateSettings({ hooks: { ...hooks, [module]: secret } });
  return secret;
}

export interface HookInfo {
  path: string;
  urls: { label: string; url: string; public: boolean }[];
}

/** Адреса вебхука: через ngrok (из интернета), Tailscale и домашнюю сеть. Секрет создаётся при первом запросе. */
export async function hookInfo(module: string, opts: { port: number; https: boolean; lan: string[] }): Promise<HookInfo> {
  const path = `/hook/${module}/${secretOf(module, true)}`;
  const urls: HookInfo["urls"] = [];
  const ng = await ngrokStatus().catch(() => null);
  if (ng?.enabled && ng.domain) {
    await ensureNgrokPolicy().catch(() => {});
    urls.push({ label: "Из интернета (ngrok)", url: `https://${ng.domain}${path}`, public: true });
  }
  const ts = await tailscaleStatus(opts.port).catch(() => null);
  if (ts?.serve.url) urls.push({ label: "Tailscale", url: ts.serve.url + path, public: false });
  for (const ip of opts.lan) urls.push({ label: "Домашняя сеть", url: `${opts.https ? "https" : "http"}://${ip}:${opts.port}${path}`, public: false });
  return { path, urls };
}

export function rotateHook(module: string) {
  updateSettings({ hooks: { ...(getSettings().hooks ?? {}), [module]: newSecret() } });
}

/**
 * Принимает запрос. Тело — JSON, форма или текст; параметры адреса добавляются к нему.
 * null — адрес неверный (ответить 404).
 */
export function acceptHook(
  module: string,
  secret: string,
  req: { contentType: string; raw: string; query: Record<string, string> },
): { ok: true } | { error: string; status: number } | null {
  const own = secretOf(module, false);
  if (!own || !sameSecret(secret, own)) return null;
  if (req.raw.length > MAX_BODY) return { error: "Слишком большой запрос", status: 413 };
  const pending = db.listDocs(module, HOOK_COLLECTION).length;
  if (pending >= MAX_PENDING) return { error: "Очередь переполнена — откройте модуль", status: 429 };

  let body: unknown = req.raw;
  const ct = req.contentType.toLowerCase();
  if (ct.includes("json") || /^\s*[{[]/.test(req.raw)) {
    try {
      body = JSON.parse(req.raw);
    } catch {}
  } else if (ct.includes("x-www-form-urlencoded")) {
    body = Object.fromEntries(new URLSearchParams(req.raw));
  }
  const doc: Record<string, unknown> = { receivedAt: Date.now() };
  if (body && typeof body === "object" && !Array.isArray(body)) Object.assign(doc, body);
  else if (body !== "") doc.text = body;
  for (const [k, v] of Object.entries(req.query)) if (!(k in doc)) doc[k] = v;
  db.putDoc(module, HOOK_COLLECTION, undefined, doc, false);
  emit({ type: "data", module, collection: HOOK_COLLECTION, origin: "hook" });
  return { ok: true };
}
