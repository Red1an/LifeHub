import * as data from "./data.ts";
import type { Prefs } from "./prefs.ts";
import type { CalEvent, NewEvent } from "./data.ts";
import {
  cleanTitle, dayKey, entityDateTime, findAmount, findDate, findDuration, findTime, has, hhmm, shiftKey, similarity, toMinutes,
  type AliceEntity,
} from "./nlu.ts";
import {
  at, bye, count, dayName, done, eveningOutro, freeDay, fullDate, greeting, hello, inMinutes, join, listing, money, morningOutro,
  speakable, until, type Part, type Say,
} from "./speech.ts";

/*
 * Команды Джарвиса. Всё разбирается правилами, без нейронки: ответ нужен быстрее чем за 3 секунды,
 * а лимиты Claude тратить на «что у меня завтра» незачем. Нераспознанное возвращает null —
 * тогда index.ts решает, звать ли нейронку.
 */

export interface Ctx {
  /** Нормализованная фраза (nlu.normalize). */
  text: string;
  /** Как распознала Алиса. */
  raw: string;
  entities: AliceEntity[];
  state: SessionState;
  address: string;
  /** Настройки из модуля «Джарвис». */
  prefs: Prefs;
  now: Date;
}

type StoredEvent = { id: string; calendarId: string; title: string; start: string; end: string; allDay: boolean; kind: "event" | "reminder" };

type Pending =
  | { kind: "event"; draft: NewEvent }
  | { kind: "eventTime"; draft: NewEvent }
  | { kind: "move"; ev: StoredEvent; date: string; start?: string }
  | { kind: "cancel"; ev: StoredEvent }
  | { kind: "quiz"; cardId: string; revealed: boolean }
  | { kind: "ai"; key: string };

export interface SessionState {
  pending?: Pending;
  /** Последняя запись, которую можно отменить словом «отмени». */
  undo?: { module: string; collection: string; id: string; what: string };
}

export interface Reply {
  say: Say;
  /** Завершить сессию навыка (вернуть колонку Алисе). */
  end?: boolean;
  buttons?: string[];
  state?: SessionState;
}

const reply = (say: Say | string, extra: Omit<Reply, "say"> = {}): Reply => ({ say: typeof say === "string" ? { text: say, tts: say } : say, ...extra });

const YES = /^(да|ага|угу|конечно|верно|точно|давай|ставь|подтверждаю|ок|окей|хорошо|именно|все верно|да верно|да ставь|да давай|удаляй|переноси|ещ[её]|дальше|следующий)(\s|$)/;
const NO = /^(нет|не надо|не нужно|не ставь|отмена|не так|неверно|стоп|не)(\s|$)/;

const quoted = (s: string) => `«${s}»`;

function store(e: CalEvent): StoredEvent {
  return { id: e.id, calendarId: e.calendarId, title: e.title, start: e.start.toISOString(), end: e.end.toISOString(), allDay: e.allDay, kind: e.kind };
}

/* ───────────── маршрутизатор ───────────── */

