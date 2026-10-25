import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as db from "../db.ts";
import { emit, subscribe } from "../events.ts";
import { getEntry } from "../registry.ts";
import { getSettings } from "../settings.ts";
import { exec, kataExists, missionDiff, missionExists, prepareMission, prepareProject, projectExists, runKata, runMission, runProject, snapshot } from "./runner.ts";

/*
 * «Мастерская» DevPath (modules/devpath): миссии — настоящие проекты в папке ~/DevPath/<id>,
 * которые ученик правит в своей IDE, а хаб проверяет тестами. Каты — короткий код из редактора модуля.
 *
 * Связь с модулем — через его данные:
 *  - коллекция "runs": модуль добавляет { kind, mission | project (+ stage) | kata, code? }, хаб выполняет по очереди
 *    и дописывает { status: "running" | "done" | "error", result | path | diff | error }.
 *    kind: start (выдать миссию), check (прогнать тесты), diff (что изменено, since — с какого коммита), open (открыть в VS Code),
 *    snapshot (коммит-снимок начала этапа → commit),
 *    reset (начать заново: старая папка уезжает в ~/DevPath/.old), kata (прогнать кату), env (проверить окружение);
 *  - kv "env" — пишет хаб: рабочая папка, есть ли dotnet / git / VS Code.
 * Формат миссий и кат — server/devpath/runner.ts; проверка их самих — server/devpath/verify.ts.
 */

const MODULE = "devpath";
const RUNS = "runs";
const KEEP_RUNS = 60;
const MAX_CODE = 60_000;

export const WORK_DIR = path.resolve(process.env.LIFEHUB_DEVPATH_DIR || path.join(os.homedir(), "DevPath"));

const changed = (collection: string) => emit({ type: "data", module: MODULE, collection, origin: MODULE });

function moduleRoot(): string | null {
  if (getSettings().disabled.includes(MODULE)) return null;
  try {
    return getEntry(MODULE).dir;
  } catch {
    return null;
  }
}

async function writeEnv() {
  const version = async (cmd: string, args: string[]) => {
    const r = await exec(cmd, args, os.homedir(), 20_000);
    return r.code === 0 ? r.out.trim().split("\n")[0].slice(0, 60) : null;
  };
  const isWin = process.platform === "win32";
  db.setKv(MODULE, "env", {
    dir: WORK_DIR,
    dotnet: await version("dotnet", ["--version"]),
    git: await version("git", ["--version"]),
    code: await version(isWin ? "cmd" : "code", isWin ? ["/c", "code", "--version"] : ["--version"]),
    checkedAt: Date.now(),
  });
  changed("kv:env");
}

/** Открыть папку (или файл на строке) в VS Code на этом компьютере. */
async function openInEditor(work: string, file?: string, line?: number) {
  const args = ["-r", work];
  if (file) {
    const full = path.resolve(work, file);
    if (full.startsWith(work + path.sep) && fs.existsSync(full)) args.push("-g", `${full}:${Math.max(1, line ?? 1)}`);
  }
  const r = process.platform === "win32" ? await exec("cmd", ["/c", "code", ...args], work, 30_000) : await exec("code", args, work, 30_000);
  if (r.code !== 0) throw new Error("Не получилось открыть VS Code — он установлен и есть команда code в PATH?");
}

async function handle(run: db.Doc): Promise<Record<string, unknown>> {
  const root = moduleRoot();
  if (!root) throw new Error("Модуль DevPath выключен");
  const kind = String(run.kind ?? "");
  if (kind === "env") {
    await writeEnv();
    return {};
  }
  if (kind === "kata") {
    const id = String(run.kata ?? "");
    if (!kataExists(root, id)) throw new Error("Нет такой каты");
    const code = String(run.code ?? "");
    if (code.length > MAX_CODE) throw new Error("Слишком длинный код");
    return { result: await runKata(root, id, code, path.join(WORK_DIR, ".kata")) };
  }

  // Миссия или проект: у обоих рабочая папка ~/DevPath/<id>, выдача, проверка и diff.
  const project = typeof run.project === "string";
  const id = String(project ? run.project : run.mission ?? "");
  if (project ? !projectExists(root, id) : !missionExists(root, id)) throw new Error(project ? "Нет такого проекта" : "Нет такой миссии");
  const work = path.join(WORK_DIR, id);
  const prepare = () => (project ? prepareProject(root, id, work) : prepareMission(root, id, work));
  if (kind === "start") {
    await prepare();
    return { path: work };
  }
  if (kind === "reset") {
    if (fs.existsSync(work)) {
      const old = path.join(WORK_DIR, ".old", `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      fs.mkdirSync(path.dirname(old), { recursive: true });
      fs.renameSync(work, old);
    }
    await prepare();
    return { path: work };
  }
  if (!fs.existsSync(work)) await prepare();
  const stage = Math.max(1, Math.min(99, Number(run.stage) || 1));
  if (kind === "check") return { path: work, result: project ? await runProject(root, id, work, stage) : await runMission(root, id, work) };
  if (kind === "diff") return { path: work, diff: await missionDiff(work, project ? "hub" : "tests", typeof run.since === "string" ? run.since : undefined) };
  if (kind === "snapshot") return { path: work, commit: await snapshot(work, String(run.message ?? "Снимок DevPath").slice(0, 200)) };
  if (kind === "open") {
    await openInEditor(work, typeof run.file === "string" ? run.file : undefined, Number(run.line) || undefined);
    return { path: work };
  }
  throw new Error(`Неизвестное действие: ${kind}`);
}

let queue: Promise<void> = Promise.resolve();

/** Новые запросы модуля — по одному: каты делят общий проект, а dotnet test сам по себе тяжёлый. */
function processRuns() {
  queue = queue.then(async () => {
    const docs = db.listDocs(MODULE, RUNS);
    for (const d of docs.filter((x) => !x.status)) {
      db.putDoc(MODULE, RUNS, d.id, { status: "running", startedAt: Date.now() }, true);
      changed(RUNS);
      try {
        const out = await handle(d);
        db.putDoc(MODULE, RUNS, d.id, { status: "done", finishedAt: Date.now(), ...out }, true);
      } catch (e) {
        db.putDoc(MODULE, RUNS, d.id, { status: "error", finishedAt: Date.now(), error: e instanceof Error ? e.message : String(e) }, true);
      }
      changed(RUNS);
    }
    for (const d of docs.slice(0, Math.max(0, docs.length - KEEP_RUNS))) db.deleteDoc(MODULE, RUNS, d.id);
  }).catch((e) => console.error("[devpath]", e));
}

export function startDevpath() {
  // Прогон, прерванный перезапуском хаба, так и остался бы «running».
  for (const d of db.listDocs(MODULE, RUNS)) {
    if (d.status === "running") db.putDoc(MODULE, RUNS, d.id, { status: "error", error: "Хаб перезапустился во время прогона — запусти ещё раз" }, true);
  }
  subscribe((e) => {
    if (e.type === "data" && e.module === MODULE && e.collection === RUNS && e.origin !== MODULE) processRuns();
  });
  processRuns();
  setTimeout(() => void writeEnv().catch(() => {}), 5000);
}
