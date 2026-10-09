import { ai, db } from "@lifehub/sdk";
import { isArea, kindOf, type Area } from "./kinds.ts";
import { preview, titleOf } from "./text.ts";
import type { AreaId, Note, NoteDoc, Prefs, Topic, TopicDoc } from "./types.ts";

/*
 * «Разложить по сферам»: заметкам и проектам, сделанным до сфер (или руками), нейронка
 * проставляет сферу одним запросом. Новые заметки получают сферу при разборе.
 */

const BATCH = 150;

export async function classifyAreas(notes: NoteDoc[], topics: TopicDoc[], areas: Area[], prefs: Prefs, onProgress?: (done: number, total: number) => void) {
  const todo = notes.filter((n) => n.status !== "inbox" && !n.area);
  const projects = topics.filter((t) => !t.area);
  const total = todo.length + projects.length;
  let done = 0;
  const list = (items: string[]) => items.join("\n");
  const areasText = areas.map((a) => `${a.id} — ${a.emoji} ${a.name}: ${a.hint}`).join("\n");

  for (let i = 0; i < Math.max(todo.length, projects.length ? 1 : 0); i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const proj = i === 0 ? projects : [];
    const raw = await ai.json<{ notes?: Record<string, unknown>; topics?: Record<string, unknown> }>(
      `Сферы:\n${areasText}\n\nЗаметки:\n${list(chunk.map((n) => `- id=${n.id} [${kindOf(n).name}] ${titleOf(n)} — ${preview(n.body, 100)}`))}\n\n` +
        (proj.length ? `Проекты и темы:\n${list(proj.map((t) => `- id=${t.id} ${t.emoji} ${t.name}${t.goal ? ` — ${t.goal}` : ""}`))}\n\n` : "") +
        `Определи сферу для каждой заметки${proj.length ? " и каждого проекта" : ""}. Верни JSON: {"notes":{"id":"сфера"},"topics":{"id":"сфера"}}`,
      { system: "Ты раскладываешь личные заметки по сферам жизни. Каждой — ровно одна сфера из списка, по смыслу. Отвечай только JSON.", model: prefs.model },
    );
    for (const n of chunk) {
      const a = raw?.notes?.[n.id];
      if (isArea(a)) await db.collection<Note>("notes").update(n.id, { area: a as AreaId });
      onProgress?.(++done, total);
    }
    for (const t of proj) {
      const a = raw?.topics?.[t.id];
      if (isArea(a)) await db.collection<Topic>("topics").update(t.id, { area: a as AreaId });
      onProgress?.(++done, total);
    }
  }
  return done;
}