export async function handle(ctx: Ctx): Promise<Reply | null> {
  const t = ctx.text;
  const p = ctx.state.pending;

  if (p) {
    const r = await continuePending(ctx, p);
    if (r) return r;
  }

  if (/^(отмени|отмена|верни|удали это|отмени это|отмени последнее|удали последнее)$/.test(t) && ctx.state.undo) {
    const u = ctx.state.undo;
    data.removeDoc(u.module, u.collection, u.id);
    return reply(`Отменил: ${u.what}.`, { state: {} });
  }
  if (/^(хватит|спасибо|пока|выход|выйти|все|все спасибо|до свидания|отбой|свободен|можешь идти)$/.test(t) || /^спасибо/.test(t)) {
    return reply(bye(ctx.address), { end: true });
  }
  if (!t || /^(джарвис|привет|ты тут|ты здесь|алло)$/.test(t)) return reply(hello(ctx.address));
  if (/^(нет|ничего|не надо|не нужно|никак)$/.test(t)) return reply("Хорошо.", { end: true });
  if (/(что ты умеешь|что умеешь|помощь|помоги|какие команды|список команд|что ты можешь)/.test(t)) return help();

  if (/(что я (записывал|запоминал|сохранял|записал)|найди (заметк|в заметках)|в заметках|напомни что я)/.test(t)) return need("notes", () => searchNotes(ctx));
  if (/(^|\s)(напомни|напомнить)(\s|$)/.test(t)) return addEvent(ctx, true);
  if (/(^|\s)(добавь|добавить|поставь|запланируй|создай|внеси|назначь|запиши в календарь|запиши на)(\s|$)/.test(t) && !has(t, "заметк", "иде", "трат", "расход")) {
    return addEvent(ctx, false);
  }
  if (/(^|\s)(перенеси|передвинь|сдвинь|подвинь)(\s|$)/.test(t)) return moveEvent(ctx);
  if (/(^|\s)(отмени|удали|убери)\s+\S/.test(t) && !/(отмени|удали) (это|последн)/.test(t)) return cancelEvent(ctx);

  if (/(сколько (я )?(потратил|потратила|ушло|трат)|мои (траты|расходы)|траты за|расходы за|какой бюджет|сколько осталось (в бюджете|денег))/.test(t)) return need("finance", () => spending(ctx));
  if (/(^|\s)(потратил|потратила|заплатил|заплатила|купил|купила|расход|отдал|отдала|минус)(\s|$)/.test(t) && findAmount(t)) return need("finance", () => addTx(ctx, "expense"));
  if (/(^|\s)(получил|получила|заработал|заработала|пришла|пришло|пришли|доход|перевели|плюс)(\s|$)/.test(t) && findAmount(t)) return need("finance", () => addTx(ctx, "income"));

  if (/(^|\s)(отметь|отмечай|отметить|я сделал|я сделала|сделал|сделала|выполнил|выполнила|я выпил|выпил|прочитал|прочитала)(\s|$)/.test(t)) {
    const r = checkHabit(ctx);
    if (r) return r;
  }
  if (/^(запомни|запиши|заметка|новая заметка|идея|сохрани|добавь заметку|запиши заметку|запиши идею)(\s|$)/.test(t)) return need("notes", () => addNote(ctx));

  if (/(итог|добрый вечер|спокойной ночи|вечерн|как прош(ел|ла) день)/.test(t)) return evening(ctx);
  if (/(доброе утро|утренн|брифинг|сводк|повестк|план на день|что меня ждет|как мой день|расскажи про день|что по дню)/.test(t)) return morning(ctx);
  if (/(что дальше|что следующ|ближайш|что сейчас|следующ\S* (событие|пара|встреча|дело)|куда мне|когда (следующ|ближайш))/.test(t)) return next(ctx);
  if (/(свобод|окн[оа]|когда я могу|есть время|когда есть время)/.test(t)) return free(ctx);
  if (/(дедлайн|мои задачи|какие задачи|задачи на)/.test(t)) return deadlines(ctx);
  if (/(на (этой |следующей )?неделе|на неделю|недел(я|ю) (у меня|загружен))/.test(t)) return week(ctx);
  if (/(привычк)/.test(t)) return need("habits", () => habitsToday(ctx));
  if (/(задай вопрос|проверь меня|викторин|погоняй|карточк|экзаменуй|спроси меня|вопрос по)/.test(t)) return need("devpath", () => quiz(ctx));
  if (/(девпа|dev ?path|что учить|по учебе|задания дня|обучени|что изучать)/.test(t)) return need("devpath", () => devpath(ctx));
  if (/(трениров|зарядк|спорт|форм[аеу] (на|за))/.test(t)) return need("fit", () => fit());
  if (/(гитар)/.test(t)) return need("guitar", () => guitar(ctx));
  if (/(портфел|инвестиц|акци|брокер|бирж|облигац)/.test(t)) return need("invest", () => invest());
  if (/(что у меня|расписани|какие (пары|планы|дела|события|встречи)|что запланировано|какие у меня|планы на|что по плану|(^|\s)пары|что (сегодня|завтра|послезавтра)|что в (понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|чем я занят)/.test(t)) {
    return agenda(ctx);
  }
  return null;
}

const MODULE_NAMES: Record<string, string> = {
  notes: "Заметки", finance: "Финансы", habits: "Привычки", devpath: "DevPath", fit: "Форма", guitar: "Гитара", invest: "Инвестиции",
};

/** Команда модуля: выключенный модуль — так и говорим, а не делаем вид, что данных нет. */
function need(id: string, fn: () => Reply | Promise<Reply>): Reply | Promise<Reply> {
  if (!data.enabled(id)) return reply(`Модуль «${MODULE_NAMES[id] ?? id}» выключен в хабе. Включите его, и я смогу с ним работать.`);
  return fn();
}

/* ───────────── ожидание ответа ───────────── */

async function continuePending(ctx: Ctx, p: Pending): Promise<Reply | null> {
  const t = ctx.text;
  if (p.kind === "event") {
    // Поправка: «нет, давай в 8» / «в пятницу» / «на полчаса».
    const time = findTime(t, ctx.now);
    const date = findDate(t, ctx.now);
    const dur = findDuration(t);
    if (time || date || dur) {
      let start = time?.value.time ?? p.draft.start;
      // Было «в 19», поправили на «в 8» — скорее 20:00, чем 08:00.
      if (time && !time.value.date && start && p.draft.start && toMinutes(p.draft.start) >= 12 * 60 && toMinutes(start) < 12 * 60 && !/утра/.test(t)) {
        start = `${String(Number(start.slice(0, 2)) + 12).padStart(2, "0")}${start.slice(2)}`;
      }
      return confirmEvent(ctx, { ...p.draft, start, date: time?.value.date ?? date?.value ?? p.draft.date, minutes: dur?.value ?? p.draft.minutes });
    }
    if (YES.test(t)) {
      await data.createEvent(p.draft);
      return reply(join([done(ctx.address), describeDraft(p.draft, "Поставил")]), { state: {} });
    }
    if (NO.test(t)) return reply("Хорошо, не ставлю.", { state: {} });
    return null;
  }
  if (p.kind === "eventTime") {
    if (NO.test(t)) return reply("Хорошо, не ставлю.", { state: {} });
    if (/весь день|на день|целый день/.test(t)) return confirmEvent(ctx, { ...p.draft, start: undefined });
    const time = findTime(/^\d/.test(t) ? `в ${t}` : t, ctx.now);
    const dur = findDuration(t);
    if (time) return confirmEvent(ctx, { ...p.draft, start: time.value.time, minutes: dur?.value ?? p.draft.minutes });
    return reply("Не расслышал время. Скажите, например, «в 7 вечера» или «на весь день».", { state: ctx.state });
  }
  if (p.kind === "move") {
    if (YES.test(t)) {
      await data.moveEvent(revive(p.ev), p.date, p.start);
      return reply(`${done(ctx.address)} ${quoted(p.ev.title)} теперь ${dayName(p.date, ctx.now)}${p.start ? ` ${at(p.start).text}` : ""}.`, { state: {} });
    }
    if (NO.test(t)) return reply("Оставил как было.", { state: {} });
    return null;
  }
  if (p.kind === "cancel") {
    if (YES.test(t)) {
      await data.deleteEvent(p.ev);
      return reply(`Удалил ${quoted(p.ev.title)}.`, { state: {} });
    }
    if (NO.test(t)) return reply("Оставил.", { state: {} });
    return null;
  }
  if (p.kind === "quiz") {
    if (/^(хватит|стоп|все|закончим|достаточно)/.test(t)) return reply("Хорошо, закончим. Знания — сила.", { state: {} });
    if (!p.revealed) {
      const card = data.devpathCards().find((c) => c.id === p.cardId);
      if (!card) return quiz(ctx);
      const back = speakable(card.back);
      return reply(
        { text: `Ответ: ${card.back}\n\nЕщё вопрос?`, tts: `Ответ. sil <[300]> ${back.slice(0, 700)} sil <[400]> Ещё вопрос?` },
        { buttons: ["Ещё", "Хватит"], state: { pending: { kind: "quiz", cardId: p.cardId, revealed: true } } },
      );
    }
    if (YES.test(t)) return quiz(ctx);
    if (NO.test(t)) return reply("Хорошо, закончим.", { state: {} });
    return null;
  }
  return null;
}

const revive = (e: StoredEvent): CalEvent => ({ ...e, start: new Date(e.start), end: new Date(e.end), free: e.kind === "reminder" });

/* ───────────── помощь ───────────── */

function help(): Reply {
  return reply(
    join([
      "Я знаю ваш календарь и модули хаба. Например:",
      "«Доброе утро» — сводка дня.",
      "«Что у меня завтра?», «Что дальше?», «Когда я свободен в пятницу?»",
      "«Поставь тренировку завтра в 7 вечера на час», «Напомни через 20 минут выключить плиту», «Перенеси тренировку на час позже».",
      "«Отметь воду», «Потратил 450 на такси», «Сколько я потратил за неделю?»",
      "«Запомни: код от домофона 4512», «Что я записывал про домофон?»",
      "«Задай вопрос по DevPath», «Что с портфелем?», «Итоги дня».",
    ]),
    { buttons: ["Доброе утро", "Что дальше?", "Итоги дня"] },
  );
}

/* ───────────── календарь ───────────── */

function eventLine(e: CalEvent, withEnd = false): Say {
  const title = speakable(e.title) || "событие";
  if (e.allDay) return { text: e.title, tts: title };
  const s = at(hhmm(e.start));
  const end = withEnd ? until(hhmm(e.end)) : null;
  return { text: `${s.text} — ${e.title}${end ? ` (${end.text})` : ""}`, tts: `${s.tts} ${title}${end ? ` ${end.tts}` : ""}` };
}

/** Рассказ о событиях дня: сколько, какие, отдельно — на весь день и напоминания. */
function describeEvents(list: CalEvent[], max = 6): Say | null {
  const timed = list.filter((e) => !e.allDay && e.kind !== "reminder");
  const allDay = list.filter((e) => e.allDay);
  const reminders = list.filter((e) => !e.allDay && e.kind === "reminder");
  if (!list.length) return null;
  const parts: Part[] = [];
  if (timed.length) {
    const shown = timed.slice(0, max).map((e) => eventLine(e));
    const more = timed.length - shown.length;
    const lines = [...shown.map((s) => s), ...(more > 0 ? [{ text: `и ещё ${more}`, tts: `и ещё ${more}` }] : [])];
    parts.push({
      text: `${count(timed.length, "событие", "события", "событий")}: ${listing(lines.map((l) => l.text))}.`,
      tts: `${count(timed.length, "событие", "события", "событий")}: ${listing(lines.map((l) => l.tts))}.`,
    });
  }
  if (allDay.length) parts.push(`На весь день: ${listing(allDay.map((e) => quoted(e.title)))}.`);
  if (reminders.length) {
    const r = reminders.map((e) => eventLine(e));
    parts.push({ text: `Напоминания: ${listing(r.map((x) => x.text))}.`, tts: `Напоминания: ${listing(r.map((x) => x.tts))}.` });
  }
  return join(parts);
}

function targetDate(ctx: Ctx): string {
  return findDate(ctx.text, ctx.now)?.value ?? entityDateTime(ctx.entities, ctx.now).date ?? dayKey(ctx.now);
}

async function agenda(ctx: Ctx): Promise<Reply> {
  const date = targetDate(ctx);
  const list = await data.eventsOn(date);
  const when = dayName(date, ctx.now);
  const head = when.charAt(0).toUpperCase() + when.slice(1);
  const body = describeEvents(list);
  const empty = freeDay();
  return reply(join([`${head} —`, body ?? empty.charAt(0).toLowerCase() + empty.slice(1)]));
}

async function next(ctx: Ctx): Promise<Reply> {
  const now = ctx.now;
  const list = (await data.listEvents(new Date(now.getTime() - 12 * 3600_000), new Date(now.getTime() + 48 * 3600_000))).filter((e) => !e.allDay);
  const current = list.find((e) => e.start <= now && e.end > now && e.kind !== "reminder");
  const upcoming = list.filter((e) => e.start > now);
  const parts: Part[] = [];
  if (current) {
    const u = until(hhmm(current.end));
    parts.push({ text: `Сейчас идёт ${quoted(current.title)} ${u.text}.`, tts: `Сейчас идёт ${speakable(current.title)} ${u.tts}.` });
  }
  const n = upcoming[0];
  if (!n) parts.push(current ? "После этого — ничего." : "Ближайшие двое суток ничего не запланировано.");
  else {
    const mins = Math.round((n.start.getTime() - now.getTime()) / 60_000);
    const sameDay = dayKey(n.start) === dayKey(now);
    const when = sameDay ? at(hhmm(n.start)) : { text: `${dayName(dayKey(n.start), now)} ${at(hhmm(n.start)).text}`, tts: `${dayName(dayKey(n.start), now)} ${at(hhmm(n.start)).tts}` };
    const prefix = current ? "Дальше" : "Ближайшее";
    parts.push({
      text: `${prefix} — ${quoted(n.title)} ${when.text}${mins <= 180 ? `, ${inMinutes(mins)}` : ""}.`,
      tts: `${prefix} — ${speakable(n.title)} ${when.tts}${mins <= 180 ? `, ${inMinutes(mins)}` : ""}.`,
    });
    if (n.location) parts.push(`Место: ${n.location}.`);
  }
  return reply(join(parts));
}

function range(s: string, e: string): Say {
  const f = (x: string) => {
    const [h, m] = x.split(":").map(Number);
    return m ? `${h} ${String(m).padStart(2, "0")}` : String(h);
  };
  return { text: `${s}–${e}`, tts: `с ${f(s)} до ${f(e)}` };
}

async function free(ctx: Ctx): Promise<Reply> {
  const date = targetDate(ctx);
  const slots = data.freeSlots(date, await data.eventsOn(date), 30, ctx.now);
  const when = dayName(date, ctx.now);
  if (!slots.length) return reply(`${when.charAt(0).toUpperCase() + when.slice(1)} свободных окон нет — всё занято.`);
  const shown = slots.slice(0, 5).map((s) => range(s.start, s.end));
  const total = slots.reduce((s, x) => s + toMinutes(x.end) - toMinutes(x.start), 0);
  const hours = Math.round(total / 30) / 2;
  return reply({
    text: `${when.charAt(0).toUpperCase() + when.slice(1)} свободно: ${shown.map((s) => s.text).join(", ")}. Всего около ${String(hours).replace(".", ",")} ч.`,
    tts: `${when} свободно: ${listing(shown.map((s) => s.tts))}.`,
  });
}

async function week(ctx: Ctx): Promise<Reply> {
  const start = /следующ/.test(ctx.text) ? shiftKey(dayKey(ctx.now), 7 - ((ctx.now.getDay() + 6) % 7)) : dayKey(ctx.now);
  const days = Array.from({ length: 7 }, (_, i) => shiftKey(start, i));
  const list = await data.listEvents(new Date(start + "T00:00:00"), new Date(shiftKey(start, 7) + "T00:00:00"));
  const per = days.map((d) => ({ d, n: list.filter((e) => !e.allDay && e.kind !== "reminder" && dayKey(e.start) === d).length }));
  const total = per.reduce((s, x) => s + x.n, 0);
  if (!total) return reply("На неделе в календаре пусто.");
  const busiest = per.reduce((a, b) => (b.n > a.n ? b : a));
  const freeDays = per.filter((x) => x.n === 0).map((x) => dayName(x.d, ctx.now).replace(/^(в|во) /, "").split(",")[0]);
  return reply(
    join([
      `На неделе ${count(total, "событие", "события", "событий")}.`,
      `Больше всего — ${dayName(busiest.d, ctx.now)}: ${busiest.n}.`,
      freeDays.length ? `Свободно: ${listing(freeDays)}.` : "Свободных дней нет.",
    ]),
  );
}

async function deadlines(ctx: Ctx): Promise<Reply> {
  const tasks = data.openTasks().sort((a, b) => a.deadline.localeCompare(b.deadline));
  if (!tasks.length) return reply("Открытых задач с дедлайном нет.");
  const lines = tasks.slice(0, 5).map((t) => {
    const doneMin = t.blocks.filter((b) => b.done).reduce((s, b) => s + b.minutes, 0);
    const pct = t.estimate ? Math.round((doneMin / t.estimate) * 100) : 0;
    return `${quoted(t.title)} — ${t.deadline < dayKey(ctx.now) ? "просрочено" : `до ${dayName(t.deadline, ctx.now).replace(/^(в|во) /, "")}`}${pct ? `, сделано ${pct}%` : ""}`;
  });
  return reply(`${count(tasks.length, "задача", "задачи", "задач")}: ${lines.join("; ")}.`);
}

/* ───────────── добавление, перенос, отмена ───────────── */

function describeDraft(d: NewEvent, verb: string): Say {
  const when = dayName(d.date);
  const time = d.start ? at(d.start) : { text: "на весь день", tts: "на весь день" };
  const len = d.start && d.minutes && d.kind !== "reminder" ? ` на ${d.minutes % 60 === 0 ? count(d.minutes / 60, "час", "часа", "часов") : count(d.minutes, "минуту", "минуты", "минут")}` : "";
  const what = d.kind === "reminder" ? "напоминание " : "";
  return {
    text: `${verb} ${what}${quoted(d.title)} ${when} ${time.text}${len}.`,
    tts: `${verb} ${what}${speakable(d.title)} ${when} ${time.tts}${len}.`,
  };
}

async function confirmEvent(ctx: Ctx, draft: NewEvent): Promise<Reply> {
  let warn = "";
  if (draft.start && draft.kind !== "reminder") {
    const s = toMinutes(draft.start);
    const e = s + (draft.minutes ?? data.plannerPrefs().defaultMinutes);
    const clash = (await data.eventsOn(draft.date).catch(() => [])).find((x) => {
      if (x.allDay || x.free || dayKey(x.start) !== draft.date) return false;
      const xs = x.start.getHours() * 60 + x.start.getMinutes();
      const xe = dayKey(x.end) > draft.date ? 24 * 60 : x.end.getHours() * 60 + x.end.getMinutes();
      return xs < e && xe > s;
    });
    if (clash) warn = ` Учтите: в это время уже ${quoted(clash.title)}.`;
  }
  return reply(join([describeDraft(draft, "Ставлю"), warn.trim(), "Верно?"]), {
    buttons: ["Да", "Нет"],
    state: { pending: { kind: "event", draft } },
  });
}

const ADD_WORDS = ["напомни", "напомнить", "добавь", "добавить", "поставь", "запланируй", "создай", "внеси", "назначь", "запиши", "мне", "пожалуйста"];

async function addEvent(ctx: Ctx, reminder: boolean): Promise<Reply> {
  let rest = ctx.text.replace(new RegExp(`(^|\\s)(${ADD_WORDS.join("|")})(?=\\s|$)`, "g"), " ").replace(/\s+/g, " ").trim();
  const time = findTime(rest, ctx.now);
  if (time) rest = time.rest;
  const date = findDate(rest, ctx.now);
  if (date) rest = date.rest;
  const dur = findDuration(rest);
  if (dur) rest = dur.rest;
  const ent = entityDateTime(ctx.entities, ctx.now);

  let start = time?.value.time ?? (!date ? ent.time : undefined);
  let day = time?.value.date ?? date?.value ?? ent.date;
  const title = restoreCase(reminder ? cleanTitle(rest, ["о", "об", "напоминание", "что", "чтобы"]) : nominative(cleanTitle(rest)), ctx.raw);
  if (!title) return reply(reminder ? "О чём напомнить? Скажите, например: «напомни завтра в 9 позвонить маме»." : "Что поставить? Например: «поставь тренировку завтра в 7 вечера».");

  if (reminder) {
    start ??= data.plannerPrefs().reminderTime;
    if (!day) day = toMinutes(start) > ctx.now.getHours() * 60 + ctx.now.getMinutes() ? dayKey(ctx.now) : shiftKey(dayKey(ctx.now), 1);
    return confirmEvent(ctx, { title, date: day, start, kind: "reminder", category: "reminder" });
  }
  const draft: NewEvent = { title, date: day ?? dayKey(ctx.now), start, minutes: dur?.value, kind: "event", category: data.guessCategory(title, false) };
  if (!start) {
    return reply(`${quoted(title)} ${dayName(draft.date, ctx.now)} — во сколько? Или скажите «на весь день».`, {
      buttons: ["На весь день", "Отмена"],
      state: { pending: { kind: "eventTime", draft } },
    });
  }
  // Время уже прошло, а день не назван — значит, завтра.
  if (!day && toMinutes(start) < ctx.now.getHours() * 60 + ctx.now.getMinutes()) draft.date = shiftKey(dayKey(ctx.now), 1);
  return confirmEvent(ctx, draft);
}

/** Имена с заглавной, как их записала Алиса: «встреча с Максом», а не «с максом». */
function restoreCase(title: string, raw: string): string {
  const caps = new Map<string, string>();
  for (const w of raw.split(/[^\p{L}\d-]+/u)) if (/^\p{Lu}/u.test(w)) caps.set(w.toLowerCase().replace(/ё/g, "е"), w);
  return title
    .split(" ")
    .map((w, i) => (i > 0 && caps.has(w) ? caps.get(w)! : w))
    .join(" ");
}

/** «Тренировку» → «Тренировка», «лекцию» → «лекция»: первое слово названия в именительном падеже. */
function nominative(title: string): string {
  return title.replace(/^(\S{3,}?)([бвгджзклмнпрстфхцчшщ])у(?=\s|$)/i, "$1$2а").replace(/^(\S{3,}?)ию(?=\s|$)/i, "$1ия");
}

/** Событие по названию из фразы: ближайшее подходящее в ближайшие две недели. */
async function findEvent(ctx: Ctx, phrase: string, date?: string): Promise<CalEvent | null> {
  const from = date ? new Date(date + "T00:00:00") : new Date(ctx.now.getTime() - 3600_000);
  const to = date ? new Date(shiftKey(date, 1) + "T00:00:00") : new Date(ctx.now.getTime() + 14 * 86400_000);
  const list = (await data.listEvents(from, to)).filter((e) => date || e.end > ctx.now);
  // «перенеси пару», «отмени занятие» — ближайшее событие.
  if (/^(пар[уаы]|заняти[ея])$/i.test(phrase)) {
    return list.find((e) => !e.allDay && /лекци|практик|лаб|семинар|пара|🎓|🧪|📝/i.test(e.title)) ?? null;
  }
  if (/^(событие|встречу|следующ\S*|ближайш\S*)$/i.test(phrase)) return list.find((e) => !e.allDay && e.kind !== "reminder") ?? null;
  let best: CalEvent | null = null;
  let score = 0;
  for (const e of list) {
    // Доля слов фразы, которые есть в названии события.
    const s = similarity(e.title, phrase);
    if (s > score) {
      best = e;
      score = s;
    }
  }
  return score >= 0.5 ? best : null;
}

async function moveEvent(ctx: Ctx): Promise<Reply> {
  let rest = ctx.text.replace(/(^|\s)(перенеси|передвинь|сдвинь|подвинь|мне|пожалуйста)(?=\s|$)/g, " ").trim();
  let shift = 0;
  const sm = rest.match(/(^|\s)на (\d+|час|полчаса|полтора часа)\s*(минут\S*|час\S*)?\s*(позже|раньше|вперед|назад)(?=\s|$)/);
  if (sm) {
    const n = sm[2] === "час" ? 60 : sm[2] === "полчаса" ? 30 : sm[2] === "полтора часа" ? 90 : Number(sm[2]) * (/^час/.test(sm[3] ?? "") ? 60 : 1);
    shift = /позже|вперед/.test(sm[4]) ? n : -n;
    rest = rest.replace(sm[0], " ");
  }
  const time = findTime(rest, ctx.now);
  if (time) rest = time.rest;
  // Дата после «на» — новая; «тренировку с завтра» — старая, это редкость, считаем новой.
  const date = findDate(rest, ctx.now);
  if (date) rest = date.rest;
  const phrase = cleanTitle(rest);
  if (!phrase) return reply("Что перенести? Например: «перенеси тренировку на час позже».");
  const ev = await findEvent(ctx, phrase);
  if (!ev) return reply(`Не нашёл ${quoted(phrase)} в ближайшие две недели.`);

  let newDate = date?.value ?? dayKey(ev.start);
  let newStart = time?.value.time ?? (ev.allDay ? undefined : hhmm(ev.start));
  if (shift && newStart) {
    const m = toMinutes(newStart) + shift;
    newDate = shiftKey(newDate, Math.floor(m / 1440));
    newStart = `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;
  }
  if (!shift && !time && !date) return reply(`Куда перенести ${quoted(ev.title)}? Скажите, например, «на завтра в 8» или «на час позже».`);
  const was = `${dayName(dayKey(ev.start), ctx.now)}${ev.allDay ? "" : ` ${at(hhmm(ev.start)).text}`}`;
  const to = `${dayName(newDate, ctx.now)}${newStart ? ` ${at(newStart).text}` : ""}`;
  return reply(join([`Переношу ${quoted(ev.title)} на ${to.replace(/^(в|во) /, "")}.`, `Было — ${was}.`, "Верно?"]), { buttons: ["Да", "Нет"], state: { pending: { kind: "move", ev: store(ev), date: newDate, start: newStart } } });
}

async function cancelEvent(ctx: Ctx): Promise<Reply> {
  let rest = ctx.text.replace(/(^|\s)(отмени|удали|убери|из календаря|мне|пожалуйста|событие)(?=\s|$)/g, " ").trim();
  const date = findDate(rest, ctx.now);
  if (date) rest = date.rest;
  const phrase = cleanTitle(rest);
  if (!phrase) return reply("Что отменить?");
  const ev = await findEvent(ctx, phrase, date?.value);
  if (!ev) return reply(`Не нашёл ${quoted(phrase)}${date ? ` ${dayName(date.value, ctx.now)}` : " в ближайшие две недели"}.`);
  const when = `${dayName(dayKey(ev.start), ctx.now)}${ev.allDay ? "" : ` ${at(hhmm(ev.start)).text}`}`;
  return reply(`Удалить ${quoted(ev.title)} ${when}?`, { buttons: ["Да", "Нет"], state: { pending: { kind: "cancel", ev: store(ev) } } });
}

/* ───────────── привычки ───────────── */

function checkHabit(ctx: Ctx): Reply | null {
  const list = data.habits();
  if (!list.length) return null;
  const phrase = ctx.text.replace(/(^|\s)(отметь|отмечай|отметить|я|сделал|сделала|выполнил|выполнила|привычку|сегодня)(?=\s|$)/g, " ");
  let best: data.Habit | null = null;
  let score = 0;
  for (const h of list) {
    const s = similarity(phrase, h.name);
    if (s > score) {
      best = h;
      score = s;
    }
  }
  if (!best || score < 0.5) {
    if (!/привычк/.test(ctx.text)) return null;
    return reply(`Какую? У вас: ${listing(list.map((h) => h.name))}.`);
  }
  const date = findDate(ctx.text, ctx.now)?.value ?? dayKey(ctx.now);
  const id = data.checkHabit(best.id, date);
  const today = data.habitsFor(dayKey(ctx.now));
  const h = today.find((x) => x.id === best!.id);
  const left = today.filter((x) => !x.done);
  return reply(
    join([
      `Отметил ${quoted(best.name)}${date !== dayKey(ctx.now) ? ` ${dayName(date, ctx.now)}` : ""}.`,
      h && h.streak > 1 ? `Серия — ${count(h.streak, "день", "дня", "дней")}.` : null,
      left.length ? `Осталось: ${listing(left.map((x) => x.name))}.` : "На сегодня все привычки выполнены.",
    ]),
    { state: { undo: { module: "habits", collection: "checks", id, what: `отметку ${quoted(best.name)}` } } },
  );
}

function habitsToday(ctx: Ctx): Reply {
  const today = data.habitsFor(dayKey(ctx.now));
  if (!today.length) return reply("На сегодня привычек нет.");
  const left = today.filter((h) => !h.done);
  const top = [...today].sort((a, b) => b.streak - a.streak)[0];
  return reply(
    join([
      left.length ? `Осталось ${left.length} из ${today.length}: ${listing(left.map((h) => h.name))}.` : `Все ${today.length} привычек на сегодня выполнены.`,
      top.streak >= 3 ? `Лучшая серия — ${quoted(top.name)}, ${count(top.streak, "день", "дня", "дней")}.` : null,
    ]),
  );
}

/* ───────────── финансы ───────────── */

const EXPENSE_WORDS: [string, RegExp][] = [
  ["Продукты", /продукт|магазин|пятерочк|магнит|перекрест|ашан|вкусвилл|лента|овощ|молок|хлеб/],
  ["Кафе", /кафе|кофе|обед|ужин|завтрак|ресторан|шаурм|пицц|доставк|бургер|макдак|вкусно и точка|суши|роллы|столов/],
  ["Транспорт", /такси|метро|автобус|бензин|заправк|транспорт|электричк|самокат|каршеринг|проезд|парковк|тройк/],
  ["Дом", /квартир|коммуналк|жкх|аренд|ремонт|мебел|хозтовар/],
  ["Здоровье", /аптек|лекарств|врач|стоматолог|анализ|здоровь|витамин/],
  ["Развлечения", /кино|игр|концерт|развлеч|клуб|steam|стим|театр|бар/],
  ["Одежда", /одежд|обув|кроссовк|куртк|джинс|футболк|штаны/],
  ["Подписки", /подписк|плюс|spotify|netflix|vpn|впн|связь|телефон|интернет|хостинг|домен/],
];

function addTx(ctx: Ctx, kind: "expense" | "income"): Reply {
  const amount = findAmount(ctx.text)!;
  let rest = amount.rest;
  const date = findDate(rest, ctx.now);
  if (date) rest = date.rest;
  const cats = data.financeCategories().filter((c) => c.kind === kind).map((c) => c.name);
  let category: string | undefined;
  if (kind === "expense") {
    category = EXPENSE_WORDS.find(([name, re]) => re.test(rest) && cats.includes(name))?.[0];
    category ??= cats.find((c) => similarity(rest, c) >= 1);
    category ??= cats.includes("Другое") ? "Другое" : cats[0];
  } else {
    category = /подработ|заказ|фриланс/.test(rest) ? "Подработка" : /подар/.test(rest) ? "Подарки" : /зарплат|аванс/.test(rest) ? "Зарплата" : undefined;
    if (!category || !cats.includes(category)) category = cats.find((c) => similarity(rest, c) >= 1) ?? cats[0];
  }
  const note = cleanTitle(
    rest.replace(/(^|\s)(потратил|потратила|заплатил|заплатила|купил|купила|расход|отдал|отдала|минус|получил|получила|заработал|заработала|пришла|пришло|пришли|доход|перевели|плюс|за|на)(?=\s|$)/g, " ").replace(/\s+/g, " ").trim(),
  );
  const tx = { kind, amount: amount.value, category: category ?? "Другое", date: date?.value ?? dayKey(ctx.now), ...(note && similarity(note, category ?? "") < 1 ? { note } : {}) };
  const doc = data.addDoc("finance", "transactions", tx);
  const m = money(amount.value);
  const parts: Part[] = [{ text: `Записал ${kind === "expense" ? "расход" : "доход"} ${m.text} — ${tx.category}${tx.note ? ` (${tx.note.toLowerCase()})` : ""}.`, tts: `Записал ${kind === "expense" ? "расход" : "доход"} ${m.tts}, ${tx.category}.` }];
  const budget = data.monthlyBudget();
  if (kind === "expense" && budget > 0) {
    const month = dayKey(ctx.now).slice(0, 7);
    const spent = data.expenses().filter((t) => t.date.startsWith(month)).reduce((s, t) => s + t.amount, 0);
    const left = money(Math.abs(budget - spent));
    parts.push(budget >= spent ? { text: `В бюджете месяца осталось ${left.text}.`, tts: `В бюджете месяца осталось ${left.tts}.` } : { text: `Бюджет месяца превышен на ${left.text}.`, tts: `Бюджет месяца превышен на ${left.tts}.` });
  }
  return reply(join(parts), { state: { undo: { module: "finance", collection: "transactions", id: doc.id, what: `${kind === "expense" ? "расход" : "доход"} ${m.text}` } } });
}

function spending(ctx: Ctx): Reply {
  const t = ctx.text;
  const today = dayKey(ctx.now);
  let from: string;
  let to = today;
  let label: string;
  const d = findDate(t, ctx.now);
  if (d) {
    from = to = d.value;
    label = dayName(d.value, ctx.now);
  } else if (/недел/.test(t)) {
    from = shiftKey(today, -((ctx.now.getDay() + 6) % 7));
    label = "на этой неделе";
  } else {
    from = today.slice(0, 7) + "-01";
    label = "в этом месяце";
  }
  const list = data.expenses().filter((x) => x.date >= from && x.date <= to);
  if (!list.length) return reply(`${label.charAt(0).toUpperCase() + label.slice(1)} трат нет.`);
  const total = list.reduce((s, x) => s + x.amount, 0);
  const by = new Map<string, number>();
  for (const x of list) by.set(x.category, (by.get(x.category) ?? 0) + x.amount);
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const m = money(total);
  const parts: Part[] = [{ text: `${label.charAt(0).toUpperCase() + label.slice(1)} потрачено ${m.text}.`, tts: `${label} потрачено ${m.tts}.` }];
  if (top.length) {
    const tops = top.map(([c, v]) => ({ text: `${c} — ${money(v).text}`, tts: `${c} — ${money(v).tts}` }));
    parts.push({ text: `Больше всего: ${listing(tops.map((x) => x.text))}.`, tts: `Больше всего: ${listing(tops.map((x) => x.tts))}.` });
  }
  const budget = data.monthlyBudget();
  if (budget > 0 && !d && !/недел/.test(t)) {
    const left = money(Math.abs(budget - total));
    parts.push(budget >= total ? { text: `До лимита ${left.text}.`, tts: `До лимита ${left.tts}.` } : { text: `Лимит превышен на ${left.text}.`, tts: `Лимит превышен на ${left.tts}.` });
  }
  return reply(join(parts));
}

/* ───────────── заметки ───────────── */

function addNote(ctx: Ctx): Reply {
  const raw = ctx.raw.replace(/^\s*(джарвис[,\s]*)?(запомни|запиши|новая заметка|заметка|идея|сохрани|добавь заметку|запиши заметку|запиши идею)[:,\s-]*/i, "").trim();
  if (!raw) return reply("Что записать? Скажите, например: «запомни: код от домофона 4512».");
  const body = raw.charAt(0).toUpperCase() + raw.slice(1);
  const words = body.split(/\s+/);
  const title = words.slice(0, 6).join(" ").replace(/[.,:;!?]+$/, "") + (words.length > 6 ? "…" : "");
  // Во «Входящие» новых «Заметок» — разобрать потом; старой версии модуля лишние поля не мешают.
  const doc = data.addDoc("notes", "notes", { title, body, tags: ["алиса"], pinned: false, status: "inbox", source: "voice", capturedAt: Date.now() });
  return reply(`Записал в заметки: ${quoted(title)}.`, { state: { undo: { module: "notes", collection: "notes", id: doc.id, what: "заметку" } } });
}

function searchNotes(ctx: Ctx): Reply {
  const q = ctx.text
    .replace(/(что я (записывал|запоминал|сохранял|записал)|найди (заметку|заметки|в заметках)|в заметках|напомни что я \S+|напомни)/, " ")
    .replace(/(^|\s)(про|о|об|по|насчет|мне|пожалуйста)(?=\s|$)/g, " ")
    .trim();
  const list = data.notes();
  if (!q) {
    const last = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
    return reply(last.length ? `Последние заметки: ${listing(last.map((n) => quoted(n.title || "без названия")))}.` : "Заметок пока нет.");
  }
  const scored = list
    .map((n) => ({ n, s: similarity(`${n.title} ${n.body} ${(n.tags ?? []).join(" ")}`, q) }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s || b.n.updatedAt - a.n.updatedAt);
  if (!scored.length) return reply(`Про ${quoted(q)} в заметках ничего нет.`);
  const n = scored[0].n;
  const body = speakable(n.body.replace(/[#>*_`~\[\]()!-]/g, " ")).slice(0, 400);
  // Заметки с голоса: название — начало текста, читать его дважды незачем.
  const title = n.title && !n.body.startsWith(n.title.replace(/…$/, "")) ? n.title : "";
  return reply(
    join([
      { text: `${title ? quoted(title) + ": " : ""}${n.body.slice(0, 600)}`, tts: `${title ? speakable(title) + ". " : ""}${body}` },
      scored.length > 1 ? `Ещё ${count(scored.length - 1, "заметка", "заметки", "заметок")} на эту тему — в хабе.` : null,
    ]),
  );
}

