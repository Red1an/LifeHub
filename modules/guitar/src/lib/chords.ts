import { CHORD_SHAPES, type ChordShape } from "./chord-shapes";
import { FLAT_NOTES, SHARP_NOTES, GUITAR_OPEN_STRINGS_MIDI } from "./music-theory";

/*
 * Аккорды: разбор любого обозначения, транспонирование, аппликатуры по всему грифу
 * (с расстановкой пальцев и баррэ) и обратная задача — название по зажатым ладам.
 * Строки в аппликатурах — от 6-й (низкая E) к 1-й, -1 — заглушена, 0 — открытая.
 */

const OPEN = GUITAR_OPEN_STRINGS_MIDI.map((m) => m % 12);
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };

export interface ChordQuality {
  /** Ступени от тоники в полутонах; 2 = нона, 5 = ундецима, 9 = терцдецима. */
  tones: number[];
  /** Можно опустить в аппликатуре (обычно квинта). */
  optional: number[];
  label: string;
}

const Q = (tones: number[], label: string, optional: number[] = tones.length >= 4 ? [7] : []): ChordQuality => ({ tones, optional, label });

/** Канонические суффиксы. Порядок важен для определения аккорда по нотам: простые раньше. */
export const QUALITIES: Record<string, ChordQuality> = {
  "": Q([0, 4, 7], "мажор"),
  m: Q([0, 3, 7], "минор"),
  "7": Q([0, 4, 7, 10], "доминантсептаккорд"),
  m7: Q([0, 3, 7, 10], "минорный септаккорд"),
  maj7: Q([0, 4, 7, 11], "большой мажорный септаккорд"),
  "5": Q([0, 7], "квинта (пауэр-аккорд)", []),
  sus2: Q([0, 2, 7], "с задержанием (секунда)"),
  sus4: Q([0, 5, 7], "с задержанием (кварта)"),
  "6": Q([0, 4, 7, 9], "мажорный секстаккорд"),
  m6: Q([0, 3, 7, 9], "минорный секстаккорд"),
  add9: Q([0, 4, 7, 2], "мажор с ноной"),
  madd9: Q([0, 3, 7, 2], "минор с ноной"),
  dim: Q([0, 3, 6], "уменьшённый", []),
  dim7: Q([0, 3, 6, 9], "уменьшённый септаккорд", []),
  m7b5: Q([0, 3, 6, 10], "полууменьшённый", []),
  aug: Q([0, 4, 8], "увеличенный", []),
  "7sus4": Q([0, 5, 7, 10], "септаккорд с квартой"),
  "9": Q([0, 4, 7, 10, 2], "нонаккорд"),
  m9: Q([0, 3, 7, 10, 2], "минорный нонаккорд"),
  maj9: Q([0, 4, 7, 11, 2], "большой мажорный нонаккорд"),
  mmaj7: Q([0, 3, 7, 11], "минор с большой септимой"),
  "7#5": Q([0, 4, 8, 10], "увеличенный септаккорд", []),
  "7b9": Q([0, 4, 7, 10, 1], "септаккорд с малой ноной"),
  "11": Q([0, 4, 7, 10, 2, 5], "ундецимаккорд", [7, 4, 2]),
  "13": Q([0, 4, 7, 10, 9], "терцдецимаккорд", [7]),
  "6/9": Q([0, 4, 7, 9, 2], "секстнонаккорд", [7]),
};

/** Разные написания одного суффикса → канонический. */
const ALIASES: Record<string, string> = {
  maj: "", M: "", major: "", min: "m", mi: "m", "-": "m", minor: "m",
  M7: "maj7", Maj7: "maj7", "Δ": "maj7", "Δ7": "maj7", ma7: "maj7", j7: "maj7", "7+": "maj7",
  min7: "m7", "-7": "m7", mi7: "m7",
  sus: "sus4", "4": "sus4", "2": "sus2", add2: "add9", "add4": "sus4",
  "°": "dim", o: "dim", "°7": "dim7", o7: "dim7",
  "ø": "m7b5", "ø7": "m7b5", "m7-5": "m7b5", "-7b5": "m7b5", "m(b5)": "dim",
  "+": "aug", "#5": "aug", "aug7": "7#5", "+7": "7#5",
  "7sus": "7sus4", "sus7": "7sus4",
  "m(maj7)": "mmaj7", mM7: "mmaj7", "m/maj7": "mmaj7",
  "m(add9)": "madd9", "(add9)": "add9", madd2: "madd9",
  "69": "6/9", "6add9": "6/9",
  "7(b9)": "7b9", "7-9": "7b9",
  maj9: "maj9", M9: "maj9",
  m11: "m7", "maj13": "maj7", m13: "m7",
};

