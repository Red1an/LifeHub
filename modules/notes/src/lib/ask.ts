import { ai } from "@lifehub/sdk";
import { contextById, kindOf } from "./kinds.ts";
import { similar } from "./related.ts";
import { localKey, preview } from "./text.ts";
import type { NoteDoc, Prefs, TopicDoc } from "./types.ts";

/*
 * «Спросить свои заметки» (как Mem / Reflect / NotebookLM): ищем подходящие заметки локально
 * (слова + свежие + по темам из вопроса), отдаём их нейронке, ответ ссылается на них как [[id]].
 */

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

const SYSTEM = `Ты отвечаешь на вопросы пользователя по его личным заметкам. Пиши на «ты», коротко и по делу, по-русски.
Опирайся только на заметки ниже. Если ответа в них нет — так и скажи и предложи, что записать.
Ссылайся на заметки как [[id]] сразу после факта, который из них взят (можно несколько). Не придумывай id.
Можно использовать короткие списки. Без вступлений и без повторения вопроса.`;

function describe(n: NoteDoc, topics: Map<string, TopicDoc>) {
  const k = kindOf(n);
  const props = Object.entries(n.props ?? {})
    .map(([key, v]) => `${k.fields.find((f) => f.key === key)?.label ?? key}: ${v}`)
    .join("; ");
  const bits = [
    `id=${n.id}`,
    localKey(new Date(n.capturedAt ?? n.createdAt)),
    k.name,
    n.topicId && topics.get(n.topicId) ? `тема «${topics.get(n.topicId)!.name}»` : "",
    k.queue ? (n.done ? `${k.queue}${n.rating ? `, оценка ${n.rating}/5` : ""}${n.verdict ? ` («${n.verdict}»)` : ""}` : "в очереди") : "",
    n.context?.length ? n.context.map((c) => contextById(c)?.name).join(", ") : "",
    n.due ? `срок ${n.due}` : "",
    n.event ? `событие ${n.event.date}${n.event.start ? " " + n.event.start : ""}` : "",
  ].filter(Boolean);
  const links = (n.links ?? []).map((l) => `${l.url}${l.title ? ` («${l.title}»)` : ""}`).join(" ");
  return `- [${bits.join(" · ")}] ${n.title}${props ? ` (${props})` : ""}\n  ${preview(n.body, 400)}${links ? `\n  ссылки: ${links}` : ""}`;
}

export function pickContext(question: string, notes: NoteDoc[], topics: TopicDoc[]) {
  const pool = notes.filter((n) => n.status !== "inbox");
  const picked = new Map<string, NoteDoc>();
  for (const { note } of similar(question, [], pool, 40)) picked.set(note.id, note);
  // Тема названа в вопросе — берём её заметки целиком.
  const q = question.toLowerCase();
  for (const t of topics) {
    if (q.includes(t.name.toLowerCase().slice(0, 6))) for (const n of pool) if (n.topicId === t.id) picked.set(n.id, n);
  }
  // Вопросы «что недавно…», «что посмотреть» — без совпадения слов; добиваем свежими.
  const fresh = [...pool].sort((a, b) => (b.capturedAt ?? b.createdAt) - (a.capturedAt ?? a.createdAt));
  for (const n of fresh) {
    if (picked.size >= 80) break;
    picked.set(n.id, n);
  }
  return [...picked.values()].slice(0, 80);
}

export async function askNotes(
  question: string,
  history: ChatTurn[],
  notes: NoteDoc[],
  topics: TopicDoc[],
  prefs: Prefs,
  onDelta: (full: string) => void,
  signal?: AbortSignal,
) {
  const tmap = new Map(topics.map((t) => [t.id, t]));
  const ctx = pickContext([...history.filter((h) => h.role === "user").map((h) => h.text), question].join(" "), notes, topics);
  const prompt = [
    `Сегодня ${localKey(new Date())}.`,
    topics.length ? `Темы: ${topics.map((t) => `${t.emoji} ${t.name}${t.summary ? ` — ${preview(t.summary, 200)}` : ""}`).join("; ")}` : "",
    `Заметки:\n${ctx.map((n) => describe(n, tmap)).join("\n") || "(заметок нет)"}`,
    history.length ? `Разговор до этого:\n${history.map((h) => `${h.role === "user" ? "Пользователь" : "Ты"}: ${h.text}`).join("\n")}` : "",
    `Вопрос: ${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return ai.ask(prompt, { system: SYSTEM, model: prefs.model, onDelta: (_d, full) => onDelta(full), signal });
}

/** Разбивает ответ на текст и ссылки [[id]]. */
export function splitRefs(text: string): (string | { id: string })[] {
  const out: (string | { id: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[\[([a-z0-9]+)\]\]/gi)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push({ id: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
