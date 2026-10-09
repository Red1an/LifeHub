import { ai, db, uid } from "@lifehub/sdk";
import { CONTEXTS, KINDS, isArea, isContext, isKind, type Area } from "./kinds.ts";
import { fetchCards, KIND_LABEL } from "./links.ts";
import { linkPatches, similar } from "./related.ts";
import { extractUrls, localKey, preview, shortDate } from "./text.ts";
import type { AreaId, ContextId, KindId, LinkCard, Note, NoteDoc, NoteEvent, Prefs, Topic, TopicDoc, TopicKind, TopicLog } from "./types.ts";

/*
 * Разбор воронки: один запрос к нейронке → план (вертикальный список карточек) → одно подтверждение.
 * Нейронка только предлагает; применяет код, и только то, что пользователь оставил в плане.
 */

export type NewTopic = { name: string; emoji: string; kind: TopicKind; goal?: string; area?: AreaId };
export type TopicRef = { id: string } | NewTopic | null;

export interface TriageItem {
  key: string;
  /** id записей воронки, которые станут этой заметкой (больше одной — склейка). */
  from: string[];
  title: string;
  body: string;
  kind: KindId;
  /** Сфера жизни — одна из AREAS. */
  area?: AreaId;
  props: Record<string, string>;
  tags: string[];
  context: ContextId[];
  topic: TopicRef;
  /** id уже разобранных заметок, с которыми связать. */
  related: string[];
  event: NoteEvent | null;
  due?: string;
  effort?: number;
  snoozeUntil?: string;
  /** Новая сводка темы «что сейчас» (если заметка её меняет). */
  topicSummary?: string;
  /** Запись в историю темы: что добавилось или поменялось. */
  topicLog?: string;
  confidence: number;
  links: LinkCard[];
  images: string[];
  /** Это уже есть в заметках: дописать туда, а не создавать новую. */
  mergeInto?: string;
  /** Запись дня: о каком дне. */
  dayDate?: string;
  /** Вынесено из записи дня — её key в этом плане. */
  fromDayKey?: string;
  skip?: boolean;
}

export interface TriagePlan {
  at: number;
  items: TriageItem[];
  questions: { from: string; text: string }[];
}

/* Старый план (2.0) в useStore мог остаться с полем shelf — разбирать его заново проще, чем мигрировать. */
export const isCurrentPlan = (p: TriagePlan | null): p is TriagePlan => !!p && p.items.every((i) => "kind" in i);

interface RawItem {
  from?: unknown;
  title?: unknown;
  body?: unknown;
  kind?: unknown;
  area?: unknown;
  props?: unknown;
  tags?: unknown;
  context?: unknown;
  topic?: { id?: unknown; new?: unknown; emoji?: unknown; type?: unknown; goal?: unknown } | null;
  related?: unknown;
  event?: { title?: unknown; date?: unknown; start?: unknown; end?: unknown; place?: unknown } | null;
  due?: unknown;
  effort?: unknown;
  snoozeUntil?: unknown;
  topicSummary?: unknown;
  topicLog?: unknown;
  mergeInto?: unknown;
  dayDate?: unknown;
  confidence?: unknown;
}

