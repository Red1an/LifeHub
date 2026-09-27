import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline";
import { serve } from "@hono/node-server";
import { ensureDirs, MODULES_DIR, HOME, HUB_DIR, PLATFORM_DIR, CERT_DIR } from "./paths.ts";
import { openDb } from "./db.ts";
import * as reg from "./registry.ts";
import { compilePlatform, type PlatformBuild } from "./compiler.ts";
import { createApp, lanAddresses } from "./app.ts";
import { emit } from "./events.ts";
import { formatEsbuildError } from "./libs.ts";
import { setPassword } from "./auth.ts";
import { supervise, isSupervised, EXIT_PORT_BUSY, enableAutostart, disableAutostart, autostartEnabled } from "./system.ts";

const run = promisify(execFile);

function flag(args: string[], name: string) {
  return args.includes(`--${name}`);
}
function option(args: string[], name: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function init() {
  ensureDirs();
  openDb();
  reg.cleanStaging();
  reg.seedBuiltins();
  reg.scan();
  await reg.writeWorkspaceFiles();
}

async function start(args: string[]) {
  if (flag(args, "background")) {
    ensureDirs();
    return supervise(args);
  }
  const dev = flag(args, "dev");
  const useHttps = flag(args, "https");
  const port = Number(option(args, "port") ?? process.env.LIFEHUB_PORT ?? 4200);

  await init();
  let platform: PlatformBuild;
  try {
    platform = await compilePlatform(dev);
  } catch (e) {
    console.error("Не удалось собрать платформу:\n" + formatEsbuildError(e));
    process.exit(1);
  }
  await Promise.all([reg.buildAll(), reg.rebuildCss()]);
  reg.initHistory().catch((e) => console.error("[history]", e));
  reg.watchModules();
  reg.scheduleUpdateChecks();

  if (dev) {
    reg.watchPlatformCss();
    let t: NodeJS.Timeout | undefined;
    fs.watch(PLATFORM_DIR, { recursive: true }, () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        try {
          platform = await compilePlatform(true);
          console.log("[platform] пересобрана");
          emit({ type: "platform", hash: platform.hash });
        } catch (e) {
          console.error("[platform]\n" + formatEsbuildError(e));
        }
      }, 120);
    });
  }

  const app = createApp({ port, https: useHttps, getPlatform: () => platform });
  const serverOptions = useHttps ? await certificate() : undefined;
  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname: "0.0.0.0",
      ...(useHttps ? { createServer: https.createServer, serverOptions } : {}),
    } as any,
    () => {
      const proto = useHttps ? "https" : "http";
      console.log(`\n  LifeHub запущен\n`);
      console.log(`  На этом компьютере:  ${proto}://localhost:${port}`);
      for (const ip of lanAddresses()) console.log(`  В локальной сети:    ${proto}://${ip}:${port}`);
      console.log(`\n  Модули:  ${MODULES_DIR}`);
      console.log(`  Данные:  ${HOME}\n`);
    },
  );
  // Порт занят: либо хаб уже работает (в фоне), либо предыдущий процесс ещё не освободил порт.
  let retries = 0;
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code !== "EADDRINUSE") throw e;
    if (isSupervised() && retries++ < 15) {
      setTimeout(() => server.listen(port, "0.0.0.0"), 1000);
      return;
    }
    console.log(`\n  Хаб уже запущен (порт ${port} занят): http://localhost:${port}\n`);
    process.exit(EXIT_PORT_BUSY);
  });
}

/** Самоподписанный сертификат для HTTPS в локальной сети (нужен для микрофона на телефоне). */
async function certificate() {
  const key = path.join(CERT_DIR, "key.pem");
  const cert = path.join(CERT_DIR, "cert.pem");
  const ips = lanAddresses();
  const ipsFile = path.join(CERT_DIR, "ips.json");
  const fresh = fs.existsSync(cert) && fs.existsSync(ipsFile) && fs.readFileSync(ipsFile, "utf8") === JSON.stringify(ips);
  if (!fresh) {
    const { generate } = await import("selfsigned");
    const pems = await generate([{ name: "commonName", value: "LifeHub" }], {
      keySize: 2048,
      algorithm: "sha256",
      notAfterDate: new Date(Date.now() + 825 * 86400_000),
      extensions: [
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true } as any,
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 7, ip: "127.0.0.1" },
            ...ips.map((ip) => ({ type: 7 as const, ip })),
          ],
        },
      ],
    });
    fs.mkdirSync(CERT_DIR, { recursive: true });
    fs.writeFileSync(key, pems.private);
    fs.writeFileSync(cert, pems.cert);
    fs.writeFileSync(ipsFile, JSON.stringify(ips));
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

