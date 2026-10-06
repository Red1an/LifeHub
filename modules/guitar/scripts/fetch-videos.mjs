/*
 * Подбор видеоуроков к темам: node scripts/fetch-videos.mjs [id темы…]
 * Ищет на YouTube по запросам из QUERIES, ранжирует по просмотрам, длительности, позиции в выдаче,
 * словам «урок/разбор» и проверенным каналам, проверяет встраивание и пишет src/data/videos.ts.
 * Без аргументов обновляет все темы. Ручные правки: PINNED (всегда первые) и BANNED (никогда).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, "src", "data", "videos.ts");

/** id темы → [запрос на русском, запрос на английском или null] */
const QUERIES = {
  tuning: ["как настроить гитару по тюнеру для начинающих", null],
  posture: ["как правильно держать гитару постановка рук урок", null],
  "first-chords": ["первые аккорды на гитаре Am Dm E урок для начинающих", null],
  "chord-changes": ["как быстро менять аккорды на гитаре упражнение", "how to change chords faster guitar exercise"],
  strumming: ["бой шестёрка на гитаре урок для начинающих", null],
  "strum-patterns": ["виды боя на гитаре урок восьмёрка четвёрка", "strumming patterns guitar lesson"],
  muting: ["бой с глушением на гитаре урок", null],
  barre: ["как научиться брать баррэ на гитаре урок", "how to play barre chords guitar"],
  fingerpicking: ["перебор на гитаре для начинающих урок", null],
  travis: ["перебор травис на гитаре урок", "travis picking guitar lesson"],
  "ear-song": ["как подобрать песню на слух на гитаре", "how to learn songs by ear guitar"],
  "ear-key": ["как определить тональность песни на слух гитара", "how to find the key of a song by ear guitar"],
  "ear-degrees": ["ступени аккордов в тональности гитара подбор", "chords in a key guitar explained"],
  "ear-melody": ["как подобрать мелодию на гитаре на слух", "how to play melodies by ear guitar"],
  intervals: ["интервалы на слух сольфеджио тренировка", "ear training intervals for guitarists"],
  "improv-start": ["импровизация на гитаре с нуля урок", "guitar improvisation for beginners"],
  pentatonic: ["минорная пентатоника на гитаре 5 позиций урок", "minor pentatonic scale guitar lesson"],
  "pentatonic-connect": ["соединение позиций пентатоники по всему грифу", "connect pentatonic positions guitar"],
  blues: ["блюзовая импровизация на гитаре урок", "blues guitar improvisation lesson"],
  phrasing: ["фразировка соло гитара урок", "guitar soloing phrasing lesson"],
  "target-notes": ["импровизация по аккордам целевые ноты гитара", "target notes chord tones guitar solo"],
  modes: ["лады на гитаре дорийский миксолидийский урок", "guitar modes explained"],
  "fretboard-notes": ["как выучить ноты на грифе гитары", "learn the notes on the guitar fretboard"],
  caged: ["система CAGED гитара урок", "CAGED system guitar explained"],
  "theory-basics": ["теория музыки для гитаристов с нуля", "music theory for guitarists"],
  "rhythm-timing": ["как играть ровно под метроном гитара упражнения", "guitar timing exercises metronome"],
  bends: ["бенд на гитаре как правильно урок", "how to bend strings guitar in tune"],
  speed: ["упражнения на беглость пальцев гитара", "guitar finger exercises speed"],
  "sing-play": ["как петь и играть на гитаре одновременно", "how to sing and play guitar at the same time"],
  "vocal-warmup": ["распевка для начинающих вокал урок", null],
  "vocal-pitch": ["как научиться попадать в ноты голосом", null],
  "vocal-breath": ["дыхание опора вокал упражнения", null],
  "vocal-range": ["как расширить диапазон голоса упражнения", null],
  harmony: ["как петь вторым голосом бэк вокал урок", null],
};

