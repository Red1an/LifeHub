import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as db from "../db.ts";
import { emit } from "../events.ts";
import { HUB_DIR } from "../paths.ts";
import { MODULE } from "./prefs.ts";
import { normalize, similarity } from "./nlu.ts";

/*
 * Вкладки браузера через расширение «Джарвис — вкладки» (voice/browser-extension).
 *
 * Расширение присылает список вкладок всех окон и пространств Vivaldi (POST /api/jarvis/browser/tabs)
 * и долгим опросом забирает команды (GET /api/jarvis/browser/next): переключиться, открыть, закрыть.
 * Названия пространств Vivaldi хаб читает из его настроек на диске (Preferences → vivaldi.workspaces).
 *
 * Для модуля — kv "browser": подключено ли расширение и вкладки по пространствам.
 */

export interface Tab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
  audible: boolean;
  /** id пространства Vivaldi или null. */
  workspace: string | null;
}

export type BrowserCmd =
  | { kind: "activate"; tabId: number; windowId: number }
  | { kind: "open"; url: string }
  | { kind: "close"; tabId: number }
  | { kind: "refresh" };

let tabs: Tab[] = [];
let browserName = "";
let lastSeen = 0;
const queue: BrowserCmd[] = [];
const waiters = new Set<(c: BrowserCmd | null) => void>();

export const browserConnected = () => Date.now() - lastSeen < 60_000;

/* ───────────── пространства Vivaldi ───────────── */

let wsCache: { at: number; names: Map<string, string> } | null = null;

export function workspaces(): Map<string, string> {
  if (wsCache && Date.now() - wsCache.at < 60_000) return wsCache.names;
  const names = new Map<string, string>();
  const file = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Vivaldi", "User Data", "Default", "Preferences");
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const w of j?.vivaldi?.workspaces?.list ?? []) if (w?.id && w?.name) names.set(String(Math.round(Number(w.id))), String(w.name));
  } catch {}
  wsCache = { at: Date.now(), names };
  return names;
}

export const workspaceName = (t: Tab) => (t.workspace ? (workspaces().get(t.workspace) ?? null) : null);

/* ───────────── связь с расширением ───────────── */

export function acceptTabs(body: any) {
  lastSeen = Date.now();
  browserName = String(body?.browser ?? "");
  tabs = (Array.isArray(body?.tabs) ? body.tabs : [])
    .slice(0, 500)
    .map((t: any): Tab => ({
      id: Number(t.id),
      windowId: Number(t.windowId),
      title: String(t.title ?? "").slice(0, 300),
      url: String(t.url ?? "").slice(0, 2000),
      active: !!t.active,
      audible: !!t.audible,
      workspace: t.workspace ? String(t.workspace) : null,
    }));
  writeState();
}

/** Долгий опрос расширения: команда или null через 25 секунд. */
export function nextCommand(): Promise<BrowserCmd | null> {
  lastSeen = Date.now();
  const c = queue.shift();
  if (c) return Promise.resolve(c);
  return new Promise((resolve) => {
    const done = (cmd: BrowserCmd | null) => {
      clearTimeout(timer);
      waiters.delete(done);
      resolve(cmd);
    };
    const timer = setTimeout(() => done(null), 25_000);
    waiters.add(done);
  });
}

export function send(cmd: BrowserCmd) {
  const w = waiters.values().next().value;
  if (w) w(cmd);
  else queue.push(cmd);
  if (queue.length > 20) queue.shift();
}

let lastWritten = "";
function writeState() {
  const ws = workspaces();
  const state = {
    extensionPath: path.join(HUB_DIR, "voice", "browser-extension"),
    connected: browserConnected(),
    browser: browserName,
    workspaces: [...ws.entries()].map(([id, name]) => ({ id, name })),
    tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, workspace: t.workspace ? (ws.get(t.workspace) ?? null) : null, active: t.active })),
  };
  const key = JSON.stringify(state);
  if (key === lastWritten) return;
  lastWritten = key;
  db.setKv(MODULE, "browser", { ...state, updatedAt: Date.now() });
  emit({ type: "data", module: MODULE, collection: "kv:browser", origin: "jarvis" });
}

/* ───────────── поиск вкладок ───────────── */

/** «в кинотеатре», «в пространстве работа» → пространство и фраза без него. */
export function splitWorkspace(text: string): { query: string; workspace: string | null } {
  for (const [id, name] of workspaces()) {
    const n = normalize(name);
    const stem = n.slice(0, Math.max(3, n.length - 2));
    const re = new RegExp(`(^|\\s)(в|из|во)\\s+(пространств\\S*\\s+)?${stem}\\S*(\\s|$)`);
    const m = text.match(re);
    if (m) return { query: (text.slice(0, m.index) + " " + text.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim(), workspace: id };
  }
  return { query: text, workspace: null };
}

/** Знает ли браузер, в каком пространстве вкладка. Vivaldi расширениям этого не сообщает. */
export const knowsWorkspaces = () => tabs.some((t) => t.workspace);

/** Лучшая вкладка по названию: все основы слов запроса — в заголовке (или адресе). */
export function findTab(query: string, workspace: string | null = null): { tab: Tab; score: number } | null {
  if (!browserConnected() || !query.trim()) return null;
  // Пространство неизвестно — ищем во всех: вкладки всё равно видны расширению целиком.
  if (!knowsWorkspaces()) workspace = null;
  let best: { tab: Tab; score: number } | null = null;
  for (const t of tabs) {
    if (workspace && t.workspace !== workspace) continue;
    const s = Math.max(similarity(t.title, query), similarity(t.url.replace(/[/._?=&-]+/g, " "), query) * 0.9);
    if (!best || s > best.score || (s === best.score && t.title.length < best.tab.title.length)) best = { tab: t, score: s };
  }
  return best && best.score >= 0.75 ? best : null;
}

export function findTabByHost(host: string, workspace: string | null = null): Tab | null {
  if (!browserConnected()) return null;
  if (!knowsWorkspaces()) workspace = null;
  return tabs.find((t) => (!workspace || t.workspace === workspace) && /^https?:\/\/(www\.)?([^/]+)/.exec(t.url)?.[2]?.endsWith(host)) ?? null;
}

export const tabsIn = (workspace: string) => tabs.filter((t) => t.workspace === workspace);

/** Для нейронки: вкладки по пространствам, коротко. */
export function tabsContext(): string {
  if (!browserConnected() || !tabs.length) return "";
  const groups = new Map<string, Tab[]>();
  for (const t of tabs) {
    const g = workspaceName(t) ?? "без пространства";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  const names = [...workspaces().values()];
  const lines = ["Вкладки браузера (переключить — действие tab с id):"];
  if (!knowsWorkspaces() && names.length)
    lines.push(`Пространства Vivaldi: ${names.join(", ")}. В каком пространстве вкладка — браузер не сообщает, суди по названиям.`);
  for (const [g, list] of groups) {
    lines.push(`[${g}]`);
    for (const t of list.slice(0, 15)) lines.push(`- id ${t.id}: ${t.title.slice(0, 70)}${t.active ? " (активная)" : ""}${t.audible ? " (играет звук)" : ""}`);
  }
  return lines.join("\n");
}

export function activate(tab: Tab) {
  send({ kind: "activate", tabId: tab.id, windowId: tab.windowId });
}

export const tabById = (id: number) => tabs.find((t) => t.id === id) ?? null;

export function startBrowser() {
  writeState();
  setInterval(writeState, 30_000).unref();
}
