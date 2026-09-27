import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Корень репозитория хаба (где лежат platform/, server/, node_modules/). */
export const HUB_DIR = path.resolve(import.meta.dirname, "..");
export const PLATFORM_DIR = path.join(HUB_DIR, "platform");
export const BUILTIN_MODULES_DIR = path.join(HUB_DIR, "modules");
export const TEMPLATES_DIR = path.join(HUB_DIR, "templates");
export const GUIDE_FILE = path.join(HUB_DIR, "docs", "MODULE_GUIDE.md");

/** Пользовательские данные: модули, кэш библиотек, база. */
export const HOME = path.resolve(process.env.LIFEHUB_HOME || path.join(os.homedir(), ".lifehub"));
export const MODULES_DIR = path.join(HOME, "modules");
export const LIBS_DIR = path.join(HOME, "libs");
export const DATA_DIR = path.join(HOME, "data");
export const FILES_DIR = path.join(DATA_DIR, "files");
export const STAGING_DIR = path.join(HOME, "staging");
export const TRASH_DIR = path.join(HOME, "trash");
export const SETTINGS_FILE = path.join(HOME, "settings.json");
export const DB_FILE = path.join(DATA_DIR, "lifehub.db");
export const CERT_DIR = path.join(HOME, "cert");

export function ensureDirs() {
  for (const d of [HOME, MODULES_DIR, LIBS_DIR, DATA_DIR, FILES_DIR, STAGING_DIR, TRASH_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export const MODULE_ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

/** Как вызвать проверку модуля из любой папки (подсказка для Claude Code). */
export const CHECK_COMMAND = `node "${path.join(HUB_DIR, "bin", "lifehub.mjs").replaceAll("\\", "/")}" check`;
