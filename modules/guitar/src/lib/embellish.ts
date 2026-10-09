import type { ChordShape } from "./chord-shapes";
import { bestShape, fingering, identify, parseChord, voicings } from "./chords";
import { GUITAR_OPEN_STRINGS_MIDI, SHARP_NOTES } from "./music-theory";
import type { Part } from "./songsterr";

/*
 * «Фишки»: как сыграть аккорды песни интереснее.
 *  - аппликатуры из оригинала (ритм-партия Songsterr): что на самом деле зажимает гитарист;
 *  - украшения — соседние аккорды (sus, add9, септ…), которые ставятся одним пальцем от основной формы;
 *  - басовые переходы между аккордами.
 */

export interface Variant {
  name: string;
  shape: ChordShape;
  /** Что это даёт на слух и как применять. */
  how: string;
  /** Сколько пальцев переставить от основной формы. */
  moves: number;
}

const IDEAS: Record<"major" | "minor" | "dom", { suffix: string; how: string }[]> = {
  major: [
    { suffix: "sus4", how: "Добавь палец на долю и убери обратно — аккорд «оживает». Классика акустики." },
    { suffix: "sus2", how: "Убери терцию — звучит открыто и воздушно; хорошо в начале фразы." },
    { suffix: "add9", how: "Нона сверху — светлее и «дороже» звучание, особенно перебором." },
    { suffix: "maj7", how: "Мягкий, мечтательный цвет — для спокойных мест." },
    { suffix: "6", how: "Ретро-краска, приятно чередовать с основным аккордом." },
  ],
  minor: [
    { suffix: "m7", how: "Мягче и теплее обычного минора — подходит почти всегда." },
    { suffix: "madd9", how: "Красивое напряжение в миноре — меланхолично и современно." },
    { suffix: "sus4", how: "Подвешенный звук: сыграй на долю и вернись в минор." },
    { suffix: "sus2", how: "Ни мажор, ни минор — открытый «звенящий» вариант." },
    { suffix: "m6", how: "Таинственный цвет — для проигрышей и концовок." },
  ],
  dom: [
    { suffix: "7sus4", how: "Сыграй перед септаккордом — сильнее тянет к следующему." },
    { suffix: "9", how: "Фанковый, «жирный» септаккорд." },
    { suffix: "", how: "Без септимы — проще и чище." },
  ],
};

function distance(a: number[], b: number[]) {
  let d = 0;
  for (let i = 0; i < 6; i++) {
    if (a[i] === b[i]) continue;
    d += a[i] < 0 || b[i] < 0 ? 1.5 : Math.abs(a[i] - b[i]) > 2 ? 3 : 1;
  }
  return d;
}

/** Украшения аккорда, которые близко к его основной аппликатуре. */
export function variantsFor(chord: string, base: ChordShape | null = bestShape(chord)): Variant[] {
  const p = parseChord(chord);
  if (!p || !base) return [];
  const kind = p.suffix === "7" ? "dom" : p.suffix.startsWith("m") && !p.suffix.startsWith("maj") ? "minor" : p.suffix === "" ? "major" : null;
  if (!kind) return [];
  const root = p.rootName;
  const out: Variant[] = [];
  for (const idea of IDEAS[kind]) {
    const name = root + idea.suffix;
    let best: { shape: ChordShape; d: number } | null = null;
    for (const v of voicings(name, 12)) {
      const d = distance(v.frets, base.frets);
      if (!best || d < best.d) best = { shape: v, d };
    }
    if (best && best.d <= 3) out.push({ name, shape: best.shape, how: idea.how, moves: Math.ceil(best.d) });
  }
  return out.sort((a, b) => a.moves - b.moves).slice(0, 4);
}

/* ───────────── аппликатуры из оригинала ───────────── */

export interface OriginalShape {
  frets: number[];
  shape: ChordShape;
  name: string;
  count: number;
  /** Где встречается: «Куплет», «Припев»… */
  where: string[];
}

