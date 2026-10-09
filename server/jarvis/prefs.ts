import * as db from "../db.ts";

/*
 * Настройки Джарвиса живут в модуле «Джарвис» (modules/jarvis): useStore("config").
 * Сервер читает их отсюда; без модуля действуют значения по умолчанию.
 * Формат — как в modules/jarvis/src/lib/types.ts, менять только вместе.
 */

export const MODULE = "jarvis";

export type MorningPart = "events" | "deadlines" | "habits" | "devpath" | "portfolio";
export type EveningPart = "habits" | "spending" | "devpath" | "tomorrow" | "deadlines";

export interface CustomCommand {
  id: string;
  /** Фразы-триггеры, любая из них. */
  phrases: string[];
  /** Что сказать (может быть пусто). */
  say: string;
  /** Какие команды Джарвиса выполнить следом: «что дальше», «привычки»… */
  run: string[];
}

export interface Prefs {
  /** Принимать запросы от Алисы. */
  enabled: boolean;
  address: string;
  ai: boolean;
  aiLimit: number;
  morning: Record<MorningPart, boolean>;
  evening: Record<EveningPart, boolean>;
  commands: CustomCommand[];
  /** Сохранять разговоры с колонкой в историю модуля. */
  history: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  enabled: false,
  address: "сэр",
  ai: true,
  aiLimit: 20,
  morning: { events: true, deadlines: true, habits: true, devpath: true, portfolio: true },
  evening: { habits: true, spending: true, devpath: true, tomorrow: true, deadlines: true },
  commands: [],
  history: true,
};

export function prefs(): Prefs {
  const raw = (db.getKv(MODULE, "config") as Partial<Prefs> | undefined) ?? {};
  return {
    ...DEFAULT_PREFS,
    ...raw,
    morning: { ...DEFAULT_PREFS.morning, ...raw.morning },
    evening: { ...DEFAULT_PREFS.evening, ...raw.evening },
    commands: Array.isArray(raw.commands) ? raw.commands : [],
  };
}