/* ───────────── DevPath, Форма, Гитара, Инвестиции ───────────── */

function devpath(ctx: Ctx): Reply {
  const today = dayKey(ctx.now);
  const quests = data.devpathDay(today);
  const xp = data.devpathXp(today);
  if (!quests) return reply("План DevPath на сегодня ещё не собран — откройте DevPath в хабе, он составит задания дня.");
  const left = quests.filter((q) => !q.done);
  if (!left.length) return reply(`Все задания DevPath на сегодня выполнены${xp ? `, плюс ${xp} опыта` : ""}. Отличная работа.`);
  return reply(
    join([
      `В DevPath ${count(left.length, "задание", "задания", "заданий")} из ${quests.length}: ${listing(left.slice(0, 4).map((q) => quoted(q.title)))}.`,
      xp ? `Сегодня уже ${xp} опыта.` : null,
    ]),
  );
}

function quiz(_ctx: Ctx): Reply {
  const cards = data.devpathCards();
  if (!cards.length) return reply("Карточек в DevPath пока нет.", { state: {} });
  const card = cards[Math.floor(Math.random() * cards.length)];
  return reply(
    { text: `${card.front}\n\nСкажите «ответ», когда будете готовы.`, tts: `${speakable(card.front)} sil <[500]> Скажите «ответ», когда будете готовы.` },
    { buttons: ["Ответ", "Хватит"], state: { pending: { kind: "quiz", cardId: card.id, revealed: false } } },
  );
}

