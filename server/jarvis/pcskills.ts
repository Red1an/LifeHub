import os from "node:os";
import path from "node:path";
import { apps, pc, pcSupported, screenshotsDir, windows, type App, type Win } from "./pc.ts";
import { hhmm, plural } from "./nlu.ts";
import { count, done, fullDate, listing, sir, type Say } from "./speech.ts";
import { dayKey } from "./nlu.ts";
import { speak, voiceControl } from "./voice.ts";
import type { Reply, SessionState } from "./skills.ts";

/*
 * Команды для компьютера: громкость, музыка, программы, сайты, окна, питание, таймеры.
 * Разбираются правилами — так быстрее и предсказуемее, чем через нейронку. Опасное
 * (выключить, перезагрузить, усыпить, убить процесс) — только после «да».
 */

export interface PcCtx {
  /** Нормализованная фраза, числа цифрами. */
  text: string;
  /** Как распознано, с регистром и знаками — для «напечатай». */
  raw: string;
  address: string;
  state: SessionState;
  hubUrl: string;
}

export type PcPending = { action: "shutdown" | "restart" | "sleep" | "kill"; name?: string; label: string };

const reply = (say: Say | string, extra: Omit<Reply, "say"> = {}): Reply => ({ say: typeof say === "string" ? { text: say, tts: say } : say, ...extra });

const YES = /^(да|ага|угу|конечно|подтверждаю|давай|точно|выполняй|делай|ок|окей|хорошо)(\s|$)/;
const NO = /^(нет|не надо|не нужно|отмена|отмени|стоп|не)(\s|$)/;

const HOME = os.homedir();

/* ───────────── сайты, папки, программы ───────────── */

const SITES: [RegExp, string, string][] = [
  [/^(ютуб|youtube|ютюб)$/, "https://www.youtube.com", "YouTube"],
  [/^(гугл|google)$/, "https://www.google.com", "Google"],
  [/^(яндекс|yandex)$/, "https://ya.ru", "Яндекс"],
  [/^(вк|вконтакте|контакт)$/, "https://vk.com", "ВКонтакте"],
  [/^(гитхаб|github|гит хаб)$/, "https://github.com", "GitHub"],
  [/^(почту|почта|почты|gmail|джимейл|гмейл)$/, "https://mail.google.com", "почту"],
  [/^(переводчик)$/, "https://translate.yandex.ru", "переводчик"],
  [/^(карты|карту)$/, "https://yandex.ru/maps", "карты"],
  [/^(чат гпт|чатгпт|chatgpt|гпт)$/, "https://chatgpt.com", "ChatGPT"],
  [/^(клод|claude|клауд)$/, "https://claude.ai", "Claude"],
  [/^(кинопоиск)$/, "https://www.kinopoisk.ru", "Кинопоиск"],
  [/^(твич|twitch)$/, "https://www.twitch.tv", "Twitch"],
  [/^(хабр)$/, "https://habr.com", "Хабр"],
  [/^(озон|ozon)$/, "https://www.ozon.ru", "Ozon"],
  [/^(вб|вайлдберриз|валдберис|wildberries)$/, "https://www.wildberries.ru", "Wildberries"],
  [/^(авито)$/, "https://www.avito.ru", "Авито"],
  [/^(погоду|погода)$/, "https://yandex.ru/pogoda", "погоду"],
  [/^(новости)$/, "https://dzen.ru/news", "новости"],
];

const FOLDERS: [RegExp, string, string][] = [
  [/^(загрузки|папку загрузки|загрузок)$/, path.join(HOME, "Downloads"), "Загрузки"],
  [/^(документы|папку документы)$/, path.join(HOME, "Documents"), "Документы"],
  [/^(рабочий стол|папку рабочий стол)$/, path.join(HOME, "Desktop"), "Рабочий стол"],
  [/^(картинки|изображения|фотки|фото|папку картинки)$/, path.join(HOME, "Pictures"), "Картинки"],
  [/^(музыку|папку музыка)$/, path.join(HOME, "Music"), "Музыку"],
  [/^(видео|папку видео)$/, path.join(HOME, "Videos"), "Видео"],
  [/^(скриншоты|папку скриншотов|скрины)$/, screenshotsDir(), "скриншоты"],
  [/^(папку пользователя|домашнюю папку)$/, HOME, "домашнюю папку"],
];

