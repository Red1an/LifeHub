import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyDir, kataBlocks, kataDir, missionDir, prepareMission, prepareProject, projectDir, runKata, runMission, runProject, type RunResult } from "./runner.ts";

/*
 * Проверка самих миссий, кат и проектов DevPath: node server/devpath/verify.ts [id…]
 * Заготовка должна собираться, но не проходить тесты; эталон — проходить все.
 * Так битая миссия (тесты зелёные без работы или эталон не проходит) не доходит до ученика.
 */

const root = path.resolve(import.meta.dirname, "..", "..", "modules", "devpath");
const only = new Set(process.argv.slice(2));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devpath-verify-"));
let problems = 0;

const short = (r: RunResult) =>
  r.built ? `${r.passed}/${r.total} тестов` : `не собралось: ${r.errors.slice(0, 3).map((e) => `${e.file}:${e.line} ${e.message}`).join("; ") || r.output?.slice(-300)}`;

function report(id: string, issues: string[], info: string) {
  if (issues.length) problems++;
  console.log(`${issues.length ? "✗" : "✓"} ${id.padEnd(28)} ${info}${issues.length ? "\n    " + issues.join("\n    ") : ""}`);
}

for (const id of fs.readdirSync(path.join(root, "missions")).sort()) {
  if (only.size && !only.has(id)) continue;
  const src = missionDir(root, id);
  if (!fs.existsSync(path.join(src, "starter"))) continue;
  const issues: string[] = [];
  if (!fs.existsSync(path.join(src, "mission.md"))) issues.push("нет mission.md");
  if (!fs.existsSync(path.join(src, "solution"))) issues.push("нет solution/");
  const work = path.join(tmp, "m-" + id);
  await prepareMission(root, id, work);
  const before = await runMission(root, id, work);
  if (!before.built) issues.push(`заготовка должна собираться — ${short(before)}`);
  else if (before.ok) issues.push("заготовка уже проходит все тесты");
  copyDir(path.join(src, "solution"), work);
  const after = await runMission(root, id, work);
  if (!after.ok) issues.push(`эталон не проходит: ${short(after)}${after.tests.filter((t) => !t.ok).map((t) => `\n      ✗ ${t.name}: ${t.message?.split("\n")[0]}`).join("")}`);
  report(id, issues, `заготовка ${short(before)}, эталон ${short(after)}`);
}

const runner = path.join(tmp, "kata");
for (const id of fs.readdirSync(path.join(root, "katas")).sort()) {
  if (only.size && !only.has(id)) continue;
  const md = path.join(kataDir(root, id), "kata.md");
  if (!fs.existsSync(md)) continue;
  const { starter, solution } = kataBlocks(fs.readFileSync(md, "utf8"));
  const issues: string[] = [];
  if (!starter) issues.push("нет блока ---starter");
  if (!solution) issues.push("нет блока ---solution");
  const before = await runKata(root, id, starter, runner);
  if (!before.built) issues.push(`заготовка должна собираться — ${short(before)}`);
  else if (before.ok) issues.push("заготовка уже проходит все тесты");
  const after = await runKata(root, id, solution, runner);
  if (!after.ok) issues.push(`эталон не проходит: ${short(after)}${after.tests.filter((t) => !t.ok).map((t) => `\n      ✗ ${t.name}: ${t.message?.split("\n")[0]}`).join("")}`);
  report("ката " + id, issues, `заготовка ${short(before)}, эталон ${short(after)}`);
}

// Проекты: на этапе N эталон предыдущего этапа должен не проходить тесты N, а эталон этапа N — проходить тесты 1..N.
// Нужен запущенный Docker (инфраструктура проекта).
for (const id of fs.existsSync(path.join(root, "projects")) ? fs.readdirSync(path.join(root, "projects")).sort() : []) {
  const src = projectDir(root, id);
  if (!fs.existsSync(path.join(src, "skeleton"))) continue;
  const stages = fs.readdirSync(path.join(src, "stages")).filter((d) => fs.existsSync(path.join(src, "stages", d, "solution"))).sort();
  let prev: string | null = null;
  for (const d of stages) {
    const label = `${id} этап ${d}`;
    if (only.size && !only.has(id) && !only.has(label.replace(/ /g, "-"))) {
      prev = d;
      continue;
    }
    const n = Number(d);
    const issues: string[] = [];
    if (!fs.existsSync(path.join(src, "stages", d, "stage.md"))) issues.push("нет stage.md");
    const before = path.join(tmp, `p-${id}-${d}-before`);
    await prepareProject(root, id, before);
    if (prev) copyDir(path.join(src, "stages", prev, "solution"), before);
    const r1 = await runProject(root, id, before, n);
    const stageTests = r1.tests.filter((t) => t.name.startsWith(`Э${n}.`));
    if (r1.infraError) issues.push(r1.infraError);
    else if (r1.built && stageTests.length && stageTests.every((t) => t.ok)) issues.push(`тесты этапа ${n} проходят без работы над этапом`);
    const after = path.join(tmp, `p-${id}-${d}-after`);
    await prepareProject(root, id, after);
    copyDir(path.join(src, "stages", d, "solution"), after);
    const r2 = await runProject(root, id, after, n);
    if (!r2.ok) issues.push(`эталон не проходит: ${short(r2)}${r2.tests.filter((t) => !t.ok).map((t) => `\n      ✗ ${t.name}: ${t.message?.split("\n")[0]}`).join("")}`);
    report(label, issues, `до этапа ${short(r1)}, эталон ${short(r2)}`);
    prev = d;
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(problems ? `\nПроблем: ${problems}` : "\nВсё в порядке");
process.exit(problems ? 1 : 0);
