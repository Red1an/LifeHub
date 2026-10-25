import crypto from "node:crypto";
import { ask } from "../ai.ts";
import * as db from "../db.ts";
import { emit, subscribe } from "../events.ts";
import { getSettings, updateSettings, type Settings } from "../settings.ts";
import { ensureNgrokPolicy, ngrokStatus } from "../ngrok.ts";
import { dayKey, normalize, plural, wordsToDigits, type AliceEntity } from "./nlu.ts";
import { MODULE, prefs } from "./prefs.ts";
import { aiContext, handle, type Ctx, type Reply, type SessionState } from "./skills.ts";
import { join, type Part, type Say } from "./speech.ts";
import { handlePc } from "./pcskills.ts";
import { PcError, warmUp } from "./pc.ts";
import { SCREEN_RE, makePlan, runDirect, screenshot, searchStep, type Exchange } from "./agent.ts";
import { closeApp, tabCommand } from "./pcskills.ts";
import { launch, writeLibrary } from "./library.ts";
import { browserConnected, splitWorkspace, startBrowser } from "./browser.ts";
import { startFocus } from "../focus.ts";
import { pc } from "./pc.ts";
import type { CustomCommand, Step } from "./prefs.ts";
import { addOwnerSample, addStrangerSample, applyVoiceConfig, enrollVoice, installVoice, resetVoiceprint, restartVoice, startVoice, testVoice, voiceControl } from "./voice.ts";

/*
 * Джарвис — голосовой помощник хаба. Говорить с ним можно:
 *  - голосом на компьютере (voice.ts → converse("voice")) — основной способ;
 *  - текстом в модуле «Джарвис» (коллекция "chat" → converse("text"));
 *  - через колонку с Алисой (вебхук ниже → respond()).
 *
 * Разбор фразы: свои команды → компьютер (pcskills.ts) → хаб (skills.ts) → нейронка с планом
 * действий (agent.ts). Для Алисы — без компьютера и с лимитом 3 секунды.
 *
 * Навык Алисы:
 * Яндекс присылает каждую фразу POST-запросом на https://<домен ngrok>/alice/<секрет>.
 * Путь /alice/ ngrok пропускает без входа через Google (иначе Яндекс не достучится),
 * поэтому доступ держится на секрете в адресе и привязке к одному навыку (skill_id).
 *
 * Ответ должен уйти меньше чем за 3 секунды, поэтому почти всё отвечается правилами
 * (skills.ts). Нейронка — только для свободных вопросов: запрос уходит в фон, а ответ
 * Джарвис отдаёт по фразе «ну что». Число таких запросов в день ограничено.
 *
 * Интерфейс — модуль «Джарвис» (modules/jarvis). Он общается с хабом через свои данные:
 *  - kv "config" — настройки (prefs.ts), в т.ч. включён ли навык;
 *  - kv "action" — разовые действия: новый адрес, сброс привязки;
 *  - kv "status" — пишет хаб: адрес вебхука, ngrok, подключён ли навык;
 *  - коллекция "chat" — разговор: модуль добавляет { q, source: "hub" }, хаб дописывает ответ;
 *    разговоры с колонкой хаб сохраняет туда же с source: "alice".
 */

type Secrets = NonNullable<Settings["jarvis"]>;

/** Сколько ждём ответ правил: остальное время — на сеть до Яндекса. */
const ANSWER_BUDGET_MS = 2600;
/** Сколько ждём нейронку прямо в запросе — вдруг ответит быстро. */
const AI_WAIT_MS = 1800;
const HISTORY_LIMIT = 300;

const secrets = (): Secrets => ({ secret: "", ...getSettings().jarvis });

function saveSecrets(patch: Partial<Secrets>) {
  updateSettings({ jarvis: { ...secrets(), ...patch } });
}

const newSecret = () => crypto.randomBytes(18).toString("base64url");

/* ───────────── связь с модулем ───────────── */

function changed(collection: string) {
  emit({ type: "data", module: MODULE, collection, origin: "jarvis" });
}

let lastRequestAt: number | null = null;

export interface JarvisStatus {
  enabled: boolean;
  url: string | null;
  ngrok: { enabled: boolean; running: boolean; domain: string; error?: string };
  hasPassword: boolean;
  linked: boolean;
  lastAt: number | null;
  aiUsedToday: number;
  checkedAt: number;
}