function fit(): Reply {
  const w = data.fitWeek();
  const parts: string[] = [];
  parts.push(w.perWeek ? `На этой неделе ${w.workouts} из ${count(w.perWeek, "тренировки", "тренировок", "тренировок")}.` : `На этой неделе ${count(w.workouts, "тренировка", "тренировки", "тренировок")}.`);
  if (w.morning) parts.push(`Зарядок — ${w.morning}.`);
  if (w.perWeek && w.workouts < w.perWeek) parts.push("Самое время для ещё одной — откройте «Форму».");
  return reply(join(parts));
}

function guitar(ctx: Ctx): Reply {
  const days = data.guitarDays();
  if (!days.length) return reply("Занятий на гитаре пока не было. Самое время начать.");
  const weekAgo = shiftKey(dayKey(ctx.now), -6);
  const week = days.filter((d) => d >= weekAgo).length;
  const last = days[days.length - 1];
  return reply(`За неделю — ${count(week, "день", "дня", "дней")} с гитарой. Последний раз ${dayName(last, ctx.now).replace(/^(в|во) /, "")}.`);
}

function portfolioLine(ctx?: Ctx): Say | null {
  const snaps = data.portfolioSnapshots();
  const last = snaps[snaps.length - 1];
  if (!last) return null;
  if (ctx && last.date < shiftKey(dayKey(ctx.now), -3)) return null;
  const prev = snaps[snaps.length - 2];
  const v = money(last.value);
  const profit = last.value - last.invested;
  const parts: Part[] = [{ text: `Портфель — ${v.text}.`, tts: `Портфель — ${v.tts}.` }];
  if (prev) {
    const d = last.value - prev.value;
    const dm = money(Math.abs(d));
    if (Math.abs(d) >= 1) parts.push({ text: `За день ${d > 0 ? "+" : "−"}${dm.text}.`, tts: `За день ${d > 0 ? "плюс" : "минус"} ${dm.tts}.` });
  }
  if (!ctx) {
    const pm = money(Math.abs(profit));
    const pct = last.invested ? ((profit / last.invested) * 100).toFixed(1).replace(".", ",") : "0";
    parts.push({ text: `Всего ${profit >= 0 ? "в плюсе" : "в минусе"} на ${pm.text} (${pct}%).`, tts: `Всего ${profit >= 0 ? "в плюсе" : "в минусе"} на ${pm.tts}, это ${pct} процента.` });
  }
  return join(parts);
}

