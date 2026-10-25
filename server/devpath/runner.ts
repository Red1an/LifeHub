import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/*
 * Проверка миссий и кат DevPath тестами: копирование заготовки в рабочую папку, `dotnet test`, разбор результата.
 * Без базы и событий хаба — этот же код гоняет `node server/devpath/verify.ts` (проверка самих миссий).
 *
 * Миссия — папка `missions/<id>` модуля devpath:
 *   starter/   — проект, который получает ученик (копируется один раз, дальше папка его);
 *   tests/     — тесты хаба: перед каждой проверкой кладутся в <рабочая папка>/tests заново, чтобы их не «подогнать»;
 *   solution/  — эталон: файлы поверх starter, с которыми все тесты проходят (только для verify.ts).
 * Ката — папка `katas/<id>`: kata.md (условие, заготовка, эталон) и Tests.cs; код ученика приходит текстом.
 */

export interface TestCase {
  name: string;
  ok: boolean;
  message?: string;
  /** Сборка с тестом (Hub.Tests — тесты хаба, остальное — тесты ученика). */
  source?: string;
}

export interface BuildError {
  file: string;
  line: number;
  code: string;
  message: string;
}

export interface RunResult {
  /** Сборка прошла и все тесты зелёные. */
  ok: boolean;
  /** Проект собрался (иначе тестов нет, есть ошибки сборки). */
  built: boolean;
  passed: number;
  total: number;
  tests: TestCase[];
  errors: BuildError[];
  /** Хвост вывода — когда ничего не разобрали. */
  output?: string;
  ms: number;
}

const MAX_OUTPUT = 4000;
const RUN_TIMEOUT_MS = 4 * 60_000;
/** Весь прогон тестов проекта: на поздних этапах это сотня тестов с браузером, Kafka и остановкой брокера. */
const TEST_TIMEOUT_MS = 15 * 60_000;

export function copyDir(src: string, dst: string) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === "bin" || e.name === "obj") continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else copyFresh(s, d);
  }
}

/** Копия со свежей датой: Windows сохраняет дату исходника, и MSBuild считал бы файл неизменённым. */
function copyFresh(src: string, dst: string) {
  fs.copyFileSync(src, dst);
  const now = new Date();
  fs.utimesSync(dst, now, now);
}

export function exec(cmd: string, args: string[], cwd: string, timeoutMs = RUN_TIMEOUT_MS, env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1", DOTNET_CLI_UI_LANGUAGE: "ru", ...env },
    });
    let out = "";
    const add = (b: Buffer) => {
      out += b.toString("utf8");
      if (out.length > 400_000) out = out.slice(-200_000);
    };
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    let done = false;
    const finish = (code: number, extra = "") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out: out + extra });
    };
    const timer = setTimeout(() => {
      out += "\n[хаб] Прогон занял слишком много времени и остановлен — нет ли бесконечного цикла или зависшего теста?";
      // dotnet test запускает дочерние testhost: на Windows убиваем всё дерево, иначе они держат вывод и «close» не придёт.
      if (process.platform === "win32" && p.pid) spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true });
      else p.kill("SIGKILL");
      setTimeout(() => finish(-1), 5000).unref();
    }, timeoutMs);
    p.on("error", (e) => finish(-1, `\n${e.message}`));
    p.on("close", (code) => finish(code ?? -1));
  });
}

/* ───────────── миссии ───────────── */

export const missionDir = (root: string, id: string) => path.join(root, "missions", id);

export function missionExists(root: string, id: string) {
  return /^[a-z0-9-]{2,60}$/.test(id) && fs.existsSync(path.join(missionDir(root, id), "starter"));
}

