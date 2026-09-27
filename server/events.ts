/** Шина событий сервера → браузеры (через SSE). */
export type HubEvent =
  | { type: "modules" }
  | { type: "module-built"; id: string; hash: string; ok: boolean }
  | { type: "css"; hash: string }
  | { type: "platform"; hash: string }
  | { type: "settings" }
  | { type: "history"; id: string }
  | { type: "data"; module: string; collection: string; origin?: string };

type Listener = (e: HubEvent) => void;
const listeners = new Set<Listener>();

export function emit(e: HubEvent) {
  for (const l of listeners) {
    try {
      l(e);
    } catch {}
  }
}

export function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
