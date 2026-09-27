// Chord recognition from a magnitude spectrum via a 12-bin chromagram.
// Pure DSP so it can be tested outside the browser.

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface ChordType {
  suffix: string;
  label: string;
  intervals: number[];
  prior: number; // mild preference for simpler chords when scores are close
}

export const CHORD_TYPES: ChordType[] = [
  { suffix: "", label: "мажор", intervals: [0, 4, 7], prior: 1 },
  { suffix: "m", label: "минор", intervals: [0, 3, 7], prior: 1 },
  { suffix: "7", label: "септаккорд", intervals: [0, 4, 7, 10], prior: 0.985 },
  { suffix: "m7", label: "минорный септ", intervals: [0, 3, 7, 10], prior: 0.985 },
  { suffix: "maj7", label: "большой мажорный септ", intervals: [0, 4, 7, 11], prior: 0.985 },
  { suffix: "sus2", label: "sus2", intervals: [0, 2, 7], prior: 0.94 },
  { suffix: "sus4", label: "sus4", intervals: [0, 5, 7], prior: 0.94 },
  { suffix: "5", label: "квинта (пауэр)", intervals: [0, 7], prior: 0.88 },
];

/**
 * Folds a spectrum (dB per bin, as AnalyserNode.getFloatFrequencyData returns)
 * into energy per pitch class. Bins far from any equal-tempered pitch are
 * skipped, which keeps leakage and noise out of the profile.
 */
export function chromaFromSpectrum(
  db: Float32Array,
  sampleRate: number,
  fftSize: number,
  minHz = 75,
  maxHz = 2000
): Float32Array {
  const chroma = new Float32Array(12);
  const binHz = sampleRate / fftSize;
  const first = Math.max(1, Math.ceil(minHz / binHz));
  const last = Math.min(db.length - 1, Math.floor(maxHz / binHz));

  for (let k = first; k <= last; k++) {
    const level = db[k];
    if (!Number.isFinite(level) || level < -95) continue;
    const midi = 69 + 12 * Math.log2((k * binHz) / 440);
    const nearest = Math.round(midi);
    const distance = Math.abs(midi - nearest);
    if (distance > 0.4) continue;
    const magnitude = Math.pow(10, level / 20);
    chroma[((nearest % 12) + 12) % 12] += magnitude * (1 - distance * 2);
  }

  let max = 0;
  for (let i = 0; i < 12; i++) max = Math.max(max, chroma[i]);
  if (max > 0) for (let i = 0; i < 12; i++) chroma[i] /= max;
  return chroma;
}

/**
 * Pitch class of the lowest clearly sounding note. Chroma alone cannot tell
 * Am7 from C or Dsus4 from Gsus2 (same notes); the bass usually can.
 */
export function bassPitchClass(
  db: Float32Array,
  sampleRate: number,
  fftSize: number,
  minHz = 70,
  maxHz = 260
): number | null {
  const binHz = sampleRate / fftSize;
  const first = Math.max(1, Math.ceil(minHz / binHz));
  const last = Math.min(db.length - 2, Math.floor(maxHz / binHz));

  // The fundamental of a low string is often ~15-20 dB quieter than the
  // strings above it, so "loudest" is useless. Instead: the lowest genuine
  // spectral peak that stands well clear of the band's noise floor. Only local
  // maxima count, or window leakage from A2 would read as a G#2 below it.
  const band = Array.from(db.subarray(first, last + 1)).filter(Number.isFinite).sort((a, b) => a - b);
  if (band.length === 0) return null;
  const floor = band[Math.floor(band.length / 2)];

  for (let k = first; k <= last; k++) {
    const level = db[k];
    if (!Number.isFinite(level) || level < floor + 25) continue;
    if (!(level > db[k - 1] && level >= db[k + 1])) continue;
    const midi = 69 + 12 * Math.log2((k * binHz) / 440);
    const nearest = Math.round(midi);
    if (Math.abs(midi - nearest) > 0.35) continue;
    return ((nearest % 12) + 12) % 12;
  }
  return null;
}

// What a chord *sounds like* in chroma, not just its notes: every string also
// rings its 3rd and 5th harmonics (a fifth and a major third above). Without
// this, a C major and an E minor are easy to confuse.
function templateFor(root: number, intervals: number[]): Float32Array {
  const vector = new Float32Array(12);
  for (const interval of intervals) {
    const pc = (root + interval) % 12;
    vector[pc] += 1;
    vector[(pc + 7) % 12] += 0.3;
    vector[(pc + 4) % 12] += 0.15;
  }
  return vector;
}

function cosine(a: Float32Array, b: Float32Array): number {
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

export interface ChordCandidate {
  name: string;
  root: number;
  type: ChordType;
  score: number;
}

const TEMPLATES = CHORD_TYPES.flatMap((type) =>
  Array.from({ length: 12 }, (_, root) => ({ root, type, vector: templateFor(root, type.intervals) }))
);

const BASS_BONUS = 0.05;

export function matchChord(
  chroma: Float32Array,
  bassPc: number | null = null,
  limit = 3
): ChordCandidate[] {
  return TEMPLATES.map(({ root, type, vector }) => ({
    name: `${NOTE_NAMES[root]}${type.suffix}`,
    root,
    type,
    score: cosine(chroma, vector) * type.prior + (bassPc === root ? BASS_BONUS : 0),
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Treats enharmonic spellings and equivalent names as the same chord. */
export function sameChord(a: string, b: string): boolean {
  const normalize = (name: string) =>
    name
      .replace("Db", "C#")
      .replace("Eb", "D#")
      .replace("Gb", "F#")
      .replace("Ab", "G#")
      .replace("Bb", "A#");
  return normalize(a) === normalize(b);
}