export async function jarvisStatus(): Promise<JarvisStatus> {
  const p = prefs();
  const s = secrets();
  const ng = await ngrokStatus().catch(() => null);
  const today = dayKey();
  return {
    enabled: p.enabled,
    url: p.enabled && s.secret && ng?.enabled && ng.domain ? `https://${ng.domain}/alice/${s.secret}` : null,
    ngrok: { enabled: !!ng?.enabled, running: !!ng?.running, domain: ng?.domain ?? "", error: ng?.error },
    hasPassword: !!getSettings().password,
    linked: !!s.skillId,
    lastAt: lastRequestAt ?? s.lastAt ?? null,
    aiUsedToday: s.aiUsed?.date === today ? s.aiUsed.n : 0,
    checkedAt: Date.now(),
  };
}

let lastStatus = "";

/** Статус для модуля: пишется, только если что-то поменялось. */
async function writeStatus() {
  const st = await jarvisStatus();
  const key = JSON.stringify({ ...st, checkedAt: 0 });
  if (key === lastStatus) return;
  lastStatus = key;
  db.setKv(MODULE, "status", st);
  changed("kv:status");
}

/** Включение из модуля: секрет, политика ngrok, голос. */
async function applyConfig() {
  applyVoiceConfig();
  const p = prefs();
  if (p.enabled) {
    if (!secrets().secret) saveSecrets({ secret: newSecret(), skillId: undefined });
    await ensureNgrokPolicy();
  }
  await writeStatus();
}

async function applyAction() {
  const a = db.getKv(MODULE, "action") as { kind?: string } | undefined;
  if (!a?.kind) return;
  db.setKv(MODULE, "action", null);
  if (a.kind === "rotate") saveSecrets({ secret: newSecret(), skillId: undefined });
  if (a.kind === "unlink") saveSecrets({ skillId: undefined });
  if (a.kind === "voice.install") void installVoice();
  if (a.kind === "voice.restart") restartVoice();
  if (a.kind === "voice.test") testVoice();
  if (a.kind === "voice.mute") voiceControl({ mute: true });
  if (a.kind === "voice.unmute") voiceControl({ mute: false, sleep: false });
  if (a.kind === "voice.enroll") enrollVoice();
  if (a.kind === "voice.enroll.reset") resetVoiceprint();
  if (a.kind === "voice.owner.add") addOwnerSample();
  if (a.kind === "voice.owner.not") addStrangerSample();
  if (a.kind === "library.refresh") void writeLibrary().catch((e) => console.error("[jarvis] библиотека", e));
  if (a.kind === "launch" && typeof (a as any).target?.value === "string") void launch((a as any).target).catch(() => {});
  if (a.kind === "scenario" && typeof (a as any).id === "string") {
    const cmd = prefs().commands.find((c) => c.id === (a as any).id);
    if (cmd) void runScenario(cmd, "text").catch(() => {});
  }
  await writeStatus();
}

let chatBusy: Promise<void> = Promise.resolve();

/** Сообщения из модуля без ответа — отвечаем по очереди. */
function answerChat() {
  chatBusy = chatBusy.then(async () => {
    const docs = db.listDocs(MODULE, "chat");
    for (const d of docs) {
      if (d.source !== "hub" || typeof d.a === "string") continue;
      const turn = await converse("text", String(d.q ?? ""));
      db.putDoc(MODULE, "chat", d.id, { a: turn.text, buttons: turn.buttons, ms: turn.ms, ai: turn.ai }, true);
      changed("chat");
    }
  });
}

function logAlice(q: string, r: AliceResponse) {
  if (!q) return;
  logTurn({ q, a: r.response.text, source: "alice" });
}

function logTurn(doc: { q: string; a: string; source: "alice" | "voice"; ms?: number; ai?: boolean }) {
  if (!prefs().history) return;
  db.putDoc(MODULE, "chat", undefined, { ...doc, at: Date.now() }, false);
  const all = db.listDocs(MODULE, "chat");
  for (const d of all.slice(0, Math.max(0, all.length - HISTORY_LIMIT))) db.deleteDoc(MODULE, "chat", d.id);
  changed("chat");
}

let hubUrl = "http://localhost:4200";

