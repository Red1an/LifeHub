import { hubNet } from "./ug";
import { buildChordSheet, type AutoResult } from "./autochords";
import { findLyrics } from "./lyrics";

/*
 * Songsterr: табы по партиям (лид, ритм, соло, бас) с нотами, длительностями, темпом и названиями частей.
 * Поиск и описание песни — www.songsterr.com/api, ноты партии — JSON на их CDN (сжат gzip, хаб распаковывает).
 * Из нот рисуем таб (components/TabPlayer.tsx) и проигрываем его синтезом гитары.
 */

const API = "https://www.songsterr.com/api";
const CDN = "https://dqsljvtekg760.cloudfront.net";

export interface SstTrack {
  /** Номер партии (= индекс в списке дорожек). */
  partId: number;
  name: string;
  instrument: string;
  instrumentId: number;
  difficulty?: number;
  views: number;
  strings: number;
  kind: "guitar" | "bass" | "other";
  vocal: boolean;
}

export interface SstSong {
  songId: number;
  artist: string;
  title: string;
  tracks: SstTrack[];
}

export interface SstMeta extends SstSong {
  revisionId: number;
  image: string;
  fingerstyle: boolean;
  popularGuitar: number | null;
}

export interface Note {
  string: number;
  fret: number;
  tie?: boolean;
  dead?: boolean;
  ghost?: boolean;
  hp?: boolean;
  slide?: string;
  /** Подтяжка в полутонах (1 = полтона, 2 = тон). */
  bend?: number;
  vibrato?: boolean;
  harmonic?: boolean;
}

export interface Beat {
  /** Длительность в долях целой ноты (уже с точками и триолями). */
  dur: number;
  /** Начало внутри такта, в долях целой. */
  at: number;
  rest: boolean;
  grace: boolean;
  notes: Note[];
  chord?: string;
  palmMute?: boolean;
  /** Направление удара в нотации Songsterr (стрелка по нотному стану). */
  stroke?: "up" | "down";
}

export interface Measure {
  index: number;
  sig: [number, number];
  marker?: string;
  beats: Beat[];
  /** Длина такта в долях целой. */
  len: number;
}

export interface Part {
  name: string;
  instrument: string;
  /** Строй от 1-й (тонкой) струны: midi. */
  tuning: number[];
  strings: number;
  measures: Measure[];
  /** Темп: с какого такта какой BPM (четверть). */
  tempo: { measure: number; bpm: number }[];
  /** Слова (у вокальной партии): слоги через «-», с какого такта начинаются. */
  lyrics?: { offset: number; text: string }[];
}

const kindOf = (id: number): SstTrack["kind"] => (id >= 24 && id <= 31 ? "guitar" : id >= 32 && id <= 39 ? "bass" : "other");

function tracksOf(raw: any[]): SstTrack[] {
  return (raw ?? []).map((t: any, i: number) => ({
    partId: Number(t.partId ?? i),
    name: String(t.name ?? t.instrument ?? `Партия ${i + 1}`),
    instrument: String(t.instrument ?? ""),
    instrumentId: Number(t.instrumentId ?? 0),
    difficulty: t.difficulty,
    views: Number(t.views ?? 0),
    strings: Array.isArray(t.tuning) ? t.tuning.length : 6,
    kind: t.isVocalTrack || /^vocals_/.test(String(t.hash ?? "")) ? "other" : kindOf(Number(t.instrumentId ?? 0)),
    vocal: !!t.isVocalTrack || /^vocals_/.test(String(t.hash ?? "")),
  }));
}

export async function searchSst(query: string, size = 10): Promise<SstSong[]> {
  const list = await hubNet().json<any[]>(`${API}/songs?pattern=${encodeURIComponent(query)}&size=${size}`);
  return (list ?? []).map((s) => ({ songId: Number(s.songId), artist: String(s.artist ?? ""), title: String(s.title ?? ""), tracks: tracksOf(s.tracks) }));
}

export async function loadSstMeta(songId: number): Promise<SstMeta> {
  const m = await hubNet().json<any>(`${API}/meta/${songId}`);
  return {
    songId,
    artist: String(m.artist ?? ""),
    title: String(m.title ?? ""),
    tracks: tracksOf(m.tracks),
    revisionId: Number(m.revisionId),
    image: String(m.image),
    fingerstyle: !!m.fingerstyle,
    popularGuitar: typeof m.popularTrackGuitar === "number" ? m.popularTrackGuitar : typeof m.popularTrack === "number" ? m.popularTrack : null,
  };
}

const partCache = new Map<string, Promise<Part>>();

export function loadPart(meta: Pick<SstMeta, "songId" | "revisionId" | "image">, partId: number): Promise<Part> {
  const key = `${meta.songId}/${meta.revisionId}/${partId}`;
  let p = partCache.get(key);
  if (!p) {
    p = hubNet()
      .json<any>(`${CDN}/${meta.songId}/${meta.revisionId}/${meta.image}/${partId}.json`)
      .then(parsePart);
    p.catch(() => partCache.delete(key));
    partCache.set(key, p);
  }
  return p;
}

