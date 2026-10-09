import { ai, dayKey, uid } from "@lifehub/sdk";
import { CATEGORIES, type CalEvent, type Category, type Draft, type PendingTask, type Prefs, type Recurrence } from "./types.ts";
import { draftsForTasks, newPending } from "./tasks.ts";
import { DATE_RE, RRULE_DAYS, TIME_RE, WEEKDAYS, WEEKDAYS_LONG, fromKey, hhmm, recurrenceLabel, shiftKey, timeZone, toMinutes, weekday } from "./time.ts";

/*
 * Запрос → нейронка → черновик изменений календаря. Нейронка видит занятость,
 * события, которые поставил этот модуль (их можно менять), и данные модулей.
 * Ничего не применяется само — черновик подтверждает пользователь.
 */

const SYSTEM = `Ты — планировщик, который ведёт Google Календарь пользователя. По запросу (текст, фото расписаний, афиш, скриншотов переписки, данные из его приложений) ты составляешь список изменений календаря.

Правила:
- Даты — "YYYY-MM-DD", время — "HH:mm" (24 часа), в часовом поясе пользователя. Учитывай текущую дату: «в пятницу» — ближайшая будущая пятница.
- Если время не задано — подбери свободное окно внутри дня пользователя, не пересекаясь с занятым временем и оставляя буфер. Не ставь ничего в прошлое.
- Событие на весь день (без start) — ТОЛЬКО то, что реально занимает весь день: день рождения, праздник, отпуск, поездка, многодневное. Концерт, встреча, врач, пара, матч и любые дела без сказанного времени на весь день НЕ ставь: поставь типичное время (концерт — 19:00, врач — 10:00) и добавь в "questions" просьбу уточнить время.
- «Напомни…», дела без длительности (позвонить, купить, оплатить, отправить, выпить таблетку, сдать) и дедлайны — "kind": "reminder" с конкретным временем: сказанным, подходящим по смыслу (оплатить — утром, купить продукты — после работы) или временем напоминаний пользователя. Напоминания не занимают время и могут пересекаться с событиями.
- Обычные события — "kind": "event".
- Задачи с дедлайном и объёмом работы (лаба, курсовая, отчёт, домашка, подготовка к экзамену, проект) — в "tasks", а НЕ в events: блоки работы по свободному времени расставит программа, напоминание о сроке тоже. Если объём не назван — оцени реалистично (лаба — 4–6 ч, отчёт — 2–3 ч, подготовка к экзамену — 10–15 ч) и скажи об этом в summary. chunkMin — длина одного блока (обычно 60–120). Если срок не назван — спроси в questions.
- Регулярные вещи (каждый вторник, пары по расписанию, ежедневная привычка) — ОДНО событие с recurrence, а не копии. Если у повтора есть конец (семестр, курс) — укажи until.
- Фото расписания: перенеси все занятия точно как на фото (название, время, аудитория в location, преподаватель в description). Чётные/нечётные недели — interval: 2.
- Менять (update) и удалять (delete) можно ТОЛЬКО события из списка «События LifeHub», по их id. Для изменения всех повторов серии укажи "series": true.
- Не дублируй: события, которые уже стоят (занятое время и события LifeHub), входят в счёт. «3 тренировки в неделю» при одной уже стоящей — это ещё 2. Перенос — это update, а не новое событие.
- Ничего не выдумывай. Если не хватает данных (не видно даты, непонятно что за событие) — задай вопрос в "questions" и не создавай сомнительное событие.
- title — коротко, с подходящим эмодзи в начале. Язык — как у пользователя.
- category — одно из: ${Object.keys(CATEGORIES).join(", ")}.
- reminders — за сколько минут до начала напомнить, массив до 3 чисел. Если пользователь сказал («напомни за час», «за день») — ровно так. Иначе по смыслу: концерт, поезд, самолёт, врач, экзамен — [1440, 120]; встреча, созвон, пара — [15]; тренировка — [30]; для kind "reminder" — [0]. Не уверен — не указывай поле, возьмётся настройка пользователя. [] — без напоминаний. Для событий на весь день минуты считаются от полуночи этого дня (240 — накануне в 20:00).
- summary — 1–2 предложения: что и почему так поставил.

Ответ — только JSON:
{"summary": "…", "questions": ["…"], "events": [{"op": "create" | "update" | "delete", "id": "только для update/delete", "series": false, "title": "…", "date": "YYYY-MM-DD", "start": "HH:mm (нет — весь день)", "end": "HH:mm", "endDate": "YYYY-MM-DD для многодневных на весь день", "recurrence": {"freq": "DAILY" | "WEEKLY" | "MONTHLY", "byDay": ["MO", "WE"], "interval": 1, "until": "YYYY-MM-DD", "count": 10}, "category": "…", "kind": "event" | "reminder", "location": "…", "description": "…", "reminders": [1440, 120], "source": "text | photo | fit | devpath | habits"}], "tasks": [{"title": "…", "deadline": "YYYY-MM-DD", "deadlineTime": "HH:mm (если сказано)", "estimateMin": 240, "chunkMin": 90, "category": "study", "notes": "…"}]}`;

