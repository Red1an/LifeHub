import { ai, uid } from "@lifehub/sdk";
import { POEMS } from "./poems";
import { loadHackerNews, loadPoem, loadTeasers, shuffle, wikiSummary, wikiText } from "./sources";
import type {
  ArtData, CardData, ConceptData, JokeData, QuoteData, DayDoc, DayEvent, FactData, HistoryData, Kind, Prefs, PuzzleData, QuickPuzzle, TechData, WordData, PoemData,
} from "./types";

/*
 * Все обращения к нейронке. Где можно — она работает по источнику (статья Википедии, текст Викитеки,
 * заголовки Hacker News) и только объясняет, а не придумывает факты.
 */

export interface GenContext {
  day: string;
  prefs: Prefs;
  /** Что уже было в этом виде карточек — не повторяться. */
  used: string[];
  liked: string[];
  disliked: string[];
  /** События «в этот день» (для истории). */
  dayDoc?: DayDoc;
  signal?: AbortSignal;
}

const AUTHOR = `Ты — автор ежедневного альманаха «Кругозор» для любознательного взрослого (разработчик, ~20–30 лет), который хочет расширять кругозор.
Пиши по-русски, живо и образно, как лучшие научно-популярные авторы: цепляющее начало, конкретные детали, цифры, имена, никакой воды и канцелярита.
Только достоверные факты. Если в деталях не уверен — не выдумывай, лучше скажи общее.
Форматирование внутри текстов: абзацы разделяй пустой строкой, можно **жирный** для ключевого. Без заголовков и списков, если не просят.`;

function about(ctx: GenContext) {
  const parts: string[] = [];
  if (ctx.prefs.interests.trim()) parts.push(`Интересы читателя: ${ctx.prefs.interests.trim()}.`);
  if (ctx.liked.length) parts.push(`Ему понравились: ${ctx.liked.slice(-12).join("; ")}.`);
  if (ctx.disliked.length) parts.push(`Не зашло: ${ctx.disliked.slice(-8).join("; ")}.`);
  return parts.join("\n");
}

const RECALL = `"recall":{"q":"вопрос для повторения через несколько дней — проверяет главное, отвечается одной фразой","a":"короткий ответ"}`;

export async function generate(kind: Kind, ctx: GenContext): Promise<{ data: CardData; quick?: QuickPuzzle[] }> {
  switch (kind) {
    case "history":
      return { data: await genHistory(ctx) };
    case "fact":
      return { data: await genFact(ctx) };
    case "quote":
      return { data: await genQuote(ctx) };
    case "joke":
      return { data: await genJoke(ctx) };
    case "puzzle":
      return genPuzzle(ctx);
    case "tech":
      return { data: await genTech(ctx) };
    case "concept":
      return { data: await genConcept(ctx) };
    case "word":
      return { data: await genWord(ctx) };
    case "poem":
      return { data: await genPoem(ctx) };
    case "art":
      return { data: await genArt(ctx) };
  }
}

/* ───────────── В этот день ───────────── */

async function genHistory(ctx: GenContext): Promise<HistoryData> {
  const d = ctx.dayDoc;
  if (!d) throw new Error("Нет событий этого дня");
  const pool: DayEvent[] = [...d.selected, ...d.events.filter((e) => !d.selected.some((s) => s.text === e.text))].filter((e) => e.year > 0);
  if (!pool.length) throw new Error("Википедия не вернула события этого дня");
  const list = pool.slice(0, 70).map((e, i) => `[${i}] ${e.year}: ${e.text}`).join("\n");
  const [, m, dd] = ctx.day.split("-");
  const r = await ai.json<{ pick: number; title: string; story: string; why: string; recall: { q: string; a: string } }>(
    `Сегодня ${dd}.${m}. События этого дня из Википедии:\n${list}\n\n${about(ctx)}\n${ctx.used.length ? `Недавно уже рассказывали про: ${ctx.used.slice(-20).join("; ")}.\n` : ""}
Выбери ОДНО самое захватывающее событие — с интригой, неожиданным поворотом или большими последствиями (не обязательно самое известное) — и расскажи его историю как репортаж-машину времени: читатель будто оказывается там.
"story": 180–260 слов, 3–4 абзаца. Начни с яркой сцены или детали, затем контекст (почему так вышло), кульминация, чем закончилось.
"why": 1–2 предложения — как это событие отзывается в сегодняшнем мире.
"title": заголовок 3–7 слов, интригующий, но честный.
JSON: {"pick": номер, "title":"…","story":"…","why":"…",${RECALL}}`,
    { system: AUTHOR, signal: ctx.signal },
  );
  const e = pool[r.pick] ?? pool[0];
  const sum = e.title ? await wikiSummary(e.title) : null;
  return {
    year: e.year,
    title: r.title,
    story: r.story,
    why: r.why,
    image: sum?.image ?? sum?.thumb ?? e.thumb,
    link: e.link,
    recall: r.recall,
  };
}