const SYSTEM = `Ты — помощник по личным заметкам. Пользователь быстро накидывает обрывки в «воронку»: текстом, голосом, ссылками
и фото/скриншотами, часто по одному слову во время разговора. Твоя задача — разобрать воронку: склеить обрывки
в осмысленные заметки, определить тип вещи и её поля, привязать к проекту или сфере, найти связи с прошлыми заметками.

Правила:
- Склеивай записи, сделанные подряд (обычно до 15 минут) и явно относящиеся к одному: «Лёша», «стартап доставки», «созвон в чт» → одна заметка. Несвязанное не склеивай. Список «посмотреть: А, Б, В» — наоборот, раздели на отдельные заметки по одной вещи.
- Рассказ о дне или длинная запись про разное (несколько тем, сфер, событий): сделай ОДНУ заметку kind "day" — в body весь исходный текст целиком (только исправь распознавание речи и разбей на абзацы, ничего не выкидывай), title — «Вторник: …» с главным за день, dayDate — о каком дне рассказ (вчера, сегодня…), props.mood и props.highlight, topic — null. И ОТДЕЛЬНО вынеси из той же записи (тот же from) всё, с чем потом что-то делать: дела, события с датой, фильмы, книги, места, покупки, людей, важные мысли — каждую своей заметкой со своей темой. Настроение и впечатления дня отдельными заметками не выносить — они остаются в записи дня.
- Текст пользователя сохраняй: исправь ошибки распознавания речи и пунктуацию, можно оформить списком, но не додумывай факты. Ссылки оставляй в тексте как есть. С фото перепиши суть (что на скриншоте/афише).
- title — короткий (до 60 символов), по-русски, без кавычек; для фильма/книги/приложения/места — просто название.
- props — поля типа, только то, в чём уверен (из текста, ссылки, фото или общеизвестное: год фильма, автор книги). Не выдумывай.
- context — когда этим удобно заняться (0–2 значения), только если очевидно из смысла или сказано.
- Не уверен в смысле обрывка — всё равно сделай заметку (kind other, confidence ниже 0.5) и задай вопрос в questions.
- area — сфера жизни, ОБЯЗАТЕЛЬНО у каждой заметки, одна из списка сфер (по смыслу: фильм — досуг, лаба — учёба, подарок другу — друзья и близкие, новое слово — развитие).
- topic — только ПРОЕКТ: дело с результатом, которое когда-нибудь закончится (стартап, переезд, курсовая, подготовка к поездке, ремонт). Используй существующий, если подходит. Новый предлагай, только если по нему явно будет больше одной заметки или пользователь назвал проект. Для нового проекта укажи его сферу. Обычные вещи («посмотреть фильм», «купить молоко») — без проекта, им хватает сферы.
- Купить (buy) — ТОЛЬКО если явно сказано купить/заказать/нужно взять. Просто название лекарства, бренда, вещи, программы или канала без действия — это ref («на заметку»): записал, чтобы не забыть и найти, когда пригодится. В props.what — что это, в props.use — от чего / для чего (из общих знаний, коротко, если уверен; если голос исказил название и ты узнаёшь настоящее — напиши правильное в title, а исходное оставь в body).
- Слово (kind word): незнакомое слово, термин, понятие или иностранное слово — props.meaning заполняй из общих знаний (коротко, понятно), props.example — фраза с ним. Всё, что упомянуто только для сравнения («лучше, чем X»), отдельной заметкой не выносить.
- topicSummary — новая сводка темы «что сейчас» (3–5 строк), только если заметка что-то в ней меняет; не теряй важное из старой сводки. topicLog — одна строка для истории темы («было → стало»).
- related — только id из списка «Похожие прошлые заметки», и только если связь реальная (та же вещь, человек, проект, продолжение мысли).
- event — только если названа дата или день недели (и, возможно, время): мероприятие, встреча, концерт. Дату считай от сегодняшней, формат YYYY-MM-DD, время HH:MM.
- due — срок дела (YYYY-MM-DD), если назван; effort — сколько часов займёт, если сказано или очевидно (лаба, курсовая).
- snoozeUntil — YYYY-MM-DD, если пользователь просит вспомнить позже («напомни через неделю», «глянуть в отпуске»).
- mergeInto — id прошлой заметки, если это ТА ЖЕ САМАЯ вещь (тот же фильм, приложение, сайт, книга, человек, дело), а не просто похожая: тогда новое допишется туда и дубль не появится. Подозрения на дубли отмечены «⚠ возможно, то же самое».
- confidence 0..1 — насколько уверен в разборе этой заметки.`;

function kindsText() {
  return KINDS.map((k) => `- ${k.id} — ${k.emoji} ${k.name}: ${k.hint}${k.fields.length ? `; props: ${k.fields.map((f) => `${f.key} (${f.hint})`).join(", ")}` : ""}`).join("\n");
}

