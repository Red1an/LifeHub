import { ai } from "@lifehub/sdk";
import { LEVEL_NAMES, topicById, trackById, type Topic } from "../data/curriculum.ts";
import type { Lesson, PracticeTask, Settings, Step } from "./types.ts";

/*
 * Все обращения к нейронке. Ответы, которые нужны потом (уроки, задачи, разборы),
 * сохраняются в коллекции — повторно не запрашиваются.
 */

const levelText = (l: number) => (l === 1 ? "junior, крепкая база" : l === 2 ? "middle, хочет стать senior" : "senior, хочет стать архитектором/экспертом");

export function persona(s: Settings) {
  return `Ученик — разработчик на C#/.NET уровня ${levelText(s.level)}. Цель — стать высококлассным инженером.${s.about ? ` О себе: ${s.about}` : ""}`;
}

function topicContext(topicId: string) {
  const t = topicById(topicId)!;
  const tr = trackById(t.trackId)!;
  return `Трек: ${tr.title}. Тема: «${t.title}» (уровень: ${LEVEL_NAMES[t.level]}). ${t.summary}\nКлючевые пункты темы:\n${t.points.map((p) => "- " + p).join("\n")}`;
}

const TEACHER = `Ты — сильный практикующий инженер и лучший преподаватель, объясняешь живо, с аналогиями из жизни и примерами из реальных проектов.
Пиши по-русски, термины — как принято в индустрии (можно по-английски в скобках). Примеры кода — на C# (современный, .NET 8+), если тема не требует другого языка (bash, YAML, SQL, Dockerfile, Python для ML, язык 1С).
Не лей воду. Будь точным: никаких выдуманных API.`;

const STEP_SCHEMA = `Типы шагов (поле kind):
- {"kind":"explain","title":"…","md":"markdown, 60–180 слов, может содержать блок кода с указанием языка"}
- {"kind":"choice","question":"…","code":"необязательный фрагмент кода","options":["…","…","…","…"],"correct":0,"why":"почему верный ответ верный, а остальные нет"}
- {"kind":"order","question":"Расставь по порядку …","options":["в ПРАВИЛЬНОМ порядке","…","…","…"],"why":"…"}
- {"kind":"bug","question":"Найди строку с ошибкой","lines":["строка кода 1","строка 2","…"],"bugLine":3,"why":"в чём ошибка","fix":"исправленная строка"}
- {"kind":"open","question":"вопрос, на который надо ответить своими словами","hint":"подсказка"}
В choice правильный вариант ставь на случайную позицию, неверные варианты — правдоподобные (типичные заблуждения). В bug — 6–14 строк, ошибка смысловая, а не опечатка.`;

export async function generateLesson(topicId: string, s: Settings, depth: Lesson["depth"], signal?: AbortSignal): Promise<Lesson> {
  const depthText =
    depth === "simple" ? "Объясняй максимально просто, с бытовыми аналогиями, меньше деталей." :
    depth === "deep" ? "Иди глубоко: внутреннее устройство, крайние случаи, производительность, как это спрашивают на собеседованиях senior-уровня." :
    "Баланс глубины и понятности, с акцентом на практику.";
  const r = await ai.json<{ steps: Step[] }>(
    `${topicContext(topicId)}\n\n${persona(s)}\n\nСоставь интерактивный урок по теме — как в Duolingo/Brilliant: 10–14 шагов. Чередуй объяснения (explain) и интерактив: после каждых 1–2 объяснений — проверочный шаг (choice, order или bug). Первый шаг — цепляющее вступление: зачем это нужно и где стреляет в реальной жизни. Хотя бы один шаг choice с кодом «что выведет программа?». Один шаг bug. Предпоследний — open (объяснить своими словами). Последний — explain «Итоги» со списком главного и тем, что изучить дальше. ${depthText}\n\n${STEP_SCHEMA}\n\nВерни JSON: {"steps":[…]}`,
    { system: TEACHER, signal },
  );
  return { steps: sanitizeSteps(r.steps), depth, createdAt: Date.now() };
}