/** Программы, которые по названию не найти: системные или с непохожим именем. */
const PROGRAMS: [RegExp, { target?: string; search?: string }, string][] = [
  [/^(проводник|мой компьютер|этот компьютер)$/, { target: "explorer.exe" }, "Проводник"],
  [/^(блокнот)$/, { target: "notepad.exe" }, "Блокнот"],
  [/^(калькулятор)$/, { target: "calc.exe" }, "Калькулятор"],
  [/^(диспетчер задач|диспетчер)$/, { target: "taskmgr.exe" }, "Диспетчер задач"],
  [/^(настройки|параметры|параметры windows|настройки windows)$/, { target: "ms-settings:" }, "Параметры"],
  [/^(настройки звука|звук)$/, { target: "ms-settings:sound" }, "настройки звука"],
  [/^(блютуз|bluetooth)$/, { target: "ms-settings:bluetooth" }, "Bluetooth"],
  [/^(панель управления)$/, { target: "control.exe" }, "Панель управления"],
  [/^(терминал|командную строку|консоль|powershell|павершелл)$/, { target: "wt.exe" }, "Терминал"],
  [/^(пейнт|paint)$/, { target: "mspaint.exe" }, "Paint"],
  [/^(браузер)$/, { target: "https://www.google.com" }, "браузер"],
  [/^(вс код|вскод|vs code|vscode|код|визуал студио код|visual studio code)$/, { search: "Visual Studio Code" }, "VS Code"],
  [/^(ворд|word)$/, { search: "Word" }, "Word"],
  [/^(эксель|excel)$/, { search: "Excel" }, "Excel"],
  [/^(фотошоп|photoshop)$/, { search: "Photoshop" }, "Photoshop"],
  [/^(телегу|телега|телеграмм|телеграм|телеграмма)$/, { search: "Telegram" }, "Telegram"],
  [/^(дискорд|дис)$/, { search: "Discord" }, "Discord"],
  [/^(стим|steam)$/, { search: "Steam" }, "Steam"],
  [/^(спотифай|spotify)$/, { search: "Spotify" }, "Spotify"],
];

const LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** «Телеграм» и «Telegram» → одно и то же: латиница, похожие звуки склеены, без гласных. */
function skeleton(s: string): string {
  const latin = s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[а-я]/g, (c) => LAT[c] ?? "")
    .replace(/[^a-z0-9]/g, "");
  const sounds = latin
    .replace(/dzh|zh|dj/g, "j")
    .replace(/kh|ch(?=r)/g, "h")
    .replace(/ph/g, "f")
    .replace(/ck|c(?=[aoukr])|q/g, "k")
    .replace(/c/g, "s")
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/(.)\1+/g, "$1");
  return sounds[0] + sounds.slice(1).replace(/[aeiouy]/g, "");
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Похожесть сказанного на название программы или окна: 0…1. */
export function nameScore(query: string, name: string): number {
  const q = skeleton(query);
  if (q.length < 2) return 0;
  const words = name.split(/[\s\-_.:|()]+/).filter(Boolean);
  const full = skeleton(name);
  if (!full) return 0;
  if (full === q) return 1;
  // «телеграм» ↔ «Telegram Desktop», «вижуал студио» ↔ «Visual Studio Code».
  for (let n = 1; n <= Math.min(3, words.length); n++) if (skeleton(words.slice(0, n).join("")) === q) return 0.95 - n * 0.02;
  if (q.length >= 3 && full.startsWith(q)) return 0.8;
  for (const w of words) if (skeleton(w) === q && q.length >= 3) return 0.75;
  const d = levenshtein(q, full.slice(0, q.length + 1));
  const ratio = 1 - d / Math.max(q.length, 3);
  return ratio >= 0.7 && q.length >= 4 ? 0.6 * ratio : 0;
}