export interface ParsedChord {
  /** Как написано (после нормализации H → B). */
  name: string;
  root: number;
  rootName: string;
  suffix: string;
  quality: ChordQuality;
  bass: number | null;
  bassName: string | null;
}

function parseNote(s: string): { pc: number; name: string; rest: string } | null {
  const m = s.match(/^([A-H])([#b♯♭]?)/);
  if (!m) return null;
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  const pc = (LETTER[m[1]] + acc + 12) % 12;
  const letter = m[1] === "H" ? "B" : m[1];
  return { pc, name: letter + (acc === 1 ? "#" : acc === -1 ? "b" : ""), rest: s.slice(m[0].length) };
}

function canonicalSuffix(raw: string): string {
  const s = raw.replace(/\s+/g, "").replace(/^\((.*)\)$/, "$1");
  if (s in QUALITIES) return s;
  if (s in ALIASES) return ALIASES[s];
  const noParens = s.replace(/[()]/g, "");
  if (noParens in QUALITIES) return noParens;
  if (noParens in ALIASES) return ALIASES[noParens];
  // Неизвестное расширение: берём основу (минор/мажор, септима).
  const minor = /^(m|min|-)(?!aj)/.test(s);
  const seventh = /7|9|11|13/.test(s);
  const maj7 = /maj7|M7|maj9/.test(s);
  if (minor) return seventh ? "m7" : "m";
  if (maj7) return "maj7";
  if (/sus2/.test(s)) return "sus2";
  if (/sus/.test(s)) return seventh ? "7sus4" : "sus4";
  if (/dim/.test(s)) return "dim";
  return seventh ? "7" : "";
}

/** Разбирает обозначение аккорда. null — это не аккорд (слово, повтор «x2» и т.п.). */
export function parseChord(input: string): ParsedChord | null {
  const raw = input.trim();
  // «6/9» — не слэш-аккорд.
  const slash = raw.match(/^(.*?[^6])\/([A-H][#b♯♭]?)$/);
  const main = slash ? slash[1] : raw;
  const root = parseNote(main);
  if (!root) return null;
  if (!/^[a-zA-Z0-9#b♯♭+\-°øΔ()/]*$/.test(root.rest)) return null;
  const suffix = canonicalSuffix(root.rest);
  let bass: number | null = null;
  let bassName: string | null = null;
  if (slash) {
    const b = parseNote(slash[2]);
    if (!b || b.rest) return null;
    if (b.pc !== root.pc) {
      bass = b.pc;
      bassName = b.name;
    }
  }
  const shownSuffix = root.rest;
  return {
    name: `${root.name}${shownSuffix}${bassName ? "/" + bassName : ""}`,
    root: root.pc,
    rootName: root.name,
    suffix,
    quality: QUALITIES[suffix],
    bass,
    bassName,
  };
}

/** Похоже ли слово на аккорд — для разбора текстов, где аккорды не размечены. */
export function looksLikeChord(token: string): boolean {
  if (!/^[A-H]/.test(token) || token.length > 12) return false;
  return /^[A-H][#b]?(m|min|maj|M|dim|aug|sus|add|°|ø|\+|-)?[0-9]{0,2}(sus[24]?|add[0-9]+|maj[0-9]*|b5|#5|b9|#9|#11|b13|\([^)]*\))*(\/[A-H][#b]?)?$/.test(token);
}

const nameOf = (pc: number, flats: boolean) => (flats ? FLAT_NOTES : SHARP_NOTES)[((pc % 12) + 12) % 12];

/** Транспонирует аккорд с сохранением написания суффикса и баса. */
export function transpose(chord: string, semitones: number, preferFlats = false): string {
  if (!semitones) return chord;
  const t = chord.trim();
  const p = parseChord(t);
  if (!p) return chord;
  const suffixPart = parseNote(t)!.rest.replace(/\/[A-H][#b♯♭]?$/, "");
  const flats = preferFlats || p.rootName.endsWith("b");
  return `${nameOf(p.root + semitones, flats)}${suffixPart}${p.bass !== null ? "/" + nameOf(p.bass + semitones, flats) : ""}`;
}

/** Ноты аккорда (названия) и ступени. */
export function chordNotes(chord: string): { names: string[]; degrees: string[] } {
  const p = parseChord(chord);
  if (!p) return { names: [], degrees: [] };
  const flats = p.rootName.includes("b");
  const DEG: Record<number, string> = { 0: "1", 1: "♭9", 2: "9", 3: "♭3", 4: "3", 5: "4", 6: "♭5", 7: "5", 8: "♯5", 9: "6", 10: "♭7", 11: "7" };
  const tones = p.quality.tones;
  return {
    names: tones.map((t) => nameOf(p.root + t, flats)),
    degrees: tones.map((t) => (t === 9 && tones.includes(10) ? "13" : t === 5 && tones.length > 5 ? "11" : DEG[t])),
  };
}

/* ───────────── аппликатуры ───────────── */

export interface Voicing extends ChordShape {
  /** Оценка удобства: меньше — проще. */
  score: number;
}

/** Пальцы и баррэ для набора ладов. null — сыграть нельзя (нужно больше 4 пальцев). */
export function fingering(frets: number[]): Pick<ChordShape, "fingers" | "barre"> | null {
  const pressed = frets.map((f, i) => ({ f, i })).filter((x) => x.f > 0);
  if (!pressed.length) return { fingers: frets.map(() => 0) };
  const minF = Math.min(...pressed.map((x) => x.f));
  const atMin = pressed.filter((x) => x.f === minF);
  let barre: ChordShape["barre"];
  // Баррэ — только когда без него не хватает пальцев или лад прижат на 3+ струнах без открытых.
  const needBarre = pressed.length > 4 || (atMin.length >= 3 && !frets.includes(0));
  if (atMin.length >= 2 && needBarre) {
    const from = atMin[0].i;
    const to = atMin[atMin.length - 1].i;
    // Баррэ лежит на всех струнах между крайними: там не должно быть открытых и заглушенных.
    let ok = true;
    for (let s = from; s <= to; s++) if (frets[s] < minF) ok = false;
    if (ok) barre = { fret: minF, fromString: from, toString: to };
  }
  const fingers = frets.map(() => 0);
  let next = 1;
  if (barre) {
    for (let s = barre.fromString; s <= barre.toString; s++) if (frets[s] === minF) fingers[s] = 1;
    next = 2;
  }
  const rest = pressed.filter((x) => fingers[x.i] === 0).sort((a, b) => a.f - b.f || a.i - b.i);
  for (const x of rest) {
    if (next > 4) return null;
    fingers[x.i] = next++;
  }
  return { fingers, barre };
}

function shapeOf(frets: number[]): ChordShape | null {
  const f = fingering(frets);
  if (!f) return null;
  const pressed = frets.filter((x) => x > 0);
  const max = pressed.length ? Math.max(...pressed) : 0;
  const min = pressed.length ? Math.min(...pressed) : 0;
  return { frets, ...f, baseFret: max <= 4 ? 1 : min };
}

const cache = new Map<string, Voicing[]>();

/** Аппликатуры аккорда по всему грифу, от самой удобной. */
export function voicings(chord: string, limit = 8): Voicing[] {
  const key = `${chord}|${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = parseChord(chord);
  if (!p) return [];
  const pcs = new Set(p.quality.tones.map((t) => (p.root + t) % 12));
  const optional = new Set(p.quality.optional.map((t) => (p.root + t) % 12));
  const required = [...pcs].filter((x) => !optional.has(x));
  const bass = p.bass ?? p.root;
  if (p.bass !== null) pcs.add(p.bass);
  const minStrings = p.suffix === "5" ? 2 : pcs.size >= 4 ? 4 : 3;

  const found = new Map<string, Voicing>();
  const consider = (frets: number[]) => {
    const k = frets.join(",");
    if (found.has(k)) return;
    const sounding = frets.map((f, i) => (f < 0 ? -1 : (OPEN[i] + f) % 12));
    const first = sounding.findIndex((x) => x >= 0);
    if (first < 0 || sounding[first] !== bass) return;
    // Глушить можно басовые струны подряд и одну верхнюю; дыр в середине не бывает.
    let last = 5;
    if (sounding[5] < 0) last = 4;
    for (let s = first; s <= last; s++) if (sounding[s] < 0) return;
    if (last < 5 && sounding[4] < 0) return;
    const count = last - first + 1;
    if (count < minStrings) return;
    const present = new Set(sounding.filter((x) => x >= 0));
    if (!required.every((x) => present.has(x))) return;
    const shape = shapeOf(frets);
    if (!shape) return;
    const pressed = frets.filter((x) => x > 0);
    const pos = pressed.length ? Math.min(...pressed) : 0;
    const span = pressed.length ? Math.max(...pressed) - pos : 0;
    const opens = frets.filter((x) => x === 0).length;
    const fingersUsed = new Set(shape.fingers!.filter((x) => x > 0)).size;
    // Открытая струна между зажатыми при аппликатуре выше 2-го лада — неудобно и звучит «дырявым».
    let innerOpens = 0;
    const firstPressed = frets.findIndex((x) => x > 0);
    const lastPressed = 5 - [...frets].reverse().findIndex((x) => x > 0);
    for (let s = firstPressed + 1; s < lastPressed; s++) if (frets[s] === 0) innerOpens++;
    const maxFret = pressed.length ? Math.max(...pressed) : 0;
    const score =
      pos * 0.9 + fingersUsed * 0.7 + span * 0.5 + (shape.barre ? 0.8 : 0) + (6 - count) * 0.6 - (pos <= 3 ? opens * 0.35 : 0) +
      (maxFret >= 3 ? innerOpens * 1.3 : 0) + (present.size < pcs.size ? 0.8 : 0);
    found.set(k, { ...shape, score });
  };

  for (let w = 0; w <= 12; w++) {
    const options = OPEN.map((open) => {
      const o: number[] = [-1];
      if (pcs.has(open)) o.push(0);
      for (let f = Math.max(1, w); f <= w + 3; f++) if (pcs.has((open + f) % 12)) o.push(f);
      return o;
    });
    const cur: number[] = [];
    const walk = (s: number) => {
      if (s === 6) return consider([...cur]);
      for (const f of options[s]) {
        cur.push(f);
        walk(s + 1);
        cur.pop();
      }
    };
    walk(0);
  }

  let list = [...found.values()].sort((a, b) => a.score - b.score);
  // Убираем «урезанные» копии: те же лады, но заглушено больше струн.
  list = list.filter((v, i) => !list.slice(0, i).some((u) => u.frets.every((f, s) => v.frets[s] === -1 || f === v.frets[s])));
  // Не показываем пять почти одинаковых вариантов в одной позиции.
  const out: Voicing[] = [];
  const hand = handShape(p);
  if (hand) out.push(hand);
  for (const v of list) {
    if (out.length >= limit) break;
    if (out.some((u) => u.frets.join() === v.frets.join())) continue;
    const pos = (x: Voicing) => Math.min(...x.frets.filter((f) => f > 0).concat(99));
    if (out.filter((u) => Math.abs(pos(u) - pos(v)) <= 1).length >= 2) continue;
    out.push(v);
  }
  cache.set(key, out);
  return out;
}

/** Как их играет большинство гитаристов: от 6-й струны к 1-й, x — заглушена. */
const STANDARD: Record<string, string> = {
  Cm: "x35543", "C#": "x46664", "C#m": "x46654", "C#m7": "x46454", Dm7: "xx0211", Dmaj7: "xx0222", Eb: "x68886", Ebm: "x68876",
  Em7: "020000", E7: "020100", Fm: "133111", "F#": "244322", "F#m": "244222", "F#m7": "242222", "F#7": "242322", Gm: "355333",
  Gmaj7: "320002", "G#": "466544", "G#m": "466444", Ab: "466544", Abm: "466444", Am7: "x02010", Amaj7: "x02120", Bb: "x13331",
  Bbm: "x13321", "A#": "x13331", "A#m": "x13321", Bm7: "x20202", B: "x24442", Cadd9: "x32033", Asus4: "x02230", Esus4: "022200",
  Em: "022000", Am: "x02210", "D/F#": "200232", "C/G": "332010", "G/B": "x20033", "C/B": "x20010", "Am/G": "302210", "C/E": "032010",
  "F/C": "x33211", "D/A": "x00232", E5: "022xxx", A5: "x022xx", D5: "xx023x", G5: "355xxx", F5: "133xxx", C5: "x355xx", B5: "x244xx",
  Dm: "xx0231", A7: "x02020", D7: "xx0212", C7: "x32310", B7: "x21202", G7: "320001", Edim: "xx2323", Bdim: "x2343x",
};

/** Классические аппликатуры, записанные руками, — они всегда первые. */
function handShape(p: ParsedChord): Voicing | null {
  const tail = p.bassName ? `/${SHARP_NOTES[p.bass!]}` : "";
  const tailFlat = p.bassName ? `/${FLAT_NOTES[p.bass!]}` : "";
  const names = [`${SHARP_NOTES[p.root]}${p.suffix}${tail}`, `${FLAT_NOTES[p.root]}${p.suffix}${tailFlat}`];
  for (const n of names) {
    const std = STANDARD[n];
    if (std) {
      const frets = [...std].map((c) => (c === "x" ? -1 : Number(c)));
      const shape = shapeOf(frets);
      if (shape) return { ...shape, score: -1 };
    }
    const s = CHORD_SHAPES[n];
    if (s && !tail) return { ...s, score: -1 };
  }
  return null;
}

/** Первая (самая удобная) аппликатура или null. */
export function bestShape(chord: string): ChordShape | null {
  return voicings(chord, 1)[0] ?? null;
}

/** Есть ли у аккорда удобная аппликатура без баррэ в первой позиции. */
export function isEasy(chord: string): boolean {
  const v = voicings(chord, 3);
  return v.some((x) => !x.barre && Math.max(...x.frets) <= 4);
}

/* ───────────── аккорд по ладам ───────────── */

/** Названия аккорда по зажатым ладам (от самого вероятного). */
export function identify(frets: number[]): string[] {
  const sounding = frets.map((f, i) => (f < 0 ? -1 : (OPEN[i] + f) % 12)).filter((x) => x >= 0);
  if (sounding.length < 2) return [];
  const set = new Set(sounding);
  const bass = sounding[0];
  const results: { name: string; score: number }[] = [];
  for (const root of set) {
    for (const [suffix, q] of Object.entries(QUALITIES)) {
      const pcs = q.tones.map((t) => (root + t) % 12);
      const all = new Set(pcs);
      const needed = pcs.filter((x, i) => !q.optional.includes(q.tones[i]));
      if (![...set].every((x) => all.has(x) || x === bass)) continue;
      if (!needed.every((x) => set.has(x))) continue;
      const extraBass = !all.has(bass);
      const slash = bass !== root;
      const name = `${SHARP_NOTES[root]}${suffix}${slash ? "/" + SHARP_NOTES[bass] : ""}`;
      const score = (slash ? 2 : 0) + (extraBass ? 1 : 0) + q.tones.length * 0.3 + Object.keys(QUALITIES).indexOf(suffix) * 0.02;
      results.push({ name, score });
    }
  }
  return [...new Set(results.sort((a, b) => a.score - b.score).map((r) => r.name))].slice(0, 4);
}

/** midi-ноты аппликатуры (для проигрывания и проверки). */
export function shapeMidis(frets: number[]): number[] {
  return frets.flatMap((f, i) => (f < 0 ? [] : [GUITAR_OPEN_STRINGS_MIDI[i] + f]));
}

export const ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const SUFFIX_GROUPS: { title: string; items: string[] }[] = [
  { title: "Основные", items: ["", "m", "7", "m7", "maj7", "5"] },
  { title: "Задержания и добавленные", items: ["sus2", "sus4", "7sus4", "add9", "madd9", "6", "m6"] },
  { title: "Джаз и цвет", items: ["9", "m9", "maj9", "6/9", "13", "7b9", "mmaj7"] },
  { title: "Напряжённые", items: ["dim", "dim7", "m7b5", "aug", "7#5"] },
];
