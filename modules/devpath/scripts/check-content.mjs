/*
 * Проверка учебных материалов: node scripts/check-content.mjs
 * Для каждой темы из curriculum.ts: есть ли теория, «простыми словами», слой «Глубже»,
 * сколько вопросов (базовых + углублённых), карточек самопроверки и источников. Битые вопросы — ошибка.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, "src", "content");
const { parseTrack } = await import(pathToFileURL(path.join(root, "src", "lib", "content-parse.ts")).href);

const ids = [...fs.readFileSync(path.join(root, "src", "data", "curriculum.ts"), "utf8").matchAll(/^\s+t\("([a-z0-9-]+)"/gm)].map((m) => m[1]);
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md");

const base = Object.assign({}, ...files.filter((f) => !f.startsWith("deep-") && f !== "simple.md").map((f) => parseTrack(read(f))));
const deep = Object.assign({}, ...files.filter((f) => f.startsWith("deep-")).map((f) => parseTrack(read(f))));
const simple = new Set([...read("simple.md").matchAll(/^# @([a-z0-9-]+)/gm)].map((m) => m[1]));

const bad = (q) => !q.question || (q.kind === "choice" && (q.correct < 0 || !q.why)) || (q.kind === "bug" && (q.bugLine < 0 || q.bugLine >= q.lines.length));
let problems = 0;
let totalQ = 0;
const counts = [];
for (const id of ids) {
  const b = base[id];
  const d = deep[id];
  const issues = [];
  if (!b?.sections.length) issues.push("нет теории");
  if (!simple.has(id)) issues.push("нет «простыми словами»");
  if (!d?.sections.length) issues.push("нет «Глубже»");
  if (!d?.reading.length) issues.push("нет литературы");
  const quiz = [...(b?.quiz ?? []), ...(d?.quiz ?? [])];
  const broken = quiz.filter(bad).length;
  if (broken) issues.push(`битых вопросов: ${broken}`);
  if (quiz.length < 6) issues.push(`мало вопросов: ${quiz.length}`);
  totalQ += quiz.length;
  counts.push(quiz.length);
  if (issues.length) {
    problems++;
    console.log(id.padEnd(28), issues.join(", "));
  }
}
const extra = Object.keys(deep).filter((id) => !ids.includes(id));
if (extra.length) console.log("лишние темы в deep-*.md:", extra.join(", "));
counts.sort((a, b) => a - b);
console.log(`тем: ${ids.length}, с проблемами: ${problems}, вопросов: ${totalQ} (на тему: мин ${counts[0]}, медиана ${counts[counts.length >> 1]}, макс ${counts.at(-1)})`);
process.exit(problems || extra.length ? 1 : 0);
