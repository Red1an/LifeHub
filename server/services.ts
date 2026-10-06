import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile, execFileSync, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR, HOME } from "./paths.ts";
import { emit } from "./events.ts";
import type { Manifest } from "./manifest.ts";

/*
 * Модули-сервисы ("type": "service"): своё приложение со своим сервером (Node, Python…).
 * Хаб ставит зависимости, выполняет сборку, запускает процесс, перезапускает его при сбое
 * и показывает интерфейс внутри хаба через прокси /s/<id>/ — поэтому он работает и с телефона.
 */

const run = promisify(execFile);

export type ServiceState = "stopped" | "installing" | "starting" | "running" | "error";

export interface ServiceStatus {
  state: ServiceState;
  error?: string;
  /** Последние строки вывода процесса — для экрана ошибки. */
  log: string[];
}

interface Svc {
  id: string;
  dir: string;
  manifest: Manifest;
  state: ServiceState;
  error?: string;
  log: string[];
  child: ChildProcess | null;
  failures: number;
  restartTimer?: NodeJS.Timeout;
  /** Запуск, который сейчас идёт (установка зависимостей, сборка, ожидание порта). */
  starting?: Promise<void>;
  /** Сервис запущен не хабом (порт уже был занят) — останавливать нечего. */
  external?: boolean;
}

const services = new Map<string, Svc>();
const LOG_LINES = 80;
const READY_TIMEOUT = 120_000;
export const SERVICE_DATA_DIR = path.join(DATA_DIR, "services");
const LOG_DIR = path.join(HOME, "logs");

export function serviceStatus(id: string): ServiceStatus {
  const s = services.get(id);
  if (!s) return { state: "stopped", log: [] };
  return { state: s.state, error: s.error, log: s.log };
}

export function servicePort(id: string): number | undefined {
  const s = services.get(id);
  return s && s.state === "running" ? s.manifest.service!.port : undefined;
}

/** Синхронизировать запущенные сервисы со списком включённых модулей. */
export function syncServices(wanted: { id: string; dir: string; manifest: Manifest }[]) {
  const ids = new Set(wanted.map((w) => w.id));
  for (const id of [...services.keys()]) if (!ids.has(id)) void stopService(id);
  for (const w of wanted) {
    const s = services.get(w.id);
    if (s && JSON.stringify(s.manifest) !== JSON.stringify(w.manifest)) {
      void restartService(w.id, w.dir, w.manifest);
    } else if (!s) {
      void startService(w.id, w.dir, w.manifest);
    }
  }
}

export function startService(id: string, dir: string, manifest: Manifest): Promise<void> {
  let s = services.get(id);
  if (!s) {
    s = { id, dir, manifest, state: "stopped", log: [], child: null, failures: 0 };
    services.set(id, s);
  }
  s.dir = dir;
  s.manifest = manifest;
  if (s.state === "running" || s.starting) return s.starting ?? Promise.resolve();
  clearTimeout(s.restartTimer);
  const svc = s;
  svc.starting = launch(svc)
    .catch((e) => {
      if (services.get(id) !== svc) return;
      setState(svc, "error", (e as Error).message);
    })
    .finally(() => {
      svc.starting = undefined;
    });
  return svc.starting;
}

export async function restartService(id: string, dir: string, manifest: Manifest) {
  await stopService(id);
  await startService(id, dir, manifest);
}

/** Остановить и забыть сервис. Ждёт завершения процесса (Windows не даёт переименовать папку, пока он жив). */
export async function stopService(id: string) {
  const s = services.get(id);
  if (!s) return;
  services.delete(id);
  clearTimeout(s.restartTimer);
  const child = s.child;
  s.child = null;
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    killTree(child);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
  emit({ type: "modules" });
}

export function stopAllServices() {
  for (const s of services.values()) {
    clearTimeout(s.restartTimer);
    if (s.child) killTree(s.child, true);
  }
  services.clear();
}

// Хаб завершается — сервисы не должны остаться висеть и держать порты.
process.on("exit", stopAllServices);

/* ───────────────────────── запуск ───────────────────────── */

