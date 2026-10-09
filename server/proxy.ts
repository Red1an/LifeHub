import zlib from "node:zlib";
import type { Context } from "hono";
import { servicePort } from "./services.ts";

/*
 * Прокси к модулям-сервисам: /s/<id>/… → http://127.0.0.1:<порт>/…
 * Запросы идут через хаб, поэтому сервис доступен с телефона и через ngrok/Tailscale
 * с тем же входом по паролю, хотя сам слушает только 127.0.0.1.
 */

const HOP = new Set([
  "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer",
  "host", "cookie", "accept-encoding", "content-length", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-lifehub",
]);

/**
 * Сервис написан под свой корень (fetch("/api/…")), а открыт по адресу /s/<id>/.
 * В его HTML-страницы добавляется скрипт, который переводит такие адреса под /s/<id>/.
 */
function patchScript(prefix: string) {
  return `<script>(function(){var P=${JSON.stringify(prefix)},O=location.origin;
function fix(u){try{var x=new URL(u,location.href);if(x.origin===O&&x.pathname!==P&&x.pathname.indexOf(P+"/")!==0){x.pathname=P+x.pathname;return x.href}}catch(e){}return u}
var F=window.fetch;window.fetch=function(i,o){if(typeof i==="string"||i instanceof URL)i=fix(String(i));else if(i&&i.url){var n=fix(i.url);if(n!==i.url)i=new Request(n,i)}return F.call(this,i,o)};
var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=fix(String(u));return X.apply(this,arguments)};
if(window.EventSource){var E=window.EventSource;window.EventSource=function(u,c){return new E(fix(String(u)),c)};window.EventSource.prototype=E.prototype}
})();</script>`;
}

export async function proxyService(c: Context, id: string): Promise<Response> {
  const prefix = `/s/${id}`;
  const url = new URL(c.req.url);
  const rest = url.pathname.slice(prefix.length);
  if (rest === "") return c.redirect(`${prefix}/${url.search}`);

  // Чужой сайт не должен менять данные сервиса от имени пользователя (на этом компьютере вход без пароля).
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return c.json({ error: "Запрос с чужого сайта" }, 403);
  }

  const port = servicePort(id);
  if (!port) return c.html(waitPage(), 503, { "retry-after": "2" });

  const headers = new Headers();
  for (const [k, v] of c.req.raw.headers) if (!HOP.has(k.toLowerCase())) headers.set(k, v);
  headers.set("host", `127.0.0.1:${port}`);
  headers.set("accept-encoding", "identity");
  // Сессию хаба сервису не передаём, его собственные cookie — передаём.
  const cookie = (c.req.header("cookie") ?? "").split(/;\s*/).filter((p) => p && !p.startsWith("lh_session=")).join("; ");
  if (cookie) headers.set("cookie", cookie);

  let upstream: Response;
  try {
    upstream = await fetch(`http://127.0.0.1:${port}${rest}${url.search}`, {
      method: c.req.method,
      headers,
      body: c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await c.req.arrayBuffer(),
      redirect: "manual",
      signal: c.req.raw.signal,
    });
  } catch {
    return c.html(waitPage(), 503, { "retry-after": "2" });
  }

  const out = new Headers();
  for (const [k, v] of upstream.headers) {
    const key = k.toLowerCase();
    if (key === "set-cookie" || HOP.has(key) || key === "content-encoding" || key === "x-frame-options") continue;
    out.set(k, v);
  }
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  const loc = upstream.headers.get("location");
  if (loc) {
    const fixed = loc.replace(/^https?:\/\/(127\.0\.0\.1|localhost):\d+/, "");
    out.set("location", fixed.startsWith("/") && !fixed.startsWith("//") && !fixed.startsWith(prefix + "/") ? prefix + fixed : fixed);
  }

  if ((upstream.headers.get("content-type") ?? "").includes("text/html")) {
    const html = await upstream.text();
    const inject = patchScript(prefix);
    const body = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
    return compressed(c, Buffer.from(body), out, upstream.status);
  }
  // Ответ целиком (известна длина) и сжимаемый — сжимаем: через ngrok и мобильную сеть это заметно.
  // Потоковые ответы (без длины, например ответ нейронки по частям) идут как есть, без задержки.
  const len = Number(upstream.headers.get("content-length") ?? NaN);
  if (len > 1024 && len < 8_000_000 && COMPRESSIBLE.test(upstream.headers.get("content-type") ?? "")) {
    return compressed(c, Buffer.from(await upstream.arrayBuffer()), out, upstream.status);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg)/;

function compressed(c: Context, body: Buffer, headers: Headers, status: number) {
  headers.append("vary", "accept-encoding");
  if (body.length > 1024 && /\bgzip\b/.test(c.req.header("accept-encoding") ?? "")) {
    headers.set("content-encoding", "gzip");
    return new Response(new Uint8Array(zlib.gzipSync(body, { level: 6 })), { status, headers });
  }
  return new Response(new Uint8Array(body), { status, headers });
}

/** Сервис ещё запускается: страница сама обновится. */
function waitPage() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;opacity:.7}</style>
<script>setTimeout(function(){location.reload()},2000)</script></head><body><p>Сервис запускается…</p></body></html>`;
}
