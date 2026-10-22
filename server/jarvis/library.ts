import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as db from "../db.ts";
import { emit } from "../events.ts";
import { pc, pcSupported } from "./pc.ts";
import { MODULE, prefs, type AppAlias } from "./prefs.ts";

/*
 * Библиотека программ: всё, что Джарвис умеет открывать по названию.
 *
 *  - меню «Пуск» (обычные программы и из Microsoft Store);
 *  - игры Steam (steam://rungameid/…) и Epic Games;
 *  - ярлыки и программы на рабочем столе;
 *  - свои названия из модуля (prefs.apps): «атака титанов» → ссылка, «мой проект» → папка.
 *
 * Список для интерфейса модуля — kv "library" (пишет хаб, по действию "library.refresh" и раз в час).
 */

export type LaunchKind = "start" | "path" | "url";

export interface LibItem {
  /** Стабильный id: источник + цель. */
  id: string;
  name: string;
  source: "start" | "steam" | "epic" | "desktop" | "own";
  kind: LaunchKind;
  value: string;
}

const TTL = 10 * 60_000;
let cache: { at: number; items: LibItem[] } | null = null;

/* ───────────── Steam ───────────── */

/** Простой разбор VDF/ACF Steam: нужны только пары "ключ" "значение". */
function vdfPairs(text: string): [string, string][] {
  return [...text.matchAll(/"([^"]+)"\s+"([^"]*)"/g)].map((m) => [m[1], m[2].replace(/\\\\/g, "\\")]);
}

function steamGames(steamPath: string | null): LibItem[] {
  const roots = new Set<string>();
  const base = steamPath || "C:\\Program Files (x86)\\Steam";
  roots.add(path.normalize(base));
  try {
    const vdf = fs.readFileSync(path.join(base, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const [k, v] of vdfPairs(vdf)) if (k === "path") roots.add(path.normalize(v));
  } catch {}
  const out: LibItem[] = [];
  const skip = /^(steamworks common redistributables|proton|steam linux runtime|spacewar)/i;
  for (const root of roots) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(path.join(root, "steamapps")).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const pairs = Object.fromEntries(vdfPairs(fs.readFileSync(path.join(root, "steamapps", f), "utf8")));
        if (!pairs.appid || !pairs.name || skip.test(pairs.name)) continue;
        out.push({ id: `steam:${pairs.appid}`, name: pairs.name, source: "steam", kind: "url", value: `steam://rungameid/${pairs.appid}` });
      } catch {}
    }
  }
  return out;
}

/* ───────────── Epic Games ───────────── */

function epicGames(): LibItem[] {
  const dir = path.join(process.env.ProgramData ?? "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
  const out: LibItem[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".item"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (!j.DisplayName || !j.AppName || j.bIsIncompleteInstall) continue;
      const id = [j.CatalogNamespace, j.CatalogItemId, j.AppName].map((x: string) => encodeURIComponent(x ?? "")).join("%3A");
      out.push({ id: `epic:${j.AppName}`, name: j.DisplayName, source: "epic", kind: "url", value: `com.epicgames.launcher://apps/${id}?action=launch&silent=true` });
    } catch {}
  }
  return out;
}

/* ───────────── рабочий стол ───────────── */

function desktop(): LibItem[] {
  const home = os.homedir();
  const dirs = [
    path.join(home, "Desktop"),
    path.join(home, "OneDrive", "Desktop"),
    path.join(home, "OneDrive", "Рабочий стол"),
    path.join(process.env.PUBLIC ?? "C:\\Users\\Public", "Desktop"),
  ];
  const out: LibItem[] = [];
  for (const d of dirs) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (![".lnk", ".url", ".exe"].includes(ext)) continue;
      const full = path.join(d, f);
      out.push({ id: `desktop:${full.toLowerCase()}`, name: path.basename(f, ext), source: "desktop", kind: "path", value: full });
    }
  }
  return out;
}

/* ───────────── сборка ───────────── */

function ownItems(aliases: AppAlias[]): LibItem[] {
  return aliases
    .filter((a) => a.target.kind !== "lib" && a.target.value)
    .map((a) => ({ id: `own:${a.id}`, name: a.target.label || a.phrases[0] || a.target.value, source: "own" as const, kind: a.target.kind as LaunchKind, value: a.target.value }));
}

export async function library(force = false): Promise<LibItem[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return [...cache.items, ...ownItems(prefs().apps)];
  const items: LibItem[] = [];
  let steamPath: string | null = null;
  if (pcSupported) {
    try {
      const r = await pc<{ items: { name: string; id: string; path?: boolean }[]; steam?: string | null }>("apps.list", {}, 30_000);
      steamPath = r?.steam ?? null;
      for (const a of r?.items ?? []) {
        if (!a?.name || !a?.id) continue;
        // Steam и Epic кладут в «Пуск» ярлыки-ссылки на игры — показываем их как игры.
        const game = /^steam:\/\//i.test(a.id) ? "steam" : /^com\.epicgames\.launcher:/i.test(a.id) ? "epic" : null;
        if (game) items.push({ id: `start:${a.id}`, name: a.name, source: game, kind: "url", value: a.id });
        else items.push({ id: `start:${a.id}`, name: a.name, source: "start", kind: a.path ? "path" : "start", value: a.id });
      }
    } catch {}
  }
  items.push(...steamGames(steamPath), ...epicGames(), ...desktop());
  // Одна и та же игра бывает и в «Пуске», и в Steam — оставляем первую по названию.
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const k = i.name.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  cache = { at: Date.now(), items: unique };
  return [...unique, ...ownItems(prefs().apps)];
}

export async function launch(item: { kind: LaunchKind | "lib"; value: string }) {
  if (item.kind === "lib") {
    const lib = (await library()).find((i) => i.id === item.value);
    if (!lib) throw new Error("Программы больше нет в библиотеке");
    return launch(lib);
  }
  if (item.kind === "start") await pc("apps.launch", { id: item.value });
  else await pc("open", { target: item.value });
}

/** Для интерфейса модуля: название, источник, id. */
export async function writeLibrary(force = true) {
  const items = await library(force);
  db.setKv(MODULE, "library", {
    items: items.filter((i) => i.source !== "own").map((i) => ({ id: i.id, name: i.name, source: i.source })),
    updatedAt: Date.now(),
  });
  emit({ type: "data", module: MODULE, collection: "kv:library", origin: "jarvis" });
}