/** Аккорды, которые реально зажимает гитарист в партии (3+ звучащие струны). */
export function originalShapes(part: Part): OriginalShape[] {
  // Только стандартный строй: иначе лады не совпадут с привычными аппликатурами.
  if (part.strings !== 6 || part.tuning.slice().reverse().some((t, i) => t !== GUITAR_OPEN_STRINGS_MIDI[i])) return [];
  const map = new Map<string, OriginalShape>();
  let section = "";
  for (const m of part.measures) {
    if (m.marker) section = m.marker.replace(/^\d+-?й\s*/i, "");
    for (const b of m.beats) {
      const ns = b.notes.filter((n) => !n.dead && !n.tie);
      if (ns.length < 3 || ns.every((n) => n.fret === 0)) continue;
      // Струна 0 у Songsterr — тонкая; у нас аппликатура от толстой.
      const frets = [-1, -1, -1, -1, -1, -1];
      for (const n of ns) if (n.string < 6) frets[5 - n.string] = n.fret;
      const k = frets.join(",");
      const cur = map.get(k);
      if (cur) {
        cur.count++;
        if (section && !cur.where.includes(section)) cur.where.push(section);
        continue;
      }
      const f = fingering(frets);
      if (!f) continue;
      const pressed = frets.filter((x) => x > 0);
      const max = pressed.length ? Math.max(...pressed) : 0;
      map.set(k, { frets, shape: { frets, ...f, baseFret: max <= 4 ? 1 : Math.min(...pressed) }, name: identify(frets)[0] ?? "?", count: 1, where: section ? [section] : [] });
    }
  }
  return [...map.values()].filter((s) => s.count >= 2).sort((a, b) => b.count - a.count).slice(0, 12);
}

/** Отличается ли оригинальная форма от «обычной» аппликатуры этого аккорда. */
export function isSpecial(s: OriginalShape): boolean {
  const plain = s.name !== "?" ? bestShape(s.name.replace(/\/.*$/, "")) : null;
  if (!plain) return true;
  return plain.frets.join() !== s.frets.join() || /add|sus|7|6|9|\//.test(s.name);
}

/* ───────────── басовые переходы ───────────── */

export interface BassWalk {
  from: string;
  to: string;
  /** Ноты перехода: струна (0 — 6-я), лад, название. */
  notes: { string: number; fret: number; name: string }[];
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Позиция басовой ноты на 6-й/5-й/4-й струне в пределах первых ладов. */
function posOf(midi: number): { string: number; fret: number } {
  if (midi < 45) return { string: 0, fret: midi - 40 };
  if (midi < 50 || midi - 45 <= 4) return { string: 1, fret: midi - 45 };
  return { string: 2, fret: midi - 50 };
}

/** Проходящие басовые ноты между соседними аккордами (по гамме тональности). */
export function bassWalks(progression: string[], key: string | null): BassWalk[] {
  const k = key ? parseChord(key) : null;
  const tonic = k?.root ?? parseChord(progression[0] ?? "")?.root ?? 0;
  const minor = k ? k.suffix.startsWith("m") && !k.suffix.startsWith("maj") : false;
  const scale = (minor ? MINOR : MAJOR).map((x) => (tonic + x) % 12);
  const out: BassWalk[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < progression.length; i++) {
    const a = parseChord(progression[i]);
    const b = parseChord(progression[(i + 1) % progression.length]);
    if (!a || !b || a.root === b.root) continue;
    const key2 = `${progression[i]}>${progression[(i + 1) % progression.length]}`;
    if (seen.has(key2)) continue;
    seen.add(key2);
    // Идём от баса A к басу B по ступеням гаммы, кратчайшим путём (вверх или вниз).
    const up = (b.root - a.root + 12) % 12;
    const dir = up <= 6 ? 1 : -1;
    const steps: number[] = [];
    let pc = a.root;
    for (let guard = 0; guard < 12 && steps.length < 3; guard++) {
      pc = (pc + dir + 12) % 12;
      if (pc === b.root) break;
      if (scale.includes(pc)) steps.push(pc);
    }
    if (!steps.length) steps.push((b.root - dir + 12) % 12); // хроматический подход
    // Высота нот — без скачков через октаву: от низкого баса первого аккорда шагами в нужную сторону.
    let midi = 40 + ((a.root - 4 + 12) % 12);
    const pitches = [midi];
    for (const x of [...steps, b.root]) {
      midi += dir > 0 ? (x - (midi % 12) + 12) % 12 : -(((midi % 12) - x + 12) % 12);
      pitches.push(midi);
    }
    // Вся фраза должна лечь не ниже открытой 6-й струны.
    if (Math.min(...pitches) < 40) for (let j = 0; j < pitches.length; j++) pitches[j] += 12;
    const names = [a.root, ...steps, b.root];
    const notes = pitches.map((m, j) => ({ ...posOf(m), name: SHARP_NOTES[names[j]] }));
    out.push({ from: progression[i], to: progression[(i + 1) % progression.length], notes });
  }
  return out.slice(0, 4);
}

export const bassMidi = (n: { string: number; fret: number }) => GUITAR_OPEN_STRINGS_MIDI[n.string] + n.fret;
