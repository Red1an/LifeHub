import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { HOME } from "./paths.ts";

/*
 * История версий модулей.
 *
 * Для каждого модуля хаб ведёт отдельный git-репозиторий в ~/.lifehub/history/<id>.git,
 * рабочая папка которого — папка модуля. Собственный .git модуля (если автор держит
 * его в git) не затрагивается. После каждой удачной сборки сохраняется версия —
 * поэтому в истории лежат только работающие состояния, и к любому можно вернуться.
 *
 * Эта же история используется для обновлений: версия автора, от которой пользователь
 * начал свои правки (base), позволяет сливать обновления автора с правками пользователя.
 */

export const HISTORY_DIR = path.join(HOME, "history");

const EXCLUDE = ["node_modules/", ".out/", ".upstream/", "tsconfig.json", ".lifehub-source.json", ".DS_Store", "Thumbs.db"];

export class HistoryError extends Error {}

let gitOk: boolean | null = null;

export async function gitAvailable(): Promise<boolean> {
  if (gitOk === null) {
    gitOk = await new Promise((r) => execFile("git", ["--version"], (err) => r(!err)));
  }
  return gitOk === true;
}

const gitDirOf = (id: string) => path.join(HISTORY_DIR, `${id}.git`);

interface GitOpts {
  env?: Record<string, string>;
  allowFail?: boolean;
}

function run(args: string[], opts: GitOpts = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "user.name=LifeHub", "-c", "user.email=lifehub@localhost", "-c", "core.autocrlf=false", "-c", "core.quotepath=false", "-c", "commit.gpgsign=false", ...args],
      { env: { ...process.env, ...opts.env }, maxBuffer: 50 * 1024 * 1024, windowsHide: true },
      (err, out, stderr) => {
        const code = err ? ((err as any).code ?? 1) : 0;
        if (err && !opts.allowFail) reject(new HistoryError(`git ${args.find((a) => !a.startsWith("-")) ?? ""}: ${(stderr || err.message).trim()}`));
        else resolve({ code: typeof code === "number" ? code : 1, out: String(out), err: String(stderr) });
      },
    );
  });
}

/** git для модуля: история в HISTORY_DIR, рабочая папка — папка модуля. */
function git(id: string, dir: string, args: string[], opts?: GitOpts) {
  return run(["--git-dir", gitDirOf(id), "--work-tree", dir, ...args], opts);
}

/** Операции с одним модулем выполняются строго по очереди. */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(id, next);
  return next;
}

async function ensureRepo(id: string, dir: string) {
  const gd = gitDirOf(id);
  if (!fs.existsSync(path.join(gd, "HEAD"))) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    await run(["init", "--quiet", "--bare", "--initial-branch=main", gd]);
    await run(["--git-dir", gd, "config", "core.bare", "false"]);
  }
  fs.mkdirSync(path.join(gd, "info"), { recursive: true });
  fs.writeFileSync(path.join(gd, "info", "exclude"), EXCLUDE.join("\n") + "\n");
  return gd;
}

export interface Version {
  sha: string;
  date: number;
  message: string;
  kind: string;
}

/**
 * Сохраняет текущее состояние модуля. Возвращает sha новой версии
 * или текущую (если изменений нет).
 * kind — тип события: edit, install, update, merge, restore, create, start.
 */
export function snapshot(id: string, dir: string, kind: string, message?: string): Promise<string | null> {
  return serial(id, async () => {
    if (!(await gitAvailable())) return null;
    await ensureRepo(id, dir);
    await git(id, dir, ["add", "-A", "."]);
    const hasHead = (await git(id, dir, ["rev-parse", "--verify", "-q", "HEAD"], { allowFail: true })).code === 0;
    if (hasHead) {
      const diff = await git(id, dir, ["diff", "--cached", "--quiet"], { allowFail: true });
      if (diff.code === 0) return (await git(id, dir, ["rev-parse", "HEAD"])).out.trim();
    }
    let msg = message;
    if (!msg) {
      const files = (await git(id, dir, ["diff", "--cached", "--name-only", ...(hasHead ? [] : ["--root"])], { allowFail: true })).out
        .trim()
        .split("\n")
        .filter(Boolean);
      msg = files.length ? `Изменено: ${files.slice(0, 3).join(", ")}${files.length > 3 ? ` и ещё ${files.length - 3}` : ""}` : "Изменения";
    }
    await git(id, dir, ["commit", "--quiet", "--allow-empty-message", "-m", msg, "-m", `lifehub-kind: ${kind}`]);
    return (await git(id, dir, ["rev-parse", "HEAD"])).out.trim();
  });
}

