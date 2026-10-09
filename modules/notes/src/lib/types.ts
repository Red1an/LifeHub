import type { WithDoc } from "@lifehub/sdk";

/** Тип вещи — определяет поля и жизненный цикл (см. lib/kinds.ts). */
export type KindId = "thought" | "task" | "event" | "person" | "movie" | "book" | "media" | "app" | "link" | "place" | "buy" | "wish" | "other";

/** Полки 2.0 — только для чтения старых заметок (поле shelf). */
export type ShelfId = "ideas" | "watch" | "apps" | "sites" | "todo" | "events" | "people" | "buy" | "misc";

/** Когда этим заниматься — контексты в духе GTD. */
export type ContextId = "weekend" | "evening" | "commute" | "computer" | "outside";

export type LinkKind = "site" | "app" | "video" | "repo" | "article";

export interface LinkCard {
  url: string;
  title?: string;
  description?: string;
  site?: string;
  image?: string;
  kind: LinkKind;
  /** Страница не открылась — карточка только по адресу. */
  failed?: boolean;
}

export interface NoteEvent {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  start?: string;
  end?: string;
  place?: string;
  /** Когда отправили в «Расписание». */
  sentAt?: number;
}

/**
 * Коллекция notes открыта другим модулям: поля только добавляются.
 * 1.x — только title/body/tags/pinned (status нет → разобрана).
 * 2.0 — shelf (полка) вместо kind; читается через kindOf().
 */
export interface Note {
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  status?: "inbox" | "filed" | "archived";
  kind?: KindId;
  /** Поля типа: { year: "2024", where: "Кинопоиск" } — ключи из KINDS[kind].fields. */
  props?: Record<string, string>;
  /** @deprecated 2.0 — используй kind. */
  shelf?: ShelfId;
  topicId?: string | null;
  related?: string[];
  links?: LinkCard[];
  /** id картинок в файлах модуля (фото, скриншоты). */
  images?: string[];
  event?: NoteEvent;
  /** Срок дела, YYYY-MM-DD. */
  due?: string;
  /** Примерный объём дела в часах — для «Дедлайнов» Расписания. */
  effort?: number;
  /** Когда дело отправили в «Дедлайны». */
  dueSentAt?: number;
  context?: ContextId[];
  /** Отложено до YYYY-MM-DD: до этого дня не видно на полках, потом всплывает. */
  snoozeUntil?: string;
  /** Очередь закрыта: посмотрел, прочитал, попробовал… */
  done?: boolean;
  doneAt?: number;
  /** Оценка 1–5 после «готово». */
  rating?: number;
  /** Впечатление одной строкой. */
  verdict?: string;
  source?: "text" | "voice" | "share" | "photo" | "offline";
  /** Обложка из внешнего каталога (Википедия, Open Library, App Store) — см. lib/enrich.ts. */
  cover?: string;
  /** Пара строк «о чём это» из каталога. */
  about?: string;
  /** Рейтинг из каталога: 4.3 из 5 на Open Library и т. п. */
  extRating?: { value: number; of: number; source: string; votes?: number };
  /** Ссылка на страницу в каталоге. */
  extUrl?: string;
  /** Когда искали обложку (даже если не нашли — чтобы не искать снова). */
  enrichedAt?: number;
  capturedAt?: number;
  mergedFrom?: string[];
}

export type NoteDoc = WithDoc<Note>;

/** Проект — с целью и сроком, завершается. Сфера — постоянная область жизни. */
export type TopicKind = "project" | "area";

/** Тема — слой «что сейчас»: сводка переписывается при каждом разборе. */
export interface Topic {
  name: string;
  emoji: string;
  summary: string;
  /** Нет поля — тема из 2.0, считается сферой. */
  kind?: TopicKind;
  goal?: string;
  /** YYYY-MM-DD */
  due?: string;
  /** Проект завершён. */
  closedAt?: number | null;
}

export type TopicDoc = WithDoc<Topic>;

/** История темы — только дописывается: «было → стало, почему». */
export interface TopicLog {
  topicId: string;
  /** YYYY-MM-DD */
  date: string;
  text: string;
  noteIds: string[];
  kind?: "triage" | "manual";
}

export type TopicLogDoc = WithDoc<TopicLog>;

export interface Prefs {
  model: "fast" | "smart" | "haiku" | "sonnet" | "opus";
  /** Уверенные пункты разбора применять сразу, без подтверждения. */
  autoApply: boolean;
}

export const DEFAULT_PREFS: Prefs = { model: "smart", autoApply: false };

export const isInbox = (n: Note) => n.status === "inbox";
export const isFiled = (n: Note) => n.status !== "inbox" && n.status !== "archived";
