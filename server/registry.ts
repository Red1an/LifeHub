import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { zipSync, unzipSync } from "fflate";
import {
  MODULES_DIR, STAGING_DIR, TRASH_DIR, BUILTIN_MODULES_DIR, TEMPLATES_DIR, GUIDE_FILE, HUB_DIR, MODULE_ID_RE, PLATFORM_DIR,
} from "./paths.ts";
import { readManifest, writeManifest, type Manifest } from "./manifest.ts";
import { compileModule, type BuildOutput } from "./compiler.ts";
import { buildCss } from "./css.ts";
import { resolveLib, pkgDir, splitSpecifier } from "./libs.ts";
import { getSettings, updateSettings } from "./settings.ts";
import { emit } from "./events.ts";
import { moduleStats, purgeModuleData } from "./db.ts";
import { DatabaseSync } from "node:sqlite";
import {
  snapshot, listVersions, versionDetails, restoreVersion, commitUpstream, mergeUpstream, cloneHistory, hasCommit, gitAvailable, showFile, recordMerge,
} from "./history.ts";

const run = promisify(execFile);

/** Файлы и папки, которые хаб генерирует сам и которые не входят в модуль. */
const IGNORED = new Set(["node_modules", ".git", ".out", ".upstream", "tsconfig.json", ".lifehub-source.json", ".DS_Store"]);

export interface SourceInfo {
  type: "builtin" | "git" | "zip" | "path" | "created" | "fork";
  url?: string;
  from?: string;
  installedAt: string;
  /** Версия автора, от которой идёт модуль. */
  version: string;
  /** Хэш содержимого версии автора — чтобы понять, правил ли пользователь модуль. */
  contentHash: string;
  /** Коммит репозитория автора (git). */
  commit?: string;
  /** Версия автора в истории модуля — общий предок для слияния обновлений. */
  base?: string;
  /** Модуль — своя версия модуля с этим id. */
  forkOf?: string;
  /** Обновление автора, ожидающее ручного объединения (.upstream/). */
  pending?: { base?: string; commit?: string; version: string; contentHash: string };
}

interface Entry {
  id: string;
  dir: string;
  manifest?: Manifest;
  manifestError?: string;
  build?: BuildOutput;
  building?: Promise<BuildOutput>;
}

const entries = new Map<string, Entry>();
let css = { css: "", hash: "" };

export class HubError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/* ───────────────────────── сканирование ───────────────────────── */

export function scan() {
  const seen = new Set<string>();
  for (const d of fs.readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    const dir = path.join(MODULES_DIR, d.name);
    if (!fs.existsSync(path.join(dir, "lifehub.json"))) continue;
    seen.add(d.name);
    const prev = entries.get(d.name);
    const e: Entry = { id: d.name, dir, build: prev?.build };
    try {
      e.manifest = readManifest(dir);
      if (e.manifest.id !== d.name) {
        e.manifestError = `id в lifehub.json ("${e.manifest.id}") не совпадает с именем папки ("${d.name}")`;
        e.manifest = undefined;
      }
    } catch (err) {
      e.manifestError = (err as Error).message;
    }
    if (prev?.manifest && e.manifest && JSON.stringify(prev.manifest) !== JSON.stringify(e.manifest)) e.build = undefined;
    entries.set(d.name, e);
  }
  for (const id of [...entries.keys()]) if (!seen.has(id)) entries.delete(id);
}

export const isEnabled = (id: string) => !getSettings().disabled.includes(id);

/* ───────────────────────── сборка ───────────────────────── */

export async function getBuild(id: string, stack: string[] = []): Promise<BuildOutput> {
  const e = entries.get(id);
  if (!e) throw new HubError(`Модуль "${id}" не установлен`, 404);
  if (!e.manifest) {
    return failed([e.manifestError ?? "Ошибка манифеста"]);
  }
  if (e.build) return e.build;
  if (e.building) return e.building;
  if (stack.includes(id)) return failed([`Циклическая зависимость модулей: ${[...stack, id].join(" → ")}`]);

  const manifest = e.manifest;
  e.building = compileModule(e.dir, manifest, {
    libraryModule: async (libId) => {
      const lib = entries.get(libId);
      if (!lib?.manifest) return { error: `Модуль-библиотека "${libId}" не установлен` };
      if (lib.manifest.type !== "library") return { error: `Модуль "${libId}" не является библиотекой (type: "library")` };
      const b = await getBuild(libId, [...stack, id]);
      if (!b.ok) return { error: `Модуль-библиотека "${libId}" не собирается:\n${b.errors.join("\n")}` };
      return { url: `/modules/${libId}/module.js?v=${b.hash}`, version: lib.manifest.version };
    },
  })
    .then((b) => {
      if (entries.get(id) === e) e.build = b;
      return b;
    })
    .finally(() => {
      e.building = undefined;
    });
  return e.building;
}

function failed(errors: string[]): BuildOutput {
  return { ok: false, hash: "", js: "", map: "", css: "", errors, warnings: [], libs: [], uses: [], inputs: [], builtAt: Date.now() };
}

