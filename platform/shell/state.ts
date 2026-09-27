import { useSyncExternalStore } from "react";
import { request, onHubEvent, type ModuleManifest } from "../sdk/core.ts";

export interface SourceInfo {
  type: "builtin" | "git" | "zip" | "path" | "created" | "fork";
  url?: string;
  from?: string;
  installedAt: string;
  version: string;
  forkOf?: string;
  pending?: { version: string };
}

export interface UpdateInfo {
  currentVersion: string;
  newVersion: string;
  changes: string[];
  localModified: boolean;
  checkedAt: number;
}

export interface ModuleInfo {
  id: string;
  dir: string;
  manifest: ModuleManifest | null;
  enabled: boolean;
  status: "ok" | "error" | "building" | "disabled";
  hash: string;
  hasCss: boolean;
  errors: string[];
  warnings: string[];
  libs: string[];
  uses: string[];
  sizeKb: number;
  source: SourceInfo | null;
  update: UpdateInfo | null;
  autoUpdate: boolean;
}

export interface HubSettings {
  theme: "auto" | "light" | "dark";
  accent: string;
  order: string[];
  hiddenWidgets: string[];
  catalogs: string[];
  userName: string;
  hasPassword: boolean;
}

export interface HubState {
  sdkVersion: string;
  settings: HubSettings;
  modules: ModuleInfo[];
  platformHash: string;
  cssHash: string;
  isLocal: boolean;
  modulesDir: string;
  home: string;
  /** Команда проверки модуля для Claude Code. */
  checkCommand: string;
}

let state: HubState | null = null;
let error: string | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function notify() {
  for (const l of listeners) l();
}

export async function reloadState() {
  try {
    const next = await request<HubState>("GET", "/api/state");
    if (state && next.platformHash !== state.platformHash) {
      location.reload();
      return;
    }
    state = next;
    error = null;
    applyTheme(next.settings);
  } catch (e) {
    error = (e as Error).message;
  }
  notify();
}

function scheduleReload() {
  clearTimeout(timer);
  timer = setTimeout(reloadState, 60);
}

onHubEvent((e) => {
  if (e.type === "modules" || e.type === "module-built" || e.type === "settings" || e.type === "reconnected") scheduleReload();
  if (e.type === "platform" && state && e.hash !== state.platformHash) location.reload();
  if (e.type === "css") {
    const link = document.getElementById("lh-css") as HTMLLinkElement | null;
    if (link) {
      // Новая таблица стилей подгружается рядом, старая удаляется после загрузки — без мигания.
      const next = link.cloneNode() as HTMLLinkElement;
      next.href = `/app.css?v=${e.hash}`;
      next.onload = () => {
        link.remove();
      };
      link.after(next);
    }
  }
});

reloadState();

export function useHub(): { state: HubState | null; error: string | null } {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  return { state, error };
}

export const getCheckCommand = () => state?.checkCommand ?? "lifehub check";

export function manifestOf(id: string): ModuleManifest | undefined {
  return state?.modules.find((m) => m.id === id)?.manifest ?? undefined;
}

export const appModules = (s: HubState) => s.modules.filter((m) => m.enabled && m.manifest?.type !== "library");

/* ───────────── тема ───────────── */

const media = window.matchMedia("(prefers-color-scheme: dark)");
media.addEventListener("change", () => state && applyTheme(state.settings));

function applyTheme(s: HubSettings) {
  const theme = s.theme === "auto" ? (media.matches ? "dark" : "light") : s.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = s.accent;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#1a1a19" : "#ffffff");
}

export async function saveSettings(patch: Partial<HubSettings>) {
  if (state) {
    state = { ...state, settings: { ...state.settings, ...patch } };
    applyTheme(state.settings);
    notify();
  }
  await request("PUT", "/api/settings", { body: patch });
}
