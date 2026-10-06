import { useEffect, useState } from "react";
import { getHost, onHubEvent, request } from "./core.ts";

/*
 * Google для модулей (сейчас — Календарь, разрешение "google:calendar").
 * Аккаунт подключается один раз в настройках хаба; запросы идут через сервер хаба,
 * токен в браузер не попадает — поэтому работает и с телефона.
 */

const CALENDAR = "https://www.googleapis.com/calendar/v3";

export interface GoogleStatus {
  /** В хабе указан OAuth-клиент. */
  configured: boolean;
  /** Аккаунт подключён. */
  connected: boolean;
  email: string | null;
}

export interface GoogleFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Параметры ?query=… (массив — повторяющийся параметр). */
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
}

export class GoogleRequestError extends Error {
  /** HTTP-статус Google (401 — аккаунт не подключён или доступ отозван, 403 — нет разрешения). */
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function createGoogle(module: string) {
  async function call<T>(url: string, opts: GoogleFetchOptions = {}): Promise<T> {
    const u = new URL(url);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined) continue;
      for (const x of Array.isArray(v) ? v : [v]) u.searchParams.append(k, String(x));
    }
    let r: { status: number; data: any };
    try {
      r = await request<{ status: number; data: any }>("POST", `/api/google/${module}/fetch`, {
        module,
        body: { method: opts.method ?? "GET", url: u.href, body: opts.body },
      });
    } catch (e) {
      throw new GoogleRequestError((e as Error).message, (e as { status?: number }).status ?? 500);
    }
    if (r.status >= 400) {
      const msg = r.data?.error?.message ?? (typeof r.data === "string" ? r.data : `Ошибка Google ${r.status}`);
      throw new GoogleRequestError(msg, r.status);
    }
    return r.data as T;
  }

  return {
    /** Подключён ли аккаунт Google в хабе. */
    status: () => request<GoogleStatus>("GET", "/api/google/status"),
    /** Запрос к API Google по полному адресу. */
    fetch: call,
    /** Google Calendar API v3: path относительно /calendar/v3 ("/users/me/calendarList"). */
    calendar: <T = any>(path: string, opts?: GoogleFetchOptions) => call<T>(CALENDAR + path, opts),
  };
}

export type Google = ReturnType<typeof createGoogle>;

export function makeUseGoogle(google: Google) {
  /** Статус подключения Google; обновляется, когда пользователь подключает аккаунт. */
  return function useGoogle() {
    const [status, setStatus] = useState<GoogleStatus | null>(null);
    useEffect(() => {
      let alive = true;
      const load = () =>
        google
          .status()
          .then((s) => alive && setStatus(s))
          .catch((e) => getHost().toast((e as Error).message, "error"));
      load();
      const off = onHubEvent((e) => {
        if (e.type === "settings" || e.type === "reconnected") load();
      });
      return () => {
        alive = false;
        off();
      };
    }, []);
    return { status, loading: !status };
  };
}
