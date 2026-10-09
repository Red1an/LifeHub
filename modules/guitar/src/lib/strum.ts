import { getAudioContext, playClick } from "@modules/audio";
import { playGuitarNote, strumChord } from "./audio/guitar-synth";
import { bestShape } from "./chords";
import { GUITAR_OPEN_STRINGS_MIDI } from "./music-theory";
import { sections, type Part } from "./songsterr";

/*
 * Бой: разбор из ритм-партии Songsterr (какие удары вниз/вверх/с глушением в каждом такте),
 * библиотека известных боёв, подбор по размеру и темпу, проигрывание на аккордах песни.
 */

export interface Stroke {
  /** Начало в долях целой от начала такта. */
  at: number;
  dir: "D" | "U";
  mute: boolean;
}

export interface StrumPattern {
  name: string;
  /** Размер: [3,4] или [4,4]. */
  sig: [number, number];
  strokes: Stroke[];
  tip?: string;
}

/** Сетка на восьмых: D — вниз, U — вверх, X — вниз с глушением, - — рука мимо. */
function fromGrid(grid: string, sig: [number, number] = [4, 4], step = 1 / 8): Stroke[] {
  return [...grid].flatMap((c, i) => (c === "-" ? [] : [{ at: i * step, dir: c === "U" ? ("U" as const) : ("D" as const), mute: c === "X" || c === "x" }])).filter((s) => s.at < sig[0] / sig[1]);
}

export const LIBRARY: (StrumPattern & { id: string; grid: string; minBpm: number; maxBpm: number })[] = [
  { id: "six", name: "Шестёрка", grid: "D-DU-UDU", sig: [4, 4], strokes: [], minBpm: 70, maxBpm: 130, tip: "Самый универсальный бой: подходит к большинству песен в среднем темпе." },
  { id: "six-mute", name: "Шестёрка с глушением", grid: "D-XU-UXU", sig: [4, 4], strokes: [], minBpm: 85, maxBpm: 150, tip: "Ребром ладони глушишь струны на 2 и 4 — звучит как малый барабан." },
  { id: "four", name: "Четвёрка", grid: "D-X-D-X-", sig: [4, 4], strokes: [], minBpm: 90, maxBpm: 170, tip: "Энергичный простой бой для быстрых песен: вниз — глушение." },
  { id: "eight", name: "Восьмёрка", grid: "D-DUXUDU", sig: [4, 4], strokes: [], minBpm: 80, maxBpm: 140, tip: "Насыщенный бой с глушением посередине такта." },
  { id: "eight-mute", name: "Восьмёрка с глушением", grid: "DUXUDUX-", sig: [4, 4], strokes: [], minBpm: 90, maxBpm: 160, tip: "Плотный рок-бой: глушение на 2 и 4, рука не останавливается." },
  { id: "gallop", name: "Галоп", grid: "D-DUD-DUD-DUD-DU", sig: [4, 4], strokes: [], minBpm: 90, maxBpm: 150, tip: "«Скачущий» бой шестнадцатыми: вниз, вниз-вверх. Рука ходит в два раза чаще." },
  { id: "pop", name: "Поп-бой", grid: "D-DU-UD-", sig: [4, 4], strokes: [], minBpm: 70, maxBpm: 125, tip: "Классика акустического попа: с паузой на конце такта." },
  { id: "straight", name: "Ровные восьмые", grid: "DUDUDUDU", sig: [4, 4], strokes: [], minBpm: 60, maxBpm: 110, tip: "Медленным песням — мягко, без акцентов." },
  { id: "slow", name: "Медленный (по долям)", grid: "D-D-D-D-", sig: [4, 4], strokes: [], minBpm: 40, maxBpm: 80, tip: "Для баллад: один удар на долю, пусть звенит." },
  { id: "waltz", name: "Вальс (тройка)", grid: "D-DUDU", sig: [3, 4], strokes: [], minBpm: 60, maxBpm: 180, tip: "Для песен на три: «раз-два-три»." },
  { id: "waltz-bass", name: "Вальс с басом", grid: "D-D-D-", sig: [3, 4], strokes: [], minBpm: 60, maxBpm: 180, tip: "Первая доля сильнее — как бас, вторая и третья легче." },
];
for (const p of LIBRARY) p.strokes = fromGrid(p.grid, p.sig, p.grid.length === 16 ? 1 / 16 : 1 / 8);

/** Подходящие бои из библиотеки по размеру и темпу (лучший первым). */
export function suggest(bpm: number | null, sig: [number, number] = [4, 4]) {
  const fit = LIBRARY.filter((p) => p.sig[0] === sig[0]);
  if (!bpm) return fit;
  return [...fit].sort((a, b) => {
    const d = (p: typeof a) => (bpm < p.minBpm ? p.minBpm - bpm : bpm > p.maxBpm ? bpm - p.maxBpm : 0);
    return d(a) - d(b);
  });
}

const key = (s: Stroke[]) => s.map((x) => `${Math.round(x.at * 16)}${x.dir}${x.mute ? "x" : ""}`).join(",");

/** Название боя: совпадение с библиотекой (по восьмым), иначе «свой бой». */
export function nameOf(p: Stroke[], sig: [number, number]): string {
  const exact = LIBRARY.find((l) => l.sig[0] === sig[0] && key(l.strokes) === key(p));
  if (exact) return exact.name;
  const simple = simplify(p);
  const hit = LIBRARY.find((l) => l.sig[0] === sig[0] && key(l.strokes) === key(simple));
  if (hit) return hit.name;
  const loose = LIBRARY.find((l) => l.sig[0] === sig[0] && key(l.strokes.map((s) => ({ ...s, mute: false }))) === key(simple.map((s) => ({ ...s, mute: false }))));
  if (loose) return `${loose.name} (вариант)`;
  if (p.some((s) => Math.round(s.at * 16) % 2 === 1)) return "Бой с шестнадцатыми (галоп)";
  return "Свой бой";
}