/* ───────────── Знаете ли вы ───────────── */

async function genFact(ctx: GenContext): Promise<FactData> {
  const teasers = shuffle(await loadTeasers(), ctx.day).filter((t) => !ctx.used.includes(t.teaser));
  if (!teasers.length) throw new Error("Новых фактов в Википедии пока нет — загляни завтра");
  for (const t of teasers.slice(0, 3)) {
    const text = await wikiText(t.title).catch(() => "");
    if (text.length < 300) continue;
    const sum = await wikiSummary(t.title);
    const r = await ai.json<{ answer: string; recall: { q: string; a: string } }>(
      `Анонс-загадка из рубрики Википедии «Знаете ли вы?»: «${t.teaser}»\n\nСтатья «${t.title}»:\n${text}\n\n
Объясни разгадку анонса: что на самом деле стоит за этой фразой. Опирайся ТОЛЬКО на статью.
"answer": 90–150 слов, 2 абзаца: сначала прямая разгадка, потом самая интересная деталь из статьи вокруг неё.
JSON: {"answer":"…",${RECALL}}`,
      { system: AUTHOR, signal: ctx.signal },
    );
    return { teaser: t.teaser, title: t.title, answer: r.answer, image: sum?.thumb, link: sum?.link ?? `https://ru.wikipedia.org/wiki/${encodeURIComponent(t.title)}`, recall: r.recall };
  }
  throw new Error("Не удалось загрузить статьи для фактов");
}

/* ───────────── задачка ───────────── */

const LEVELS = ["", "лёгкая разминка", "несложная, но с подвохом", "средняя, надо подумать пару минут", "сложная", "очень сложная, для любителей головоломок"];

export async function genPuzzle(ctx: GenContext, topic?: string): Promise<{ data: PuzzleData; quick: QuickPuzzle[] }> {
  const level = Math.min(5, Math.max(1, Math.round(ctx.prefs.level)));
  const r = await ai.json<{ main: Omit<PuzzleData, "level">; quick: { text: string; options: string[]; answer: number; why: string }[] }>(
    `Придумай задачку дня. Сложность: ${level}/5 — ${LEVELS[level]}.
${topic ? `Тип: ${topic}.` : `Тип выбери сам, чередуя: логика (рыцари и лжецы, взвешивания, переправы), математика на смекалку, последовательности, вероятности-парадоксы, задачи-«данетки» на нестандартное мышление, оценка «на салфетке» (задачи Ферми), пространственное мышление.`}
${ctx.used.length ? `Недавно были: ${ctx.used.slice(-15).join("; ")} — не повторяй ни тип подряд, ни сюжеты.` : ""}
Требования: у задачи ровно один бесспорный ответ, условие полное и однозначное. Сначала реши её сам и проверь ответ.
answerType: "number" (ответ — число), "choice" (4 варианта, правдоподобные), "word" (ответ — слово или короткая фраза; в answer перечисли допустимые формы через «|»).
hints: 2 подсказки — первая лишь направляет, вторая почти выдаёт идею. solution: разбор 60–150 слов.

Ещё придумай 3 коротких задачки (quick) на 20–40 секунд, с 3 вариантами ответа, разных типов (логика, счёт в уме, ряд, смекалка). answer — номер верного варианта (0–2), why — объяснение в 1 предложение.

JSON: {"main":{"title":"короткое название","topic":"тип","text":"условие","answerType":"…","options":["…"] (только для choice),"answer":"…","hints":["…","…"],"solution":"…"},"quick":[{"text":"…","options":["…","…","…"],"answer":0,"why":"…"}]}`,
    { system: `${AUTHOR}\nТы составитель головоломок уровня лучших сборников (Перельман, Гарднер, Смаллиан).`, signal: ctx.signal },
  );
  const main = r.main;
  const data: PuzzleData = {
    ...main,
    level,
    options: main.answerType === "choice" ? (main.options ?? []).slice(0, 6) : undefined,
    answer: String(main.answer),
    hints: (main.hints ?? []).slice(0, 3),
  };
  const quick = (r.quick ?? [])
    .filter((q) => q && q.text && Array.isArray(q.options) && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length)
    .map((q) => ({ id: uid(), text: q.text, options: q.options.slice(0, 4).map(String), answer: q.answer, why: String(q.why ?? "") }));
  return { data, quick };
}

