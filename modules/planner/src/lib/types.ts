export type Category = "work" | "study" | "sport" | "health" | "personal" | "social" | "rest" | "reminder" | "other";

/** Варианты напоминаний (минут до начала). */
export const REMINDER_OPTIONS = [0, 10, 30, 60, 120, 1440, 2880];

export function reminderLabel(m: number, allDay = false): string {
  if (allDay) {
    // У событий на весь день напоминание считается от полуночи их дня.
    if (m === 0) return "в полночь";
    const days = Math.ceil(m / 1440);
    const t = days * 1440 - m;
    const at = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    return days === 1 ? `накануне в ${at}` : `за ${days} дн. в ${at}`;
  }
  if (m === 0) return "в момент начала";
  if (m < 60) return `за ${m} мин`;
  if (m < 1440) return `за ${m / 60} ч`;
  return m === 1440 ? "за день" : `за ${m / 1440} дн.`;
}

export interface Recurrence {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  /** MO TU WE TH FR SA SU — для WEEKLY. */
  byDay?: string[];
  interval?: number;
  /** Последний день повтора, YYYY-MM-DD. */
  until?: string;
  count?: number;
}

/** Одно изменение календаря в черновике. */
export interface Draft {
  key: string;
  op: "create" | "update" | "delete";
  /** Для update/delete: id события в Google и его календарь. */
  eventId?: string;
  calendarId?: string;
  /** update/delete всей серии повторов, а не одного дня. */
  series?: boolean;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm; нет — событие на весь день. */
  start?: string;
  end?: string;
  /** Последний день для многодневного события на весь день. */
  endDate?: string;
  recurrence?: Recurrence;
  category: Category;
  /** "reminder" — короткое напоминание в нужное время (не занимает время в календаре). */
  kind?: "event" | "reminder";
  description?: string;
  location?: string;
  /** Напоминания: за сколько минут до начала. [] — без напоминаний, нет поля — по настройкам. */
  reminders?: number[];
  /** Старый формат (одно напоминание) — читается в remindersOf. */
  reminder?: number | null;
  /** Откуда взялось: text, photo, fit, devpath, habits. */
  source?: string;
  /** Пользователь снял галочку. */
  skip?: boolean;
  /** Блок работы над задачей (block) или напоминание о её дедлайне (deadline); taskId — id в коллекции tasks. */
  taskId?: string;
  taskRole?: "block" | "deadline";
}

/** Задача с дедлайном: программа сама раскладывает её на блоки по свободному времени. */
export interface Task {
  title: string;
  /** YYYY-MM-DD */
  deadline: string;
  deadlineTime?: string;
  /** Сколько всего работы, минут. */
  estimate: number;
  /** Длина одного блока, минут. */
  chunk: number;
  category: Category;
  notes?: string;
  done: boolean;
  blocks: TaskBlock[];
  deadlineEvent?: { eventId: string; calendarId: string };
  source?: string;
  createdAt?: number;
}

export interface TaskBlock {
  eventId: string;
  calendarId: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  done?: boolean;
  /** Пропущен и убран из календаря. */
  missed?: boolean;
}

/** Задача из черновика: ещё не сохранена, блоки появятся после применения. */
export interface PendingTask extends Omit<Task, "blocks" | "done"> {
  id: string;
  /** Уже существующая задача — перепланирование оставшейся работы. */
  existing?: boolean;
  /** Сколько работы не влезло до дедлайна, минут. */
  unplaced?: number;
}

export interface Plan {
  /** Задачи с дедлайном из этого черновика. */
  tasks?: PendingTask[];
  request: string;
  summary: string;
  questions: string[];
  drafts: Draft[];
  /** Картинки запроса (id файлов модуля). */
  images: string[];
  sources: string[];
  createdAt: number;
}

export interface Prefs {
  /** Куда ставить события. null — ещё не выбрано. */
  calendarId: string | null;
  /** Календари, которые показываем и считаем занятым временем. Пусто — все видимые в Google. */
  readCalendars: string[];
  dayStart: string;
  dayEnd: string;
  defaultMinutes: number;
  /** Минут между событиями. */
  buffer: number;
  /** Напоминание по умолчанию, минут; -1 — без напоминания. */
  reminder: number;
  /** Для событий на весь день: минут до полуночи их дня (240 — накануне в 20:00); -1 — без напоминания. */
  allDayReminder: number;
  /** Во сколько ставить напоминания, если время не сказано. */
  reminderTime: string;
  /** На сколько дней вперёд нейронка смотрит занятость. */
  horizon: number;
  /** Свои правила для нейронки. */
  notes: string;
  /** Модель для составления расписания. */
  model: "haiku" | "sonnet" | "opus";
  /** Максимум работы над одной задачей в день, минут. */
  taskPerDay: number;
  /** Расписание ГУАП: номер группы, конец семестра, напоминание перед парой. */
  guapGroup: string;
  guapUntil: string;
  guapReminder: number;
}

export const DEFAULT_PREFS: Prefs = {
  calendarId: null,
  readCalendars: [],
  dayStart: "08:00",
  dayEnd: "23:00",
  defaultMinutes: 60,
  buffer: 10,
  reminder: 15,
  allDayReminder: 240,
  reminderTime: "09:00",
  horizon: 14,
  notes: "",
  model: "sonnet",
  taskPerDay: 180,
  guapGroup: "",
  guapUntil: "",
  guapReminder: 15,
};

/** Коллекция history: применённые запросы. */
export interface HistoryEntry {
  request: string;
  summary: string;
  images: string[];
  sources: string[];
  created: number;
  updated: number;
  deleted: number;
  failed: number;
}

export interface CalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
  selected?: boolean;
  timeZone?: string;
}

/** Событие Google в удобном виде. */
export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  /** Начало и конец (для событий на весь день — полночь, конец не включается). */
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  recurringEventId?: string;
  /** Создано этим модулем. */
  ours: boolean;
  category?: Category;
  kind?: "event" | "reminder";
  /** Блок задачи: id в коллекции tasks. */
  taskId?: string;
  source?: string;
  /** Не занимает время (transparency: transparent). */
  free?: boolean;
  canEdit: boolean;
}

export const CATEGORIES: Record<Category, { label: string; icon: string; colorId: string; color: string }> = {
  work: { label: "Работа", icon: "💼", colorId: "9", color: "#5b6ee1" },
  study: { label: "Учёба", icon: "📚", colorId: "7", color: "#22a7e0" },
  sport: { label: "Спорт", icon: "💪", colorId: "10", color: "#2fa36b" },
  health: { label: "Здоровье", icon: "🩺", colorId: "2", color: "#4cc38a" },
  personal: { label: "Личное", icon: "✨", colorId: "5", color: "#f2b632" },
  social: { label: "Встречи", icon: "🫂", colorId: "4", color: "#ec7d7d" },
  rest: { label: "Отдых", icon: "🌿", colorId: "1", color: "#8f9be0" },
  reminder: { label: "Напоминание", icon: "🔔", colorId: "6", color: "#f4793b" },
  other: { label: "Другое", icon: "📌", colorId: "8", color: "#8a8f98" },
};

/** Цвета событий Google (colorId → цвет). */
export const GOOGLE_COLORS: Record<string, string> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "#0b8043",
  "11": "#d50000",
};