/** Экзамен трека («босс»): вопросы по пройденным темам. */
export async function generateBoss(trackId: string, topics: Topic[], s: Settings, signal?: AbortSignal): Promise<Step[]> {
  const tr = trackById(trackId)!;
  const r = await ai.json<{ steps: Step[] }>(
    `Трек: ${tr.title}. Экзамен по темам:\n${topics.map((t) => `- ${t.title}: ${t.points.join("; ")}`).join("\n")}\n\n${persona(s)}\n\nСоставь сложный экзамен из 10 заданий уровня реального собеседования: 6 choice (часть — с кодом), 2 bug, 1 order, 1 open. Задания без объясняющих шагов. Сложность растёт к концу.\n\n${STEP_SCHEMA}\n\nВерни JSON: {"steps":[…]}`,
    { system: TEACHER, signal },
  );
  return sanitizeSteps(r.steps).filter((x) => x.kind !== "explain");
}

export async function generateBug(topicId: string, s: Settings, signal?: AbortSignal) {
  const r = await ai.json<Extract<Step, { kind: "bug" }> & { title: string }>(
    `${topicContext(topicId)}\n\n${persona(s)}\n\nПридумай задачу «найди баг» по этой теме: реалистичный фрагмент кода 8–16 строк из продакшен-кода с одной коварной смысловой ошибкой (утечка, гонка, неверная асинхронщина, N+1, дыра в безопасности, ошибка конфигурации и т.п. — что подходит теме).\nJSON: {"title":"короткое название","kind":"bug","question":"контекст: что должен делать код","lines":["…"],"bugLine":0,"why":"подробно: в чём баг и чем он опасен","fix":"как исправить (можно несколько строк)"}`,
    { system: TEACHER, signal },
  );
  return { ...r, kind: "bug" as const };
}

export async function generatePractice(topicId: string, s: Settings, kind: PracticeTask["kind"] | "auto", signal?: AbortSignal) {
  const kinds = {
    auto: "Выбери формат, лучше всего подходящий теме",
    code: "Формат code: написать код на C# (класс, метод, небольшой сервис)",
    design: "Формат design: спроектировать решение (схема словами, компоненты, trade-offs)",
    lab: "Формат lab: практическая лабораторная, которую ученик делает у себя на компьютере (docker, kubectl, dotnet CLI, git…) и присылает результат/вывод/файлы",
    explain: "Формат explain: объяснить явление или сравнить подходы так, будто объясняешь коллеге",
  };
  const r = await ai.json<Omit<PracticeTask, "topicId" | "createdAt">>(
    `${topicContext(topicId)}\n\n${persona(s)}\n\nПридумай одну практическую задачу по теме, похожую на реальную рабочую задачу, на 20–40 минут. ${kinds[kind]}.\nJSON: {"title":"…","kind":"code|design|lab|explain","statement":"условие в markdown: контекст, что сделать, ограничения, пример входа/выхода если уместно","hints":["подсказка 1","подсказка 2","подсказка 3"],"criteria":["критерий оценки 1","…"]}`,
    { system: TEACHER, signal },
  );
  return { ...r, topicId, createdAt: Date.now() } as PracticeTask;
}

export const REVIEWER = `${TEACHER}
Ты проверяешь решения как строгий, но доброжелательный тимлид на код-ревью. Первая строка ответа — ровно «ОЦЕНКА: N/10». Далее markdown: что хорошо, что плохо (конкретно, со строками), как сделать лучше (с кодом), на что обратить внимание на будущее.`;

export function reviewPrompt(task: PracticeTask, answer: string) {
  return `${topicContext(task.topicId)}\n\nЗадача: ${task.title}\n${task.statement}\n\nКритерии: ${task.criteria.join("; ")}\n\nРешение ученика:\n${answer}`;
}

export const parseScore = (text: string) => {
  const m = text.match(/ОЦЕНКА:\s*(\d+(?:[.,]\d+)?)\s*\/\s*10/i);
  return m ? Math.round(parseFloat(m[1].replace(",", ".")) * 10) : undefined;
};

