import crypto from "node:crypto";
import { getSettings, updateSettings } from "./settings.ts";

/*
 * Google для модулей (сейчас — только Календарь, разрешение "google:calendar").
 *
 * Пользователь один раз создаёт в Google Cloud OAuth-клиент типа «Desktop app» и вставляет
 * client_id/secret в настройки хаба. Вход идёт через http://127.0.0.1:<порт>/api/google/callback —
 * для Desktop-клиентов Google разрешает любой порт на 127.0.0.1 без регистрации адреса.
 * Refresh token хранится только на сервере; модули ходят в API через прокси хаба
 * (googleFetch), поэтому работает и с телефона, а токен в браузер не попадает.
 */

export class GoogleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar"];

/** Разрешение модуля → префикс API, к которому оно открывает доступ. */
export const GOOGLE_APIS: Record<string, string> = {
  "google:calendar": "https://www.googleapis.com/calendar/v3/",
};

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  email?: string;
}

const conf = (): GoogleSettings | undefined => getSettings().google;

export function googleStatus(redirectUri: string) {
  const g = conf();
  return {
    configured: !!(g?.clientId && g.clientSecret),
    connected: !!g?.refreshToken,
    email: g?.email ?? null,
    clientId: g?.clientId ?? "",
    redirectUri,
  };
}

export function configureGoogle(clientId: string, clientSecret: string) {
  clientId = clientId.trim();
  clientSecret = clientSecret.trim();
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new GoogleError("Client ID должен заканчиваться на .apps.googleusercontent.com");
  if (!/^[\w-]{10,}$/.test(clientSecret)) throw new GoogleError("Неверный Client secret");
  const cur = conf();
  // Новый клиент — старый токен к нему не подойдёт.
  const same = cur?.clientId === clientId;
  updateSettings({ google: { clientId, clientSecret, ...(same ? { refreshToken: cur?.refreshToken, email: cur?.email } : {}) } });
  token = null;
}

/* ───────────── вход ───────────── */

const pending = new Map<string, { verifier: string; redirectUri: string; at: number }>();

export function authUrl(redirectUri: string): string {
  const g = conf();
  if (!g?.clientId) throw new GoogleError("Сначала укажите Client ID и Client secret");
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k);
  const state = crypto.randomBytes(16).toString("hex");
  const verifier = crypto.randomBytes(32).toString("base64url");
  pending.set(state, { verifier, redirectUri, at: Date.now() });
  const q = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${q}`;
}

export async function finishAuth(code: string, state: string): Promise<string> {
  const p = pending.get(state);
  pending.delete(state);
  if (!p) throw new GoogleError("Ссылка входа устарела — начните заново из настроек хаба");
  const g = conf()!;
  const r = await tokenRequest({
    client_id: g.clientId,
    client_secret: g.clientSecret,
    code,
    code_verifier: p.verifier,
    grant_type: "authorization_code",
    redirect_uri: p.redirectUri,
  });
  if (!r.refresh_token) throw new GoogleError("Google не выдал refresh token. Отзовите доступ LifeHub в настройках аккаунта Google и подключите заново.");
  if (!String(r.scope ?? "").includes("calendar")) throw new GoogleError("Не выдан доступ к Календарю — при входе отметьте галочку «Календарь».");
  let email: string | undefined;
  try {
    email = JSON.parse(Buffer.from(String(r.id_token).split(".")[1], "base64url").toString()).email;
  } catch {}
  updateSettings({ google: { ...g, refreshToken: r.refresh_token, email } });
  token = { value: r.access_token, until: Date.now() + (r.expires_in - 60) * 1000 };
  return email ?? "";
}

export async function disconnectGoogle() {
  const g = conf();
  if (!g) return;
  if (g.refreshToken) await fetch(`${REVOKE_URL}?token=${encodeURIComponent(g.refreshToken)}`, { method: "POST" }).catch(() => {});
  updateSettings({ google: { clientId: g.clientId, clientSecret: g.clientSecret } });
  token = null;
}

/* ───────────── токен ───────────── */

let token: { value: string; until: number } | null = null;
let refreshing: Promise<string> | null = null;

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === "invalid_grant") {
      const g = conf();
      if (g?.refreshToken) updateSettings({ google: { clientId: g.clientId, clientSecret: g.clientSecret } });
      throw new GoogleError(
        "Доступ к Google истёк или отозван. Подключите Google заново в настройках хаба. Если это повторяется каждую неделю — переведите приложение в Google Cloud из режима Testing в In production.",
        401,
      );
    }
    throw new GoogleError(`Google: ${data.error_description ?? data.error ?? res.status}`);
  }
  return data;
}

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  if (refreshing) return refreshing;
  const g = conf();
  if (!g?.refreshToken) throw new GoogleError("Google не подключён: откройте настройки хаба на компьютере → Google → Подключить", 401);
  refreshing = tokenRequest({ client_id: g.clientId, client_secret: g.clientSecret, refresh_token: g.refreshToken, grant_type: "refresh_token" })
    .then((r) => {
      token = { value: r.access_token, until: Date.now() + (r.expires_in - 60) * 1000 };
      return token.value;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/* ───────────── прокси для модулей ───────────── */

export interface GoogleRequest {
  method: string;
  /** Полный URL API Google (с префиксом из GOOGLE_APIS). */
  url: string;
  body?: unknown;
}

export async function googleFetch(permissions: string[], req: GoogleRequest): Promise<{ status: number; data: unknown }> {
  const method = req.method.toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new GoogleError("Неверный метод");
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    throw new GoogleError("Неверный адрес");
  }
  const allowed = Object.entries(GOOGLE_APIS).find(([, prefix]) => url.href.startsWith(prefix));
  if (!allowed) throw new GoogleError("Этот адрес Google недоступен модулям");
  if (!permissions.includes(allowed[0])) throw new GoogleError(`Модулю нужно разрешение "${allowed[0]}" в lifehub.json`, 403);
  const send = async (t: string) =>
    fetch(url, {
      method,
      headers: { authorization: `Bearer ${t}`, ...(req.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });
  let res = await send(await accessToken());
  if (res.status === 401) {
    token = null;
    res = await send(await accessToken());
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
