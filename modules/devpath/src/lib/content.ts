import type { Step } from "./types.ts";
import { parseTrack, type TopicContent } from "./content-parse.ts";
import csharp from "../content/csharp.md";
import dotnet from "../content/dotnet.md";
import data from "../content/data.md";
import arch from "../content/arch.md";
import distributed from "../content/distributed.md";
import devops from "../content/devops.md";
import cs from "../content/cs.md";
import net from "../content/net.md";
import ai from "../content/ai.md";
import sysdesign from "../content/sysdesign.md";
import onec from "../content/onec.md";
import craft from "../content/craft.md";

/*
 * Встроенные учебные материалы — Markdown-файлы в src/content (формат описан в src/content/README.md).
 * Работают без нейронки: теория, урок, тест, самопроверка, практика.
 */

const ALL: Record<string, TopicContent> = Object.assign(
  {},
  ...[csharp, dotnet, data, arch, distributed, devops, cs, net, ai, sysdesign, onec, craft].map(parseTrack),
);

export type { TopicContent, Section } from "./content-parse.ts";

export const contentFor = (id: string): TopicContent | undefined => ALL[id];

/** Урок из встроенных материалов: разделы теории вперемешку с вопросами, в конце — вспомнить своими словами. */
export function builtinLesson(id: string): Step[] | null {
  const c = ALL[id];
  if (!c || !c.sections.length) return null;
  const steps: Step[] = [];
  const quiz = [...c.quiz];
  c.sections.forEach((s, k) => {
    steps.push({ kind: "explain", title: s.title, md: s.md });
    // После каждого раздела, кроме последнего, — один вопрос.
    if (k < c.sections.length - 1 && quiz.length) steps.push(quiz.shift()!);
  });
  steps.push(...quiz);
  if (c.recall[0]) steps.push({ kind: "recall", question: c.recall[0].q, answer: c.recall[0].a });
  return steps;
}

/** Все вопросы по темам — для тестов, тренировок и входной диагностики. */
export function quizOf(ids: string[]) {
  return ids.flatMap((id) => (ALL[id]?.quiz ?? []).map((step) => ({ id, step })));
}

export const hasContent = (id: string) => !!ALL[id]?.sections.length;