export async function listVersions(id: string, dir: string, limit = 100): Promise<Version[]> {
  if (!(await gitAvailable()) || !fs.existsSync(path.join(gitDirOf(id), "HEAD"))) return [];
  const r = await git(id, dir, ["log", `-n${limit}`, "--first-parent", "--format=%H%x1f%ct%x1f%s%x1f%b%x1e"], { allowFail: true });
  if (r.code !== 0) return [];
  return r.out
    .split("\x1e")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ct, subject, body] = line.split("\x1f");
      return { sha, date: Number(ct) * 1000, message: subject, kind: /lifehub-kind: (\w+)/.exec(body ?? "")?.[1] ?? "edit" };
    });
}

export interface VersionDetails {
  sha: string;
  files: { status: string; path: string }[];
  patch: string;
  truncated: boolean;
}

export async function versionDetails(id: string, dir: string, sha: string): Promise<VersionDetails> {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new HistoryError("Неверная версия");
  const names = await git(id, dir, ["show", "--first-parent", "--format=", "--name-status", "--root", sha]);
  const files = names.out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [status, ...p] = l.split("\t");
      return { status: status[0], path: p[p.length - 1] };
    });
  const patch = await git(id, dir, ["show", "--first-parent", "--format=", "--root", "--no-color", "-U2", sha]);
  const LIMIT = 150_000;
  return { sha, files, patch: patch.out.slice(0, LIMIT), truncated: patch.out.length > LIMIT };
}

/** Возвращает модуль к версии sha. Текущее состояние перед этим тоже сохраняется. */
export async function restoreVersion(id: string, dir: string, sha: string, label: string) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new HistoryError("Неверная версия");
  await snapshot(id, dir, "edit", "Перед откатом");
  await serial(id, async () => {
    await git(id, dir, ["cat-file", "-e", `${sha}^{commit}`]);
    // Рабочая папка и индекс становятся ровно такими, как в версии sha (лишние отслеживаемые файлы удаляются).
    await git(id, dir, ["read-tree", "-u", "--reset", sha]);
  });
  return snapshot(id, dir, "restore", `Возврат к версии: ${label}`);
}

/* ───────────── слияние обновлений автора с правками пользователя ───────────── */

/** Коммит с содержимым папки upstreamDir поверх базовой версии автора. */
export async function commitUpstream(id: string, dir: string, upstreamDir: string, base: string | null, message: string): Promise<string> {
  return serial(id, async () => {
    await ensureRepo(id, dir);
    const tmpIndex = path.join(gitDirOf(id), `index-upstream-${Date.now()}`);
    try {
      const env = { GIT_INDEX_FILE: tmpIndex };
      await run(["--git-dir", gitDirOf(id), "--work-tree", upstreamDir, "add", "-A", "."], { env });
      const tree = (await run(["--git-dir", gitDirOf(id), "write-tree"], { env })).out.trim();
      const args = ["--git-dir", gitDirOf(id), "commit-tree", tree, "-m", message, "-m", "lifehub-kind: upstream"];
      if (base) args.push("-p", base);
      const sha = (await run(args)).out.trim();
      // Держим ссылку, чтобы версия автора не потерялась при сборке мусора.
      await run(["--git-dir", gitDirOf(id), "update-ref", `refs/upstream/${sha.slice(0, 12)}`, sha]);
      return sha;
    } finally {
      fs.rmSync(tmpIndex, { force: true });
    }
  });
}

export interface MergeResult {
  clean: boolean;
  conflicts: string[];
  sha?: string;
}

/**
 * Трёхстороннее слияние: текущая версия пользователя + новая версия автора (theirs),
 * общий предок — версия автора, с которой пользователь начинал (base у theirs родитель).
 * Если конфликтов нет — рабочая папка модуля обновляется, иначе ничего не меняется.
 */