/** Первая выдача миссии: заготовка + тесты + git, чтобы потом видеть свой diff. */
export async function prepareMission(root: string, id: string, work: string) {
  if (fs.existsSync(work)) return { created: false };
  const src = missionDir(root, id);
  copyDir(path.join(src, "starter"), work);
  restoreTests(src, work);
  fs.writeFileSync(path.join(work, ".gitignore"), "bin/\nobj/\n.lifehub/\n.vs/\n*.user\n");
  const git = (...a: string[]) => exec("git", ["-c", "user.name=DevPath", "-c", "user.email=devpath@lifehub.local", ...a], work, 60_000);
  if ((await git("init", "-q")).code === 0) {
    await git("add", "-A");
    await git("commit", "-q", "-m", "Старт миссии");
  }
  return { created: true };
}

function restoreTests(src: string, work: string) {
  const tests = path.join(src, "tests");
  if (!fs.existsSync(tests)) return;
  for (const f of listFiles(tests)) {
    const d = path.join(work, "tests", path.relative(tests, f));
    fs.mkdirSync(path.dirname(d), { recursive: true });
    // Не трогаем неизменённые тесты, чтобы сборка оставалась инкрементальной.
    if (!fs.existsSync(d) || !fs.readFileSync(d).equals(fs.readFileSync(f))) copyFresh(f, d);
  }
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.name === "bin" || e.name === "obj") return [];
    return e.isDirectory() ? listFiles(p) : [p];
  });
}

export async function runMission(root: string, id: string, work: string): Promise<RunResult> {
  restoreTests(missionDir(root, id), work);
  return dotnetTest(work);
}

/** Что изменил ученик с начала миссии (для ревью наставником). Без тестов хаба. */
/** Изменения с начала работы (или с коммита since — например, снимка начала этапа). Без тестов хаба и сгенерированного. */
export async function missionDiff(work: string, hubDir = "tests", since?: string) {
  const first = (await exec("git", ["rev-list", "--max-parents=0", "HEAD"], work, 30_000)).out.trim().split("\n")[0];
  const base = since && /^[0-9a-f]{7,40}$/.test(since) ? since : first;
  if (!/^[0-9a-f]{7,40}$/.test(base)) return "";
  await exec("git", ["add", "-A", "-N"], work, 30_000);
  const exclude = [hubDir, "**/package-lock.json", "**/node_modules/**", "**/dist/**", "**/bin/**", "**/obj/**"].map((p) => `:(exclude)${p}`);
  const { out } = await exec("git", ["-c", "core.quotepath=off", "diff", base, "--", ".", ...exclude], work, 30_000);
  return out.length > 40_000 ? `${out.slice(0, 40_000)}\n… (diff обрезан)` : out;
}

/** Снимок рабочей папки коммитом (начало этапа): от него считается diff этапа для ревью и защиты. */
export async function snapshot(work: string, message: string) {
  const git = (...a: string[]) => exec("git", ["-c", "user.name=DevPath", "-c", "user.email=devpath@lifehub.local", ...a], work, 60_000);
  await git("add", "-A");
  await git("commit", "-q", "--allow-empty", "-m", message);
  return (await git("rev-parse", "HEAD")).out.trim();
}

/* ───────────── каты ───────────── */

export const kataDir = (root: string, id: string) => path.join(root, "katas", id);

export function kataExists(root: string, id: string) {
  return /^[a-z0-9-]{2,60}$/.test(id) && fs.existsSync(path.join(kataDir(root, id), "Tests.cs"));
}

const KATA_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
    <NoWarn>CS8618;CS1998</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.1.4" />
  </ItemGroup>
</Project>
`;

/** Один общий проект для всех кат: пакеты восстанавливаются один раз, дальше сборка быстрая. */
export async function runKata(root: string, id: string, code: string, runnerDir: string): Promise<RunResult> {
  fs.mkdirSync(runnerDir, { recursive: true });
  const proj = path.join(runnerDir, "Kata.csproj");
  if (!fs.existsSync(proj) || fs.readFileSync(proj, "utf8") !== KATA_CSPROJ) fs.writeFileSync(proj, KATA_CSPROJ);
  for (const f of fs.readdirSync(runnerDir)) if (f.endsWith(".cs")) fs.rmSync(path.join(runnerDir, f));
  fs.writeFileSync(path.join(runnerDir, "Solution.cs"), code);
  copyFresh(path.join(kataDir(root, id), "Tests.cs"), path.join(runnerDir, "Tests.cs"));
  return dotnetTest(runnerDir);
}

/** Блоки кода из kata.md: `---starter` и `---solution` (для verify.ts). */
export function kataBlocks(md: string) {
  const block = (name: string) => md.replace(/\r\n/g, "\n").match(new RegExp(`^---${name}\\s*\\n+\`\`\`\\w*\\n([\\s\\S]*?)\\n\`\`\``, "m"))?.[1] ?? "";
  return { starter: block("starter"), solution: block("solution") };
}