/** Вызывается при старте хаба: слушает модуль, держит статус свежим, запускает голос. */
export function startJarvis(opts: { port: number; https: boolean } = { port: 4200, https: false }) {
  hubUrl = `${opts.https ? "https" : "http"}://localhost:${opts.port}`;
  startVoice(opts);
  startBrowser();
  startFocus(); // расширение у Джарвиса и «Фокуса» общее
  warmUp();
  setTimeout(() => void writeLibrary().catch(() => {}), 15_000);
  setInterval(() => void writeLibrary().catch(() => {}), 60 * 60_000).unref();
  subscribe((e) => {
    if (e.type !== "data" || e.module !== MODULE || e.origin === "jarvis") return;
    if (e.collection === "kv:config") void applyConfig().catch((err) => console.error("[jarvis]", err));
    else if (e.collection === "kv:action") void applyAction().catch((err) => console.error("[jarvis]", err));
    else if (e.collection === "chat") answerChat();
  });
  // ngrok запускается и падает сам по себе — статус сверяем раз в полминуты.
  setTimeout(() => void writeStatus().catch(() => {}), 3000);
  setInterval(() => void writeStatus().catch(() => {}), 30_000).unref();
}

/* ───────────── нейронка в фоне ───────────── */

interface AiJob {
  done: boolean;
  text?: string;
  error?: string;
  at: number;
  promise: Promise<void>;
}

const jobs = new Map<string, AiJob>();

function aiAllowed(): boolean {
  const p = prefs();
  if (!p.ai) return false;
  const s = secrets();
  const used = s.aiUsed?.date === dayKey() ? s.aiUsed.n : 0;
  return used < p.aiLimit;
}

function startAi(question: string): string {
  for (const [k, j] of jobs) if (Date.now() - j.at > 30 * 60_000) jobs.delete(k);
  const s = secrets();
  const p = prefs();
  const today = dayKey();
  saveSecrets({ aiUsed: { date: today, n: (s.aiUsed?.date === today ? s.aiUsed.n : 0) + 1 } });
  void writeStatus().catch(() => {});
  const key = crypto.randomBytes(6).toString("hex");
  const job: AiJob = { done: false, at: Date.now(), promise: Promise.resolve() };
  job.promise = (async () => {
    try {
      const context = await aiContext(new Date());
      const system =
        "Ты — Джарвис, голосовой помощник пользователя, отвечаешь через колонку с Алисой. " +
        "Отвечай по-русски, коротко: 1–3 предложения, без markdown, списков, ссылок и эмодзи — ответ озвучивается. " +
        (p.address ? `Обращайся к пользователю «${p.address}». ` : "") +
        "Ниже данные из личного хаба пользователя — используй их, если вопрос о его делах. " +
        "Менять календарь и данные ты не можешь: если просят — подскажи команду, например «поставь тренировку завтра в 7 вечера».";
      job.text = (await ask({ system, prompt: `${context}\n\nВопрос: ${question}`, model: "fast" })).trim();
    } catch (e) {
      job.error = (e as Error).message;
    } finally {
      job.done = true;
    }
  })();
  jobs.set(key, job);
  return key;
}

