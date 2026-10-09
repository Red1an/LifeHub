import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { HOME } from "./paths.ts";
import { getSettings, updateSettings } from "./settings.ts";
import { PNG_ICONS } from "./icons.ts";

/*
 * Доступ к хабу вне дома через ngrok.
 *
 * Программа ngrok на этом компьютере держит исходящее соединение с серверами ngrok,
 * и запросы к https://<домен>.ngrok-free.app приходят по нему в хаб. Телефону ничего
 * ставить не нужно — поэтому способ работает и при включённом на телефоне VPN
 * (в отличие от Tailscale, который сам занимает место VPN).
 *
 * Адрес публичный, поэтому перед хабом стоит вход через Google на стороне ngrok:
 * пускается только указанный email, остальным ngrok отказывает, и до компьютера
 * их запросы не доходят. За ним — обычный пароль хаба.
 *
 * Хаб запускает ngrok дочерним процессом и перезапускает при сбое. Заголовок Host
 * ngrok передаёт как есть (без --host-header=rewrite), поэтому хаб не считает такие
 * запросы локальными — см. isLocal в auth.ts.
 */

export const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
/** Без кавычек и запятых — email подставляется в выражение политики ngrok. */
export const EMAIL_RE = /^[^\s@'"\\,\[\]]+@[^\s@'"\\,\[\]]+\.[^\s@'"\\,\[\]]+$/;

const POLICY_FILE = path.join(HOME, "ngrok-policy.yml");

function candidates(): string[] {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return [path.join(local, "Microsoft", "WinGet", "Links", "ngrok.exe"), path.join(local, "ngrok", "ngrok.exe"), "ngrok"];
  }
  return ["/opt/homebrew/bin/ngrok", "/usr/local/bin/ngrok", "/usr/bin/ngrok", "/snap/bin/ngrok", "ngrok"];
}

function exec(bin: string, args: string[], timeout = 10000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true }, (err, out, stderr) => {
      resolve({ code: err ? 1 : 0, out: String(out) + String(stderr) });
    });
  });
}

let cachedBin: { path: string; version: string } | null = null;

async function findBin(): Promise<{ path: string; version: string } | null> {
  if (cachedBin) return cachedBin;
  for (const c of candidates()) {
    if ((c.includes("/") || c.includes("\\")) && !fs.existsSync(c)) continue;
    const r = await exec(c, ["version"], 8000);
    if (r.code === 0) return (cachedBin = { path: c, version: r.out.trim().replace(/^ngrok version\s*/i, "") });
  }
  return null;
}

/* ───────────── процесс ngrok ───────────── */

interface Tunnel {
  child: ChildProcess | null;
  url?: string;
  error?: string;
  log: string[];
  failures: number;
  restartTimer?: NodeJS.Timeout;
  /** Обещания, ждущие запуска туннеля или ошибки. */
  waiters: (() => void)[];
}

const tunnel: Tunnel = { child: null, log: [], failures: 0, waiters: [] };
let hubPort = 4200;
let hubHttps = false;

function settle() {
  for (const w of tunnel.waiters.splice(0)) w();
}

function remember(line: string) {
  tunnel.log.push(line);
  if (tunnel.log.length > 80) tunnel.log.shift();
}

/** Понятные сообщения для частых ошибок ngrok. */
function explain(text: string): string {
  if (/ERR_NGROK_4018|authtoken|authentication failed/i.test(text))
    return `ngrok не знает ваш аккаунт. Зарегистрируйтесь на ngrok.com, скопируйте authtoken и выполните в терминале:\nngrok config add-authtoken ВАШ_ТОКЕН\n\n${text}`;
  if (/ERR_NGROK_334|already online/i.test(text))
    return `Этот домен уже занят другим запуском ngrok. Закройте его (например, окно терминала с ngrok) — хаб подключится сам.\n\n${text}`;
  if (/ERR_NGROK_(313|320|15013)|domain|not (found|reserved)/i.test(text))
    return `ngrok не разрешает этот домен. Проверьте его в панели ngrok: dashboard.ngrok.com → Domains.\n\n${text}`;
  return text;
}

function onLine(raw: string) {
  const line = raw.trim();
  if (!line) return;
  let entry: any = null;
  try {
    entry = JSON.parse(line);
  } catch {}
  if (!entry) {
    remember(line);
    if (/ERROR|ERR_NGROK/i.test(line)) {
      tunnel.error = explain(line.replace(/^ERROR:\s*/, ""));
      settle();
    }
    return;
  }
  const text = [entry.msg, entry.err].filter(Boolean).join(": ");
  remember(`${entry.lvl ?? ""} ${text}`.trim());
  if (entry.msg === "started tunnel" && entry.url) {
    tunnel.url = entry.url;
    tunnel.error = undefined;
    tunnel.failures = 0;
    settle();
  } else if ((entry.lvl === "eror" || entry.lvl === "crit") && entry.err && entry.err !== "<nil>") {
    tunnel.error = explain(text);
    settle();
  }
}

/**
 * Манифест и иконки приложения отдаются без входа: браузер запрашивает их без cookie,
 * и за входом через Google установка на телефон (PWA) не работает. Секретов в них нет.
 */
const PWA_PATHS = ["/manifest.webmanifest", "/icon.svg", ...Object.keys(PNG_ICONS)];

/**
 * Вебхук Джарвиса (навык Алисы): Яндекс не умеет входить через Google. Доступ к нему
 * закрыт секретом в адресе — см. server/jarvis.
 */
