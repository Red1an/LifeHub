import { db, net } from "@lifehub/sdk";
import { kindOf } from "./kinds.ts";
import type { Note, NoteDoc } from "./types.ts";

/*
 * Обложки и описания из открытых каталогов — без ключей, через net (хаб, без CORS):
 * фильмы и сериалы — Википедия, книги — Open Library (там же рейтинг), приложения — App Store.
 * Ищем один раз (enrichedAt), ничего не нашли — молча оставляем как есть.
 */

type Found = Pick<Note, "cover" | "about" | "extRating" | "extUrl">;

const clip = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

interface WikiPage {
  index?: number;
  title: string;
  extract?: string;
  fullurl?: string;
  thumbnail?: { source: string };
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Статья Википедии про эту вещь. Берём только страницу, чьё название совпадает с искомым
 * («Интерстеллар» ↔ «Интерстеллар (фильм)»): поиск охотно находит актёров и режиссёров.
 */
async function wikipedia(query: string, expect: string, lang: "ru" | "en", avoid?: RegExp): Promise<Found | null> {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=5&prop=pageimages|extracts|info` +
    `&inprop=url&piprop=thumbnail&pithumbsize=500&exintro=1&explaintext=1&exsentences=2&gsrsearch=${encodeURIComponent(query)}`;
  const r = await net.json<{ query?: { pages?: Record<string, WikiPage> } }>(url);
  const want = norm(expect);
  const page = Object.values(r.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 9) - (b.index ?? 9))
    .find((p) => {
      // «Задача трёх тел (телесериал)» для книги — не то.
      if (avoid?.test(p.title)) return false;
      const t = norm(p.title);
      return t === want || t.startsWith(want + " ") || (want.length >= 6 && want.startsWith(t + " "));
    });
  if (!page) return null;
  return { cover: page.thumbnail?.source, about: clip(page.extract?.trim(), 300), extUrl: page.fullurl };
}

async function openLibrary(title: string, author?: string): Promise<Found | null> {
  const q = encodeURIComponent([title, author].filter(Boolean).join(" "));
  const r = await net.json<{ docs?: { key: string; cover_i?: number; ratings_average?: number; ratings_count?: number }[] }>(
    `https://openlibrary.org/search.json?q=${q}&limit=1&fields=key,cover_i,ratings_average,ratings_count`,
  );
  const d = r.docs?.[0];
  if (!d) return null;
  return {
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : undefined,
    extRating: d.ratings_average && (d.ratings_count ?? 0) >= 3 ? { value: Math.round(d.ratings_average * 10) / 10, of: 5, source: "Open Library", votes: d.ratings_count } : undefined,
    extUrl: `https://openlibrary.org${d.key}`,
  };
}

async function appStore(title: string): Promise<Found | null> {
  const r = await net.json<{ results?: { artworkUrl512?: string; artworkUrl100?: string; averageUserRating?: number; userRatingCount?: number; trackViewUrl?: string; description?: string; trackName?: string }[] }>(
    `https://itunes.apple.com/search?entity=software&country=ru&limit=1&term=${encodeURIComponent(title)}`,
  );
  const a = r.results?.[0];
  // Поиск App Store находит что-нибудь почти всегда — берём, только если название похоже.
  if (!a || !a.trackName?.toLowerCase().includes(title.toLowerCase().split(/\s+/)[0])) return null;
  return {
    cover: a.artworkUrl512 ?? a.artworkUrl100,
    about: clip(a.description?.split("\n")[0], 240),
    extRating: a.averageUserRating && (a.userRatingCount ?? 0) >= 10 ? { value: Math.round(a.averageUserRating * 10) / 10, of: 5, source: "App Store", votes: a.userRatingCount } : undefined,
    extUrl: a.trackViewUrl,
  };
}

/** Каким типам есть что искать: у мест и хотелок поиск по Википедии чаще находит не то. */
export function canEnrich(n: Note) {
  return ["movie", "book", "app"].includes(kindOf(n).id);
}

/** Найти обложку и описание для заметки. Возвращает найденное (и сохраняет его). */
export async function enrichNote(n: NoteDoc): Promise<Found | null> {
  const kind = kindOf(n).id;
  const p = n.props ?? {};
  const title = n.title.replace(/[«»"]/g, "").trim();
  let found: Found | null = null;
  try {
    if (kind === "book") {
      // Open Library — обложка и рейтинг, Википедия — описание по-русски.
      const ol = await openLibrary(title, p.author).catch(() => null);
      const wiki = await wikipedia(`${title} ${p.author ?? ""} книга`, title, "ru", /\((теле)?сериал|фильм|аниме|игра/i).catch(() => null);
      if (ol || wiki) found = { cover: ol?.cover ?? wiki?.cover, about: wiki?.about, extRating: ol?.extRating, extUrl: wiki?.extUrl ?? ol?.extUrl };
    } else if (kind === "movie") {
      const what = /сериал/i.test(p.format ?? "") ? "телесериал" : /аниме/i.test(p.format ?? "") ? "аниме" : /мульт/i.test(p.format ?? "") ? "мультфильм" : "фильм";
      found = (await wikipedia(`${title} ${p.year ?? ""} ${what}`, title, "ru", /\((роман|книга|повесть|игра|комикс)/i)) ?? (/[a-z]/i.test(title) ? await wikipedia(`${title} ${p.year ?? ""} film`, title, "en") : null);
    } else if (kind === "app" && !n.links?.some((l) => l.image)) {
      found = await appStore(title);
    }
  } catch {
    found = null;
  }
  const patch: Partial<Note> = { enrichedAt: Date.now() };
  if (found?.cover) patch.cover = found.cover;
  if (found?.about) patch.about = found.about;
  if (found?.extRating) patch.extRating = found.extRating;
  if (found?.extUrl) patch.extUrl = found.extUrl;
  await db.collection<Note>("notes").update(n.id, patch);
  return found;
}

/** Обложки для свежеразобранных заметок — в фоне, по одной, чтобы не дёргать каталоги разом. */
export async function enrichMany(notes: NoteDoc[]) {
  for (const n of notes) {
    if (!canEnrich(n) || n.enrichedAt) continue;
    await enrichNote(n).catch(() => {});
  }
}
