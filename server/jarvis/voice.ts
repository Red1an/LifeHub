import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import * as db from "../db.ts";
import { emit } from "../events.ts";
import { HOME, HUB_DIR } from "../paths.ts";
import * as data from "./data.ts";
import { dayKey, fromKey, shiftKey } from "./nlu.ts";
import { MODULE, prefs, type VoicePrefs } from "./prefs.ts";
import { pc, pcSupported } from "./pc.ts";

/*
 * Голос на компьютере: процесс на Python (папка voice/ репозитория).
 *
 * Хаб ставит ему окружение, запускает, перезапускает при сбое и гасит вместе с собой.
 * Процесс слушает микрофон (слово активации — Vosk, фраза — Whisper на видеокарте),
 * отправляет текст в POST /api/jarvis/voice/ask и проговаривает ответ (Silero).
 * Обратно хаб шлёт ему события по SSE (/api/jarvis/voice/stream): настройки, «скажи»
 * (таймеры, напоминания), управление (сон, микрофон, игровой режим).
 *
 * Состояние для модуля — kv "voice" (пишет только хаб).
 */

const VOICE_DIR = path.join(HUB_DIR, "voice");
const VENV = path.join(VOICE_DIR, ".venv");
const PYTHON = process.platform === "win32" ? path.join(VENV, "Scripts", "python.exe") : path.join(VENV, "bin", "python");
const MODELS_DIR = path.join(HOME, "voice", "models");
const LOG_FILE = path.join(HOME, "logs", "voice.log");
const LOG_LINES = 60;
/** Код выхода «перезапусти меня» (voice/main.py). */
const EXIT_RESTART = 3;

export type VoiceProcess = "off" | "missing" | "installing" | "starting" | "running" | "crashed";
export type VoiceState = "loading" | "listening" | "hearing" | "thinking" | "speaking" | "sleeping" | "muted" | "error";

export interface VoiceStatus {
  process: VoiceProcess;
  /** Что делает процесс прямо сейчас — присылает он сам. */
  state?: VoiceState;
  detail?: string;
  error?: string;
  gpu?: boolean;
  model?: string;
  mics?: string[];
  mic?: string;
  /** Последняя услышанная фраза. */
  heard?: string;
  heardAt?: number;
  connected: boolean;
  log: string[];
  installLog: string[];
  updatedAt: number;
}

interface Runtime {
  child: ChildProcess | null;
  token: string;
  failures: number;
  startedAt: number;
  restartTimer?: NodeJS.Timeout;
  installing: boolean;
  stopping: boolean;
}

const rt: Runtime = { child: null, token: "", failures: 0, startedAt: 0, installing: false, stopping: false };
const log: string[] = [];
const installLog: string[] = [];
let reported: Partial<VoiceStatus> = {};
let hubUrl = "http://127.0.0.1:4200";
let insecure = false;

/* ───────────── состояние для модуля ───────────── */

function processState(): VoiceProcess {
  if (rt.installing) return "installing";
  if (!fs.existsSync(PYTHON)) return "missing";
  if (!prefs().voice.enabled) return "off";
  if (rt.child) return clients.size ? "running" : "starting";
  return rt.failures ? "crashed" : "off";
}

export function voiceStatus(): VoiceStatus {
  return {
    ...reported,
    process: processState(),
    connected: clients.size > 0,
    log: log.slice(-20),
    installLog: installLog.slice(-30),
    updatedAt: Date.now(),
  };
}

let lastWritten = "";
let writeTimer: NodeJS.Timeout | undefined;

/** Пишет kv "voice" не чаще раза в 300 мс и только при изменениях. */
function writeStatus() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    const st = voiceStatus();
    const key = JSON.stringify({ ...st, updatedAt: 0 });
    if (key === lastWritten) return;
    lastWritten = key;
    db.setKv(MODULE, "voice", st);
    emit({ type: "data", module: MODULE, collection: "kv:voice", origin: "jarvis" });
  }, 300);
}

function pushLog(target: string[], line: string) {
  for (const l of line.split(/\r?\n/)) {
    const s = l.trimEnd();
    if (!s) continue;
    target.push(s);
    if (target.length > LOG_LINES) target.shift();
  }
}

