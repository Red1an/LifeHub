import { localKey } from "./text.ts";
import type { AreaId, ContextId, KindId, Note, ShelfId } from "./types.ts";

/*
 * Как раскладываются заметки — три независимые оси, все проставляет нейронка:
 * 1. Тип (как «объекты» в Capacities/Tana) — что это и что с ним делать; типы сгруппированы по действию.
 *    У очередей — «в очереди → готово с оценкой → архив» (как Letterboxd/Goodreads).
 * 2. Сфера — одна из постоянных областей жизни («колесо жизни»); проекты (PARA) живут внутри сфер.
 * 3. Когда — контекст (GTD).
 */

export interface KindField {
  key: string;
  label: string;
  /** Для нейронки: что сюда писать. */
  hint: string;
}

export type GroupId = "fun" | "do" | "try" | "know" | "people" | "self";

export interface Kind {
  id: KindId;
  name: string;
  /** Множественное число — для подборок. */
  plural: string;
  emoji: string;
  color: string;
  hint: string;
  group: GroupId;
  fields: KindField[];
  /** Очередь: глагол завершения («посмотрел»). Нет — просто знание. */
  queue?: string;
  /** Просить оценку при завершении. */
  rate?: boolean;
}

export const GROUPS: { id: GroupId; name: string; emoji: string }[] = [
  { id: "fun", name: "Досуг", emoji: "🍿" },
  { id: "do", name: "Сделать", emoji: "✅" },
  { id: "try", name: "Попробовать", emoji: "🧪" },
  { id: "know", name: "Знать", emoji: "🧠" },
  { id: "people", name: "Люди", emoji: "👥" },
  { id: "self", name: "Моё", emoji: "🪞" },
];