export interface Grade {
  score: number;
  verdict: string;
  feedback: string;
  ideal: string;
}

/** Оценка ответа своими словами. */
export async function gradeOpen(question: string, answer: string, topicId?: string, signal?: AbortSignal) {
  return ai.json<Grade>(
    `${topicId ? topicContext(topicId) + "\n\n" : ""}Вопрос: ${question}\n\nОтвет ученика: ${answer}\n\nОцени ответ как интервьюер. JSON: {"score": 0–10, "verdict":"одна фраза", "feedback":"что верно, что упущено или неверно — кратко, markdown", "ideal":"эталонный ответ, 3–6 предложений"}`,
    { system: TEACHER, signal },
  );
}

export async function generateQuestion(topicId: string, s: Settings, signal?: AbortSignal) {
  return ai.json<{ question: string; hint: string }>(
    `${topicContext(topicId)}\n\n${persona(s)}\n\nЗадай один вопрос с технического собеседования по этой теме, на который надо ответить развёрнуто своими словами (не «да/нет»). JSON: {"question":"…","hint":"подсказка, в какую сторону думать"}`,
    { system: TEACHER, model: "fast", signal },
  );
}

export async function generateCards(topicId: string, material: string, signal?: AbortSignal) {
  return ai.json<{ front: string; back: string }[]>(
    `${topicContext(topicId)}\n\nМатериал:\n${material.slice(0, 6000)}\n\nСделай 6–8 карточек для интервального повторения: вопрос — конкретный, ответ — 1–3 предложения. Проверяй понимание, а не заучивание формулировок. JSON: [{"front":"вопрос","back":"ответ"}]`,
    { system: TEACHER, model: "fast", signal },
  );
}

export function mentorSystem(s: Settings, mode: "mentor" | "interview" | "socrat", topicId?: string, trackId?: string) {
  const ctx = topicId ? topicContext(topicId) : trackId ? `Трек: ${trackById(trackId)?.title}` : "";
  if (mode === "interview") {
    return `Ты — интервьюер на техническом собеседовании в сильную компанию на позицию .NET-разработчика. ${persona(s)} ${ctx}
Правила: задавай ОДИН вопрос за раз. После ответа кандидата коротко оцени его (✅/⚠️/❌ и 1–3 предложения), при необходимости задай уточняющий вопрос вглубь, затем следующий. Смешивай теорию, живые кейсы («у вас в проде…») и вопросы на рассуждение. Через 6–8 вопросов (или если попросят закончить) дай итог: уровень (junior/middle/senior), сильные стороны, пробелы, что подтянуть — и последней строкой «ОЦЕНКА: N/10». Пиши по-русски.`;
  }
  if (mode === "socrat") {
    return `Ты — наставник, обучающий методом Сократа. ${persona(s)} ${ctx}
Не давай готовых ответов сразу: веди ученика наводящими вопросами, по одному за раз, чтобы он сам пришёл к пониманию. Если он застрял дважды — дай подсказку, затем объяснение. Коротко, по-русски.`;
  }
  return `Ты — личный наставник и ментор ученика, опытный архитектор .NET-систем и DevOps-инженер. ${persona(s)} ${ctx}
Отвечай по делу, с примерами кода и аналогиями, markdown. Если вопрос размытый — уточни. В конце длинных объяснений предлагай, что попрактиковать.`;
}

/* ───────────── Мастерская ───────────── */

/** Наставник в миссии: ведёт к решению, но не решает за ученика. */
export const WORKSHOP_MENTOR = `${TEACHER}
Ты — наставник-сеньор рядом с учеником, который сам чинит учебный проект. Цель — чтобы он научился думать, а не получил ответ.
Жёсткие правила: НЕ пиши код решения и не называй, какие строки на что заменить. Можно: задать 1–2 наводящих вопроса,
показать, куда смотреть, объяснить принцип на другом, маленьком примере, разобрать его гипотезу (что в ней верно, что нет).
Если ученик явно застрял после нескольких попыток — назови направление прямее, но всё равно без готового кода.
Коротко: 3–8 предложений, markdown.`;