/* ───────────── технология ───────────── */

async function genTech(ctx: GenContext): Promise<TechData> {
  const hn = await loadHackerNews().catch(() => []);
  const news = hn.map((h, i) => `[${i}] ${h.title} — ${h.url}`).join("\n");
  const r = await ai.json<TechData & { pick?: number }>(
    `${news ? `Сегодня на главной Hacker News:\n${news}\n\n` : ""}${about(ctx)}
${ctx.used.length ? `Уже рассказывали про: ${ctx.used.slice(-30).join("; ")} — не повторяйся.\n` : ""}
Выбери одну технологию дня — новую или набирающую обороты (софт, железо, ИИ, энергетика, биотех, космос — что интереснее; можно взять повод из новостей выше, а можно другую) — и объясни её так, чтобы через 2 минуты чтения человек понимал суть и мог пересказать другу.
"tagline": одна фраза «что это»; "problem": какую проблему решает (2–3 предложения); "how": как работает — через понятную аналогию (60–110 слов); "where": где уже применяется и кто стоит за ней (2–3 предложения); "try": как потрогать самому за 5 минут, если это возможно (иначе пустая строка); "link": ссылка на источник (из новости или официальный сайт).
JSON: {"name":"…","tagline":"…","problem":"…","how":"…","where":"…","try":"…","link":"…",${RECALL}}`,
    { system: AUTHOR, signal: ctx.signal },
  );
  return { name: r.name, tagline: r.tagline, problem: r.problem, how: r.how, where: r.where, try: r.try || undefined, link: r.link || undefined, recall: r.recall };
}

/* ───────────── понятие ───────────── */

async function genConcept(ctx: GenContext): Promise<ConceptData> {
  return ai.json<ConceptData>(
    `${about(ctx)}
${ctx.used.length ? `Уже были: ${ctx.used.slice(-40).join("; ")} — не повторяйся.\n` : ""}
Выбери одно понятие дня, которое меняет взгляд на мир: ментальная модель, когнитивное искажение, закон, эффект, парадокс, принцип из науки, экономики, психологии, философии, биологии, физики, инженерии. Чередуй области, не только психологию.
"name": точное общепринятое название (как в учебниках и Википедии); "field": область; "idea": суть простыми словами (50–90 слов); "example": яркий жизненный или исторический пример (40–80 слов); "use": как применить в своей жизни или работе (1–2 предложения).
JSON: {"name":"…","field":"…","idea":"…","example":"…","use":"…",${RECALL}}`,
    { system: AUTHOR, signal: ctx.signal },
  );
}

/* ───────────── слово ───────────── */

async function genWord(ctx: GenContext): Promise<WordData> {
  return ai.json<WordData>(
    `${ctx.used.length ? `Уже были слова: ${ctx.used.slice(-60).join(", ")} — не повторяйся.\n` : ""}
Выбери слово дня — русское слово, которое образованный человек может встретить, но не все точно знают значение или употребляют неверно (например: «индифферентный», «амбивалентный», «эпатировать», «скабрёзный», «фрустрация», «паллиатив», «апологет», «синекура») — или слово с удивительной историей происхождения.
"stress": слово с ударением (знак ударения после ударной гласной, например «ска́брёзный»); "meaning": значение (1–2 предложения); "origin": откуда пришло и как менялось — с интересной деталью (40–70 слов); "example": пример употребления в живой фразе.
JSON: {"word":"…","stress":"…","meaning":"…","origin":"…","example":"…","recall":{"q":"Что значит «слово»?","a":"коротко значение"}}`,
    { system: AUTHOR, model: "fast", signal: ctx.signal },
  );
}

/* ───────────── цитата ───────────── */

