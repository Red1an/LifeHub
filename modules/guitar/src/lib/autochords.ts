import { FLAT_NOTES, SHARP_NOTES } from "./music-theory";
import type { Part } from "./songsterr";

/*
 * Аккорды там, где их нет: вычисляем по табам Songsterr.
 *  1. По каждой половине такта собираем ноты всех инструментов (гитары, бас, клавиши) с весом по длительности
 *     и самую низкую ноту — бас.
 *  2. Тональность песни — по профилям Крумхансла; аккорд — лучшее совпадение с шаблонами, с бонусом за бас
 *     и за аккорды своей тональности.
 *  3. Слова вокальной партии (по слогам, привязаны к спетым нотам) раскладываем по времени и ставим
 *     аккорд над слогом, на котором он сменился. Нет слов — сетка по тактам.
 * Результат — текст в формате UG ([ch]…[/ch] над словами, [Секция]), его показывает обычный Sheet.
 */

interface Segment {
  measure: number;
  at: number; // доля целой от начала такта
  hist: Float32Array;
  low: number | null; // midi самой низкой ноты
}

const QUALITIES: { suffix: string; tones: number[]; penalty: number }[] = [
  { suffix: "", tones: [0, 4, 7], penalty: 0 },
  { suffix: "m", tones: [0, 3, 7], penalty: 0 },
  { suffix: "7", tones: [0, 4, 7, 10], penalty: 0.04 },
  { suffix: "m7", tones: [0, 3, 7, 10], penalty: 0.04 },
  // Квинта без терции — пауэр-аккорд (рок, метал). Берём, только если терции почти не слышно.
  { suffix: "5", tones: [0, 7], penalty: 0.02 },
];

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / 12;
  const mb = b.reduce((s, x) => s + x, 0) / 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function detectKey(hist: ArrayLike<number>): { root: number; minor: boolean } {
  let best = { root: 0, minor: false, r: -2 };
  for (let root = 0; root < 12; root++) {
    const rot = Array.from({ length: 12 }, (_, i) => hist[(i + root) % 12]);
    const rM = corr(rot, MAJOR_PROFILE);
    const rm = corr(rot, MINOR_PROFILE);
    if (rM > best.r) best = { root, minor: false, r: rM };
    if (rm > best.r) best = { root, minor: true, r: rm };
  }
  return { root: best.root, minor: best.minor };
}

/** Аккорды своей тональности: «корень → допустимые качества». */
function diatonic(key: { root: number; minor: boolean }) {
  const map = new Map<number, string[]>();
  const steps = key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const quals = key.minor ? ["m", "dim", "", "m", "m", "", ""] : ["", "m", "m", "", "", "m", "dim"];
  steps.forEach((s, i) => map.set((key.root + s) % 12, [quals[i]]));
  // В миноре почти всегда мажорная доминанта (E в ля миноре).
  if (key.minor) map.set((key.root + 7) % 12, ["m", ""]);
  return map;
}

function chordFor(hist: Float32Array, low: number | null, dia: Map<number, string[]>) {
  let total = 0;
  for (let i = 0; i < 12; i++) total += hist[i];
  if (total < 1e-6) return null;
  const bass = low === null ? null : low % 12;
  let best: { root: number; suffix: string; score: number } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      // Косинус между нотами отрезка и шаблоном аккорда (тоника весит чуть больше).
      let dot = 0;
      let nt = 0;
      for (const t of q.tones) {
        const w = t === 0 ? 1.2 : 1;
        dot += hist[(root + t) % 12] * w;
        nt += w * w;
      }
      let nh = 0;
      for (let i = 0; i < 12; i++) nh += hist[i] * hist[i];
      let score = dot / Math.sqrt(nt * nh) - q.penalty;
      if (q.suffix === "5") {
        const third = Math.max(hist[(root + 3) % 12], hist[(root + 4) % 12]);
        if (third > 0.25 * hist[root]) score -= 0.2;
      }
      if (bass === root) score += 0.12;
      const d = dia.get(root);
      const base = q.suffix.startsWith("m") && !q.suffix.startsWith("maj") ? "m" : q.suffix === "dim" ? "dim" : "";
      if (d && d.includes(base)) score += 0.06;
      if (!best || score > best.score) best = { root, suffix: q.suffix, score };
    }
  }
  return best;
}