interface MissionContext {
  title: string;
  story: string;
  task: string;
  hypothesis: string;
  failing: string[];
  diff: string;
}

const missionContext = (c: MissionContext) =>
  [
    `Миссия: ${c.title}`,
    `Ситуация:\n${c.story}`,
    `Задание:\n${c.task}`,
    `Гипотеза ученика до начала: ${c.hypothesis || "(не написал)"}`,
    `Не проходят тесты:\n${c.failing.length ? c.failing.map((f) => "- " + f).join("\n") : "(ещё не проверял или всё зелёное)"}`,
    `Изменения ученика (git diff от заготовки):\n${c.diff.trim() ? c.diff.slice(0, 12000) : "(ничего не менял)"}`,
  ].join("\n\n");

export function missionMentorPrompt(c: MissionContext, question: string) {
  return `${missionContext(c)}\n\nВопрос ученика: ${question || "Я застрял. Куда смотреть?"}`;
}

export const WORKSHOP_REVIEWER = `${TEACHER}
Ты — тимлид на код-ревью. Ученик прошёл учебную миссию: все тесты зелёные. Теперь важно не «работает ли», а «хорошо ли».
Разбери его diff: что сделано хорошо; что сработает в тестах, но сломается в жизни (крайние случаи, нагрузка, читаемость);
какие были альтернативы и почему выбранное решение хуже или лучше их; сравни с его исходной гипотезой.
Тут можно показывать код. Markdown, по делу, без воды, до 300 слов.`;

export function missionReviewPrompt(c: MissionContext) {
  return missionContext(c);
}

/* ───────────── этапы проекта: ревью, защита, дизайн ───────────── */

/** Сколько нужно набрать, чтобы пройти ревью, защиту и дизайн. */
export const PASS_SCORE = 7;

export interface StageContext {
  project: string;
  stage: string;
  story: string;
  task: string;
  plan: string;
  diff: string;
  tests: string;
}

const stageContext = (c: StageContext) =>
  [
    `Проект: ${c.project}. Этап: ${c.stage}`,
    `Зачем этап:\n${c.story.slice(0, 2500)}`,
    `Требования:\n${c.task.slice(0, 4000)}`,
    `План (или дизайн-документ) ученика до кода:\n${c.plan.slice(0, 6000) || "(нет)"}`,
    `Тесты хаба: ${c.tests}`,
    `Код этапа (git diff от начала этапа, тесты хаба исключены):\n${c.diff.trim() ? c.diff.slice(0, 30000) : "(изменений нет)"}`,
  ].join("\n\n");

export const STAGE_REVIEWER = `${TEACHER}
Ты — строгий тимлид на обязательном код-ревью. Тесты уже зелёные — оцениваешь не «работает ли», а «можно ли это мержить в продакшен-проект».
Критерии (каждый проверь по коду, со ссылками на файлы и строки из diff):
1. Корректность за пределами тестов: крайние случаи, гонки, ошибки, отмена, транзакции.
2. Устройство: границы ответственности, слои, зависимости, нет ли «всего в Program.cs», понятно ли, где что менять.
3. Читаемость: имена, размер методов, дублирование, комментарии там, где неочевидно «почему».
4. Надёжность и безопасность: валидация, обработка ошибок, утечки ресурсов, секреты, инъекции.
5. Производительность там, где она важна для этапа: N+1, лишние аллокации, блокировки.
6. Тесты ученика (если есть): проверяют ли поведение, а не реализацию; покрыты ли границы.
Формат ответа строго:
Первая строка — «ОЦЕНКА: N/10» (целое). 7+ — только если нет блокирующих замечаний.
## Обязательно исправить
(пронумерованный список; пусто — напиши «Нет»)
## Стоит улучшить
## Что хорошо
Будь конкретным, показывай код исправления там, где это помогает. Не хвали за то, чего нет.`;

export function stageReviewPrompt(c: StageContext) {
  return stageContext(c);
}

