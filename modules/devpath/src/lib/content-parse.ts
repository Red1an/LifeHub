import type { Step } from "./types.ts";

/* Разбор учебных материалов из Markdown (формат — src/content/README.md). */

export interface Section {
  title: string;
  md: string;
}

export interface TopicContent {
  sections: Section[];
  quiz: Step[];
  recall: { q: string; a: string }[];
  task?: { title: string; md: string; check: string[] };
}

function parseQuestion(block: string[]): Step | null {
  const head: string[] = [];
  const options: { text: string; ok: boolean }[] = [];
  const order: string[] = [];
  const why: string[] = [];
  let code: string | undefined;
  let bugLines: string[] | undefined;
  let bugLine = -1;
  let fix: string | undefined;
  for (let i = 0; i < block.length; i++) {
    const line = block[i];
    const fence = line.match(/^```(\S*)\s*(.*)$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < block.length && !block[i].startsWith("```")) body.push(block[i++]);
      const bug = fence[2].match(/bug=(\d+)/);
      if (fence[1] === "fix") fix = body.join("\n");
      else if (bug) {
        bugLines = body;
        bugLine = Number(bug[1]) - 1;
      } else code = body.join("\n");
      continue;
    }
    const opt = line.match(/^- \[( |x)\] (.*)$/);
    if (opt) options.push({ text: opt[2], ok: opt[1] === "x" });
    else if (/^\d+\. /.test(line)) order.push(line.replace(/^\d+\. /, ""));
    else if (line.startsWith("> ")) why.push(line.slice(2));
    else if (line.trim() && !options.length && !order.length) head.push(line);
  }
  const question = head.join("\n").trim();
  const w = why.join("\n");
  if (bugLines) return { kind: "bug", question, lines: bugLines, bugLine, why: w, fix };
  if (options.length) return { kind: "choice", question, code, options: options.map((o) => o.text), correct: options.findIndex((o) => o.ok), why: w };
  if (order.length) return { kind: "order", question, options: order, why: w };
  return null;
}

export function parseTrack(text: string): Record<string, TopicContent> {
  const out: Record<string, TopicContent> = {};
  const topics = text.replace(/\r\n/g, "\n").split(/^# @/m).slice(1);
  for (const chunk of topics) {
    const [idLine, ...rest] = chunk.split("\n");
    const id = idLine.trim();
    const c: TopicContent = { sections: [], quiz: [], recall: [] };
    let mode = "theory" as "theory" | "quiz" | "recall" | "task";
    let buf: string[] = [];
    let title = "";
    const flush = () => {
      const body = buf.join("\n").trim();
      if (mode === "theory" && body) c.sections.push({ title: title || "Введение", md: body });
      if (mode === "quiz" && body) {
        const s = parseQuestion(buf);
        if (s) c.quiz.push(s);
      }
      if (mode === "recall" && body) {
        const m = body.match(/^Q:\s*([\s\S]*?)\nA:\s*([\s\S]*)$/);
        if (m) c.recall.push({ q: m[1].trim(), a: m[2].trim() });
      }
      if (mode === "task" && c.task) {
        c.task.check = buf.filter((l) => l.startsWith("- [ ] ")).map((l) => l.slice(6));
        c.task.md = buf.filter((l) => !l.startsWith("- [ ] ")).join("\n").trim();
      }
      buf = [];
    };
    let inFence = false;
    for (const line of rest) {
      if (line.startsWith("```")) inFence = !inFence;
      if (!inFence) {
        const sw = line.match(/^---(quiz|recall|task)\s*(.*)$/);
        if (sw) {
          flush();
          mode = sw[1] as typeof mode;
          if (mode === "task") c.task = { title: sw[2].trim() || "Практика", md: "", check: [] };
          continue;
        }
        if (mode === "theory" && line.startsWith("## ")) {
          flush();
          title = line.slice(3).trim();
          continue;
        }
        if ((mode === "quiz" && line.startsWith("? ")) || (mode === "recall" && line.startsWith("Q:"))) {
          flush();
          buf.push(mode === "quiz" ? line.slice(2) : line);
          continue;
        }
      }
      buf.push(line);
    }
    flush();
    out[id] = c;
  }
  return out;
}
