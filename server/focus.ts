import path from "node:path";
import * as db from "./db.ts";
import { emit } from "./events.ts";
import { HUB_DIR } from "./paths.ts";

/*
 * «Фокус» — осознанный вход на YouTube, в Инстаграм и т. п. Блокирует расширение браузера
 * (voice/browser-extension, то же, что у Джарвиса), хаб только хранит настройки и журнал.
 *
 * Настройки — kv "config" модуля modules/focus (формат — modules/focus/src/lib/types.ts, менять только вместе;
 * значения по умолчанию есть и у расширения, и у модуля). Сеансы — коллекция "sessions".
 * kv "extension" — когда расширение последний раз заходило (модуль показывает, подключено ли оно).
 *
 * Телефон — Фокус в приложении LifeHub (phone/android): те же настройки и сеансы через /api/app/focus/*
 * (server/mobile.ts, вход токеном устройства). kv "phone" — когда телефон заходил.
 */

export const FOCUS = "focus";
/** Короткие задачки «Кругозора» (modules/horizon, kv "quick") — на экран ожидания. */
const HORIZON = "horizon";

const seenWritten: Record<string, number> = {};

/** Где лежит расширение — модуль показывает путь в инструкции по установке. */
export function startFocus() {
  db.setKv(FOCUS, "install", { extensionPath: path.join(HUB_DIR, "voice", "browser-extension") });
}

/** Настройки для расширения (null — модуль ещё не сохранял, расширение берёт свои по умолчанию). */
export function focusConfig(version: string, device: "pc" | "phone" = "pc") {
  const key = device === "phone" ? "phone" : "extension";
  if (Date.now() - (seenWritten[key] ?? 0) > 60_000) {
    seenWritten[key] = Date.now();
    db.setKv(FOCUS, key, { seenAt: seenWritten[key], version: version.slice(0, 20) });
    emit({ type: "data", module: FOCUS, collection: `kv:${key}`, origin: "focus" });
  }
  return { config: db.getKv(FOCUS, "config") ?? null, puzzles: quickPuzzles() };
}

/** Последние задачки с вариантами ответа; формат — QuickPuzzle в modules/horizon/src/lib/types.ts. */
function quickPuzzles() {
  const q = db.getKv(HORIZON, "quick") as { items?: unknown[] } | undefined;
  const items = Array.isArray(q?.items) ? q.items : [];
  return items
    .slice(-20)
    .map((x: any) => ({
      id: str(x?.id, 40),
      text: str(x?.text, 400),
      options: (Array.isArray(x?.options) ? x.options : []).slice(0, 4).map((o: unknown) => str(o, 120)),
      answer: num(x?.answer) ?? -1,
      why: str(x?.why, 300),
    }))
    .filter((x) => x.text && x.options.length >= 2 && x.answer >= 0 && x.answer < x.options.length);
}

const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Начало или конец сеанса: расширение присылает его целиком с одним и тем же id. */
export function acceptSessions(body: any) {
  const list = Array.isArray(body?.sessions) ? body.sessions.slice(0, 100) : [];
  let n = 0;
  for (const s of list) {
    const id = str(s?.id, 40);
    if (!/^[a-zA-Z0-9_-]{4,40}$/.test(id)) continue;
    db.putDoc(
      FOCUS,
      "sessions",
      id,
      {
        site: str(s.site, 30),
        siteName: str(s.siteName, 40),
        purpose: str(s.purpose, 300),
        minutes: num(s.minutes) ?? 0,
        startedAt: num(s.startedAt) ?? Date.now(),
        endsAt: num(s.endsAt),
        endedAt: num(s.endedAt),
        endedBy: s.endedBy ? str(s.endedBy, 20) : null,
        waited: num(s.waited) ?? 0,
        titles: (Array.isArray(s.titles) ? s.titles : []).slice(0, 30).map((t: unknown) => str(t, 200)),
        device: s.device === "phone" ? "phone" : "pc",
      },
      false,
    );
    n++;
  }
  if (n) emit({ type: "data", module: FOCUS, collection: "sessions", origin: "focus" });
  return n;
}
