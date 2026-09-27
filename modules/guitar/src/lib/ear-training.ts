export interface ChordQualityDef {
  id: string;
  label: string;
  intervals: number[]; // semitones from root
}

export const CHORD_QUALITIES: ChordQualityDef[] = [
  { id: "maj", label: "Мажор", intervals: [0, 4, 7] },
  { id: "min", label: "Минор", intervals: [0, 3, 7] },
  { id: "dim", label: "Уменьшённый", intervals: [0, 3, 6] },
  { id: "aug", label: "Увеличенный", intervals: [0, 4, 8] },
  { id: "dom7", label: "Доминантсептаккорд (7)", intervals: [0, 4, 7, 10] },
  { id: "maj7", label: "Большой мажорный (maj7)", intervals: [0, 4, 7, 11] },
  { id: "min7", label: "Минорный септаккорд (m7)", intervals: [0, 3, 7, 10] },
];

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pickRandom<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

/** Comfortable range for root notes: A2 (45) to A3 (57). */
export function randomRootMidi(min = 45, max = 57): number {
  return randomInt(min, max);
}
