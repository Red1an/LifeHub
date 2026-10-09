import { localKey } from "./text.ts";
import type { ContextId, KindId, Note, ShelfId } from "./types.ts";

/*
 * Типы вещей (как «объекты» в Capacities/Tana): у каждого свои поля и, если это очередь,
 * жизненный цикл «в очереди → готово с оценкой → архив» (как Letterboxd/Goodreads).
 */

export interface KindField {
  key: string;
  label: string;
  /** Для нейронки: что сюда писать. */
  hint: string;
}

export interface Kind {
  id: KindId;
  name: string;
  /** Множественное число — для подборок. */
  plural: string;
  emoji: string;
  color: string;
  hint: string;
  fields: KindField[];
  /** Очередь: глагол завершения («посмотрел»). Нет — просто знание. */
  queue?: string;
  /** Просить оценку при завершении. */
  rate?: boolean;
}

export const KINDS: Kind[] = [
  { id: "thought", name: "Мысль", plural: "Мысли", emoji: "💡", color: "#e0a23a", hint: "мысли, идеи, инсайты, размышления, планы без даты", fields: [] },
  {
    id: "task", name: "Дело", plural: "Дела", emoji: "✅", color: "#3aa76d", hint: "дела и поручения; срок — в due", queue: "сделал",
    fields: [],
  },
  { id: "event", name: "Событие", plural: "События", emoji: "📅", color: "#d94a7a", hint: "мероприятия, встречи, концерты с датой", fields: [] },
  {
    id: "person", name: "Человек", plural: "Люди", emoji: "👤", color: "#3ab5b0", hint: "заметки о людях: кто это, что рассказал, о чём договорились, идеи подарков",
    fields: [
      { key: "who", label: "Кто это", hint: "кем приходится, откуда знаю" },
      { key: "contact", label: "Контакт", hint: "телефон, ник, только если назван" },
    ],
  },
  {
    id: "movie", name: "Фильм", plural: "Фильмы и сериалы", emoji: "🎬", color: "#d9653b", hint: "фильмы, сериалы, мультфильмы, аниме", queue: "посмотрел", rate: true,
    fields: [
      { key: "format", label: "Формат", hint: "фильм | сериал | аниме | мультфильм" },
      { key: "year", label: "Год", hint: "год выхода, если уверен" },
      { key: "genre", label: "Жанр", hint: "1–2 жанра" },
      { key: "from", label: "Кто посоветовал", hint: "если сказано" },
    ],
  },
  {
    id: "book", name: "Книга", plural: "Книги", emoji: "📚", color: "#a0663a", hint: "книги, комиксы, длинные тексты", queue: "прочитал", rate: true,
    fields: [
      { key: "author", label: "Автор", hint: "если уверен" },
      { key: "from", label: "Кто посоветовал", hint: "если сказано" },
    ],
  },
  {
    id: "media", name: "Видео и подкасты", plural: "Видео и подкасты", emoji: "🎧", color: "#c0538f", hint: "видео, ролики, подкасты, лекции, курсы, музыка/альбомы", queue: "посмотрел", rate: true,
    fields: [
      { key: "format", label: "Формат", hint: "видео | подкаст | курс | лекция | альбом" },
      { key: "author", label: "Автор / канал", hint: "если известно" },
    ],
  },
  {
    id: "app", name: "Приложение", plural: "Приложения", emoji: "📱", color: "#7a6cf0", hint: "приложения, сервисы, программы, нейросети, инструменты, репозитории", queue: "попробовал", rate: true,
    fields: [
      { key: "what", label: "Для чего", hint: "что делает, одной фразой" },
      { key: "platform", label: "Где", hint: "iOS | Android | веб | Windows | Mac | CLI" },
      { key: "price", label: "Цена", hint: "бесплатно | подписка | цена, если известно" },
    ],
  },
  {
    id: "link", name: "Статья или сайт", plural: "Статьи и сайты", emoji: "🌐", color: "#3a8fd9", hint: "статьи, полезные сайты, справочники, ресурсы", queue: "прочитал",
    fields: [{ key: "what", label: "О чём", hint: "одной фразой" }],
  },
  {
    id: "place", name: "Место", plural: "Места", emoji: "📍", color: "#4a9a4a", hint: "кафе, бары, музеи, парки, города — куда сходить или съездить", queue: "сходил", rate: true,
    fields: [
      { key: "type", label: "Что это", hint: "кафе | бар | музей | парк | магазин | город…" },
      { key: "address", label: "Адрес", hint: "город, адрес, если назван" },
      { key: "from", label: "Кто посоветовал", hint: "если сказано" },
    ],
  },
  {
    id: "buy", name: "Покупка", plural: "Покупки", emoji: "🛒", color: "#b07a3a", hint: "вещи, которые хочется или надо купить, подарки", queue: "купил",
    fields: [
      { key: "price", label: "Цена", hint: "если названа" },
      { key: "where", label: "Где купить", hint: "магазин, сайт" },
      { key: "for", label: "Для кого", hint: "если это подарок" },
    ],
  },
  {
    id: "wish", name: "Хотелка", plural: "Хотелки", emoji: "🌠", color: "#9a6ce0",
    hint: "то, что хочется для себя когда-нибудь, без срока и необходимости: вещь мечты, поездка, впечатление, чему научиться (в отличие от buy — нужно купить)",
    queue: "сбылось", rate: true,
    fields: [
      { key: "type", label: "Что это", hint: "вещь | поездка | впечатление | навык" },
      { key: "price", label: "Цена", hint: "если названа или примерно известна" },
      { key: "why", label: "Зачем", hint: "почему хочется, если сказано" },
    ],
  },
  { id: "other", name: "Прочее", plural: "Прочее", emoji: "📦", color: "#8a8478", hint: "всё, что не подошло никуда", fields: [] },
];