/** Сбрасывает сборку модуля и всех, кто от него зависит; пересобирает включённые. */
export async function rebuild(id: string) {
  const affected = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of entries.values()) {
      if (!affected.has(e.id) && e.build?.uses.some((u) => affected.has(u))) {
        affected.add(e.id);
        grew = true;
      }
    }
  }
  for (const a of affected) {
    const e = entries.get(a);
    if (e) e.build = undefined;
  }
  await Promise.all(
    [...affected].filter((a) => entries.has(a) && isEnabled(a)).map(async (a) => {
      const b = await getBuild(a);
      emit({ type: "module-built", id: a, hash: b.hash, ok: b.ok });
      logBuild(a, b);
    }),
  );
}

export function logBuild(id: string, b: BuildOutput) {
  if (b.ok) console.log(`[build] ${id} ✓ ${(b.js.length / 1024).toFixed(1)} КБ${b.libs.length ? ` (библиотеки: ${b.libs.join(", ")})` : ""}`);
  else console.log(`[build] ${id} ✗\n  ${b.errors.join("\n  ")}`);
}

export async function buildAll() {
  await Promise.all(
    [...entries.values()].filter((e) => isEnabled(e.id)).map(async (e) => logBuild(e.id, await getBuild(e.id))),
  );
}

export async function rebuildCss() {
  const dirs = [...entries.values()].filter((e) => isEnabled(e.id)).map((e) => e.dir);
  const next = await buildCss(dirs);
  if (next.hash !== css.hash) {
    css = next;
    emit({ type: "css", hash: css.hash });
  }
  return css;
}

export const getCss = () => css;

/* ───────────────────────── отслеживание изменений ───────────────────────── */

let cssTimer: NodeJS.Timeout | undefined;
const timers = new Map<string, NodeJS.Timeout>();

export function watchModules() {
  fs.watch(MODULES_DIR, { recursive: true }, (_ev, filename) => {
    if (!filename) return;
    const parts = filename.split(/[\\/]/);
    const id = parts[0];
    if (id.startsWith(".") || parts.some((p) => IGNORED.has(p)) || !MODULE_ID_RE.test(id)) return;
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(async () => {
        timers.delete(id);
        const before = JSON.stringify(entries.get(id)?.manifest ?? null);
        scan();
        const after = JSON.stringify(entries.get(id)?.manifest ?? null);
        if (before !== after || !entries.has(id)) emit({ type: "modules" });
        if (entries.has(id)) {
          if (parts[1] === "lifehub.json") writeModuleTsconfig(entries.get(id)!).catch(() => {});
          await rebuild(id);
          if (entries.get(id)?.build?.ok) scheduleSnapshot(id);
        }
        clearTimeout(cssTimer);
        cssTimer = setTimeout(() => rebuildCss().catch((e) => console.error("[css]", e)), 100);
      }, 150),
    );
  });
}

export function watchPlatformCss() {
  fs.watch(PLATFORM_DIR, { recursive: true }, () => {
    clearTimeout(cssTimer);
    cssTimer = setTimeout(() => rebuildCss().catch((e) => console.error("[css]", e)), 100);
  });
}

/* ───────────────────────── список ───────────────────────── */

export function readSource(dir: string): SourceInfo | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".lifehub-source.json"), "utf8"));
  } catch {
    return null;
  }
}

export function listModules() {
  const order = getSettings().order;
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? 1e6 : i;
  };
  return [...entries.values()]
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
    .map((e) => {
      const enabled = isEnabled(e.id);
      const b = e.build;
      const status = !enabled ? "disabled" : e.manifestError ? "error" : e.building || !b ? "building" : b.ok ? "ok" : "error";
      return {
        id: e.id,
        dir: e.dir,
        manifest: e.manifest ?? null,
        enabled,
        status,
        hash: b?.hash ?? "",
        hasCss: !!b?.css,
        errors: e.manifestError ? [e.manifestError] : (b?.errors ?? []),
        warnings: b?.warnings ?? [],
        libs: b?.libs ?? [],
        uses: b?.uses ?? [],
        sizeKb: b ? Math.round(b.js.length / 1024) : 0,
        source: readSource(e.dir),
        update: updates.get(e.id) ?? null,
        autoUpdate: getSettings().autoUpdate.includes(e.id),
      };
    });
}

export function getEntry(id: string) {
  const e = entries.get(id);
  if (!e) throw new HubError(`Модуль "${id}" не установлен`, 404);
  return e;
}

export function moduleDetails(id: string) {
  const m = listModules().find((x) => x.id === id);
  if (!m) throw new HubError(`Модуль "${id}" не установлен`, 404);
  return { ...m, stats: moduleStats(id), modified: isLocallyModified(id) };
}

/** Все пары name@version, которые используют модули (для очистки кэша). */
export async function usedLibs(): Promise<Set<string>> {
  const used = new Set<string>();
  for (const e of entries.values()) {
    for (const [name, range] of Object.entries(e.manifest?.deps ?? {})) {
      try {
        const { version } = await resolveLib(name, range);
        used.add(`${name}@${version}`);
      } catch {}
    }
  }
  return used;
}

/* ───────────────────────── файлы рабочего пространства ───────────────────────── */

/**
 * В папке модулей лежит руководство для нейронки, а в каждом модуле —
 * CLAUDE.md, ссылающийся на него. Открываешь папку в Claude Code — и он
 * уже знает, как устроен SDK и как проверить модуль.
 */
