import fs from "node:fs";
import path from "node:path";
import { MODULE_ID_RE } from "./paths.ts";

export const KNOWN_PERMISSIONS = ["files", "mic", "camera", "notifications", "network", "ai", "google:calendar"] as const;

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  author?: string;
  /**
   * "app" — приложение со страницами, "library" — общий код для других модулей,
   * "service" — отдельное приложение со своим сервером: хаб запускает его и показывает внутри себя.
   */
  type: "app" | "library" | "service";
  /** Совместимая версия SDK хаба (semver-диапазон). */
  sdk: string;
  entry: string;
  /** npm-пакеты: общий кэш библиотек хаба. */
  deps: Record<string, string>;
  /** Модули-библиотеки: id → semver-диапазон. */
  uses: Record<string, string>;
  /** files, mic, camera, notifications, network, ai, google:calendar, read:<moduleId>. */
  permissions: string[];
  /** Коллекции и ключи useStore, которые другие модули могут читать (с разрешением read:<id>). */
  exports: { collections: string[]; stores: string[] };
  forkedFrom?: string;
  /** Только для type: "service". */
  service?: ServiceConfig;
}

/**
 * Как запустить модуль-сервис. В командах и env подставляются {port}, {dir} (папка модуля),
 * {data} (папка данных сервиса вне модуля), {python}, {node}.
 */
export interface ServiceConfig {
  /** Команда запуска сервера, например "npm start". */
  start: string;
  /** Порт, который слушает сервер (на 127.0.0.1). */
  port: number;
  /** Команда сборки: выполняется перед запуском, когда файлы модуля изменились. */
  build?: string;
  /** Начальная страница внутри сервиса. */
  path: string;
  /** Адрес проверки готовности (любой HTTP-ответ — сервер готов). */
  health?: string;
  env: Record<string, string>;
}

export class ManifestError extends Error {}

export function readManifest(dir: string): Manifest {
  const file = path.join(dir, "lifehub.json");
  if (!fs.existsSync(file)) throw new ManifestError(`Нет файла lifehub.json в ${dir}`);
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new ManifestError(`lifehub.json: неверный JSON — ${(e as Error).message}`);
  }
  return normalizeManifest(raw);
}

export function normalizeManifest(raw: any): Manifest {
  const errors: string[] = [];
  if (typeof raw !== "object" || !raw) throw new ManifestError("lifehub.json должен быть объектом");
  if (typeof raw.id !== "string" || !MODULE_ID_RE.test(raw.id))
    errors.push(`id должен соответствовать ${MODULE_ID_RE} (латиница в нижнем регистре, цифры, дефис)`);
  if (typeof raw.name !== "string" || !raw.name.trim()) errors.push("name обязателен");
  const type = raw.type ?? "app";
  if (type !== "app" && type !== "library" && type !== "service") errors.push('type: "app", "library" или "service"');
  let service: ServiceConfig | undefined;
  if (type === "service") {
    const sv = raw.service;
    if (typeof sv !== "object" || !sv) errors.push('service обязателен для type: "service"');
    else {
      if (typeof sv.start !== "string" || !sv.start.trim()) errors.push("service.start: команда запуска");
      if (!Number.isInteger(sv.port) || sv.port < 1024 || sv.port > 65535) errors.push("service.port: число от 1024 до 65535");
      const env = sv.env ?? {};
      if (typeof env !== "object" || Array.isArray(env) || Object.values(env).some((v) => typeof v !== "string"))
        errors.push("service.env: объект строк");
      service = {
        start: sv.start,
        port: sv.port,
        build: typeof sv.build === "string" && sv.build.trim() ? sv.build : undefined,
        path: typeof sv.path === "string" && sv.path.startsWith("/") ? sv.path : "/",
        health: typeof sv.health === "string" && sv.health.startsWith("/") ? sv.health : undefined,
        env,
      };
    }
  }
  const perms: string[] = Array.isArray(raw.permissions) ? raw.permissions : [];
  for (const p of perms) {
    if (!(KNOWN_PERMISSIONS as readonly string[]).includes(p) && !/^read:[a-z][a-z0-9-]+$/.test(p))
      errors.push(`неизвестное разрешение "${p}"`);
  }
  const deps = raw.deps ?? {};
  if (typeof deps !== "object" || Array.isArray(deps)) errors.push("deps должен быть объектом");
  const uses = raw.uses ?? {};
  if (typeof uses !== "object" || Array.isArray(uses)) errors.push("uses должен быть объектом");
  if (errors.length) throw new ManifestError("lifehub.json: " + errors.join("; "));
  return {
    id: raw.id,
    name: raw.name,
    version: typeof raw.version === "string" ? raw.version : "0.1.0",
    description: raw.description,
    icon: raw.icon,
    author: raw.author,
    type,
    sdk: raw.sdk ?? "^1",
    entry: raw.entry ?? (type === "library" ? "src/index.ts" : "src/index.tsx"),
    deps,
    uses,
    permissions: perms,
    exports: {
      collections: Array.isArray(raw.exports?.collections) ? raw.exports.collections : [],
      stores: Array.isArray(raw.exports?.stores) ? raw.exports.stores : [],
    },
    forkedFrom: raw.forkedFrom,
    ...(service ? { service } : {}),
  };
}

export function writeManifest(dir: string, patch: Partial<Manifest> & Record<string, unknown>) {
  const file = path.join(dir, "lifehub.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...raw, ...patch }, null, 2) + "\n");
}