const BY_ID = new Map(KINDS.map((k) => [k.id, k]));

export const kindById = (id: string | undefined): Kind => BY_ID.get(id as KindId) ?? BY_ID.get("other")!;
export const isKind = (id: unknown): id is KindId => typeof id === "string" && BY_ID.has(id as KindId);

const FROM_SHELF: Record<ShelfId, KindId> = {
  ideas: "thought", watch: "movie", apps: "app", sites: "link", todo: "task", events: "event", people: "person", buy: "buy", misc: "other",
};

/** Тип заметки с учётом старых форматов: 2.0 — shelf, 1.x — ничего (мысль). */
export function kindOf(n: Pick<Note, "kind" | "shelf" | "event">): Kind {
  if (n.kind) return kindById(n.kind);
  if (n.shelf) return kindById(FROM_SHELF[n.shelf]);
  return kindById(n.event ? "event" : "thought");
}

export interface Context {
  id: ContextId;
  name: string;
  emoji: string;
  hint: string;
}

export const CONTEXTS: Context[] = [
  { id: "weekend", name: "На выходных", emoji: "🏖️", hint: "явно на выходные или требует свободного дня: сходить, съездить, длинный фильм" },
  { id: "evening", name: "Вечером", emoji: "🛋️", hint: "отдохнуть вечером: фильм, серия, подкаст, книга" },
  { id: "commute", name: "В дороге", emoji: "🚌", hint: "с телефона: подкаст, видео, статья, короткое дело" },
  { id: "computer", name: "За компом", emoji: "💻", hint: "нужен компьютер: попробовать сервис, программа, репозиторий, дело за ноутом" },
  { id: "outside", name: "В городе", emoji: "🏙️", hint: "вне дома: купить, зайти, сходить" },
];

export const contextById = (id: string) => CONTEXTS.find((c) => c.id === id);
export const isContext = (id: unknown): id is ContextId => typeof id === "string" && CONTEXTS.some((c) => c.id === id);

/** Отложена и ещё не всплыла. */
export const isSnoozed = (n: Pick<Note, "snoozeUntil">, today = localKey(new Date())) => !!n.snoozeUntil && n.snoozeUntil > today;

/** Варианты «отложить»: до выходных, на неделю, на месяц. */
export function snoozeOptions(now = new Date()) {
  const d = (days: number) => localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  const toSat = (6 - now.getDay() + 7) % 7 || 7;
  return [
    { label: "Завтра", date: d(1) },
    { label: "На выходные", date: d(toSat) },
    { label: "Через неделю", date: d(7) },
    { label: "Через месяц", date: localKey(new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())) },
  ];
}