const PUBLIC_PREFIX = "/alice/";

function policy(email: string) {
  const pub = `!(req.url.path in [${PWA_PATHS.map((p) => `'${p}'`).join(", ")}]) && !req.url.path.startsWith('${PUBLIC_PREFIX}')`;
  return `# Создаётся хабом при запуске ngrok — правки вручную будут перезаписаны.
# Вход через Google; пускается только ${email}, остальным — отказ.
# Без входа доступны только манифест, иконки приложения и вебхук Алисы (${PUBLIC_PREFIX}<секрет>).
on_http_request:
  - expressions:
      - "${pub}"
    actions:
      - type: oauth
        config:
          provider: google
  - expressions:
      - "${pub}"
      - "!(actions.ngrok.oauth.identity.email in ['${email}'])"
    actions:
      - type: deny
`;
}

function writePolicy(email: string) {
  fs.writeFileSync(POLICY_FILE, policy(email));
}

/** Туннель запущен со старой политикой (без вебхука Алисы) — перезапустить. */
export async function ensureNgrokPolicy() {
  const cfg = getSettings().ngrok;
  if (!cfg?.enabled || !tunnel.child) return;
  let current = "";
  try {
    current = fs.readFileSync(POLICY_FILE, "utf8");
  } catch {}
  if (current === policy(cfg.email)) return;
  stop();
  await launch();
  await waitReady(15_000);
}

async function launch() {
  const cfg = getSettings().ngrok;
  if (!cfg?.enabled) return;
  const bin = await findBin();
  if (!bin) {
    tunnel.error = "ngrok не установлен";
    settle();
    return;
  }
  if (!EMAIL_RE.test(cfg.email) || !DOMAIN_RE.test(cfg.domain)) {
    tunnel.error = "Укажите домен и email";
    settle();
    return;
  }
  writePolicy(cfg.email);
  const upstream = `${hubHttps ? "https" : "http"}://127.0.0.1:${hubPort}`;
  const child = spawn(
    bin.path,
    ["http", upstream, `--url=https://${cfg.domain}`, `--traffic-policy-file=${POLICY_FILE}`, "--log=stdout", "--log-format=json"],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  tunnel.child = child;
  tunnel.url = undefined;
  let buf = "";
  const feed = (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    lines.forEach(onLine);
  };
  child.stdout!.on("data", feed);
  child.stderr!.on("data", feed);
  child.on("error", (e) => {
    tunnel.error = e.message;
    settle();
  });
  child.on("exit", (code) => {
    if (buf) onLine(buf);
    if (tunnel.child !== child) return; // остановлен намеренно
    tunnel.child = null;
    tunnel.url = undefined;
    tunnel.error ??= `ngrok завершился с кодом ${code}`;
    settle();
    // Сбой: перезапуск с нарастающей паузой, пока туннель включён в настройках.
    if (getSettings().ngrok?.enabled) {
      tunnel.failures++;
      tunnel.restartTimer = setTimeout(launch, Math.min(60_000, 2000 * 2 ** (tunnel.failures - 1)));
    }
  });
}

function stop() {
  clearTimeout(tunnel.restartTimer);
  const child = tunnel.child;
  tunnel.child = null;
  tunnel.url = undefined;
  tunnel.error = undefined;
  tunnel.failures = 0;
  child?.kill();
}

// Хаб завершается (остановка, перезапуск) — ngrok не должен остаться висеть и держать домен.
process.on("exit", () => tunnel.child?.kill());

/** Вызывается при старте хаба: поднимает туннель, если он включён. */
export function startNgrok(port: number, https: boolean) {
  hubPort = port;
  hubHttps = https;
  launch().catch((e) => console.error("[ngrok]", e));
}

/** Ждёт, пока туннель запустится или сообщит об ошибке (не дольше timeout). */
function waitReady(timeout: number) {
  if (tunnel.url || tunnel.error) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, timeout);
    tunnel.waiters.push(() => {
      clearTimeout(t);
      resolve();
    });
  });
}

export interface NgrokStatus {
  installed: boolean;
  version?: string;
  enabled: boolean;
  domain: string;
  email: string;
  running: boolean;
  url?: string;
  error?: string;
  log: string[];
}

export async function ngrokStatus(): Promise<NgrokStatus> {
  const bin = await findBin();
  const cfg = getSettings().ngrok;
  return {
    installed: !!bin,
    version: bin?.version,
    enabled: !!cfg?.enabled,
    domain: cfg?.domain ?? "",
    email: cfg?.email ?? "",
    running: !!tunnel.child && !!tunnel.url,
    url: tunnel.url,
    error: tunnel.error,
    log: tunnel.log.slice(-30),
  };
}

export async function configureNgrok(patch: { enabled: boolean; domain: string; email: string }): Promise<NgrokStatus> {
  const domain = patch.domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const email = patch.email.trim().toLowerCase();
  if (patch.enabled) {
    if (!DOMAIN_RE.test(domain)) throw new Error("Неверный домен. Пример: my-name.ngrok-free.app");
    if (!EMAIL_RE.test(email)) throw new Error("Неверный email");
  }
  updateSettings({ ngrok: { enabled: patch.enabled, domain, email } });
  stop();
  tunnel.log = [];
  if (patch.enabled) {
    await launch();
    await waitReady(15_000);
  }
  return ngrokStatus();
}