/* ───────────── проекты ───────────── */

/*
 * Проект — папка `projects/<id>` модуля devpath. Растёт по этапам, ученик пишет его сам:
 *   skeleton/            — каркас (решение, пустой API);
 *   hub/                 — общая часть тестов хаба (проект Hub.Tests, помощники);
 *   infra/               — docker-compose.yml по умолчанию;
 *   stages/NN/stage.md   — текст этапа; во front matter `ownTests: N` — сколько своих тестов нужно;
 *   stages/NN/tests/     — тесты хаба этапа (имена «ЭN.xx …»), в рабочей папке — hub/StageNN/;
 *   stages/NN/infra/     — инфраструктура с этого этапа (если меняется);
 *   stages/NN/solution/  — эталон всего проекта на этом этапе (только для verify.ts).
 * Проверка этапа N гоняет тесты всех этапов 1..N: старое ломать нельзя.
 */

export const projectDir = (root: string, id: string) => path.join(root, "projects", id);

export function projectExists(root: string, id: string) {
  return /^[a-z0-9-]{2,60}$/.test(id) && fs.existsSync(path.join(projectDir(root, id), "skeleton"));
}

const stageDirs = (src: string) =>
  fs.existsSync(path.join(src, "stages")) ? fs.readdirSync(path.join(src, "stages")).filter((d) => /^\d{2}$/.test(d)).sort() : [];

export async function prepareProject(root: string, id: string, work: string) {
  if (fs.existsSync(work)) return { created: false };
  copyDir(path.join(projectDir(root, id), "skeleton"), work);
  syncProject(root, id, work, 1);
  fs.writeFileSync(path.join(work, ".gitignore"), "bin/\nobj/\n.lifehub/\n.vs/\n*.user\nhub/\nnode_modules/\ndist/\n");
  const git = (...a: string[]) => exec("git", ["-c", "user.name=DevPath", "-c", "user.email=devpath@lifehub.local", ...a], work, 60_000);
  if ((await git("init", "-q")).code === 0) {
    await git("add", "-A");
    await git("commit", "-q", "-m", "Каркас проекта");
  }
  return { created: true };
}

/** Тесты хаба для этапов 1..stage и инфраструктура этапа — в рабочую папку. Чужие файлы в hub/ убираются. */
export function syncProject(root: string, id: string, work: string, stage: number) {
  const src = projectDir(root, id);
  const hub = path.join(work, "hub");
  const keep = new Set<string>();
  const put = (from: string, to: string) => {
    keep.add(path.resolve(to));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!fs.existsSync(to) || !fs.readFileSync(to).equals(fs.readFileSync(from))) copyFresh(from, to);
  };
  for (const f of listFiles(path.join(src, "hub"))) put(f, path.join(hub, path.relative(path.join(src, "hub"), f)));
  let infra = path.join(src, "infra");
  for (const d of stageDirs(src)) {
    if (Number(d) > stage) break;
    const tests = path.join(src, "stages", d, "tests");
    if (fs.existsSync(tests)) for (const f of listFiles(tests)) put(f, path.join(hub, `Stage${d}`, path.relative(tests, f)));
    if (fs.existsSync(path.join(src, "stages", d, "infra"))) infra = path.join(src, "stages", d, "infra");
  }
  if (fs.existsSync(hub)) for (const f of listFiles(hub)) if (!keep.has(path.resolve(f))) fs.rmSync(f);
  if (fs.existsSync(infra)) for (const f of listFiles(infra)) put(f, path.join(work, "infra", path.relative(infra, f)));
}