const instrumentPart = (p: Part) => p.strings > 0 && p.measures.length > 0;

/** Отрезки (по половине такта для 4/4, по такту для 3/4 и 6/8) с нотами всех инструментов. */
let polyWeight = 0;
let monoWeight = 0;

function segments(parts: Part[]): Segment[] {
  polyWeight = 0;
  monoWeight = 0;
  const ref = parts[0];
  const out: Segment[] = [];
  ref.measures.forEach((m, mi) => {
    const len = m.len;
    const halves = m.sig[0] === 4 && m.sig[1] === 4 ? 2 : 1;
    for (let h = 0; h < halves; h++) {
      const from = (h * len) / halves;
      const to = ((h + 1) * len) / halves;
      const hist = new Float32Array(12);
      let low: number | null = null;
      for (const p of parts) {
        const pm = p.measures[mi];
        if (!pm) continue;
        for (const b of pm.beats) {
          if (b.rest || b.grace) continue;
          const s = Math.max(from, b.at);
          const e = Math.min(to, b.at + b.dur);
          // Нота, которая звучит в отрезке (или началась раньше и тянется).
          const w = e > s ? e - s : 0;
          if (w <= 0) continue;
          // Аккорд (2+ звука вместе) и бас определяют гармонию; одиночные ноты рифа или мелодии — почти нет.
          const sounding = b.notes.filter((n) => !n.dead && !n.ghost);
          const isBass = Math.max(...p.tuning) < 50;
          const k = isBass ? 0.9 : sounding.length >= 3 ? 1.5 : sounding.length === 2 ? 1 : 0.2;
          if (!isBass && sounding.length) sounding.length >= 2 ? (polyWeight += w) : (monoWeight += w);
          for (const n of sounding) {
            const midi = p.tuning[n.string] + n.fret;
            if (!Number.isFinite(midi)) continue;
            hist[midi % 12] += w * k * (midi < 52 ? 1.3 : 1);
            if ((isBass || sounding.length >= 2) && (low === null || midi < low)) low = midi;
          }
        }
      }
      out.push({ measure: mi, at: from, hist, low });
    }
  });
  return out;
}

/** Подряд повторяющиеся блоки из 1, 2 или 4 строк сетки — один раз и «×N». */
function compressRepeats(lines: string[]) {
  for (let i = 0; i < lines.length; i++) {
    for (const p of [1, 2, 4]) {
      const block = lines.slice(i, i + p);
      if (block.length < p || block.some((l) => !l.includes("[ch]"))) continue;
      let n = 1;
      while (lines.slice(i + n * p, i + (n + 1) * p).join("|") === block.join("|")) n++;
      if (n > 1) {
        lines.splice(i + p, (n - 1) * p);
        lines[i + p - 1] += `  ×${n}`;
        if (p > 1) lines.splice(i, 0, "");
        i += p;
        break;
      }
    }
  }
}

interface ChordEvent {
  measure: number;
  at: number;
  name: string | null;
}

export interface AutoResult {
  body: string;
  key: string;
  chords: string[];
  withLyrics: boolean;
  /** Песня на рифах (одиночные ноты, мало аккордов) — аккорды условные. */
  riffy: boolean;
  /** Откуда слова: таб, интернет (LRCLIB) или свои. */
  lyricsSource?: string;
}

/* ───────────── слова ───────────── */

interface Syllable {
  /** Перед строкой — пауза (новый куплет): пустая строка. */
  stanza?: boolean;
  text: string;
  newWord: boolean;
  newLine: boolean;
  measure: number;
  at: number;
}

