/* Связь с сервером хаба: HTTP-запросы и поток событий (SSE). */

export const clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);

export class HubRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface RequestOptions {
  module?: string;
  body?: unknown;
  raw?: BodyInit;
  headers?: Record<string, string>;
}

export async function request<T = unknown>(method: string, url: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "x-lifehub": "1", "x-lifehub-client": clientId, ...opts.headers };
  if (opts.module) headers["x-lifehub-module"] = opts.module;
  let body: BodyInit | undefined = opts.raw;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { method, headers, body });
  if (res.status === 401) {
    location.href = "/login";
    throw new HubRequestError("Требуется вход", 401);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new HubRequestError(data?.error ?? `Ошибка ${res.status}`, res.status);
  return data as T;
}

export type HubEvent =
  | { type: "modules" }
  | { type: "module-built"; id: string; hash: string; ok: boolean }
  | { type: "css"; hash: string }
  | { type: "platform"; hash: string }
  | { type: "settings" }
  | { type: "history"; id: string }
  | { type: "data"; module: string; collection: string; origin?: string }
  | { type: "reconnected" };

const listeners = new Set<(e: HubEvent) => void>();
let source: EventSource | null = null;
let connectedOnce = false;

function connect() {
  if (source) return;
  source = new EventSource("/api/events");
  source.addEventListener("hello", () => {
    // После обрыва связи (сон ноутбука, смена Wi‑Fi) могли пропустить изменения.
    if (connectedOnce) dispatch({ type: "reconnected" });
    connectedOnce = true;
  });
  source.onmessage = (m) => {
    try {
      dispatch(JSON.parse(m.data));
    } catch {}
  };
}

function dispatch(e: HubEvent) {
  for (const l of listeners) {
    try {
      l(e);
    } catch (err) {
      console.error(err);
    }
  }
}

export function onHubEvent(l: (e: HubEvent) => void): () => void {
  connect();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Сервисы, которые предоставляет оболочка (тосты, диалоги, манифесты модулей). */
export interface HostServices {
  toast(message: string, tone?: "info" | "success" | "error"): void;
  confirm(message: string, opts?: { title?: string; danger?: boolean; confirmText?: string }): Promise<boolean>;
  prompt(message: string, initial?: string): Promise<string | null>;
  manifest(id: string): ModuleManifest | undefined;
}

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  author?: string;
  type: "app" | "library";
  permissions: string[];
  exports: { collections: string[] };
  deps: Record<string, string>;
  uses: Record<string, string>;
  forkedFrom?: string;
}

let host: HostServices = {
  toast: (m) => console.log(m),
  confirm: async (m) => window.confirm(m),
  prompt: async (m, i) => window.prompt(m, i),
  manifest: () => undefined,
};

export const setHost = (h: HostServices) => {
  host = h;
};
export const getHost = () => host;
