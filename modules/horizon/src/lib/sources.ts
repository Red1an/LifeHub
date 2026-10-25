import { net } from "@lifehub/sdk";
import type { DayDoc, DayEvent } from "./types";

/*
 * Откуда берётся настоящее содержимое, чтобы нейронка не выдумывала факты:
 * Википедия («В этот день», «Знаете ли вы?», статьи), Викитека (стихи), Hacker News (технологии).
 */

const RU_WIKI = "https://ru.wikipedia.org";
const qs = (o: Record<string, string>) => new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...o }).toString();

/** Детерминированный «случай» по строке, чтобы выбор дня не прыгал между устройствами. */
export function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(a: T[], seed: string): T[] {
  const r = rng(seed);
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const wikiLink = (title: string, lang = "ru") => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/* ───────────── В этот день ───────────── */

const YEAR_PAGE = /^\d+( год)?( до н\. ?э\.)?$|^\d+ (января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)$|век$|^\d+-е$|тысячелетие/;

function toEvent(e: any): DayEvent | null {
  const year = Number(e?.year);
  const text = String(e?.text ?? "").trim();
  if (!Number.isFinite(year) || !text) return null;
  const pages: any[] = Array.isArray(e.pages) ? e.pages : [];
  const page = pages.find((p) => !YEAR_PAGE.test(String(p?.titles?.normalized ?? p?.title ?? "")));
  const title = page ? String(page.titles?.normalized ?? page.title).replace(/_/g, " ") : undefined;
  return {
    year,
    text,
    title,
    thumb: page?.thumbnail?.source,
    link: page?.content_urls?.desktop?.page ?? (title ? wikiLink(title) : undefined),
  };
}

export async function loadOnThisDay(day: string): Promise<DayDoc> {
  const [, m, d] = day.split("-");
  const r = await net.json<any>(`https://ru.wikipedia.org/api/rest_v1/feed/onthisday/all/${m}/${d}`);
  const list = (x: any) => (Array.isArray(x) ? (x.map(toEvent).filter(Boolean) as DayEvent[]) : []).sort((a, b) => a.year - b.year);
  return {
    day,
    selected: list(r.selected),
    events: list(r.events),
    births: list(r.births),
    deaths: list(r.deaths),
    holidays: (Array.isArray(r.holidays) ? r.holidays : []).map((h: any) => String(h?.text ?? "")).filter(Boolean).slice(0, 20),
  };
}

/* ───────────── статьи ───────────── */

export async function wikiSummary(title: string, lang = "ru"): Promise<{ extract: string; image?: string; thumb?: string; link: string } | null> {
  try {
    const r = await net.json<any>(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    if (r.type === "disambiguation") return null;
    return {
      extract: String(r.extract ?? ""),
      image: r.originalimage?.source,
      thumb: r.thumbnail?.source,
      link: r.content_urls?.desktop?.page ?? wikiLink(title, lang),
    };
  } catch {
    return null;
  }
}

/** Текст статьи без разметки (обрезанный) — чтобы нейронка объясняла по источнику. */
export async function wikiText(title: string, max = 14000): Promise<string> {
  const r = await net.json<any>(`${RU_WIKI}/w/api.php?${qs({ action: "query", prop: "extracts", explaintext: "1", redirects: "1", titles: title })}`);
  const text = String(r?.query?.pages?.[0]?.extract ?? "");
  return text.replace(/\n{3,}/g, "\n\n").slice(0, max);
}

/* ───────────── Знаете ли вы ───────────── */

export interface Teaser {
  teaser: string;
  title: string;
}

/** Анонсы рубрики «Знаете ли вы?» с главной Википедии: короткая загадка + статья с разгадкой. */
export async function loadTeasers(): Promise<Teaser[]> {
  const r = await net.json<any>(`${RU_WIKI}/w/api.php?${qs({ action: "parse", page: "Шаблон:Знаете ли вы", prop: "text" })}`);
  const html = String(r?.parse?.text ?? "");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: Teaser[] = [];
  for (const li of Array.from(doc.querySelectorAll("li"))) {
    const a = li.querySelector("b a[href^='/wiki/'], a[href^='/wiki/'] b")?.closest("a") ?? li.querySelector("b a");
    if (!a) continue;
    const href = a.getAttribute("href") ?? "";
    if (!href.startsWith("/wiki/") || href.includes(":")) continue;
    const title = decodeURIComponent(href.slice(6)).replace(/_/g, " ").replace(/#.*$/, "");
    const teaser = (li.textContent ?? "").replace(/\s*\(на\s*илл\.\)/g, "").replace(/\s+/g, " ").trim();
    if (teaser.length > 20) out.push({ teaser, title });
  }
  return out;
}

/* ───────────── стихи (Викитека) ───────────── */

export interface PoemText {
  title: string;
  lines: string[];
  link: string;
}

function poemLines(doc: Document, el: Element): string[] | null {
  // Внутри блока стиха бывают стили, номера строк, сноски и заголовки изданий — всё это не текст.
  el.querySelectorAll("style, link, script, sup, center, .reference, .linenum, .noprint, .mw-editsection, .ws-noexport, .wst-linenum").forEach((x) => x.remove());
  const tmp = doc.createElement("div");
  tmp.innerHTML = el.innerHTML.replace(/<br\s*\/?>\s*\n?/gi, "\n").replace(/<\/p>\s*<p[^>]*>/gi, "\n\n");
  const lines = (tmp.textContent ?? "")
    .replace(/[ ‎‏]/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const out: string[] = [];
  for (const l of lines) if (l || (out.length && out[out.length - 1])) out.push(l);
  return out.filter(Boolean).length >= 4 ? out : null;
}

/**
 * Текст стиха со страницы Викитеки. У классики часто несколько изданий подряд (ПСС 1948, СС 1959…)
 * и варианты отдельных строф: берём самый полный блок, из равных — последний (обычно современная орфография).
 */
function poemFrom(html: string, firstLine: string): string[] | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const start = simple(firstLine).slice(0, 10);
  let best: string[] | null = null;
  for (const el of Array.from(doc.querySelectorAll(".poem"))) {
    const lines = poemLines(doc, el);
    if (!lines || lines.length > 130) continue;
    // Черновики и варианты (редакторские [вставки] и <?>) и чужие блоки пропускаем.
    if (lines.some((l) => /\[|<\?>|<[а-яё.]+>/i.test(l))) continue;
    if (!simple(lines.slice(0, 3).join(" ")).includes(start)) continue;
    best = lines;
  }
  return best;
}

const simple = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z ]/g, "").replace(/\s+/g, " ");

/** Ищет стих в Викитеке по первой строке и автору, берёт текст из блока стихотворения. */
export async function loadPoem(author: string, firstLine: string): Promise<PoemText | null> {
  const surname = author.split(" ").pop() ?? author;
  const search = async (q: string) => {
    const r = await net.json<any>(`https://ru.wikisource.org/w/api.php?${qs({ action: "query", list: "search", srsearch: q, srlimit: "6", srnamespace: "0" })}`);
    return (r?.query?.search ?? []).map((x: any) => String(x.title)) as string[];
  };
  const clean = firstLine.replace(/[«»"!?.,;:—–-]+/g, " ").replace(/\s+/g, " ").trim();
  let titles = await search(`"${clean}" ${surname}`);
  if (!titles.length) titles = await search(`${clean} ${surname}`);
  // Сначала современная орфография: страницы /ДО — дореформенная.
  titles.sort((a, b) => Number(/\/ДО|\(ДО\)/.test(a)) - Number(/\/ДО|\(ДО\)/.test(b)));
  for (const title of titles.slice(0, 4)) {
    try {
      const r = await net.json<any>(`https://ru.wikisource.org/w/api.php?${qs({ action: "parse", page: title, prop: "text", redirects: "1" })}`);
      const lines = poemFrom(String(r?.parse?.text ?? ""), firstLine);
      if (!lines) continue;
      const t = String(r.parse.title ?? title);
      return { title: t, lines, link: `https://ru.wikisource.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}` };
    } catch {
      /* следующий результат */
    }
  }
  return null;
}

/* ───────────── анекдоты (anekdot.ru) ───────────── */

export interface SiteJoke {
  id: string;
  text: string;
  rating: number;
  url: string;
}

/**
 * Лучшие анекдоты по оценкам читателей anekdot.ru: за месяц, за год и лучшие прошлых лет в этот день.
 * Политики там много — отбирает нейронка; рейтинг — первое число в data-r.
 */
export async function loadSiteJokes(day: string): Promise<SiteJoke[]> {
  const [, m, d] = day.split("-");
  const pages = [
    "https://www.anekdot.ru/release/anekdot/month/",
    "https://www.anekdot.ru/release/anekdot/year/",
    `https://www.anekdot.ru/best/anekdot/${m}${d}/`,
  ];
  const out = new Map<string, SiteJoke>();
  const htmls = await Promise.all(pages.map((u) => net.text(u).catch(() => "")));
  for (const html of htmls) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const box of Array.from(doc.querySelectorAll(".topicbox[data-t='j']"))) {
      const id = box.getAttribute("data-id") ?? "";
      const el = box.querySelector(".text");
      if (!id || !el || out.has(id)) continue;
      const tmp = doc.createElement("div");
      tmp.innerHTML = el.innerHTML.replace(/<br\s*\/?>/gi, "\n");
      const text = (tmp.textContent ?? "").replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
      const rating = Number((box.querySelector(".rates")?.getAttribute("data-r") ?? "").split(";")[0]) || 0;
      if (text.length < 30 || text.length > 900) continue;
      out.set(id, { id, text, rating, url: `https://www.anekdot.ru/id/${id}/` });
    }
  }
  return [...out.values()].sort((a, b) => b.rating - a.rating);
}

/* ───────────── технологии ───────────── */

export async function loadHackerNews(): Promise<{ title: string; url: string; points: number }[]> {
  const r = await net.json<any>("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40");
  return (r?.hits ?? [])
    .map((h: any) => ({ title: String(h.title ?? ""), url: String(h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`), points: Number(h.points) || 0 }))
    .filter((h: { title: string }) => h.title);
}