const JUNK_APPS = /(uninstall|удал|readme|help|справк|documentation|manual|license|лиценз|release notes|website|веб-сайт|support|changelog)/i;

async function findApp(query: string): Promise<App | null> {
  let best: App | null = null;
  let bestScore = 0;
  for (const a of await apps()) {
    if (JUNK_APPS.test(a.name)) continue;
    const s = nameScore(query, a.name) - a.name.length / 1000;
    if (s > bestScore) {
      best = a;
      bestScore = s;
    }
  }
  return bestScore >= 0.55 ? best : null;
}

async function findWindow(query: string): Promise<Win | null> {
  let best: Win | null = null;
  let bestScore = 0;
  for (const w of (await windows()).items) {
    const s = Math.max(nameScore(query, w.name), nameScore(query, w.desc || ""), nameScore(query, w.title) * 0.9);
    if (s > bestScore) {
      best = w;
      bestScore = s;
    }
  }
  return bestScore >= 0.55 ? best : null;
}

const FILLER = new Set(["мне", "пожалуйста", "плиз", "приложение", "программу", "программа", "игру", "сайт", "окно", "мой", "мою", "ну", "быстро", "срочно"]);
const clean = (s: string) => s.split(" ").filter((w) => w && !FILLER.has(w)).join(" ").trim();

/** Открыть что угодно по названию: папку, сайт, системную программу, программу из «Пуска». */
export async function openThing(what: string, hubUrl: string): Promise<{ ok: boolean; label: string }> {
  const q = clean(what);
  if (!q) return { ok: false, label: what };
  if (/^(хаб|лайфхаб|lifehub|лайф хаб)$/.test(q)) {
    await pc("open", { target: hubUrl });
    return { ok: true, label: "хаб" };
  }
  for (const [re, dir, label] of FOLDERS) if (re.test(q)) {
    await pc("open", { target: dir });
    return { ok: true, label };
  }
  for (const [re, url, label] of SITES) if (re.test(q)) {
    await pc("open", { target: url });
    return { ok: true, label };
  }
  // Сказали адрес сайта: «открой habr.com».
  const domain = what.match(/([a-z0-9-]+\.)+[a-z]{2,}/i)?.[0];
  if (domain) {
    await pc("open", { target: `https://${domain}` });
    return { ok: true, label: domain };
  }
  let search = q;
  for (const [re, p, label] of PROGRAMS) if (re.test(q)) {
    if (p.target) {
      await pc("open", { target: p.target });
      return { ok: true, label };
    }
    search = p.search!;
  }
  const app = await findApp(search);
  if (app) {
    await pc("apps.launch", { id: app.id, path: !!app.path });
    return { ok: true, label: app.name };
  }
  return { ok: false, label: what };
}

export function searchUrl(where: "google" | "youtube" | "yandex", query: string): string {
  const q = encodeURIComponent(query);
  if (where === "youtube") return `https://www.youtube.com/results?search_query=${q}`;
  if (where === "yandex") return `https://ya.ru/search/?text=${q}`;
  return `https://www.google.com/search?q=${q}`;
}

/* ───────────── таймеры ───────────── */

interface Timer {
  id: number;
  label: string;
  endsAt: number;
  handle: NodeJS.Timeout;
}

const timers = new Map<number, Timer>();
let timerSeq = 0;