export async function writeWorkspaceFiles() {
  const guide = fs.readFileSync(GUIDE_FILE, "utf8").replaceAll("{{HUB_DIR}}", HUB_DIR.replaceAll("\\", "/"));
  fs.writeFileSync(path.join(MODULES_DIR, "LIFEHUB_GUIDE.md"), guide);
  const ws = path.join(MODULES_DIR, "CLAUDE.md");
  if (!fs.existsSync(ws)) {
    fs.writeFileSync(
      ws,
      `@LIFEHUB_GUIDE.md\n\n# Рабочая папка модулей LifeHub\n\nКаждая подпапка — отдельный модуль. Хаб сам пересобирает модуль при сохранении файла.\n`,
    );
  }
  for (const e of entries.values()) {
    ensureModuleFiles(e.dir, e.manifest?.name ?? e.id);
    await writeModuleTsconfig(e).catch(() => {});
  }
}

/**
 * Служебные файлы, которые хаб добавляет в модуль. Если у автора их нет, берём
 * локальные — иначе обновление выглядело бы как «автор удалил CLAUDE.md».
 */
function keepLocalFiles(fromDir: string, toDir: string) {
  for (const f of ["CLAUDE.md", ".gitignore"]) {
    const src = path.join(fromDir, f);
    const dst = path.join(toDir, f);
    if (!fs.existsSync(dst) && fs.existsSync(src)) fs.copyFileSync(src, dst);
  }
}

/** CLAUDE.md и .gitignore в папке модуля (если их нет). */
function ensureModuleFiles(dir: string, name: string) {
  if (!fs.existsSync(path.join(dir, "CLAUDE.md"))) {
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), `@../LIFEHUB_GUIDE.md\n\n# ${name}\n`);
  }
  const gi = path.join(dir, ".gitignore");
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, "tsconfig.json\n.out/\n.upstream/\n.lifehub-source.json\nnode_modules/\n");
}

const posix = (p: string) => p.replaceAll("\\", "/");

/** tsconfig.json с путями к SDK хаба и к установленным библиотекам — для tsc и редактора. */
export async function writeModuleTsconfig(e: Entry) {
  if (!e.manifest) return;
  const nm = path.join(HUB_DIR, "node_modules");
  const paths: Record<string, string[]> = {
    "@lifehub/sdk": [posix(path.join(PLATFORM_DIR, "sdk", "index.ts"))],
    "react": [posix(path.join(nm, "@types", "react"))],
    "react/*": [posix(path.join(nm, "@types", "react")) + "/*"],
    "react-dom": [posix(path.join(nm, "@types", "react-dom"))],
    "react-dom/*": [posix(path.join(nm, "@types", "react-dom")) + "/*"],
  };
  for (const id of Object.keys(e.manifest.uses)) {
    const lib = entries.get(id);
    if (lib?.manifest) paths[`@modules/${id}`] = [posix(path.join(lib.dir, lib.manifest.entry))];
  }
  for (const [name, range] of Object.entries(e.manifest.deps)) {
    try {
      const { version } = await resolveLib(name, range);
      const base = posix(path.join(pkgDir(name, version), "node_modules", splitSpecifier(name).name));
      paths[name] = [base];
      paths[`${name}/*`] = [base + "/*"];
    } catch {}
  }
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      jsx: "react-jsx",
      lib: ["ES2023", "DOM", "DOM.Iterable"],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      types: [],
      typeRoots: [posix(path.join(nm, "@types"))],
      paths,
    },
    include: ["src", "*.d.ts", posix(path.join(PLATFORM_DIR, "sdk", "env.d.ts"))],
  };
  const text = "// Сгенерировано LifeHub — не редактируйте, файл перезаписывается.\n" + JSON.stringify(tsconfig, null, 2) + "\n";
  const file = path.join(e.dir, "tsconfig.json");
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
}

/* ───────────────────────── встроенные модули ───────────────────────── */

/** Незавершённые установки от прошлых запусков. */
export function cleanStaging() {
  for (const d of fs.readdirSync(STAGING_DIR)) fs.rmSync(path.join(STAGING_DIR, d), { recursive: true, force: true });
}

export function seedBuiltins() {
  const s = getSettings();
  if (s.seeded) return;
  for (const d of fs.readdirSync(BUILTIN_MODULES_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const target = path.join(MODULES_DIR, d.name);
    if (fs.existsSync(target)) continue;
    copyDir(path.join(BUILTIN_MODULES_DIR, d.name), target);
    writeSource(target, { type: "builtin", from: d.name });
  }
  updateSettings({ seeded: true });
}

export function builtinCatalog() {
  return fs
    .readdirSync(BUILTIN_MODULES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      try {
        const m = readManifest(path.join(BUILTIN_MODULES_DIR, d.name));
        return { id: m.id, name: m.name, description: m.description ?? "", icon: m.icon ?? "📦", version: m.version, type: m.type, source: { type: "builtin" as const, id: d.name } };
      } catch {
        return null;
      }
    })
    .filter((x) => !!x);
}

/* ───────────────────────── установка ───────────────────────── */

export type InstallSource =
  | { type: "git"; url: string }
  | { type: "path"; path: string }
  | { type: "builtin"; id: string }
  | { type: "zip"; data: Uint8Array };

