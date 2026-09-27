import fs from "node:fs";
import path from "node:path";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import * as esbuild from "esbuild";
import semver from "semver";
import { LIBS_DIR } from "./paths.ts";
import { sharedPlugin } from "./shared.ts";

/*
 * Общий кэш npm-библиотек.
 *
 *   libs/pkgs/<name>@<version>/node_modules/...   — установленный пакет (один раз на версию)
 *   libs/pkgs/<name>@<version>/dist/<sub>.js      — ESM-бандл для браузера
 *
 * Несколько модулей, которым нужен `date-fns@^3`, получают один и тот же
 * URL /libs/date-fns@3.6.0/index.js — браузер загрузит и закэширует его один раз.
 */

const run = promisify(execFile);
const runShell = promisify(exec);
const PKGS_DIR = path.join(LIBS_DIR, "pkgs");
const NAME_RE = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

export class LibError extends Error {}

export function splitSpecifier(spec: string): { name: string; sub: string } {
  const parts = spec.split("/");
  const n = spec.startsWith("@") ? 2 : 1;
  return { name: parts.slice(0, n).join("/"), sub: parts.slice(n).join("/") };
}

const safe = (name: string) => name.replace("/", "+");
const unsafe = (name: string) => name.replace("+", "/");

export function pkgDir(name: string, version: string) {
  return path.join(PKGS_DIR, `${safe(name)}@${version}`);
}

export function libUrl(name: string, version: string, sub: string) {
  return `/libs/${safe(name)}@${version}/${sub || "index"}.js`;
}

function installedVersions(name: string): string[] {
  if (!fs.existsSync(PKGS_DIR)) return [];
  const prefix = safe(name) + "@";
  return fs
    .readdirSync(PKGS_DIR)
    .filter((d) => d.startsWith(prefix) && fs.existsSync(path.join(PKGS_DIR, d, ".installed")))
    .map((d) => d.slice(prefix.length))
    .filter((v) => semver.valid(v));
}

const locks = new Map<string, Promise<any>>();
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = locks.get(key);
  if (!p) {
    p = fn().finally(() => locks.delete(key));
    locks.set(key, p);
  }
  return p;
}

async function npm(args: string[], cwd?: string) {
  // На Windows npm — это npm.cmd, который запускается только через shell.
  // Все аргументы предварительно провалидированы (NAME_RE, semver) и не содержат кавычек.
  const cmd = ["npm", ...args.map((a) => `"${a}"`)].join(" ");
  return runShell(cmd, { cwd, maxBuffer: 20 * 1024 * 1024, timeout: 5 * 60 * 1000 });
}

/** Находит (или скачивает) версию пакета, подходящую под диапазон. */
export async function resolveLib(name: string, range: string): Promise<{ version: string; dir: string }> {
  if (!NAME_RE.test(name)) throw new LibError(`Недопустимое имя пакета "${name}"`);
  if (!semver.validRange(range)) throw new LibError(`Недопустимая версия "${range}" для ${name}`);

  const local = semver.maxSatisfying(installedVersions(name), range);
  if (local) return { version: local, dir: pkgDir(name, local) };

  return once(`resolve:${name}@${range}`, async () => {
    let versions: string[];
    try {
      const { stdout } = await npm(["view", `${name}@${range}`, "version", "--json"]);
      const parsed = JSON.parse(stdout || "[]");
      versions = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      throw new LibError(`Не удалось найти ${name}@${range} в npm: ${(e as Error).message.split("\n")[0]}`);
    }
    const version = semver.maxSatisfying(versions, range);
    if (!version) throw new LibError(`В npm нет версии ${name}, подходящей под ${range}`);
    await installLib(name, version);
    return { version, dir: pkgDir(name, version) };
  });
}

async function installLib(name: string, version: string) {
  const dir = pkgDir(name, version);
  if (fs.existsSync(path.join(dir, ".installed"))) return;
  return once(`install:${name}@${version}`, async () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "lifehub-lib", private: true, dependencies: { [name]: version } }, null, 2),
    );
    console.log(`[libs] устанавливаю ${name}@${version}…`);
    try {
      // --ignore-scripts: чужие postinstall-скрипты не выполняются.
      await npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--loglevel=error"], dir);
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new LibError(`npm install ${name}@${version} не удался: ${(e as Error).message.split("\n")[0]}`);
    }
    fs.writeFileSync(path.join(dir, ".installed"), new Date().toISOString());
  });
}