/** Сколько своих тестов нужно на этапе (front matter `ownTests`). */
function ownTestsRequired(root: string, id: string, stage: number) {
  let need = 0;
  for (const d of stageDirs(projectDir(root, id))) {
    if (Number(d) > stage) break;
    const md = path.join(projectDir(root, id), "stages", d, "stage.md");
    const n = fs.existsSync(md) ? Number(fs.readFileSync(md, "utf8").match(/^ownTests:\s*(\d+)/m)?.[1] ?? 0) : 0;
    if (n) need = n;
  }
  return need;
}

/** docker compose up для инфраструктуры проекта. null — всё поднялось, иначе текст ошибки. */
export async function infraUp(work: string): Promise<string | null> {
  const compose = path.join(work, "infra", "docker-compose.yml");
  if (!fs.existsSync(compose)) return null;
  const ping = await exec("docker", ["version", "--format", "{{.Server.Version}}"], work, 20_000);
  if (ping.code !== 0) return "Docker не запущен. Открой Docker Desktop, дождись «Engine running» и проверь ещё раз.";
  const up = await exec("docker", ["compose", "-f", compose, "up", "-d", "--wait"], work, 10 * 60_000);
  return up.code === 0 ? null : `Инфраструктура не поднялась:\n${up.out.slice(-1500)}`;
}

export async function runProject(root: string, id: string, work: string, stage: number): Promise<RunResult & { infraError?: string }> {
  syncProject(root, id, work, stage);
  const infraError = await infraUp(work);
  if (infraError) return { ok: false, built: false, passed: 0, total: 0, tests: [], errors: [], output: infraError, ms: 0, infraError };
  const web = await buildWeb(work);
  if (web) return web;
  const r = await dotnetTest(work);
  const need = ownTestsRequired(root, id, stage);
  if (need > 0 && r.built) {
    const own = r.tests.filter((t) => t.source && t.source !== "Hub.Tests");
    const passed = own.filter((t) => t.ok).length;
    const ok = own.length >= need && passed === own.length;
    r.tests.push({
      name: `Свои unit-тесты: ${passed} зелёных из ${own.length}, нужно не меньше ${need}`,
      ok,
      source: "Hub.Tests",
      message: ok ? undefined : own.length < need ? "Напиши свои тесты в tests/Exchange.Tests и добавь проект в Exchange.slnx." : "Свои тесты должны быть зелёными.",
    });
    r.total++;
    if (ok) r.passed++;
    r.ok = r.built && r.errors.length === 0 && r.passed === r.total;
  }
  return r;
}

/** Адрес API, с которым собирается терминал: тесты хаба поднимают API именно на нём (hub/Web.cs). */
const WEB_API_URL = "http://127.0.0.1:15080";

const npm = (args: string[], cwd: string, env: Record<string, string> = {}) =>
  process.platform === "win32" ? exec("cmd", ["/c", "npm", ...args], cwd, 6 * 60_000, env) : exec("npm", args, cwd, 6 * 60_000, env);

/**
 * Терминал (папка web/, с этапа 5): npm install — только если поменялись зависимости, затем npm run build.
 * null — собралось (или фронтенда ещё нет), иначе результат-ошибка для экрана.
 */
async function buildWeb(work: string): Promise<RunResult | null> {
  const dir = path.join(work, "web");
  if (!fs.existsSync(path.join(dir, "package.json"))) return null;
  const started = Date.now();
  const fail = (title: string, out: string): RunResult => {
    const errors = parseBuildErrors(out, dir).map((e) => ({ ...e, file: `web/${e.file}` }));
    return { ok: false, built: false, passed: 0, total: 0, tests: [], errors, output: errors.length ? undefined : `${title}\n${out.slice(-MAX_OUTPUT)}`, ms: Date.now() - started };
  };
  const stamp = path.join(dir, "node_modules", ".package-lock.json");
  const mtime = (f: string) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0);
  if (!fs.existsSync(stamp) || mtime(path.join(dir, "package.json")) > mtime(stamp) || mtime(path.join(dir, "package-lock.json")) > mtime(stamp)) {
    const install = await npm(["install", "--no-audit", "--no-fund"], dir);
    if (install.code !== 0) return fail("npm install не прошёл:", install.out);
  }
  // Старая сборка не должна «пройти» тесты, если новая не собралась.
  fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true });
  const build = await npm(["run", "build"], dir, { VITE_API_URL: WEB_API_URL });
  if (build.code !== 0) return fail("npm run build не прошёл:", build.out);
  return null;
}