export interface PlanInput {
  request: string;
  images: (Blob | string)[];
  /** Тексты выбранных источников: id → описание. */
  sources: Record<string, string>;
  events: CalEvent[];
  prefs: Prefs;
  /** Уточнение уже готового черновика. */
  refine?: { drafts: Draft[]; tasks?: PendingTask[]; feedback: string };
}

function eventLine(e: CalEvent): string {
  const k = dayKey(e.start);
  const when = e.allDay ? "весь день" : `${hhmm(e.start)}–${hhmm(e.end)}`;
  return `${k} ${WEEKDAYS[weekday(e.start)]} ${when} «${e.title}»${e.kind === "reminder" ? " (напоминание)" : ""}`;
}

function draftForPrompt(d: Draft) {
  const { key: _k, skip: _s, calendarId: _c, eventId, ...rest } = d;
  return { ...rest, id: eventId };
}

export function buildPrompt(input: PlanInput): string {
  const now = new Date();
  const p = input.prefs;
  const busy = input.events.filter((e) => !e.ours);
  const ours = input.events.filter((e) => e.ours && e.canEdit);
  const parts = [
    `Сейчас: ${dayKey(now)} (${WEEKDAYS_LONG[weekday(now)]}), ${hhmm(now)}, часовой пояс ${timeZone()}.`,
    `Ближайшие дни: ${Array.from({ length: 8 }, (_, i) => {
      const k = shiftKey(dayKey(now), i);
      return `${WEEKDAYS[weekday(fromKey(k))]} ${k}`;
    }).join(", ")}.`,
    `Настройки: активный день с ${p.dayStart} до ${p.dayEnd}; длительность по умолчанию ${p.defaultMinutes} мин; буфер между событиями ${p.buffer} мин; время напоминаний, если не сказано, — ${p.reminderTime}; напоминание по умолчанию ${p.reminder >= 0 ? `за ${p.reminder} мин` : "не ставится"}.`,
    p.notes.trim() ? `Правила пользователя:\n${p.notes.trim()}` : "",
    `Занятое время в календаре на ${p.horizon} дн. вперёд:\n${busy.length ? busy.slice(0, 400).map((e) => "- " + eventLine(e)).join("\n") : "- ничего"}`,
    `События LifeHub (их можно менять и удалять):\n${
      ours.length
        ? ours.slice(0, 200).map((e) => `- id=${e.recurringEventId ? `${e.id} (повтор серии ${e.recurringEventId})` : e.id} ${eventLine(e)}`).join("\n")
        : "- нет"
    }`,
    ...Object.entries(input.sources).map(([id, text]) => `Данные модуля ${id}:\n${text}`),
    input.images.length ? `К запросу приложено фото: ${input.images.length} шт. Разбери их.` : "",
    `Запрос пользователя:\n${input.request.trim() || "(без текста — смотри фото и данные модулей)"}`,
  ];
  if (input.refine) {
    parts.push(
      `Уже составленный черновик:\n${JSON.stringify(input.refine.drafts.filter((d) => !d.skip && !d.taskId).map(draftForPrompt))}`,
      input.refine.tasks?.length
        ? `Задачи с дедлайном в черновике (верни их снова в "tasks", с правками, если просят):\n${JSON.stringify(input.refine.tasks.map((t) => ({ title: t.title, deadline: t.deadline, deadlineTime: t.deadlineTime, estimateMin: t.estimate, chunkMin: t.chunk, category: t.category, notes: t.notes })))}`
        : "",
      `Пользователь просит поправить черновик: ${input.refine.feedback}\nВерни полный новый список events (не только изменения).`,
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

interface RawEvent {
  op?: string;
  id?: string;
  series?: boolean;
  title?: string;
  date?: string;
  start?: string;
  end?: string;
  endDate?: string;
  recurrence?: Partial<Recurrence> | null;
  category?: string;
  location?: string;
  description?: string;
  reminder?: number | null;
  reminders?: unknown;
  kind?: string;
  source?: string;
}

function normReminders(r: RawEvent): number[] | undefined {
  if (Array.isArray(r.reminders)) {
    return [...new Set(r.reminders.filter((m): m is number => typeof m === "number" && isFinite(m) && m >= 0 && m <= 40320).map(Math.round))].slice(0, 5);
  }
  if (r.reminder === null) return [];
  if (typeof r.reminder === "number" && r.reminder >= 0) return [Math.round(r.reminder)];
  return undefined;
}

function normRecurrence(r: RawEvent["recurrence"]): Recurrence | undefined {
  if (!r || !r.freq || !["DAILY", "WEEKLY", "MONTHLY"].includes(r.freq)) return undefined;
  return {
    freq: r.freq,
    byDay: Array.isArray(r.byDay) ? r.byDay.map((d) => String(d).toUpperCase()).filter((d) => RRULE_DAYS.includes(d)) : undefined,
    interval: typeof r.interval === "number" && r.interval > 1 ? Math.round(r.interval) : undefined,
    until: typeof r.until === "string" && DATE_RE.test(r.until) ? r.until : undefined,
    count: typeof r.count === "number" && r.count > 0 ? Math.round(r.count) : undefined,
  };
}

function normalize(raw: RawEvent[], events: CalEvent[]): Draft[] {
  const byId = new Map(events.filter((e) => e.ours && e.canEdit).flatMap((e) => [[e.id, e] as const, ...(e.recurringEventId ? [[e.recurringEventId, e] as const] : [])]));
  const out: Draft[] = [];
  for (const r of raw) {
    const op = r.op === "update" || r.op === "delete" ? r.op : "create";
    const known = r.id ? byId.get(r.id) : undefined;
    if (op !== "create" && !known) continue; // чужие события не трогаем
    const date = typeof r.date === "string" && DATE_RE.test(r.date) ? r.date : known ? dayKey(known.start) : null;
    if (!date) continue;
    const start = typeof r.start === "string" && TIME_RE.test(r.start) ? r.start : undefined;
    const series = !!r.series && !!known?.recurringEventId;
    out.push({
      key: uid(),
      op,
      eventId: known ? (series || r.id === known.recurringEventId ? known.recurringEventId : known.id) : undefined,
      calendarId: known?.calendarId,
      series: series || (!!known?.recurringEventId && r.id === known.recurringEventId),
      title: (r.title || known?.title || "Событие").slice(0, 200),
      date,
      start,
      end: start && typeof r.end === "string" && TIME_RE.test(r.end) ? r.end : undefined,
      endDate: !start && typeof r.endDate === "string" && DATE_RE.test(r.endDate) ? r.endDate : undefined,
      recurrence: normRecurrence(r.recurrence),
      category: (r.category && r.category in CATEGORIES ? r.category : r.kind === "reminder" ? "reminder" : known?.category ?? "other") as Category,
      location: r.location || undefined,
      description: r.description || undefined,
      kind: r.kind === "reminder" ? "reminder" : known?.kind ?? "event",
      reminders: normReminders(r),
      source: r.source,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""));
}

interface RawTask {
  title?: string;
  deadline?: string;
  deadlineTime?: string;
  estimateMin?: number;
  chunkMin?: number;
  category?: string;
  notes?: string;
}

function normTasks(raw: unknown): PendingTask[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawTask[])
    .filter((t) => t && typeof t.title === "string" && typeof t.deadline === "string" && DATE_RE.test(t.deadline))
    .map((t) =>
      newPending({
        title: t.title!,
        deadline: t.deadline!,
        deadlineTime: typeof t.deadlineTime === "string" && TIME_RE.test(t.deadlineTime) ? t.deadlineTime : undefined,
        estimate: typeof t.estimateMin === "number" ? t.estimateMin : 180,
        chunk: typeof t.chunkMin === "number" ? t.chunkMin : 90,
        category: (t.category && t.category in CATEGORIES && t.category !== "reminder" ? t.category : "study") as Category,
        notes: typeof t.notes === "string" ? t.notes : undefined,
        source: "text",
      }),
    );
}

export async function makePlan(input: PlanInput): Promise<{ summary: string; questions: string[]; drafts: Draft[]; tasks: PendingTask[] }> {
  const r = await ai.json<{ summary?: string; questions?: string[]; events?: RawEvent[]; tasks?: unknown }>(buildPrompt(input), {
    system: SYSTEM,
    images: input.images,
    model: input.prefs.model,
  });
  // Напоминание без времени — во время напоминаний пользователя, а не на весь день.
  const drafts = normalize(Array.isArray(r.events) ? r.events : [], input.events).map((d) => (d.kind === "reminder" && !d.start ? { ...d, start: input.prefs.reminderTime } : d));
  // Блоки задач раскладывает программа — по свободному времени, с учётом новых событий черновика.
  const planned = draftsForTasks(normTasks(r.tasks), {}, input.events, drafts, input.prefs);
  return {
    summary: typeof r.summary === "string" ? r.summary : "",
    questions: Array.isArray(r.questions) ? r.questions.filter((q) => typeof q === "string") : [],
    drafts: [...drafts, ...planned.drafts].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? "")),
    tasks: planned.tasks,
  };
}

/** Пересечения черновика с занятым временем (только для разовых событий со временем). */
export function conflicts(d: Draft, events: CalEvent[]): CalEvent[] {
  if (d.op === "delete" || !d.start || d.recurrence || d.kind === "reminder") return [];
  const s = fromKey(d.date).getTime() + toMinutes(d.start) * 60_000;
  let e = fromKey(d.date).getTime() + (d.end ? toMinutes(d.end) : toMinutes(d.start) + 60) * 60_000;
  if (e <= s) e += 86_400_000;
  return events.filter((x) => !x.allDay && x.kind !== "reminder" && x.id !== d.eventId && x.recurringEventId !== d.eventId && x.start.getTime() < e && x.end.getTime() > s);
}

export function draftWhen(d: Draft): string {
  if (d.kind === "reminder" && d.start) {
    const rep = recurrenceLabel(d.recurrence);
    return `🔔 в ${d.start}${rep ? ` · ${rep}` : ""}`;
  }
  const t = d.start ? `${d.start}${d.end ? `–${d.end}` : ""}` : d.endDate && d.endDate !== d.date ? `весь день, до ${d.endDate.slice(8)}.${d.endDate.slice(5, 7)}` : "весь день";
  const rep = recurrenceLabel(d.recurrence);
  return rep ? `${t} · ${rep}` : t;
}