function invest(): Reply {
  const line = portfolioLine();
  return reply(line ?? "Данных по портфелю нет — откройте «Инвестиции» в хабе, чтобы они обновились.");
}

/* ───────────── сводки ───────────── */

async function morning(ctx: Ctx): Promise<Reply> {
  const date = findDate(ctx.text, ctx.now)?.value ?? dayKey(ctx.now);
  const isToday = date === dayKey(ctx.now);
  const events = await data.eventsOn(date).catch(() => null);
  const parts: Part[] = [];
  parts.push(isToday ? `${greeting(ctx.address, ctx.now)} Сегодня ${fullDate(date).toLowerCase()}.` : `${fullDate(date)}.`);
  const m = ctx.prefs.morning;
  if (m.events) {
    if (!events) parts.push("Календарь сейчас недоступен.");
    else {
      const d = describeEvents(events, 5);
      parts.push(d ? join([`${isToday ? "Сегодня" : "В этот день"}`, d]) : freeDay());
    }
  }
  const soon = !m.deadlines ? [] : data.openTasks().filter((t) => t.deadline <= shiftKey(date, 3)).sort((a, b) => a.deadline.localeCompare(b.deadline));
  if (soon.length) parts.push(`Дедлайны: ${listing(soon.slice(0, 3).map((t) => `${quoted(t.title)} ${t.deadline < dayKey(ctx.now) ? "— просрочено" : dayName(t.deadline, ctx.now)}`))}.`);
  if (isToday) {
    const habits = !m.habits ? [] : data.habitsFor(date).filter((h) => !h.done);
    if (habits.length) parts.push(`Привычки: ${listing(habits.map((h) => h.name))}.`);
    const streak = habits.filter((h) => h.streak >= 3).sort((a, b) => b.streak - a.streak)[0];
    if (streak) parts.push(`Серия ${quoted(streak.name)} — ${count(streak.streak, "день", "дня", "дней")}, не прерывайте.`);
    const quests = !m.devpath ? null : data.devpathDay(date)?.filter((q) => !q.done);
    if (quests?.length) parts.push(`В DevPath ${count(quests.length, "задание", "задания", "заданий")}, первое — ${quoted(quests[0].title)}.`);
    const p = m.portfolio ? portfolioLine(ctx) : null;
    if (p) parts.push(p);
  }
  parts.push(morningOutro());
  return reply(join(parts, 400));
}