async function launch(s: Svc) {
  const cfg = s.manifest.service!;
  s.error = undefined;
  s.external = false;

  if (await alive(cfg.port)) {
    // Порт уже отвечает: скорее всего, сервис остался от прошлого запуска хаба или запущен вручную.
    pushLog(s, `Порт ${cfg.port} уже занят — подключаюсь к работающему сервису.`);
    s.external = true;
    setState(s, "running");
    return;
  }

  const vars = await placeholders(s);
  const sub = (v: string) => v.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

  if (await needsInstall(s.dir)) {
    setState(s, "installing");
    pushLog(s, "Устанавливаю зависимости (npm install)…");
    await exec(s, "npm install --no-audit --no-fund", s.dir, process.env);
    if (services.get(s.id) !== s) return;
  }
  if (cfg.build) {
    const stamp = path.join(s.dir, ".out", "service-build");
    const key = buildKey(s.dir, cfg.build);
    if (!fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8") !== key) {
      setState(s, "installing");
      pushLog(s, `Сборка: ${sub(cfg.build)}`);
      await exec(s, sub(cfg.build), s.dir, process.env);
      if (services.get(s.id) !== s) return;
      fs.mkdirSync(path.dirname(stamp), { recursive: true });
      fs.writeFileSync(stamp, key);
    }
  }

  setState(s, "starting");
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(cfg.port), LIFEHUB_HOME: HOME };
  for (const [k, v] of Object.entries(cfg.env)) env[k] = sub(v);
  const cmd = sub(cfg.start);
  pushLog(s, `Запуск: ${cmd}`);
  const out = openLog(s.id);
  const child = spawn(cmd, { cwd: s.dir, env, shell: true, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  s.child = child;
  const feed = (chunk: Buffer) => {
    out?.write(chunk);
    for (const line of chunk.toString("utf8").split(/\r?\n/)) if (line.trim()) pushLog(s, line);
  };
  child.stdout!.on("data", feed);
  child.stderr!.on("data", feed);
  child.on("error", (e) => pushLog(s, e.message));
  child.on("exit", (code) => {
    out?.end();
    if (s.child !== child) return; // остановлен намеренно
    s.child = null;
    if (services.get(s.id) !== s) return;
    s.failures++;
    setState(s, "error", `Процесс завершился с кодом ${code}`);
    // Сбой: перезапуск с нарастающей паузой. После пяти неудач подряд ждём, пока пользователь нажмёт «Перезапустить».
    if (s.failures <= 5) {
      s.restartTimer = setTimeout(() => void startService(s.id, s.dir, s.manifest), Math.min(60_000, 2000 * 2 ** (s.failures - 1)));
    }
  });

  const deadline = Date.now() + READY_TIMEOUT;
  while (Date.now() < deadline) {
    if (s.child !== child) return;
    if (await alive(cfg.port, cfg.health ?? cfg.path)) {
      s.failures = 0;
      setState(s, "running");
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Сервис не ответил на порту ${cfg.port} за ${READY_TIMEOUT / 1000} с`);
}

function setState(s: Svc, state: ServiceState, error?: string) {
  s.state = state;
  s.error = error;
  if (error) pushLog(s, error);
  emit({ type: "modules" });
}

function pushLog(s: Svc, line: string) {
  s.log.push(line.length > 500 ? line.slice(0, 500) + "…" : line);
  if (s.log.length > LOG_LINES) s.log.splice(0, s.log.length - LOG_LINES);
}

function openLog(id: string) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    return fs.createWriteStream(path.join(LOG_DIR, `service-${id}.log`), { flags: "w" });
  } catch {
    return null;
  }
}

/** Любой HTTP-ответ (даже 401/404) значит, что сервер слушает порт. */
async function alive(port: number, p = "/"): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${p.startsWith("/") ? p : "/" + p}`, { signal: AbortSignal.timeout(1500), redirect: "manual" });
    await r.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

async function needsInstall(dir: string) {
  const pkg = path.join(dir, "package.json");
  if (!fs.existsSync(pkg)) return false;
  const lock = path.join(dir, "node_modules", ".package-lock.json");
  if (!fs.existsSync(lock)) return true;
  return fs.statSync(pkg).mtimeMs > fs.statSync(lock).mtimeMs;
}

/** Сборка повторяется, когда меняется команда или файлы модуля (кроме служебных). */
function buildKey(dir: string, cmd: string) {
  const h = crypto.createHash("sha1").update(cmd);
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", ".git", ".out", "dist", "data"].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(path.relative(dir, p)).update(String(fs.statSync(p).mtimeMs));
    }
  };
  walk(dir);
  return h.digest("hex");
}

function exec(s: Svc, cmd: string, cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, { cwd, env, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const feed = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) if (line.trim()) pushLog(s, line);
    };
    child.stdout!.on("data", feed);
    child.stderr!.on("data", feed);
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`«${cmd}» завершилась с кодом ${code}`))));
  });
}

let python: Promise<string> | undefined;

/** Как вызвать Python 3 на этом компьютере. */
function findPython() {
  python ??= (async () => {
    const candidates = process.platform === "win32" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
    for (const [cmd, ...args] of candidates) {
      try {
        const { stdout, stderr } = await run(cmd, [...args, "--version"], { timeout: 10_000, windowsHide: true });
        if (/Python 3/.test(stdout + stderr)) return [cmd, ...args].join(" ");
      } catch {}
    }
    return "python";
  })();
  return python;
}

async function placeholders(s: Svc): Promise<Record<string, string>> {
  const data = path.join(SERVICE_DATA_DIR, s.id);
  fs.mkdirSync(data, { recursive: true });
  const cfg = s.manifest.service!;
  const vars: Record<string, string> = {
    port: String(cfg.port),
    dir: s.dir,
    data,
    node: `"${process.execPath}"`,
  };
  if (/\{python\}/.test(cfg.start + (cfg.build ?? ""))) vars.python = await findPython();
  return vars;
}

function killTree(child: ChildProcess, sync = false) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    // shell: true — запущен cmd.exe, а сервер его дочерний процесс: гасим всё дерево.
    const args = ["/pid", String(child.pid), "/T", "/F"];
    if (sync) {
      try {
        execFileSync("taskkill", args, { stdio: "ignore", windowsHide: true });
      } catch {}
    } else execFile("taskkill", args, { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill();
  }
}