export function addTimer(minutes: number, label: string, address: string): Timer {
  const id = ++timerSeq;
  const ms = Math.max(5_000, Math.round(minutes * 60_000));
  const handle = setTimeout(() => {
    timers.delete(id);
    const what = label ? `: ${label}` : "";
    void speak(`${address ? address.charAt(0).toUpperCase() + address.slice(1) + ", т" : "Т"}аймер${what} — время вышло.`, { title: "Таймер", chime: true });
  }, ms);
  handle.unref?.();
  const t: Timer = { id, label, endsAt: Date.now() + ms, handle };
  timers.set(id, t);
  return t;
}

function durationText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const parts: string[] = [];
  if (h) parts.push(count(h, "час", "часа", "часов"));
  if (m) parts.push(count(m, "минута", "минуты", "минут"));
  if (rest && !h) parts.push(count(rest, "секунда", "секунды", "секунд"));
  return parts.join(" ") || "меньше секунды";
}

/** «5 минут», «полчаса», «полтора часа», «2 часа 15 минут», «30 секунд» → минуты. */
function parseDuration(t: string): number | null {
  if (/(^|\s)полчаса(\s|$)/.test(t)) return 30;
  if (/(^|\s)полтора часа(\s|$)/.test(t)) return 90;
  let total = 0;
  let found = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(час\S*|ч|минут\S*|мин|секунд\S*|сек)(?=\s|$)/g)) {
    const n = Number(m[1]);
    found = true;
    total += /^ч/.test(m[2]) ? n * 60 : /^м/.test(m[2]) ? n : n / 60;
  }
  if (!found && /(^|\s)(час|на час)(\s|$)/.test(t)) return 60;
  if (!found && /(^|\s)минуту(\s|$)/.test(t)) return 1;
  return found ? total : null;
}

/* ───────────── маршрутизатор ───────────── */