async function evening(ctx: Ctx): Promise<Reply> {
  const today = dayKey(ctx.now);
  const tomorrow = shiftKey(today, 1);
  const parts: Part[] = [`Итоги дня${ctx.address ? `, ${ctx.address}` : ""}.`];
  const ev = ctx.prefs.evening;
  const habits = ev.habits ? data.habitsFor(today) : [];
  if (habits.length) {
    const left = habits.filter((h) => !h.done);
    parts.push(left.length ? `Привычки: ${habits.length - left.length} из ${habits.length}, не отмечены ${listing(left.map((h) => h.name))}.` : `Все привычки выполнены.`);
  }
  const spent = !ev.spending ? 0 : data.expenses().filter((t) => t.date === today).reduce((s, t) => s + t.amount, 0);
  if (spent) {
    const m = money(spent);
    parts.push({ text: `Потрачено ${m.text}.`, tts: `Потрачено ${m.tts}.` });
  }
  const xp = data.devpathXp(today);
  const quests = ev.devpath ? data.devpathDay(today) : null;
  if (quests) {
    const doneQ = quests.filter((q) => q.done).length;
    parts.push(doneQ ? `DevPath: ${doneQ} из ${quests.length} заданий${xp ? `, ${xp} опыта` : ""}.` : "DevPath сегодня не открывали.");
  }
  const events = ev.tomorrow ? await data.eventsOn(tomorrow).catch(() => null) : null;
  if (events) {
    const timed = events.filter((e) => !e.allDay && e.kind !== "reminder");
    if (!timed.length) parts.push("Завтра в календаре свободно.");
    else {
      const first = eventLine(timed[0]);
      parts.push({
        text: `Завтра ${count(timed.length, "событие", "события", "событий")}, первое — ${first.text}.`,
        tts: `Завтра ${count(timed.length, "событие", "события", "событий")}, первое — ${first.tts}.`,
      });
    }
  }
  const due = !ev.deadlines ? [] : data.openTasks().filter((t) => t.deadline === tomorrow);
  if (due.length) parts.push(`Завтра дедлайн: ${listing(due.map((t) => quoted(t.title)))}.`);
  parts.push(eveningOutro());
  return reply(join(parts, 400));
}

/** Сводка для контекста нейронки: коротко, чтобы не тратить токены. */
export async function aiContext(now: Date): Promise<string> {
  const today = dayKey(now);
  const lines: string[] = [`Сейчас ${fullDate(today)}, ${hhmm(now)}.`];
  const events = await data.listEvents(new Date(today + "T00:00:00"), new Date(shiftKey(today, 7) + "T00:00:00")).catch(() => []);
  if (events.length) {
    lines.push("Календарь на неделю:");
    for (const e of events.slice(0, 40)) {
      const wd = fullDate(dayKey(e.start)).split(",")[0].toLowerCase();
      lines.push(`- ${wd} ${dayKey(e.start).slice(5)} ${e.allDay ? "весь день" : `${hhmm(e.start)}–${hhmm(e.end)}`} ${speakable(e.title)}`);
    }
  }
  const tasks = data.openTasks();
  if (tasks.length) lines.push(`Задачи: ${tasks.slice(0, 10).map((t) => `${t.title} (до ${t.deadline})`).join("; ")}`);
  const habits = data.habitsFor(today);
  if (habits.length) lines.push(`Привычки сегодня: ${habits.map((h) => `${h.name}${h.done ? " ✓" : ""}`).join(", ")}`);
  return lines.join("\n");
}
