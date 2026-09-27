import crypto from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getSettings, updateSettings } from "./settings.ts";

/*
 * Доступ:
 *  - с этого компьютера (localhost) — без пароля;
 *  - с телефона и других устройств — только после входа по паролю,
 *    а пока пароль не задан, доступ извне закрыт.
 *
 * Защита от чужих сайтов, открытых в браузере на этом компьютере:
 *  - «локальный» доступ засчитывается только при Host = localhost/127.0.0.1
 *    (защита от DNS rebinding);
 *  - все изменяющие запросы к /api требуют заголовок X-LifeHub, который
 *    сторонний сайт не может отправить без CORS-разрешения (а его нет).
 */

const COOKIE = "lh_session";
const SESSION_DAYS = 30;
const LOCAL_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function remoteAddress(c: Context): string {
  return (c.env as any)?.incoming?.socket?.remoteAddress ?? "";
}

export function isLocal(c: Context): boolean {
  return LOCAL_ADDRS.has(remoteAddress(c)) && LOCAL_HOSTS.test(c.req.header("host") ?? "");
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 32).toString("hex") };
}

export function setPassword(password: string | null) {
  if (password === null) {
    updateSettings({ password: undefined, sessionSecret: crypto.randomBytes(32).toString("hex") });
    return;
  }
  if (password.length < 6) throw new Error("Пароль должен быть не короче 6 символов");
  // Смена пароля завершает все старые сессии.
  updateSettings({ password: hashPassword(password), sessionSecret: crypto.randomBytes(32).toString("hex") });
}

function checkPassword(password: string): boolean {
  const p = getSettings().password;
  if (!p) return false;
  const h = hashPassword(password, p.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(p.hash, "hex"));
}

function sign(exp: number) {
  return crypto.createHmac("sha256", getSettings().sessionSecret).update(String(exp)).digest("hex");
}

function validSession(c: Context): boolean {
  const v = getCookie(c, COOKIE);
  if (!v || !getSettings().password) return false;
  const [exp, sig] = v.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(Number(exp));
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

const attempts = new Map<string, { n: number; until: number }>();

export async function handleLogin(c: Context) {
  const ip = remoteAddress(c);
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) return c.html(loginPage("Слишком много попыток. Подождите минуту."), 429);
  const form = await c.req.parseBody();
  const password = String(form.password ?? "");
  if (!checkPassword(password)) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
    return c.html(loginPage("Неверный пароль"), 401);
  }
  attempts.delete(ip);
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  setCookie(c, COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: "Lax",
    secure: c.req.url.startsWith("https:"),
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return c.redirect("/");
}

export function handleLogout(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.redirect("/login");
}

const PUBLIC_PATHS = new Set(["/login", "/manifest.webmanifest", "/icon.svg"]);

export async function authMiddleware(c: Context, next: Next) {
  const p = c.req.path;
  const local = isLocal(c);
  c.set("local" as never, local as never);

  if (p.startsWith("/api/") && c.req.method !== "GET" && c.req.header("x-lifehub") !== "1") {
    return c.json({ error: "Отсутствует заголовок X-LifeHub" }, 403);
  }
  if (local || PUBLIC_PATHS.has(p) || validSession(c)) return next();
  if (p.startsWith("/api/")) return c.json({ error: "Требуется вход" }, 401);
  return c.redirect("/login");
}

export function loginPage(error = "") {
  const hasPassword = !!getSettings().password;
  const body = hasPassword
    ? `<form method="post" action="/login">
        <input type="password" name="password" placeholder="Пароль" autofocus autocomplete="current-password" required>
        <button type="submit">Войти</button>
        ${error ? `<p class="err">${error}</p>` : ""}
      </form>`
    : `<p>Доступ с других устройств пока закрыт.</p>
       <p class="muted">Откройте LifeHub на компьютере (http://localhost) → Настройки → Доступ с телефона и задайте пароль.</p>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LifeHub — вход</title><link rel="icon" href="/icon.svg">
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #121211; color: #e9e9e4; }
  @media (prefers-color-scheme: light) { body { background: #f7f7f5; color: #1a1a18; } button { background: #1a1a18 !important; color: #fff !important; } }
  main { width: min(320px, 100% - 32px); }
  h1 { font-size: 18px; font-weight: 600; margin: 12px 0 20px; }
  form { display: grid; gap: 10px; }
  input, button { font: inherit; font-size: 15px; padding: 10px 12px; border-radius: 6px; border: 1px solid #8885; background: transparent; color: inherit; }
  button { background: #e9e9e4; color: #121211; border: 0; font-weight: 500; cursor: pointer; }
  .err { color: #e0675d; font-size: 14px; } .muted { opacity: .7; font-size: 14px; }
</style></head><body><main>
<img src="/icon.svg" width="36" height="36" alt=""><h1>LifeHub</h1>${body}
</main></body></html>`;
}