/* ───────────── dotnet test ───────────── */

async function dotnetTest(dir: string): Promise<RunResult> {
  const started = Date.now();
  const results = path.join(dir, ".lifehub", "results");
  fs.rmSync(results, { recursive: true, force: true });
  // --blame-hang-timeout: зависший тест vstest остановит сам и назовёт его в выводе, а прогон не повиснет целиком.
  // С запасом: самые долгие тесты (падение брокера) честно идут пару минут.
  const { out } = await exec("dotnet", ["test", "--logger", "trx", "--results-directory", results, "--blame-hang-timeout", "5m"], dir, TEST_TIMEOUT_MS);
  const ms = Date.now() - started;
  const trx = fs.existsSync(results) ? fs.readdirSync(results).filter((f) => f.endsWith(".trx")) : [];
  const tests = trx.flatMap((f) => parseTrx(fs.readFileSync(path.join(results, f), "utf8")));
  const errors = parseBuildErrors(out, dir);
  const passed = tests.filter((t) => t.ok).length;
  const built = tests.length > 0;
  return {
    // Ошибка сборки в одном проекте — не зелёный прогон, даже если тесты другого проекта прошли.
    ok: built && errors.length === 0 && passed === tests.length,
    built,
    passed,
    total: tests.length,
    tests,
    errors,
    output: tests.length || errors.length ? undefined : out.slice(-MAX_OUTPUT),
    ms,
  };
}

const unxml = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function parseTrx(xml: string): TestCase[] {
  const storage = new Map<string, string>();
  for (const m of xml.matchAll(/<UnitTest\s[^>]*?storage="([^"]*)"[^>]*?id="([^"]*)"/g)) {
    // В storage путь бывает в нижнем регистре — приводим имя сборки тестов хаба к одному виду.
    const name = path.basename(unxml(m[1]), path.extname(m[1]));
    storage.set(m[2], name.toLowerCase() === "hub.tests" ? "Hub.Tests" : name);
  }
  const out: TestCase[] = [];
  for (const m of xml.matchAll(/<UnitTestResult([^>]*?)(\/>|>([\s\S]*?)<\/UnitTestResult>)/g)) {
    const attrs = m[1];
    const name = unxml(attrs.match(/testName="([^"]*)"/)?.[1] ?? "?");
    const outcome = attrs.match(/outcome="([^"]*)"/)?.[1] ?? "";
    const msg = m[3]?.match(/<Message>([\s\S]*?)<\/Message>/)?.[1];
    const source = storage.get(attrs.match(/testId="([^"]*)"/)?.[1] ?? "");
    out.push({ name, ok: outcome === "Passed", message: msg ? unxml(msg).replace(/\r/g, "").trim().slice(0, 1500) : undefined, source });
  }
  // Порядок как в файле тестов не сохраняется — сортируем, чтобы список не прыгал между прогонами.
  return out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function parseBuildErrors(out: string, dir: string): BuildError[] {
  const seen = new Set<string>();
  const list: BuildError[] = [];
  for (const m of out.matchAll(/^\s*(.+?)\((\d+),\d+\): error ([A-Z]+\d+): (.+?)(?: \[[^\]]+\])?\s*$/gm)) {
    const key = m.slice(1, 5).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ file: path.relative(dir, m[1]).replaceAll("\\", "/"), line: Number(m[2]), code: m[3], message: m[4] });
  }
  return list.slice(0, 30);
}