function syllablesOf(vocal: Part, lyrics: { offset: number; text: string }[]): Syllable[] {
  const text = lyrics.map((l) => l.text).join("\n");
  const tokens: { text: string; newWord: boolean; newLine: boolean }[] = [];
  let newLine = false;
  for (const lineRaw of text.split("\n")) {
    const words = lineRaw.trim().split(/\s+/).filter(Boolean);
    words.forEach((w, wi) => {
      const parts = w.split("-").filter((x) => x !== "");
      parts.forEach((p, pi) => tokens.push({ text: p, newWord: pi === 0, newLine: newLine && wi === 0 && pi === 0 }));
    });
    newLine = true;
  }
  const start = Math.max(0, (lyrics[0]?.offset ?? 1) - 1);
  const out: Syllable[] = [];
  let ti = 0;
  for (let mi = start; mi < vocal.measures.length && ti < tokens.length; mi++) {
    for (const b of vocal.measures[mi].beats) {
      if (b.rest || b.grace || !b.notes.length || b.notes.every((n) => n.tie)) continue;
      const t = tokens[ti++];
      if (!t) break;
      out.push({ ...t, measure: mi, at: b.at });
    }
  }
  return out;
}


/* ───────────── свои слова: разложить по вокальной мелодии ───────────── */

const VOWELS = /[аеёиоуыэюяaeiouy]/i;

/** Слоги слова — по гласным (для сопоставления с нотами важно их число, а не точный перенос). */
export function syllabify(word: string): string[] {
  const idx = [...word].map((c, i) => (VOWELS.test(c) ? i : -1)).filter((i) => i >= 0);
  if (idx.length <= 1) return [word];
  const out: string[] = [];
  let start = 0;
  for (let k = 0; k < idx.length - 1; k++) {
    const gap = idx[k + 1] - idx[k] - 1; // согласных между гласными
    const cut = idx[k] + 1 + Math.max(0, gap - 1); // последняя согласная уходит в следующий слог
    out.push(word.slice(start, cut));
    start = cut;
  }
  out.push(word.slice(start));
  return out.filter(Boolean);
}

/**
 * Свои слова (без привязки ко времени) → слоги на ноты вокала. Мелодия делится на фразы по паузам
 * (от четверти), каждая строка текста — на свою фразу; внутри фразы слоги распределяются по нотам.
 */
function looseSyllables(vocal: Part, text: string): Syllable[] {
  const notes: { measure: number; at: number }[][] = [];
  let phrase: { measure: number; at: number }[] = [];
  let lastEnd: number | null = null;
  vocal.measures.forEach((m, mi) => {
    const base = mi * 4; // грубое абсолютное время в целых нотах
    for (const b of m.beats) {
      const sung = !b.rest && !b.grace && b.notes.length && !b.notes.every((n) => n.tie);
      if (!sung) continue;
      const t = base + b.at;
      if (lastEnd !== null && t - lastEnd >= 0.25 && phrase.length) {
        notes.push(phrase);
        phrase = [];
      }
      phrase.push({ measure: mi, at: b.at });
      lastEnd = t + b.dur;
    }
  });
  if (phrase.length) notes.push(phrase);
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
  const out: Syllable[] = [];
  let pi = 0;
  for (const line of lines) {
    if (pi >= notes.length) break;
    const sylls = line.split(/\s+/).flatMap((w) => syllabify(w).map((x, i) => ({ text: x, newWord: i === 0 })));
    // Короткая фраза и длинная строка — строка может занимать несколько фраз подряд.
    let ph = notes[pi++];
    while (ph.length < sylls.length * 0.6 && pi < notes.length) ph = [...ph, ...notes[pi++]];
    sylls.forEach((sy, k) => {
      const at = ph[Math.min(ph.length - 1, Math.floor((k * ph.length) / sylls.length))];
      out.push({ text: sy.text, newWord: sy.newWord, newLine: k === 0 && out.length > 0, measure: at.measure, at: at.at });
    });
  }
  return out;
}