export async function mergeUpstream(id: string, dir: string, base: string, theirs: string, label: string): Promise<MergeResult> {
  const ours = await snapshot(id, dir, "edit", "Перед обновлением");
  if (!ours) throw new HistoryError("История недоступна (нет git)");
  return serial(id, async () => {
    // Общий предок задаём явно: это версия автора, от которой пользователь вёл свои правки.
    const r = await git(id, dir, ["merge-tree", "--write-tree", "--name-only", "--messages", `--merge-base=${base}`, ours, theirs], { allowFail: true });
    const lines = r.out.split("\n");
    const tree = lines[0]?.trim();
    if (r.code === 1) {
      const conflicts: string[] = [];
      for (const l of lines.slice(1)) {
        if (!l.trim()) break;
        conflicts.push(l.trim());
      }
      return { clean: false, conflicts };
    }
    if (r.code !== 0 || !/^[0-9a-f]{40}$/.test(tree)) throw new HistoryError(`Не удалось слить изменения: ${r.err.trim() || r.out.trim()}`);
    await git(id, dir, ["read-tree", "-u", "--reset", tree]);
    const sha = (
      await run(["--git-dir", gitDirOf(id), "commit-tree", tree, "-p", ours, "-p", theirs, "-m", label, "-m", "lifehub-kind: update"])
    ).out.trim();
    await git(id, dir, ["update-ref", "HEAD", sha]);
    return { clean: true, conflicts: [], sha };
  });
}

/**
 * Фиксирует ручное объединение (после Claude Code): текущее состояние становится
 * слиянием с версией автора theirs — дальше обновления считаются от неё.
 */
export async function recordMerge(id: string, dir: string, theirs: string | undefined, message: string) {
  const head = await snapshot(id, dir, "edit", "Объединение с версией автора");
  if (!head || !theirs || !(await hasCommit(id, theirs))) return head;
  return serial(id, async () => {
    const tree = (await git(id, dir, ["rev-parse", "HEAD^{tree}"])).out.trim();
    const sha = (await run(["--git-dir", gitDirOf(id), "commit-tree", tree, "-p", head, "-p", theirs, "-m", message, "-m", "lifehub-kind: update"])).out.trim();
    await git(id, dir, ["update-ref", "HEAD", sha]);
    return sha;
  });
}

/** Копия истории для форка: форк знает ту же версию автора и может получать обновления. */
export async function cloneHistory(fromId: string, toId: string) {
  if (!(await gitAvailable())) return;
  const src = gitDirOf(fromId);
  if (!fs.existsSync(path.join(src, "HEAD"))) return;
  const dst = gitDirOf(toId);
  fs.rmSync(dst, { recursive: true, force: true });
  await run(["clone", "--quiet", "--bare", "--no-hardlinks", src, dst]);
  await run(["--git-dir", dst, "config", "core.bare", "false"]);
  // Ветки upstream-версий тоже нужны форку.
  await run(["--git-dir", dst, "fetch", "--quiet", src, "refs/upstream/*:refs/upstream/*"], { allowFail: true });
  // Индекс форка должен совпадать с HEAD, иначе первая версия покажет «всё изменено».
  await run(["--git-dir", dst, "read-tree", "HEAD"], { allowFail: true });
}

export async function hasCommit(id: string, sha: string): Promise<boolean> {
  if (!/^[0-9a-f]{40}$/.test(sha)) return false;
  return (await run(["--git-dir", gitDirOf(id), "cat-file", "-e", `${sha}^{commit}`], { allowFail: true })).code === 0;
}

/** Содержимое файла в версии sha (или null). */
export async function showFile(id: string, sha: string, file: string): Promise<string | null> {
  const r = await run(["--git-dir", gitDirOf(id), "show", `${sha}:${file}`], { allowFail: true });
  return r.code === 0 ? r.out : null;
}

export function removeHistory(id: string) {
  const gd = gitDirOf(id);
  if (fs.existsSync(gd)) fs.renameSync(gd, `${gd}.removed-${Date.now()}`);
}

/** Для git-источников: запуск git без привязки к модулю (clone, ls-remote, log). */
export const plainGit = run;