interface StageMeta {
  dir: string;
  source: Exclude<InstallSource, { type: "zip" }> | { type: "zip" };
  /** Коммит репозитория автора (для git-источников). */
  commit?: string;
  /** Последние коммиты автора, затрагивающие модуль: для списка изменений. */
  log?: { sha: string; subject: string }[];
}

interface Staged {
  stagingId: string;
  dir: string;
  manifest: Manifest;
  meta: StageMeta;
}

export async function stage(src: InstallSource): Promise<Staged> {
  const stagingId = crypto.randomBytes(8).toString("hex");
  const root = path.join(STAGING_DIR, stagingId);
  fs.mkdirSync(root, { recursive: true });
  try {
    if (src.type === "git") {
      const [url, sub] = src.url.split("#");
      // file:/// — локальный репозиторий на этом компьютере (удобно для своих модулей и проверки).
      if (!/^(https?:\/\/|git@|file:\/\/\/)[\w.@:/~+%-]+$/.test(url)) throw new HubError("Неверный адрес git-репозитория");
      const repo = path.join(root, "repo");
      try {
        await run("git", ["-c", "core.autocrlf=false", "clone", "--depth", "50", "--no-tags", "--quiet", "--", url, repo], { timeout: 180000 });
      } catch (e) {
        throw new HubError(`git clone не удался: ${(e as Error).message.split("\n")[0]}`);
      }
      const dir = locateModule(repo, sub);
      const commit = (await run("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
      const rel = path.relative(repo, dir) || ".";
      const logOut = (await run("git", ["-C", repo, "log", "-n", "50", "--format=%H%x1f%s", "--", rel])).stdout;
      const log = logOut.split("\n").filter(Boolean).map((l) => {
        const [sha, subject] = l.split("\x1f");
        return { sha, subject };
      });
      fs.rmSync(path.join(repo, ".git"), { recursive: true, force: true });
      return finishStage(stagingId, dir, { dir, source: src, commit, log });
    }
    if (src.type === "path") {
      if (!fs.existsSync(path.join(src.path, "lifehub.json"))) throw new HubError("В этой папке нет lifehub.json");
      copyDir(src.path, path.join(root, "repo"));
      const dir = path.join(root, "repo");
      return finishStage(stagingId, dir, { dir, source: src });
    }
    if (src.type === "builtin") {
      const from = path.join(BUILTIN_MODULES_DIR, src.id);
      if (!MODULE_ID_RE.test(src.id) || !fs.existsSync(from)) throw new HubError("Нет такого встроенного модуля");
      copyDir(from, path.join(root, "repo"));
      const dir = path.join(root, "repo");
      return finishStage(stagingId, dir, { dir, source: src });
    }
    const files = unzipSync(src.data);
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith("/")) continue;
      const target = path.resolve(root, "repo", name);
      if (!target.startsWith(path.resolve(root, "repo") + path.sep)) throw new HubError("Архив содержит недопустимые пути");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    const dir = locateModule(path.join(root, "repo"));
    return finishStage(stagingId, dir, { dir, source: { type: "zip" } });
  } catch (e) {
    fs.rmSync(root, { recursive: true, force: true });
    throw e;
  }
}

function locateModule(dir: string, sub?: string): string {
  if (sub) {
    const p = path.resolve(dir, sub);
    if (!p.startsWith(dir) || !fs.existsSync(path.join(p, "lifehub.json"))) throw new HubError(`Нет lifehub.json в ${sub}`);
    return p;
  }
  if (fs.existsSync(path.join(dir, "lifehub.json"))) return dir;
  const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "lifehub.json")));
  if (subs.length === 1) return path.join(dir, subs[0].name);
  if (subs.length > 1) throw new HubError(`В репозитории несколько модулей (${subs.map((s) => s.name).join(", ")}). Укажите нужный через #папка в конце адреса.`);
  throw new HubError("lifehub.json не найден — это не модуль LifeHub");
}

function finishStage(stagingId: string, dir: string, meta: StageMeta): Staged {
  const manifest = readManifest(dir);
  fs.writeFileSync(path.join(STAGING_DIR, stagingId, "meta.json"), JSON.stringify(meta));
  return { stagingId, dir, manifest, meta };
}

function readStaged(stagingId: string): StageMeta {
  if (!/^[a-f0-9]{16}$/.test(stagingId)) throw new HubError("Неверный stagingId");
  const metaFile = path.join(STAGING_DIR, stagingId, "meta.json");
  if (!fs.existsSync(metaFile)) throw new HubError("Загруженная версия устарела, начните заново", 410);
  return JSON.parse(fs.readFileSync(metaFile, "utf8"));
}

const dropStaged = (stagingId: string) => fs.rmSync(path.join(STAGING_DIR, stagingId), { recursive: true, force: true });

export function stagedPreview(s: Staged) {
  const existing = entries.get(s.manifest.id);
  return {
    stagingId: s.stagingId,
    manifest: s.manifest,
    exists: !!existing,
    installedVersion: existing?.manifest?.version ?? null,
    files: countFiles(s.dir),
  };
}

function sourceLabel(s: StageMeta["source"]) {
  if (s.type === "git") return s.url;
  if (s.type === "builtin") return "встроенный";
  if (s.type === "path") return s.path;
  return "архив";
}