function daysText(now: Date) {
  const names = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const out: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    out.push(`${localKey(d)} ${names[d.getDay()]}${i === 0 ? " (сегодня)" : i === 1 ? " (завтра)" : ""}`);
  }
  return out.join("\n");
}

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${localKey(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Нейронка принимает до 5 картинок за запрос. */
const MAX_IMAGES = 5;

export interface TriageInput {
  inbox: NoteDoc[];
  areas: Area[];
  filed: NoteDoc[];
  topics: TopicDoc[];
  prefs: Prefs;
  onStep?: (s: string) => void;
}

export async function makeTriage({ inbox, filed, topics, areas, prefs, onStep }: TriageInput): Promise<TriagePlan> {
  const sorted = [...inbox].sort((a, b) => (a.capturedAt ?? a.createdAt) - (b.capturedAt ?? b.createdAt));

  const urls = [...new Set(sorted.flatMap((n) => extractUrls(n.body)))];
  let cards = new Map<string, LinkCard>();
  if (urls.length) {
    onStep?.(`Открываю ${urls.length === 1 ? "ссылку" : "ссылки"}…`);
    cards = await fetchCards(urls);
  }

  // Картинки по порядку: «фото №1» в промпте = первая в images.
  const images: string[] = [];
  const imageNo = new Map<string, number[]>();
  for (const n of sorted) {
    for (const id of n.images ?? []) {
      if (images.length >= MAX_IMAGES) break;
      images.push(id);
      imageNo.set(n.id, [...(imageNo.get(n.id) ?? []), images.length]);
    }
  }

  onStep?.("Ищу похожее в старых заметках…");
  const candidates = new Map<string, NoteDoc>();
  for (const n of sorted) {
    const extra = extractUrls(n.body).map((u) => [cards.get(u)?.title, cards.get(u)?.description].filter(Boolean).join(" ")).join(" ");
    for (const { note } of similar(`${n.body} ${extra}`, [], filed, 8)) candidates.set(note.id, note);
  }
  // Дубли: та же ссылка — почти наверняка то же самое; то же название — повод спросить нейронку.
  const dupes = findDupes(sorted, filed, cards);
  const filedById = new Map(filed.map((n) => [n.id, n]));
  for (const ids of dupes.values()) for (const id of ids) candidates.set(id, filedById.get(id)!);
  const suspected = new Set([...dupes.values()].flat());
  const topicName = new Map(topics.map((t) => [t.id, `${t.emoji} ${t.name}`]));
  const openTopics = topics.filter((t) => !t.closedAt);

  const prompt = [
    `Сейчас: ${hhmm(Date.now())}. Ближайшие дни:\n${daysText(new Date())}`,
    `Типы (поле kind) и их поля (props):\n${kindsText()}`,
    `Сферы (поле area): ${areas.map((a) => `${a.id} — ${a.emoji} ${a.name} (${a.hint})`).join("; ")}`,
    `Контексты (поле context): ${CONTEXTS.map((c) => `${c.id} — ${c.name} (${c.hint})`).join("; ")}`,
    openTopics.length
      ? `Проекты и старые темы:\n${openTopics.map((t) => `- id=${t.id} [${t.kind === "project" ? `проект${t.area ? `, сфера ${t.area}` : ""}` : "тема"}] ${t.emoji} ${t.name}${t.goal ? ` — цель: ${t.goal}` : ""}${t.summary ? `\n  сводка: ${t.summary.replace(/\s+/g, " ").slice(0, 400)}` : ""}`).join("\n")}`
      : "Тем пока нет.",
    candidates.size
      ? `Похожие прошлые заметки (для related и mergeInto):\n${[...candidates.values()]
          .sort((a, b) => Number(suspected.has(b.id)) - Number(suspected.has(a.id)))
          .slice(0, 40)
          .map(
            (n) =>
              `- id=${n.id}${suspected.has(n.id) ? " ⚠ возможно, то же самое" : ""} [${n.kind ?? n.shelf ?? "thought"}${n.topicId ? `, тема ${topicName.get(n.topicId) ?? ""}` : ""}${n.done ? ", уже сделано" : ""}] ${n.title || preview(n.body, 60)} — ${preview(n.body, 120)}${(n.links ?? []).map((l) => ` ${l.url}`).join("")}`,
          )
          .join("\n")}`
      : "Похожих прошлых заметок нет.",
    `Воронка (по времени записи):\n${sorted
      .map((n) => {
        const links = extractUrls(n.body)
          .map((u) => cards.get(u))
          .filter((c): c is LinkCard => !!c && !!c.title)
          .map((c) => `\n  ссылка ${c.url}: ${KIND_LABEL[c.kind]} «${c.title}»${c.description ? ` — ${c.description}` : ""}`)
          .join("");
        const pics = imageNo.get(n.id);
        const picText = pics ? ` [фото №${pics.join(", №")}]` : n.images?.length ? " [фото, не приложено — разбери по подписи]" : "";
        const how = n.source === "voice" ? ", голосом" : n.source === "share" ? ", поделился из другого приложения" : "";
        return `- id=${n.id} [${hhmm(n.capturedAt ?? n.createdAt)}${how}]${picText} ${n.title ? n.title + ": " : ""}${n.body || "(без подписи)"}${links}`;
      })
      .join("\n")}`,
    `Верни JSON:
{"notes":[{"from":["id записи воронки"],"title":"…","body":"…","kind":"movie","area":"fun","props":{"year":"2024"},"tags":["…"],"context":["evening"],
  "topic":{"id":"id темы"} | {"new":"Название проекта","emoji":"🚀","goal":"цель проекта","area":"сфера проекта"} | null,
  "related":["id прошлой заметки"],
  "event":{"title":"…","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","place":"…"} | null,
  "due":"YYYY-MM-DD" | null,"effort":6 | null,"snoozeUntil":"YYYY-MM-DD" | null,
  "topicSummary":"…" | null,"topicLog":"…" | null,"mergeInto":"id прошлой заметки" | null,"dayDate":"YYYY-MM-DD (только для kind day)" | null,"confidence":0.9}],
 "questions":[{"from":"id записи воронки","text":"вопрос пользователю"}]}
Каждая запись воронки должна попасть хотя бы в одну заметку (одна запись может дать несколько заметок, если это список разных вещей). tags — 0–3 коротких тега в нижнем регистре.`,
  ].join("\n\n");

  onStep?.(images.length ? "Смотрю фото и раскладываю…" : "Раскладываю по типам…");
  const raw = await ai.json<{ notes?: RawItem[]; questions?: { from?: unknown; text?: unknown }[] }>(prompt, {
    system: SYSTEM,
    model: images.length && prefs.model === "fast" ? "smart" : prefs.model,
    images: images.length ? images : undefined,
  });
  return normalize(raw, sorted, topics, candidates, cards, dupes);
}

/** Длинная запись, из которой вышло несколько заметок, — это рассказ: исходник надо сохранить. */
const LONG_STORY = 280;

/**
 * Записи дня и вынесенное из них. Если нейронка разрезала длинный рассказ, но забыла
 * сохранить его целиком, — сохраняем сами: исходный текст не должен потеряться.
 * Записи дня встают первыми — при применении они забирают id записи воронки.
 */
function linkDays(items: TriageItem[], inbox: Map<string, NoteDoc>) {
  for (const [id, n] of inbox) {
    const parts = items.filter((it) => it.from.includes(id));
    if (parts.length < 2 || parts.some((it) => it.kind === "day") || n.body.length < LONG_STORY) continue;
    const at = n.capturedAt ?? n.createdAt;
    items.push({
      key: uid(),
      from: [id],
      title: `Запись за ${shortDate(localKey(new Date(at)))}`,
      body: n.body,
      kind: "day",
      props: {},
      tags: [],
      context: [],
      topic: null,
      related: [],
      event: null,
      confidence: 1,
      links: [],
      images: n.images ?? [],
      dayDate: localKey(new Date(at)),
    });
  }
  for (const day of items.filter((it) => it.kind === "day")) {
    for (const it of items) if (it !== day && it.kind !== "day" && it.from.some((id) => day.from.includes(id))) it.fromDayKey = day.key;
  }
  items.sort((a, b) => Number(b.kind === "day") - Number(a.kind === "day"));
}

const normUrl = (u: string) => {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|ref$|si$|fbclid|gclid|feature$)/.test(k)) x.searchParams.delete(k);
    return (x.hostname.replace(/^(www|m)\./, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};
const normTitle = (t: string) => t.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Записи воронки → id прошлых заметок с той же ссылкой или тем же названием. */
function findDupes(inbox: NoteDoc[], filed: NoteDoc[], cards: Map<string, LinkCard>) {
  const byUrl = new Map<string, string[]>();
  const byTitle = new Map<string, string[]>();
  for (const n of filed) {
    for (const l of n.links ?? []) byUrl.set(normUrl(l.url), [...(byUrl.get(normUrl(l.url)) ?? []), n.id]);
    const t = normTitle(n.title ?? "");
    if (t.length >= 4) byTitle.set(t, [...(byTitle.get(t) ?? []), n.id]);
  }
  const out = new Map<string, string[]>();
  for (const n of inbox) {
    const hits = new Set<string>();
    for (const u of extractUrls(n.body)) {
      for (const id of byUrl.get(normUrl(u)) ?? []) hits.add(id);
      const t = cards.get(u)?.title;
      if (t) for (const id of byTitle.get(normTitle(t)) ?? []) hits.add(id);
    }
    // Короткая запись, в которой целиком есть название прошлой заметки: «глянуть Интерстеллар».
    const whole = ` ${normTitle(n.body)} `;
    if (whole.trim().split(" ").length <= 8) for (const [t, ids] of byTitle) if (whole.includes(` ${t} `)) ids.forEach((id) => hits.add(id));
    if (hits.size) out.set(n.id, [...hits]);
  }
  return out;
}

/** Та же ссылка — уверенный дубль: используется, если нейронка mergeInto не поставила. */
function urlDupe(src: NoteDoc[], filed: Map<string, NoteDoc>, dupes: Map<string, string[]>) {
  for (const n of src) {
    const urls = new Set(extractUrls(n.body).map(normUrl));
    for (const id of dupes.get(n.id) ?? []) if (filed.get(id)?.links?.some((l) => urls.has(normUrl(l.url)))) return id;
  }
  return undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const hm = (v: unknown) => (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim().padStart(5, "0") : undefined);
const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : undefined);

function normalize(
  raw: { notes?: RawItem[]; questions?: { from?: unknown; text?: unknown }[] },
  inbox: NoteDoc[],
  topics: TopicDoc[],
  candidates: Map<string, NoteDoc>,
  cards: Map<string, LinkCard>,
  dupes: Map<string, string[]> = new Map(),
): TriagePlan {
  const byId = new Map(inbox.map((n) => [n.id, n]));
  const used = new Set<string>();
  const topicIds = new Set(topics.map((t) => t.id));
  const items: TriageItem[] = [];

  for (const r of Array.isArray(raw?.notes) ? raw.notes : []) {
    // Одна запись может дать несколько заметок (список «посмотреть: А, Б»), поэтому повтор id не отбрасываем.
    const from = [...new Set((Array.isArray(r.from) ? r.from : [r.from]).map(String))].filter((id) => byId.has(id));
    if (!from.length) continue;
    const reused = from.some((id) => used.has(id));
    from.forEach((id) => used.add(id));
    const src = from.map((id) => byId.get(id)!);
    let topic: TopicRef = null;
    if (r.topic && typeof r.topic === "object") {
      if (typeof r.topic.id === "string" && topicIds.has(r.topic.id)) topic = { id: r.topic.id };
      else if (str(r.topic.new))
        topic = {
          name: str(r.topic.new).slice(0, 40),
          emoji: str(r.topic.emoji) || "🚀",
          kind: "project",
          goal: str(r.topic.goal) || undefined,
          area: isArea((r.topic as { area?: unknown }).area) ? ((r.topic as { area?: unknown }).area as AreaId) : undefined,
        };
    }
    const ev = r.event && typeof r.event === "object" && ymd(r.event.date) ? r.event : null;
    const kind: KindId = isKind(r.kind) ? r.kind : ev ? "event" : "other";
    const fields = new Set(KINDS.find((k) => k.id === kind)?.fields.map((f) => f.key));
    const props: Record<string, string> = {};
    if (r.props && typeof r.props === "object") {
      for (const [k, v] of Object.entries(r.props as Record<string, unknown>)) {
        const s = str(typeof v === "number" ? String(v) : v);
        if (fields.has(k) && s) props[k] = s.slice(0, k === "meaning" || k === "example" ? 300 : 120);
      }
    }
    const urls = [...new Set(src.flatMap((n) => extractUrls(n.body)))];
    const effort = typeof r.effort === "number" && r.effort > 0 && r.effort < 500 ? r.effort : undefined;
    items.push({
      key: uid(),
      from,
      title: str(r.title).slice(0, 80) || preview(src.map((n) => n.body).join(" "), 60) || "Фото",
      body: str(r.body) || src.map((n) => n.body).join("\n"),
      kind,
      area: isArea(r.area) ? r.area : undefined,
      props,
      tags: (Array.isArray(r.tags) ? r.tags : []).map((t) => str(t).toLowerCase().replace(/^#/, "")).filter(Boolean).slice(0, 5),
      context: (Array.isArray(r.context) ? r.context : []).filter(isContext).slice(0, 2),
      topic,
      related: (Array.isArray(r.related) ? r.related : []).map(String).filter((id) => candidates.has(id)),
      event: ev
        ? { title: str(ev.title) || str(r.title), date: ymd(ev.date)!, start: hm(ev.start), end: hm(ev.end), place: str(ev.place) || undefined }
        : null,
      due: ymd(r.due),
      effort,
      snoozeUntil: ymd(r.snoozeUntil),
      topicSummary: str(r.topicSummary) || undefined,
      topicLog: str(r.topicLog) || undefined,
      mergeInto:
        kind === "day" ? undefined : ((typeof r.mergeInto === "string" && candidates.has(r.mergeInto) ? r.mergeInto : undefined) ?? (reused ? undefined : urlDupe(src, candidates, dupes))),
      dayDate: kind === "day" ? (ymd(r.dayDate) ?? localKey(new Date(src[0].capturedAt ?? src[0].createdAt))) : undefined,
      confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
      // У отделённой из списка заметки ссылки и фото — только если они в её тексте.
      links: urls.filter((u) => !reused || str(r.body).includes(u)).map((u) => cards.get(u) ?? { url: u, kind: "site" as const }),
      images: reused ? [] : src.flatMap((n) => n.images ?? []),
    });
  }

  // Что нейронка пропустила — отдельной заметкой как есть, чтобы ничего не потерялось.
  for (const n of inbox) {
    if (used.has(n.id)) continue;
    const urls = extractUrls(n.body);
    items.push({
      key: uid(),
      from: [n.id],
      title: n.title || preview(n.body, 60) || "Фото",
      body: n.body,
      kind: urls.length ? "link" : "other",
      props: {},
      tags: [],
      context: [],
      topic: null,
      related: [],
      event: null,
      confidence: 0,
      links: urls.map((u) => cards.get(u) ?? { url: u, kind: "site" as const }),
      images: n.images ?? [],
    });
  }

  linkDays(items, byId);

  const questions = (Array.isArray(raw?.questions) ? raw.questions : [])
    .map((q) => ({ from: String(q.from ?? ""), text: str(q.text) }))
    .filter((q) => q.text);

  return { at: Date.now(), items, questions };
}

/* ───────────── применение ───────────── */

type CollName = "notes" | "topics" | "topic_log";

/** Снимок «как было» для отмены разбора: для каждого тронутого документа — его прежнее состояние (null — не было). */
export interface UndoSnapshot {
  at: number;
  count: number;
  before: { coll: CollName; id: string; doc: Record<string, unknown> | null }[];
}

/** Обёртка над коллекциями: перед первой записью в документ запоминает, каким он был. */
class Tracker {
  before: UndoSnapshot["before"] = [];
  private seen = new Set<string>();
  private known: Map<string, Record<string, unknown>>;
  constructor(docs: { coll: CollName; doc: { id: string } & Record<string, unknown> }[]) {
    this.known = new Map(docs.map((d) => [`${d.coll}/${d.doc.id}`, d.doc]));
  }
  private remember(coll: CollName, id: string, existed: boolean) {
    const k = `${coll}/${id}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    const doc = existed ? this.known.get(k) : undefined;
    this.before.push({ coll, id, doc: doc ? strip(doc) : null });
  }
  async add<T extends object>(coll: CollName, data: T) {
    const doc = await db.collection<T>(coll).add(data);
    this.remember(coll, doc.id, false);
    return doc;
  }
  async update<T>(coll: CollName, id: string, patch: Partial<T>) {
    this.remember(coll, id, true);
    return db.collection<T>(coll).update(id, patch);
  }
  async remove(coll: CollName, id: string) {
    this.remember(coll, id, true);
    await db.collection(coll).remove(id);
  }
}

const strip = (d: Record<string, unknown>) => {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = d;
  return rest;
};

/** Отменить разбор: вернуть тронутые документы как были, созданные — удалить. */
export async function undoTriage(snap: UndoSnapshot) {
  for (const b of [...snap.before].reverse()) {
    const c = db.collection<Record<string, unknown>>(b.coll);
    if (b.doc) await c.put(b.id, b.doc);
    else await c.remove(b.id).catch(() => {});
  }
}

const unique = <T>(xs: T[]) => [...new Set(xs)];

/**
 * Применяет пункты плана. Запись воронки становится первой заметкой из неё (id сохраняется);
 * склеенные записи удаляются; если из одной записи вышло несколько заметок — остальные создаются.
 * Дубль (mergeInto) дописывается в прошлую заметку. Связи — в обе стороны; темы и их история.
 */
export async function applyItems(items: TriageItem[], allNotes: NoteDoc[], topics: TopicDoc[], logs: { id: string }[] = []) {
  const t = new Tracker([
    ...allNotes.map((doc) => ({ coll: "notes" as const, doc: doc as unknown as { id: string } & Record<string, unknown> })),
    ...topics.map((doc) => ({ coll: "topics" as const, doc: doc as unknown as { id: string } & Record<string, unknown> })),
    ...logs.map((doc) => ({ coll: "topic_log" as const, doc: doc as { id: string } & Record<string, unknown> })),
  ]);
  const notes = new Map(allNotes.map((n) => [n.id, n]));
  const newTopics = new Map<string, string>();
  const known = new Map(topics.map((tp) => [tp.name.toLowerCase(), tp.id]));
  const today = localKey(new Date());
  const created: string[] = [];
  // key записи дня в плане → id её заметки: вынесенное ссылается на неё.
  const dayIds = new Map<string, string>();
  const consumed = new Set<string>();
  const live = items.filter((it) => !it.skip);
  // Записи, которые пользователь где-то пропустил, не удаляем — они остаются в воронке.
  const skipped = new Set(items.filter((it) => it.skip).flatMap((it) => it.from));

  for (const it of live) {
    const src = it.from.map((id) => notes.get(id)).filter((n): n is NoteDoc => !!n && n.status === "inbox");
    if (!src.length && !it.from.some((id) => consumed.has(id))) continue;
    const all = it.from.map((id) => notes.get(id) ?? allNotes.find((n) => n.id === id)).filter((n): n is NoteDoc => !!n);

    // Дубль: дописываем в прошлую заметку, запись воронки удалится ниже.
    const target = it.mergeInto ? notes.get(it.mergeInto) : undefined;
    if (target) {
      const addition = it.body.trim();
      const body = addition && !target.body.includes(addition) ? `${target.body.trim()}\n\n— ${today}: ${addition}` : target.body;
      const links = [...(target.links ?? []), ...it.links.filter((l) => !target.links?.some((x) => normUrl(x.url) === normUrl(l.url)))];
      const doc = await t.update<Note>("notes", target.id, {
        body,
        links: links.length ? links : undefined,
        images: unique([...(target.images ?? []), ...it.images]),
        tags: unique([...(target.tags ?? []), ...it.tags]),
        context: unique([...(target.context ?? []), ...it.context]),
        props: { ...it.props, ...target.props },
        // Снова захотелось то, что было в архиве или отложено, — возвращаем на полку.
        status: target.status === "archived" ? "filed" : target.status,
        area: target.area ?? it.area,
        snoozeUntil: null as unknown as undefined,
      });
      notes.set(doc.id, doc);
      created.push(doc.id);
      for (const p of linkPatches(notes, it.related.map((r) => [doc.id, r] as [string, string]))) {
        const upd = await t.update<Note>("notes", p.id, { related: p.related });
        notes.set(upd.id, upd);
      }
      continue;
    }

    let topicId: string | undefined;
    let fresh = false;
    if (it.topic && "id" in it.topic) topicId = it.topic.id;
    else if (it.topic) {
      const k = it.topic.name.toLowerCase();
      topicId = newTopics.get(k) ?? known.get(k);
      if (!topicId) {
        const tp = await t.add<Topic>("topics", { name: it.topic.name, emoji: it.topic.emoji, summary: it.topicSummary ?? "", kind: it.topic.kind, goal: it.topic.goal, area: it.topic.area ?? it.area });
        topicId = tp.id;
        fresh = true;
        newTopics.set(k, tp.id);
      }
    }

    const data: Note = {
      dayDate: it.dayDate,
      fromDay: it.fromDayKey ? dayIds.get(it.fromDayKey) : undefined,
      title: it.title,
      body: it.body,
      tags: it.tags,
      pinned: all.some((n) => n.pinned),
      status: "filed",
      kind: it.kind,
      area: it.area,
      // Новое слово — первый повтор завтра.
      srs: it.kind === "word" ? { step: 0, due: localKey(new Date(Date.now() + 86_400_000)) } : undefined,
      props: Object.keys(it.props).length ? it.props : undefined,
      context: it.context.length ? it.context : undefined,
      topicId: topicId ?? null,
      links: it.links.length ? it.links : undefined,
      images: it.images.length ? it.images : undefined,
      event: it.event ?? undefined,
      due: it.due,
      effort: it.effort,
      snoozeUntil: it.snoozeUntil,
      capturedAt: Math.min(...all.map((n) => n.capturedAt ?? n.createdAt), Date.now()),
      source: all.find((n) => n.source && n.source !== "text")?.source ?? "text",
      related: [],
    };

    const host = src.find((n) => !consumed.has(n.id));
    let doc: NoteDoc;
    if (host) {
      const rest = it.from.filter((id) => id !== host.id && !skipped.has(id));
      doc = await t.update<Note>("notes", host.id, { ...data, mergedFrom: rest.length ? rest : undefined });
      consumed.add(host.id);
    } else {
      doc = await t.add<Note>("notes", data);
    }
    notes.set(doc.id, doc);
    created.push(doc.id);
    if (it.kind === "day") dayIds.set(it.key, doc.id);

    for (const p of linkPatches(notes, it.related.map((r) => [doc.id, r] as [string, string]))) {
      const upd = await t.update<Note>("notes", p.id, { related: p.related });
      notes.set(upd.id, upd);
    }

    if (topicId) {
      // Даже без новой сводки обновляем тему — updatedAt показывает, что она «жива».
      if (!fresh) await t.update<Topic>("topics", topicId, it.topicSummary ? { summary: it.topicSummary } : {});
      await t.add<TopicLog>("topic_log", { topicId, date: today, text: it.topicLog || `Добавлено: ${it.title}`, noteIds: [doc.id], kind: "triage" });
    }
  }

  // Склеенные записи и дубли, не ставшие заметкой, удаляем — их текст уже внутри.
  for (const it of live) {
    for (const id of it.from) {
      const n = notes.get(id);
      if (n && n.status === "inbox" && !consumed.has(id) && !skipped.has(id)) {
        await t.remove("notes", id);
        notes.delete(id);
      }
    }
  }
  const undo: UndoSnapshot = { at: Date.now(), count: created.length, before: t.before };
  return { created: unique(created), undo };
}
