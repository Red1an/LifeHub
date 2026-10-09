import { net as sdkNet } from "@lifehub/sdk";
import type { ChordShape } from "./chord-shapes";
import { fingering } from "./chords";

/*
 * Ultimate Guitar: крупнейшая база аккордов и табов, в том числе русских песен.
 * Страницы отдают данные JSON-ом в атрибуте data-content у div.js-store — его и разбираем.
 * Запросы идут через хаб (net, разрешение "network"), потому что UG не отдаёт CORS.
 */

export type UgType = "Chords" | "Tabs" | "Bass Tabs" | "Ukulele Chords" | "Pro" | "Official" | "Power" | "Video" | string;

export interface UgResult {
  id: number;
  song: string;
  artist: string;
  type: UgType;
  version: number;
  rating: number;
  votes: number;
  key: string;
  difficulty: string;
  url: string;
}

export interface UgSong {
  id: number;
  song: string;
  artist: string;
  type: UgType;
  key: string;
  capo: number;
  tuning: string;
  difficulty: string;
  rating: number;
  votes: number;
  url: string;
  /** Текст с разметкой [ch]…[/ch] и [tab]…[/tab]. */
  content: string;
  /** Аппликатуры из UG: имя аккорда → варианты (струны от низкой E). */
  shapes: Record<string, ChordShape[]>;
  /** Схемы боя, если автор указал. */
  strums: UgStrum[];
}

export interface UgStrum {
  part: string;
  bpm: number;
  denominator: number;
  /** Последовательность: "D" вниз, "U" вверх, "-" пауза. */
  pattern: string[];
}

/** net появился в SDK вместе с этой версией модуля; на старом хабе — понятная ошибка вместо падения. */
export function hubNet(): typeof sdkNet {
  if (!sdkNet) throw new Error("Хаб нужно перезапустить (Настройки → Перезапустить), чтобы заработал поиск в интернете");
  return sdkNet;
}

function decodeHtml(s: string) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readStore(html: string): any {
  const m = html.match(/class="js-store"\s+data-content="([^"]*)"/);
  if (!m) throw new Error("Ultimate Guitar поменял страницу — не удалось прочитать данные");
  return JSON.parse(decodeHtml(m[1]));
}

const TYPE_ORDER: Record<string, number> = { Chords: 0, Tabs: 1, "Ukulele Chords": 3, "Bass Tabs": 4 };

async function searchPage(query: string, page: number): Promise<any[]> {
  const url = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(query)}&page=${page}`;
  const r = await hubNet().fetch(url);
  // Когда ничего не найдено, UG отвечает 404 — это пустая выдача, а не поломка.
  if (r.status === 404) return [];
  if (!r.ok) {
    if (page > 1) return [];
    throw new Error(`Ultimate Guitar ответил ошибкой ${r.status}`);
  }
  try {
    return readStore(r.text)?.store?.page?.data?.results ?? [];
  } catch {
    if (page > 1) return [];
    throw new Error("Ultimate Guitar поменял страницу — не удалось прочитать результаты");
  }
}

/** Поиск песен (первые 3 страницы — для запроса по исполнителю это весь его репертуар). Платные (Pro, Official) отбрасываем. */
export async function searchUg(query: string): Promise<UgResult[]> {
  const pages = await Promise.all([1, 2, 3].map((p) => (p === 1 ? searchPage(query, p) : searchPage(query, p).catch(() => []))));
  const raw = pages.flat();
  const seen = new Set<number>();
  return raw
    .filter((r) => r && r.id && !r.marketing_type && (r.type === "Chords" || r.type === "Tabs" || r.type === "Ukulele Chords" || r.type === "Bass Tabs"))
    .filter((r) => r.tab_access_type !== "private")
    .filter((r) => !seen.has(Number(r.id)) && !!seen.add(Number(r.id)))
    .map((r) => ({
      id: Number(r.id),
      song: String(r.song_name ?? ""),
      artist: String(r.artist_name ?? ""),
      type: r.type,
      version: Number(r.version ?? 1),
      rating: Number(r.rating ?? 0),
      votes: Number(r.votes ?? 0),
      key: String(r.tonality_name ?? ""),
      difficulty: String(r.difficulty ?? ""),
      url: String(r.tab_url ?? `https://tabs.ultimate-guitar.com/tab/${r.id}`),
    }));
}

/** Оценка «лучшего» варианта: рейтинг с учётом числа голосов (байесовское среднее). */
export function ugScore(r: { rating: number; votes: number }): number {
  const prior = 4.2;
  const weight = 15;
  return (r.rating * r.votes + prior * weight) / (r.votes + weight);
}