/** Проверка модуля: сборка + проверка типов. Для Claude Code и CI. */
async function check(args: string[]) {
  await init();
  const target = args.find((a) => !a.startsWith("--"));
  const all = reg.listModules();
  const ids = !target || target === "all" ? all.map((m) => m.id) : [target];
  let failed = false;
  for (const id of ids) {
    if (!all.some((m) => m.id === id)) {
      console.error(`✗ ${id}: модуль не найден в ${MODULES_DIR}`);
      failed = true;
      continue;
    }
    const b = await reg.getBuild(id);
    if (!b.ok) {
      failed = true;
      console.log(`✗ ${id}: ошибки сборки\n\n${b.errors.join("\n\n")}\n`);
      continue;
    }
    for (const w of b.warnings) console.log(`⚠ ${id}: ${w}`);
    if (!flag(args, "no-types")) {
      await reg.writeModuleTsconfig(reg.getEntry(id));
      const tsc = path.join(HUB_DIR, "node_modules", "typescript", "bin", "tsc");
      try {
        await run(process.execPath, [tsc, "-p", path.join(reg.getEntry(id).dir, "tsconfig.json")], { maxBuffer: 10 * 1024 * 1024 });
      } catch (e: any) {
        failed = true;
        console.log(`✗ ${id}: ошибки типов\n\n${(e.stdout || e.message).trim()}\n`);
        continue;
      }
    }
    console.log(`✓ ${id}: собирается (${(b.js.length / 1024).toFixed(1)} КБ)${b.libs.length ? `, библиотеки: ${b.libs.join(", ")}` : ""}`);
  }
  process.exit(failed ? 1 : 0);
}

async function create(args: string[]) {
  await init();
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) {
    console.error("Использование: lifehub new <id> [--name \"Название\"] [--icon 🧪] [--template blank|collection|library]");
    process.exit(1);
  }
  await reg.createModule({ id, name: option(args, "name") ?? id, icon: option(args, "icon"), template: option(args, "template") });
  console.log(`Создан модуль ${path.join(MODULES_DIR, id)}`);
  process.exit(0);
}

async function password(args: string[]) {
  ensureDirs();
  if (flag(args, "remove")) {
    setPassword(null);
    console.log("Пароль удалён — доступ с других устройств закрыт.");
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pw = await new Promise<string>((r) => rl.question("Новый пароль для доступа с других устройств: ", r));
  rl.close();
  setPassword(pw);
  console.log("Пароль установлен.");
}

const HELP = `LifeHub — хаб модулей для жизни

  lifehub [start] [--port 4200] [--https] [--dev]   запустить хаб
  lifehub check [id|all] [--no-types]               проверить, что модуль собирается
  lifehub new <id> [--name ...] [--template ...]    создать модуль из шаблона
  lifehub password [--remove]                       пароль для входа с телефона
  lifehub autostart [on|off]                        запуск хаба в фоне при входе в систему
  lifehub start --background                        запустить в фоне (лог: ~/.lifehub/logs/hub.log)
  lifehub path                                      папка с модулями
`;

export async function main(argv: string[]) {
  const [cmd = "start", ...rest] = argv;
  switch (cmd) {
    case "start":
      return start(rest);
    case "check":
      return check(rest);
    case "new":
      return create(rest);
    case "password":
      return password(rest);
    case "autostart": {
      ensureDirs();
      const on = rest[0] !== "off";
      if (on) enableAutostart({ port: Number(option(rest, "port") ?? 4200), https: flag(rest, "https") });
      else disableAutostart();
      console.log(autostartEnabled() ? "Автозапуск включён: хаб будет стартовать в фоне при входе в систему." : "Автозапуск выключен.");
      return;
    }
    case "path":
      ensureDirs();
      console.log(MODULES_DIR);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      if (cmd.startsWith("--")) return start(argv);
      console.log(HELP);
      process.exit(1);
  }
}
