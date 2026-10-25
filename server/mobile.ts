import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as db from "./db.ts";
import { HUB_DIR } from "./paths.ts";
import { getSettings, updateSettings } from "./settings.ts";

/*
 * Приложение LifeHub для Android (phone/android).
 *
 * Устройства — settings.devices: в настройках только хэш токена, сам токен знает телефон.
 * Подключение: на компьютере «Подключить телефон» → одноразовый код на 10 минут и QR со страницей
 * /hook/app/pair/<код> (без входа: ngrok пропускает /hook/). Там — APK и кнопка «Открыть в приложении»
 * (lifehub://pair), приложение забирает токен запросом /hook/app/pair/<код>/claim.
 *
 * Приложение ходит в хаб через /hook/app/<токен>/<путь>: app.ts переписывает такой запрос в обычный
 * с заголовком x-lifehub-device — authMiddleware пускает его как вошедшего, но никогда как «этот компьютер».
 */

export const APP_APK = path.join(HUB_DIR, "phone", "android", "build", "lifehub.apk");
const PAIR_TTL = 10 * 60_000;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const pairs = new Map<string, { expires: number }>();

export function newPairCode() {
  const now = Date.now();
  for (const [k, v] of pairs) if (v.expires < now) pairs.delete(k);
  const code = crypto.randomBytes(12).toString("base64url");
  pairs.set(code, { expires: now + PAIR_TTL });
  return { code, expires: now + PAIR_TTL };
}

export const pairValid = (code: string) => (pairs.get(code)?.expires ?? 0) > Date.now();

/** Код → токен нового устройства (один раз). */
export function claimPair(code: string, name: string): { token: string; id: string } | null {
  if (!pairValid(code)) return null;
  pairs.delete(code);
  const token = crypto.randomBytes(24).toString("base64url");
  const id = crypto.randomBytes(6).toString("hex");
  const devices = getSettings().devices ?? [];
  updateSettings({ devices: [...devices, { id, name: name.slice(0, 60) || "Телефон", tokenHash: hash(token), createdAt: Date.now() }] });
  return { token, id };
}

let seenWritten = new Map<string, number>();

/** Устройство по токену (и отметка «был на связи» не чаще раза в минуту). */
export function deviceFor(token: string | undefined) {
  if (!token || token.length < 20) return null;
  const h = hash(token);
  const devices = getSettings().devices ?? [];
  const d = devices.find((x) => x.tokenHash.length === h.length && crypto.timingSafeEqual(Buffer.from(x.tokenHash), Buffer.from(h)));
  if (!d) return null;
  if (Date.now() - (seenWritten.get(d.id) ?? 0) > 60_000) {
    seenWritten.set(d.id, Date.now());
    updateSettings({ devices: devices.map((x) => (x.id === d.id ? { ...x, seenAt: Date.now() } : x)) });
  }
  return d;
}

export function listDevices() {
  return (getSettings().devices ?? []).map(({ tokenHash: _t, ...d }) => d);
}

export function removeDevice(id: string) {
  updateSettings({ devices: (getSettings().devices ?? []).filter((d) => d.id !== id) });
  seenWritten = new Map([...seenWritten].filter(([k]) => k !== id));
}

/** Версия APK, который хаб может отдать (из build/version.json рядом с ним). */
export function apkInfo(): { versionCode: number; versionName: string; size: number } | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(path.dirname(APP_APK), "version.json"), "utf8"));
    return { versionCode: Number(v.versionCode) || 0, versionName: String(v.versionName ?? ""), size: fs.statSync(APP_APK).size };
  } catch {
    return null;
  }
}

/** Сообщения Джарвиса для уведомлений: ответы и напоминания с пометкой push. */
export function jarvisMessages(since: number) {
  return db
    .listDocs("jarvis", "chat")
    .filter((d) => d.push && Number(d.at ?? d.createdAt) > since)
    .slice(-20)
    .map((d) => ({ id: d.id, text: String(d.a ?? ""), at: Number(d.at ?? d.createdAt) }))
    .filter((m) => m.text);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Страница по QR: скачать приложение и открыть в нём подключение. */
export function pairPage(code: string, origin: string, ok: boolean) {
  const link = `lifehub://pair?code=${encodeURIComponent(code)}&base=${encodeURIComponent(origin)}`;
  const body = ok
    ? `<h1>Подключить телефон</h1>
<ol>
<li>${apkInfo() ? `<a class="btn" href="/hook/app/pair/${esc(code)}/app.apk">Скачать LifeHub</a><span>и установить (разрешите установку из браузера)</span>` : "Приложение ещё не собрано на компьютере."}</li>
<li><a class="btn main" href="${esc(link)}">Открыть в приложении</a><span>приложение запомнит хаб — пароль не нужен</span></li>
</ol>
<p class="muted">Ссылка одноразовая и работает 10 минут.</p>`
    : `<h1>Ссылка устарела</h1><p class="muted">Нажмите «Подключить телефон» в настройках хаба на компьютере ещё раз.</p>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LifeHub — телефон</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif}body{margin:0;min-height:100vh;background:#1d1210;color:#f6e3da;display:grid;place-items:center}
main{width:min(380px,100% - 32px)}h1{font-size:24px;margin:0 0 20px}ol{padding:0;list-style:none;display:grid;gap:18px}
li span{display:block;margin-top:6px;font-size:14px;color:#c9a99c}.btn{display:block;text-align:center;padding:14px;border-radius:14px;
border:1px solid #f4b39a55;color:#f4b39a;text-decoration:none;font-weight:600}.main{background:#f4b39a;color:#2a1714}.muted{color:#c9a99c;font-size:14px}
</style></head><body><main>${body}</main></body></html>`;
}