export function parsePart(j: any): Part {
  const tuning: number[] = Array.isArray(j.tuning) ? j.tuning : [64, 59, 55, 50, 45, 40];
  let sig: [number, number] = [4, 4];
  const measures: Measure[] = (j.measures ?? []).map((m: any, index: number) => {
    if (Array.isArray(m.signature)) sig = [m.signature[0], m.signature[1]];
    const voice = m.voices?.[0]?.beats ?? [];
    let at = 0;
    const beats: Beat[] = voice.map((b: any) => {
      const grace = !!b.graceNote;
      const dur = grace ? 0 : Array.isArray(b.duration) ? b.duration[0] / b.duration[1] : 0.25;
      const notes: Note[] = (b.notes ?? [])
        .filter((n: any) => !n.rest && typeof n.fret === "number")
        .map((n: any) => ({
          string: Number(n.string),
          fret: Number(n.fret),
          tie: !!n.tie || undefined,
          dead: !!n.dead || undefined,
          ghost: !!n.ghost || undefined,
          hp: !!n.hp || undefined,
          slide: typeof n.slide === "string" ? n.slide : undefined,
          bend: n.bend?.tone ? Math.round(n.bend.tone / 50) : undefined,
          vibrato: !!(n.vibrato || n.leftHandVibrato) || undefined,
          harmonic: !!n.harmonic || undefined,
        }));
      const stroke = b.upStroke ? "up" : b.downStroke ? "down" : b.brushStroke?.direction === "up" ? "up" : b.brushStroke?.direction === "down" ? "down" : undefined;
      const beat: Beat = { dur, at, rest: !!b.rest || notes.length === 0, grace, notes, chord: b.chord?.text, palmMute: !!b.palmMute || undefined, stroke };
      at += dur;
      return beat;
    });
    return { index, sig, marker: m.marker?.text, beats, len: Math.max(at, sig[0] / sig[1]) };
  });
  const tempo = ((j.automations?.tempo ?? []) as any[]).map((t) => ({ measure: Number(t.measure ?? 0), bpm: Number(t.bpm ?? 100) })).sort((a, b) => a.measure - b.measure);
  const lyrics = Array.isArray(j.newLyrics) ? (j.newLyrics as any[]).filter((l) => l?.text).map((l) => ({ offset: Number(l.offset ?? 1), text: String(l.text) })) : undefined;
  return { name: String(j.name ?? ""), instrument: String(j.instrument ?? ""), tuning, strings: tuning.length, measures, tempo: tempo.length ? tempo : [{ measure: 0, bpm: 100 }], lyrics };
}

/** Части песни по меткам: «Вступление», «Куплет», «Соло»… с диапазоном тактов. */
export function sections(part: Part): { label: string; from: number; to: number }[] {
  const out: { label: string; from: number; to: number }[] = [];
  part.measures.forEach((m, i) => {
    if (m.marker) {
      if (out.length) out[out.length - 1].to = i - 1;
      out.push({ label: m.marker, from: i, to: part.measures.length - 1 });
    }
  });
  return out;
}

export function bpmAt(part: Part, measure: number): number {
  let bpm = part.tempo[0].bpm;
  for (const t of part.tempo) if (t.measure <= measure) bpm = t.bpm;
  return bpm;
}

export interface TimedBeat {
  measure: number;
  beat: number;
  time: number;
  dur: number;
}

/** Время каждой доли диапазона тактов в секундах (speed — множитель темпа). */
export function timeline(part: Part, from: number, to: number, speed = 1): TimedBeat[] {
  const out: TimedBeat[] = [];
  let t = 0;
  for (let mi = from; mi <= to; mi++) {
    const m = part.measures[mi];
    if (!m) break;
    const whole = (4 * 60) / (bpmAt(part, mi) * speed);
    m.beats.forEach((b, bi) => out.push({ measure: mi, beat: bi, time: t + b.at * whole, dur: b.dur * whole }));
    t += m.len * whole;
  }
  return out;
}

export function rangeLength(part: Part, from: number, to: number, speed = 1): number {
  let t = 0;
  for (let mi = from; mi <= to && part.measures[mi]; mi++) t += (part.measures[mi].len * 4 * 60) / (bpmAt(part, mi) * speed);
  return t;
}

/* ───────────── выбор песни и партии ───────────── */

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\(.*?\)/g, " ").replace(/[^a-zа-я0-9]+/g, " ").trim();

/** Самая похожая песня из выдачи: совпадение названия и исполнителя, затем популярность партий. */
export function bestMatch(list: SstSong[], title: string, artist: string): SstSong | null {
  const t = norm(title);
  const a = norm(artist);
  const scored = list
    .map((s) => {
      const st = norm(s.title);
      const sa = norm(s.artist);
      const titleScore = st === t ? 3 : st.startsWith(t) || t.startsWith(st) ? 2 : st.includes(t) || t.includes(st) ? 1 : 0;
      const artistScore = sa === a ? 2 : a && (sa.includes(a) || a.includes(sa)) ? 1 : 0;
      const views = s.tracks.reduce((x, tr) => x + tr.views, 0);
      return { s, score: titleScore * 10 + artistScore * 6 + Math.log10(views + 1) - (/live|концерт|cover|кавер/i.test(s.title) ? 3 : 0) };
    })
    .filter((x) => x.score >= 16)
    .sort((x, y) => y.score - x.score);
  return scored[0]?.s ?? null;
}