export async function confirmInstall(stagingId: string, opts: { id?: string; replace?: boolean; kind?: "install" | "update" }) {
  const meta = readStaged(stagingId);
  const manifest = readManifest(meta.dir);
  const id = opts.id || manifest.id;
  if (!MODULE_ID_RE.test(id)) throw new HubError("Недопустимый id модуля");
  const target = path.join(MODULES_DIR, id);
  const previous = fs.existsSync(target) ? readSource(target) : null;
  let trashed: string | null = null;
  if (fs.existsSync(target)) {
    if (!opts.replace) throw new HubError(`Модуль "${id}" уже установлен`, 409);
    trashed = moveToTrash(id);
  }
  copyDir(meta.dir, target);
  // Заметки пользователя для нейронки (CLAUDE.md) переживают обновление, если у автора такого файла нет.
  if (trashed) keepLocalFiles(trashed, target);
  if (id !== manifest.id) writeManifest(target, { id });
  const src = meta.source;
  writeSource(target, {
    type: src.type,
    url: src.type === "git" ? src.url : src.type === "path" ? src.path : undefined,
    from: src.type === "builtin" ? src.id : undefined,
    commit: meta.commit,
    forkOf: previous?.forkOf,
  });
  dropStaged(stagingId);
  ensureModuleFiles(target, manifest.name);
  const kind = opts.kind ?? "install";
  const base = await snapshot(id, target, kind, kind === "update" ? `Обновлён до v${manifest.version}` : `Установлен v${manifest.version} · ${sourceLabel(src)}`).catch(logHistoryError);
  if (base) patchSource(target, { base });
  updates.delete(id);
  await afterChange(id);
  return id;
}

function writeSource(dir: string, info: Omit<SourceInfo, "installedAt" | "version" | "contentHash">) {
  const m = readManifest(dir);
  const full: SourceInfo = { ...info, installedAt: new Date().toISOString(), version: m.version, contentHash: contentHash(dir) };
  fs.writeFileSync(path.join(dir, ".lifehub-source.json"), JSON.stringify(full, null, 2));
}

function patchSource(dir: string, patch: Partial<SourceInfo>) {
  const src = readSource(dir);
  if (!src) return;
  const next: Record<string, unknown> = { ...src, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  fs.writeFileSync(path.join(dir, ".lifehub-source.json"), JSON.stringify(next, null, 2));
}

async function afterChange(id?: string) {
  scan();
  await writeWorkspaceFiles();
  emit({ type: "modules" });
  if (id) await rebuild(id);
  await rebuildCss();
}

/* ───────────────────────── создание, форк, удаление ───────────────────────── */

export function templates() {
  return fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const info = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, d.name, "template.json"), "utf8"));
    return { id: d.name, ...info };
  });
}