async function genQuote(ctx: GenContext): Promise<QuoteData> {
  return ai.json<QuoteData>(
    `${about(ctx)}
${ctx.used.length ? `Уже были: ${ctx.used.slice(-60).join("; ")} — не повторяй ни цитату, ни автора подряд.\n` : ""}
Выбери цитату дня от известной личности — учёного, писателя, полководца, политика, философа, предпринимателя, спортсмена, режиссёра. Умную, остроумную или сильную — такую, которую приятно и уместно ввернуть в разговоре. Чередуй эпохи, страны и сферы.
Только цитаты с надёжно подтверждённым авторством (известен источник: книга, речь, письмо, интервью). Никаких «приписываемых» фраз из интернета. Иностранную цитату дай в устоявшемся русском переводе.
"who": кто это одной строкой (род занятий, годы жизни); "context": где и по какому поводу сказано — с живой деталью (40–80 слов); "meaning": в чём глубина мысли (1–2 предложения); "use": в какой ситуации её к месту сказать (1 предложение, конкретно).
JSON: {"text":"…","author":"…","who":"…","context":"…","meaning":"…","use":"…","recall":{"q":"Кто сказал: «…» (начало цитаты)? И как она заканчивается?","a":"автор и цитата целиком"}}`,
    { system: AUTHOR, signal: ctx.signal },
  );
}

/* ───────────── анекдот ───────────── */

/**
 * Анекдот не сочиняется (выдуманные выходят несмешными), а вспоминается: 5 проверенных временем кандидатов,
 * нейронка честно оценивает каждый, берётся самый смешной.
 */
async function genJoke(ctx: GenContext): Promise<JokeData> {
  type Candidate = JokeData & { score: number };
  const r = await ai.json<{ candidates: Candidate[] }>(
    `${ctx.used.length ? `Уже были (не повторяй): ${ctx.used.slice(-60).join("; ")}.\n` : ""}${ctx.disliked.length ? `Не зашли: ${ctx.disliked.slice(-8).join("; ")}.\n` : ""}${ctx.liked.length ? `Понравились: ${ctx.liked.slice(-8).join("; ")}.\n` : ""}
Вспомни 5 НАСТОЯЩИХ известных анекдотов — классику, которую люди пересказывают годами и над которой гарантированно смеются: советские и русские анекдоты (Штирлиц, Вовочка, Петька и Василий Иванович, Шерлок Холмс и Ватсон, Рабинович, армия, студенты, научные, бытовые, про жену и тёщу), лучшие анекдоты про программистов и физиков. Разные темы.
НЕ сочиняй своё и не пересказывай «шутку по мотивам» — только узнаваемые анекдоты с сильной неожиданной концовкой (игра слов, абсурдная логика, переворот ожиданий).
Без пошлости, мата, национальных и политических стереотипов. Короткие: пересказать за 20–30 секунд.
Каждому честно поставь "score" от 1 до 10: насколько засмеётся взрослая компания, если рассказать хорошо. Не завышай.
"setup": всё до последней реплики (диалоги — с новой строки через тире); "punchline": последняя реплика или фраза, ради которой всё — коротко; "topic": тема в 2–3 слова; "when": в какой ситуации его к месту рассказать (1 предложение).
JSON: {"candidates":[{"score":8,"topic":"…","setup":"…","punchline":"…","when":"…","recall":{"q":"Анекдот про … (завязка в двух словах) — чем заканчивается?","a":"концовка"}}]}`,
    { system: `${AUTHOR}\nТы собиратель лучших анекдотов и знаешь, как их рассказывать: ритм, пауза перед концовкой.`, signal: ctx.signal },
  );
  const best = (r.candidates ?? []).filter((c) => c?.setup && c?.punchline).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!best) throw new Error("Не удалось подобрать анекдот");
  const { score: _s, ...joke } = best;
  return joke;
}

/* ───────────── стих ───────────── */

async function genPoem(ctx: GenContext): Promise<PoemData> {
  const fresh = POEMS.filter(([, line]) => !ctx.used.includes(line));
  const order = shuffle(fresh.length ? fresh : POEMS, ctx.day);
  for (const [author, firstLine] of order.slice(0, 4)) {
    const p = await loadPoem(author, firstLine).catch(() => null);
    if (!p) continue;
    const r = await ai.json<{ title: string; about: string; notice: string }>(
      `Стихотворение: ${author}, «${p.title}».\n\n${p.lines.join("\n")}\n\n
"title": как обычно называют это стихотворение (название или первая строка без автора);
"about": когда и при каких обстоятельствах написано, кому посвящено, что происходило с автором (50–90 слов, только достоверное);
"notice": на что обратить внимание при чтении — образ, приём, звук, скрытый смысл (40–70 слов).
JSON: {"title":"…","about":"…","notice":"…"}`,
      { system: AUTHOR, model: "fast", signal: ctx.signal },
    );
    return { author, title: r.title || p.title, lines: p.lines, about: r.about, notice: r.notice, link: p.link, firstLine };
  }
  throw new Error("Не удалось загрузить стих из Викитеки");
}