export const KINDS: Kind[] = [
  /* ── Досуг ── */
  {
    id: "movie", name: "Фильм", plural: "Фильмы и сериалы", emoji: "🎬", color: "#d9653b", group: "fun", hint: "фильмы, сериалы, мультфильмы, аниме", queue: "посмотрел", rate: true,
    fields: [
      { key: "format", label: "Формат", hint: "фильм | сериал | аниме | мультфильм" },
      { key: "year", label: "Год", hint: "год выхода, если уверен" },
      { key: "genre", label: "Жанр", hint: "1–2 жанра" },
      { key: "from", label: "Кто посоветовал", hint: "если сказано" },
    ],
  },
  {
    id: "book", name: "Книга", plural: "Книги", emoji: "📚", color: "#a0663a", group: "fun", hint: "книги, комиксы, длинные тексты", queue: "прочитал", rate: true,
    fields: [
      { key: "author", label: "Автор", hint: "если уверен" },
      { key: "from", label: "Кто посоветовал", hint: "если сказано" },
    ],
  },
  {
    id: "media", name: "Видео и подкасты", plural: "Видео и подкасты", emoji: "🎧", color: "#c0538f", group: "fun", hint: "видео, ролики, подкасты, лекции, курсы, музыка и альбомы", queue: "посмотрел", rate: true,
    fields: [
      { key: "format", label: "Формат", hint: "видео | подкаст | курс | лекция | альбом" },
      { key: "author", label: "Автор / канал", hint: "если известно" },
    ],
  },
  {
    id: "game", name: "Игра", plural: "Игры", emoji: "🎮", color: "#5a7be0", group: "fun", hint: "видеоигры, настольные игры", queue: "поиграл", rate: true,
    fields: [
      { key: "platform", label: "Где", hint: "ПК | PlayStation | Switch | телефон | настолка" },
      { key: "genre", label: "Жанр", hint: "1–2 жанра" },
      { key: "from", label: "Кто посоветовал", hint: "если сказано" },
    ],
  },
  {
    id: "place", name: "Место", plural: "Куда сходить", emoji: "📍", color: "#4a9a4a", group: "fun", hint: "кафе, бары, музеи, парки, выставки, магазины — конкретное место в городе", queue: "сходил", rate: true,
    fields: [
      { key: "type", label: "Что это", hint: "кафе | бар | музей | парк | выставка | магазин…" },
      { key: "address", label: "Адрес", hint: "город, адрес, если назван" },
      { key: "from", label: "Кто посоветовал", hint: "если сказано" },
    ],
  },
  {
    id: "trip", name: "Поездка или активность", plural: "Поездки и активности", emoji: "🏕️", color: "#2f9a8a", group: "fun",
    hint: "поехать куда-то, поход, отдых, активности и впечатления: картинг, сплав, квест, мастер-класс", queue: "было", rate: true,
    fields: [
      { key: "where", label: "Куда", hint: "город, страна, место" },
      { key: "when", label: "Когда лучше", hint: "сезон или время, если сказано" },
      { key: "price", label: "Сколько стоит", hint: "если известно" },
    ],
  },
  /* ── Сделать ── */
  { id: "task", name: "Дело", plural: "Дела", emoji: "✅", color: "#3aa76d", group: "do", hint: "дела и поручения; срок — в due", queue: "сделал", fields: [] },
  { id: "event", name: "Событие", plural: "События", emoji: "📅", color: "#d94a7a", group: "do", hint: "мероприятия, встречи, концерты с датой", fields: [] },
  {
    id: "buy", name: "Покупка", plural: "Покупки", emoji: "🛒", color: "#b07a3a", group: "do", hint: "то, что нужно купить, подарки", queue: "купил",
    fields: [
      { key: "price", label: "Цена", hint: "если названа" },
      { key: "where", label: "Где купить", hint: "магазин, сайт" },
      { key: "for", label: "Для кого", hint: "если это подарок" },
    ],
  },
  /* ── Попробовать ── */
  {
    id: "app", name: "Приложение", plural: "Приложения и сервисы", emoji: "📱", color: "#7a6cf0", group: "try", hint: "приложения, сервисы, программы, нейросети, инструменты, репозитории", queue: "попробовал", rate: true,
    fields: [
      { key: "what", label: "Для чего", hint: "что делает, одной фразой" },
      { key: "platform", label: "Где", hint: "iOS | Android | веб | Windows | Mac | CLI" },
      { key: "price", label: "Цена", hint: "бесплатно | подписка | цена, если известно" },
    ],
  },
  /* ── Знать ── */
  {
    id: "link", name: "Статья или сайт", plural: "Статьи и сайты", emoji: "🌐", color: "#3a8fd9", group: "know", hint: "статьи, полезные сайты, справочники, ресурсы", queue: "прочитал",
    fields: [{ key: "what", label: "О чём", hint: "одной фразой" }],
  },
  {
    id: "word", name: "Слово", plural: "Слова и термины", emoji: "🔤", color: "#3a9fc9", group: "know",
    hint: "незнакомое слово, термин, понятие, выражение, иностранное слово — чтобы разобраться и запомнить",
    queue: "выучил",
    fields: [
      { key: "meaning", label: "Значение", hint: "коротко и понятно, по-русски; ДЛЯ СЛОВ можно из общих знаний" },
      { key: "example", label: "Пример", hint: "одна фраза с этим словом" },
      { key: "lang", label: "Язык", hint: "русский | английский | … (для иностранных — и перевод в значении)" },
      { key: "source", label: "Откуда", hint: "где встретил: книга, фильм, разговор — если сказано или понятно из соседних записей" },
    ],
  },
  {
    id: "ref", name: "На заметку", plural: "На заметку", emoji: "📌", color: "#6a8a9a", group: "know",
    hint: "справка «на всякий случай», которую не надо делать или покупать: названия лекарств, бренды, программы, каналы, факты, номера, советы — чтобы найти, когда пригодится",
    fields: [
      { key: "what", label: "Что это", hint: "лекарство | бренд | программа | канал | факт | … и коротко что именно (из общих знаний, если уверен)" },
      { key: "use", label: "Когда пригодится", hint: "от чего / для чего — если сказано или общеизвестно (для лекарств — от чего, без дозировок)" },
    ],
  },
  /* ── Люди ── */
  {
    id: "person", name: "Человек", plural: "Люди", emoji: "👤", color: "#3ab5b0", group: "people", hint: "заметки о людях: кто это, что рассказал, о чём договорились, идеи подарков",
    fields: [
      { key: "who", label: "Кто это", hint: "кем приходится, откуда знаю" },
      { key: "contact", label: "Контакт", hint: "телефон, ник, только если назван" },
    ],
  },
  /* ── Моё ── */
  { id: "thought", name: "Мысль", plural: "Мысли и идеи", emoji: "💡", color: "#e0a23a", group: "self", hint: "мысли, идеи, инсайты, размышления, планы без даты", fields: [] },
  {
    id: "wish", name: "Хотелка", plural: "Хотелки", emoji: "🌠", color: "#9a6ce0", group: "self",
    hint: "то, что хочется для себя когда-нибудь, без срока и необходимости: вещь мечты, чему научиться (поездки — trip, нужные покупки — buy)",
    queue: "сбылось", rate: true,
    fields: [
      { key: "type", label: "Что это", hint: "вещь | впечатление | навык" },
      { key: "price", label: "Цена", hint: "если названа или примерно известна" },
      { key: "why", label: "Зачем", hint: "почему хочется, если сказано" },
    ],
  },
  {
    id: "day", name: "Запись дня", plural: "Дневник", emoji: "📓", color: "#c98a4b", group: "self",
    hint: "рассказ о дне или большой кусок про разное: сохраняется целиком, а дела, события, фильмы и мысли из него выносятся отдельными заметками",
    fields: [
      { key: "mood", label: "Настроение", hint: "одно-два слова, только если понятно из текста: «устал, но доволен»" },
      { key: "highlight", label: "Главное за день", hint: "одна фраза" },
    ],
  },
  { id: "other", name: "Прочее", plural: "Прочее", emoji: "📦", color: "#8a8478", group: "self", hint: "всё, что не подошло никуда", fields: [] },
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

/* ───────────── сферы ───────────── */

export interface Area {
  id: AreaId;
  name: string;
  emoji: string;
  color: string;
  hint: string;
}

/** Постоянные сферы жизни (по «колесу жизни»). Названия и эмодзи можно переименовать — useStore("areas"). */
export const AREAS: Area[] = [
  { id: "study", name: "Учёба", emoji: "🎓", color: "#5a7be0", hint: "университет, пары, лабы, курсовые, экзамены, курсы" },
  { id: "work", name: "Работа", emoji: "💼", color: "#7a6cf0", hint: "работа, карьера, свои проекты и стартапы, подработки, профессиональные навыки" },
  { id: "health", name: "Здоровье и спорт", emoji: "💪", color: "#3aa76d", hint: "тренировки, самочувствие, сон, еда, врачи" },
  { id: "money", name: "Деньги", emoji: "💰", color: "#c9a23a", hint: "траты, доходы, покупки ради экономии, инвестиции, подписки" },
  { id: "people", name: "Друзья и близкие", emoji: "❤️", color: "#d94a7a", hint: "друзья, семья, отношения, дни рождения, подарки, встречи" },
  { id: "growth", name: "Развитие", emoji: "🌱", color: "#2f9a8a", hint: "саморазвитие, чтение ради знаний, новые слова и понятия, мысли о жизни, привычки" },
  { id: "fun", name: "Досуг и хобби", emoji: "🎸", color: "#d9653b", hint: "фильмы, игры, музыка, хобби, отдых, поездки, места" },
  { id: "home", name: "Дом и быт", emoji: "🏠", color: "#a0663a", hint: "дом, ремонт, бытовые дела и покупки для дома, документы" },
];

export const isArea = (id: unknown): id is AreaId => typeof id === "string" && AREAS.some((a) => a.id === id);

/** Сферы с учётом переименований пользователя. */
export function withNames(custom: Partial<Record<AreaId, { name?: string; emoji?: string }>> | null | undefined): Area[] {
  return AREAS.map((a) => ({ ...a, name: custom?.[a.id]?.name?.trim() || a.name, emoji: custom?.[a.id]?.emoji?.trim() || a.emoji }));
}

/* ───────────── когда ───────────── */

export interface Context {
  id: ContextId;
  name: string;
  emoji: string;
  hint: string;
}

export const CONTEXTS: Context[] = [
  { id: "weekend", name: "На выходных", emoji: "🏖️", hint: "явно на выходные или требует свободного дня: сходить, съездить, длинный фильм" },
  { id: "evening", name: "Вечером", emoji: "🛋️", hint: "отдохнуть вечером: фильм, серия, подкаст, книга, игра" },
  { id: "commute", name: "В дороге", emoji: "🚌", hint: "с телефона: подкаст, видео, статья, слова, короткое дело" },
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

/* ───────────── повторение слов ───────────── */

/** Интервалы повторения в днях: помнишь — следующий шаг, забыл — сначала. После последнего — «выучил». */
export const SRS_STEPS = [1, 3, 7, 14, 30, 90];

export function srsNext(step: number, remembered: boolean, now = new Date()) {
  const next = remembered ? step + 1 : 0;
  const days = SRS_STEPS[Math.min(next, SRS_STEPS.length - 1)];
  return { step: next, due: localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)), learned: remembered && next >= SRS_STEPS.length };
}

/** Слова, которые пора повторить сегодня. */
export const isDueWord = (n: Note, today = localKey(new Date())) => n.kind === "word" && !n.done && n.status !== "archived" && n.status !== "inbox" && (n.srs?.due ?? "") <= today;
