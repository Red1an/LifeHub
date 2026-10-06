import type { Video } from "../data/videos";
import { hubNet } from "./ug";

/*
 * Поиск видео на YouTube через хаб (net): разборы песни и сама песня в оригинале.
 * Страница выдачи содержит JSON ytInitialData — из него берём ролики.
 */

interface Raw extends Video {
  len: number;
  pos: number;
}

const parseViews = (s = "") => Number(s.replace(/[^\d]/g, "")) || 0;
const parseLen = (s = "") => s.split(":").reduce((n, x) => n * 60 + Number(x), 0);

export async function searchYoutube(query: string): Promise<Raw[]> {
  const html = await hubNet().text(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=ru`);
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const out: Raw[] = [];
  (function walk(o: any) {
    if (!o || typeof o !== "object") return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      if (v.videoId)
        out.push({
          id: v.videoId,
          t: v.title?.runs?.map((r: any) => r.text).join("") ?? "",
          c: v.ownerText?.runs?.[0]?.text ?? "",
          d: v.lengthText?.simpleText ?? "",
          v: parseViews(v.viewCountText?.simpleText),
          len: parseLen(v.lengthText?.simpleText),
          pos: out.length,
        });
      return;
    }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const LESSON = /разбор|урок|как играть|как сыграть|аккорд|табы|на гитаре|tutorial|lesson|how to play|guitar|chords/i;
const NOT_LESSON = /караоке|karaoke|reaction|реакция|#shorts|минус|backing track|drum|барабан|piano|пианино|укулеле|ukulele|bass/i;
const TRUSTED = /гитара с нуля|pro гитару|гитарин|amdm|fmaj7|harmonych|marty music|andy guitar|justinguitar|tabs|ultimate guitar|гитара онлайн|уроки по гитаре|школа гитары|guitar lessons/i;

function relevance(title: string, song: string, artist: string) {
  const t = norm(title);
  const words = norm(song).split(" ").filter((w) => w.length > 1);
  const hit = words.filter((w) => t.includes(w)).length / Math.max(1, words.length);
  const a = norm(artist);
  return hit + (a && t.includes(a.split(" ")[0]) ? 0.4 : 0);
}

async function embeddable(id: string) {
  try {
    const r = await hubNet().fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`);
    return r.ok;
  } catch {
    return true;
  }
}

/** Лучшие разборы песни: релевантность, «урок/разбор» в названии, просмотры, разумная длина. */
export async function findLessons(song: string, artist: string): Promise<Video[]> {
  const latin = !/[а-яё]/i.test(song + artist);
  const queries = [`${artist} ${song} разбор на гитаре`, `${artist} ${song} как играть на гитаре`];
  if (latin) queries.push(`${artist} ${song} guitar lesson`);
  const lists = await Promise.all(queries.map((q) => searchYoutube(q).catch(() => [] as Raw[])));
  const seen = new Map<string, Raw & { score: number }>();
  lists.forEach((list, qi) =>
    list.forEach((v) => {
      if (v.len < 90 || v.len > 50 * 60 || NOT_LESSON.test(v.t)) return;
      const rel = relevance(v.t, song, artist);
      if (rel < 0.5) return;
      const score =
        rel * 2.2 + (LESSON.test(v.t) ? 1.5 : 0) + Math.log10(v.v + 10) * 0.55 + (TRUSTED.test(v.c) ? 0.8 : 0) +
        (v.len >= 180 && v.len <= 25 * 60 ? 0.4 : 0) - v.pos * 0.05 - qi * 0.1;
      const prev = seen.get(v.id);
      if (!prev || prev.score < score) seen.set(v.id, { ...v, score });
    }),
  );
  const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
  const out: Video[] = [];
  for (const v of ranked) {
    if (out.length >= 6) break;
    if (out.length < 3 && !(await embeddable(v.id))) continue;
    out.push({ id: v.id, t: v.t, c: v.c, d: v.d, v: v.v });
  }
  return out;
}

/** Песня в оригинале — слушать, подбирать на слух, играть вместе. */
export async function findOriginal(song: string, artist: string): Promise<Video | null> {
  const list = await searchYoutube(`${artist} ${song}`).catch(() => [] as Raw[]);
  const best = list
    .filter((v) => v.len >= 60 && v.len <= 15 * 60 && !/разбор|урок|lesson|tutorial|cover|кавер|караоке|karaoke/i.test(v.t))
    .map((v) => ({ v, score: relevance(v.t, song, artist) * 2 + Math.log10(v.v + 10) * 0.4 - v.pos * 0.15 + (/official|клип|audio|аудио/i.test(v.t) ? 0.3 : 0) }))
    .filter((x) => x.score > 1.5)
    .sort((a, b) => b.score - a.score)[0];
  return best ? { id: best.v.id, t: best.v.t, c: best.v.c, d: best.v.d, v: best.v.v } : null;
}