/* ───────────── картина ───────────── */

async function genArt(ctx: GenContext): Promise<ArtData> {
  const r = await ai.json<{ candidates: { title: string; artist: string; year: string; ruWiki: string; enWiki: string }[] }>(
    `${about(ctx)}
${ctx.used.length ? `Уже были: ${ctx.used.slice(-40).join("; ")} — не повторяйся.\n` : ""}
Предложи 3 картины для рубрики «Картина дня»: шедевры живописи разных эпох и стран (не только самые хрестоматийные — можно и малоизвестные работы великих, и знаковые картины XX века), у каждой есть отдельная статья в Википедии.
Для каждой: точное название статьи в русской Википедии (ruWiki) и в английской (enWiki).
JSON: {"candidates":[{"title":"…","artist":"…","year":"…","ruWiki":"…","enWiki":"…"}]}`,
    { system: AUTHOR, model: "fast", signal: ctx.signal },
  );
  for (const c of r.candidates ?? []) {
    const sum = (c.ruWiki && (await wikiSummary(c.ruWiki))) || (c.enWiki && (await wikiSummary(c.enWiki, "en"))) || null;
    const image = sum?.image ?? sum?.thumb;
    if (!sum || !image) continue;
    const text = sum.link.includes("ru.wikipedia") ? await wikiText(c.ruWiki, 8000).catch(() => sum.extract) : sum.extract;
    const d = await ai.json<{ story: string; look: string; recall: { q: string; a: string } }>(
      `Картина: ${c.artist}, «${c.title}» (${c.year}).\nИз Википедии:\n${text}\n\n
"story": история картины — кто, почему и как её написал, что с ней было потом, скандалы и тайны (100–160 слов, 2 абзаца);
"look": на что смотреть — 2–3 детали на холсте, которые обычно пропускают (40–80 слов).
JSON: {"story":"…","look":"…",${RECALL}}`,
      { system: AUTHOR, signal: ctx.signal },
    );
    return { title: c.title, artist: c.artist, year: c.year, image, story: d.story, look: d.look, link: sum.link, recall: d.recall };
  }
  throw new Error("Не нашлась картина с изображением — попробуй ещё раз");
}

/* ───────────── копнуть глубже ───────────── */

export function cardContext(kind: Kind, data: CardData): string {
  const d = data as any;
  switch (kind) {
    case "history":
      return `Событие ${d.year} года: ${d.title}.\n${d.story}`;
    case "fact":
      return `Факт: ${d.teaser}\nРазгадка: ${d.answer}`;
    case "quote":
      return `Цитата: «${d.text}» — ${d.author} (${d.who})
${d.context}`;
    case "joke":
      return `Анекдот: ${d.setup}
${d.punchline}`;
    case "puzzle":
      return `Задачка: ${d.text}\nОтвет: ${d.answer}\nРазбор: ${d.solution}`;
    case "tech":
      return `Технология: ${d.name} — ${d.tagline}\n${d.how}`;
    case "concept":
      return `Понятие: ${d.name} (${d.field})\n${d.idea}`;
    case "word":
      return `Слово: ${d.word} — ${d.meaning}\n${d.origin}`;
    case "poem":
      return `Стихотворение: ${d.author}, «${d.title}»\n${d.lines.join("\n")}`;
    case "art":
      return `Картина: ${d.artist}, «${d.title}» (${d.year})\n${d.story}`;
  }
}

export const DEEPER_SYSTEM = `${AUTHOR}
Ты отвечаешь на вопросы читателя по карточке альманаха: глубже, с неожиданными связями с другими областями, историями и примерами. Отвечай 80–200 слов, если не просят подробнее. В конце можно предложить, куда копнуть дальше.`;

export const DEEPER_STARTERS = ["Расскажи подробнее", "А что было дальше?", "Как это связано с сегодняшним днём?", "Объясни как пятилетнему", "Что почитать или посмотреть?"];