/**
 * Слова со временем строк (LRC) → слоги по тактам таба: время переводим в такты по темпу партии,
 * длину песни подгоняем под длину записи (если версии отличаются не больше чем на 15%),
 * слоги строки распределяем равномерно (не дольше ~0.45 с на слог).
 */
function timedSyllables(ref: Part, synced: { t: number; text: string }[], duration: number | null): Syllable[] {
  const starts: number[] = [];
  const whole: number[] = [];
  let t = 0;
  ref.measures.forEach((m, mi) => {
    let bpm = ref.tempo[0]?.bpm ?? 100;
    for (const x of ref.tempo) if (x.measure <= mi) bpm = x.bpm;
    starts.push(t);
    whole.push((4 * 60) / bpm);
    t += m.len * whole[mi];
  });
  const total = t;
  const ratio = duration ? total / duration : 1;
  const k = ratio > 0.85 && ratio < 1.15 ? ratio : 1;
  const toPos = (sec: number) => {
    let mi = 0;
    while (mi + 1 < starts.length && starts[mi + 1] <= sec) mi++;
    return { measure: mi, at: Math.max(0, (sec - starts[mi]) / whole[mi]) };
  };
  const out: Syllable[] = [];
  synced.forEach((line, li) => {
    const start = line.t * k;
    if (start >= total) return;
    const sylls = line.text.split(/\s+/).filter(Boolean).flatMap((w) => syllabify(w).map((x, i) => ({ text: x, newWord: i === 0 })));
    const next = synced[li + 1] ? synced[li + 1].t * k : start + sylls.length * 0.45;
    const span = Math.min(next - start, sylls.length * 0.45) * 0.92;
    sylls.forEach((sy, j) => {
      const pos = toPos(start + (span * j) / Math.max(1, sylls.length));
      const gap = li > 0 ? line.t - synced[li - 1].t : 0;
      out.push({ text: sy.text, newWord: sy.newWord, newLine: j === 0 && out.length > 0, stanza: j === 0 && gap > 9, ...pos });
    });
  });
  return out;
}

const before = (a: { measure: number; at: number }, b: { measure: number; at: number }) => a.measure < b.measure || (a.measure === b.measure && a.at <= b.at + 1e-6);

/* ───────────── сборка ───────────── */