export async function handlePc(ctx: PcCtx): Promise<Reply | null> {
  const t = ctx.text;
  const ok = () => done(ctx.address);

  const pend = ctx.state.pc;
  if (pend) {
    if (YES.test(t)) return runPending(ctx, pend);
    if (NO.test(t)) return reply("Отменил.", { state: {} });
  }

  /* ── время, дата, сам Джарвис ── */
  if (/^(который час|сколько времени|сколько сейчас времени|время)$/.test(t)) return reply(`Сейчас ${hhmm(new Date())}.`);
  if (/^(какое (сегодня )?число|какой (сегодня )?день|какая (сегодня )?дата|какой день недели)$/.test(t)) return reply(`Сегодня ${fullDate(dayKey()).toLowerCase()}.`);

  if (/^(игровой режим|включи игровой режим|режим игры)$/.test(t)) {
    voiceControl({ game: true });
    return reply("Игровой режим: видеокарта свободна, слушаю на процессоре.");
  }
  if (/^(обычный режим|выключи игровой режим|отключи игровой режим)$/.test(t)) {
    voiceControl({ game: false });
    return reply("Обычный режим, распознаю на видеокарте.");
  }
  if (/^(не слушай|отдохни|спи|режим ожидания|помолчи|замолчи)$/.test(t)) {
    voiceControl({ sleep: true });
    return reply("Ухожу в режим ожидания. Скажите «Джарвис, проснись», когда понадоблюсь.");
  }
  if (/^(открой|покажи|открыть) (панель|свою панель|джарвиса|себя|интерфейс|настройки джарвиса)$|^панель$/.test(t)) {
    voiceControl({ panel: true });
    return reply("Открываю панель.", { quiet: true });
  }
  if (/^(выключи микрофон|отключи микрофон)$/.test(t)) {
    voiceControl({ mute: true });
    return reply("Микрофон выключен. Включить — в хабе или командой «включи микрофон».");
  }
  if (/^(включи микрофон|проснись|слушай)$/.test(t)) {
    voiceControl({ mute: false, sleep: false });
    return reply(`Слушаю${sir(ctx.address)}.`);
  }

  if (!pcSupported) return null;

  /* ── громкость ── */
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(сделай |поставь |установи )?(громкость|звук)( на)? (\d{1,3})( процент\S*)?$/)) || (m = t.match(/^(сделай )?(громкость|звук) (\d{1,3})/))) {
    const level = Number(m[4] ?? m[3]);
    const v = await pc<{ level: number }>("volume.set", { level });
    return reply(`Громкость ${v.level}.`);
  }
  if (/(громкость|звук) на (максимум|максимальн\S*|полную|всю)|на полную громкость|максимальная громкость/.test(t)) {
    await pc("volume.set", { level: 100 });
    return reply("Громкость на максимум.");
  }
  if (/^(сделай )?(намного |гораздо |еще )?(громче|погромче|прибавь( звук)?|увеличь громкость)$/.test(t)) {
    const cur = await pc<{ level: number }>("volume.get");
    const step = /намного|гораздо/.test(t) ? 25 : 10;
    const v = await pc<{ level: number }>("volume.set", { level: cur.level + step });
    return reply(`Громкость ${v.level}.`);
  }
  if (/^(сделай )?(намного |гораздо |еще )?(тише|потише|убавь( звук)?|уменьши громкость)$/.test(t)) {
    const cur = await pc<{ level: number }>("volume.get");
    const step = /намного|гораздо/.test(t) ? 25 : 10;
    const v = await pc<{ level: number }>("volume.set", { level: cur.level - step });
    return reply(`Громкость ${v.level}.`);
  }
  if (/^(выключи звук|без звука|отключи звук|замьють|мьют|убери звук)$/.test(t)) {
    await pc("volume.mute", { on: true });
    return reply("Звук выключен.");
  }
  if (/^(включи звук|верни звук|размьють|анмьют)$/.test(t)) {
    await pc("volume.mute", { on: false });
    return reply("Звук включён.");
  }
  if (/^(какая (сейчас )?громкость|сколько громкость)$/.test(t)) {
    const v = await pc<{ level: number; muted: boolean }>("volume.get");
    return reply(v.muted ? `Звук выключен, громкость ${v.level}.` : `Громкость ${v.level}.`);
  }

  /* ── музыка и видео ── */
  if (/^(пауза|поставь на паузу|на паузу|останови (музыку|видео|воспроизведение)|стоп музыка|выключи музыку|паузу)$/.test(t)) {
    await pc("media", { key: "play" });
    return reply("Пауза.", { quiet: true });
  }
  if (/^(продолжи|продолжай|играй|воспроизведи|сними с паузы|включи музыку|продолжи (музыку|видео)|плей)$/.test(t)) {
    await pc("media", { key: "play" });
    return reply("Продолжаю.", { quiet: true });
  }
  if (/^(следующ\S* (трек|песн\S*|видео)?|следующая|дальше трек|переключи (трек|песню)|некст|скипни|пропусти (трек|песню))$/.test(t)) {
    await pc("media", { key: "next" });
    return reply("Следующий.", { quiet: true });
  }
  if (/^(предыдущ\S*( трек| песн\S*)?|прошл\S* (трек|песн\S*)|верни (трек|песню)|назад трек)$/.test(t)) {
    await pc("media", { key: "prev" });
    return reply("Предыдущий.", { quiet: true });
  }

  /* ── поиск ── */
  if ((m = t.match(/^(найди|поищи|включи|покажи|открой)( мне)? (на|в) (ютубе|youtube|ютюбе) (.+)$/))) {
    await pc("open", { target: searchUrl("youtube", m[5]) });
    return reply(`Ищу на YouTube: ${m[5]}.`);
  }
  if ((m = t.match(/^(найди|поищи)( мне)? (в|на) (яндексе) (.+)$/))) {
    await pc("open", { target: searchUrl("yandex", m[5]) });
    return reply(`Ищу в Яндексе: ${m[5]}.`);
  }
  if ((m = t.match(/^(загугли|погугли|гугли|найди в (гугле|google|интернете)|поищи в (гугле|интернете)) (.+)$/))) {
    await pc("open", { target: searchUrl("google", m[4]) });
    return reply(`Ищу: ${m[4]}.`);
  }

  /* ── окна и вкладки ── */
  if (/^(закрой|закрыть) (окно|это окно|это|текущее окно)$/.test(t)) {
    await pc("hotkey", { name: "close" });
    return reply(ok(), { quiet: true });
  }
  if (/^(сверни|свернуть) (окно|это окно|это)$/.test(t)) {
    await pc("hotkey", { name: "minimize" });
    return reply(ok(), { quiet: true });
  }
  if (/^(разверни|развернуть) (окно|это окно|на весь экран)$/.test(t)) {
    await pc("hotkey", { name: "maximize" });
    return reply(ok(), { quiet: true });
  }
  if (/^(сверни все|сверни все окна|покажи рабочий стол|на рабочий стол)$/.test(t)) {
    await pc("hotkey", { name: "desktop" });
    return reply(ok(), { quiet: true });
  }
  if (/^(полный экран|на весь экран|полноэкранный режим)$/.test(t)) {
    await pc("hotkey", { name: "fullscreen" });
    return reply(ok(), { quiet: true });
  }
  if (/^(новая вкладка|открой новую вкладку|новую вкладку)$/.test(t)) {
    await pc("hotkey", { name: "newtab" });
    return reply(ok(), { quiet: true });
  }
  if (/^(закрой вкладку|закрыть вкладку)$/.test(t)) {
    await pc("hotkey", { name: "closetab" });
    return reply(ok(), { quiet: true });
  }
  if (/^(верни вкладку|открой закрытую вкладку|восстанови вкладку)$/.test(t)) {
    await pc("hotkey", { name: "reopentab" });
    return reply(ok(), { quiet: true });
  }
  if (/^(какое окно|что (у меня )?открыто|какие окна( открыты)?|что за окно)$/.test(t)) {
    const w = await windows();
    const active = w.items.find((x) => x.pid === w.active);
    const names = [...new Set(w.items.map((x) => x.desc || x.name))].slice(0, 8);
    return reply(`${active ? `Сейчас перед вами ${active.desc || active.name}. ` : ""}Открыто: ${listing(names)}.`);
  }
  if ((m = t.match(/^(переключись|перейди|переключи) (на|в) (.+)$/)) || (m = t.match(/^(покажи|разверни) ()(.+)$/))) {
    const w = await findWindow(clean(m[3]));
    if (w) {
      await pc("window.focus", { pid: w.pid });
      return reply(ok(), { quiet: true });
    }
    if (m[1] === "переключись" || m[1] === "перейди") return reply(`Не вижу открытого окна «${m[3]}».`);
  }
  if ((m = t.match(/^(убей|заверши|закрой принудительно|убей процесс) (.+)$/))) {
    const w = await findWindow(clean(m[2]));
    if (!w) return reply(`Не нашёл запущенного «${m[2]}».`);
    const label = w.desc || w.name;
    return reply(`Принудительно закрыть ${label}? Несохранённое пропадёт.`, { state: { pc: { action: "kill", name: w.name, label } } });
  }
  if ((m = t.match(/^(закрой|закрыть|выключи|выйди из) (.+)$/)) && !/^(компьютер|комп|пк|ноутбук|звук|музыку|микрофон)$/.test(m[2])) {
    const w = await findWindow(clean(m[2]));
    if (w) {
      const closed = await pc<boolean>("window.close", { name: w.name });
      return reply(closed ? `Закрыл ${w.desc || w.name}.` : `${w.desc || w.name} не закрывается. Скажите «убей ${m[2]}», чтобы закрыть принудительно.`);
    }
    if (m[1] === "закрой" || m[1] === "закрыть") return reply(`Не вижу открытого «${m[2]}».`);
  }

  /* ── питание и экран ── */
  if (/^(заблокируй|блокируй|заблокировать) (компьютер|комп|экран|пк|ноутбук)$|^(блокировка|заблокируйся)$/.test(t)) {
    await pc("lock");
    return reply("Блокирую.", { quiet: true });
  }
  if (/^(выключи|выключить|отключи) (компьютер|комп|пк|ноутбук|ноут)$|^(выключайся|завершение работы)$/.test(t)) {
    return reply("Выключить компьютер? Скажите «да».", { state: { pc: { action: "shutdown", label: "выключение" } } });
  }
  if (/^(перезагрузи|перезагрузить|перезапусти) (компьютер|комп|пк|ноутбук|ноут)$|^(перезагрузка|перезагрузись)$/.test(t)) {
    return reply("Перезагрузить компьютер? Скажите «да».", { state: { pc: { action: "restart", label: "перезагрузку" } } });
  }
  if (/^(спящий режим|режим сна|усыпи (компьютер|комп|пк|ноутбук)|сон)$/.test(t)) {
    return reply("Перевести компьютер в сон? Скажите «да».", { state: { pc: { action: "sleep", label: "сон" } } });
  }
  if (/^(отмени|отменить|отмена) (выключени\S*|перезагрузк\S*)$|^не выключай$/.test(t)) {
    const ok2 = await pc<boolean>("shutdown.abort");
    return reply(ok2 ? "Выключение отменено." : "Выключение и не планировалось.");
  }
  if ((m = t.match(/^(сделай |поставь )?яркость( на)? (\d{1,3})( процент\S*)?$/))) {
    const v = await pc<number>("brightness.set", { level: Number(m[3]) });
    return reply(`Яркость ${v}.`);
  }
  if (/^(сделай )?(ярче|поярче|прибавь яркость)$|яркость на максимум/.test(t)) {
    const cur = /максимум/.test(t) ? 90 : await pc<number>("brightness.get");
    const v = await pc<number>("brightness.set", { level: cur + (/максимум/.test(t) ? 10 : 15) });
    return reply(`Яркость ${v}.`);
  }
  if (/^(сделай )?(темнее|потемнее|убавь яркость)$/.test(t)) {
    const cur = await pc<number>("brightness.get");
    const v = await pc<number>("brightness.set", { level: cur - 15 });
    return reply(`Яркость ${v}.`);
  }

  /* ── ввод текста, скриншоты ── */
  if ((m = t.match(/^(напечатай|набери|введи|впиши)\s+(.+)$/))) {
    // Берём текст как распознан — с регистром и знаками препинания.
    const rawText = ctx.raw.replace(/^[^\p{L}]*(джарвис[\s,.!]*)?(напечатай|набери|введи|впиши)[\s,:.!-]*/iu, "").trim() || m[2];
    const enter = /\s*(и )?(отправь|отправить|энтер)[.!]?$/i.test(rawText);
    const text = rawText.replace(/[\s,]*(и )?(отправь|отправить|энтер)[.!]?$/i, "");
    await pc("type", { text, enter });
    return reply(enter ? "Отправил." : "Напечатал.", { quiet: true });
  }
  if (/^(сделай |сделать )?(скриншот|скрин|снимок экрана)$/.test(t)) {
    const file = await pc<string>("screenshot", { dir: screenshotsDir() });
    return reply({ text: `Скриншот сохранён: ${file}`, tts: "Скриншот сохранён в папку Картинки, Джарвис." });
  }
  if (/^(вырежи|выдели) (кусок|часть|область) экрана$|^ножницы$/.test(t)) {
    await pc("hotkey", { name: "snip" });
    return reply("Выделите область.", { quiet: true });
  }

  /* ── состояние компьютера ── */
  if (/(сколько заряда|заряд (батареи|ноутбука)|батаре[яи]|сколько процентов (батареи|заряда))/.test(t)) {
    const b = await pc<{ percent: number; charging: boolean } | null>("battery");
    if (!b) return reply("Батареи не вижу — похоже, это стационарный компьютер.");
    return reply(`Заряд ${b.percent} ${plural(b.percent, "процент", "процента", "процентов")}${b.charging ? ", заряжается" : ""}.`);
  }
  if (/(нагрузк\S* (на )?(компьютер|процессор|пк)|сколько (свободно )?(памяти|оперативки)|как (там )?(компьютер|комп)|состояние (компьютера|системы))/.test(t)) {
    const s = await pc<{ cpu: number; ramUsed: number; ramTotal: number; uptimeMin: number }>("system");
    const up = s.uptimeMin >= 60 ? count(Math.floor(s.uptimeMin / 60), "час", "часа", "часов") : count(s.uptimeMin, "минута", "минуты", "минут");
    return reply({
      text: `Процессор ${s.cpu}%, память ${s.ramUsed} из ${s.ramTotal} ГБ. Работает ${up}.`,
      tts: `Процессор загружен на ${s.cpu} ${plural(s.cpu, "процент", "процента", "процентов")}, память занята на ${Math.round((s.ramUsed / s.ramTotal) * 100)} процентов. Компьютер работает ${up}.`,
    });
  }

  /* ── таймеры ── */
  if (/^(отмени|убери|сбрось|останови) (таймер\S*|все таймеры)$/.test(t)) {
    const n = timers.size;
    for (const x of timers.values()) clearTimeout(x.handle);
    timers.clear();
    return reply(n ? `Отменил ${count(n, "таймер", "таймера", "таймеров")}.` : "Таймеров нет.");
  }
  if (/(сколько (осталось|времени) (на таймере|до таймера)|какие таймеры|мои таймеры)/.test(t)) {
    if (!timers.size) return reply("Таймеров нет.");
    const list = [...timers.values()].map((x) => `${x.label ? x.label + " — " : ""}${durationText((x.endsAt - Date.now()) / 1000)}`);
    return reply(`Осталось: ${listing(list)}.`);
  }
  if ((m = t.match(/^(поставь |запусти |заведи |включи )?(таймер|засеки)( на)? (.+)$/))) {
    const minutes = parseDuration(m[4]);
    if (minutes) {
      const label = m[4]
        .replace(/(\d+(?:\.\d+)?)\s*(час\S*|ч|минут\S*|мин|секунд\S*|сек)(?=\s|$)/g, "")
        .replace(/(полчаса|полтора часа)/g, "")
        .replace(/^\s*(и|на|для|чтобы)\s+/, "")
        .trim();
      addTimer(minutes, label, ctx.address);
      return reply(`Таймер на ${durationText(minutes * 60)}${label ? `: ${label}` : ""}.`);
    }
  }

  /* ── открыть что-то ── */
  if ((m = t.match(/^(открой|запусти|включи|открыть|запустить|зайди на|зайди в|перейди на)\s+(.+)$/))) {
    const r = await openThing(m[2], ctx.hubUrl);
    if (r.ok) return reply(`Открываю ${r.label}.`);
    // «включи» бывает не про программы («включи свет») — пусть разберётся нейронка.
    if (m[1] === "открой" || m[1] === "запусти") return null;
  }
  return null;
}

async function runPending(ctx: PcCtx, p: PcPending): Promise<Reply> {
  if (p.action === "shutdown") {
    await pc("shutdown", { seconds: 30 });
    return reply("Выключаю через 30 секунд. Скажите «отмени выключение», если передумаете.", { state: {} });
  }
  if (p.action === "restart") {
    await pc("shutdown", { seconds: 15, restart: true });
    return reply("Перезагружаю через 15 секунд.", { state: {} });
  }
  if (p.action === "sleep") {
    setTimeout(() => void pc("sleep").catch(() => {}), 2500).unref?.();
    return reply(`Спокойной ночи${sir(ctx.address)}.`, { state: {} });
  }
  await pc("window.kill", { name: p.name });
  return reply(`Закрыл ${p.label}.`, { state: {} });
}
