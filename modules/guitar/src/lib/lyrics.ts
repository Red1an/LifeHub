import { hubNet } from "./ug";

/*
 * Слова песни из интернета — открытая база LRCLIB (lrclib.net): обычный текст и «синхронный»
 * (у каждой строки время начала). По времени строк аккорды ставятся над словами без ручной разметки.
 */

export interface Lyrics {
  plain: string;
  /** Строки со временем начала, секунды. */
  synced: { t: number; text: string }[] | null;
  duration: number | null;
  source: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/группа\s+/g, "")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();

function parseLrc(lrc: string): { t: number; text: string }[] {
  const out: { t: number; text: string }[] = [];
  for (const line of lrc.split("\n")) {
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (m) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return out.filter((l) => l.text);
}

const cache = new Map<string, Promise<Lyrics | null>>();

/** Лучшее совпадение по исполнителю и названию; при равенстве — синхронный текст и длина ближе к табу. */
export function findLyrics(artist: string, title: string, durationSec?: number | null): Promise<Lyrics | null> {
  const key = `${norm(artist)}|${norm(title)}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const list = await hubNet().json<any[]>(`https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${title}`)}`);
      const t = norm(title);
      const a = norm(artist);
      const scored = (list ?? [])
        .filter((x) => x && (x.plainLyrics || x.syncedLyrics) && !x.instrumental)
        .map((x) => {
          const xt = norm(String(x.trackName ?? ""));
          const xa = norm(String(x.artistName ?? ""));
          const titleOk = xt === t ? 3 : xt.includes(t) || t.includes(xt) ? 1 : 0;
          const artistOk = xa === a ? 2 : a && (xa.includes(a) || a.includes(xa)) ? 1 : 0;
          const dur = durationSec && x.duration ? -Math.abs(x.duration - durationSec) / 30 : 0;
          return { x, score: titleOk * 10 + artistOk * 5 + (x.syncedLyrics ? 2 : 0) + dur, titleOk, artistOk };
        })
        .filter((s) => s.titleOk > 0 && s.artistOk > 0)
        .sort((u, v) => v.score - u.score);
      const best = scored[0]?.x;
      if (!best) return null;
      const synced = best.syncedLyrics ? parseLrc(String(best.syncedLyrics)) : null;
      return {
        plain: String(best.plainLyrics ?? synced?.map((l) => l.text).join("\n") ?? ""),
        synced: synced && synced.length > 3 ? synced : null,
        duration: Number(best.duration) || null,
        source: "LRCLIB",
      };
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
