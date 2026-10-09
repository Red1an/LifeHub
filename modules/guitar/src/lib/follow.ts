import { bassPitchClass, chromaFromSpectrum, disconnectSafely } from "@modules/audio";
import { parseChord } from "./chords";

/*
 * Прокрутка «за игрой»: микрофон слушает гитару, по хромаграмме узнаёт аккорд и двигает позицию
 * по последовательности аккордов песни. Сравниваем только с аккордами этой песни и только с ближайшими
 * следующими — поэтому распознавание устойчивое даже в шумной комнате.
 */

function template(name: string): Float32Array | null {
  const p = parseChord(name);
  if (!p) return null;
  const v = new Float32Array(12);
  // Как звучит аккорд, а не только его ноты: у струн слышны квинта и терция-обертоны.
  for (const t of p.quality.tones) {
    const pc = (p.root + t) % 12;
    v[pc] += 1;
    v[(pc + 7) % 12] += 0.3;
    v[(pc + 4) % 12] += 0.15;
  }
  if (p.bass !== null) v[p.bass] += 0.6;
  return v;
}

function cosine(a: Float32Array, b: Float32Array) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export interface FollowOptions {
  /** Звучащие аккорды песни по порядку (с учётом каподастра). */
  sequence: string[];
  getPos: () => number;
  onPos: (index: number) => void;
  /** Что слышно сейчас: аккорд из песни (или null — тишина) и уровень 0..1. */
  onHeard?: (chord: string | null, level: number) => void;
}

const LOOKAHEAD = 4;
const NEED_FRAMES = 3; // ~0.3 с уверенного звучания следующего аккорда

export function startFollow(source: AudioNode, opts: FollowOptions): () => void {
  const ctx = source.context as AudioContext;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0.55;
  source.connect(analyser);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const wave = new Float32Array(2048);

  const names = [...new Set(opts.sequence)];
  const templates = new Map(names.map((n) => [n, template(n)] as const));
  const roots = new Map(names.map((n) => [n, parseChord(n)?.root ?? -1] as const));
  const smooth = new Map<string, number>();
  let floor = 0.003;
  let streakIdx = -1;
  let streak = 0;

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(wave);
    let sum = 0;
    for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
    const rms = Math.sqrt(sum / wave.length);
    floor += (rms - floor) * (rms < floor ? 0.2 : 0.003);
    const level = Math.min(1, rms / 0.1);
    if (rms < Math.max(0.004, floor * 2.5)) {
      streak = 0;
      opts.onHeard?.(null, level);
      return;
    }
    analyser.getFloatFrequencyData(spectrum);
    const chroma = chromaFromSpectrum(spectrum, ctx.sampleRate, analyser.fftSize);
    const bass = bassPitchClass(spectrum, ctx.sampleRate, analyser.fftSize);

    let heard: string | null = null;
    let heardScore = 0;
    for (const n of names) {
      const t = templates.get(n);
      if (!t) continue;
      const raw = cosine(chroma, t) + (bass !== null && bass === roots.get(n) ? 0.04 : 0);
      const s = (smooth.get(n) ?? raw) * 0.5 + raw * 0.5;
      smooth.set(n, s);
      if (s > heardScore) {
        heardScore = s;
        heard = n;
      }
    }
    opts.onHeard?.(heardScore > 0.7 ? heard : null, level);

    const pos = opts.getPos();
    const current = pos >= 0 ? opts.sequence[pos] : null;
    const curScore = current ? smooth.get(current) ?? 0 : 0;
    let bestIdx = -1;
    let best = 0;
    for (let i = Math.max(0, pos + 1); i <= Math.min(opts.sequence.length - 1, pos + LOOKAHEAD); i++) {
      const n = opts.sequence[i];
      if (n === current) continue;
      const s = smooth.get(n) ?? 0;
      // Ближайшее вхождение важнее дальнего при равном звучании.
      const adj = s - (i - pos - 1) * 0.015;
      if (adj > best) {
        best = adj;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && best > 0.72 && best > curScore + 0.03) {
      streak = streakIdx === bestIdx ? streak + 1 : 1;
      streakIdx = bestIdx;
      if (streak >= NEED_FRAMES) {
        streak = 0;
        opts.onPos(bestIdx);
      }
    } else streak = 0;
  }, 90);

  return () => {
    window.clearInterval(timer);
    disconnectSafely(source, analyser);
  };
}