/* ───────────── связь с процессом (SSE) ───────────── */

export type VoiceEvent =
  | { type: "config"; config: VoiceConfig }
  | { type: "say"; text: string; tts: string; chime?: boolean }
  | { type: "control"; mute?: boolean; sleep?: boolean; panel?: boolean }
  | { type: "test" }
  | { type: "stop" };

export interface VoiceConfig extends VoicePrefs {
  address: string;
  modelsDir: string;
}

const clients = new Set<(e: VoiceEvent) => void>();

export function voiceConfig(): VoiceConfig {
  const p = prefs();
  return { ...p.voice, address: p.address, modelsDir: MODELS_DIR };
}

/** Подключение процесса. Чужой токен (старый процесс от прошлого запуска хаба) — отказ. */
export function acceptClient(token: string, push: (e: VoiceEvent) => void): (() => void) | null {
  if (!token || token !== rt.token) return null;
  clients.add(push);
  push({ type: "config", config: voiceConfig() });
  writeStatus();
  return () => {
    clients.delete(push);
    writeStatus();
  };
}

function broadcast(e: VoiceEvent) {
  for (const c of clients) c(e);
}

export const voiceConnected = () => clients.size > 0;

/** Процесс сообщает, что делает. */
export function reportState(token: string, body: any): boolean {
  if (token !== rt.token) return false;
  const pick = <K extends keyof VoiceStatus>(k: K) => (body?.[k] !== undefined ? body[k] : reported[k]);
  reported = {
    state: pick("state"),
    detail: body && "detail" in body ? (typeof body.detail === "string" ? body.detail : undefined) : reported.detail,
    error: body && "error" in body ? (typeof body.error === "string" ? body.error : undefined) : reported.error,
    gpu: pick("gpu"),
    model: pick("model"),
    mics: Array.isArray(body?.mics) ? body.mics.map(String).slice(0, 30) : reported.mics,
    mic: pick("mic"),
    heard: pick("heard"),
    heardAt: pick("heardAt"),
  };
  writeStatus();
  return true;
}

/** Сказать вслух (таймер, напоминание). Голоса нет — уведомление Windows. */
export async function speak(text: string, opts: { title?: string; chime?: boolean; log?: boolean } = {}) {
  const p = prefs();
  if (opts.log !== false && p.history) {
    db.putDoc(MODULE, "chat", undefined, { q: "", a: text, source: "voice", at: Date.now(), push: true }, false);
    emit({ type: "data", module: MODULE, collection: "chat", origin: "jarvis" });
  }
  if (voiceConnected() && p.voice.tts) {
    broadcast({ type: "say", text, tts: text, chime: opts.chime });
    return;
  }
  if (pcSupported) await pc("notify", { title: opts.title ?? "Джарвис", text }).catch(() => {});
}

/** Управление процессом из команд: сон, микрофон, игровой режим, панель на экране. */
export function voiceControl(c: { mute?: boolean; sleep?: boolean; game?: boolean; panel?: boolean }) {
  if (c.game !== undefined) {
    const raw = (db.getKv(MODULE, "config") as Record<string, any> | undefined) ?? {};
    db.setKv(MODULE, "config", { ...raw, voice: { ...(raw.voice ?? {}), game: c.game } });
    emit({ type: "data", module: MODULE, collection: "kv:config", origin: "jarvis" });
    broadcast({ type: "config", config: voiceConfig() });
  }
  if (c.mute !== undefined || c.sleep !== undefined || c.panel) broadcast({ type: "control", mute: c.mute, sleep: c.sleep, panel: c.panel });
}

/** Настройки поменялись в модуле. */
export function applyVoiceConfig() {
  const enabled = prefs().voice.enabled;
  if (enabled && !rt.child && !rt.installing) startProcess();
  else if (!enabled && rt.child) stopProcess();
  broadcast({ type: "config", config: voiceConfig() });
  writeStatus();
}

export function testVoice() {
  broadcast({ type: "test" });
}

/* ───────────── процесс ───────────── */

