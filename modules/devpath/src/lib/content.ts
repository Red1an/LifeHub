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
import sec from "../content/sec.md";
import aidev from "../content/aidev.md";
import simple from "../content/simple.md";
import deepCsharp from "../content/deep-csharp.md";
import deepDotnet from "../content/deep-dotnet.md";
import deepData from "../content/deep-data.md";
import deepArch from "../content/deep-arch.md";
import deepDistributed from "../content/deep-distributed.md";
import deepDevops from "../content/deep-devops.md";
import deepCs from "../content/deep-cs.md";
import deepNet from "../content/deep-net.md";
import deepSec from "../content/deep-sec.md";
import deepAi from "../content/deep-ai.md";
import deepAidev from "../content/deep-aidev.md";
import deepSysdesign from "../content/deep-sysdesign.md";
import deepOnec from "../content/deep-onec.md";
import deepCraft from "../content/deep-craft.md";

/*
 * Встроенные учебные материалы — Markdown-файлы в src/content (формат описан в src/content/README.md).
 * Работают без нейронки: теория, урок, тест, самопроверка, практика.
 */

const ALL: Record<string, TopicContent> = Object.assign(
  {},
  ...[csharp, dotnet, data, arch, distributed, devops, cs, net, sec, ai, aidev, sysdesign, onec, craft].map(parseTrack),
);

/** «Простыми словами»: короткое объяснение с аналогией — первый раздел каждой темы (src/content/simple.md). */
export const SIMPLE_TITLE = "Простыми словами";
for (const chunk of simple.replace(/\r\n/g, "\n").split(/^# @/m).slice(1)) {
  const [idLine, ...rest] = chunk.split("\n");
  const c = ALL[idLine.trim()];
  const md = rest.join("\n").trim();
  if (c && md) c.sections.unshift({ title: SIMPLE_TITLE, md });
}

/** Слой «Глубже» (deep-*.md): разделы senior-уровня, дополнительные вопросы, карточки и литература. */
const DEEP = [
  deepCsharp, deepDotnet, deepData, deepArch, deepDistributed, deepDevops, deepCs,
  deepNet, deepSec, deepAi, deepAidev, deepSysdesign, deepOnec, deepCraft,
];
for (const file of DEEP) {
  for (const [id, d] of Object.entries(parseTrack(file))) {
    const c = ALL[id];
    if (!c) continue;
    c.deep.push(...d.sections);
    c.deepQuiz.push(...d.quiz);
    c.recall.push(...d.recall);
    c.reading.push(...d.reading);
    c.task ??= d.task;
  }
}

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
    // После каждого раздела, кроме «Простыми словами» и последнего, — один вопрос.
    if (s.title !== SIMPLE_TITLE && k < c.sections.length - 1 && quiz.length) steps.push(quiz.shift()!);
  });
  steps.push(...quiz);
  if (c.recall[0]) steps.push({ kind: "recall", question: c.recall[0].q, answer: c.recall[0].a });
  return steps;
}

/** Все вопросы по темам — для тестов, тренировок и входной диагностики. */
export function quizOf(ids: string[]) {
  return ids.flatMap((id) => [...(ALL[id]?.quiz ?? []), ...(ALL[id]?.deepQuiz ?? [])].map((step) => ({ id, step })));
}

export const hasContent = (id: string) => !!ALL[id]?.sections.length;