export function buildChordSheet(
  instruments: Part[],
  vocal: Part | null,
  lyrics: { offset: number; text: string }[] | null,
  /** Слова не из таба (свои или из интернета): по фразам вокальной мелодии или по времени строк. */
  external?: { plain: string; synced?: { t: number; text: string }[] | null; duration?: number | null },
): AutoResult | null {
  const parts = instruments.filter(instrumentPart);
  if (!parts.length) return null;
  const segs = segments(parts);
  const total = new Float32Array(12);
  for (const s of segs) for (let i = 0; i < 12; i++) total[i] += s.hist[i];
  const key = detectKey(total);
  const dia = diatonic(key);
  const flats = key.minor ? [2, 7, 0, 5, 10, 3].includes(key.root) : [5, 10, 3, 8, 1, 6].includes(key.root);
  const names = flats ? FLAT_NOTES : SHARP_NOTES;

  // Аккорд на такт; делим такт пополам, только если половина явно звучит по-другому.
  const name = (c: { root: number; suffix: string } | null) => (c ? `${names[c.root]}${c.suffix}` : null);
  const raw: (string | null)[] = new Array(segs.length).fill(null);
  const byMeasure = new Map<number, number[]>();
  segs.forEach((sg, i) => byMeasure.set(sg.measure, [...(byMeasure.get(sg.measure) ?? []), i]));
  for (const idx of byMeasure.values()) {
    const sum = new Float32Array(12);
    let low: number | null = null;
    for (const i of idx) {
      for (let k = 0; k < 12; k++) sum[k] += segs[i].hist[k];
      if (segs[i].low !== null && (low === null || segs[i].low! < low)) low = segs[i].low;
    }
    const whole = chordFor(sum, low, dia);
    const halves = idx.map((i) => chordFor(segs[i].hist, segs[i].low, dia));
    const split = idx.length === 2 && halves[0] && halves[1] && name(halves[0]) !== name(halves[1]) && halves[0].score > 0.82 && halves[1].score > 0.82;
    idx.forEach((i, h) => (raw[i] = split ? name(halves[h]) : name(whole)));
  }
  // В песне в основном обычные аккорды — «квинты» это тот же аккорд без терции: берём аккорд тональности.
  const fives = raw.filter((x) => x?.endsWith("5")).length;
  if (fives < 0.4 * raw.filter(Boolean).length) {
    for (let i = 0; i < raw.length; i++) {
      const n = raw[i];
      if (!n?.endsWith("5")) continue;
      const root = names.indexOf(n.slice(0, -1) as never);
      const q = dia.get(root)?.[0];
      raw[i] = q !== undefined && q !== "dim" ? `${names[root]}${q}` : (raw[i - 1] ?? raw[i + 1] ?? n);
    }
  }
  // Чужой тональности аккорд на полтакта — проходящий бас или нота: берём соседний.
  const inKey = (n: string | null) => {
    if (!n) return true;
    const root = names.indexOf(n.replace(/(m7|m|7|5)$/, "") as never);
    return root < 0 || dia.has(root);
  };
  for (let i = 0; i < raw.length; i++) {
    if (!raw[i] || inKey(raw[i])) continue;
    const short = raw[i - 1] !== raw[i] && raw[i + 1] !== raw[i];
    if (short) raw[i] = raw[i + 1] ?? raw[i - 1] ?? raw[i];
  }

  const events: ChordEvent[] = [];
  raw.forEach((name, i) => {
    const last = events[events.length - 1];
    if (!last || last.name !== name) events.push({ measure: segs[i].measure, at: segs[i].at, name });
  });
  const keyName = `${names[key.root]}${key.minor ? "m" : ""}`;
  const chordList = [...new Set(events.map((e) => e.name).filter((x): x is string => !!x))];
  const markers = new Map(parts[0].measures.flatMap((m) => (m.marker ? [[m.index, m.marker] as const] : [])));

  const tabLyrics = lyrics?.some((l) => l.text.trim()) ? lyrics : null;
  const syl =
    vocal && tabLyrics
      ? syllablesOf(vocal, tabLyrics)
      : external && vocal
        ? looseSyllables(vocal, external.plain)
        : external?.synced?.length
          ? timedSyllables(parts[0], external.synced, external.duration ?? null)
          : [];
  const lines: string[] = [];

  if (syl.length < 8) {
    // Без слов: сетка по 4 такта в строке, у каждого такта своя колонка (как такты в нотах).
    const CELL = 8;
    let row: (string | null)[][] = [];
    const flush = () => {
      if (row.some((c) => c.some(Boolean))) {
        let vis = "";
        let out = "";
        row.forEach((cell, ci) => {
          cell.forEach((c, k) => {
            if (!c) return;
            const col = Math.max(ci * CELL + k * 4, vis.length ? vis.length + 1 : 0);
            out += " ".repeat(col - vis.length) + `[ch]${c}[/ch]`;
            vis = vis.padEnd(col, " ") + c;
          });
        });
        lines.push(out);
      }
      row = [];
    };
    parts[0].measures.forEach((m, mi) => {
      if (markers.has(mi)) {
        flush();
        lines.push("", `[${markers.get(mi)}]`);
      }
      row.push([...new Set(raw.filter((_, i) => segs[i].measure === mi))]);
      if (row.length === 4) flush();
    });
    flush();
    compressRepeats(lines);
    return { body: lines.join("\n").trim(), key: keyName, chords: chordList, withLyrics: false, riffy: polyWeight < 0.35 * (polyWeight + monoWeight) };
  }

  // Со словами: идём по времени, собираем строку слов и аккорды над слогами.
  let lyric = "";
  let chordsAt: { col: number; name: string }[] = [];
  let pending: string[] = []; // аккорды между строками (проигрыш)
  let lastSylTime: { measure: number; at: number } | null = null;
  let ei = 0;
  let si = 0;

  const flushLine = () => {
    if (!lyric) return;
    // Видимые колонки: разметка [ch] не занимает места, поэтому собираем строку заново по позициям.
    let vis = "";
    let out = "";
    for (const c of chordsAt) {
      const col = Math.max(c.col, vis.length ? vis.length + 1 : 0);
      out += " ".repeat(col - vis.length) + `[ch]${c.name}[/ch]`;
      vis = vis.padEnd(col, " ") + c.name;
    }
    if (headerBefore) {
      lines.push("", `[${headerBefore}]`);
      headerBefore = null;
    }
    if (out) lines.push(out);
    lines.push(lyric);
    lyric = "";
    lineStart = null;
    chordsAt = [];
  };
  const flushPending = () => {
    if (pending.length) lines.push(pending.map((c) => `[ch]${c}[/ch]`).join("   "));
    pending = [];
  };
  let lastMarker = -1;
  let pendingSection: string | null = null;
  let headerBefore: string | null = null;
  let lineStart: number | null = null;
  const sectionAt = (measure: number) => {
    for (let m = measure; m > lastMarker; m--) {
      if (markers.has(m)) {
        lastMarker = measure;
        return markers.get(m)!;
      }
    }
    return null;
  };

  while (ei < events.length || si < syl.length) {
    const e = events[ei];
    const s = syl[si];
    const eventFirst = e && (!s || before(e, s));
    const t = eventFirst ? e : s;
    const sec = sectionAt(t.measure);
    // Часть началась, когда строка только запета (затакт) — заголовок встаёт перед этой строкой.
    if (sec && lyric && lineStart !== null && t.measure - lineStart <= 1) headerBefore = sec;
    else if (sec) pendingSection = sec;
    // Заголовок части ставим на границе строки: первое слово часто спето чуть раньше начала такта.
    const atBoundary = !lyric || (!eventFirst && s.newLine) || (eventFirst && !(syl[si] && syl[si].measure - e.measure <= 1 && !syl[si].newLine));
    if (pendingSection && atBoundary) {
      flushLine();
      flushPending();
      lines.push("", `[${pendingSection}]`);
      pendingSection = null;
    }
    if (eventFirst) {
      ei++;
      if (!e.name) continue;
      // Аккорд в середине строки — над следующим слогом; если давно не пели (больше такта) — это проигрыш.
      const gap = lastSylTime ? e.measure - lastSylTime.measure : 99;
      const nextSyl = syl[si];
      const soonSung = nextSyl && nextSyl.measure - e.measure <= 1;
      if (lyric && gap <= 1 && soonSung && !nextSyl.newLine) chordsAt.push({ col: lyric.length + (nextSyl.newWord ? 1 : 0), name: e.name });
      else if (soonSung && (!lyric || nextSyl.newLine)) {
        // Аккорд перед новой строкой — встаёт в её начало.
        flushLine();
        chordsAt.push({ col: 0, name: e.name });
      }
      else {
        flushLine();
        if (pending.length >= 8) flushPending();
        pending.push(e.name);
      }
    } else {
      si++;
      if (s.newLine && lyric) flushLine();
      if (s.stanza && lines.length && lines[lines.length - 1] !== "") lines.push("");
      if (!lyric) flushPending();
      if (lyric && s.newWord) lyric += " ";
      if (!lyric) lineStart = s.measure;
      lyric += s.text;
      lastSylTime = s;
    }
  }
  flushLine();
  flushPending();
  return { body: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), key: keyName, chords: chordList, withLyrics: true, riffy: polyWeight < 0.35 * (polyWeight + monoWeight) };
}