/** Интервьюер защиты: вопросы по коду и решениям ученика, по одному. */
export function defenseSystem(c: StageContext) {
  return `${TEACHER}
Ты — интервьюер уровня senior на защите этапа учебного проекта. Ниже — что ученик должен был сделать, его план и его код.
Задача — проверить, что он ПОНИМАЕТ своё решение и умеет его защищать, как на собеседовании.
Правила:
- Задавай РОВНО ОДИН вопрос за сообщение, коротко. Всего 5 вопросов.
- Вопросы — по его коду и решениям: «почему здесь так, а не иначе», «что сломается, если…», «как поведёт себя при 10x нагрузке / двух серверах / падении зависимости», «какие альтернативы ты отбросил и почему».
- Если ответ слабый или общий — копни глубже следующим вопросом. Не подсказывай ответ.
- Перед следующим вопросом одной фразой оцени предыдущий ответ (✅ / ⚠️ / ❌ и почему).
- После ответа на 5-й вопрос: итог — сильные стороны, что подтянуть (конкретные темы), и последней строкой «ОЦЕНКА: N/10».
  7+ — только если ученик уверенно объяснил ключевые решения своего кода.

${stageContext(c)}`;
}

export const ARCHITECT = `${TEACHER}
Ты — архитектор, который принимает дизайн-документ перед разработкой. Ученик проектирует часть системы сам, без готового контракта.
Оцени по критериям:
1. Требования: функциональные и нефункциональные (нагрузка, задержки, надёжность — с числами), что вне рамок.
2. API и контракты: эндпоинты/сообщения, форматы, коды ошибок, идемпотентность.
3. Данные: модель, где хранится, индексы, консистентность.
4. Потоки: что происходит по шагам в основных сценариях.
5. Отказы: что если упадёт каждая зависимость, ретраи, дубликаты, порядок.
6. Масштабирование и узкие места.
7. Альтернативы и компромиссы: что отбросил и почему.
8. Наблюдаемость: как понять, что работает.
Формат ответа строго:
Первая строка — «ОЦЕНКА: N/10» (целое). 7+ — только если по документу можно начинать разработку без больших дыр.
## Дыры (что обязательно доработать)
## Вопросы, которые задаст ревьюер
## Что хорошо
Не переписывай дизайн за ученика: указывай, ЧТО продумать, а не готовое решение.`;

export function designReviewPrompt(c: { project: string; stage: string; story: string; brief: string; doc: string }) {
  return [`Проект: ${c.project}. Этап: ${c.stage}`, `Контекст:\n${c.story}`, `Задание на проектирование:\n${c.brief}`, `Дизайн-документ ученика:\n${c.doc.slice(0, 20000)}`].join("\n\n");
}

/** Оценка задачи System Design: те же критерии, что у архитектора, плюс сверка с эталоном (сам эталон ученику не пересказывать). */
export function designTaskPrompt(c: { title: string; task: string; requirements: string; reference: string; doc: string }) {
  return [
    `Задача System Design: ${c.title}`,
    `Условие:\n${c.task}`,
    `Требования:\n${c.requirements}`,
    `Эталонный разбор (для сверки; не пересказывай его ученику — укажи, что упущено, вопросами):\n${c.reference}`,
    `Дизайн-документ ученика:\n${c.doc.slice(0, 20000)}`,
  ].join("\n\n");
}

/** Нормализация шагов от нейронки: отбрасываем битые. */
function sanitizeSteps(steps: Step[]): Step[] {
  if (!Array.isArray(steps)) throw new Error("Нейронка вернула урок в неожиданном формате — попробуйте ещё раз");
  return steps.filter((x) => {
    if (!x || typeof x !== "object") return false;
    switch (x.kind) {
      case "explain": return typeof x.md === "string";
      case "choice": return Array.isArray(x.options) && x.options.length >= 2 && x.correct >= 0 && x.correct < x.options.length;
      case "order": return Array.isArray(x.options) && x.options.length >= 2;
      case "bug": return Array.isArray(x.lines) && x.bugLine >= 0 && x.bugLine < x.lines.length;
      case "open": return typeof x.question === "string";
      case "recall": return typeof x.question === "string" && typeof x.answer === "string";
      default: return false;
    }
  });
}