export async function createModule(opts: { id: string; name: string; icon?: string; description?: string; template?: string }) {
  if (!MODULE_ID_RE.test(opts.id)) throw new HubError("id: латиница в нижнем регистре, цифры и дефис, от 2 символов");
  const target = path.join(MODULES_DIR, opts.id);
  if (fs.existsSync(target)) throw new HubError(`Модуль "${opts.id}" уже существует`, 409);
  const tpl = opts.template || "blank";
  const from = path.join(TEMPLATES_DIR, tpl);
  if (!/^[a-z-]+$/.test(tpl) || !fs.existsSync(from)) throw new HubError("Нет такого шаблона");
  copyDir(from, target, (name) => name !== "template.json");
  const vars: Record<string, string> = {
    __ID__: opts.id,
    __NAME__: opts.name,
    __ICON__: opts.icon || "✨",
    __DESCRIPTION__: opts.description || "",
  };
  walk(target, (file) => {
    if (!/\.(tsx?|json|md|css)$/.test(file)) return;
    let text = fs.readFileSync(file, "utf8");
    // В JSON экранируем, в markdown подставляем как есть, из кода убираем символы, ломающие синтаксис.
    const esc = (v: string) =>
      file.endsWith(".json") ? JSON.stringify(v).slice(1, -1) : file.endsWith(".md") ? v : v.replace(/[{}<>"`\\]/g, "");
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(k, esc(v));
    fs.writeFileSync(file, text);
  });
  writeSource(target, { type: "created" });
  ensureModuleFiles(target, opts.name);
  await snapshot(opts.id, target, "create", "Создан из шаблона").catch(logHistoryError);
  await afterChange(opts.id);
  return opts.id;
}

/**
 * Своя версия модуля. Если оригинал установлен из git или встроенный, форк
 * продолжает следить за обновлениями автора и получает их со слиянием правок.
 */
export async function forkModule(id: string, opts: { newId: string; name?: string; copyData?: boolean }, db: DatabaseSync) {
  const src = getEntry(id);
  if (!src.manifest) throw new HubError("Нельзя форкнуть модуль с ошибкой в манифесте");
  if (!MODULE_ID_RE.test(opts.newId)) throw new HubError("Недопустимый id");
  const target = path.join(MODULES_DIR, opts.newId);
  if (fs.existsSync(target)) throw new HubError(`Модуль "${opts.newId}" уже существует`, 409);
  await snapshot(id, src.dir, "edit").catch(logHistoryError);
  copyDir(src.dir, target);
  writeManifest(target, {
    id: opts.newId,
    name: opts.name || `${src.manifest.name} (моя версия)`,
    forkedFrom: `${src.manifest.author ?? "local"}/${src.manifest.id}@${src.manifest.version}`,
  });
  const origin = readSource(src.dir);
  if (origin && (origin.type === "git" || origin.type === "builtin")) {
    // Сохраняем связь с автором: версия и база те же, что у оригинала.
    fs.writeFileSync(
      path.join(target, ".lifehub-source.json"),
      JSON.stringify({ ...origin, forkOf: id, pending: undefined, installedAt: new Date().toISOString() }, null, 2),
    );
  } else {
    writeSource(target, { type: "fork", from: id });
  }
  await cloneHistory(id, opts.newId).catch(logHistoryError);
  await snapshot(opts.newId, target, "create", `Своя версия модуля «${src.manifest.name}»`).catch(logHistoryError);
  if (opts.copyData) {
    for (const t of ["records", "kv", "files"]) {
      const cols = t === "records" ? "collection, id, data, created_at, updated_at" : t === "kv" ? "key, value, updated_at" : "id, name, mime, size, created_at";
      db.prepare(`INSERT OR IGNORE INTO ${t} (module, ${cols}) SELECT ?, ${cols} FROM ${t} WHERE module = ?`).run(opts.newId, id);
    }
  }
  await afterChange(opts.newId);
  return opts.newId;
}

function moveToTrash(id: string) {
  const dir = path.join(MODULES_DIR, id);
  const dest = path.join(TRASH_DIR, `${id}-${Date.now()}`);
  fs.renameSync(dir, dest);
  return dest;
}

/** Удаление: папка уходит в корзину (~/.lifehub/trash), данные — по желанию. */
export async function removeModule(id: string, purgeData: boolean) {
  getEntry(id);
  const dest = moveToTrash(id);
  if (purgeData) purgeModuleData(id);
  const s = getSettings();
  updateSettings({
    disabled: s.disabled.filter((x) => x !== id),
    order: s.order.filter((x) => x !== id),
    autoUpdate: s.autoUpdate.filter((x) => x !== id),
  });
  updates.delete(id);
  await afterChange();
  return dest;
}

export async function setEnabled(id: string, enabled: boolean) {
  getEntry(id);
  const s = getSettings();
  const disabled = new Set(s.disabled);
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  updateSettings({ disabled: [...disabled] });
  emit({ type: "modules" });
  if (enabled) await rebuild(id);
  await rebuildCss();
}

/* ───────────────────────── экспорт ───────────────────────── */

export function exportZip(id: string): Uint8Array {
  const e = getEntry(id);
  const files: Record<string, Uint8Array> = {};
  walk(e.dir, (file) => {
    files[`${id}/${posix(path.relative(e.dir, file))}`] = fs.readFileSync(file);
  });
  return zipSync(files, { level: 6 });
}

export function isLocallyModified(id: string): boolean {
  const e = getEntry(id);
  const src = readSource(e.dir);
  return !src || src.contentHash !== contentHash(e.dir);
}

/* ───────────────────────── история версий ───────────────────────── */

function logHistoryError(e: unknown): null {
  console.error("[history]", (e as Error).message ?? e);
  return null;
}

const snapshotTimers = new Map<string, NodeJS.Timeout>();

/** После удачной сборки сохраняем версию (с паузой, чтобы серия правок стала одной версией). */
function scheduleSnapshot(id: string) {
  clearTimeout(snapshotTimers.get(id));
  snapshotTimers.set(
    id,
    setTimeout(() => {
      snapshotTimers.delete(id);
      const e = entries.get(id);
      if (!e || !e.build?.ok) return;
      snapshot(id, e.dir, "edit")
        .then(() => emit({ type: "history", id }))
        .catch(logHistoryError);
    }, 4000),
  );
}

/**
 * При запуске: у каждого модуля есть история, изменения, сделанные пока хаб был
 * выключен, сохраняются. Для установленных модулей без базы (старые установки)
 * база появляется, если модуль ещё не меняли.
 */
export async function initHistory() {
  if (!(await gitAvailable())) {
    console.log("[history] git не найден — история версий и слияние обновлений отключены");
    return;
  }
  for (const e of [...entries.values()]) {
    try {
      const sha = await snapshot(e.id, e.dir, "start", "Состояние при запуске хаба");
      const src = readSource(e.dir);
      if (sha && src && !src.base && (src.type === "git" || src.type === "builtin") && src.contentHash === contentHash(e.dir)) {
        patchSource(e.dir, { base: sha });
      }
    } catch (err) {
      logHistoryError(err);
    }
  }
}

export async function versions(id: string) {
  const e = getEntry(id);
  return { available: await gitAvailable(), versions: await listVersions(id, e.dir) };
}

export async function version(id: string, sha: string) {
  return versionDetails(id, getEntry(id).dir, sha);
}

export async function restore(id: string, sha: string) {
  const e = getEntry(id);
  const list = await listVersions(id, e.dir);
  const v = list.find((x) => x.sha === sha);
  if (!v) throw new HubError("Такой версии нет в истории");
  const label = `${new Date(v.date).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — ${v.message}`;
  await restoreVersion(id, e.dir, sha, label);
  await afterChange(id);
  emit({ type: "history", id });
}

/* ───────────────────────── обновления от автора ───────────────────────── */

export interface UpdateInfo {
  id: string;
  stagingId: string;
  currentVersion: string;
  newVersion: string;
  /** Сообщения коммитов автора с момента установленной версии. */
  changes: string[];
  localModified: boolean;
  checkedAt: number;
}

const updates = new Map<string, UpdateInfo>();
export const getUpdate = (id: string) => updates.get(id) ?? null;

function upstreamOf(src: SourceInfo | null): InstallSource | null {
  if (!src) return null;
  if (src.type === "git" && src.url) return { type: "git", url: src.url };
  if (src.type === "builtin" && src.from) return { type: "builtin", id: src.from };
  return null;
}

/** Проверяет, выпустил ли автор новую версию. null — обновлений нет. */
export async function checkUpdate(id: string, opts: { quiet?: boolean } = {}): Promise<UpdateInfo | null> {
  const e = getEntry(id);
  const src = readSource(e.dir);
  const upstream = upstreamOf(src);
  if (!src || !upstream) {
    if (opts.quiet) return null;
    throw new HubError("Этот модуль не связан с автором: обновления есть только у модулей из git и встроенных");
  }
  // Быстрая проверка: если коммит в репозитории автора не менялся — качать нечего.
  if (upstream.type === "git" && src.commit) {
    const [url] = upstream.url.split("#");
    try {
      const { stdout } = await run("git", ["ls-remote", "--", url, "HEAD"], { timeout: 30000 });
      if (stdout.split(/\s/)[0] === src.commit) {
        updates.delete(id);
        return null;
      }
    } catch {}
  }
  const staged = await stage(upstream);
  const hash = contentHash(staged.dir);
  if (hash === src.contentHash) {
    dropStaged(staged.stagingId);
    if (staged.meta.commit && staged.meta.commit !== src.commit) patchSource(e.dir, { commit: staged.meta.commit });
    updates.delete(id);
    return null;
  }
  const changes: string[] = [];
  for (const c of staged.meta.log ?? []) {
    if (c.sha === src.commit) break;
    changes.push(c.subject);
  }
  const prev = updates.get(id);
  if (prev) dropStaged(prev.stagingId);
  const info: UpdateInfo = {
    id,
    stagingId: staged.stagingId,
    currentVersion: src.version,
    newVersion: staged.manifest.version,
    changes: changes.slice(0, 30),
    localModified: isLocallyModified(id),
    checkedAt: Date.now(),
  };
  updates.set(id, info);
  return info;
}

let checking: Promise<void> | null = null;

/** Проверка всех модулей (при запуске и каждые несколько часов). Автообновление — по флагу модуля. */
export function checkAllUpdates(): Promise<void> {
  checking ??= (async () => {
    for (const e of [...entries.values()]) {
      try {
        const info = await checkUpdate(e.id, { quiet: true });
        if (info && getSettings().autoUpdate.includes(e.id)) {
          const r = await applyUpdate(e.id, { auto: true });
          console.log(`[updates] ${e.id}: ${r.mode === "conflict" ? "есть конфликт, ждёт ручного обновления" : `обновлён до v${info.newVersion}`}`);
        }
      } catch (err) {
        console.error(`[updates] ${e.id}:`, (err as Error).message);
      }
    }
    emit({ type: "modules" });
  })().finally(() => {
    checking = null;
  });
  return checking;
}

export function scheduleUpdateChecks() {
  setTimeout(() => checkAllUpdates(), 20_000);
  setInterval(() => checkAllUpdates(), 6 * 3600_000);
}

export type ApplyResult =
  | { mode: "replaced" | "merged"; version: string; ok: boolean; errors: string[] }
  | { mode: "conflict"; version: string; conflicts: string[]; path: string };

/**
 * Обновляет модуль до версии автора.
 *  - модуль не меняли → просто заменяем (данные остаются);
 *  - меняли → трёхстороннее слияние: правки пользователя + изменения автора;
 *  - при конфликте → новая версия кладётся в .upstream/, объединяет Claude Code.
 */
export async function applyUpdate(id: string, opts: { auto?: boolean } = {}): Promise<ApplyResult> {
  const e = getEntry(id);
  let info = updates.get(id) ?? null;
  if (!info || !fs.existsSync(path.join(STAGING_DIR, info.stagingId, "meta.json"))) info = await checkUpdate(id);
  if (!info) throw new HubError("Обновлений нет — у вас последняя версия");
  const meta = readStaged(info.stagingId);
  const src = readSource(e.dir)!;
  const newVersion = readManifest(meta.dir).version;

  if (!isLocallyModified(id)) {
    await confirmInstall(info.stagingId, { id, replace: true, kind: "update" });
    if (src.forkOf) patchSource(path.join(MODULES_DIR, id), { forkOf: src.forkOf });
    const b = await getBuild(id);
    return { mode: "replaced", version: newVersion, ok: b.ok, errors: b.errors };
  }

  const pristineHash = contentHash(meta.dir);
  const oursFile = path.join(e.dir, "lifehub.json");
  const oursText = fs.readFileSync(oursFile, "utf8");
  const canMerge = !!src.base && (await gitAvailable()) && (await hasCommit(id, src.base));

  if (canMerge) {
    // lifehub.json сливаем по полям (id, имя, свои зависимости пользователя + новая версия автора),
    // чтобы git не спотыкался о соседние строки.
    const baseManifest = JSON.parse((await showFile(id, src.base!, "lifehub.json")) ?? "{}");
    const merged = mergeManifest(baseManifest, JSON.parse(oursText), JSON.parse(fs.readFileSync(path.join(meta.dir, "lifehub.json"), "utf8")));
    const mergedText = JSON.stringify(merged, null, 2) + "\n";
    fs.writeFileSync(oursFile, mergedText);
    fs.writeFileSync(path.join(meta.dir, "lifehub.json"), mergedText);

    keepLocalFiles(e.dir, meta.dir);
    const theirs = await commitUpstream(id, e.dir, meta.dir, src.base!, `Версия автора v${newVersion}`);
    const r = await mergeUpstream(id, e.dir, src.base!, theirs, `Обновление до v${newVersion} с вашими правками`);
    if (r.clean) {
      patchSource(e.dir, { base: theirs, commit: meta.commit ?? src.commit, version: newVersion, contentHash: pristineHash, pending: undefined });
      dropStaged(info.stagingId);
      updates.delete(id);
      await afterChange(id);
      emit({ type: "history", id });
      const b = await getBuild(id);
      return { mode: "merged", version: newVersion, ok: b.ok, errors: b.errors };
    }
    fs.writeFileSync(oursFile, oursText);
    if (opts.auto) return { mode: "conflict", version: newVersion, conflicts: r.conflicts, path: "" };
    return handOver(id, e.dir, meta, info, { base: theirs, commit: meta.commit, version: newVersion, contentHash: pristineHash }, r.conflicts);
  }

  if (opts.auto) return { mode: "conflict", version: newVersion, conflicts: [], path: "" };
  const theirs = (await gitAvailable()) ? await commitUpstream(id, e.dir, meta.dir, null, `Версия автора v${newVersion}`).catch(() => undefined) : undefined;
  return handOver(id, e.dir, meta, info, { base: theirs, commit: meta.commit, version: newVersion, contentHash: pristineHash }, []);
}

/** Автоматически слить не вышло: версия автора кладётся рядом, объединяет Claude Code. */
function handOver(id: string, dir: string, meta: StageMeta, info: UpdateInfo, pending: NonNullable<SourceInfo["pending"]>, conflicts: string[]): ApplyResult {
  const up = path.join(dir, ".upstream");
  fs.rmSync(up, { recursive: true, force: true });
  copyDir(meta.dir, up);
  patchSource(dir, { pending });
  dropStaged(info.stagingId);
  updates.delete(id);
  emit({ type: "modules" });
  return { mode: "conflict", version: pending.version, conflicts, path: up };
}

/** После ручного объединения (Claude Code): версия автора становится базой. */
export async function markMerged(id: string) {
  const e = getEntry(id);
  const src = readSource(e.dir);
  fs.rmSync(path.join(e.dir, ".upstream"), { recursive: true, force: true });
  if (src?.pending) {
    const { pending } = src;
    // Если пользователь сам не менял номер версии — ставим версию автора.
    if (readManifest(e.dir).version === src.version) writeManifest(e.dir, { version: pending.version });
    patchSource(e.dir, { ...pending, pending: undefined });
    await recordMerge(id, e.dir, pending.base, `Обновление до v${pending.version} (объединено вручную)`).catch(logHistoryError);
  }
  updates.delete(id);
  emit({ type: "history", id });
  emit({ type: "modules" });
}

export async function setAutoUpdate(id: string, enabled: boolean) {
  getEntry(id);
  const set = new Set(getSettings().autoUpdate);
  if (enabled) set.add(id);
  else set.delete(id);
  updateSettings({ autoUpdate: [...set] });
  emit({ type: "modules" });
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Трёхстороннее слияние JSON манифеста по полям. */
export function mergeManifest(base: Record<string, unknown>, ours: Record<string, unknown>, theirs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(base)])];
  for (const k of keys) {
    const b = base[k], o = ours[k], t = theirs[k];
    let v: unknown;
    if (same(o, b)) v = t;
    else if (same(t, b)) v = o;
    else if (k === "version") v = t;
    else if (isObj(o) || isObj(t)) v = mergeManifest(isObj(b) ? b : {}, isObj(o) ? o : {}, isObj(t) ? t : {});
    else if (Array.isArray(o) || Array.isArray(t)) v = [...new Set([...(Array.isArray(o) ? o : []), ...(Array.isArray(t) ? t : [])])];
    else v = o;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/* ───────────────────────── утилиты ───────────────────────── */

function walk(dir: string, fn: (file: string) => void) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(d.name)) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, fn);
    else fn(p);
  }
}

function countFiles(dir: string) {
  let n = 0;
  walk(dir, () => n++);
  return n;
}

export function contentHash(dir: string): string {
  const files: string[] = [];
  walk(dir, (f) => files.push(f));
  const h = crypto.createHash("sha1");
  for (const f of files.sort()) {
    const rel = posix(path.relative(dir, f));
    if (rel === "CLAUDE.md" || rel === ".gitignore") continue;
    h.update(rel);
    h.update(fs.readFileSync(f));
  }
  return h.digest("hex");
}

function copyDir(from: string, to: string, filter: (name: string) => boolean = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const d of fs.readdirSync(from, { withFileTypes: true })) {
    if (IGNORED.has(d.name) || !filter(d.name)) continue;
    const a = path.join(from, d.name);
    const b = path.join(to, d.name);
    if (d.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}
