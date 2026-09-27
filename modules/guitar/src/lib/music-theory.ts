// Core music-theory helpers: note names, transposition, frequencies, intervals.

export const SHARP_NOTES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

export const FLAT_NOTES = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
] as const;

export type NoteName = (typeof SHARP_NOTES)[number];

const NOTE_INDEX: Record<string, number> = {};
SHARP_NOTES.forEach((n, i) => (NOTE_INDEX[n] = i));
FLAT_NOTES.forEach((n, i) => (NOTE_INDEX[n] = i));

/** Splits a chord symbol like "Am7" into root ("A") and suffix ("m7"). */
export function splitChord(chord: string): { root: string; suffix: string } {
  const match = chord.match(/^([A-G])(#|b)?(.*)$/);
  if (!match) return { root: chord, suffix: "" };
  const [, letter, accidental = "", suffix] = match;
  return { root: `${letter}${accidental}`, suffix };
}

/** Transposes a single chord symbol by `semitones`, preferring sharps or flats. */
export function transposeChord(
  chord: string,
  semitones: number,
  preferFlats = false
): string {
  if (semitones === 0) return chord;
  const { root, suffix } = splitChord(chord);
  const idx = NOTE_INDEX[root];
  if (idx === undefined) return chord;
  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  const table = preferFlats ? FLAT_NOTES : SHARP_NOTES;
  return `${table[newIdx]}${suffix}`;
}

export function noteIndex(note: string): number {
  return NOTE_INDEX[note] ?? 0;
}

export const INTERVAL_NAMES = [
  "Унисон",
  "Малая секунда",
  "Большая секунда",
  "Малая терция",
  "Большая терция",
  "Кварта",
  "Тритон",
  "Квинта",
  "Малая секста",
  "Большая секста",
  "Малая септима",
  "Большая септима",
  "Октава",
] as const;

export const INTERVAL_SHORT = [
  "P1", "m2", "M2", "m3", "M3", "P4", "TT", "P5", "m6", "M6", "m7", "M7", "P8",
] as const;

/** A4 = 440Hz reference. midi 69 = A4. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Standard guitar open-string MIDI notes, low E to high E. */
export const GUITAR_OPEN_STRINGS_MIDI = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

/** Russian solfège names, indexed like SHARP_NOTES. */
export const SOLFEGE_RU = [
  "До", "До#", "Ре", "Ре#", "Ми", "Фа", "Фа#", "Соль", "Соль#", "Ля", "Ля#", "Си",
] as const;

export function freqToMidiFloat(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

/** Note name with octave, e.g. midi 69 -> "A4". */
export function midiToName(midi: number): string {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  return `${SHARP_NOTES[((rounded % 12) + 12) % 12]}${octave}`;
}

export function midiToSolfege(midi: number): string {
  const rounded = Math.round(midi);
  return SOLFEGE_RU[((rounded % 12) + 12) % 12];
}

/** How far a frequency sits from the nearest equal-tempered note, in cents. */
export function centsFromNearestNote(frequency: number): {
  midi: number;
  cents: number;
} {
  const exact = freqToMidiFloat(frequency);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}

export function centsBetween(frequency: number, targetMidi: number): number {
  return (freqToMidiFloat(frequency) - targetMidi) * 100;
}

export function chordQualityLabel(suffix: string): string {
  if (suffix === "" || suffix === "maj") return "мажор";
  if (suffix === "m" || suffix === "min") return "минор";
  if (suffix.startsWith("dim")) return "уменьшённый";
  if (suffix.startsWith("aug")) return "увеличенный";
  if (suffix.startsWith("m7")) return "минорный септаккорд";
  if (suffix.startsWith("maj7")) return "большой мажорный септаккорд";
  if (suffix.startsWith("7")) return "доминантсептаккорд";
  return suffix;
}