function appendFileLog(s: string) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, s);
  } catch {}
}

function startProcess() {
  if (rt.child || !fs.existsSync(PYTHON) || !prefs().voice.enabled) return writeStatus();
  clearTimeout(rt.restartTimer);
  rt.token = crypto.randomBytes(16).toString("hex");
  rt.stopping = false;
  rt.startedAt = Date.now();
  reported = { state: "loading", detail: "Запускаюсь" };
  const args = ["-u", path.join(VOICE_DIR, "main.py"), "--hub", hubUrl, "--token", rt.token, ...(insecure ? ["--insecure"] : [])];
  appendFileLog(`\n=== ${new Date().toISOString()} запуск\n`);
  const child = spawn(PYTHON, args, {
    cwd: VOICE_DIR,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", HF_HUB_DISABLE_SYMLINKS_WARNING: "1" },
  });
  rt.child = child;
  const onOut = (d: Buffer) => {
    const s = d.toString("utf8");
    appendFileLog(s);
    pushLog(log, s);
    writeStatus();
  };
  child.stdout!.on("data", onOut);
  child.stderr!.on("data", onOut);
  child.on("error", (e) => pushLog(log, `Не удалось запустить: ${e.message}`));
  child.on("close", (code) => {
    if (rt.child !== child) return;
    rt.child = null;
    rt.token = "";
    clients.clear();
    appendFileLog(`=== завершился (${code})\n`);
    if (rt.stopping || !prefs().voice.enabled) {
      reported = {};
      return writeStatus();
    }
    // Процесс сам попросил перезапуск (сменился режим окон, «Перезапустить» в трее).
    if (code === EXIT_RESTART) {
      reported = { state: "loading", detail: "Перезапускаюсь" };
      rt.restartTimer = setTimeout(startProcess, 300);
      return writeStatus();
    }
    // Проработал пару минут — сбой случайный, счётчик с нуля.
    if (Date.now() - rt.startedAt > 120_000) rt.failures = 0;
    rt.failures++;
    reported = { ...reported, state: "error", error: reported.error ?? `Процесс завершился (${code})` };
    const delay = [2_000, 5_000, 15_000, 60_000][Math.min(rt.failures - 1, 3)];
    rt.restartTimer = setTimeout(startProcess, delay);
    writeStatus();
  });
  writeStatus();
}

function stopProcess() {
  clearTimeout(rt.restartTimer);
  rt.stopping = true;
  broadcast({ type: "stop" });
  const child = rt.child;
  setTimeout(() => child?.kill(), 1500).unref?.();
}

export function restartVoice() {
  rt.failures = 0;
  if (!rt.child) return startProcess();
  const child = rt.child;
  stopProcess();
  child.once("close", () => setTimeout(startProcess, 300));
}

/* ───────────── установка окружения ───────────── */

