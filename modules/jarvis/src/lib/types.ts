/*
 * Данные модуля. Хаб (server/jarvis) читает и пишет их же — форматы менять только вместе
 * с server/jarvis/prefs.ts и server/jarvis/index.ts.
 *
 *  kv "config" — настройки (пишет модуль, читает хаб);
 *  kv "status" — состояние подключения (пишет хаб);
 *  kv "action" — разовое действие для хаба: { kind: "rotate" | "unlink" };
 *  коллекция "chat" — разговор: модуль добавляет { q, source: "hub" }, хаб дописывает a.
 */

export type MorningPart = "events" | "deadlines" | "habits" | "devpath" | "portfolio";
export type EveningPart = "habits" | "spending" | "devpath" | "tomorrow" | "deadlines";

export interface CustomCommand {
  id: string;
  phrases: string[];
  say: string;
  run: string[];
}

export interface Prefs {
  enabled: boolean;
  address: string;
  ai: boolean;
  aiLimit: number;
  morning: Record<MorningPart, boolean>;
  evening: Record<EveningPart, boolean>;
  commands: CustomCommand[];
  history: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  enabled: false,
  address: "сэр",
  ai: true,
  aiLimit: 20,
  morning: { events: true, deadlines: true, habits: true, devpath: true, portfolio: true },
  evening: { habits: true, spending: true, devpath: true, tomorrow: true, deadlines: true },
  commands: [],
  history: true,
};

export interface Status {
  enabled: boolean;
  url: string | null;
  ngrok: { enabled: boolean; running: boolean; domain: string; error?: string };
  hasPassword: boolean;
  linked: boolean;
  lastAt: number | null;
  aiUsedToday: number;
  checkedAt: number;
}

export interface ChatMsg {
  q: string;
  /** Ответ; нет — хаб ещё думает. */
  a?: string;
  /** hub — написано здесь, alice — сказано колонке. */
  source: "hub" | "alice";
  at?: number;
  buttons?: string[];
  ms?: number;
}

export const MORNING_PARTS: { id: MorningPart; label: string; hint: string }[] = [
  { id: "events", label: "События дня", hint: "из Google Календаря, включая пары" },
  { id: "deadlines", label: "Дедлайны", hint: "задачи «Расписания» на 3 дня вперёд" },
  { id: "habits", label: "Привычки", hint: "что сделать сегодня и серии" },
  { id: "devpath", label: "DevPath", hint: "задания дня" },
  { id: "portfolio", label: "Портфель", hint: "стоимость и изменение за день" },
];

export const EVENING_PARTS: { id: EveningPart; label: string; hint: string }[] = [
  { id: "habits", label: "Привычки", hint: "сколько отмечено, что осталось" },
  { id: "spending", label: "Траты", hint: "сколько ушло сегодня" },
  { id: "devpath", label: "DevPath", hint: "задания и опыт за день" },
  { id: "tomorrow", label: "Завтра", hint: "сколько событий и первое из них" },
  { id: "deadlines", label: "Дедлайны", hint: "что сдавать завтра" },
];

/** Встроенные команды — подсказки и шаги для своих команд. */
export const BUILTIN: { group: string; items: string[] }[] = [
  { group: "День", items: ["Доброе утро", "Итоги дня", "Что дальше?", "Что у меня завтра?", "Когда я свободен?", "Что на неделе?", "Мои задачи"] },
  { group: "Календарь", items: ["Поставь тренировку завтра в 7 вечера на час", "Напомни через 20 минут выключить плиту", "Перенеси пару на час позже", "Отмени тренировку в пятницу"] },
  { group: "Модули", items: ["Отметь воду", "Какие привычки остались?", "Потратил 450 на такси", "Сколько я потратил за неделю?", "Запомни: код от домофона 4512", "Что я записывал про домофон?"] },
  { group: "Учёба и прочее", items: ["Что по DevPath?", "Задай вопрос по DevPath", "Сколько тренировок?", "Как там гитара?", "Что с портфелем?"] },
];

/** Команды, которые удобно запускать из своих команд. */
export const RUNNABLE = ["что дальше", "что у меня сегодня", "что у меня завтра", "когда я свободен", "доброе утро", "итоги дня", "привычки", "мои задачи", "что по devpath", "что с портфелем", "сколько я потратил"];