/** Упрощение: только восьмые (шестнадцатые убираем). */
export function simplify(p: Stroke[]): Stroke[] {
  return p.filter((s) => Math.round(s.at * 16) % 2 === 0);
}

/* ───────────── бой из ритм-партии ───────────── */

export interface PartStrum {
  label: string;
  measures: number;
  pattern: StrumPattern;
}

/** Самый частый бой в каждой части песни по ритм-партии Songsterr. */
export function strumsFromPart(part: Part): PartStrum[] {
  const raw = part.measures.map((m) => {
    const strokes: Stroke[] = [];
    for (const b of m.beats) {
      if (b.rest || b.grace || !b.notes.length) continue;
      const mute = b.notes.every((n) => n.dead);
      if (b.notes.length < 2 && !mute) continue; // одиночная нота — не удар
      strokes.push({ at: Math.round(b.at * 16) / 16, dir: "D", mute });
    }
    return { m, strokes };
  });
  // Направление — по правилу маятника: рука ходит ровно, вниз на доли (или на восьмые, если бой на шестнадцатых).
  // Стрелки в табах Songsterr расставлены авторами непоследовательно, поэтому на них не опираемся.
  for (const r of raw) {
    const sixteenths = r.strokes.some((s) => Math.round(s.at * 16) % 2 === 1);
    for (const s of r.strokes) {
      const p16 = Math.round(s.at * 16);
      s.dir = p16 % 4 === 0 || (sixteenths && p16 % 2 === 0) ? "D" : "U";
    }
  }

  const secs = sections(part);
  const ranges = secs.length ? secs : [{ label: "Песня", from: 0, to: part.measures.length - 1 }];
  const out: PartStrum[] = [];
  for (const sec of ranges) {
    const counts = new Map<string, { n: number; strokes: Stroke[]; sig: [number, number] }>();
    for (let i = sec.from; i <= sec.to; i++) {
      const r = raw[i];
      if (!r || r.strokes.length < 2) continue;
      const strokes = r.strokes.map(({ at, dir, mute }) => ({ at, dir, mute }));
      const k = key(strokes);
      const c = counts.get(k) ?? { n: 0, strokes, sig: r.m.sig };
      c.n++;
      counts.set(k, c);
    }
    const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    if (!top) continue;
    const label = sec.label.replace(/^\d+-?й\s*/i, "");
    // Одинаковый бой в разных частях — одна запись: «Припев, Соло».
    const same = out.find((o) => key(o.pattern.strokes) === key(top.strokes));
    if (same) {
      same.measures += top.n;
      if (!same.label.split(", ").includes(label)) same.label += `, ${label}`;
      continue;
    }
    out.push({ label, measures: top.n, pattern: { name: nameOf(top.strokes, top.sig), sig: top.sig, strokes: top.strokes } });
  }
  // Сначала бой, который звучит дольше всего.
  return out.sort((a, b) => b.measures - a.measures);
}

/* ───────────── проигрывание ───────────── */

export interface StrumPlayOptions {
  chords: string[];
  pattern: StrumPattern;
  bpm: number;
  barsPerChord?: number;
  click?: boolean;
  onStep?: (bar: number, stroke: number) => void;
}

/** Играет бой на аккордах по кругу. Возвращает остановку. */
export function playStrum(o: StrumPlayOptions): () => void {
  const ctx = getAudioContext();
  const whole = (4 * 60) / o.bpm;
  const barLen = (o.pattern.sig[0] / o.pattern.sig[1]) * whole;
  const bars = o.chords.flatMap((c) => Array.from({ length: o.barsPerChord ?? 1 }, () => c));
  const shapes = new Map(o.chords.map((c) => [c, bestShape(c)?.frets ?? null]));
  let t0 = ctx.currentTime + 0.15;
  let bar = 0;
  let alive = true;
  const timers: number[] = [];

  const scheduleBar = () => {
    const thisBar = bar;
    const chord = bars[bar % bars.length];
    const frets = shapes.get(chord);
    const start = t0 + bar * barLen;
    o.pattern.strokes.forEach((s, si) => {
      const when = Math.max(0, start + s.at * whole - ctx.currentTime);
      if (frets) {
        if (s.mute) {
          frets.forEach((f, i) => f >= 0 && playGuitarNote(GUITAR_OPEN_STRINGS_MIDI[i] + f, { when: when + i * 0.005, gain: 0.14, duration: 0.035 }));
        } else {
          const strong = Math.round(s.at * 16) % 4 === 0;
          strumChord(frets, { when, direction: s.dir === "D" ? "down" : "up", gain: strong ? 0.5 : 0.36, spread: 0.014 });
        }
      }
      timers.push(window.setTimeout(() => alive && o.onStep?.(thisBar, si), when * 1000));
    });
    if (o.click) for (let q = 0; q < o.pattern.sig[0]; q++) playClick(q === 0, Math.max(0, start + q * (whole / 4) - ctx.currentTime), 0.6);
  };

  const timer = window.setInterval(() => {
    if (!alive) return;
    while (t0 + bar * barLen < ctx.currentTime + 0.3) {
      scheduleBar();
      bar++;
    }
    if (timers.length > 200) timers.splice(0, 100);
  }, 50);
  return () => {
    alive = false;
    window.clearInterval(timer);
    timers.forEach((t) => window.clearTimeout(t));
    t0 = 0;
  };
}
