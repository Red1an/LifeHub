import { db } from "@lifehub/sdk";
import type { Note } from "./types.ts";

/*
 * Записи без связи с хабом. Это не хранилище данных (данные — на сервере), а очередь на отправку:
 * - страница «Хаб недоступен» (server/app.ts, OFFLINE_HTML) кладёт сюда мысли, когда хаб не открывается;
 * - воронка кладёт сюда запись, если сохранить на сервер не вышло.
 * Ключ общий для хаба и модуля (одно происхождение). Формат: [{ text, at, source? }].
 */

export const OUTBOX_KEY = "lifehub-outbox";

interface Pending {
  text: string;
  at: number;
  source?: Note["source"];
}

function read(): Pending[] {
  try {
    const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.text === "string" && x.text.trim()) : [];
  } catch {
    return [];
  }
}

function write(list: Pending[]) {
  try {
    if (list.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch {}
}

export const pendingCount = () => read().length;

export function enqueue(text: string, source: Note["source"] = "text") {
  write([...read(), { text, at: Date.now(), source }]);
}

let draining: Promise<number> | null = null;

/** Отправить накопленное в воронку. Возвращает, сколько ушло; неотправленное остаётся. */
export function drain(): Promise<number> {
  if (draining) return draining;
  draining = (async () => {
    const list = read();
    let sent = 0;
    for (const p of list) {
      try {
        await db.collection<Note>("notes").add({ title: "", body: p.text.trim(), tags: [], pinned: false, status: "inbox", source: p.source ?? "offline", capturedAt: p.at });
        sent++;
      } catch {
        break;
      }
    }
    // Пока отправляли, могли добавиться новые — убираем только отправленные.
    write(read().slice(sent));
    return sent;
  })().finally(() => {
    draining = null;
  });
  return draining;
}