export interface UgGroup {
  key: string;
  song: string;
  artist: string;
  versions: UgResult[];
}

const words = (s: string) => s.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/).filter((w) => w.length > 1);

/** Группирует результаты по песне; сверху — совпавшие с запросом, внутри — лучшие версии аккордов и табов. */
export function groupResults(results: UgResult[], query = ""): UgGroup[] {
  const map = new Map<string, UgGroup>();
  for (const r of results) {
    const key = `${r.artist.toLowerCase()}|${r.song.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").trim()}`;
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, song: r.song, artist: r.artist, versions: [] }));
    g.versions.push(r);
  }
  const groups = [...map.values()];
  for (const g of groups) g.versions.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || ugScore(b) - ugScore(a));
  const pop = (g: UgGroup) => g.versions.reduce((s, v) => s + v.votes, 0);
  const q = words(query);
  const match = (g: UgGroup) => {
    if (!q.length) return 0;
    const have = new Set(words(`${g.song} ${g.artist}`));
    return q.filter((w) => have.has(w) || [...have].some((h) => h.startsWith(w))).length / q.length;
  };
  return groups.sort((a, b) => match(b) - match(a) || pop(b) - pop(a));
}

function convertShape(a: any): ChordShape | null {
  if (!Array.isArray(a?.frets) || a.frets.length !== 6) return null;
  // UG перечисляет струны от 1-й (тонкой) к 6-й — разворачиваем.
  const frets = [...a.frets].reverse().map((f: number) => (f < 0 ? -1 : Number(f)));
  const f = fingering(frets);
  if (!f) return null;
  const pressed = frets.filter((x) => x > 0);
  const max = pressed.length ? Math.max(...pressed) : 0;
  return { frets, ...f, baseFret: max <= 4 ? 1 : Math.min(...pressed) };
}

function parseStrums(list: any[]): UgStrum[] {
  return (list ?? []).flatMap((s: any) => {
    const measures: any[] = s?.measures ?? [];
    const pattern = measures.map((m) => {
      // 1 — вниз, 101 — вверх, 2xx — пауза; остальные коды встречаются редко.
      const d = Number(m.measure);
      if (d === 1) return "D";
      if (d === 101) return "U";
      return "-";
    });
    if (!pattern.length) return [];
    return [{ part: String(s.part ?? ""), bpm: Number(s.bpm ?? 0), denominator: Number(s.denuminator ?? s.denominator ?? 8), pattern }];
  });
}

/** Загрузка версии. Короткий адрес /tab/<id> работает не у всех версий — передавай полный, если он есть. */
export async function loadUg(id: number, url?: string | null): Promise<UgSong> {
  const safe = url && /^https:\/\/tabs\.ultimate-guitar\.com\/tab\//.test(url) ? url : `https://tabs.ultimate-guitar.com/tab/${id}`;
  const html = await hubNet().text(safe);
  const data = readStore(html)?.store?.page?.data;
  const tab = data?.tab ?? {};
  const view = data?.tab_view ?? {};
  const content: string = view?.wiki_tab?.content ?? "";
  if (!content) throw new Error("Эта версия недоступна (возможно, платная) — выбери другую");
  const shapes: Record<string, ChordShape[]> = {};
  for (const [name, list] of Object.entries(view?.applicature ?? {})) {
    const conv = (list as any[]).map(convertShape).filter((x): x is ChordShape => !!x);
    if (conv.length) shapes[name] = conv.slice(0, 4);
  }
  const meta = view?.meta ?? {};
  return {
    id,
    song: String(tab.song_name ?? ""),
    artist: String(tab.artist_name ?? ""),
    type: tab.type ?? "Chords",
    key: String(meta.tonality ?? tab.tonality_name ?? ""),
    capo: Number(meta.capo ?? 0) || 0,
    tuning: String(meta.tuning?.value ?? "E A D G B E"),
    difficulty: String(meta.difficulty ?? tab.difficulty ?? ""),
    rating: Number(tab.rating ?? 0),
    votes: Number(tab.votes ?? 0),
    url: String(tab.tab_url ?? `https://tabs.ultimate-guitar.com/tab/${id}`),
    content: content.replace(/\r\n?/g, "\n"),
    shapes,
    strums: parseStrums(view?.strummings),
  };
}

export const UG_TYPE_RU: Record<string, string> = {
  Chords: "Аккорды",
  Tabs: "Таб",
  "Ukulele Chords": "Укулеле",
  "Bass Tabs": "Бас",
};

export const DIFFICULTY_RU: Record<string, string> = {
  novice: "новичок",
  beginner: "легко",
  intermediate: "средне",
  advanced: "сложно",
};