const TRUSTED = [
  "Fender", "JustinGuitar", "Marty Music", "Andy Guitar", "Paul Davids", "Active Melody", "Guitar Lessons 365",
  "Brian Kelly", "Ben Eller", "Pebber Brown", "Rick Beato", "Marty Schwartz", "Swiftlessons",
  "Гитарин", "Pro Гитару", "Юрий Сахаров", "AmDm", "Школа гитары", "Гитарная школа",
  "Gitaraclub", "Гитара с нуля", "MuzStudia",
];
const BANNED_WORDS = /#shorts|укулеле|ukulele|бас-гитар|bass guitar|фортепиано|piano|барабан|drum/i;
const PINNED = {};
const BANNED = new Set([]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parseViews = (s = "") => Number(s.replace(/[^\d]/g, "")) || 0;
const parseLen = (s = "") => s.split(":").reduce((n, x) => n * 60 + Number(x), 0);

async function get(url, init) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (i >= 3) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

async function search(q, lang) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=${lang}`;
  const html = await (await get(url, { headers: { "user-agent": "Mozilla/5.0", "accept-language": lang === "ru" ? "ru-RU,ru" : "en-US,en" } })).text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const out = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      out.push({
        id: v.videoId,
        t: v.title?.runs?.map((r) => r.text).join("") ?? "",
        c: v.ownerText?.runs?.[0]?.text ?? "",
        views: parseViews(v.viewCountText?.simpleText),
        len: parseLen(v.lengthText?.simpleText),
        d: v.lengthText?.simpleText ?? "",
      });
      return;
    }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  return out;
}

/** Можно ли встроить ролик. При ограничении частоты (429/5xx) ждём и пробуем снова. */
async function embeddable(id) {
  for (let i = 0; i < 4; i++) {
    const r = await get(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
    if (r.ok) return true;
    if (r.status !== 429 && r.status < 500) return false;
    await sleep(15000 * (i + 1));
  }
  return false;
}

/** Поиск с повторами: пустая выдача обычно означает временное ограничение YouTube. */
async function searchRetry(q, lang) {
  for (let i = 0; i < 3; i++) {
    const list = await search(q, lang).catch(() => []);
    if (list.length) return list;
    await sleep(20000 * (i + 1));
  }
  return [];
}

function rank(list, lang, exclude) {
  const cyr = /[а-яё]/i;
  const lesson = /урок|разбор|как |для начинающих|упражнени|lesson|tutorial|how to|beginner/i;
  return list
    .map((v, pos) => ({ ...v, pos }))
    .filter((v) => v.id && !BANNED.has(v.id) && v.len >= 150 && v.len <= 75 * 60 && !BANNED_WORDS.test(v.t))
    .filter((v) => (lang === "ru" ? cyr.test(v.t) : !cyr.test(v.t)))
    .filter((v) => !exclude.has(v.id))
    .filter((v) => v.views >= (lang === "ru" ? 3000 : 20000))
    .map((v) => {
      const trusted = TRUSTED.some((c) => v.c.toLowerCase().includes(c.toLowerCase()));
      const score =
        Math.log10(v.views + 10) * (1 - v.pos * 0.035) + (trusted ? 1.2 : 0) + (lesson.test(v.t) ? 0.6 : 0) + (v.len <= 20 * 60 ? 0.3 : 0);
      return { ...v, score };
    })
    .sort((a, b) => b.score - a.score);
}

async function pick(q, lang, exclude = new Set(), count = 3) {
  const ranked = rank(await searchRetry(q, lang), lang, exclude);
  const res = [];
  for (const v of ranked) {
    if (res.length >= count) break;
    if (await embeddable(v.id)) res.push({ id: v.id, t: v.t, c: v.c, d: v.d, v: v.views });
  }
  return res;
}

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8").replace(/^[\s\S]*?= /, "").replace(/;\s*$/, "")) : {};
const header = `/* Сгенерировано scripts/fetch-videos.mjs — видеоуроки к темам (YouTube). v — просмотры на момент подбора. Руками не править. */
export interface Video { id: string; t: string; c: string; d: string; v: number }
export const VIDEOS: Record<string, { ru: Video[]; en: Video[] }> = `;
const save = () => fs.writeFileSync(OUT, header + JSON.stringify(existing, null, 1) + ";\n");

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(QUERIES);
for (const id of ids) {
  const [ru, en] = QUERIES[id] ?? [];
  if (!ru) {
    console.warn("нет запроса для", id);
    continue;
  }
  try {
    const r = await pick(ru, "ru");
    await sleep(2500);
    const e = en ? await pick(en, "en", new Set(r.map((x) => x.id)), 2) : [];
    await sleep(2500);
    // Пустой результат не затирает найденное раньше.
    const prev = existing[id] ?? { ru: [], en: [] };
    existing[id] = {
      ru: [...(PINNED[id]?.ru ?? []), ...(r.length ? r : prev.ru)],
      en: [...(PINNED[id]?.en ?? []), ...(e.length ? e : prev.en)],
    };
    save();
    console.log(id, r.length, e.length);
  } catch (err) {
    console.warn(id, "ошибка", err.message);
  }
}
save();
console.log("готово:", Object.keys(existing).length, "тем");