function runStep(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pushLog(installLog, `> ${path.basename(cmd)} ${args.join(" ")}`);
    writeStatus();
    const p = spawn(cmd, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    const on = (d: Buffer) => {
      // pip рисует прогресс-бары — оставляем только осмысленные строки.
      const lines = d.toString("utf8").split(/\r?\n|\r/).filter((l) => l.trim() && !/^\s*[━╸─]+|\d+(\.\d+)?\/\d+(\.\d+)? [kMG]B/.test(l));
      if (lines.length) pushLog(installLog, lines.join("\n"));
      writeStatus();
    };
    p.stdout!.on("data", on);
    p.stderr!.on("data", on);
    p.on("error", (e) => reject(e));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} завершился с кодом ${code}`))));
  });
}

function pythonVersion(cmd: string, pre: string[]): Promise<string | null> {
  return new Promise((resolve) =>
    execFile(cmd, [...pre, "-c", "import sys;print('%d.%d'%sys.version_info[:2])"], { windowsHide: true, timeout: 15000 }, (err, out) =>
      resolve(err ? null : String(out).trim()),
    ),
  );
}

/** Python 3.10–3.12: под них есть готовые колёса всех библиотек. */
async function findPython(): Promise<[string, string[]]> {
  const list: [string, string[]][] =
    process.platform === "win32"
      ? [["py", ["-3.12"]], ["py", ["-3.11"]], ["py", ["-3.10"]], ["python", []]]
      : [["python3.12", []], ["python3.11", []], ["python3", []]];
  for (const [cmd, pre] of list) {
    const v = await pythonVersion(cmd, pre);
    if (v && ["3.10", "3.11", "3.12"].includes(v)) return [cmd, pre];
  }
  throw new Error("Нужен Python 3.10–3.12. Установите Python 3.12 с python.org (галочка «Add to PATH») и повторите.");
}

export async function installVoice() {
  if (rt.installing) return;
  rt.installing = true;
  installLog.length = 0;
  if (rt.child) stopProcess();
  writeStatus();
  try {
    if (!fs.existsSync(PYTHON)) {
      const [cmd, pre] = await findPython();
      await runStep(cmd, [...pre, "-m", "venv", VENV], VOICE_DIR);
    }
    await runStep(PYTHON, ["-m", "pip", "install", "--upgrade", "pip"], VOICE_DIR);
    await runStep(PYTHON, ["-m", "pip", "install", "-r", "requirements.txt"], VOICE_DIR);
    // Whisper и Silero тяжёлые (~2.5 ГБ) — только если выбраны.
    const v = prefs().voice;
    if (v.asr === "whisper" || v.ttsEngine === "silero") {
      // torch только для Silero — версия для процессора в 10 раз меньше.
      if (v.ttsEngine === "silero") await runStep(PYTHON, ["-m", "pip", "install", "torch", "--index-url", "https://download.pytorch.org/whl/cpu"], VOICE_DIR);
      await runStep(PYTHON, ["-m", "pip", "install", "-r", "requirements-extra.txt"], VOICE_DIR);
    }
    pushLog(installLog, "Готово. Модели скачаются при первом запуске.");
  } catch (e) {
    pushLog(installLog, `Ошибка: ${(e as Error).message}`);
  } finally {
    rt.installing = false;
    rt.failures = 0;
    writeStatus();
    if (prefs().voice.enabled) startProcess();
  }
}

/* ───────────── предупреждения о событиях ───────────── */

const announced = new Set<string>();

async function checkAnnouncements() {
  const v = prefs().voice;
  if (!v.enabled || (!v.announce && !v.reminders)) return;
  if (!data.enabled("planner")) return;
  const today = dayKey();
  const events = await data.listEvents(fromKey(today), fromKey(shiftKey(today, 2))).catch(() => []);
  const now = Date.now();
  const address = prefs().address;
  const lead = address ? `${address.charAt(0).toUpperCase() + address.slice(1)}, ` : "";
  for (const e of events) {
    if (e.allDay) continue;
    const key = `${e.id}|${e.start.getTime()}`;
    if (announced.has(key)) continue;
    const mins = (e.start.getTime() - now) / 60_000;
    if (e.kind === "reminder") {
      if (v.reminders && mins <= 0 && mins > -2) {
        announced.add(key);
        await speak(`${lead}напоминаю: ${e.title}.`, { title: "Напоминание", chime: true });
      }
    } else if (v.announce && mins <= v.announce && mins > v.announce - 2) {
      announced.add(key);
      const n = Math.max(1, Math.round(mins));
      const unit = n % 10 === 1 && n % 100 !== 11 ? "минуту" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "минуты" : "минут";
      await speak(`${lead}через ${n} ${unit}: ${e.title}.`, { title: "Скоро событие", chime: true });
    }
  }
  if (announced.size > 500) announced.clear();
}

/* ───────────── запуск ───────────── */

export function startVoice(opts: { port: number; https: boolean }) {
  hubUrl = `${opts.https ? "https" : "http"}://127.0.0.1:${opts.port}`;
  insecure = opts.https;
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  // Хаб закрывается — голос тоже: иначе процесс останется слушать микрофон без хаба.
  process.on("exit", () => rt.child?.kill());
  startProcess();
  setInterval(() => void checkAnnouncements().catch(() => {}), 30_000).unref();
  writeStatus();
}