/** Партия по умолчанию: самая популярная гитарная, иначе первая гитарная. */
export function defaultTrack(meta: SstMeta, prefer: "lead" | "rhythm" | "any" = "any"): number {
  const guitars = meta.tracks.filter((t) => t.kind === "guitar");
  if (prefer === "rhythm") {
    const rhythm = guitars.filter((t) => /rhythm|ритм|acoustic|акуст/i.test(`${t.name} ${t.instrument}`) && !/lead|solo|лид|соло/i.test(t.name)).sort((a, b) => b.views - a.views)[0];
    if (rhythm) return rhythm.partId;
  }
  if (prefer === "lead") {
    const lead = guitars.filter((t) => /lead|solo|лид|соло/i.test(t.name)).sort((a, b) => b.views - a.views)[0];
    if (lead) return lead.partId;
  }
  if (meta.popularGuitar !== null && meta.tracks.some((t) => t.partId === meta.popularGuitar && t.kind === "guitar")) return meta.popularGuitar;
  return guitars.sort((a, b) => b.views - a.views)[0]?.partId ?? meta.tracks[0]?.partId ?? 0;
}

/** Короткое имя партии: «Юрий Каспарян | Лид-гитара | Yamaha» → «Лид-гитара». */
export function trackLabel(t: SstTrack): string {
  const parts = t.name.split("|").map((x) => x.trim()).filter(Boolean);
  const role = parts.find((p) => /гитар|guitar|бас|bass|lead|rhythm|solo|соло|ритм|лид|acoustic/i.test(p) && !/fender|gibson|yamaha|ibanez|martin|taylor|washburn|takamine|epiphone|prs|ovation/i.test(p));
  return role ?? parts[0] ?? t.instrument;
}

/* ───────────── аккорды по табам ───────────── */

const autoCache = new Map<number, Promise<AutoResult | null>>();
const partsCache = new Map<number, Promise<{ parts: Part[]; vocal: Part | null }>>();

/** Партии для вычисления аккордов: гитары, бас, клавиши (без барабанов id 1024 и вокала) + вокал. */
function chordParts(meta: SstMeta) {
  let p = partsCache.get(meta.songId);
  if (!p) {
    p = (async () => {
      const pitched = meta.tracks.filter((t) => !t.vocal && t.instrumentId < 40).sort((a, b) => b.views - a.views).slice(0, 8);
      const vocalTrack = meta.tracks.find((t) => t.vocal);
      const [parts, vocal] = await Promise.all([
        Promise.all(pitched.map((t) => loadPart(meta, t.partId).catch(() => null))),
        vocalTrack ? loadPart(meta, vocalTrack.partId).catch(() => null) : Promise.resolve(null),
      ]);
      return { parts: parts.filter((x): x is Part => !!x), vocal };
    })();
    p.catch(() => partsCache.delete(meta.songId));
    partsCache.set(meta.songId, p);
  }
  return p;
}

/** Текст с аккордами, вычисленный по партиям песни (см. lib/autochords.ts). */
export function autoChords(meta: SstMeta): Promise<AutoResult | null> {
  let p = autoCache.get(meta.songId);
  if (!p) {
    p = chordParts(meta).then(async ({ parts, vocal }) => {
      const fromTab = buildChordSheet(parts, vocal, vocal?.lyrics ?? null);
      if (!fromTab || fromTab.withLyrics) return fromTab ? { ...fromTab, lyricsSource: "таб" } : fromTab;
      // В табе слов нет — ищем в интернете и раскладываем по мелодии вокала или по времени строк.
      const ref = parts[0];
      const length = ref ? rangeLength(ref, 0, ref.measures.length - 1) : null;
      let failed = false;
      const found = await findLyrics(meta.artist, meta.title, length).catch(() => {
        failed = true;
        return null;
      });
      // Сайт со словами не ответил — не запоминаем результат без слов, в следующий раз попробуем снова.
      if (failed) queueMicrotask(() => autoCache.delete(meta.songId));
      if (!found || (!vocal && !found.synced)) return fromTab;
      const withWords = buildChordSheet(parts, vocal, null, found);
      return withWords?.withLyrics ? { ...withWords, lyricsSource: found.source } : fromTab;
    });
    p.catch(() => autoCache.delete(meta.songId));
    autoCache.set(meta.songId, p);
  }
  return p;
}

/** То же, но со своими словами: строки раскладываются по фразам вокальной мелодии. null — мелодии вокала нет. */
export async function autoChordsWithText(meta: SstMeta, text: string): Promise<AutoResult | null> {
  const { parts, vocal } = await chordParts(meta);
  if (!vocal) return null;
  return buildChordSheet(parts, vocal, null, { plain: text });
}

/** Есть ли в песне партия вокала (мелодия, по которой можно разложить слова). */
export const hasVocal = (meta: SstMeta) => meta.tracks.some((t) => t.vocal);
