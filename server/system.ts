import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { HOME, HUB_DIR } from "./paths.ts";

/*
 * Хаб как фоновая служба пользователя:
 *  - автозапуск при входе в систему (Windows — скрипт в папке «Автозагрузка», без окна;
 *    macOS — LaunchAgent; Linux — XDG autostart);
 *  - «надзиратель» (--background): запускает сервер отдельным процессом, пишет лог
 *    в ~/.lifehub/logs/hub.log и перезапускает сервер при сбое или по кнопке «Перезапустить».
 */

export const LOG_DIR = path.join(HOME, "logs");
export const LOG_FILE = path.join(LOG_DIR, "hub.log");

/** Код выхода сервера: «перезапусти меня». */
export const EXIT_RESTART = 75;
/** Код выхода сервера: порт занят — хаб уже работает. */
export const EXIT_PORT_BUSY = 3;

export const isSupervised = () => process.env.LIFEHUB_SUPERVISED === "1";

const BIN = path.join(HUB_DIR, "bin", "lifehub.mjs");

function autostartFile(): string | null {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "LifeHub.vbs");
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "LaunchAgents", "com.lifehub.hub.plist");
  return path.join(os.homedir(), ".config", "autostart", "lifehub.desktop");
}

export function autostartEnabled(): boolean {
  const f = autostartFile();
  return !!f && fs.existsSync(f);
}

/** Аргументы фонового запуска с текущими параметрами (порт, https). */
function backgroundArgs(opts: { port: number; https: boolean }) {
  return ["start", "--background", "--port", String(opts.port), ...(opts.https ? ["--https"] : [])];
}

export function enableAutostart(opts: { port: number; https: boolean }) {
  const file = autostartFile();
  if (!file) throw new Error("Автозапуск не поддерживается на этой системе");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const args = backgroundArgs(opts);
  const home = process.env.LIFEHUB_HOME;

  if (process.platform === "win32") {
    // VBS-скрипт запускает хаб без окна. Файл в UTF-16 с BOM — так Windows Script Host
    // правильно читает пути с кириллицей.
    const q = (s: string) => `""${s}""`;
    const cmd = [q(process.execPath), q(BIN), ...args].join(" ");
    const lines = [
      "' LifeHub: запуск хаба в фоне при входе в Windows. Удалите файл, чтобы отключить.",
      'Set sh = CreateObject("WScript.Shell")',
      `sh.CurrentDirectory = "${HUB_DIR}"`,
      ...(home ? [`sh.Environment("PROCESS")("LIFEHUB_HOME") = "${home}"`] : []),
      `sh.Run "${cmd}", 0, False`,
    ];
    const text = lines.join("\r\n") + "\r\n";
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
    return;
  }

  const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  if (process.platform === "darwin") {
    const argv = [process.execPath, BIN, ...args].map((a) => `    <string>${xml(a)}</string>`).join("\n");
    fs.writeFileSync(
      file,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.lifehub.hub</string>
  <key>ProgramArguments</key><array>
${argv}
  </array>
  <key>WorkingDirectory</key><string>${xml(HUB_DIR)}</string>
  ${home ? `<key>EnvironmentVariables</key><dict><key>LIFEHUB_HOME</key><string>${xml(home)}</string></dict>` : ""}
  <key>RunAtLoad</key><true/>
</dict></plist>
`,
    );
    return;
  }

  const sh = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
  fs.writeFileSync(
    file,
    `[Desktop Entry]
Type=Application
Name=LifeHub
Exec=${home ? `env LIFEHUB_HOME=${sh(home)} ` : ""}${[process.execPath, BIN, ...args].map(sh).join(" ")}
Path=${HUB_DIR}
X-GNOME-Autostart-enabled=true
NoDisplay=true
`,
  );
}

export function disableAutostart() {
  const f = autostartFile();
  if (f) fs.rmSync(f, { force: true });
}

/**
 * Запустить хаб в фоне прямо сейчас (не дожидаясь перезагрузки).
 * Новый «надзиратель» дождётся, пока текущий процесс освободит порт.
 */
export function launchBackground(opts: { port: number; https: boolean }) {
  const child = spawn(process.execPath, [BIN, ...backgroundArgs(opts)], {
    cwd: HUB_DIR,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, LIFEHUB_SUPERVISED: "" },
  });
  child.unref();
}

/* ───────────── надзиратель ───────────── */

function openLog() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  try {
    if (fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + ".1");
  } catch {}
  return fs.openSync(LOG_FILE, "a");
}

export async function supervise(args: string[]) {
  const childArgs = [BIN, "start", ...args.filter((a) => a !== "--background")];
  let failures = 0;
  for (;;) {
    const log = openLog();
    fs.writeSync(log, `\n──── ${new Date().toLocaleString("ru-RU")} запуск хаба ────\n`);
    const startedAt = Date.now();
    const code: number = await new Promise((resolve) => {
      const child = spawn(process.execPath, childArgs, {
        cwd: HUB_DIR,
        stdio: ["ignore", log, log],
        windowsHide: true,
        env: { ...process.env, LIFEHUB_SUPERVISED: "1" },
      });
      child.on("exit", (c) => resolve(c ?? 1));
      child.on("error", () => resolve(1));
    });
    fs.writeSync(log, `──── хаб завершился с кодом ${code} ────\n`);
    fs.closeSync(log);

    if (code === 0 || code === EXIT_PORT_BUSY) return; // остановлен вручную или уже работает другой хаб
    if (code === EXIT_RESTART) {
      failures = 0;
      continue;
    }
    // Сбой: перезапуск с нарастающей паузой (сбрасывается, если хаб проработал дольше минуты).
    failures = Date.now() - startedAt > 60_000 ? 1 : failures + 1;
    await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** (failures - 1))));
  }
}

export function readLogTail(lines = 200): string {
  try {
    const text = fs.readFileSync(LOG_FILE, "utf8");
    return text.split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}
