export type Category = "work" | "study" | "sport" | "health" | "personal" | "social" | "rest" | "other";

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
  description?: string;
  location?: string;
  /** Напоминание за N минут; null — без напоминания. */
  reminder?: number | null;
  /** Откуда взялось: text, photo, fit, devpath, habits. */
  source?: string;
  /** Пользователь снял галочку. */
  skip?: boolean;
}

export interface Plan {
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
  /** На сколько дней вперёд нейронка смотрит занятость. */
  horizon: number;
  /** Свои правила для нейронки. */
  notes: string;
}

export const DEFAULT_PREFS: Prefs = {
  calendarId: null,
  readCalendars: [],
  dayStart: "08:00",
  dayEnd: "23:00",
  defaultMinutes: 60,
  buffer: 10,
  reminder: 15,
  horizon: 14,
  notes: "",
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
