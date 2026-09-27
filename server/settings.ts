import fs from "node:fs";
import crypto from "node:crypto";
import { SETTINGS_FILE } from "./paths.ts";

export interface Settings {
  /** scrypt-хэш пароля для доступа с других устройств. */
  password?: { salt: string; hash: string };
  /** Секрет для подписи сессионных cookie. */
  sessionSecret: string;
  /** Отключённые модули. */
  disabled: string[];
  /** Модули, которые обновляются автоматически (если слияние без конфликтов). */
  autoUpdate: string[];
  /** Порядок модулей в навигации. */
  order: string[];
  /** Виджеты на главной, скрытые пользователем ("module:widget"). */
  hiddenWidgets: string[];
  theme: "auto" | "light" | "dark";
  accent: string;
  /** URL JSON-каталогов с модулями. */
  catalogs: string[];
  /** Встроенные модули уже скопированы в папку пользователя. */
  seeded: boolean;
  userName?: string;
  /** Миграция на нейтральный дизайн выполнена. */
  designV2?: boolean;
  /** Нейронка: свой путь к Claude Code и модели. */
  ai?: { claudePath?: string; fastModel?: string; smartModel?: string };
}

const DEFAULTS: Settings = {
  sessionSecret: "",
  disabled: [],
  autoUpdate: [],
  order: [],
  hiddenWidgets: [],
  theme: "auto",
  accent: "ink",
  catalogs: [],
  seeded: false,
};

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  let raw: Partial<Settings> = {};
  try {
    raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {}
  cache = { ...DEFAULTS, ...raw };
  // Раньше акцентом по умолчанию был фиолетовый — переводим на нейтральный один раз.
  if (!raw.designV2) {
    if (cache.accent === "violet") cache.accent = "ink";
    cache.designV2 = true;
    saveSettings();
  }
  if (!cache.sessionSecret) {
    cache.sessionSecret = crypto.randomBytes(32).toString("hex");
    saveSettings();
  }
  return cache;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  saveSettings();
  return cache;
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cache, null, 2));
}

/** Настройки, которые можно отдать браузеру. */
export function publicSettings() {
  const s = getSettings();
  return {
    theme: s.theme,
    accent: s.accent,
    order: s.order,
    hiddenWidgets: s.hiddenWidgets,
    catalogs: s.catalogs,
    userName: s.userName ?? "",
    hasPassword: !!s.password,
  };
}