function aiAnswer(job: AiJob): Reply {
  if (job.error) return { say: { text: `Нейронка не ответила: ${job.error}`, tts: "Нейронка не ответила. Подробности на экране." }, state: {} };
  const text = (job.text || "Мне нечего ответить.").replace(/[*_#`]/g, "");
  return { say: { text: text.slice(0, 1024), tts: text.slice(0, 1024) }, state: {} };
}

/* ───────────── свои команды ───────────── */

/** Своя команда из модуля: фраза → что сказать и какие команды выполнить следом. */
async function custom(ctx: Ctx): Promise<Reply | null> {
  const cmd = prefs().commands.find((c) => c.phrases.some((p) => {
    const n = normalize(p);
    return n && (ctx.text === n || ctx.text.startsWith(n + " ") || ctx.text.endsWith(" " + n));
  }));
  if (!cmd) return null;
  const parts: Part[] = cmd.say.trim() ? [cmd.say.trim()] : [];
  for (const run of cmd.run.filter((r) => r.trim()).slice(0, 5)) {
    const r = await handle({ ...ctx, text: normalize(run), raw: run, state: {} }).catch(() => null);
    if (r) parts.push(r.say);
  }
  const say = join(parts, 400);
  return { say: say.text ? say : { text: "Готово.", tts: "Готово." }, state: {} };
}

/* ───────────── обработка фразы ───────────── */

export interface Utterance {
  command: string;
  original: string;
  entities?: AliceEntity[];
  state?: SessionState;
  isNew?: boolean;
}

export interface AliceResponse {
  version: "1.0";
  response: { text: string; tts: string; end_session: boolean; buttons?: { title: string; hide: boolean }[] };
  session_state: SessionState;
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);

const fallback = (msg: string): AliceResponse => ({
  version: "1.0",
  response: { text: `Не получилось: ${msg}`, tts: "Не получилось. Подробности на экране.", end_session: false },
  session_state: {},
});

export async function respond(u: Utterance): Promise<AliceResponse> {
  const p = prefs();
  const state = u.state ?? {};
  const text = normalize(u.command || u.original || "");
  const now = new Date();
  let r: Reply | null = null;

  // Ждём ответ нейронки: «ну что?»
  if (state.pending?.kind === "ai") {
    const job = jobs.get(state.pending.key);
    if (/^(ну|ну что|и что|что там|готово|ответ|ну и|и|так что|скажи|давай)( .*)?$/.test(text) || !text) {
      if (!job) r = { say: { text: "Ответ потерялся — спросите ещё раз.", tts: "Ответ потерялся — спросите ещё раз." }, state: {} };
      else if (!job.done && (await withTimeout(job.promise, ANSWER_BUDGET_MS)) === "timeout") {
        r = { say: { text: "Ещё думаю. Спросите «ну что» через пару секунд.", tts: "Ещё думаю. sil <[200]> Спросите «ну что» через пару секунд." }, buttons: ["Ну что?"], state };
      } else r = aiAnswer(job);
    } else state.pending = undefined;
  }

  if (!r) {
    const ctx: Ctx = { text, raw: u.original || u.command, entities: u.entities ?? [], state, address: p.address, prefs: p, now };
    try {
      const res = await withTimeout(
        (async () => (state.pending ? null : await custom(ctx)) ?? (await handle(ctx)))(),
        ANSWER_BUDGET_MS,
      );
      if (res === "timeout") r = { say: { text: "Google Календарь отвечает слишком долго. Повторите через пару секунд.", tts: "Календарь отвечает слишком долго. Повторите через пару секунд." } };
      else r = res;
    } catch (e) {
      const msg = (e as Error).message;
      r = { say: { text: `Не получилось: ${msg}`, tts: "Не получилось. Подробности на экране." } };
    }
  }

  if (!r) {
    const question = text.split(" ").length >= 3 && !/^(ну|и|а|так|что) /.test(text);
    if (question && aiAllowed()) {
      const key = startAi(u.original || u.command);
      const job = jobs.get(key)!;
      if ((await withTimeout(job.promise, AI_WAIT_MS)) !== "timeout") r = aiAnswer(job);
      else {
        r = {
          say: { text: "Думаю над этим. Скажите «ну что», когда будете готовы слушать.", tts: "Думаю над этим. sil <[200]> Скажите «ну что», когда будете готовы слушать." },
          buttons: ["Ну что?"],
          state: { pending: { kind: "ai", key } },
        };
      }
    } else {
      const why = p.ai && question ? " Лимит вопросов к нейронке на сегодня исчерпан." : "";
      r = { say: { text: `Этого я пока не умею.${why} Скажите «что ты умеешь».`, tts: `Этого я пока не умею.${why} Скажите: что ты умеешь.` }, buttons: ["Что ты умеешь?"] };
    }
  }

  const nextState: SessionState = r.state ?? (state.undo ? { undo: state.undo } : {});
  // Запуск с командой («попроси Джарвиса …») — ответили и вернули колонку Алисе, если ничего не ждём.
  const end = r.end ?? (!!u.isNew && !!text && !nextState.pending);
  return {
    version: "1.0",
    response: {
      text: r.say.text.slice(0, 1024),
      tts: voice(r.say.tts).slice(0, 1024),
      end_session: end,
      ...(r.buttons?.length && !end ? { buttons: r.buttons.map((title) => ({ title, hide: true })) } : {}),
    },
    session_state: nextState,
  };
}

/** Последняя чистка для голоса: без эмодзи и кавычек, время — «9 30», «19 часов». */
function voice(tts: string): string {
  return tts
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "")
    .replace(/[«»"*_#`]/g, "")
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h: string, m: string) => {
      const hour = Number(h);
      return m === "00" ? `${hour} ${plural(hour, "час", "часа", "часов")}` : `${hour} ${m}`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/* ───────────── голос и текст на компьютере ───────────── */

export interface Turn {
  /** Для экрана. */
  text: string;
  /** Для голоса: время словами, паузы sil <[мс]>. */
  tts: string;
  buttons: string[];
  /** Джарвис ждёт ответа — слушать без слова активации. */
  expectReply: boolean;
  /** Не проговаривать, хватит сигнала. */
  quiet: boolean;
  /** Ответ составила нейронка. */
  ai: boolean;
  ms: number;
}

interface Channel {
  state: SessionState;
  history: Exchange[];
  last?: Say;
  at: number;
}

const channels = new Map<string, Channel>();
/** Разговор забывается через 10 минут тишины. */
const CHANNEL_TTL = 10 * 60_000;

const say = (s: string): Say => ({ text: s, tts: s });

/** «Джарвис, открой телеграм» → «открой телеграм». */
function stripWake(text: string): string {
  const words = new Set(["джарвис", "jarvis", ...prefs().voice.wakeWords.map((w) => normalize(w))]);
  const list = text.split(" ");
  while (list.length && (words.has(list[0]) || /^(эй|окей|ок|слушай|хей)$/.test(list[0]) && words.has(list[1] ?? ""))) list.shift();
  return list.join(" ");
}

/** Важное: меняет данные или компьютер. При «только мой голос: важное» — только владельцу. */
const OWNER_ONLY =
  /(выключи (компьютер|комп|пк|ноут)|перезагру|спящ|режим сна|усыпи|убей|заверши|принудительно|заблокируй|напечатай|набери|введи|впиши|потратил|заплатил|купил|получил|заработал|запомни|запиши|удали|отмени|перенеси|запланируй|напомни|отметь|отправь|напиши|добавь|создай|вставь|исправь)/;
const OWNER_SAFE = /(громкост|таймер|яркост|звук|музык|трек|паузу)/;

function guestRefusal(ctx: Ctx): Reply | null {
  if (ctx.owner !== false || ctx.prefs.voice.speakerLock !== "important") return null;
  if (!OWNER_ONLY.test(ctx.text) || OWNER_SAFE.test(ctx.text)) return null;
  return { say: say("Это я сделаю только по голосу хозяина.") };
}

/** Текст после этих слов — свободный (заметка, поиск, ввод), «и» в нём не делит просьбу. */
const FREE_TEXT = /^(напечатай|набери|введи|впиши|найди|поищи|загугли|погугли|запомни|запиши|заметка|идея|напомни|таймер|засеки|поставь таймер)(\s|$)/;

/** «Сделай тише и открой ютуб» — несколько просьб сразу: правила такое не разберут, нужна нейронка. */
function compound(ctx: Ctx): boolean {
  if (!ctx.prefs.ai || ctx.state.pending || ctx.state.pc || FREE_TEXT.test(ctx.text)) return false;
  return ctx.text.split(" ").length >= 4 && /\s(и|а потом|потом|затем|а также|и еще|плюс)\s/.test(ctx.text);
}

/**
 * Одна фраза через правила: свои команды, компьютер, затем хаб. Нейронки здесь нет.
 * top — фраза пользователя (а не команда из плана нейронки): составные отдаём нейронке.
 */
async function rules(ctx: Ctx, allowCustom: boolean, top = false): Promise<Reply | null> {
  const guest = guestRefusal(ctx);
  if (guest) return guest;
  const free = allowCustom && !ctx.state.pending && !ctx.state.pc;
  if (free) {
    const c = await customFull(ctx, false);
    if (c) return c;
  }
  if (top && compound(ctx)) return tabCommand(ctx.text);
  const r = await handlePc({ text: ctx.text, raw: ctx.raw, address: ctx.address, state: ctx.state, hubUrl });
  if (r) return r;
  // Выученное — после правил компьютера: открытая вкладка или программа точнее, чем то, что нейронка сделала когда-то.
  if (free) {
    const c = await customFull(ctx, true);
    if (c) return c;
  }
  // «Что у меня на экране?» — к нейронке со снимком, а не к календарю («что сейчас»).
  if (top && ctx.prefs.ai && !ctx.state.pending && SCREEN_RE.test(ctx.text) && !FREE_TEXT.test(ctx.text)) return null;
  // Названо пространство браузера («что у меня в кинотеатре») — к нейронке со списком вкладок, а не к календарю.
  if (top && ctx.prefs.ai && !ctx.state.pending && browserConnected() && splitWorkspace(ctx.text).workspace) return null;
  return await handle(ctx);
}

/** Своя команда: что сказать и какие команды выполнить следом — в том числе для компьютера. */
async function customFull(ctx: Ctx, learned = false): Promise<Reply | null> {
  const cmd = prefs().commands.find((c) => !c.off && !!c.learned === learned && c.phrases.some((p) => {
    const n = wordsToDigits(normalize(p));
    return n && (ctx.text === n || ctx.text.startsWith(n + " ") || ctx.text.endsWith(" " + n));
  }));
  if (!cmd) return null;
  if (cmd.steps) return runSteps(cmd.steps, ctx);
  const parts: Part[] = cmd.say.trim() ? [cmd.say.trim()] : [];
  let state: SessionState | undefined;
  for (const run of cmd.run.filter((r) => r.trim()).slice(0, 8)) {
    const r = await rules({ ...ctx, text: wordsToDigits(normalize(run)), raw: run, state: {} }, false).catch((e) => ({ say: say(`Не получилось: ${(e as Error).message}`) }) as Reply);
    if (r && !r.quiet && !cmd.say.trim()) parts.push(r.say);
    if (r?.state?.pending || r?.state?.pc) {
      state = r.state;
      parts.push(r.say);
    }
  }
  const s = join(parts, 400);
  return { say: s.text ? s : say("Готово."), state, quiet: !s.text };
}

/** Шаги сценария из конструктора — по порядку. Что сказать — склеиваем в один ответ. */
async function runSteps(steps: Step[], ctx: Ctx): Promise<Reply> {
  const parts: Part[] = [];
  let state: SessionState | undefined;
  const spoken = steps.some((s) => s.type === "say" && s.text.trim());
  for (const step of steps.slice(0, 30)) {
    try {
      switch (step.type) {
        case "say":
          if (step.text.trim()) parts.push(step.text.trim());
          break;
        case "command": {
          const r = await rules({ ...ctx, text: wordsToDigits(normalize(step.text)), raw: step.text, state: {} }, false);
          if (!r) {
            parts.push(`Команду «${step.text}» я не понял.`);
            break;
          }
          if (r.state?.pending || r.state?.pc) {
            state = r.state;
            parts.push(r.say);
          } else if ((step.speak || !spoken) && !r.quiet) parts.push(r.say);
          break;
        }
        case "open":
          if (step.target?.value) await launch(step.target);
          break;
        case "search":
          await searchStep(step.where, step.query);
          break;
        case "keys":
          await pc("keys", { combo: step.combo });
          break;
        case "type":
          await pc("type", { text: step.text, enter: !!step.enter });
          break;
        case "volume":
          await pc("volume.set", { level: step.level });
          break;
        case "media":
          await pc("media", { key: step.key });
          break;
        case "close":
          await closeApp(step.name);
          break;
        case "wait":
          await new Promise((r) => setTimeout(r, Math.max(0, Math.min(60, step.seconds)) * 1000));
          break;
      }
    } catch (e) {
      parts.push(`Шаг не выполнился: ${(e as Error).message}`);
    }
  }
  const s = join(parts, 400);
  return { say: s.text ? s : say("Готово."), state, quiet: !s.text };
}

/** Запуск сценария кнопкой из модуля. */
async function runScenario(cmd: CustomCommand, channel: "voice" | "text") {
  const p = prefs();
  const ctx: Ctx = { text: "", raw: "", entities: [], state: {}, address: p.address, prefs: p, now: new Date() };
  const r = cmd.steps ? await runSteps(cmd.steps, ctx) : await customFull({ ...ctx, text: wordsToDigits(normalize(cmd.phrases[0] ?? "")) });
  if (r && channel === "text") logTurn({ q: `▶ ${cmd.phrases[0] ?? "сценарий"}`, a: r.say.text, source: "voice" });
}

function aiUse() {
  const s = secrets();
  const today = dayKey();
  saveSecrets({ aiUsed: { date: today, n: (s.aiUsed?.date === today ? s.aiUsed.n : 0) + 1 } });
  void writeStatus().catch(() => {});
}

/** Свободная просьба: Claude составляет план, команды плана идут через обычные правила. */
async function think(ctx: Ctx, ch: Channel): Promise<Reply> {
  aiUse();
  const screen = SCREEN_RE.test(ctx.text) ? await screenshot() : null;
  const plan = await makePlan(ctx.raw, {
    prefs: ctx.prefs,
    dayContext: await aiContext(ctx.now),
    history: ch.history,
    // Выученное нейронке не показываем: она начинает собирать новые просьбы из старых.
    custom: ctx.prefs.commands.filter((c) => !c.off && !c.learned).flatMap((c) => c.phrases.slice(0, 1)),
    screen,
  });
  const parts: Part[] = plan.say.trim() ? [plan.say.trim()] : [];
  let state: SessionState | undefined;
  let failed = false;
  for (const a of plan.actions) {
    try {
      if (a.do === "type" && ctx.owner === false && ctx.prefs.voice.speakerLock === "important") {
        parts.push("Печатать я буду только по голосу хозяина.");
        failed = true;
        continue;
      }
      if (a.do === "command") {
        const text = wordsToDigits(normalize(String(a.text ?? "")));
        // Нейронка вернула ту же фразу командой — правила её уже не поняли, это замкнутый круг.
        if (!text || text === ctx.text) {
          failed = true;
          continue;
        }
        const r = await rules({ ...ctx, text, raw: String(a.text), state: {} }, true);
        if (!r) {
          failed = true;
          continue;
        }
        const asks = !!(r.state?.pending || r.state?.pc);
        if (asks) state = r.state;
        // Ответ команды озвучиваем, если он нужен (данные) или если Claude ничего не сказал сам.
        if (asks || a.speak || (!plan.say.trim() && !r.quiet)) parts.push(r.say);
      } else await runDirect(a, hubUrl);
    } catch (e) {
      failed = true;
      parts.push(`Не получилось: ${(e as Error).message}`);
    }
  }
  if (!failed && !state && !screen) learn(ctx, plan);
  const s = join(parts, 300);
  return { say: s.text ? s : say("Готово."), state };
}

/** Местоимения — просьба зависит от разговора («открой его»), запоминать нельзя. */
const CONTEXTUAL = /(^|\s)(это|этот|эту|его|ее|их|там|тут|туда|сюда|тоже|еще раз|снова|он|она|они|так)(\s|$)/;

/**
 * Самообучение: нейронка разобрала просьбу в действия — запоминаем как сценарий «Выучено».
 * В следующий раз та же фраза выполнится правилами, мгновенно и без нейронки.
 */
function learn(ctx: Ctx, plan: Awaited<ReturnType<typeof makePlan>>) {
  const p = prefs();
  if (p.learn === false || ctx.owner === false || !plan.actions.length) return;
  const phrase = ctx.text.trim();
  const words = phrase.split(" ").length;
  if (!phrase || words > 8 || CONTEXTUAL.test(phrase)) return;
  if (p.commands.some((c) => c.phrases.includes(phrase))) return;
  // В ответе числа (время, суммы, громкость) — он про этот момент: повторять его потом нельзя.
  if (/\d/.test(plan.say)) return;
  const steps: Step[] = [];
  if (plan.say.trim()) steps.push({ type: "say", text: plan.say.trim() });
  for (const a of plan.actions) {
    if (a.do === "command") steps.push({ type: "command", text: String(a.text), ...(a.speak ? { speak: true } : {}) });
    else if (a.do === "search") steps.push({ type: "search", where: a.where === "youtube" || a.where === "yandex" ? a.where : "google", query: String(a.query) });
    else if (a.do === "open") {
      const t = String(a.target ?? "");
      if (/^https?:\/\//i.test(t)) steps.push({ type: "open", target: { kind: "url", value: t } });
      else if (/^[a-z]:\\/i.test(t)) steps.push({ type: "open", target: { kind: "path", value: t } });
      else steps.push({ type: "command", text: `открой ${t}` });
    } else return; // ввод текста зависит от момента — не запоминаем
  }
  const raw = (db.getKv(MODULE, "config") as Record<string, any> | undefined) ?? {};
  const list: CustomCommand[] = Array.isArray(raw.commands) ? raw.commands : [];
  const cmd: CustomCommand = { id: crypto.randomBytes(6).toString("hex"), phrases: [phrase], say: "", run: [], steps, learned: true };
  db.setKv(MODULE, "config", { ...raw, commands: [...list, cmd] });
  changed("kv:config");
}

/** Ответ на фразу с компьютера: голос ("voice") или текст в модуле ("text"). */
export async function converse(channel: "voice" | "text", phrase: string, opts: { owner?: boolean } = {}): Promise<Turn> {
  const t0 = Date.now();
  const p = prefs();
  let ch = channels.get(channel);
  if (!ch || Date.now() - ch.at > CHANNEL_TTL) ch = { state: {}, history: [], at: Date.now() };
  channels.set(channel, ch);
  ch.at = Date.now();

  const raw = phrase.trim();
  const text = stripWake(wordsToDigits(normalize(raw)));
  const ctx: Ctx = { text, raw, entities: [], state: ch.state, address: p.address, prefs: p, now: new Date(), owner: opts.owner };
  let r: Reply | null = null;
  let ai = false;

  try {
    if (/^(повтори|повтори пожалуйста|что ты сказал|еще раз|не расслышал)$/.test(text) && ch.last) r = { say: ch.last, state: ch.state };
    else r = await rules(ctx, true, true);
    if (!r && text) {
      const question = text.split(" ").length >= 2;
      // Дневной лимит — только для колонки Алисы: на компьютере нейронка идёт по подписке Claude.
      if (p.ai && question) {
        ai = true;
        r = await think(ctx, ch);
      } else {
        const why = p.ai && question ? " Лимит вопросов к нейронке на сегодня исчерпан." : "";
        r = { say: say(`Этого я пока не умею.${why} Скажите «что ты умеешь».`) };
      }
    }
    if (!r) r = handleEmpty(p.address);
  } catch (e) {
    const msg = e instanceof PcError ? e.message : (e as Error).message;
    r = { say: { text: `Не получилось: ${msg}`, tts: `Не получилось. ${msg.length < 90 ? msg : "Подробности на экране."}` } };
  }

  const nextState: SessionState = r.state ?? (ch.state.undo ? { undo: ch.state.undo } : {});
  ch.state = nextState;
  ch.last = r.say;
  ch.history.push({ q: raw, a: r.say.text });
  if (ch.history.length > 12) ch.history.shift();

  const turn: Turn = {
    text: r.say.text,
    tts: voice(r.say.tts),
    buttons: r.buttons ?? [],
    // Ответ без имени слушаем, только когда правило ждёт «да» или уточнение. Вопросы нейронки
    // («Чем ещё помочь?») — нет: иначе Джарвис подхватывает разговоры вокруг.
    expectReply: !!(nextState.pending || nextState.pc) || (!ai && /\?\s*$/.test(r.say.text)),
    quiet: !!r.quiet,
    ai,
    ms: Date.now() - t0,
  };
  if (channel === "voice") {
    logTurn({ q: raw, a: turn.text, source: "voice", ms: turn.ms, ai });
  }
  return turn;
}

function handleEmpty(address: string): Reply {
  return { say: say(`Слушаю${address ? ", " + address : ""}.`) };
}

/* ───────────── вебхук ───────────── */

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Запрос от Алисы. null — адрес неверный (ответить 404). */
export async function handleAlice(secret: string, body: any): Promise<AliceResponse | null> {
  const s = secrets();
  if (!prefs().enabled || !s.secret || !sameSecret(secret, s.secret)) return null;
  lastRequestAt = Date.now();
  const skillId = String(body?.session?.skill_id ?? "");
  if (skillId) {
    if (!s.skillId) saveSecrets({ skillId, lastAt: lastRequestAt });
    else if (s.skillId !== skillId) {
      return { version: "1.0", response: { text: "Хаб привязан к другому навыку.", tts: "Хаб привязан к другому навыку.", end_session: true }, session_state: {} };
    }
  }
  void writeStatus().catch(() => {});
  const req = body?.request ?? {};
  const command = String(req.command ?? "");
  if (command === "ping" || req.original_utterance === "ping") {
    return { version: "1.0", response: { text: "pong", tts: "pong", end_session: true }, session_state: {} };
  }
  const original = String(req.original_utterance ?? command);
  const r = await respond({
    command,
    original,
    entities: Array.isArray(req.nlu?.entities) ? req.nlu.entities : [],
    state: body?.state?.session && typeof body.state.session === "object" ? body.state.session : {},
    isNew: !!body?.session?.new,
  });
  logAlice(original, r);
  return r;
}
