import { ai } from "@lifehub/sdk";
import { isSnoozed, kindOf } from "./kinds.ts";
import { DAY, localKey, preview, titleOf } from "./text.ts";
import type { NoteDoc, Prefs, TopicDoc } from "./types.ts";

/*
 * «Всплывашки»: что вернулось из отложенного, что давно лежит, к чему не возвращался, что повторяется.
 * Локальные правила считаются сразу, находки нейронки — по кнопке (кэш в useStore("review")).
 */

export interface LocalGroup {
  key: string;
  icon: string;
  title: string;
  hint: string;
  notes?: NoteDoc[];
  topics?: TopicDoc[];
}

export function localReview(notes: NoteDoc[], topics: TopicDoc[], now = Date.now()): LocalGroup[] {
  const today = localKey(new Date(now));
  const filed = notes.filter((n) => n.status !== "inbox" && n.status !== "archived");
  const inbox = notes.filter((n) => n.status === "inbox");
  const at = (n: NoteDoc) => n.capturedAt ?? n.createdAt;
  const groups: LocalGroup[] = [];

  const back = filed.filter((n) => n.snoozeUntil && !isSnoozed(n, today));
  if (back.length) groups.push({ key: "snooze", icon: "⏰", title: "Вернулись из отложенных", hint: "Ты просил напомнить — пора", notes: back });

  const staleInbox = inbox.filter((n) => now - at(n) > DAY);
  if (staleInbox.length) groups.push({ key: "inbox", icon: "🌀", title: "Воронка ждёт разбора", hint: "Записи лежат дольше суток — пора разобрать", notes: staleInbox });

  const unsent = filed.filter((n) => n.event && !n.event.sentAt && n.event.date >= today).sort((a, b) => a.event!.date.localeCompare(b.event!.date));
  if (unsent.length) groups.push({ key: "events", icon: "📅", title: "События не в календаре", hint: "Нашлись даты, но в Расписание они ещё не ушли", notes: unsent });

  const dues = filed.filter((n) => n.due && !n.done && !n.dueSentAt).sort((a, b) => a.due!.localeCompare(b.due!));
  if (dues.length) groups.push({ key: "dues", icon: "🎯", title: "Дела со сроком", hint: "Можно отдать в «Дедлайны» Расписания — разложит по свободному времени", notes: dues });

  const queue = filed
    .filter((n) => kindOf(n).queue && kindOf(n).id !== "task" && !n.done && !isSnoozed(n, today) && now - at(n) > 21 * DAY)
    .sort((a, b) => at(a) - at(b));
  if (queue.length) groups.push({ key: "queue", icon: "⏳", title: "Давно ждут", hint: "Три недели в очереди: посмотреть, попробовать — или вычеркнуть в архив", notes: queue.slice(0, 8) });

  const soon = localKey(new Date(now + 7 * DAY));
  const projects = topics.filter((t) => t.kind === "project" && !t.closedAt && t.due && t.due <= soon).sort((a, b) => a.due!.localeCompare(b.due!));
  if (projects.length) groups.push({ key: "projects", icon: "🚩", title: "Срок проекта близко", hint: "Неделя или меньше — или уже прошёл", topics: projects });

  const coldTopics = topics.filter((t) => !t.closedAt && now - t.updatedAt > 30 * DAY).sort((a, b) => a.updatedAt - b.updatedAt);
  if (coldTopics.length) groups.push({ key: "topics", icon: "🧊", title: "Темы без движения", hint: "Месяц без новых заметок — ещё актуально? Проект можно завершить", topics: coldTopics.slice(0, 5) });

  const day = new Date(now);
  const ago = (months: number) => localKey(new Date(day.getFullYear(), day.getMonth() - months, day.getDate()));
  const memories = filed.filter((n) => {
    const k = localKey(new Date(at(n)));
    return k === ago(1) || k === ago(12);
  });
  if (memories.length) groups.push({ key: "back", icon: "🕰️", title: "В этот день", hint: "Что ты записывал месяц и год назад", notes: memories });

  return groups;
}

export interface Finding {
  kind: string;
  title: string;
  text: string;
  noteIds: string[];
}

export interface ReviewCache {
  at: number;
  findings: Finding[];
}

const SYSTEM = `Ты смотришь на личные заметки пользователя со стороны и ищешь то, чего он сам не замечает.
Режимы (пройди все, но верни только реально найденное):
1. Повторы — мысль или желание всплывает 3+ раза в разные дни. Назови даты: «третий раз за месяц».
2. Противоречия — старая заметка говорит одно, новая другое. «В марте ты писал X, сейчас Y — что вернее?»
3. Новая тема — несколько заметок без темы явно про одно и то же (скажи, проект это или сфера).
4. Забытое важное — что-то, похожее на важное намерение, после которого ничего не было.
5. Вкус — по оценкам просмотренного/прочитанного: что нравится, что из очереди стоит взять первым.
Не больше 5 находок. Каждая — 2–3 строки, по делу, без похвалы и без воды. Пиши на «ты».
Если ничего стоящего нет — верни пустой список.`;

export async function aiReview(notes: NoteDoc[], topics: TopicDoc[], prefs: Prefs): Promise<ReviewCache> {
  const filed = notes
    .filter((n) => n.status !== "inbox" && n.status !== "archived")
    .sort((a, b) => (b.capturedAt ?? b.createdAt) - (a.capturedAt ?? a.createdAt))
    .slice(0, 250);
  const tn = new Map(topics.map((t) => [t.id, t.name]));
  const list = filed
    .map((n) => {
      const k = kindOf(n);
      const state = k.queue ? (n.done ? `${k.queue}${n.rating ? ` ${n.rating}/5` : ""}${n.verdict ? ` «${n.verdict}»` : ""}` : "в очереди") : "";
      return `- id=${n.id} ${localKey(new Date(n.capturedAt ?? n.createdAt))} [${k.name}${n.topicId ? `, тема ${tn.get(n.topicId) ?? "?"}` : ""}${state ? `, ${state}` : ""}] ${titleOf(n)} — ${preview(n.body, 160)}`;
    })
    .join("\n");
  const raw = await ai.json<{ findings?: { kind?: unknown; title?: unknown; text?: unknown; noteIds?: unknown }[] }>(
    `Сегодня ${localKey(new Date())}.\nТемы: ${topics.map((t) => `${t.name} (${t.kind === "project" ? "проект" : "сфера"}${t.closedAt ? ", завершён" : ""})`).join(", ") || "нет"}\n\nЗаметки (новые сверху):\n${list}\n\n` +
      `Верни JSON: {"findings":[{"kind":"повтор|противоречие|новая тема|забытое|вкус","title":"коротко","text":"2–3 строки","noteIds":["id"]}]}`,
    { system: SYSTEM, model: prefs.model },
  );
  const ids = new Set(filed.map((n) => n.id));
  const findings = (Array.isArray(raw?.findings) ? raw.findings : [])
    .map((f) => ({
      kind: String(f.kind ?? ""),
      title: String(f.title ?? "").trim(),
      text: String(f.text ?? "").trim(),
      noteIds: (Array.isArray(f.noteIds) ? f.noteIds : []).map(String).filter((id) => ids.has(id)),
    }))
    .filter((f) => f.title || f.text)
    .slice(0, 5);
  return { at: Date.now(), findings };
}
