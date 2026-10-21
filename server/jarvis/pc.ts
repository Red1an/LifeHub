import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { HOME } from "../paths.ts";

/*
 * Управление компьютером: один долгоживущий процесс PowerShell (pc.ps1).
 * Запуск PowerShell и компиляция C#-помощников занимают пару секунд — поэтому процесс
 * поднимается при первой команде и живёт дальше, а команды идут ему построчно JSON.
 */

const SCRIPT_SRC = path.join(import.meta.dirname, "pc.ps1");
const SCRIPT = path.join(HOME, "jarvis", "pc.ps1");
const CALL_TIMEOUT = 15_000;

interface Waiter {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

let child: ChildProcess | null = null;
let ready: Promise<void> | null = null;
let seq = 0;
const waiters = new Map<number, Waiter>();

export class PcError extends Error {}

export const pcSupported = process.platform === "win32";

/** PowerShell 5.1 читает скрипт без BOM в кодировке ANSI — кладём копию с BOM. */
function prepareScript() {
  const src = fs.readFileSync(SCRIPT_SRC, "utf8").replace(/^﻿/, "");
  const body = "﻿" + src;
  fs.mkdirSync(path.dirname(SCRIPT), { recursive: true });
  if (!fs.existsSync(SCRIPT) || fs.readFileSync(SCRIPT, "utf8") !== body) fs.writeFileSync(SCRIPT, body, "utf8");
}

function start(): Promise<void> {
  if (!pcSupported) return Promise.reject(new PcError("Управление компьютером пока есть только для Windows"));
  prepareScript();
  const p = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child = p;
  let buf = "";
  let stderr = "";
  return new Promise<void>((resolve, reject) => {
    const fail = (msg: string) => {
      if (child === p) {
        child = null;
        ready = null;
      }
      for (const [id, w] of waiters) {
        clearTimeout(w.timer);
        w.reject(new PcError(msg));
        waiters.delete(id);
      }
      reject(new PcError(msg));
    };
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        let msg: { id: number; ok: boolean; result?: unknown; error?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 0) {
          resolve();
          continue;
        }
        const w = waiters.get(msg.id);
        if (!w) continue;
        waiters.delete(msg.id);
        clearTimeout(w.timer);
        if (msg.ok) w.resolve(msg.result);
        else w.reject(new PcError(msg.error || "Команда не выполнилась"));
      }
    });
    p.stderr!.setEncoding("utf8");
    p.stderr!.on("data", (d: string) => (stderr = (stderr + d).slice(-2000)));
    p.on("error", (e) => fail(`Не удалось запустить PowerShell: ${e.message}`));
    p.on("close", (code) => fail(`PowerShell завершился (${code})${stderr ? ": " + stderr.trim().split("\n").slice(-2).join(" ") : ""}`));
  });
}

/** Вызвать функцию из pc.ps1. */
export async function pc<T = unknown>(fn: string, args: Record<string, unknown> = {}, timeout = CALL_TIMEOUT): Promise<T> {
  if (!child || !ready) ready = start();
  await ready;
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new PcError("Компьютер не ответил вовремя"));
    }, timeout);
    waiters.set(id, { resolve, reject, timer });
    child!.stdin!.write(JSON.stringify({ id, fn, args }) + "\n");
  });
}

/** Заранее поднять PowerShell, чтобы первая команда не ждала. */
export function warmUp() {
  if (pcSupported) void pc("ping").catch(() => {});
}

export function stopPc() {
  child?.kill();
  child = null;
  ready = null;
}

/* ───────────── приложения и окна ───────────── */

export interface App {
  name: string;
  id: string;
  path?: boolean;
}

let appsCache: { at: number; items: App[] } | null = null;

export async function apps(force = false): Promise<App[]> {
  if (!force && appsCache && Date.now() - appsCache.at < 10 * 60_000) return appsCache.items;
  const r = await pc<{ items: App[] }>("apps.list", {}, 30_000);
  const items = (r?.items ?? []).filter((a) => a?.name && a?.id);
  appsCache = { at: Date.now(), items };
  return items;
}

export interface Win {
  pid: number;
  name: string;
  title: string;
  desc: string;
}

/** Служебные окна Windows, которые не стоит называть пользователю. */
const SYSTEM_WINDOWS = /^(ApplicationFrameHost|TextInputHost|ShellExperienceHost|SearchHost|StartMenuExperienceHost|LockApp|NVIDIA Overlay|SystemSettingsBroker|GameBar.*)$/i;

export async function windows(): Promise<{ items: Win[]; active: number }> {
  const r = await pc<{ items: Win[]; active: number }>("windows.list", {}, 20_000);
  return { items: (r?.items ?? []).filter((w) => !SYSTEM_WINDOWS.test(w.name)), active: r?.active ?? 0 };
}

export const screenshotsDir = () => path.join(os.homedir(), "Pictures", "Джарвис");