/** Собирает ESM-бандл пакета (или его подпути) и возвращает URL. */
export async function ensureLibBundle(name: string, version: string, sub: string): Promise<string> {
  const dir = pkgDir(name, version);
  const out = path.join(dir, "dist", `${sub || "index"}.js`);
  const url = libUrl(name, version, sub);
  if (fs.existsSync(out)) return url;
  if (!fs.existsSync(path.join(dir, ".installed"))) await installLib(name, version);

  await once(`bundle:${out}`, async () => {
    const spec = sub ? `${name}/${sub}` : name;
    const names = await exportNames(dir, spec);
    const lines = [
      `import * as __ns from ${JSON.stringify(spec)};`,
      `const __d = __ns.default;`,
      `const __pick = (k) => { const v = __ns[k]; return v !== undefined ? v : (__d != null ? __d[k] : undefined); };`,
      `export default (__d !== undefined ? __d : __ns);`,
    ];
    names.forEach((n, i) => {
      lines.push(`const __e${i} = __pick(${JSON.stringify(n)});`);
      lines.push(`export { __e${i} as ${JSON.stringify(n)} };`);
    });
    try {
      await esbuild.build({
        stdin: { contents: lines.join("\n"), resolveDir: dir, loader: "js" },
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        minify: true,
        outfile: out,
        logLevel: "silent",
        define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
        plugins: [sharedPlugin(null)],
      });
    } catch (e) {
      throw new LibError(`Не удалось собрать ${spec}@${version} для браузера:\n${formatEsbuildError(e)}`);
    }
  });
  return url;
}

/** Список экспортов пакета: пробуем импортировать его в отдельном процессе node. */
async function exportNames(dir: string, spec: string): Promise<string[]> {
  const probe = path.join(dir, ".probe.mjs");
  fs.writeFileSync(
    probe,
    `globalThis.self ??= globalThis;
try {
  const m = await import(process.argv[2]);
  const names = new Set(Object.keys(m));
  const d = m.default;
  if (d && (typeof d === "object" || typeof d === "function")) for (const k of Object.keys(d)) names.add(k);
  console.log(JSON.stringify([...names]));
} catch (e) { console.log(JSON.stringify({ error: String(e) })); }
process.exit(0);`,
  );
  let names: string[] = [];
  try {
    const { stdout } = await run(process.execPath, [probe, spec], { cwd: dir, timeout: 20000 });
    const parsed = JSON.parse(stdout.trim().split("\n").pop() || "[]");
    if (Array.isArray(parsed)) names = parsed;
  } catch {}
  if (!names.length) {
    // Пакет не грузится в node (обращается к window и т.п.) — берём экспорты из esbuild.
    try {
      const r = await esbuild.build({
        stdin: { contents: `export * from ${JSON.stringify(spec)};`, resolveDir: dir },
        bundle: true,
        format: "esm",
        platform: "browser",
        write: false,
        metafile: true,
        logLevel: "silent",
        plugins: [sharedPlugin(null)],
      });
      names = Object.values(r.metafile!.outputs).flatMap((o) => o.exports);
    } catch {}
  }
  return [...new Set(names)].filter((n) => n !== "default" && n !== "__esModule" && n !== "module.exports");
}

/** Путь к файлу бандла по URL /libs/... (собирает при необходимости). */
export async function libFileForUrl(urlPath: string): Promise<string | null> {
  const m = urlPath.match(/^\/libs\/([^/]+)@([^/@]+)\/(.+)\.js$/);
  if (!m) return null;
  const name = unsafe(decodeURIComponent(m[1]));
  const version = m[2];
  const sub = m[3] === "index" ? "" : m[3];
  if (!NAME_RE.test(name) || !semver.valid(version) || sub.includes("..")) return null;
  const dir = pkgDir(name, version);
  if (!fs.existsSync(path.join(dir, ".installed"))) return null;
  await ensureLibBundle(name, version, sub);
  return path.join(dir, "dist", `${sub || "index"}.js`);
}

export interface LibInfo {
  name: string;
  version: string;
  sizeKb: number;
}

export function listLibs(): LibInfo[] {
  if (!fs.existsSync(PKGS_DIR)) return [];
  return fs
    .readdirSync(PKGS_DIR)
    .map((d) => {
      const at = d.lastIndexOf("@");
      if (at <= 0) return null;
      return { name: unsafe(d.slice(0, at)), version: d.slice(at + 1), sizeKb: Math.round(dirSize(path.join(PKGS_DIR, d)) / 1024) };
    })
    .filter((x): x is LibInfo => !!x);
}

/** Удаляет версии библиотек, которые не нужны ни одному модулю. */
export function pruneLibs(used: Set<string>): string[] {
  const removed: string[] = [];
  for (const lib of listLibs()) {
    const key = `${lib.name}@${lib.version}`;
    if (!used.has(key)) {
      fs.rmSync(pkgDir(lib.name, lib.version), { recursive: true, force: true });
      removed.push(key);
    }
  }
  return removed;
}

function dirSize(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

export function formatEsbuildError(e: unknown): string {
  const errs = (e as esbuild.BuildFailure)?.errors;
  if (!errs?.length) return String((e as Error)?.message ?? e);
  return errs.map(formatMessage).join("\n\n");
}

export function formatMessage(m: esbuild.Message): string {
  const loc = m.location;
  if (!loc) return m.text;
  return `${loc.file}:${loc.line}:${loc.column + 1}: ${m.text}\n    ${loc.lineText}`;
}
