import type { Step } from "./types.ts";
import { parseQuestion, type Section } from "./content-parse.ts";

/*
 * Разбор миссий (missions/<id>/mission.md) и кат (katas/<id>/kata.md). Формат — missions/README.md.
 * Код проекта, тесты и эталон лежат рядом с mission.md; их копирует и проверяет хаб (server/devpath).
 */

export type MissionKind = "fix" | "build" | "speed";

export interface Mission {
  id: string;
  title: string;
  icon: string;
  level: 1 | 2 | 3;
  kind: MissionKind;
  topics: string[];
  minutes: number;
  skills: string;
  /** Ситуация: что случилось. */
  story: string;
  task: string;
  /** «Минимум, чтобы начать» — разобранный пример для незнакомой темы. */
  primer?: Section;
  hypothesis: string;
  /** Лесенка подсказок: вопрос → направление → почти решение. */
  hints: string[];
  debrief: Section[];
  quiz: Step[];
  recall: { q: string; a: string }[];
}

export interface Kata {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  topics: string[];
  minutes: number;
  task: string;
  starter: string;
  why: string;
  solution: string;
}

function frontMatter(text: string) {
  const m = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m?.[2] ?? text };
}

/** Разделы `---имя заголовок` вне блоков кода. Текст до первого раздела — под именем "". */
function blocks(body: string) {
  const out: { name: string; arg: string; lines: string[] }[] = [{ name: "", arg: "", lines: [] }];
  let fence = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    const sw = !fence && line.match(/^---([a-z]+)\s*(.*)$/);
    if (sw) out.push({ name: sw[1], arg: sw[2].trim(), lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

const text = (lines: string[]) => lines.join("\n").trim();
const level = (v: string | undefined) => (v === "3" ? 3 : v === "2" ? 2 : 1) as 1 | 2 | 3;
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function sections(lines: string[]): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  let fence = false;
  for (const line of lines) {
    if (line.startsWith("```")) fence = !fence;
    if (!fence && line.startsWith("## ")) {
      cur = { title: line.slice(3).trim(), md: "" };
      out.push(cur);
    } else if (cur) cur.md += line + "\n";
    else if (line.trim()) out.push((cur = { title: "Разбор", md: line + "\n" }));
  }
  return out.map((s) => ({ ...s, md: s.md.trim() }));
}

function questions(lines: string[]): Step[] {
  const out: Step[] = [];
  let buf: string[] | null = null;
  let fence = false;
  const flush = () => {
    const s = buf && parseQuestion(buf);
    if (s) out.push(s);
  };
  for (const line of lines) {
    if (line.startsWith("```")) fence = !fence;
    if (!fence && line.startsWith("? ")) {
      flush();
      buf = [line.slice(2)];
    } else buf?.push(line);
  }
  flush();
  return out;
}

function recall(lines: string[]) {
  return text(lines)
    .split(/\n(?=Q:)/)
    .map((b) => b.match(/^Q:\s*([\s\S]*?)\nA:\s*([\s\S]*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ q: m[1].trim(), a: m[2].trim() }));
}

const code = (lines: string[]) => text(lines).match(/^```\w*\n([\s\S]*?)\n```/)?.[1] ?? "";

export function parseMission(id: string, source: string): Mission {
  const { meta, body } = frontMatter(source);
  const m: Mission = {
    id,
    title: meta.title ?? id,
    icon: meta.icon ?? "🛠️",
    level: level(meta.level),
    kind: (["fix", "build", "speed"].includes(meta.kind) ? meta.kind : "fix") as MissionKind,
    topics: list(meta.topics),
    minutes: Number(meta.minutes) || 30,
    skills: meta.skills ?? "",
    story: "",
    task: "",
    hypothesis: "",
    hints: [],
    debrief: [],
    quiz: [],
    recall: [],
  };
  for (const b of blocks(body)) {
    if (b.name === "") m.story = text(b.lines);
    else if (b.name === "task") m.task = text(b.lines);
    else if (b.name === "primer") m.primer = { title: b.arg || "Минимум, чтобы начать", md: text(b.lines) };
    else if (b.name === "hypothesis") m.hypothesis = text(b.lines);
    else if (b.name === "hint") m.hints.push(text(b.lines));
    else if (b.name === "debrief") m.debrief = sections(b.lines);
    else if (b.name === "quiz") m.quiz = questions(b.lines);
    else if (b.name === "recall") m.recall = recall(b.lines);
  }
  return m;
}

export function parseKata(id: string, source: string): Kata {
  const { meta, body } = frontMatter(source);
  const k: Kata = {
    id,
    title: meta.title ?? id,
    level: level(meta.level),
    topics: list(meta.topics),
    minutes: Number(meta.minutes) || 15,
    task: "",
    starter: "",
    why: "",
    solution: "",
  };
  for (const b of blocks(body)) {
    if (b.name === "") k.task = text(b.lines);
    else if (b.name === "starter") k.starter = code(b.lines);
    else if (b.name === "why") k.why = text(b.lines);
    else if (b.name === "solution") k.solution = code(b.lines);
  }
  return k;
}

/* ───────────── проекты (projects/<id>/project.md и stages/NN/stage.md) ───────────── */

export interface ProjectStageInfo {
  n: number;
  title: string;
  tech: string;
}

export interface Project {
  id: string;
  title: string;
  icon: string;
  summary: string;
  intro: string;
  roadmap: ProjectStageInfo[];
}

export interface Stage {
  n: number;
  title: string;
  /** Открытый этап: контракта почти нет, ученик проектирует сам и защищает дизайн-документ до кода. */
  open: boolean;
  topics: string[];
  hours: number;
  ownTests: number;
  story: string;
  task: string;
  design: string;
  primer?: Section;
  steps: string;
  hints: string[];
  /** Эксперименты «сломай и посмотри». */
  breaks: string;
  debrief: Section[];
  quiz: Step[];
  recall: { q: string; a: string }[];
}

export function parseProject(id: string, source: string): Project {
  const { meta, body } = frontMatter(source);
  const p: Project = { id, title: meta.title ?? id, icon: meta.icon ?? "🏗️", summary: meta.summary ?? "", intro: "", roadmap: [] };
  for (const b of blocks(body)) {
    if (b.name === "") p.intro = text(b.lines);
    if (b.name === "stages") {
      for (const line of b.lines) {
        const m = line.match(/^(\d+)\s*\|\s*(.+?)\s*\|\s*(.+)$/);
        if (m) p.roadmap.push({ n: Number(m[1]), title: m[2], tech: m[3] });
      }
    }
  }
  return p;
}

export function parseStage(n: number, source: string): Stage {
  const { meta, body } = frontMatter(source);
  const s: Stage = {
    n,
    title: meta.title ?? `Этап ${n}`,
    open: meta.open === "true",
    topics: list(meta.topics),
    hours: Number(meta.hours) || 4,
    ownTests: Number(meta.ownTests) || 0,
    story: "",
    task: "",
    design: "",
    steps: "",
    hints: [],
    breaks: "",
    debrief: [],
    quiz: [],
    recall: [],
  };
  for (const b of blocks(body)) {
    if (b.name === "") s.story = text(b.lines);
    else if (b.name === "task") s.task = text(b.lines);
    else if (b.name === "design") s.design = text(b.lines);
    else if (b.name === "primer") s.primer = { title: b.arg || "Минимум, чтобы начать", md: text(b.lines) };
    else if (b.name === "steps") s.steps = text(b.lines);
    else if (b.name === "hint") s.hints.push(text(b.lines));
    else if (b.name === "break") s.breaks = text(b.lines);
    else if (b.name === "debrief") s.debrief = sections(b.lines);
    else if (b.name === "quiz") s.quiz = questions(b.lines);
    else if (b.name === "recall") s.recall = recall(b.lines);
  }
  return s;
}

/* ───────────── задачи на проектирование (designs/<id>.md) ───────────── */

export interface DesignTask {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  minutes: number;
  task: string;
  requirements: string;
  think: string;
  reference: string;
}

export function parseDesign(id: string, source: string): DesignTask {
  const { meta, body } = frontMatter(source);
  const d: DesignTask = { id, title: meta.title ?? id, level: level(meta.level), minutes: Number(meta.minutes) || 45, task: "", requirements: "", think: "", reference: "" };
  for (const b of blocks(body)) {
    if (b.name === "") d.task = text(b.lines);
    else if (b.name === "requirements") d.requirements = text(b.lines);
    else if (b.name === "think") d.think = text(b.lines);
    else if (b.name === "reference") d.reference = text(b.lines);
  }
  return d;
}
